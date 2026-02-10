
import os
import sys
from sqlalchemy import create_engine, text
import json

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://druguser:drugpass@postgres:5432/drugtrial")
engine = create_engine(DATABASE_URL)

def inspect_json():
    with engine.connect() as conn:
        # Get sample rules including the JSON field
        res = conn.execute(text("""
            SELECT id, trial_id, criterion_type, category, operator, value, unit, negated, structured_data 
            FROM eligibility_criteria 
            WHERE structured_data IS NOT NULL
            LIMIT 10
        """))
        rules = [dict(row._mapping) for row in res]
        
        print(json.dumps(rules, indent=2, default=str))

if __name__ == "__main__":
    inspect_json()
