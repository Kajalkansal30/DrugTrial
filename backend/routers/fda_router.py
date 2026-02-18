"""
FDA Form Processing API Router
Endpoints for uploading PDFs, extracting forms, reviewing, and e-signing
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, date
import os
import shutil
import json

from sqlalchemy.orm import Session

# Import from project root
from backend.db_models import get_session, FDADocument, FDAForm1571, FDAForm1572, ClinicalTrial, EligibilityCriteria
from backend.agents.fda_processor import FDAProcessor
from backend.utils.auditor import Auditor

router = APIRouter()

# Singleton FDAProcessor to avoid re-loading NLP models per request
_fda_processor = None

def _get_fda_processor():
    global _fda_processor
    if _fda_processor is None:
        print("⏳ Initializing FDAProcessor singleton...")
        _fda_processor = FDAProcessor()
        print("✅ FDAProcessor singleton ready")
    return _fda_processor

# Pydantic models
class FormUpdateRequest(BaseModel):
    form_type: str  # "1571" or "1572"
    updates: Dict[str, Any]

class ReviewRequest(BaseModel):
    reviewed_by: str

class SignatureRequest(BaseModel):
    signer_name: str
    signer_role: str
    ip_address: Optional[str] = None

class TestRequest(BaseModel):
    text: str


@router.post("/upload")
async def upload_and_process_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """
    Upload PDF and kick off background processing.
    Returns immediately with document_id; frontend polls /status/{id}.
    """
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    upload_dir = "uploads/fda_documents"
    os.makedirs(upload_dir, exist_ok=True)

    file_path = os.path.join(upload_dir, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    import hashlib
    with open(file_path, "rb") as fh:
        file_hash = hashlib.sha256(fh.read()).hexdigest()

    session = get_session()
    try:
        doc = FDADocument(
            filename=file.filename,
            file_hash=file_hash,
            status='processing',
            processed_at=None,
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)
        doc_id = doc.id
    finally:
        session.close()

    _processing_status[doc_id] = {
        "step": "queued",
        "logs": ["Uploaded — queued for processing"],
        "progress": 5,
    }

    background_tasks.add_task(_run_fda_extraction, doc_id, file.filename, file_path)

    return {
        "success": True,
        "document_id": doc_id,
        "filename": file.filename,
        "status": "processing",
        "message": "Upload received. Processing started in background.",
    }


# In-memory processing status (keyed by document_id)
_processing_status: Dict[int, Dict[str, Any]] = {}


@router.get("/status/{document_id}")
async def get_processing_status(document_id: int):
    """Poll this endpoint to track background processing progress."""
    status = _processing_status.get(document_id)
    if status:
        return status

    session = get_session()
    try:
        doc = session.query(FDADocument).filter_by(id=document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        if doc.status == 'extracted':
            return {
                "step": "done",
                "progress": 100,
                "logs": ["FDA forms extracted — ready for review"],
                "document_id": document_id,
            }
        if doc.status == 'failed':
            return {"step": "error", "progress": 0, "logs": ["Processing failed"]}
        return {"step": "processing", "progress": 10, "logs": ["Processing..."]}
    finally:
        session.close()


def _update_status(doc_id: int, step: str, log_msg: str, progress: int, **extra):
    entry = _processing_status.setdefault(doc_id, {"step": step, "logs": [], "progress": 0})
    entry["step"] = step
    entry["progress"] = progress
    entry["logs"].append(log_msg)
    entry.update(extra)


def _run_fda_extraction(doc_id: int, filename: str, file_path: str):
    """Background: extract FDA forms from PDF and save to DB. Nothing else."""
    import logging
    logger = logging.getLogger("fda_bg")

    session = get_session()
    try:
        auditor = Auditor(session)

        _update_status(doc_id, "extracting", "📄 Extracting FDA forms from PDF...", 10)
        processor = _get_fda_processor()

        def log_cb(msg):
            _update_status(doc_id, "extracting", msg, min(80, _processing_status[doc_id]["progress"] + 8))

        result = processor.process_pdf(file_path, log_callback=log_cb)

        auditor.log(
            action="FDA Form Extraction", agent="SafetyReportingAgent v2.1",
            target_type="document", target_id=filename, status="Success",
            details={"ind_number": result.get('fda_1571', {}).get('ind_number'),
                      "protocol_title": result.get('fda_1571', {}).get('protocol_title')},
            document_hash=result.get('document_hash'),
        )

        _update_status(doc_id, "saving", "💾 Saving extracted forms...", 85)

        doc = session.query(FDADocument).filter_by(id=doc_id).first()
        doc.file_hash = result['document_hash']
        doc.status = 'extracted'
        doc.processed_at = datetime.utcnow()

        form_1571_data = result['fda_1571']
        form_1571 = FDAForm1571(
            document_id=doc_id,
            **{k: v for k, v in form_1571_data.items() if k != 'cross_reference_inds'},
            cross_reference_inds=form_1571_data.get('cross_reference_inds', []),
            extraction_metadata={'validation': result['validation']['form_1571'],
                                  'processed_at': result['metadata']['processed_at']},
        )
        session.add(form_1571)

        form_1572_data = result['fda_1572']
        form_1572 = FDAForm1572(
            document_id=doc_id,
            **{k: v for k, v in form_1572_data.items()
               if k not in ['study_sites', 'sub_investigators', 'clinical_laboratories']},
            study_sites=form_1572_data.get('study_sites', []),
            sub_investigators=form_1572_data.get('sub_investigators', []),
            clinical_laboratories=form_1572_data.get('clinical_laboratories', []),
            extraction_metadata={'validation': result['validation']['form_1572'],
                                  'processed_at': result['metadata']['processed_at']},
        )
        session.add(form_1572)
        session.commit()

        _update_status(doc_id, "done", "✅ FDA forms extracted — ready for review", 100,
                        document_id=doc_id)

    except Exception as e:
        logger.exception("FDA extraction failed for doc %s", doc_id)
        session.rollback()
        try:
            doc = session.query(FDADocument).filter_by(id=doc_id).first()
            if doc:
                doc.status = 'failed'
                session.commit()
        except Exception:
            pass
        try:
            Auditor(session).log(
                action="FDA Form Extraction", agent="SafetyReportingAgent v2.1",
                target_type="document", target_id=filename, status="Failure",
                details={"error": str(e)},
            )
        except Exception:
            pass
        _update_status(doc_id, "error", f"❌ {str(e)}", 0)
    finally:
        session.close()


@router.get("/documents")
async def list_documents(session: Session = Depends(get_session)):
    """
    List all processed FDA documents
    """
    try:
        documents = session.query(FDADocument).order_by(FDADocument.upload_date.desc()).all()
        
        result = []
        for doc in documents:
            result.append({
                "id": doc.id,
                "filename": doc.filename,
                "upload_date": doc.upload_date.isoformat() if doc.upload_date else None,
                "status": doc.status,
                "processed_at": doc.processed_at.isoformat() if doc.processed_at else None,
                "reviewed_at": doc.reviewed_at.isoformat() if doc.reviewed_at else None,
                "reviewed_by": doc.reviewed_by,
                "signed_at": doc.signed_at.isoformat() if doc.signed_at else None,
                "signed_by": doc.signed_by
            })
        
        return {
            "documents": result,
            "count": len(result)
        }
    finally:
        session.close()


@router.get("/forms/{document_id}")
async def get_forms(document_id: int, session: Session = Depends(get_session)):
    """
    Get extracted form data for a document
    """
    try:
        doc = session.query(FDADocument).filter_by(id=document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        
        form_1571 = session.query(FDAForm1571).filter_by(document_id=document_id).first()
        form_1572 = session.query(FDAForm1572).filter_by(document_id=document_id).first()
        
        # Convert to dict
        def model_to_dict(model):
            if not model:
                return {}
            return {c.name: getattr(model, c.name) for c in model.__table__.columns}
        
        # Look up associated trial for context
        trial = session.query(ClinicalTrial).filter_by(document_id=document_id).first()
        trial_context = None
        if trial:
            trial_context = {
                "trial_id": trial.trial_id,
                "db_id": trial.id,
                "status": trial.status,
                "indication": trial.indication,
                "drug_name": trial.drug_name,
                "has_ltaa": bool(trial.analysis_results and trial.analysis_results.get('ltaa')),
                "has_insilico": bool(trial.analysis_results and trial.analysis_results.get('insilico')),
                "analysis_status": trial.analysis_status or "pending",
            }
        
        return {
            "document": {
                "id": doc.id,
                "filename": doc.filename,
                "status": doc.status,
                "upload_date": doc.upload_date.isoformat() if doc.upload_date else None,
                "reviewed_at": doc.reviewed_at.isoformat() if doc.reviewed_at else None,
                "reviewed_by": doc.reviewed_by,
                "signed_at": doc.signed_at.isoformat() if doc.signed_at else None,
                "signed_by": doc.signed_by,
                "signature_data": json.loads(doc.signature_data) if doc.signature_data else None
            },
            "fda_1571": model_to_dict(form_1571),
            "fda_1572": model_to_dict(form_1572),
            "trial": trial_context
        }
    finally:
        session.close()


@router.put("/forms/{document_id}")
async def update_form(
    document_id: int,
    request: FormUpdateRequest,
    session: Session = Depends(get_session)
):
    """
    Update form fields (only allowed if status is 'extracted')
    """
    try:
        doc = session.query(FDADocument).filter_by(id=document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        
        if doc.status != 'extracted':
            raise HTTPException(
                status_code=400,
                detail=f"Cannot edit form with status '{doc.status}'. Only 'extracted' forms can be edited."
            )
        
        # Update the appropriate form
        if request.form_type == "1571":
            form = session.query(FDAForm1571).filter_by(document_id=document_id).first()
        elif request.form_type == "1572":
            form = session.query(FDAForm1572).filter_by(document_id=document_id).first()
        else:
            raise HTTPException(status_code=400, detail="Invalid form_type. Must be '1571' or '1572'")
        
        if not form:
            raise HTTPException(status_code=404, detail=f"Form {request.form_type} not found")
        
        # Apply updates
        for key, value in request.updates.items():
            if hasattr(form, key):
                setattr(form, key, value)
        
        form.updated_at = datetime.utcnow()
        session.commit()
        
        return {
            "success": True,
            "message": f"Form {request.form_type} updated successfully",
            "updated_fields": list(request.updates.keys())
        }
        
    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"Update failed: {str(e)}")
    finally:
        session.close()


@router.post("/forms/{document_id}/review")
async def mark_as_reviewed(
    document_id: int,
    request: ReviewRequest,
    session: Session = Depends(get_session)
):
    """
    Mark document as reviewed
    Changes status to 'reviewed' and records reviewer
    """
    try:
        doc = session.query(FDADocument).filter_by(id=document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        
        if doc.status == 'reviewed' or doc.status == 'signed':
            return {
                "success": True,
                "message": "Document is already reviewed",
                "status": doc.status,
                "reviewed_at": doc.reviewed_at.isoformat() if doc.reviewed_at else None,
                "reviewed_by": doc.reviewed_by
            }
            
        if doc.status != 'extracted':
            raise HTTPException(
                status_code=400,
                detail=f"Cannot review document with status '{doc.status}'"
            )
        
        doc.status = 'reviewed'
        doc.reviewed_at = datetime.utcnow()
        doc.reviewed_by = request.reviewed_by
        
        session.commit()
        
        return {
            "success": True,
            "message": "Document marked as reviewed",
            "status": "reviewed",
            "reviewed_at": doc.reviewed_at.isoformat(),
            "reviewed_by": doc.reviewed_by
        }
        
    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"Review failed: {str(e)}")
    finally:
        session.close()


@router.post("/forms/{document_id}/sign")
async def sign_document(
    document_id: int,
    request: SignatureRequest,
    session: Session = Depends(get_session)
):
    """
    E-sign document and lock all fields
    Changes status to 'signed'
    """
    try:
        doc = session.query(FDADocument).filter_by(id=document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        
        if doc.status == 'signed':
            return {
                "success": True,
                "message": "Document is already signed",
                "status": "signed",
                "signed_at": doc.signed_at.isoformat() if doc.signed_at else None,
                "signed_by": doc.signed_by,
                "signature": json.loads(doc.signature_data) if doc.signature_data else None
            }
            
        if doc.status != 'reviewed':
            raise HTTPException(
                status_code=400,
                detail=f"Cannot sign document with status '{doc.status}'. Document must be reviewed first."
            )
        
        # Create signature data
        signature_data = {
            "signer_name": request.signer_name,
            "signer_role": request.signer_role,
            "timestamp": datetime.utcnow().isoformat(),
            "ip_address": request.ip_address,
            "document_hash": doc.file_hash
        }
        
        doc.status = 'signed'
        doc.signed_at = datetime.utcnow()
        doc.signed_by = request.signer_name
        doc.signature_data = json.dumps(signature_data)
        
        session.commit()
        
        return {
            "success": True,
            "message": "Document signed successfully",
            "status": "signed",
            "signed_at": doc.signed_at.isoformat(),
            "signed_by": doc.signed_by,
            "signature": signature_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"Signing failed: {str(e)}")
    finally:
        session.close()


@router.delete("/documents/{document_id}")
async def delete_document(document_id: int, session: Session = Depends(get_session)):
    """
    Delete a document and its associated forms
    Only allowed if status is 'extracted' (not reviewed or signed)
    """
    try:
        doc = session.query(FDADocument).filter_by(id=document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        
        if doc.status in ['reviewed', 'signed']:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot delete document with status '{doc.status}'"
            )
        
        # Delete associated forms
        session.query(FDAForm1571).filter_by(document_id=document_id).delete()
        session.query(FDAForm1572).filter_by(document_id=document_id).delete()
        
        # Delete document
        filename = doc.filename
        session.delete(doc)
        session.commit()
        
        # Delete file from filesystem
        file_path = f"uploads/fda_documents/{filename}"
        if os.path.exists(file_path):
            os.remove(file_path)
        
        return {
            "success": True,
            "message": "Document deleted successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"Deletion failed: {str(e)}")
    finally:
        session.close()


# -----------------------------------------------------------------------------
# BRIDGE ENDPOINT: Create Clinical Trial from FDA Document
# -----------------------------------------------------------------------------

from backend.db_models import ClinicalTrial, EligibilityCriteria
from backend.agents.protocol_rule_agent import ProtocolRuleAgent

# Lazy-load agent to prevent startup hang
_nlp_agent = None

def get_nlp_agent():
    global _nlp_agent
    if _nlp_agent is None:
        try:
            print("⏳ Initializing ProtocolRuleAgent (Lazy)...")
            _nlp_agent = ProtocolRuleAgent()
            print("✅ ProtocolRuleAgent initialized")
        except Exception as e:
            print(f"❌ Error initializing ProtocolRuleAgent: {e}")
    return _nlp_agent

@router.post("/test-criteria")
async def test_criteria(request: TestRequest):
    """
    Test eligibility criteria extraction against the live NLP agent.
    Avoids reloading the NLP model for every test.
    """
    agent = get_nlp_agent()
    if not agent:
        raise HTTPException(status_code=503, detail="NLP Agent not initialized")
    
    try:
        results = agent.extract_rules(request.text)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/documents/{document_id}/create-trial")
async def create_trial_from_document(
    document_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """
    Create a ClinicalTrial record from a processed FDA document (DB only, fast).
    Criteria extraction and analysis happen in later steps.
    """
    auditor = Auditor(session)
    try:
        doc = session.query(FDADocument).filter_by(id=document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        existing_trial = session.query(ClinicalTrial).filter_by(document_id=document_id).first()
        if existing_trial:
            return {
                "success": True,
                "trial_id": existing_trial.trial_id,
                "db_id": existing_trial.id,
                "message": "Trial already exists for this document",
                "is_existing": True
            }

        form_1571 = session.query(FDAForm1571).filter_by(document_id=document_id).first()
        form_1572 = session.query(FDAForm1572).filter_by(document_id=document_id).first()

        protocol_title = "Untitled Protocol"
        phase = "Unknown"
        drug_name = "Unknown"
        indication = "Unknown"

        if form_1571:
            protocol_title = form_1571.protocol_title or protocol_title
            phase = form_1571.study_phase or phase
            drug_name = form_1571.drug_name or drug_name
            indication = form_1571.indication or indication
        elif form_1572:
            protocol_title = form_1572.protocol_title or protocol_title

        import uuid
        trial_uid = f"TRIAL_{doc.filename[:4]}_{uuid.uuid4().hex[:4]}".replace(" ", "_").upper()

        def model_to_dict(model):
            if not model:
                return {}
            data = {}
            for c in model.__table__.columns:
                if c.name == 'document':
                    continue
                val = getattr(model, c.name)
                if isinstance(val, (datetime, date)):
                    val = val.isoformat()
                data[c.name] = val
            return data

        new_trial = ClinicalTrial(
            trial_id=trial_uid,
            protocol_title=protocol_title,
            phase=phase,
            indication=indication,
            drug_name=drug_name,
            status="Pending Criteria",
            document_id=document_id,
            fda_1571=model_to_dict(form_1571),
            fda_1572=model_to_dict(form_1572),
            analysis_status="pending",
        )
        session.add(new_trial)
        session.commit()
        session.refresh(new_trial)

        auditor.log(
            action="Trial Created from FDA Document",
            agent="SafetyReportingAgent v2.1",
            target_type="trial",
            target_id=new_trial.trial_id,
            status="Success",
            details={"document_id": document_id, "filename": doc.filename},
        )

        background_tasks.add_task(
            _trigger_analysis_for_trial,
            new_trial.trial_id, new_trial.id, indication, drug_name, document_id
        )

        return {
            "success": True,
            "trial_id": new_trial.trial_id,
            "db_id": new_trial.id,
            "message": "Trial created — analysis starting in background",
        }

    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create trial: {str(e)}")
    finally:
        session.close()


def _trigger_analysis_for_trial(trial_id: str, trial_db_id: int, indication: str, drug_name: str, document_id: int):
    """Fire TRIAL_CREATED event so the orchestrator runs LTAA + InSilico in background."""
    import logging
    logger = logging.getLogger("fda_auto_analysis")
    try:
        from backend.events import event_bus
        trial_event = {
            "trial_id": trial_id,
            "db_id": trial_db_id,
            "indication": indication,
            "drug_name": drug_name,
            "document_id": document_id,
        }
        logger.info(f"Auto-triggering LTAA + InSilico for {trial_id}")
        event_bus.publish("TRIAL_CREATED", trial_event)
    except Exception as e:
        logger.error(f"Failed to auto-trigger analysis for {trial_id}: {e}")
