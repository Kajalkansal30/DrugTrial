from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
from sqlalchemy.orm import Session
import os
import shutil
import uuid
import logging
from typing import List, Dict
from backend.db_models import get_session, Patient, ClinicalTrial, EligibilityCriteria
from backend.agents.protocol_rule_agent import ProtocolRuleAgent
from backend.agents.fda_processor import FDAProcessor
import json
import re

router = APIRouter(prefix="/api/trials", tags=["trials"])
logger = logging.getLogger(__name__)


def _clean_criterion_text(text: str) -> str:
    """Clean criterion text for UI display: normalize newlines, trim whitespace."""
    if not text:
        return text
    # Replace literal newlines with spaces, collapse multiple spaces
    cleaned = re.sub(r'\s*\n\s*', ' ', text)
    cleaned = re.sub(r'\s{2,}', ' ', cleaned)
    return cleaned.strip()


def _clean_structured_data(sd: dict) -> dict:
    """Clean structured_data for UI display: cap field length, clean newlines."""
    if not sd:
        return {}
    result = dict(sd)
    # Clean newlines from field
    if result.get('field'):
        field = re.sub(r'\s*\n\s*', ' ', str(result['field']))
        if len(field) > 60:
            field = field[:57] + "..."
        result['field'] = field
    # Clean newlines from source_text
    if result.get('source_text'):
        result['source_text'] = re.sub(r'\s*\n\s*', ' ', str(result['source_text']))
    return result


# In-memory cache for glossary definitions (keyed by trial_id)
_glossary_cache = {}

# Ensure uploads directory exists
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Lazy-load agents to prevent startup hang
_nlp_agent = None
_form_extractor = None
_ocr_processor = None

def get_nlp_agent():
    global _nlp_agent
    if _nlp_agent is None:
        try:
            print("⏳ Initializing ProtocolRuleAgent (Lazy)...")
            from backend.agents.protocol_rule_agent import ProtocolRuleAgent
            _nlp_agent = ProtocolRuleAgent()
            print("✅ ProtocolRuleAgent initialized")
        except Exception as e:
            print(f"❌ Error initializing ProtocolRuleAgent: {e}")
    return _nlp_agent

def get_form_extractor():
    global _form_extractor
    if _form_extractor is None:
        try:
            print("⏳ Initializing FDAProcessor (Lazy)...")
            from backend.agents.fda_processor import FDAProcessor
            _form_extractor = FDAProcessor()
            print("✅ FDAProcessor initialized")
        except Exception as e:
            print(f"❌ Error initializing FDAProcessor: {e}")
    return _form_extractor

def get_ocr_processor():
    global _ocr_processor
    if _ocr_processor is None:
        try:
            from backend.utils.ocr_processor import OCRProcessor
            _ocr_processor = OCRProcessor()
        except Exception as e:
            logger.error(f"Failed to init OCR processor: {e}")
    return _ocr_processor


