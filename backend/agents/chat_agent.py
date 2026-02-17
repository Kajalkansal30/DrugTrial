import logging
import pickle
import os
from typing import Dict, Any, List, Optional
from pathlib import Path
from backend.nlp_utils import get_llm
from backend.db_models import get_session, ClinicalTrial

logger = logging.getLogger(__name__)

class TrialChatAgent:
    """
    Interactive Agent for querying clinical trial data and analysis results.
    """
    def __init__(self):
        self.llm = get_llm()
        self.cache_dir = Path("/app/data/insilico_cache")
        # Ensure path is correct relative to where app runs, or use absolute path
        if not self.cache_dir.exists():
             self.cache_dir = Path("data/insilico_cache") # Fallback for local run

    def chat(self, user_query: str, trial_id: Optional[str] = None) -> str:
        """
        Answer user questions about trials.
        If trial_id is provided, focus context on that trial.
        """
        context = "System: No specific trial context loaded."
        
        if trial_id:
            context = self._build_trial_context(trial_id)
        
        prompt = f"""
        You are a Clinical Trial Research Assistant.
        Answer the user's question based on the provided Data Context.
        If the answer is not in the context, say so, but try to be helpful based on general medical knowledge if appropriate (but flag it as general knowledge).
        
        Data Context:
        {context}
        
        User Question: {user_query}
        
        Answer (concise and professional):
        """
        
        try:
            return self.llm.invoke(prompt)
        except Exception as e:
            logger.error(f"Chat failed: {e}")
            return "I encountered an error processing your request."

    def _build_trial_context(self, trial_id: str) -> str:
        """Fetch and summarize data for a specific trial."""
        context_parts = []
        
        # 1. DB Data
        db = get_session()
        try:
            trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
            if trial:
                context_parts.append(f"=== Trial Metadata ===\nTitle: {trial.protocol_title}\nPhase: {trial.phase}\nIndication: {trial.indication}\nDrug: {trial.drug_name}\nStatus: {trial.status}")
                if trial.fda_1571:
                     context_parts.append(f"FDA 1571 Info: {str(trial.fda_1571)}")
            else:
                return f"Trial {trial_id} not found in database."
        except Exception as e:
            logger.error(f"DB Fetch failed: {e}")
            context_parts.append("Error fetching database records.")
        finally:
            db.close()

        # 2. In Silico Cache
        try:
            # Try both absolute and relative paths
            paths_to_try = [
                self.cache_dir / f"{trial_id}.pkl",
                Path(f"data/insilico_cache/{trial_id}.pkl"),
                Path(f"/app/data/insilico_cache/{trial_id}.pkl")
            ]
            
            cache_data = None
            for p in paths_to_try:
                if p.exists():
                    with open(p, "rb") as f:
                        cache_data = pickle.load(f)
                    break
            
            if cache_data:
                context_parts.append("\n=== In Silico Analysis Results ===")
                
                # Drugs & Toxicity
                drugs = cache_data.get('drugs', [])
                if drugs:
                    for d in drugs:
                        drugs_name = d.get('drug', {}).get('name', 'Unknown')
                        tox = d.get('tox')
                        if tox:
                            context_parts.append(f"Drug: {drugs_name}")
                            context_parts.append(f"  - Toxicity Risk: {tox.get('risk_level', 'Unknown')}")
                            context_parts.append(f"  - Score: {tox.get('score', 'N/A')}")
                            context_parts.append(f"  - Risk Factors: {', '.join(tox.get('risk_factors', []))}")
                
                # Interactions
                interactions = cache_data.get('interactions', [])
                if interactions:
                    context_parts.append(f"\nDrug Interactions: {len(interactions)} detected.")
                    for i in interactions[:3]: # Limit to top 3
                         context_parts.append(f"  - {i.get('interaction', 'Unknown interaction')}")

                # Targets
                targets = cache_data.get('target_analysis', {}).get('ranked_targets', [])
                if targets:
                     target_names = [t['name'] for t in targets[:5]]
                     context_parts.append(f"\nTop Targets Identified: {', '.join(target_names)}")

        except Exception as e:
            logger.warning(f"Cache load failed for {trial_id}: {e}")
            
        return "\n".join(context_parts)
