import hashlib
import json
from datetime import datetime
from sqlalchemy.orm import Session
from backend.db_models import AuditLog

class Auditor:
    def __init__(self, db: Session):
        self.db = db

    def _calculate_hash(self, content: dict) -> str:
        """Calculate SHA-256 hash of a dictionary"""
        serialized = json.dumps(content, sort_keys=True, default=str).encode('utf-8')
        return hashlib.sha256(serialized).hexdigest()

    def log(self, action: str, agent: str, target_type: str = None, target_id: str = None, 
            status: str = "Success", details: dict = None, document_hash: str = None):
        """Create a new, chained audit log entry"""
        
        # 1. Get the hash of the most recent log entry
        last_entry = self.db.query(AuditLog).order_by(AuditLog.id.desc()).first()
        previous_hash = last_entry.entry_hash if last_entry else "0" * 64
        
        # 2. Prepare the new entry (without its own hash yet)
        timestamp = datetime.utcnow()
        entry_content = {
            "timestamp": timestamp,
            "action": action,
            "agent": agent,
            "target_type": target_type,
            "target_id": target_id,
            "status": status,
            "details": details,
            "document_hash": document_hash,
            "previous_hash": previous_hash
        }
        
        # 3. Calculate this entry's unique hash
        entry_hash = self._calculate_hash(entry_content)
        
        # 4. Create database record
        new_log = AuditLog(
            timestamp=timestamp,
            action=action,
            agent=agent,
            target_type=target_type,
            target_id=target_id,
            status=status,
            details=details,
            document_hash=document_hash,
            previous_hash=previous_hash,
            entry_hash=entry_hash
        )
        
        self.db.add(new_log)
        self.db.commit()
        return new_log

    @staticmethod
    def calculate_file_hash(file_path: str) -> str:
        """Calculate SHA-256 hash of a file"""
        sha256_hash = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                for byte_block in iter(lambda: f.read(4096), b""):
                    sha256_hash.update(byte_block)
            return sha256_hash.hexdigest()
        except Exception:
            return None
