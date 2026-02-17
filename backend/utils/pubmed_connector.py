import os
import time
import hashlib
import pickle
import logging
from pathlib import Path
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

try:
    from Bio import Entrez
    BIOPYTHON_AVAILABLE = True
except ImportError:
    BIOPYTHON_AVAILABLE = False
    logger.warning("Biopython ('Bio' module) not found. PubMed fetching will be disabled.")

if BIOPYTHON_AVAILABLE:
    Entrez.email = os.getenv("ENTREZ_EMAIL", "drugtrial-ai-agent@example.com")
else:
    Entrez = None

# In-memory + disk cache for PubMed results
_pubmed_cache = {}
_CACHE_DIR = Path("/tmp/pubmed_cache")
_CACHE_TTL = 86400  # 24 hours


def _cache_key(query: List[str], max_results: int) -> str:
    """Generate a deterministic cache key."""
    h = hashlib.sha256()
    h.update(f"{sorted(query)}:{max_results}".encode())
    return h.hexdigest()[:16]


def _load_from_cache(key: str):
    """Load from memory cache first, then disk."""
    if key in _pubmed_cache:
        entry = _pubmed_cache[key]
        if time.time() - entry["ts"] < _CACHE_TTL:
            return entry["data"]
    
    cache_path = _CACHE_DIR / f"{key}.pkl"
    if cache_path.exists():
        try:
            if time.time() - cache_path.stat().st_mtime < _CACHE_TTL:
                data = pickle.loads(cache_path.read_bytes())
                _pubmed_cache[key] = {"data": data, "ts": time.time()}
                return data
        except Exception:
            pass
    return None


def _save_to_cache(key: str, data):
    """Save to both memory and disk cache."""
    _pubmed_cache[key] = {"data": data, "ts": time.time()}
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (_CACHE_DIR / f"{key}.pkl").write_bytes(pickle.dumps(data))
    except Exception as e:
        logger.debug(f"Failed to write PubMed cache: {e}")


def fetch_pubmed_abstracts(query: List[str], max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search PubMed for a query and return titles and abstracts.
    Results are cached for 24 hours to avoid redundant API calls.
    """
    if not BIOPYTHON_AVAILABLE:
        logger.warning("PubMed search requested but Biopython is not installed.")
        return []
    
    # Check cache first
    key = _cache_key(query, max_results)
    cached = _load_from_cache(key)
    if cached is not None:
        logger.info(f"PubMed cache hit for query: {query}")
        return cached
    
    try:
        search_query = " OR ".join(query) if isinstance(query, list) else query
        logger.info(f"Searching PubMed for: %s", search_query)
        
        handle = Entrez.esearch(db="pubmed", term=search_query, retmax=max_results, usehistory="y")
        search_results = Entrez.read(handle)
        handle.close()
        
        id_list = search_results.get("IdList", [])
        if not id_list:
            logger.warning("No results found for query: %s", search_query)
            _save_to_cache(key, [])
            return []
            
        handle = Entrez.efetch(db="pubmed", id=",".join(id_list), rettype="xml", retmode="text")
        records = Entrez.read(handle)
        handle.close()
        
        abstracts = []
        for article in records.get("PubmedArticle", []):
            medline = article.get("MedlineCitation", {})
            article_data = medline.get("Article", {})
            title = article_data.get("ArticleTitle", "No Title")
            
            abstract_text = ""
            abstract_data = article_data.get("Abstract", {})
            if abstract_data:
                abstract_text = " ".join(abstract_data.get("AbstractText", []))
            
            pmid = medline.get("PMID", "")
            
            abstracts.append({
                "source": "PubMed",
                "id": str(pmid),
                "title": title,
                "text": abstract_text,
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
            })
        
        _save_to_cache(key, abstracts)
        return abstracts
        
    except Exception as e:
        logger.error("Error fetching from PubMed: %s", str(e))
        return []

if __name__ == "__main__":
    results = fetch_pubmed_abstracts(["Rheumatoid Arthritis", "IL-6"], max_results=3)
    for res in results:
        print(f"Title: {res['title']}")
        print(f"Abstract: {res['text'][:100]}...\n")