def run_ltaa_analysis(indication: str, trial_id: str):
    """
    Background task to run LTAA (Research Intelligence) analysis.
    Uses singleton agent from orchestrator to avoid re-loading models.
    Persists results to ClinicalTrial.analysis_results for durability.
    """
    try:
        logger.info(f"📊 [BACKGROUND] Starting LTAA for: {indication}")
        from backend.agents.orchestrator import _get_ltaa_agent
        ltaa_agent = _get_ltaa_agent()
        results = ltaa_agent.analyze_disease(indication, target_trial_id=trial_id)
        target_count = len(results.get('ranked_targets', []))
        logger.info(f"✅ [BACKGROUND] LTAA completed for '{indication}': {target_count} targets found")
        
        # Persist LTAA results to DB for durability across restarts
        db = None
        try:
            db = get_session()
            trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
            if not trial and str(trial_id).isdigit():
                trial = db.query(ClinicalTrial).filter_by(document_id=int(trial_id)).first()
            if not trial:
                trial = db.query(ClinicalTrial).filter(ClinicalTrial.indication == indication).first()
            if trial:
                existing = trial.analysis_results or {}
                existing['ltaa'] = results
                trial.analysis_results = existing
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(trial, 'analysis_results')
                db.commit()
                logger.info(f"💾 [BACKGROUND] LTAA results persisted to DB for trial: {trial.trial_id}")
            try:
                from backend.utils.auditor import Auditor
                auditor = Auditor(db)
                auditor.log(
                    action="LTAA Analysis Completed",
                    agent="LTAAAgent",
                    target_type="trial",
                    target_id=str(trial_id),
                    status="Success",
                    details={"indication": indication, "targets_found": target_count},
                )
            except Exception:
                pass
        except Exception as db_err:
            logger.error(f"⚠️ [BACKGROUND] Failed to persist LTAA to DB: {db_err}")
        finally:
            if db:
                db.close()
    except Exception as e:
        logger.error(f"❌ [BACKGROUND] LTAA failed for '{indication}': {e}")
        import traceback
        traceback.print_exc()
        try:
            db = get_session()
            from backend.utils.auditor import Auditor
            auditor = Auditor(db)
            auditor.log(
                action="LTAA Analysis Failed",
                agent="LTAAAgent",
                target_type="trial",
                target_id=str(trial_id),
                status="Failed",
                details={"indication": indication, "error": str(e)},
            )
            db.close()
        except Exception:
            pass

def run_insilico_analysis(trial_id: str, text: str):
    """
    Background task to run In Silico modeling (Toxicity, DDI, PK/PD).
    Uses singleton agents from orchestrator to avoid re-loading models.
    """
    try:
        logger.info(f"🧪 [BACKGROUND] Starting In Silico analysis for trial: {trial_id}")
        import pickle
        import re
        from pathlib import Path
        import time

        cache_dir = Path("/app/data/insilico_cache")
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / f"{trial_id}.pkl"
        
        if cache_path.exists():
             if time.time() - cache_path.stat().st_mtime < 300:
                  logger.info(f"⏭️  [BACKGROUND] Stable cache exists for '{trial_id}'. Skipping.")
                  return

        from backend.agents.orchestrator import _get_insilico_agents
        extractor, resolver, tox_agent, ddi_agent, target_agent, pkpd_sim = _get_insilico_agents()

        drug_data = extractor.extract_drug_data(text)
        target_analysis = target_agent.analyze_text(text)
        
        results = []
        for drug in drug_data.get("trial_drugs", []):
            chem = resolver.resolve_name(drug['name'])
            tox = None
            if chem and chem.get('smiles'):
                tox = tox_agent.predict_toxicity(chem['smiles'])
            results.append({"drug": drug, "chem": chem, "tox": tox})
            
        interactions = ddi_agent.analyze_concomitants(
            [d['name'] for d in drug_data.get("trial_drugs", [])],
            drug_data.get("prohibited_meds", [])
        )
        
        simulation = None
        if drug_data.get("trial_drugs"):
            def safe_float(val, default):
                try:
                    if isinstance(val, (int, float)): return float(val)
                    nums = re.findall(r"[-+]?\d*\.\d+|\d+", str(val))
                    return float(nums[0]) if nums else float(default)
                except Exception:
                    return float(default)

            first_drug = drug_data["trial_drugs"][0]
            simulation = pkpd_sim.simulate_1_compartment(
                dose_mg=safe_float(first_drug.get("dose"), 100),
                dose_interval_hr=24,
                num_doses=7
            )

        insilico_data = {
            "drugs": results, 
            "interactions": interactions,
            "simulation": simulation,
            "target_analysis": target_analysis
        }
        
        with open(cache_path, "wb") as f:
            pickle.dump(insilico_data, f)
        
        # Persist InSilico results to DB for durability across restarts
        db = None
        try:
            db = get_session()
            trial = db.query(ClinicalTrial).filter_by(trial_id=str(trial_id)).first()
            if not trial and str(trial_id).isdigit():
                trial = db.query(ClinicalTrial).filter_by(document_id=int(trial_id)).first()
            if trial:
                existing = trial.analysis_results or {}
                existing['insilico'] = insilico_data
                trial.analysis_results = existing
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(trial, 'analysis_results')
                db.commit()
                logger.info(f"💾 [BACKGROUND] InSilico results persisted to DB for trial: {trial.trial_id}")
            try:
                from backend.utils.auditor import Auditor
                auditor = Auditor(db)
                drug_count = len(insilico_data.get("drugs", []))
                auditor.log(
                    action="InSilico Analysis Completed",
                    agent="InSilicoAgents",
                    target_type="trial",
                    target_id=str(trial_id),
                    status="Success",
                    details={"drugs_analyzed": drug_count, "has_simulation": simulation is not None},
                )
            except Exception:
                pass
        except Exception as db_err:
            logger.error(f"⚠️ [BACKGROUND] Failed to persist InSilico to DB: {db_err}")
        finally:
            if db:
                db.close()
            
        logger.info(f"✅ [BACKGROUND] In Silico completed for '{trial_id}'")
    except Exception as e:
        logger.error(f"❌ [BACKGROUND] In Silico failed for '{trial_id}': {e}")
        import traceback
        traceback.print_exc()
        try:
            db = get_session()
            from backend.utils.auditor import Auditor
            auditor = Auditor(db)
            auditor.log(
                action="InSilico Analysis Failed",
                agent="InSilicoAgents",
                target_type="trial",
                target_id=str(trial_id),
                status="Failed",
                details={"error": str(e)},
            )
            db.close()
        except Exception:
            pass

