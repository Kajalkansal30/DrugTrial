from fastapi import APIRouter, HTTPException, Depends
from backend.db_models import get_session, Patient, PatientVault
from sqlalchemy import func
from typing import List, Dict, Any

router = APIRouter(prefix="/api/privacy", tags=["Privacy & Compliance"])

@router.get("/summary")
async def get_privacy_summary():
    """Retrieve high-level de-identification statistics."""
    session = get_session()
    try:
        total = session.query(Patient).count()
        deidentified = session.query(Patient).filter_by(is_deidentified=True).count()
        
        # Check for leaks: patients not marked de-identified or having plain text names/ssn
        leaks = session.query(Patient).filter(
            (Patient.is_deidentified == False) | 
            (Patient.first_name.isnot(None)) | 
            (Patient.ssn.isnot(None))
        ).count()
        
        return {
            "total_patients": total,
            "deidentified_count": deidentified,
            "plain_text_leaks": leaks,
            "compliance_score": (deidentified / total * 100) if total > 0 else 100,
            "status": "SECURE" if leaks == 0 else "WARNING"
        }
    finally:
        session.close()

@router.get("/verify-samples")
async def get_verification_samples(limit: int = 5):
    """Side-by-side comparison of Research Layer vs PII Vault for verification."""
    session = get_session()
    try:
        patients = session.query(Patient).filter_by(is_deidentified=True).limit(limit).all()
        results = []
        
        for p in patients:
            vault = session.query(PatientVault).filter_by(patient_id=p.id).first()
            results.append({
                "research": {
                    "id": p.id,
                    "name": "[REDACTED]",
                    "ssn": "[REDACTED]",
                    "age_group": p.age_group,
                    "is_deidentified": p.is_deidentified
                },
                "vault": {
                    "first_name": (vault.encrypted_pii or {}).get('first_name', 'MISSING') if vault else "MISSING",
                    "last_name": (vault.encrypted_pii or {}).get('last_name', 'MISSING') if vault else "MISSING",
                    "masked_ssn": (vault.encrypted_pii or {}).get('ssn', 'MISSING') if vault else "MISSING",
                    "original_id": (vault.encrypted_pii or {}).get('original_id', 'MISSING') if vault else "MISSING"
                }
            })
        return results
    finally:
        session.close()
