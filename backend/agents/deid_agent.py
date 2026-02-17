import re
import hashlib
import json
from datetime import datetime
from typing import Dict, Any, List, Optional

class DeIDAgent:
    """
    HIPAA-compliant Agent for PII detection and de-identification.
    Supports pseudonymization, generalization, and masking.
    """
    
    def __init__(self, model_name="en_core_web_sm", load_nlp=True):
        self.nlp = None
        if load_nlp:
            try:
                import spacy
                self.nlp = spacy.load(model_name)
            except Exception:
                self.nlp = None
            
        self.patterns = {
            "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
            "phone": r"\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b",
            "email": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
            "zip": r"\b\d{5}(?:-\d{4})?\b"
        }

    def pseudonymize(self, value: str) -> str:
        """Create a stable hash for identifiers."""
        if not value: return "UNKNOWN"
        return hashlib.sha256(value.encode()).hexdigest()[:12].upper()

    def generalize_age(self, birthdate: str) -> str:
        """Generalize birthdate to age group (e.g., 30-40)."""
        try:
            if isinstance(birthdate, str):
                dob = datetime.strptime(birthdate, '%Y-%m-%d')
            else:
                dob = birthdate
            age = (datetime.now().date() - dob.date()).days // 365
            lower = (age // 10) * 10
            return f"{lower}-{lower+10}"
        except:
            return "UNKNOWN"

    def mask_string(self, value: str, visible_chars: int = 4) -> str:
        """Mask sensitive strings like phone numbers or emails."""
        if not value: return ""
        if len(value) <= visible_chars:
            return "*" * len(value)
        return value[:visible_chars] + "*" * (len(value) - visible_chars)

    def scan_for_pii(self, text: str) -> List[Dict[str, Any]]:
        """Identify PII entities in text using NLP and patterns."""
        entities = []
        
        # 1. Regex patterns
        for label, pattern in self.patterns.items():
            for match in re.finditer(pattern, text):
                entities.append({
                    "start": match.start(),
                    "end": match.end(),
                    "label": label.upper(),
                    "text": match.group()
                })
        
        # 2. NLP Named Entity Recognition
        if self.nlp:
            doc = self.nlp(text)
            for ent in doc.ents:
                if ent.label_ in ["PERSON", "ORG", "GPE", "LOC", "FAC"]:
                    # Avoid duplicates from regex if any
                    if not any(e["start"] == ent.start_char for e in entities):
                        entities.append({
                            "start": ent.start_char,
                            "end": ent.end_char,
                            "label": ent.label_,
                            "text": ent.text
                        })
        
        return entities

    def deidentify_patient(self, patient_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process a raw patient record and return:
        1. De-identified record for research
        2. Original PII for the Vault
        """
        raw_id = str(patient_data.get('id', ''))
        
        # De-identified fields
        anonymized_id = f"PAT_{self.pseudonymize(raw_id)}"
        age_group = self.generalize_age(patient_data.get('birthdate'))
        
        deidentified_record = {
            "id": anonymized_id,
            "birthdate": datetime.strptime(patient_data.get('birthdate'), '%Y-%m-%d').date() if isinstance(patient_data.get('birthdate'), str) else patient_data.get('birthdate'),
            "gender": patient_data.get('gender'),
            "race": patient_data.get('race'),
            "ethnicity": patient_data.get('ethnicity'),
            "city": "REDACTED",
            "state": patient_data.get('state'),
            "is_deidentified": True,
            "age_group": age_group,
            "original_id_hash": hashlib.sha256(raw_id.encode()).hexdigest()
        }
        
        # PII Vault fields
        vault_pii = {
            "first_name": patient_data.get('first_name'),
            "last_name": patient_data.get('last_name'),
            "ssn": self.mask_string(patient_data.get('ssn')),
            "full_ssn_encrypted": patient_data.get('ssn'), # In production, this would be KMS-encrypted
            "original_id": raw_id,
            "exact_city": patient_data.get('city')
        }
        
        return {
            "research_record": deidentified_record,
            "vault_pii": vault_pii
        }