def extract_pdf_text(file_path: str) -> str:
    """Extract text from PDF file with OCR fallback"""
    import pdfplumber
    text = ""
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
        
        # OCR Fallback
        ocr_proc = get_ocr_processor()
        if ocr_proc and ocr_proc.is_ocr_needed(text):
            print(f"🕵️  OCR Needed for {file_path}. Starting fallback...")
            text = ocr_proc.extract_text_from_pdf(file_path)
            
        return text if text.strip() else "Empty PDF content - could not extract text"
    except Exception as e:
        print(f"❌ PDF extraction error: {e}")
        return f"Error extracting PDF: {str(e)}"


@router.post("/upload")
async def upload_protocol(file: UploadFile = File(...), background_tasks: BackgroundTasks = BackgroundTasks()):
    """Upload a clinical trial protocol PDF and extract criteria + FDA forms"""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    try:
        # Save file
        file_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOAD_DIR, f"{file_id}.pdf")
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        print(f"📁 File saved: {file_path}")
        
        # Extract text from PDF
        text = extract_pdf_text(file_path)
        print(f"📄 Extracted {len(text)} characters")

        # Parallel Execution: Extract FDA Forms and Criteria concurrently
        import concurrent.futures
        
        fda_data = {"fda_1571": {}, "fda_1572": {}}
        criteria = {'inclusion': [], 'exclusion': []}
        extracted_glossary = {}

        def run_fda_extraction():
            nonlocal fda_data
            extractor = get_form_extractor()
            if extractor:
                try:
                    print("🤖 Starting parallel FDA form extraction...")
                    extraction_result = extractor.process_pdf(file_path)
                    fda_data = {
                        "fda_1571": extraction_result.get('fda_1571', {}),
                        "fda_1572": extraction_result.get('fda_1572', {})
                    }
                    print("✅ FDA form extraction complete")
                except Exception as e:
                    print(f"⚠️  FDA form extraction warning: {e}")

        def run_criteria_extraction():
            nonlocal criteria, extracted_glossary
            agent = get_nlp_agent()
            if agent and text.strip():
                try:
                    print("🤖 Starting parallel AI criteria extraction...")
                    criteria = agent.extract_rules(text)
                    extracted_glossary = agent.get_glossary()
                    print(f"✅ Extracted {len(criteria.get('inclusion', []))} inclusion, {len(criteria.get('exclusion', []))} exclusion criteria")
                except Exception as e:
                    print(f"❌ Criteria extraction error: {e}")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            executor.submit(run_fda_extraction)
            executor.submit(run_criteria_extraction)
        
        # Fallback if extraction failed
        if not criteria.get('inclusion') and not criteria.get('exclusion'):
            criteria = {
                'inclusion': [{'source_text': 'Criteria extraction incomplete. Please review protocol.', 'rule_type': 'UNCLASSIFIED'}],
                'exclusion': [{'source_text': 'Criteria extraction incomplete. Please review protocol.', 'rule_type': 'UNCLASSIFIED'}]
            }
        
        # Save to database
        db = get_session()
        try:
            new_trial = ClinicalTrial(
                trial_id=f"TRIAL_{file_id[:8]}",
                protocol_title=fda_data.get('fda_1571', {}).get('protocol_title') or file.filename.replace('.pdf', ''),
                phase=fda_data.get('fda_1571', {}).get('study_phase') or "Unknown",
                indication=fda_data.get('fda_1571', {}).get('indication') or "Unknown",
                drug_name=fda_data.get('fda_1571', {}).get('drug_name') or "Unknown",
                status="Criteria Extracted",
                fda_1571=fda_data.get('fda_1571'),
                fda_1572=fda_data.get('fda_1572')
            )
            db.add(new_trial)
            db.commit()
            db.refresh(new_trial)
            
            print(f"💾 Trial created: {new_trial.trial_id}")

            # Audit: Trial created from protocol upload
            try:
                from backend.utils.auditor import Auditor
                auditor = Auditor(db)
                auditor.log(
                    action="Trial Created from Protocol Upload",
                    agent="ProtocolRuleAgent",
                    target_type="trial",
                    target_id=new_trial.trial_id,
                    status="Success",
                    details={"filename": file.filename, "indication": new_trial.indication, "drug": new_trial.drug_name},
                )
            except Exception:
                pass

            # Save criteria with enhanced structured data
            criteria_count = 0
            for c_type in ['inclusion', 'exclusion']:
                for c_data in criteria.get(c_type, []):
                    text_to_save = c_data.get('source_text') or c_data.get('text', '')
                    if not text_to_save or len(text_to_save.strip()) < 5:
                        continue
                    
                    # Build enhanced structured_data
                    structured_data = {
                        'rule_type': c_data.get('rule_type', 'UNCLASSIFIED'),
                        'field': c_data.get('field'),
                        'operator': c_data.get('operator'),
                        'value': c_data.get('value'),
                        'value2': c_data.get('value2'),
                        'unit': c_data.get('unit'),
                        'temporal_window': c_data.get('temporal_window'),
                        'temporal_unit': c_data.get('temporal_unit'),
                        'applies_to': c_data.get('applies_to', 'ALL'),
                        'negated': c_data.get('negated', False),
                        # Phase 2: Enhanced fields
                        'temporal': c_data.get('temporal'),  # {window: 12, unit: "months"}
                        'scope': c_data.get('scope', 'personal'),
                        'value_list': c_data.get('value_list'),
                        'group': c_data.get('group'),  # {group_id: "g1", logic: "AND"}
                        'children': c_data.get('children', []),
                        # UMLS concept data from dynamic extraction
                        'umls_cui': c_data.get('umls_cui'),
                        'semantic_type': c_data.get('semantic_type'),
                        'confidence': c_data.get('confidence')
                    }
                    
                    # Remove None values
                    structured_data = {k: v for k, v in structured_data.items() if v is not None}
                    
                    criterion = EligibilityCriteria(
                        trial_id=new_trial.id,
                        criterion_type=c_type,
                        text=text_to_save,
                        category=c_data.get('rule_type', 'UNCLASSIFIED'),
                        operator=c_data.get('operator'),
                        value=str(c_data.get('value')) if c_data.get('value') is not None else None,
                        unit=c_data.get('unit'),
                        negated=c_data.get('negated', False),
                        structured_data=structured_data,
                        # Phase 2: New columns
                        group_id=c_data.get('group', {}).get('group_id') if isinstance(c_data.get('group'), dict) else None,
                        group_logic=c_data.get('group', {}).get('logic') if isinstance(c_data.get('group'), dict) else None,
                        temporal_window_months=c_data.get('temporal', {}).get('window') if isinstance(c_data.get('temporal'), dict) else None,
                        scope=c_data.get('scope', 'personal'),
                        value_list=c_data.get('value_list')
                    )
                    db.add(criterion)
                    criteria_count += 1
            
            db.commit()
            print(f"✅ Saved {criteria_count} criteria to database")

            # Audit: Criteria extracted
            try:
                auditor.log(
                    action="Eligibility Criteria Extracted",
                    agent="ProtocolRuleAgent",
                    target_type="trial",
                    target_id=new_trial.trial_id,
                    status="Success",
                    details={"criteria_count": criteria_count},
                )
            except Exception:
                pass

            result_data = {
                "trial_id": new_trial.trial_id,
                "title": new_trial.protocol_title,
                "status": "extracted",
                "metadata": {
                    "drug": new_trial.drug_name,
                    "phase": new_trial.phase,
                    "indication": new_trial.indication
                },
                "fda_forms": {
                    "fda_1571": new_trial.fda_1571,
                    "fda_1572": new_trial.fda_1572
                },
                "criteria_count": criteria_count,
                "glossary_terms": len(extracted_glossary)
            }
            
            
            # Queue Background Agents via Event Bus (Orchestrator will handle this)
            from backend.events import event_bus
            
            # Construct event data
            trial_data = {
                "trial_id": new_trial.trial_id,
                "title": new_trial.protocol_title,
                "disease": new_trial.indication,
                "drug_name": new_trial.drug_name,
                "phase": new_trial.phase,
                "description": text[:3000] if text else "",
                "criteria": str(criteria)[:3000], 
                "full_text": text
            }
            
            logger.info(f"📡 Publishing TRIAL_CREATED event for {new_trial.trial_id}")
            background_tasks.add_task(event_bus.publish, "TRIAL_CREATED", trial_data)


            db.close()
            return result_data
        
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()
        
    except Exception as e:
        print(f"❌ ERROR in upload_protocol: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{trial_id}/approve-forms")
