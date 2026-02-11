import sys
import os
sys.path.append('/app')
from backend.utils.pubmed_connector import fetch_pubmed_abstracts

print("🔍 Testing PubMed Connectivity...")
try:
    results = fetch_pubmed_abstracts(["Chagas Disease"], max_results=3)
    print(f"✅ Found {len(results)} results for 'Chagas Disease'")
    for r in results:
        print(f"   - {r.get('title', 'No Title')[:50]}...")
except Exception as e:
    print(f"❌ PubMed Test Failed: {e}")
    import traceback
    traceback.print_exc()
