"""
Biological entity validation using HGNC and UniProt databases.
Optimized with connection pooling, persistent disk cache, and graceful timeouts.
"""
import logging
import json
import threading
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
import requests

from backend.utils.domain_config import Domain, get_domain_config

logger = logging.getLogger(__name__)

# Shared HTTP session with connection pooling (reuses TCP connections)
_http_session = None

def _get_http_session() -> requests.Session:
    global _http_session
    if _http_session is None:
        _http_session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=5,
            pool_maxsize=10,
            max_retries=1
        )
        _http_session.mount("https://", adapter)
        _http_session.mount("http://", adapter)
    return _http_session


# ---------------------------------------------------------------------------
# Persistent validation cache: survives container restarts
# ---------------------------------------------------------------------------
_CACHE_PATH = Path("/app/data/bio_validation_cache.json")
_disk_cache: Dict[str, Any] = {}
_disk_cache_lock = threading.Lock()
_disk_cache_dirty = False


def _load_disk_cache():
    """Load persistent cache from disk on first access."""
    global _disk_cache
    if _disk_cache:
        return
    try:
        if _CACHE_PATH.exists():
            with open(_CACHE_PATH, "r") as f:
                _disk_cache = json.load(f)
            logger.info(f"Loaded {len(_disk_cache)} entries from bio validation cache")
    except Exception as e:
        logger.warning(f"Failed to load bio validation cache: {e}")
        _disk_cache = {}


def _save_disk_cache():
    """Flush dirty cache to disk (called periodically, not on every write)."""
    global _disk_cache_dirty
    if not _disk_cache_dirty:
        return
    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_CACHE_PATH, "w") as f:
            json.dump(_disk_cache, f)
        _disk_cache_dirty = False
    except Exception as e:
        logger.warning(f"Failed to save bio validation cache: {e}")


def _cache_get(key: str) -> Optional[Dict]:
    """Get from persistent cache. Returns None on miss, dict or False on hit."""
    _load_disk_cache()
    return _disk_cache.get(key)


def _cache_set(key: str, value):
    """Set in persistent cache. value can be dict (valid) or False (invalid)."""
    global _disk_cache_dirty
    with _disk_cache_lock:
        _disk_cache[key] = value
        _disk_cache_dirty = True
        # Flush every 50 new entries to avoid data loss
        if len(_disk_cache) % 50 == 0:
            _save_disk_cache()


class BiologicalValidator:
    """Validates entities against biological databases with domain awareness."""
    
    def __init__(self, domain: Domain = Domain.GENERAL):
        self.domain = domain
        self.config = get_domain_config(domain)
        self.allowed_databases = self.config["databases"]
    
    def validate_hgnc(self, gene_name: str) -> Optional[Dict[str, Any]]:
        """Validate gene name against HGNC database (with persistent cache)."""
        cache_key = f"hgnc:{gene_name}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached if cached else None

        try:
            session = _get_http_session()
            url = f"https://rest.genenames.org/fetch/symbol/{gene_name}"
            headers = {"Accept": "application/json"}
            response = session.get(url, headers=headers, timeout=3)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("response", {}).get("numFound", 0) > 0:
                    doc = data["response"]["docs"][0]
                    result = {
                        "approved_symbol": doc.get("symbol"),
                        "name": doc.get("name"),
                        "source": "HGNC"
                    }
                    _cache_set(cache_key, result)
                    return result
        except requests.exceptions.Timeout:
            logger.debug(f"HGNC timeout for {gene_name}")
        except Exception as e:
            logger.debug(f"HGNC lookup failed for {gene_name}: {e}")
        
        _cache_set(cache_key, False)
        return None
    
    def validate_uniprot(self, protein_name: str) -> Optional[Dict[str, Any]]:
        """Validate protein against UniProt (with persistent cache)."""
        cache_key = f"uniprot:{protein_name}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached if cached else None

        try:
            session = _get_http_session()
            search_term = protein_name.replace("-", " ")
            url = f"https://rest.uniprot.org/uniprotkb/search"
            params = {
                "query": f"(gene:{search_term}) OR (protein_name:{search_term})",
                "format": "json",
                "size": 1,
                "fields": "accession,id,protein_name,gene_names"
            }
            response = session.get(url, params=params, timeout=3)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("results"):
                    entry = data["results"][0]
                    protein_desc = entry.get("proteinDescription", {})
                    rec_name = protein_desc.get("recommendedName", {})
                    
                    result = {
                        "accession": entry.get("primaryAccession"),
                        "name": entry.get("uniProtkbId"),
                        "protein_name": rec_name.get("fullName", {}).get("value") if rec_name else None,
                        "source": "UniProt"
                    }
                    _cache_set(cache_key, result)
                    return result
        except requests.exceptions.Timeout:
            logger.debug(f"UniProt timeout for {protein_name}")
        except Exception as e:
            logger.debug(f"UniProt lookup failed for {protein_name}: {e}")
        
        _cache_set(cache_key, False)
        return None
    
    def validate_entity(self, entity_text: str, entity_type: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
        """
        Domain-aware validation strategy.
        Returns: (is_valid, validation_info)
        """
        validation_info = None
        
        if self.domain == Domain.CARDIOLOGY:
            if "HGNC" in self.allowed_databases and entity_type in ["Protein/Gene", "Protein"]:
                validation_info = self.validate_hgnc(entity_text)
            if not validation_info and "UniProt" in self.allowed_databases:
                validation_info = self.validate_uniprot(entity_text)
                
        elif self.domain == Domain.ONCOLOGY:
            if "HGNC" in self.allowed_databases and entity_type in ["Protein/Gene", "Protein"]:
                validation_info = self.validate_hgnc(entity_text)
            if not validation_info and "UniProt" in self.allowed_databases:
                validation_info = self.validate_uniprot(entity_text)
                
        else:
            if entity_type in ["Protein/Gene", "Protein"]:
                validation_info = self.validate_hgnc(entity_text)
            if not validation_info:
                validation_info = self.validate_uniprot(entity_text)
        
        is_valid = validation_info is not None
        
        if is_valid:
            logger.info(f"Validated {entity_text} via {validation_info.get('source')} [{self.domain.value}]")
        
        return is_valid, validation_info


_validators = {}

def get_validator(domain: Domain = Domain.GENERAL) -> BiologicalValidator:
    """Get domain-specific validator instance (cached singleton per domain)."""
    global _validators
    if domain not in _validators:
        _validators[domain] = BiologicalValidator(domain)
    return _validators[domain]


def flush_validation_cache():
    """Flush the persistent validation cache to disk. Call on shutdown."""
    _save_disk_cache()