async def approve_trial_forms(trial_id: str, fda_1571: Dict = None, fda_1572: Dict = None):
    """Approve and optionally update FDA forms for a trial"""
    db = get_session()
    try:
        trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
        if not trial:
            raise HTTPException(status_code=404, detail="Trial not found")
        
        if fda_1571 is not None:
            trial.fda_1571 = fda_1571
        if fda_1572 is not None:
            trial.fda_1572 = fda_1572
        
        trial.status = "Forms Approved"
        db.commit()
        
        return {"message": "Forms approved", "status": trial.status}
    finally:
        db.close()


# In-memory status for criteria extraction (keyed by trial_id string)
_criteria_status: Dict[str, dict] = {}


@router.post("/{trial_id}/extract-criteria")
async def extract_criteria(trial_id: str, background_tasks: BackgroundTasks):
    """
    Step 3: On-demand eligibility criteria extraction.
    Runs NLP + LLM in background; frontend polls GET /{trial_id}/rules to see results.
    """
    db = get_session()
    try:
        trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
        if not trial:
            raise HTTPException(status_code=404, detail="Trial not found")

        existing = db.query(EligibilityCriteria).filter_by(trial_id=trial.id).count()
        if existing > 0:
            return {"status": "already_extracted", "criteria_count": existing,
                    "message": "Criteria already extracted"}

        _criteria_status[trial_id] = {"status": "running", "progress": 0}
        background_tasks.add_task(_bg_extract_criteria, trial_id, trial.id, trial.document_id)
        return {"status": "started", "message": "Criteria extraction started"}
    finally:
        db.close()


