import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

class DDIAgent:
    def __init__(self):
        # Sample rule-based DDI database (Pharma-Grade heuristics)
        self.interaction_db = {
            ("ibuprofen", "warfarin"): {
                "risk": "High",
                "mechanism": "Pharmacodynamic synergism - increased bleeding risk",
                "recommendation": "Avoid combination or monitor INR closely."
            },
            ("benznidazole", "alcohol"): {
                "risk": "Moderate",
                "mechanism": "Disulfiram-like reaction",
                "recommendation": "Avoid alcohol during treatment."
            },
            ("paracetamol", "alcohol"): {
                "risk": "High",
                "mechanism": "Increased production of toxic metabolite NAPQI",
                "recommendation": "Limit alcohol intake."
            },
            ("aspirin", "warfarin"): {
                "risk": "High",
                "mechanism": "Antiplatelet effect + Anticoagulant effect",
                "recommendation": "Contraindicated unless specifically indicated."
            }
        }

    def check_interaction(self, drug1: str, drug2: str) -> Optional[Dict[str, Any]]:
        """
        Check for interaction between two drugs.
        """
        d1 = drug1.lower().strip()
        d2 = drug2.lower().strip()
        
        # Check both orderings
        pair1 = (d1, d2)
        pair2 = (d2, d1)
        
        if pair1 in self.interaction_db:
            return self.interaction_db[pair1]
        elif pair2 in self.interaction_db:
            return self.interaction_db[pair2]
        
        return None

    def analyze_concomitants(self, trial_drugs: List[str], prohibited_meds: List[str]) -> List[Dict[str, Any]]:
        """
        Analyze a list of trial drugs against a list of common/prohibited meds.
        """
        interactions = []
        for t_drug in trial_drugs:
            for p_med in prohibited_meds:
                interaction = self.check_interaction(t_drug, p_med)
                if interaction:
                    interactions.append({
                        "drug_a": t_drug,
                        "drug_b": p_med,
                        **interaction
                    })
        return interactions

if __name__ == "__main__":
    agent = DDIAgent()
    print(agent.check_interaction("Ibuprofen", "Warfarin"))
