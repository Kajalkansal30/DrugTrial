import os
import time
from typing import List, Dict, Any
from Bio import Entrez
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Entrez requires an email address
Entrez.email = os.getenv("ENTREZ_EMAIL", "drugtrial-ai-agent@example.com")

def fetch_pubmed_abstracts(query: List[str], max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search PubMed for a query and return titles and abstracts.
    """
    try:
        search_query = " OR ".join(query) if isinstance(query, list) else query
        logger.info(f"Searching PubMed for: %s", search_query)
        
        # Search for IDs
        handle = Entrez.esearch(db="pubmed", term=search_query, retmax=max_results, usehistory="y")
        search_results = Entrez.read(handle)
        handle.close()
        
        id_list = search_results.get("IdList", [])
        if not id_list:
            logger.warning("No results found for query: %s", search_query)
            return []
            
        # Fetch details
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
            
        return abstracts
        
    except Exception as e:
        logger.error("Error fetching from PubMed: %s", str(e))
        return []

if __name__ == "__main__":
    # Quick test
    results = fetch_pubmed_abstracts(["Rheumatoid Arthritis", "IL-6"], max_results=3)
    for res in results:
        print(f"Title: {res['title']}")
        print(f"Abstract: {res['text'][:100]}...\n")