@router.get("/{trial_id}/criteria-status")
async def get_criteria_status(trial_id: str):
    """Poll this to check criteria extraction progress."""
    status = _criteria_status.get(trial_id)
    if status:
        return status
    db = get_session()
    try:
        trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
        if not trial:
            raise HTTPException(status_code=404, detail="Trial not found")
        count = db.query(EligibilityCriteria).filter_by(trial_id=trial.id).count()
        if count > 0:
            return {"status": "done", "criteria_count": count}
        return {"status": "not_started", "criteria_count": 0}
    finally:
        db.close()


def _bg_extract_criteria(trial_id: str, trial_db_id: int, document_id: int):
    """Background: extract eligibility criteria via NLP + LLM."""
    from backend.agents.protocol_rule_agent import ProtocolRuleAgent
    from backend.db_models import FDADocument
    import pdfplumber

    db = get_session()
    try:
        _criteria_status[trial_id] = {"status": "running", "progress": 20,
                                       "message": "Reading protocol text..."}

        doc = db.query(FDADocument).filter_by(id=document_id).first()
        if not doc:
            _criteria_status[trial_id] = {"status": "error", "message": "Document not found"}
            return
        filename = doc.filename
    finally:
        db.close()

    full_text = ""
    possible_paths = [
        os.path.join("uploads", "fda_documents", filename),
        os.path.join("/app/uploads/fda_documents", filename),
    ]
    for p in possible_paths:
        if os.path.exists(p):
            try:
                with pdfplumber.open(p) as pdf:
                    full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)
            except Exception:
                pass
            break

    if not full_text:
        _criteria_status[trial_id] = {"status": "error",
                                       "message": "Could not read protocol PDF"}
        return

    _criteria_status[trial_id] = {"status": "running", "progress": 40,
                                   "message": "Extracting criteria with NLP + LLM..."}

    try:
        agent = ProtocolRuleAgent()
        criteria = agent.extract_rules(full_text)
    except Exception as e:
        logger.exception("LLM criteria extraction failed for %s", trial_id)
        _criteria_status[trial_id] = {"status": "error", "message": f"LLM extraction failed: {e}"}
        return

    _criteria_status[trial_id] = {"status": "running", "progress": 80,
                                   "message": "Saving criteria to database..."}

    db2 = get_session()
    try:
        criteria_count = 0
        for c_type in ['inclusion', 'exclusion']:
            for c_data in criteria.get(c_type, []):
                text_to_save = c_data.get('source_text') or c_data.get('text', '')
                if not text_to_save or len(text_to_save.strip()) < 5:
                    continue
                db2.add(EligibilityCriteria(
                    trial_id=trial_db_id, criterion_type=c_type,
                    text=text_to_save,
                    category=c_data.get('rule_type', 'unclassified'),
                    operator=c_data.get('operator'),
                    value=str(c_data.get('value')) if c_data.get('value') is not None else None,
                    unit=c_data.get('unit'), negated=c_data.get('negated', False),
                    structured_data=c_data,
                ))
                criteria_count += 1
        db2.commit()

        trial = db2.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
        if trial:
            trial.status = "Criteria Extracted"
            db2.commit()

        try:
            from backend.utils.auditor import Auditor
            Auditor(db2).log(
                action="Eligibility Criteria Extracted", agent="ProtocolRuleAgent",
                target_type="trial", target_id=trial_id, status="Success",
                details={"criteria_count": criteria_count},
            )
        except Exception:
            pass

        _criteria_status[trial_id] = {"status": "done", "criteria_count": criteria_count,
                                       "progress": 100, "message": f"{criteria_count} criteria extracted"}

    except Exception as e:
        logger.exception("Criteria save failed for %s", trial_id)
        db2.rollback()
        _criteria_status[trial_id] = {"status": "error", "message": str(e)}
    finally:
        db2.close()


