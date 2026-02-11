import spacy
from scispacy.linking import EntityLinker
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class MolecularTargetAgent:
    def __init__(self):
        try:
            # Load the large SciSpaCy model
            self.nlp = spacy.load("en_core_sci_lg")
            # Link to UMLS for medical concepts
            if "scispacy_linker" not in self.nlp.pipe_names:
                # Note: Newer scispacy might have different config structure
                self.nlp.add_pipe("scispacy_linker", config={"linker_name": "umls"})
            logger.info("✅ MolecularTargetAgent initialized with SciSpaCy & UMLS")
        except Exception as e:
            logger.error(f"Failed to load SciSpaCy model: {e}")
            self.nlp = None

    def analyze_text(self, text: str) -> Dict[str, Any]:
        """
        Extract medical entities and link to UMLS concepts.
        Focus on Targets (Genes/Proteins) and Chemicals.
        """
        if not self.nlp:
            return {"error": "SciSpaCy model not loaded"}

        # Process a reasonable chunk of text (or summary)
        doc = self.nlp(text[:10000])
        
        targets = []
        chemicals = []
        
        linker = self.nlp.get_pipe("scispacy_linker")
        
        for ent in doc.ents:
            # SciSpaCy entities have 'labels' or we can check UMLS types
            # T116: Amino Acid, Peptide, or Protein (Likely a target)
            # T121: Pharmacologic Substance (Chemical)
            
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
                targets.append(data)
            elif concept and any(t in concept.types for t in ["T121", "T109", "T122"]):
                chemicals.append(data)
            elif ent.label_ in ["CHEMICAL", "GENE_OR_GENE_PRODUCT"]:
                if ent.label_ == "CHEMICAL": chemicals.append(data)
                else: targets.append(data)

        # Deduplicate
        seen_targets = {}
        unique_targets = []
        for t in targets:
            if t['canonical_name'] not in seen_targets:
                seen_targets[t['canonical_name']] = True
                unique_targets.append(t)

        return {
            "targets": unique_targets[:10], # Top 10
            "chemicals": list({c['canonical_name']: c for c in chemicals}.values())[:10],
            "rationale": self._generate_computational_rationale(unique_targets, chemicals)
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
