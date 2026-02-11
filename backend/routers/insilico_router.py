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
            "toxicity": tox_info
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
    Retrieve cached In Silico modeling results for a specific trial.
    """
    import pickle
    from pathlib import Path
    
    cache_path = Path("/app/data/insilico_cache") / f"{trial_id}.pkl"
    if not cache_path.exists():
        # Fallback: if not found, return 404 or empty
        return {"status": "pending", "message": "Analysis in progress or not started"}
        
    try:
        with open(cache_path, "rb") as f:
            data = pickle.load(f)
        return {
            "status": "ready",
            "drugs": data.get("drugs", []),
            "interactions": data.get("interactions", []),
            "simulation": data.get("simulation"),
            "target_analysis": data.get("target_analysis")
        }
    except Exception as e:
        logger.error(f"Error reading in silico cache: {e}")
        raise HTTPException(status_code=500, detail="Failed to load simulation results")

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
