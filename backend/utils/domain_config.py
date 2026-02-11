"""
Domain-specific validation and filtering configurations
Supports different medical domains with appropriate validation databases
"""
from typing import Dict, List, Set, Any
from enum import Enum

class Domain(Enum):
    CARDIOLOGY = "cardiology"
    ONCOLOGY = "oncology"
    NEUROLOGY = "neurology"
    GENERAL = "general"

class DocumentType(Enum):
    CLINICAL_PROTOCOL = "clinical_protocol"
    RESEARCH_PAPER = "research_paper"
    FDA_SUBMISSION = "fda_submission"
    UNKNOWN = "unknown"

# Domain-specific validation databases
DOMAIN_VALIDATORS = {
    Domain.CARDIOLOGY: {
        "databases": ["HGNC", "UniProt", "MeSH"],
        "priority_types": ["Protein/Gene", "Pathway", "Drug/Chemical"],
        "weight_multiplier": {
            "Protein/Gene": 5,
            "Pathway": 4,
            "Drug/Chemical": 3
        }
    },
    Domain.ONCOLOGY: {
        "databases": ["COSMIC", "OncoKB", "HGNC", "UniProt"],
        "priority_types": ["Protein/Gene", "Pathway"],
        "weight_multiplier": {
            "Protein/Gene": 6,  # Higher for oncology
            "Pathway": 5,
            "Drug/Chemical": 2
        }
    },
    Domain.NEUROLOGY: {
        "databases": ["DisGeNET", "NeuroLex", "HGNC"],
        "priority_types": ["Protein/Gene", "Pathway"],
        "weight_multiplier": {
            "Protein/Gene": 5,
            "Pathway": 4,
            "Drug/Chemical": 3
        }
    },
    Domain.GENERAL: {
        "databases": ["UMLS", "MeSH"],
        "priority_types": ["Protein/Gene", "Drug/Chemical"],
        "weight_multiplier": {
            "Protein/Gene": 4,
            "Drug/Chemical": 3,
            "Pathway": 3
        }
    }
}

# Domain-specific generic terms (expand base set)
DOMAIN_GENERIC_TERMS = {
    Domain.CARDIOLOGY: {
        "symptom progression", "adverse cardiac event", "heart function",
        "cardiac output", "ejection fraction", "heart rate", "blood pressure"
    },
    Domain.ONCOLOGY: {
        "tumor burden", "tumor progression", "metastasis",
        "tumor size", "lesion count", "cancer stage", "tumor grade"
    },
    Domain.NEUROLOGY: {
        "cognitive decline", "neurological symptoms", "brain function",
        "mental status", "consciousness", "cognitive function"
    }
}

# Document-type specific extraction focus
DOCUMENT_EXTRACTION_FOCUS = {
    DocumentType.CLINICAL_PROTOCOL: {
        "extract": ["eligibility_criteria", "endpoints", "target_disease", "interventions"],
        "target_sections": ["inclusion", "exclusion", "endpoints", "objectives"],
        "weight_boost": 1.5  # Boost entities from protocols
    },
    DocumentType.RESEARCH_PAPER: {
        "extract": ["genes", "pathways", "mechanisms", "biomarkers"],
        "target_sections": ["methods", "results", "discussion"],
        "weight_boost": 1.0
    },
    DocumentType.FDA_SUBMISSION: {
        "extract": ["pk_pd", "toxicology", "safety", "efficacy"],
        "target_sections": ["pharmacology", "safety", "clinical"],
        "weight_boost": 1.2
    }
}


def get_domain_config(domain: Domain) -> Dict[str, Any]:
    """Get configuration for specific domain"""
    return DOMAIN_VALIDATORS.get(domain, DOMAIN_VALIDATORS[Domain.GENERAL])


def infer_domain_from_disease(disease_query: str) -> Domain:
    """Infer domain from disease name"""
    disease_lower = disease_query.lower()
    
    # Cardiology keywords
    cardio_keywords = [
        "heart", "cardiac", "cardiovascular", "chagas", "arrhythmia",
        "cardiomyopathy", "myocardial", "ischemic", "coronary"
    ]
    if any(kw in disease_lower for kw in cardio_keywords):
        return Domain.CARDIOLOGY
    
    # Oncology keywords
    onco_keywords = [
        "cancer", "tumor", "carcinoma", "lymphoma", "leukemia",
        "sarcoma", "melanoma", "metastatic", "malignant"
    ]
    if any(kw in disease_lower for kw in onco_keywords):
        return Domain.ONCOLOGY
    
    # Neurology keywords
    neuro_keywords = [
        "alzheimer", "parkinson", "neurological", "brain", "dementia",
        "epilepsy", "stroke", "multiple sclerosis", "neuropathy"
    ]
    if any(kw in disease_lower for kw in neuro_keywords):
        return Domain.NEUROLOGY
    
    return Domain.GENERAL


def get_domain_generic_terms(domain: Domain) -> Set[str]:
    """Get domain-specific generic terms"""
    return DOMAIN_GENERIC_TERMS.get(domain, set())
