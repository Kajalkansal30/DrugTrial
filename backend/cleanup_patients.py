
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Setup DB
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://druguser:drugpass@localhost:5435/drugtrial")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
session = SessionLocal()

def remove_patients(offset, limit):
    print(f"Removing patients from index {offset+1} to {offset+limit}...")
    try:
        # Get the IDs first to ensure consistency across deletions
        rows = session.execute(text("SELECT id FROM patients ORDER BY id OFFSET :offset LIMIT :limit"), {"offset": offset, "limit": limit}).fetchall()
        id_list = [r[0] for r in rows]
        
        if not id_list:
            print("No patients found in that range.")
            return

        print(f"Found {len(id_list)} patients to delete: {id_list}")
        
        # Delete related data to satisfy foreign key constraints
        related_tables = [
            "conditions", "medications", "observations", 
            "allergies", "immunizations", "patient_eligibility"
        ]
        
        for table in related_tables:
            session.execute(text(f"DELETE FROM {table} WHERE patient_id IN :ids"), {"ids": tuple(id_list)})
            
        # Finally delete patients
        res = session.execute(text("DELETE FROM patients WHERE id IN :ids"), {"ids": tuple(id_list)})
        session.commit()
        print(f"Successfully deleted {res.rowcount} patients and their records.")
            
    except Exception as e:
        session.rollback()
        print(f"Error during deletion: {e}")
    finally:
        session.close()

if __name__ == "__main__":
    # Remove index 30 to 60 (1-indexed) -> offset 29, limit 31
    remove_patients(29, 31)
