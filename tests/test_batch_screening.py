
import time
import sys
import os

# Add project root to path
sys.path.append(os.getcwd())

from backend.db_models import get_session, ClinicalTrial, Patient
from backend.agents.eligibility_matcher import EligibilityMatcher

def test_batch_performance():
    session = get_session()
    
    # Get BENDITA trial (id 82 usually, or by title)
    trial = session.query(ClinicalTrial).filter(ClinicalTrial.protocol_title.like('%BENDITA%')).first()
    if not trial:
        print("BENDITA trial not found. Using first available trial.")
        trial = session.query(ClinicalTrial).first()
        
    if not trial:
        print("No trials found.")
        return

    print(f"Testing with Trial: {trial.protocol_title} (ID: {trial.id})")

    # Get all patients
    patients = session.query(Patient).all()
    patient_ids = [p.id for p in patients]
    print(f"Testing with {len(patients)} patients.")
    
    matcher = EligibilityMatcher(db_session=session)

    # 1. Sequential Test
    print("\n--- Starting Sequential Test ---")
    start_time = time.time()
    seq_results = {}
    for pid in patient_ids:
        res = matcher.evaluate_eligibility(pid, trial.id)
        seq_results[pid] = res
    end_time = time.time()
    seq_duration = end_time - start_time
    print(f"Sequential Duration: {seq_duration:.4f} seconds")
    print(f"Average per patient: {seq_duration/len(patients):.4f} seconds")

    # 2. Batch Test
    print("\n--- Starting Batch Test ---")
    start_time = time.time()
    batch_results = matcher.evaluate_batch(patient_ids, trial.id)
    end_time = time.time()
    batch_duration = end_time - start_time
    print(f"Batch Duration: {batch_duration:.4f} seconds")
    print(f"Speedup Factor: {seq_duration / batch_duration:.2f}x")

    # 3. Validation
    print("\n--- Validating Results ---")
    mismatches = 0
    for pid in patient_ids:
        seq = seq_results[pid]
        batch = batch_results[pid]
        
        if seq['eligible'] != batch['eligible']:
            print(f"Mismatch for {pid}: Seq={seq['eligible']}, Batch={batch['eligible']}")
            mismatches += 1
        
        # Check reasons consistency?
        # Maybe extensive, but key is eligibility status.
    
    if mismatches == 0:
        print("SUCCESS: All results match!")
    else:
        print(f"FAILURE: {mismatches} mismatches found.")

    session.close()

if __name__ == "__main__":
    test_batch_performance()
