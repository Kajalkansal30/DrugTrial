import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class MolecularTargetAgent:
    def __init__(self):
        try:
            from backend.nlp_utils import get_nlp
            self.nlp = get_nlp("en_core_sci_lg", load_linker=True)
            logger.info("✅ MolecularTargetAgent initialized with shared SciSpaCy & UMLS")
        except Exception as e:
            logger.error(f"Failed to load SciSpaCy model: {e}")
            self.nlp = None

    def analyze_text(self, text: str) -> Dict[str, Any]:
        """
        Extract medical entities and link to UMLS concepts.
        Processes the entire document in chunks for complete coverage.
        """
        if not self.nlp:
            return {"error": "SciSpaCy model not loaded"}

        # Chunk the text into 10k segments for SciSpaCy (to avoid OOM/performance issues)
        chunk_size = 10000
        text_chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
        
        all_targets = []
        all_chemicals = []
        linker = self.nlp.get_pipe("scispacy_linker")
        
        print(f"🔬 Analyzing biological targets across {len(text_chunks)} chunks...")
        for chunk in text_chunks:
            doc = self.nlp(chunk)
            
            for ent in doc.ents:
                concept = None
                if ent._.kb_ents:
                    cui, score = ent._.kb_ents[0]
                    concept = linker.kb.cui_to_entity[cui]
                    
                data = {
                    "text": ent.text,
                    "label": ent.label_,
                    "cui": concept.concept_id if concept else None,
                    "canonical_name": concept.canonical_name if concept else ent.text,
                    "definition": concept.definition if concept else None,
                    "types": concept.types if concept else []
                }

                # Simple classification based on UMLS semantic types
                if concept and any(t in concept.types for t in ["T116", "T123", "T028"]):
                    all_targets.append(data)
                elif concept and any(t in concept.types for t in ["T121", "T109", "T122"]):
                    all_chemicals.append(data)
                elif ent.label_ in ["CHEMICAL", "GENE_OR_GENE_PRODUCT"]:
                    if ent.label_ == "CHEMICAL": all_chemicals.append(data)
                    else: all_targets.append(data)

        # Deduplicate targets and chemicals
        unique_targets_map = {t['canonical_name']: t for t in all_targets}
        unique_chemicals_map = {c['canonical_name']: c for c in all_chemicals}
        
        # Deterministic sorting by canonical name to ensure stable results on refresh
        unique_targets = sorted(list(unique_targets_map.values()), key=lambda x: x['canonical_name'])
        unique_chemicals = sorted(list(unique_chemicals_map.values()), key=lambda x: x['canonical_name'])

        return {
            "targets": unique_targets[:15], # Increased limit
            "chemicals": unique_chemicals[:15],
            "rationale": self._generate_computational_rationale(unique_targets, unique_chemicals)
        }

    def _generate_computational_rationale(self, targets, chemicals) -> str:
        if not targets:
            return "No specific molecular targets identified for structural analysis."
        
        target_names = [t['canonical_name'] for t in targets[:3]]
        chem_names = [c['canonical_name'] for c in chemicals[:2]]
        
        if chem_names:
            return f"The study explores the interaction between {', '.join(chem_names)} and targets like {', '.join(target_names)} to modulate physiological pathways."
        return f"Primary molecular focus identified on {', '.join(target_names)}."

if __name__ == "__main__":
    # Test
    agent = MolecularTargetAgent()
    sample = "Enoxaparin acts as an inhibitor of Factor Xa and Thrombin. It is used for thrombosis."
    print(agent.analyze_text(sample))
