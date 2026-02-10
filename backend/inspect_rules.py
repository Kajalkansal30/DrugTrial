
import os
import sys
from sqlalchemy import create_engine, text
import json

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://druguser:drugpass@postgres:5432/drugtrial")
engine = create_engine(DATABASE_URL)

def find_rules():
    with engine.connect() as conn:
        # Find trials that have rules
        res = conn.execute(text("""
            SELECT t.id, t.trial_id, count(r.id) as rule_count 
            FROM clinical_trials t 
            JOIN eligibility_criteria r ON t.id = r.trial_id 
            GROUP BY t.id, t.trial_id 
            HAVING count(r.id) > 0 
            LIMIT 5
        """))
        trial_with_rules = [dict(row._mapping) for row in res]
        
        results = []
        for t in trial_with_rules:
            tid = t['id']
            rules_res = conn.execute(text("SELECT criterion_type, text, category, operator, value, unit FROM eligibility_criteria WHERE trial_id = :tid LIMIT 5"), {"tid": tid})
            t['rules'] = [dict(row._mapping) for row in rules_res]
            results.append(t)
            
        print(json.dumps(results, indent=2, default=str))

if __name__ == "__main__":
    find_rules()
