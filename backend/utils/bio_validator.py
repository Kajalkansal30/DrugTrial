"""
Biological entity validation using HGNC and UniProt databases
Simplified version for MVP
"""
import logging
from typing import Optional, Dict, Any
import requests
from functools import lru_cache

from backend.utils.domain_config import Domain, get_domain_config

logger = logging.getLogger(__name__)

class BiologicalValidator:
    """Validates entities against biological databases with domain awareness"""
    
    def __init__(self, domain: Domain = Domain.GENERAL):
        self.domain = domain
        self.config = get_domain_config(domain)
        self.allowed_databases = self.config["databases"]
        self.hgnc_cache = {}
        self.uniprot_cache = {}
    
    @lru_cache(maxsize=1000)
    def validate_hgnc(self, gene_name: str) -> Optional[Dict[str, Any]]:
        """
        Validate gene name against HGNC database
        Returns: {"approved_symbol": "IL6", "name": "interleukin 6"} or None
        """
        try:
            url = f"https://rest.genenames.org/fetch/symbol/{gene_name}"
            headers = {"Accept": "application/json"}
            response = requests.get(url, headers=headers, timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("response", {}).get("numFound", 0) > 0:
                    doc = data["response"]["docs"][0]
                    return {
                        "approved_symbol": doc.get("symbol"),
                        "name": doc.get("name"),
                        "source": "HGNC"
                    }
        except Exception as e:
            logger.debug(f"HGNC lookup failed for {gene_name}: {e}")
        
        return None
    
    @lru_cache(maxsize=1000)
    def validate_uniprot(self, protein_name: str) -> Optional[Dict[str, Any]]:
        """
        Validate protein against UniProt
        Returns: {"accession": "P05231", "name": "IL6_HUMAN"} or None
        """
        try:
            # Clean protein name for search
            search_term = protein_name.replace("-", " ")
            url = f"https://rest.uniprot.org/uniprotkb/search"
            params = {
                "query": f"(gene:{search_term}) OR (protein_name:{search_term})",
                "format": "json",
                "size": 1,
                "fields": "accession,id,protein_name,gene_names"
            }
            response = requests.get(url, params=params, timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("results"):
                    entry = data["results"][0]
                    protein_desc = entry.get("proteinDescription", {})
                    rec_name = protein_desc.get("recommendedName", {})
                    
                    return {
                        "accession": entry.get("primaryAccession"),
                        "name": entry.get("uniProtkbId"),
                        "protein_name": rec_name.get("fullName", {}).get("value") if rec_name else None,
                        "source": "UniProt"
                    }
        except Exception as e:
            logger.debug(f"UniProt lookup failed for {protein_name}: {e}")
        
        return None
    
    def validate_entity(self, entity_text: str, entity_type: str) -> tuple[bool, Optional[Dict[str, Any]]]:
        """
        Domain-aware validation strategy
        Returns: (is_valid, validation_info)
        """
        validation_info = None
        
        # Strategy depends on domain
        if self.domain == Domain.CARDIOLOGY:
            # Cardiology: HGNC -> UniProt -> MeSH (simulated via UniProt for now or add MeSH if needed)
            if "HGNC" in self.allowed_databases and entity_type in ["Protein/Gene", "Protein"]:
                validation_info = self.validate_hgnc(entity_text)
            
            if not validation_info and "UniProt" in self.allowed_databases:
                validation_info = self.validate_uniprot(entity_text)
                
        elif self.domain == Domain.ONCOLOGY:
            # Oncology: COSMIC (simulated) -> HGNC -> UniProt
            # For MVP we simulate COSMIC by just using HGNC strongly
            if "HGNC" in self.allowed_databases and entity_type in ["Protein/Gene", "Protein"]:
                validation_info = self.validate_hgnc(entity_text)
                
            if not validation_info and "UniProt" in self.allowed_databases:
                validation_info = self.validate_uniprot(entity_text)
                
        else:
            # General/Default: HGNC -> UniProt
            if entity_type in ["Protein/Gene", "Protein"]:
                validation_info = self.validate_hgnc(entity_text)
            
            if not validation_info:
                validation_info = self.validate_uniprot(entity_text)
        
        is_valid = validation_info is not None
        
        if is_valid:
            logger.info(f"✅ Validated {entity_text} via {validation_info.get('source')} [{self.domain.value}]")
        
        return is_valid, validation_info


# Singleton instance logic modified for domain support
# In v3, we likely instantiate validators per request or cache by domain
_validators = {}

def get_validator(domain: Domain = Domain.GENERAL) -> BiologicalValidator:
    """Get domain-specific validator instance"""
    global _validators
    if domain not in _validators:
        _validators[domain] = BiologicalValidator(domain)
    return _validators[domain]
