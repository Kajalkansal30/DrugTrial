"""
Classify document type for appropriate extraction strategy
"""
import re
from backend.utils.domain_config import DocumentType

def classify_document_type(text_sample: str, filename: str = "") -> DocumentType:
    """
    Classify document based on content and filename
    Returns: DocumentType enum
    """
    text_lower = text_sample.lower()[:5000]  # First 5000 chars for speed
    
    # Clinical protocol indicators
    protocol_keywords = [
        "inclusion criteria", "exclusion criteria",
        "primary endpoint", "secondary endpoint",
        "informed consent", "protocol amendment",
        "investigational product", "study design",
        "randomized", "placebo-controlled"
    ]
    protocol_score = sum(1 for kw in protocol_keywords if kw in text_lower)
    
    # Research paper indicators
    paper_keywords = [
        "abstract", "introduction", "methods", "results", "discussion",
        "p-value", "statistical analysis", "figure", "table",
        "we investigated", "we found", "our study"
    ]
    paper_score = sum(1 for kw in paper_keywords if kw in text_lower)
    
    # FDA submission indicators
    fda_keywords = [
        "investigational new drug", "ind application",
        "pharmacokinetics", "pharmacodynamics",
        "nonclinical toxicology", "clinical pharmacology",
        "fda", "new drug application", "nda"
    ]
    fda_score = sum(1 for kw in fda_keywords if kw in text_lower)
    
    # Filename clues
    filename_lower = filename.lower()
    if any(kw in filename_lower for kw in ["protocol", "trial", "clinical"]):
        protocol_score += 2
    if any(kw in filename_lower for kw in ["fda", "ind", "nda"]):
        fda_score += 2
    if any(kw in filename_lower for kw in ["paper", "article", "research"]):
        paper_score += 1
    
    # Determine type based on scores
    scores = {
        DocumentType.CLINICAL_PROTOCOL: protocol_score,
        DocumentType.RESEARCH_PAPER: paper_score,
        DocumentType.FDA_SUBMISSION: fda_score
    }
    
    max_score = max(scores.values())
    if max_score >= 3:
        return max(scores, key=scores.get)
    
    # Default to protocol if uncertain but has some keywords
    if protocol_score >= 1:
        return DocumentType.CLINICAL_PROTOCOL
    
    return DocumentType.UNKNOWN
