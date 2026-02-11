import spacy
import scispacy
from scispacy.linking import EntityLinker
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)

# Global NLP model (Lazy loaded)
_nlp = None

def get_nlp():
    global _nlp
    if _nlp is None:
        logger.info("Loading SciSpaCy model (en_core_sci_lg)...")
        _nlp = spacy.load("en_core_sci_lg")
        # Add entity linker (UMLS)
        # Note: This is memory intensive. Ensure backend has ~8GiB RAM.
        _nlp.add_pipe("scispacy_linker", config={"linker_name": "umls"})
    return _nlp

def extract_bio_entities(text: str) -> List[Dict[str, Any]]:
    """
    Extract biological entities (Proteins, Genes, Diseases, Chemicals) from text.
    """
    try:
        nlp = get_nlp()
        doc = nlp(text)
        linker = nlp.get_pipe("scispacy_linker")
        
        entities = []
        for ent in doc.ents:
            # Basic metadata
            entity_info = {
                "text": ent.text,
                "label": ent.label_,
                "start": ent.start_char,
                "end": ent.end_char,
                "umls_id": None,
                "canonical_name": None
            }
            
            # Entity Linking (UMLS)
            if ent._.kb_ents:
                # Top match
                best_match_id, score = ent._.kb_ents[0]
                kb_entry = linker.kb.cui_to_entity[best_match_id]
                entity_info["umls_id"] = best_match_id
                entity_info["canonical_name"] = kb_entry.canonical_name
                entity_info["types"] = kb_entry.types
            else:
                 entity_info["types"] = []
                
            entities.append(entity_info)
            
        return entities
    except Exception as e:
        logger.error(f"Error extracting bio entities: {str(e)}")
        return []

def filter_entities_by_type(entities: List[Dict[str, Any]], target_labels: List[str] = None) -> List[Dict[str, Any]]:
    """
    Filter extracted entities by SpaCy labels.
    """
    if not target_labels:
        return entities
    return [e for e in entities if e["label"] in target_labels]

if __name__ == "__main__":
    # Test
    test_text = "Benznidazole and E1224 were tested for treating Chronic Chagas Disease."
    ents = extract_bio_entities(test_text)
    for e in ents:
        print(f"[{e['label']}] {e['text']} -> {e['canonical_name']} ({e['umls_id']})")
