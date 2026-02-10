import os
os.environ.setdefault('DATABASE_URL', 'postgresql://druguser:drugpass@localhost:5435/drugtrial')
from backend.db_models import get_session
from backend.agents.eligibility_matcher import EligibilityMatcher

session = get_session()
matcher = EligibilityMatcher(session)

def debug_patient(pid, tid, name):
    print(f'\n=== DEBUG {name} ({pid}) ===')
    r = matcher.evaluate_batch([pid], tid)[pid]
    
    print(f"Eligible: {r['eligible']}, Confidence: {r['confidence']}")
    print("-" * 60)
    print("INCLUSION CRITERIA:")
    for c in r['reasons']['inclusion_details']:
        status = "MET" if c['met'] else "FAIL"
        print(f"[{status}] {c['text'][:80]}...")
    
    print("-" * 60)
    print("EXCLUSION CRITERIA:")
    for c in r['reasons']['exclusion_details']:
        status = "FAIL" if c['met'] else "PASS"  # Met exclusion = FAIL eligibility
        print(f"[{status}] {c['text'][:80]}...")

# Debug T2Perf1 (Trial 2)
debug_patient('T2Perf1', 111, 'Trial 2')

# Debug T3Perf1 (Trial 3)
debug_patient('T3Perf1', 126, 'Trial 3')

# Debug BenPerf1 (BENDITA)
debug_patient('BenPerf1', 82, 'BENDITA')
