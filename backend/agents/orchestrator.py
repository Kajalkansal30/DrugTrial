import logging
import asyncio
import traceback
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

# Singleton agent instances to avoid re-loading models per request
_ltaa_agent = None
_drug_extractor = None
_chem_resolver = None
_tox_agent = None
_ddi_agent = None
_target_agent = None
_pkpd_sim = None


def _get_ltaa_agent():
    global _ltaa_agent
    if _ltaa_agent is None:
        from backend.agents.ltaa_agent import LTAAAgent
        _ltaa_agent = LTAAAgent()
    return _ltaa_agent


def _get_insilico_agents():
    """Lazy-load and cache all InSilico agent singletons."""
    global _drug_extractor, _chem_resolver, _tox_agent, _ddi_agent, _target_agent, _pkpd_sim
    if _drug_extractor is None:
        from backend.agents.insilico.drug_extraction_agent import DrugExtractionAgent
        from backend.agents.insilico.chemical_resolver import ChemicalResolver
        from backend.agents.insilico.toxicity_agent import ToxicityAgent
        from backend.agents.insilico.ddi_agent import DDIAgent
        from backend.agents.insilico.molecular_target_agent import MolecularTargetAgent
        from backend.agents.insilico.pkpd_simulator import PKPDSimulator
        _drug_extractor = DrugExtractionAgent()
        _chem_resolver = ChemicalResolver()
        _tox_agent = ToxicityAgent()
        _ddi_agent = DDIAgent()
        _target_agent = MolecularTargetAgent()
        _pkpd_sim = PKPDSimulator()
    return _drug_extractor, _chem_resolver, _tox_agent, _ddi_agent, _target_agent, _pkpd_sim


class TrialOrchestrator:
    """
    Autonomous Orchestrator for Clinical Trial Analysis.
    Uses fast rule-based planning instead of LLM calls.
    Delegates to the canonical run_ltaa_analysis / run_insilico_analysis
    helpers in trials.py which handle both execution AND persistence.
    Tracks analysis_status on ClinicalTrial throughout the lifecycle.
    """

    GENERIC_INDICATIONS = frozenset([
        "unknown", "none", "n/a", "", "general", "indication", "diagnosis", "study"
    ])

    def plan_analysis(self, trial_data: Dict[str, Any]) -> List[str]:
        """
        Rule-based planning -- no LLM call needed.
        Decides which agents to run based on simple heuristics.
        """
        plan = []
        disease = (trial_data.get("disease") or trial_data.get("indication") or "").strip().lower()
        drug = (trial_data.get("drug_name") or trial_data.get("drug") or "").strip().lower()
        phase = (trial_data.get("phase") or "").strip().lower()

        if disease and disease not in self.GENERIC_INDICATIONS:
            plan.append("run_ltaa")

        if drug and drug not in self.GENERIC_INDICATIONS:
            plan.append("run_insilico")
        elif phase and any(p in phase for p in ["1", "2", "3", "i", "ii", "iii"]):
            plan.append("run_insilico")

        if not plan:
            plan.append("run_ltaa")

        logger.info(f"Orchestrator planned (rule-based): {plan}")
        return plan

    async def execute_plan(self, trial_id: str, plan: List[str], context: Dict[str, Any]):
        """
        Execute planned actions IN PARALLEL using asyncio.gather.
        Delegates to the canonical helpers that persist results to DB.
        """
        tasks = []
        logger.info(f"Executing plan for Trial {trial_id}: {plan}")

        if "run_ltaa" in plan:
            tasks.append(self._run_ltaa(trial_id, context))
        if "run_insilico" in plan:
            tasks.append(self._run_insilico(trial_id, context))

        if not tasks:
            return {}

        results_list = await asyncio.gather(*tasks, return_exceptions=True)

        results = {}
        action_names = [a for a in plan if a in ("run_ltaa", "run_insilico")]
        for action, result in zip(action_names, results_list):
            if isinstance(result, Exception):
                logger.error(f"Action {action} failed: {result}")
                logger.error(traceback.format_exc())
                results[action] = f"failed: {str(result)}"
            else:
                results[action] = "success"

        return results

    async def _run_ltaa(self, trial_id: str, context: Dict[str, Any]):
        """
        Delegate to the canonical run_ltaa_analysis which handles
        both execution (via singleton agent) and DB persistence.
        """
        disease = context.get("disease", "Unknown")
        logger.info(f"Orchestrator delegating LTAA for trial {trial_id}, disease: {disease}")

        from backend.routers.trials import run_ltaa_analysis
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: run_ltaa_analysis(disease, trial_id))

    async def _run_insilico(self, trial_id: str, context: Dict[str, Any]):
        """
        Delegate to the canonical run_insilico_analysis which handles
        both execution (via singleton agents) and DB persistence.
        """
        text = context.get("full_text", "")
        if not text:
            text = (context.get("description", "") + " " + context.get("criteria", "")).strip()

        logger.info(f"Orchestrator delegating In Silico for trial {trial_id}")

        from backend.routers.trials import run_insilico_analysis
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: run_insilico_analysis(trial_id, text))

    def _update_status(self, trial_id: str, status: str):
        """Update ClinicalTrial.analysis_status in the database."""
        from backend.db_models import get_session, ClinicalTrial
        db = get_session()
        try:
            trial = db.query(ClinicalTrial).filter_by(trial_id=trial_id).first()
            if trial:
                trial.analysis_status = status
                db.commit()
                logger.info(f"Orchestrator set analysis_status='{status}' for trial {trial_id}")
            else:
                logger.warning(f"Orchestrator could not find trial {trial_id} to update status")
        except Exception as e:
            logger.error(f"Failed to update analysis_status for {trial_id}: {e}")
            db.rollback()
        finally:
            db.close()

    def _audit_log(self, action: str, trial_id: str, status: str = "Success", details: dict = None):
        """Write an entry to the audit trail."""
        try:
            from backend.db_models import get_session
            from backend.utils.auditor import Auditor
            db = get_session()
            auditor = Auditor(db)
            auditor.log(
                action=action,
                agent="TrialOrchestrator",
                target_type="trial",
                target_id=str(trial_id),
                status=status,
                details=details,
            )
            db.close()
        except Exception as e:
            logger.error(f"Audit log failed: {e}")

    async def handle_new_trial(self, trial_data: Dict[str, Any]):
        """
        Event handler for TRIAL_CREATED.
        Sets status to 'running', executes the plan, then sets 'completed' or 'failed'.
        """
        trial_id = trial_data.get('trial_id')
        logger.info(f"Orchestrator received new trial: {trial_id}")

        self._update_status(trial_id, "running")
        plan = []
        try:
            plan = self.plan_analysis(trial_data)
            self._audit_log("Orchestration Started", trial_id, details={"plan": plan})

            results = await self.execute_plan(trial_id, plan, trial_data)

            any_failed = any("failed" in str(v) for v in results.values())
            if any_failed:
                self._update_status(trial_id, "failed")
                self._audit_log("Orchestration Completed", trial_id, status="Partial Failure", details=results)
                logger.warning(f"Orchestrator completed with failures for {trial_id}: {results}")
            else:
                self._update_status(trial_id, "completed")
                self._audit_log("Orchestration Completed", trial_id, details=results)
                logger.info(f"Orchestrator completed successfully for {trial_id}: {results}")

        except Exception as e:
            logger.error(f"Orchestrator failed for {trial_id}: {e}")
            logger.error(traceback.format_exc())
            self._update_status(trial_id, "failed")
            self._audit_log("Orchestration Failed", trial_id, status="Failed", details={"error": str(e), "plan": plan})
