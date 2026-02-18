"""
Main FastAPI Application
Drug Trial Automation System - Standalone Version
Run with: uvicorn app:app --reload
"""
import os
import sys
from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from backend.db_models import (
    get_session, Patient, Condition, Medication, Observation,
    Allergy, Immunization, PatientEligibility, ClinicalTrial, EligibilityCriteria
)
from backend.routers import (
    fda_router, trials, audit_router, privacy_router,
    ltaa_router, insilico_router, chat_router
)
from backend.utils.auditor import Auditor

app = FastAPI(
    title="Drug Trial Automation API",
    description="End-to-end automated drug trial system",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost",
        "http://127.0.0.1:3000",
        "https://ai.veersalabs.com"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Track model readiness for health checks
_models_ready = False


@app.on_event("startup")
async def startup_event():
    """Pre-load ALL heavy models on startup to avoid first-request delay."""
    import threading

    def pre_warm():
        global _models_ready
        print("🚀 [STARTUP] Pre-warming ALL models and agents...")
        try:
            from backend.nlp_utils import get_nlp, get_llm

            # 1. Load all NLP model variants
            print("  ⏳ Loading en_core_sci_lg (basic)...")
            get_nlp("en_core_sci_lg", load_linker=False)
            print("  ✅ en_core_sci_lg loaded")

            print("  ⏳ Loading en_core_web_sm...")
            get_nlp("en_core_web_sm", load_linker=False)
            print("  ✅ en_core_web_sm loaded")

            # 2. Warm up LLM connection (first call is slow)
            print("  ⏳ Warming up Ollama LLM...")
            llm = get_llm()
            try:
                llm.invoke("Hello")
            except Exception as e:
                print(f"  ⚠️ LLM warm-up call failed (Ollama may still be starting): {e}")
            print("  ✅ LLM connection established")

            # 3. Pre-initialize key agents (loads models into their singletons)
            print("  ⏳ Pre-initializing FDAProcessor...")
            from backend.routers.fda_router import _get_fda_processor
            _get_fda_processor()
            print("  ✅ FDAProcessor ready")

            print("  ⏳ Pre-initializing ProtocolRuleAgent...")
            from backend.routers.trials import get_nlp_agent
            get_nlp_agent()
            print("  ✅ ProtocolRuleAgent ready")

            _models_ready = True
            print("✅ [STARTUP] ALL models pre-warmed and ready!")

        except Exception as e:
            print(f"⚠️ [STARTUP] Pre-warm failed: {e}")
            _models_ready = True  # Allow traffic even if some models failed

    thread = threading.Thread(target=pre_warm)
    thread.start()

    # Initialize Orchestrator and Subscribe to Events
    try:
        from backend.agents.orchestrator import TrialOrchestrator
        from backend.events import event_bus
        orchestrator = TrialOrchestrator()
        event_bus.subscribe("TRIAL_CREATED", orchestrator.handle_new_trial)
        print("✅ [STARTUP] TrialOrchestrator subscribed to TRIAL_CREATED")
    except Exception as e:
        print(f"⚠️ [STARTUP] Failed to initialize Orchestrator: {e}")


# Include routers
app.include_router(fda_router.router, prefix="/api/fda", tags=["FDA Forms"])
app.include_router(audit_router.router)
app.include_router(privacy_router.router)
app.include_router(trials.router)
app.include_router(ltaa_router.router)
app.include_router(insilico_router.router)
app.include_router(chat_router.router)


# Pydantic Models
class PatientResponse(BaseModel):
    id: str
    birthdate: str
    gender: str

class BatchEligibilityRequest(BaseModel):
    patient_ids: List[str]
    trial_id: int

class EligibilityRequest(BaseModel):
    patient_id: str
    trial_id: int

class TrialCreate(BaseModel):
    trial_id: str
    protocol_title: str
    phase: str
    indication: str
    drug_name: str


# Routes
@app.get("/")
async def root():
    return {
        "message": "Drug Trial Automation API",
        "version": "1.0.0",
        "status": "running",
        "endpoints": [
            "/patients",
            "/patients/{patient_id}",
            "/trials",
            "/eligibility/check",
            "/fda/extract",
            "/api/fda/upload",
            "/api/fda/documents",
            "/api/fda/forms/{document_id}"
        ]
    }

@app.get("/health")
async def health_check():
    """Health check with model readiness status"""
    return {
        "status": "healthy",
        "models_ready": _models_ready
    }

@app.get("/health/models")
async def model_readiness():
    """Detailed model readiness check"""
    from backend.nlp_utils import _shared_nlp, _shared_llm
    return {
        "models_ready": _models_ready,
        "nlp_models_loaded": list(_shared_nlp.keys()),
        "llm_connected": _shared_llm is not None
    }

@app.get("/api/patients")
async def get_patients(limit: int = 100):
    """Get all patients (de-identified -- no PII returned)"""
    session = get_session()
    try:
        patients = session.query(Patient).limit(limit).all()
        result = [
            {
                "id": p.id,
                "birthdate": str(p.birthdate),
                "gender": p.gender,
                "age_group": p.age_group,
                "city": "REDACTED" if p.is_deidentified else p.city,
                "state": p.state,
                "is_deidentified": p.is_deidentified or False,
            }
            for p in patients
        ]
        return {"patients": result, "count": len(result)}
    finally:
        session.close()

@app.get("/api/patients/{patient_id}")
async def get_patient_details(patient_id: str):
    """Get detailed patient information"""
    session = get_session()
    try:
        patient = session.query(Patient).filter_by(id=patient_id).first()
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")

        conditions = session.query(Condition).filter_by(patient_id=patient_id).all()
        medications = session.query(Medication).filter_by(patient_id=patient_id).all()
        observations = session.query(Observation).filter_by(patient_id=patient_id).all()
        allergies = session.query(Allergy).filter_by(patient_id=patient_id).all()
        immunizations = session.query(Immunization).filter_by(patient_id=patient_id).all()

        return {
            "patient": {
                "id": patient.id,
                "birthdate": str(patient.birthdate),
                "gender": patient.gender,
                "race": patient.race,
                "age_group": patient.age_group,
                "city": "REDACTED" if patient.is_deidentified else patient.city,
                "state": patient.state,
                "is_deidentified": patient.is_deidentified or False,
            },
            "conditions": [
                {"code": c.code, "description": c.description, "start_date": str(c.start_date)}
                for c in conditions
            ],
            "medications": [
                {"code": m.code, "description": m.description, "start_date": str(m.start_date)}
                for m in medications
            ],
            "observations": [
                {"code": o.code, "description": o.description, "value": o.value,
                 "units": o.units, "date": str(o.observation_date)}
                for o in observations
            ],
            "allergies": [
                {"code": a.code, "description": a.description, "type": a.allergy_type,
                 "category": a.category, "reaction": a.reaction1, "severity": a.severity1}
                for a in allergies
            ],
            "immunizations": [
                {"code": i.code, "description": i.description, "date": str(i.immunization_date)}
                for i in immunizations
            ]
        }
    finally:
        session.close()

@app.get("/api/trials")
async def get_trials():
    """Get all clinical trials"""
    session = get_session()
    try:
        trials_list = session.query(ClinicalTrial).all()
        result = [
            {
                "id": t.id,
                "trial_id": t.trial_id,
                "protocol_title": t.protocol_title,
                "phase": t.phase,
                "indication": t.indication,
                "drug_name": t.drug_name,
                "status": t.status,
                "analysis_status": t.analysis_status or "pending"
            }
            for t in trials_list
        ]
        return {"trials": result, "count": len(result)}
    finally:
        session.close()

@app.post("/api/trials")
async def create_trial(trial: TrialCreate):
    """Create a new clinical trial"""
    session = get_session()

    existing = session.query(ClinicalTrial).filter_by(trial_id=trial.trial_id).first()
    if existing:
        session.close()
        raise HTTPException(status_code=400, detail="Trial ID already exists")

    new_trial = ClinicalTrial(
        trial_id=trial.trial_id,
        protocol_title=trial.protocol_title,
        phase=trial.phase,
        indication=trial.indication,
        drug_name=trial.drug_name,
        status="active"
    )

    session.add(new_trial)
    session.commit()

    auditor = Auditor(session)
    auditor.log(
        action="Trial Created",
        agent="SystemAdmin",
        target_type="trial",
        target_id=new_trial.trial_id,
        status="Success",
        details={
            "protocol_title": trial.protocol_title,
            "phase": trial.phase,
            "drug_name": trial.drug_name
        }
    )

    result = {
        "id": new_trial.id,
        "trial_id": new_trial.trial_id,
        "message": "Trial created successfully"
    }

    session.close()
    return result

@app.post("/api/eligibility/batch-check")
async def batch_check_eligibility(request: BatchEligibilityRequest):
    """Check eligibility for multiple patients (Optimized)"""
    from backend.agents.eligibility_matcher import EligibilityMatcher

    session = get_session()
    try:
        matcher = EligibilityMatcher(db_session=session)
        results = matcher.evaluate_batch(request.patient_ids, request.trial_id)

        existing_records = session.query(PatientEligibility).filter(
            PatientEligibility.trial_id == request.trial_id,
            PatientEligibility.patient_id.in_(request.patient_ids)
        ).all()

        existing_map = {r.patient_id: r for r in existing_records}

        for pid, res in results.items():
            is_eligible = res['eligible']
            confidence = res['confidence']
            status = 'eligible' if is_eligible else 'not_eligible'

            if pid in existing_map:
                rec = existing_map[pid]
                rec.eligibility_status = status
                rec.confidence_score = confidence
                rec.evaluation_date = datetime.utcnow()
            else:
                new_rec = PatientEligibility(
                    patient_id=pid,
                    trial_id=request.trial_id,
                    eligibility_status=status,
                    confidence_score=confidence,
                    evaluation_date=datetime.utcnow()
                )
                session.add(new_rec)

        session.commit()

        auditor = Auditor(session)
        auditor.log(
            action="Batch Eligibility Check",
            agent="SafetyReportingAgent v2.1",
            target_type="trial",
            target_id=str(request.trial_id),
            status="Success",
            details={
                "patient_count": len(request.patient_ids),
                "eligible_count": sum(1 for r in results.values() if r['eligible'])
            }
        )

        return {"results": results}

    except Exception as e:
        session.rollback()
        print(f"Batch check error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

@app.post("/api/eligibility/check")
async def check_eligibility(request: EligibilityRequest):
    """Check patient eligibility for a trial"""
    from backend.agents.eligibility_matcher import EligibilityMatcher

    session = get_session()
    try:
        matcher = EligibilityMatcher(db_session=session)
        result = matcher.evaluate_eligibility(request.patient_id, request.trial_id)

        existing_record = session.query(PatientEligibility).filter_by(
            patient_id=request.patient_id,
            trial_id=request.trial_id
        ).first()

        if existing_record:
            existing_record.eligibility_status = 'eligible' if result['eligible'] else 'not_eligible'
            existing_record.confidence_score = result['confidence']
            existing_record.evaluation_date = datetime.utcnow()
        else:
            eligibility_record = PatientEligibility(
                patient_id=request.patient_id,
                trial_id=request.trial_id,
                eligibility_status='eligible' if result['eligible'] else 'not_eligible',
                confidence_score=result['confidence']
            )
            session.add(eligibility_record)

        session.commit()

        auditor = Auditor(session)
        auditor.log(
            action="Eligibility Check",
            agent="SafetyReportingAgent v2.1",
            target_type="patient",
            target_id=request.patient_id,
            status="Success",
            details={
                "trial_id": request.trial_id,
                "eligible": result['eligible'],
                "confidence": result['confidence']
            }
        )

        return {
            "patient_id": request.patient_id,
            "trial_id": request.trial_id,
            "eligibility_status": 'eligible' if result['eligible'] else 'not_eligible',
            "confidence_score": result['confidence'],
            "reasons": result['reasons']
        }
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()

@app.post("/api/fda/extract")
async def extract_fda_forms(pdf_filename: str = "2.pdf"):
    """Extract FDA form data from drug documentation PDF"""
    pdf_path = f"data/drug/{pdf_filename}"

    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail=f"PDF file not found: {pdf_path}")

    file_hash = Auditor.calculate_file_hash(pdf_path)

    from backend.routers.fda_router import _get_fda_processor
    extractor = _get_fda_processor()
    result = extractor.process_pdf(pdf_path)

    session = get_session()
    auditor = Auditor(session)

    if 'error' in result:
        auditor.log(
            action="FDA Form Extraction",
            agent="SafetyReportingAgent v2.1",
            target_type="document",
            target_id=pdf_filename,
            status="Failure",
            details={"error": result['error']},
            document_hash=file_hash
        )
        session.close()
        raise HTTPException(status_code=500, detail=result['error'])

    auditor.log(
        action="FDA Form Extraction",
        agent="SafetyReportingAgent v2.1",
        target_type="document",
        target_id=pdf_filename,
        status="Success",
        details={
            "ind_number": result.get('fda_1571', {}).get('ind_number'),
            "protocol_title": result.get('fda_1571', {}).get('protocol_title')
        },
        document_hash=file_hash
    )
    session.close()

    validation_1571 = result['validation']['form_1571']
    validation_1572 = result['validation']['form_1572']

    return {
        "fda_1571": result['fda_1571'],
        "fda_1572": result['fda_1572'],
        "validation": {
            "form_1571": validation_1571,
            "form_1572": validation_1572
        }
    }

@app.post("/api/data/import")
async def import_data():
    """Import patient data from CSV files"""
    from import_data import import_all_data

    try:
        import_all_data()
        return {"message": "Data import completed successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stats")
async def get_stats():
    """Get system statistics"""
    session = get_session()

    stats = {
        "total_patients": session.query(Patient).count(),
        "total_conditions": session.query(Condition).count(),
        "total_trials": session.query(ClinicalTrial).count(),
        "total_eligibility_checks": session.query(PatientEligibility).count()
    }

    session.close()
    return stats

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8201))
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=port,
        timeout_keep_alive=600,  # 10 minutes for long-running uploads
        timeout_graceful_shutdown=30
    )
