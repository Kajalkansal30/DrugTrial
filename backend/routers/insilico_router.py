from fastapi import APIRouter, HTTPException, BackgroundTasks
import logging
from typing import Dict, Any, List
from backend.agents.insilico.chemical_resolver import ChemicalResolver
from backend.agents.insilico.toxicity_agent import ToxicityAgent
from backend.agents.insilico.ddi_agent import DDIAgent
from backend.agents.insilico.pkpd_simulator import PKPDSimulator
from backend.agents.insilico.drug_extraction_agent import DrugExtractionAgent
from backend.agents.insilico.molecular_target_agent import MolecularTargetAgent

router = APIRouter(prefix="/api/insilico", tags=["In Silico Modeling"])
logger = logging.getLogger(__name__)

# Singletons
resolver = ChemicalResolver()
tox_agent = ToxicityAgent()
ddi_agent = DDIAgent()
pkpd_sim = PKPDSimulator()
extractor = DrugExtractionAgent()
target_agent = MolecularTargetAgent()

@router.post("/analyze/text")
async def analyze_insilico_text(payload: Dict[str, str]):
    """
    Direct text input analysis for quick prediction (Demo Mode).
    """
    text = payload.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    # 1. Extract Drugs
    drug_data = extractor.extract_drug_data(text)
    if "error" in drug_data:
        return drug_data

    # 2. Enrich with Chem Info and Toxicity
    results = []
    for drug in drug_data.get("trial_drugs", []):
        chem_info = resolver.resolve_name(drug['name'])
        tox_info = None
        if chem_info and chem_info.get('smiles'):
            tox_info = tox_agent.predict_toxicity(chem_info['smiles'])
        
        results.append({
            "drug": drug,
            "chem": chem_info,
            "tox": tox_info
        })

    # 3. DDI Check
    trial_drug_names = [d['name'] for d in drug_data.get("trial_drugs", [])]
    prohibited = drug_data.get("prohibited_meds", [])
    interactions = ddi_agent.analyze_concomitants(trial_drug_names, prohibited)

    # 4. PK Simulation (for the first drug)
    simulation = None
    if drug_data.get("trial_drugs"):
        def safe_float(val, default):
            try:
                if isinstance(val, (int, float)): return float(val)
                # Try to extract numbers from string like "100mg"
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

    # 5. Target Analysis
    target_results = target_agent.analyze_text(text)

    return {
        "status": "ready",
        "drugs": results,
        "interactions": interactions,
        "simulation": simulation,
        "target_analysis": target_results
    }

@router.get("/results/{trial_id}")
async def get_insilico_results(trial_id: str):
    """
    Retrieve cached In Silico modeling results.
    Checks pickle cache (trial_id and doc_{id} keys), then falls back to DB.
    """
    import pickle
    from pathlib import Path

    cache_dir = Path("/app/data/insilico_cache")

    def _try_cache(key: str):
        p = cache_dir / f"{key}.pkl"
        if p.exists():
            try:
                with open(p, "rb") as f:
                    return pickle.load(f)
            except Exception as e:
                logger.error(f"Error reading in silico cache {key}: {e}")
        return None

    cache_keys = [trial_id]
    if str(trial_id).isdigit():
        cache_keys.append(f"doc_{trial_id}")

    for key in cache_keys:
        data = _try_cache(key)
        if data:
            return {
                "status": "ready",
                "drugs": data.get("drugs", []),
                "interactions": data.get("interactions", []),
                "simulation": data.get("simulation"),
                "target_analysis": data.get("target_analysis")
            }

    # Fallback: check DB for persisted results and also resolve doc_id -> trial
    try:
        from backend.db_models import get_session, ClinicalTrial
        db = get_session()
        trial = db.query(ClinicalTrial).filter_by(trial_id=str(trial_id)).first()
        if not trial and str(trial_id).isdigit():
            trial = db.query(ClinicalTrial).filter_by(document_id=int(trial_id)).first()
            if trial:
                doc_cache = _try_cache(f"doc_{trial_id}")
                if doc_cache:
                    db.close()
                    return {
                        "status": "ready",
                        "drugs": doc_cache.get("drugs", []),
                        "interactions": doc_cache.get("interactions", []),
                        "simulation": doc_cache.get("simulation"),
                        "target_analysis": doc_cache.get("target_analysis")
                    }
        if trial and trial.analysis_results and 'insilico' in trial.analysis_results:
            db_data = trial.analysis_results['insilico']
            db.close()
            logger.info(f"📂 InSilico loaded from DB for: {trial_id}")
            return {
                "status": "ready",
                "drugs": db_data.get("drugs", []),
                "interactions": db_data.get("interactions", []),
                "simulation": db_data.get("simulation"),
                "target_analysis": db_data.get("target_analysis")
            }
        if trial:
            analysis_status = getattr(trial, 'analysis_status', 'pending') or 'pending'
            db.close()
            if analysis_status == 'running':
                return {"status": "pending", "message": "Analysis is running. Results will appear shortly."}
            elif analysis_status == 'failed':
                return {"status": "failed", "message": "Analysis failed. Please re-upload the document."}
            else:
                return {"status": "pending", "message": "Analysis queued. Results will appear shortly."}
        db.close()
    except Exception as db_err:
        logger.error(f"⚠️ DB fallback failed for InSilico: {db_err}")

    return {"status": "pending", "message": "In Silico analysis is starting. Results will appear shortly."}

@router.get("/drug/{name}")
async def get_drug_modeling(name: str):
    """
    Get toxicity profile for a single drug name.
    """
    chem = resolver.resolve_name(name)
    if not chem:
        raise HTTPException(status_code=404, detail="Drug not found in PubChem")
        
    tox = tox_agent.predict_toxicity(chem['smiles'])
    return {
        "name": name,
        "chem": chem,
        "tox": tox
    }
