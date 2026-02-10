
import os
import sys
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from backend.agents.eligibility_matcher import EligibilityMatcher
from backend.db_models import EligibilityCriteria, Patient, Condition

# Setup DB
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://druguser:drugpass@localhost:5435/drugtrial")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
session = SessionLocal()

def debug_eligibility(patient_id, trial_str_id):
    print(f"\n--- Debugging Patient {patient_id} for Trial {trial_str_id} ---")
    
    # 1. Get Trial ID (int)
    # The matcher takes int ID (db primary key) usually, OR we need to check how it's called.
    # In `main.py`: `matcher.evaluate_eligibility(request.patient_id, request.trial_id)`
    # App.js passes `trial_id` which might be the string ID or int ID?
    # `backend/routers/trials.py` usually resolves it.
    # Let's find the numeric ID for the string ID.
    try:
        t_row = session.execute(text("SELECT id, trial_id FROM clinical_trials WHERE trial_id = :tid"), {'tid': trial_str_id}).fetchone()
        if not t_row:
            print(f"Trial {trial_str_id} not found!")
            return
        
        trial_pk = t_row[0]
        print(f"Trial PK: {trial_pk} (ID: {trial_str_id})")
        
        # 2. Print Criteria
        criteria = session.query(EligibilityCriteria).filter_by(trial_id=trial_pk).all()
        print(f"\nFound {len(criteria)} criteria:")
        for c in criteria:
            print(f" - [{c.criterion_type.upper()}] {c.text} (Cat: {c.category}, Val: {c.value})")
            
        # 3. Print Patient Data
        p = session.query(Patient).filter_by(id=patient_id).first()
        if not p:
            print(f"Patient {patient_id} not found!")
            return
        print(f"\nPatient {p.first_name} {p.last_name}:")
        conds = session.query(Condition).filter_by(patient_id=patient_id).all()
        print(f" - Conditions: {[c.description for c in conds]}")
        
        # 4. Run Matcher
        matcher = EligibilityMatcher(db_session=session)
        result = matcher.evaluate_eligibility(patient_id, trial_pk)
        
        print("\n--- Result ---")
        print(f"Eligible: {result['eligible']}")
        print(f"Confidence: {result['confidence']}")
        print(f"Status: {result.get('status')}")
        print("\nReasons:")
        print(f"Hard Exclusions Met: {result['reasons'].get('hard_exclusions')}")
        print(f"Soft Exclusions Met: {result['reasons'].get('soft_exclusions')}")
        
        print("\nExclusion Details:")
        for d in result['reasons']['exclusion_details']:
            print(f" - {d['text']}: {'MET (Excluded)' if d['met'] else 'Not Met'} {'(HARD)' if d.get('is_hard') else ''}")

        print("\nInclusion Details:")
        for d in result['reasons']['inclusion_details']:
            print(f" - {d['text']}: {'MET' if d['met'] else 'Not Met'}")
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    # Default to P001 and TRIAL_DNDI_C473 (from screenshot)
    # Check if TRIAL_DNDI_C473 exists, otherwise list trials
    debug_eligibility('P001', 'TRIAL_DNDI_C473')