# In-memory status for LTAA + InSilico analysis
_analysis_status: Dict[str, dict] = {}


@router.post("/{trial_id}/run-analysis")
async def run_analysis(trial_id: str, background_tasks: BackgroundTasks):
    """
    Step 4: On-demand LTAA + InSilico analysis.
    Triggered from the screening page.
    """
    db = get_session()
    try:
        trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
        if not trial:
            raise HTTPException(status_code=404, detail="Trial not found")

        if trial.analysis_status == "completed":
            return {"status": "already_completed", "message": "Analysis already done"}

        trial.analysis_status = "running"
        db.commit()

        _analysis_status[trial_id] = {"status": "running", "progress": 10,
                                       "message": "Starting LTAA + InSilico analysis..."}

        background_tasks.add_task(_bg_run_analysis, trial_id, trial.id)
        return {"status": "started", "message": "LTAA + InSilico analysis started"}
    finally:
        db.close()


@router.get("/{trial_id}/analysis-status")
async def get_analysis_status(trial_id: str):
    """Poll this to check LTAA + InSilico progress."""
    status = _analysis_status.get(trial_id)
    if status:
        return status
    db = get_session()
    try:
        trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
        if not trial:
            raise HTTPException(status_code=404, detail="Trial not found")
        return {"status": trial.analysis_status or "pending"}
    finally:
        db.close()


