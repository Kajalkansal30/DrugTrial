
from sqlalchemy import create_engine, text
import os

def migrate():
    # Connect to Docker Postgres (exposed on port 5435) from host
    db_url = os.getenv("DATABASE_URL", "postgresql://druguser:drugpass@localhost:5435/drugtrial")
    engine = create_engine(db_url)
    
    print(f"Connecting to {db_url}...")
    
    with engine.connect() as conn:
        print("Checking for missing columns...")
        
        # Add negated column if missing
        try:
            conn.execute(text("ALTER TABLE eligibility_criteria ADD COLUMN IF NOT EXISTS negated BOOLEAN DEFAULT FALSE;"))
            conn.commit()
            print("✅ Verified 'negated' column in eligibility_criteria.")
        except Exception as e:
            print(f"❌ Error adding 'negated': {e}")
            conn.rollback()
        
        # Add structured_data column if missing
        try:
            conn.execute(text("ALTER TABLE eligibility_criteria ADD COLUMN IF NOT EXISTS structured_data JSON;"))
            conn.commit()
            print("✅ Verified 'structured_data' column in eligibility_criteria.")
        except Exception as e:
            print(f"❌ Error adding 'structured_data': {e}")
            conn.rollback()
        
        # Add document_id column to clinical_trials if missing
        try:
            conn.execute(text("ALTER TABLE clinical_trials ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES fda_documents(id);"))
            conn.commit()
            print("✅ Verified 'document_id' column in clinical_trials.")
        except Exception as e:
            print(f"❌ Error adding 'document_id': {e}")
            conn.rollback()

    print("Migration complete.")

if __name__ == "__main__":
    migrate()
