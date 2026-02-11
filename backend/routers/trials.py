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

router = APIRouter(prefix="/api/trials", tags=["trials"])
logger = logging.getLogger(__name__)

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
    This runs asynchronously after upload to avoid blocking the request.
    """
    try:
        logger.info(f"📊 [BACKGROUND] Starting LTAA for: {indication}")
        from backend.agents.ltaa_agent import LTAAAgent
        ltaa_agent = LTAAAgent()
        results = ltaa_agent.analyze_disease(indication, target_trial_id=trial_id)
        target_count = len(results.get('ranked_targets', []))
        logger.info(f"✅ [BACKGROUND] LTAA completed for '{indication}': {target_count} targets found")
    except Exception as e:
        logger.error(f"❌ [BACKGROUND] LTAA failed for '{indication}': {e}")
        import traceback
        traceback.print_exc()

def run_insilico_analysis(trial_id: str, text: str):
    """
    Background task to run In Silico modeling (Toxicity, DDI, PK/PD).
    """
    try:
        logger.info(f"🧪 [BACKGROUND] Starting In Silico analysis for trial: {trial_id}")
        from backend.agents.insilico.drug_extraction_agent import DrugExtractionAgent
        from backend.agents.insilico.chemical_resolver import ChemicalResolver
        from backend.agents.insilico.toxicity_agent import ToxicityAgent
        from backend.agents.insilico.ddi_agent import DDIAgent
        import pickle
        from pathlib import Path

        # 1. Extract
        extractor = DrugExtractionAgent()
        drug_data = extractor.extract_drug_data(text)
        
        # 2. Model - Deep Molecular Analysis
        from backend.agents.insilico.molecular_target_agent import MolecularTargetAgent
        resolver = ChemicalResolver()
        tox_agent = ToxicityAgent()
        ddi_agent = DDIAgent()
        target_agent = MolecularTargetAgent()
        
        target_analysis = target_agent.analyze_text(text)
        
        results = []
        for drug in drug_data.get("trial_drugs", []):
            chem = resolver.resolve_name(drug['name'])
            tox = None
            if chem and chem.get('smiles'): # Add check for smiles
                tox = tox_agent.predict_toxicity(chem['smiles'])
            results.append({"drug": drug, "chem": chem, "tox": tox})
            
        interactions = ddi_agent.analyze_concomitants(
            [d['name'] for d in drug_data.get("trial_drugs", [])],
            drug_data.get("prohibited_meds", [])
        )
        
        # 3. PK Simulation (for the first drug)
        from backend.agents.insilico.pkpd_simulator import PKPDSimulator
        pkpd_sim = PKPDSimulator()
        simulation = None
        if drug_data.get("trial_drugs"):
            def safe_float(val, default):
                try:
                    if isinstance(val, (int, float)): return float(val)
                    import re
                    nums = re.findall(r"[-+]?\d*\.\d+|\d+", str(val))
                    return float(nums[0]) if nums else float(default)
                except:
                    return float(default)

            first_drug = drug_data["trial_drugs"][0]
            simulation = pkpd_sim.simulate_1_compartment(
                dose_mg=safe_float(first_drug.get("dose"), 100),
                dose_interval_hr=24, # Daily
                num_doses=7
            )

        # 4. Cache results - Include Target Analysis
        cache_dir = Path("/app/data/insilico_cache")
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / f"{trial_id}.pkl"
        
        with open(cache_path, "wb") as f:
            pickle.dump({
                "drugs": results, 
                "interactions": interactions,
                "simulation": simulation,
                "target_analysis": target_analysis
            }, f)
            
        logger.info(f"✅ [BACKGROUND] In Silico completed for '{trial_id}'")
    except Exception as e:
        logger.error(f"❌ [BACKGROUND] In Silico failed for '{trial_id}': {e}")
        import traceback
        traceback.print_exc()

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
async def upload_protocol(file: UploadFile = File(...), background_tasks: BackgroundTasks = None):
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

        # Extract FDA Forms
        fda_data = {"fda_1571": {}, "fda_1572": {}}
        extractor = get_form_extractor()
        if extractor:
            try:
                extraction_result = extractor.process_pdf(file_path)
                fda_data = {
                    "fda_1571": extraction_result.get('fda_1571', {}),
                    "fda_1572": extraction_result.get('fda_1572', {})
                }
            except Exception as e:
                print(f"⚠️  FDA form extraction warning: {e}")

        # Extract eligibility criteria using enhanced NLP agent
        criteria = {'inclusion': [], 'exclusion': []}
        extracted_glossary = {}
        
        agent = get_nlp_agent()
        if agent and text.strip():
            try:
                print("🤖 Starting AI extraction with dynamic NLP...")
                criteria = agent.extract_rules(text)
                extracted_glossary = agent.get_glossary()
                
                print(f"✅ Extracted {len(criteria.get('inclusion', []))} inclusion, {len(criteria.get('exclusion', []))} exclusion criteria")
                print(f"📚 Extracted {len(extracted_glossary)} glossary terms")
            except Exception as e:
                print(f"❌ Extraction error: {e}")
                import traceback
                traceback.print_exc()
        
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
            
            # Queue Background LTAA Analysis (Research Intelligence)
            indication = new_trial.indication
            if indication and indication != "Unknown" and background_tasks:
                background_tasks.add_task(run_ltaa_analysis, indication, new_trial.trial_id)
                logger.info(f"🔄 Queued background LTAA analysis for: {indication}")
            
            # Queue In Silico Analysis
            if text and background_tasks:
                background_tasks.add_task(run_insilico_analysis, new_trial.trial_id, text)
                logger.info(f"🧪 Queued background In Silico analysis for trial: {new_trial.trial_id}")

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
                    "text": c.text,
                    "category": c.category,
                    "operator": c.operator,
                    "value": c.value,
                    "unit": c.unit,
                    "negated": c.negated,
                    "structured_data": c.structured_data or {}
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
            if field and field not in glossary:
                glossary[field] = {
                    "term": field,
                    "umls_cui": structured.get('umls_cui'),
                    "semantic_type": structured.get('semantic_type'),
                    "used_in": c.criterion_type
                }
        
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
                    "status": t.status
                }
                for t in trials
            ]
        }
    finally:
        db.close()

