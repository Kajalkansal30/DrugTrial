
import sys
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_domain_inference():
    print("\n🔬 Testing Domain Inference...")
    from backend.utils.domain_config import infer_domain_from_disease, Domain
    
    cases = [
        ("Chagas Disease", Domain.CARDIOLOGY),
        ("Acute Myocardial Infarction", Domain.CARDIOLOGY),
        ("Non-Small Cell Lung Cancer", Domain.ONCOLOGY),
        ("Alzheimer's Disease", Domain.NEUROLOGY),
        ("Generic Fever", Domain.GENERAL)
    ]
    
    for disease, expected in cases:
        result = infer_domain_from_disease(disease)
        status = "✅" if result == expected else "❌"
        print(f"{status} {disease} -> {result.value} (Expected: {expected.value})")

def test_document_classification():
    print("\n📄 Testing Document Classification...")
    from backend.utils.document_classifier import classify_document_type, DocumentType
    
    cases = [
        (
            "This study investigates inclusion criteria and exclusion criteria for the primary endpoint.", 
            "protocol_v1.pdf",
            DocumentType.CLINICAL_PROTOCOL
        ),
        (
            "We found that expression levels were significantly increased (p < 0.05). Discussion...", 
            "research_paper.pdf",
            DocumentType.RESEARCH_PAPER
        ),
        (
            "Pharmacokinetics and toxicological data submitted for IND application to FDA.", 
            "fda_submission.pdf",
            DocumentType.FDA_SUBMISSION
        )
    ]
    
    for text, filename, expected in cases:
        result = classify_document_type(text, filename)
        status = "✅" if result == expected else "❌"
        print(f"{status} {filename} -> {result.value} (Expected: {expected.value})")

def test_ltaa_agent_domain_init():
    print("\n🤖 Testing LTAA Agent Domain Initialization...")
    from backend.agents.ltaa_agent import LTAAAgent
    from backend.utils.domain_config import Domain
    
    # Test auto inference
    agent = LTAAAgent()
    # Mocking analyze_disease usually, but here checking defaults
    print(f"Agent initialized with domain: {agent.domain} (Should be None initially)")
    
    # Test manual injection
    agent_cardio = LTAAAgent(domain=Domain.CARDIOLOGY)
    print(f"Agent initialized with domain: {agent_cardio.domain} (Should be Domain.CARDIOLOGY)")

if __name__ == "__main__":
    try:
        test_domain_inference()
        test_document_classification()
        test_ltaa_agent_domain_init()
        print("\n✅ LTAA v3 Verification Complete!")
    except Exception as e:
        print(f"\n❌ Verification Failed: {e}")
        import traceback
        traceback.print_exc()
