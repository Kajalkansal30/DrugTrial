
import os
import sys
from sqlalchemy import create_engine, text
import json

# Add parent directory to path to import backend modules if needed
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://druguser:drugpass@postgres:5432/drugtrial")
engine = create_engine(DATABASE_URL)

def inspect():
    with engine.connect() as conn:
        # Get patient count
        count_res = conn.execute(text("SELECT count(*) FROM patients"))
        patient_count = count_res.scalar()
        
        # Get trial count
        trial_res = conn.execute(text("SELECT count(*) FROM clinical_trials"))
        trial_count = trial_res.scalar()
        
        # Get rule count
        rule_res = conn.execute(text("SELECT count(*) FROM eligibility_criteria"))
        rule_count = rule_res.scalar()
        
        # Get sample trials
        trials_res = conn.execute(text("SELECT id, trial_id, protocol_title, phase, drug_name FROM clinical_trials LIMIT 5"))
        trials = [dict(row._mapping) for row in trials_res]
        
        # Get sample rules for first trial
        if trials:
            tid = trials[0]['id']
            rules_res = conn.execute(text("SELECT criterion_type, text, category, operator, value, unit FROM eligibility_criteria WHERE trial_id = :tid LIMIT 10"), {"tid": tid})
            rules = [dict(row._mapping) for row in rules_res]
        else:
            rules = []

        data = {
            "counts": {
                "patients": patient_count,
                "trials": trial_count,
                "rules": rule_count
            },
            "sample_trials": trials,
            "sample_rules": rules
        }
        
        print(json.dumps(data, indent=2, default=str))

if __name__ == "__main__":
    inspect()
