"""
Medical NLP Agent using SciSpacy
Extracts medical entities, conditions, and medications from clinical text
"""

try:
    import spacy
    import scispacy
    from scispacy.linking import EntityLinker
    SCISPACY_AVAILABLE = True
except ImportError:
    SCISPACY_AVAILABLE = False
    print("⚠️  SciSpacy not available. Run: ./install_nlp_models.sh")

class MedicalNLPAgent:
    """Medical text processing using SciSpacy"""
    
    def __init__(self, model_name='en_core_sci_lg'):
        from backend.nlp_utils import get_nlp
        self.nlp = get_nlp(model_name)
    
    def extract_medical_entities(self, text: str) -> dict:
        """
        Extract medical entities from text
        Returns: {
            'entities': list of (text, label, start, end),
            'sentences': list of sentences
        }
        """
        doc = self.nlp(text)
        
        entities = []
        for ent in doc.ents:
            entities.append({
                'text': ent.text,
                'label': ent.label_,
                'start': ent.start_char,
                'end': ent.end_char
            })
        
        sentences = [sent.text for sent in doc.sents]
        
        return {
            'entities': entities,
            'sentences': sentences,
            'entity_count': len(entities)
        }
    
    def extract_conditions(self, text: str) -> list:
        """Extract medical conditions/diseases from text"""
        doc = self.nlp(text)
        
        conditions = []
        for ent in doc.ents:
            # SciSpacy labels diseases/conditions
            if ent.label_ in ['DISEASE', 'DISORDER', 'CONDITION']:
                conditions.append({
                    'text': ent.text,
                    'label': ent.label_,
                    'confidence': 1.0  # SciSpacy doesn't provide confidence
                })
        
        return conditions
    
    def extract_medications(self, text: str) -> list:
        """Extract medications/drugs from text"""
        doc = self.nlp(text)
        
        medications = []
        for ent in doc.ents:
            # SciSpacy labels chemicals/drugs
            if ent.label_ in ['CHEMICAL', 'DRUG']:
                medications.append({
                    'text': ent.text,
                    'label': ent.label_
                })
        
        return medications
    
    def process_clinical_note(self, note_text: str) -> dict:
        """
        Process a complete clinical note
        Extract all relevant medical information
        """
        doc = self.nlp(note_text)
        
        # Categorize entities
        diseases = []
        chemicals = []
        procedures = []
        anatomy = []
        other = []
        
        for ent in doc.ents:
            entity_info = {
                'text': ent.text,
                'label': ent.label_,
                'start': ent.start_char,
                'end': ent.end_char
            }
            
            if ent.label_ in ['DISEASE', 'DISORDER']:
                diseases.append(entity_info)
            elif ent.label_ in ['CHEMICAL', 'DRUG']:
                chemicals.append(entity_info)
            elif ent.label_ == 'PROCEDURE':
                procedures.append(entity_info)
            elif ent.label_ in ['ANATOMY', 'ORGAN']:
                anatomy.append(entity_info)
            else:
                other.append(entity_info)
        
        return {
            'diseases': diseases,
            'medications': chemicals,
            'procedures': procedures,
            'anatomy': anatomy,
            'other_entities': other,
            'total_entities': len(doc.ents)
        }
    
    def extract_eligibility_criteria(self, protocol_text: str) -> dict:
        """
        Extract eligibility criteria from protocol text
        Identifies inclusion/exclusion criteria
        """
        doc = self.nlp(protocol_text)
        
        # Look for sections
        inclusion_criteria = []
        exclusion_criteria = []
        
        current_section = None
        
        for sent in doc.sents:
            sent_text = sent.text.lower()
            
            # Detect section headers
            if 'inclusion criteria' in sent_text or 'inclusion:' in sent_text:
                current_section = 'inclusion'
                continue
            elif 'exclusion criteria' in sent_text or 'exclusion:' in sent_text:
                current_section = 'exclusion'
                continue
            
            # Extract criteria based on current section
            if current_section == 'inclusion':
                # Extract entities from this criterion
                entities = [(ent.text, ent.label_) for ent in sent.ents]
                inclusion_criteria.append({
                    'text': sent.text,
                    'entities': entities
                })
            elif current_section == 'exclusion':
                entities = [(ent.text, ent.label_) for ent in sent.ents]
                exclusion_criteria.append({
                    'text': sent.text,
                    'entities': entities
                })
        
        return {
            'inclusion_criteria': inclusion_criteria,
            'exclusion_criteria': exclusion_criteria
        }

# Example usage
if __name__ == "__main__":
    if SCISPACY_AVAILABLE:
        try:
            agent = MedicalNLPAgent()
            
            # Test with sample text
            sample_text = """
            Patient presents with Type 2 Diabetes Mellitus and hypertension.
            Currently taking Metformin 500mg twice daily and Lisinopril 10mg once daily.
            HbA1c level is 7.8%. Blood pressure is 145/90 mmHg.
            """
            
            print("\n📄 Processing Clinical Note:\n")
            result = agent.process_clinical_note(sample_text)
            
            print(f"Diseases found: {len(result['diseases'])}")
            for d in result['diseases']:
                print(f"  - {d['text']} ({d['label']})")
            
            print(f"\nMedications found: {len(result['medications'])}")
            for m in result['medications']:
                print(f"  - {m['text']} ({m['label']})")
            
        except Exception as e:
            print(f"Error: {e}")
    else:
        print("\n⚠️  SciSpacy not installed.")
        print("Run: ./install_nlp_models.sh")