def _bg_run_analysis(trial_id: str, trial_db_id: int):
    """Background: publish TRIAL_CREATED event to trigger orchestrator."""
    db = get_session()
    try:
        trial = db.query(ClinicalTrial).filter_by(id=trial_db_id).first()
        if not trial:
            _analysis_status[trial_id] = {"status": "error", "message": "Trial not found"}
            return

        _analysis_status[trial_id] = {"status": "running", "progress": 20,
                                       "message": "Preparing analysis..."}

        trial_data = {
            "trial_id": trial.trial_id,
            "title": trial.protocol_title,
            "disease": trial.indication,
            "drug_name": trial.drug_name,
            "phase": trial.phase,
            "document_id": trial.document_id,
        }
        filename = None
        if trial.document_id:
            from backend.db_models import FDADocument
            doc = db.query(FDADocument).filter_by(id=trial.document_id).first()
            if doc:
                filename = doc.filename
    finally:
        db.close()

    full_text = ""
    if filename:
        import pdfplumber
        for p in [os.path.join("uploads", "fda_documents", filename),
                  os.path.join("/app/uploads/fda_documents", filename)]:
            if os.path.exists(p):
                try:
                    with pdfplumber.open(p) as pdf:
                        full_text = "\n".join(pg.extract_text() or "" for pg in pdf.pages)
                except Exception:
                    pass
                break

    _analysis_status[trial_id] = {"status": "running", "progress": 30,
                                   "message": "Running LTAA + InSilico..."}

    try:
        from backend.events import event_bus
        trial_data["full_text"] = full_text
        event_bus.publish("TRIAL_CREATED", trial_data)

        _analysis_status[trial_id] = {"status": "running", "progress": 50,
                                       "message": "LTAA + InSilico running in background..."}
    except Exception as e:
        logger.exception("Analysis trigger failed for %s", trial_id)
        _analysis_status[trial_id] = {"status": "error", "message": str(e)}


@router.get("/{trial_id}/rules")
async def get_trial_rules(trial_id: str):
    """Get eligibility rules for a specific trial"""
    db = get_session()
    try:
        trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
        if not trial:
            raise HTTPException(status_code=404, detail="Trial not found")
        
        criteria = db.query(EligibilityCriteria).filter_by(trial_id=trial.id).all()
        
        # Calculate summary on the fly
        summary = {}
        for c in criteria:
            rule_type = c.category or 'UNCLASSIFIED'
            summary[rule_type] = summary.get(rule_type, 0) + 1

        return {
            "id": trial.id,
            "trial_id": trial_id,
            "title": trial.protocol_title,
            "status": trial.status,
            "analysis_status": trial.analysis_status or "pending",
            "metadata": {
                "drug": trial.drug_name,
                "phase": trial.phase,
                "indication": trial.indication
            },
            "fda_forms": {
                "fda_1571": trial.fda_1571 or {},
                "fda_1572": trial.fda_1572 or {}
            },
            "_summary": summary,
            "rules": [
                {
                    "id": c.id,
                    "type": c.criterion_type,
                    "text": _clean_criterion_text(c.text),
                    "source_text": c.text,
                    "category": c.category,
                    "operator": c.operator,
                    "value": c.value,
                    "unit": c.unit,
                    "negated": c.negated,
                    "structured_data": _clean_structured_data(c.structured_data)
                } for c in criteria
            ]
        }
    finally:
        db.close()


