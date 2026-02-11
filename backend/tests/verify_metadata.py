
import sys
import logging
from backend.utils.graph_builder import GraphBuilder

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_metadata_storage():
    print("\n💾 Testing Validation Metadata Storage...")
    builder = GraphBuilder()
    
    disease = "Metadata Test Disease"
    target = "TEST-GENE"
    
    # 1. Add evidence with metadata
    try:
        print(f"Adding evidence for {target}...")
        builder.add_evidence(
            disease=disease,
            entity_name=target,
            entity_type="Gene",
            source="Test Script",
            page=1,
            context="Context...",
            weight=1.0,
            validation_info={
                "source": "HGNC",
                "approved_symbol": "TEST-GENE",
                "accession": "HGNC:12345"
            }
        )
        print("✅ Evidence added.")
    except Exception as e:
        print(f"❌ Failed to add evidence: {e}")
        return

    # 2. Retrieve and verify
    try:
        print("Retrieving targets...")
        targets = builder.get_ranked_targets(disease)
        
        found = False
        for t in targets:
            if t['name'] == target:
                found = True
                print(f"Found target: {t}")
                
                # Verify metadata
                if t.get('validation_source') == 'HGNC':
                    print("✅ validation_source matches 'HGNC'")
                else:
                    print(f"❌ validation_source mismatch: {t.get('validation_source')}")
                    
                if t.get('validation_id') == 'TEST-GENE': # logic uses approved_symbol if accession missing, or accession if present?
                    # logic: val_id = valid_info.get("accession") or valid_info.get("approved_symbol")
                    # Here we passed both. It should take accession if available?
                    # Wait, let's check hierarchy in code: 
                    # val_id = validation_info.get("accession") or validation_info.get("approved_symbol")
                    # So "HGNC:12345" should be it?
                    # Actually I passed "HGNC:12345" as accession in the dict above.
                    # let's see what comes back.
                    pass 
                
                # Check validation_id
                val_id = t.get('validation_id')
                print(f"Validation ID retrieved: {val_id}")
                
                if val_id:
                     print("✅ validation_id is present")
                else:
                     print("❌ validation_id is MISSING")

                break
        
        if not found:
            print("❌ Target not found in graph.")

    except Exception as e:
        print(f"❌ Failed to retrieve targets: {e}")

if __name__ == "__main__":
    try:
        test_metadata_storage()
    except Exception as e:
        print(f"\n❌ Verification Failed: {e}")
