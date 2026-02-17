from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Dict, Any
from backend.agents.ltaa_agent import LTAAAgent
from backend.db_models import get_session, ClinicalTrial
import logging

router = APIRouter(prefix="/api/ltaa", tags=["Literature & Target Analysis"])
agent = LTAAAgent()
logger = logging.getLogger(__name__)

class AnalysisRequest(BaseModel):
    disease_query: str
    max_papers: int = 10

@router.post("/analyze")
async def analyze_literature(request: AnalysisRequest):
    """
    Trigger end-to-end literature analysis for a disease.
    """
    try:
        results = agent.analyze_disease(request.disease_query, request.max_papers)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/report/{disease}")
async def get_disease_report(disease: str, background_tasks: BackgroundTasks):
    """
    Retrieve the scientific justification report and ranked targets.
    If no data exists, triggers a background analysis.
    """
    try:
        # 1. Try to retrieve full analysis from cache first (includes stats, domain, excluded entities)
        # Note: _cache_key now relies only on disease, so trial_id=None is fine
        cache_key = agent._cache_key(disease, None, 10)
        cached_result = agent._load_cache(cache_key)
        
        if cached_result:
            # Normalize: ensure both 'targets' and 'ranked_targets' exist
            if 'ranked_targets' in cached_result and 'targets' not in cached_result:
                cached_result['targets'] = cached_result['ranked_targets']
            elif 'targets' in cached_result and 'ranked_targets' not in cached_result:
                cached_result['ranked_targets'] = cached_result['targets']
            cached_result['status'] = 'ready'
            return cached_result

        # 2. Fallback: Check DB for persisted LTAA results
        try:
            db = get_session()
            trial = db.query(ClinicalTrial).filter(ClinicalTrial.indication == disease).first()
            if trial and trial.analysis_results and 'ltaa' in trial.analysis_results:
                db_result = trial.analysis_results['ltaa']
                if 'ranked_targets' in db_result and 'targets' not in db_result:
                    db_result['targets'] = db_result['ranked_targets']
                elif 'targets' in db_result and 'ranked_targets' not in db_result:
                    db_result['ranked_targets'] = db_result['targets']
                db_result['status'] = 'ready'
                db.close()
                logger.info(f"📂 LTAA loaded from DB for: {disease}")
                return db_result
            db.close()
        except Exception as db_err:
            logger.error(f"⚠️ DB fallback failed for LTAA: {db_err}")

        # 3. Fallback: Query Graph (if cache miss but data exists)
        targets = agent.graph.get_ranked_targets(disease)
        
        # If no targets found, trigger analysis in background for next time
        if not targets:
            logger.info(f"🔍 No targets found for '{disease}'. Triggering on-demand background analysis.")
            from backend.routers.trials import run_ltaa_analysis
            background_tasks.add_task(run_ltaa_analysis, disease, "manual")
            
            from backend.utils.domain_config import infer_domain_from_disease
            inferred_domain = infer_domain_from_disease(disease)

            return {
                "disease": disease,
                "domain": inferred_domain.value,
                "targets": [],
                "ranked_targets": [],
                "excluded_entities": [],
                "stats": {"papers_analyzed": 0, "entities_extracted": 0},
                "report": {
                    "summary": f"Research analysis for {inferred_domain.value.upper()} is currently running in the background. Please refresh in 30-60 seconds.",
                    "targets": []
                },
                "status": "analyzing"
            }

        # Generate report for found targets (legacy path for graph-only data)
        top_targets = targets[:3]
        report = agent._generate_scientific_report(disease, top_targets)
        
        # Infer domain for legacy path
        from backend.utils.domain_config import infer_domain_from_disease
        current_domain = infer_domain_from_disease(disease)

        return {
            "disease": disease,
            "domain": current_domain.value,
            "targets": targets,
            "ranked_targets": targets,
            "report": report,
            "status": "ready"
        }
    except Exception as e:
        logger.error(f"Error in get_disease_report: {e}")
        raise HTTPException(status_code=500, detail=str(e))
