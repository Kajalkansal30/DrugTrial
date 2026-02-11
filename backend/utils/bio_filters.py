"""
Comprehensive filters for biological entity validation
Research-grade generic term blacklist
"""

# Comprehensive generic blacklist - research grade
GENERIC_TERMS = {
    # Generic biology
    "gene", "genes", "protein", "proteins", "pathway", "pathways",
    "receptor", "receptors", "enzyme", "enzymes", "factor", "factors",
    
    # Clinical/medical generics
    "illness", "disease", "diseases", "disorder", "disorders",
    "condition", "conditions", "symptom", "symptoms",
    "patient", "patients", "subject", "subjects",
    
    # Process/function generics
    "expression", "activation", "inhibition", "regulation",
    "upregulation", "downregulation", "signaling",
    "metabolism", "synthesis", "degradation",
    
    # Outcomes/endpoints
    "progression", "outcome", "outcomes", "event", "events",
    "endpoint", "endpoints", "complication", "complications",
    "response", "responses", "effect", "effects",
    
    # Linguistic artifacts
    "dynamically", "significantly", "substantially", "markedly",
    "primarily", "mainly", "largely", "predominantly",
    
    # Generic modifiers
    "level", "levels", "rate", "rates", "risk", "risks",
    "impact", "impacts", "change", "changes",
    "increase", "increased", "decrease", "decreased",
    "high", "low", "elevated", "reduced",
    
    # Measurement terms
    "marker", "markers", "indicator", "indicators",
    "measurement", "measurements", "value", "values",
    
    # Non-biological
    "impediment", "challenge", "problem", "issue",
    "function", "activity", "process", "mechanism",
    
    # Additional cardiology-specific
    "cardiac", "heart", "vascular", "blood",
    
    # Additional generic medical
    "treatment", "therapy", "intervention", "procedure"
}

# Multi-word generic patterns (reject these phrases)
GENERIC_PHRASES = {
    "symptom progression",
    "adverse cardiac event",
    "disease progression",
    "risk factor",
    "treatment response",
    "clinical outcome",
    "biomarker panel",
    "heart function",
    "cardiac output",
    "adverse event",
    "side effect",
    "clinical trial"
}

def is_generic_term(entity_text: str) -> tuple[bool, str]:
    """
    Check if entity is generic.
    Returns: (is_generic, reason)
    """
    normalized = entity_text.lower().strip()
    
    # Exact match in generic terms
    if normalized in GENERIC_TERMS:
        return True, f"generic_term:{normalized}"
    
    # Check multi-word phrases
    if normalized in GENERIC_PHRASES:
        return True, f"generic_phrase:{normalized}"
    
    # Check if it's ONLY a single generic word
    words = normalized.split()
    if len(words) == 1 and normalized in GENERIC_TERMS:
        return True, "single_generic_word"
    
    # Check if phrase contains only generic words
    if len(words) > 1:
        if all(word in GENERIC_TERMS for word in words):
            return True, "all_words_generic"
    
    return False, None
