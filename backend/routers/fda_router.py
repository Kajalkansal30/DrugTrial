"""
FDA Form Processing API Router
Endpoints for uploading PDFs, extracting forms, reviewing, and e-signing
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, date
import os
import shutil
import json

from sqlalchemy.orm import Session

# Import from project root
from backend.db_models import get_session, FDADocument, FDAForm1571, FDAForm1572
from backend.agents.fda_processor import FDAProcessor
from backend.utils.auditor import Auditor

router = APIRouter()

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
    file: UploadFile = File(...),
    session: Session = Depends(get_session)
):
    """
    Upload PDF and extract FDA forms with real-time logging
    Returns: StreamingResponse (NDJSON)
    """
    auditor = Auditor(session)
    
    # Validate file type
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    # Create uploads directory if it doesn't exist
    upload_dir = "uploads/fda_documents"
    os.makedirs(upload_dir, exist_ok=True)
    
    # Save uploaded file
    file_path = os.path.join(upload_dir, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    from fastapi.responses import StreamingResponse
    import json
    
    # Create global or request-scoped processor once
    processor = FDAProcessor()
    
    async def process_stream():
        try:
            yield json.dumps({"type": "log", "message": f"🚀 Starting processing for {file.filename}..."}) + "\n"
            
            # Define callback to yield logs
            # Note: synchronous generator inside async wrapper works for simple cases, 
            # but for true non-blocking we'd need threadpool. 
            # For this scale, slight blocking is acceptable as we yield between steps.
            
            logs_queue = []
            def log_callback(msg):
                logs_queue.append(msg)
                
            # Run processing (this will block, but we can't yield from inside the callback easily without threads)
            # Better approach: We yield "Starting...", run the whole thing, then yield result.
            # To get real streaming, we need to break down the processor steps here OR use a thread.
            # Let's use the breaking down approach since we exposed granularity (or can just use the provided callback hooks)
            
            # ACTUALLY, since we modified FDAProcessor to take a callback, we can capture them.
            # But yielding requires control flow. 
            # Simple solution: Run in thread, put logs in queue, yield from queue.
            
            import queue
            import threading
            
            q = queue.Queue()
            result_container = {}
            error_container = {}
            
            def worker():
                try:
                    def cb(msg):
                        q.put({"type": "log", "message": msg})
                    
                    res = processor.process_pdf(file_path, log_callback=cb)
                    result_container['data'] = res
                except Exception as e:
                    error_container['error'] = str(e)
                finally:
                    q.put(None) # Signal done
            
            t = threading.Thread(target=worker)
            t.start()
            
            while True:
                # Non-blocking check or short timeout
                try:
                    item = q.get(timeout=0.1)
                    if item is None:
                        break
                    yield json.dumps(item) + "\n"
                except queue.Empty:
                    if not t.is_alive():
                        break
                    import asyncio
                    await asyncio.sleep(0.01)
            
            t.join()
            
            if 'error' in error_container:
                yield json.dumps({"type": "error", "message": error_container['error']}) + "\n"
                return

            result = result_container['data']
            
            # Audit log success
            auditor.log(
                action="FDA Form Extraction",
                agent="SafetyReportingAgent v2.1",
                target_type="document",
                target_id=file.filename,
                status="Success",
                details={
                    "ind_number": result.get('fda_1571', {}).get('ind_number'),
                    "protocol_title": result.get('fda_1571', {}).get('protocol_title')
                },
                document_hash=result.get('document_hash')
            )

            # 2. Database Saving (Quick)
            yield json.dumps({"type": "log", "message": "💾 Saving results to database..."}) + "\n"
            
            # Create document record
            doc = FDADocument(
                filename=file.filename,
                file_hash=result['document_hash'],
                status='extracted',
                processed_at=datetime.utcnow()
            )
            session.add(doc)
            session.flush()
            
            # Create Form 1571 record
            form_1571_data = result['fda_1571']
            form_1571 = FDAForm1571(
                document_id=doc.id,
                **{k: v for k, v in form_1571_data.items() if k != 'cross_reference_inds'},
                cross_reference_inds=form_1571_data.get('cross_reference_inds', []),
                extraction_metadata={
                    'validation': result['validation']['form_1571'],
                    'processed_at': result['metadata']['processed_at']
                }
            )
            session.add(form_1571)
            
            # Create Form 1572 record
            form_1572_data = result['fda_1572']
            form_1572 = FDAForm1572(
                document_id=doc.id,
                **{k: v for k, v in form_1572_data.items() 
                   if k not in ['study_sites', 'sub_investigators', 'clinical_laboratories']},
                study_sites=form_1572_data.get('study_sites', []),
                sub_investigators=form_1572_data.get('sub_investigators', []),
                clinical_laboratories=form_1572_data.get('clinical_laboratories', []),
                extraction_metadata={
                    'validation': result['validation']['form_1572'],
                    'processed_at': result['metadata']['processed_at']
                }
            )
            session.add(form_1572)
            
            session.commit()
            
            # 3. Final Response
            final_response = {
                "success": True,
                "document_id": doc.id,
                "filename": file.filename,
                "status": "extracted",
                "validation": result['validation'],
                "metadata": result['metadata']
            }
            yield json.dumps({"type": "result", "payload": final_response}) + "\n"
            
        except Exception as e:
            session.rollback()
            # Audit log failure
            try:
                auditor.log(
                    action="FDA Form Extraction",
                    agent="SafetyReportingAgent v2.1",
                    target_type="document",
                    target_id=file.filename,
                    status="Failure",
                    details={"error": str(e)}
                )
            except: pass
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"
        finally:
            session.close()

    return StreamingResponse(process_stream(), media_type="application/x-ndjson")


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
            "fda_1572": model_to_dict(form_1572)
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
async def create_trial_from_document(document_id: int, session: Session = Depends(get_session)):
    """
    Convert a processed FDA document into a Clinical Trial record.
    Triggers eligibility criteria extraction.
    """
    auditor = Auditor(session)
    try:
        # 1. Fetch FDA Document
        doc = session.query(FDADocument).filter_by(id=document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
            
        # IDEMPOTENCY CHECK: Check if a trial already exists for this document
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
        
        # 2. Extract Data for Trial
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
             
        # Generate a trial ID
        import uuid
        trial_uid = f"TRIAL_{doc.filename[:4]}_{uuid.uuid4().hex[:4]}".replace(" ", "_").upper()
        
        # Helper: Model to Dict with datetime to string conversion
        def model_to_dict(model):
            if not model: return {}
            data = {}
            for c in model.__table__.columns:
                if c.name == 'document': continue
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
            status="Criteria Review",
            document_id=document_id,
            fda_1571=model_to_dict(form_1571),
            fda_1572=model_to_dict(form_1572)
        )
        session.add(new_trial)
        session.commit()
        session.refresh(new_trial)
        
        # Audit log trial creation
        auditor.log(
            action="Trial Created from FDA Document",
            agent="SafetyReportingAgent v2.1",
            target_type="trial",
            target_id=new_trial.trial_id,
            status="Success",
            details={
                "document_id": document_id,
                "filename": doc.filename
            }
        )
        
        # 3. Trigger Criteria Extraction
        # Re-read PDF text
        import pdfplumber
        text = ""
        possible_paths = [
            os.path.join("/app/uploads/fda_documents", doc.filename),
            os.path.join("uploads", "fda_documents", doc.filename),
            os.path.join(os.getcwd(), "uploads", "fda_documents", doc.filename)
        ]
        
        file_path = None
        for p in possible_paths:
            if os.path.exists(p):
                file_path = p
                break
        
        if file_path:
            try:
                with pdfplumber.open(file_path) as pdf:
                    for page in pdf.pages:
                        extracted = page.extract_text()
                        if extracted: text += extracted + "\n"
            except Exception as e:
                print(f"Error re-reading PDF: {e}")
        
        agent = get_nlp_agent()
        criteria = {"inclusion": [], "exclusion": []}
        if agent and text:
            criteria = agent.extract_rules(text)
            
            for c_data in criteria.get('inclusion', []):
                text_to_save = c_data.get('source_text') or c_data.get('text')
                if not text_to_save: continue
                
                session.add(EligibilityCriteria(
                    trial_id=new_trial.id,
                    criterion_type='inclusion',
                    text=text_to_save,
                    category=c_data.get('rule_type', 'unclassified'),
                    operator=c_data.get('operator'),
                    value=str(c_data.get('value')) if c_data.get('value') is not None else None,
                    unit=c_data.get('unit'),
                    negated=c_data.get('negated', False),
                    structured_data=c_data
                ))
                
            for c_data in criteria.get('exclusion', []):
                text_to_save = c_data.get('source_text') or c_data.get('text')
                if not text_to_save: continue
                
                session.add(EligibilityCriteria(
                    trial_id=new_trial.id,
                    criterion_type='exclusion',
                    text=text_to_save,
                    category=c_data.get('rule_type', 'unclassified'),
                    operator=c_data.get('operator'),
                    value=str(c_data.get('value')) if c_data.get('value') is not None else None,
                    unit=c_data.get('unit'),
                    negated=c_data.get('negated', False),
                    structured_data=c_data
                ))
            
            session.commit()
            
        return {
            "success": True,
            "trial_id": new_trial.trial_id,
            "db_id": new_trial.id,
            "message": "Trial created and criteria extracted"
        }
        
    except Exception as e:
        session.rollback()
        print(f"Error creating trial: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create trial: {str(e)}")
    finally:
        session.close()
