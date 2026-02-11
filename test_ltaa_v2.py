from backend.agents.ltaa_agent import LTAAAgent
import json

def test_ltaa():
    agent = LTAAAgent()
    print("🧬 Testing LTAA v2 Integrated Analysis for 'Chagas Disease'...")
    try:
        results = agent.analyze_disease("Chagas Disease", max_papers=2)
        print("\n✅ Analysis Complete!")
        print(f"Summary: {results['summary']}")
        print(f"Stats: {results['stats']}")
        
        print("\nTop Targets from Graph:")
        for t in results['ranked_targets'][:3]:
            print(f"- {t['name']} ({t['type']}): Score {t['score']}")
            if t.get('citations'):
                print(f"  Snippet: {t['citations'][0].get('context', '')[:80]}...")
        
        print("\nScientific Report:")
        print(json.dumps(results.get('report'), indent=2))
        
    except Exception as e:
        print(f"❌ Test Failed: {e}")

if __name__ == "__main__":
    test_ltaa()