@router.get("/{trial_id}/glossary")
async def get_trial_glossary(trial_id: str):
    """Get dynamically extracted medical terms and their definitions for a trial"""
    db = get_session()
    try:
        trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
        if not trial:
            raise HTTPException(status_code=404, detail="Trial not found")
        
        criteria = db.query(EligibilityCriteria).filter_by(trial_id=trial.id).all()
        
        # Build glossary from extracted fields and UMLS concepts
        glossary = {}
        for c in criteria:
            structured = c.structured_data or {}
            field = structured.get('field')
            
            # Skip very generic terms that might have leaked
            if not field or len(field) < 3:
                continue
                
            if field and field not in glossary:
                # Determine Category based on semantic type
                sem = structured.get('semantic_type', '')
                category = "General"
                if sem in ['T047', 'T191']: category = "Condition/Diagnosis"
                elif sem in ['T116', 'T121']: category = "Medication/Chemical"
                elif sem in ['T060', 'T061']: category = "Procedure"
                elif sem in ['T033', 'T034']: category = "Lab/Finding"
                
                glossary[field] = {
                    "term": field,
                    "category": category,
                    "umls_cui": structured.get('umls_cui'),
                    "semantic_type": sem,
                    "used_in": c.criterion_type,
                    "definition": None
                }

        # Select top terms to define (limit to avoid slow response)
        terms_to_define = [g for g in glossary.values() if g['term'].lower() not in ['age', 'male', 'female']][:10]
        
        if terms_to_define:
             # Check cache first to avoid redundant LLM calls
             cache_key = trial_id
             cached_defs = _glossary_cache.get(cache_key)
             
             if cached_defs:
                 for term, definition in cached_defs.items():
                     if term in glossary:
                         glossary[term]['definition'] = definition
             else:
                 from backend.nlp_utils import get_llm
                 llm = get_llm()
                 term_list = ", ".join([t['term'] for t in terms_to_define])
                 
                 prompt = f"""Provide concise medical definitions and clinical significance for these terms in the context of a clinical trial: {term_list}.
                 
                 Return ONLY JSON:
                 {{
                   "term_name": "Concise definition | Why it matters in this trial"
                 }}
                 """
                 try:
                     response = llm.invoke(prompt)
                     import json
                     cleaned = response.replace('```json', '').replace('```', '').strip()
                     start = cleaned.find('{')
                     end = cleaned.rfind('}')
                     if start != -1 and end != -1:
                         defs = json.loads(cleaned[start:end+1])
                         _glossary_cache[cache_key] = defs  # Cache for future requests
                         for term, definition in defs.items():
                             if term in glossary:
                                 glossary[term]['definition'] = definition
                 except Exception as e:
                     logger.warning(f"Failed to generate glossary definitions: {e}")

        return {
            "trial_id": trial_id,
            "glossary": list(glossary.values()),
            "total_terms": len(glossary)
        }
    finally:
        db.close()


@router.delete("/{trial_id}")
async def delete_trial(trial_id: str):
    """Delete a trial and all its criteria"""
    db = get_session()
    try:
        trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
        if not trial:
            raise HTTPException(status_code=404, detail="Trial not found")
        
        db.query(EligibilityCriteria).filter_by(trial_id=trial.id).delete()
        db.delete(trial)
        db.commit()
        
        return {"message": "Trial deleted successfully"}
    finally:
        db.close()


@router.get("/")
async def list_trials():
    """List all trials"""
    db = get_session()
    try:
        trials = db.query(ClinicalTrial).all()
        return {
            "trials": [
                {
                    "trial_id": t.trial_id,
                    "title": t.protocol_title,
                    "drug": t.drug_name,
                    "phase": t.phase,
                    "indication": t.indication,
                    "status": t.status,
                    "analysis_status": t.analysis_status or "pending"
                }
                for t in trials
            ]
        }
    finally:
        db.close()

