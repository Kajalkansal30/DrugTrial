from rdkit import Chem
from rdkit.Chem import Descriptors, AllChem
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

class ToxicityAgent:
    def __init__(self):
        pass

    def predict_toxicity(self, smiles: str) -> Dict[str, Any]:
        """
        Predict toxicity indicators based on SMILES.
        Uses Lipinski's Rule of 5 and LogP heuristics as baseline.
        """
        if not smiles or not isinstance(smiles, str):
            return {"error": "Invalid or missing SMILES string"}
            
        try:
            mol = Chem.MolFromSmiles(smiles)
            if not mol:
                return {"error": "Failed to parse SMILES string into a molecule"}

            # Calculate Descriptors
            logp = Descriptors.MolLogP(mol)
            mw = Descriptors.MolWt(mol)
            h_bond_donors = Descriptors.NumHDonors(mol)
            h_bond_acceptors = Descriptors.NumHAcceptors(mol)
            tpsa = Descriptors.TPSA(mol)

            # Simplified Toxicity Heuristic (Placeholder for ML model)
            # High LogP (>5) and High MW (>500) often correlate with poor druglikeness/ADMET risk
            toxicity_score = 0.0
            risk_factors = []

            if logp > 5:
                toxicity_score += 0.3
                risk_factors.append("High Lipophilicity (LogP > 5)")
            if mw > 500:
                toxicity_score += 0.2
                risk_factors.append("High Molecular Weight (> 500 Da)")
            if tpsa > 140:
                toxicity_score += 0.15
                risk_factors.append("High TPSA (> 140 Å²)")
            
            # Normalize score 0-1
            toxicity_score = min(toxicity_score, 1.0)
            
            # Determine Risk Level
            if toxicity_score < 0.2:
                risk_level = "Low"
            elif toxicity_score < 0.5:
                risk_level = "Moderate"
            else:
                risk_level = "High"

            return {
                "score": round(toxicity_score, 2),
                "risk_level": risk_level,
                "descriptors": {
                    "logp": round(logp, 2),
                    "mw": round(mw, 2),
                    "h_donors": h_bond_donors,
                    "h_acceptors": h_bond_acceptors,
                    "tpsa": round(tpsa, 2)
                },
                "risk_factors": risk_factors,
                "lipinski_violations": self._check_lipinski(mw, logp, h_bond_donors, h_bond_acceptors)
            }

        except Exception as e:
            logger.error(f"Toxicity prediction failed: {e}")
            return {"error": str(e)}

    def _check_lipinski(self, mw, logp, donors, acceptors) -> int:
        violations = 0
        if mw > 500: violations += 1
        if logp > 5: violations += 1
        if donors > 5: violations += 1
        if acceptors > 10: violations += 1
        return violations

if __name__ == "__main__":
    # Test
    agent = ToxicityAgent()
    # Ibuprofen
    print(agent.predict_toxicity("CC(C)CC1=CC=C(C=C1)C(C)C(=O)O"))
