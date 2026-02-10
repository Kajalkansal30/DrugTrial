from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from backend.db_models import get_session, AuditLog
from pydantic import BaseModel
from datetime import datetime

router = APIRouter(prefix="/api/audit", tags=["Audit Trail"])

class AuditLogResponse(BaseModel):
    id: int
    timestamp: datetime
    action: str
    target_type: Optional[str]
    target_id: Optional[str]
    agent: str
    status: str
    details: Optional[dict]
    document_hash: Optional[str]
    previous_hash: Optional[str]
    entry_hash: Optional[str]

    class Config:
        from_attributes = True

@router.get("/logs", response_model=List[AuditLogResponse])
async def get_audit_logs(limit: int = 100, offset: int = 0):
    """Get audit logs for compliance review"""
    session = get_session()
    try:
        logs = session.query(AuditLog).order_by(AuditLog.id.desc()).offset(offset).limit(limit).all()
        return logs
    finally:
        session.close()

@router.get("/verify-integrity")
async def verify_integrity():
    """Verify the cryptographic chain of the audit trail"""
    session = get_session()
    try:
        logs = session.query(AuditLog).order_by(AuditLog.id.asc()).all()
        
        if not logs:
            return {"status": "verified", "message": "No logs to verify"}
        
        # Simple chain verification
        integrity_errors = []
        expected_previous_hash = "0" * 64
        
        for log in logs:
            if log.previous_hash != expected_previous_hash:
                integrity_errors.append(f"Broken chain at ID {log.id}: Expected previous hash {expected_previous_hash}, but found {log.previous_hash}")
            expected_previous_hash = log.entry_hash
            
        if integrity_errors:
            return {"status": "failed", "errors": integrity_errors}
        
        return {"status": "verified", "message": f"Successfully verified chain of {len(logs)} records"}
    finally:
        session.close()
