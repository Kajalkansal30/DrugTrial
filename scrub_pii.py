import hashlib
from datetime import datetime
from backend.db_models import (
    get_session, Patient, PatientVault, Condition, Medication, 
    Observation, Allergy, Immunization, PatientEligibility, EligibilityAudit
)
from backend.agents.deid_agent import DeIDAgent
from sqlalchemy.orm import Session

def get_deid_id(original_id):
    suffix = hashlib.sha256(original_id.encode()).hexdigest()[:12].upper()
    return f"PAT_{suffix}"

def scrub_legacy_data():
    """Migrates legacy plain-text patients with collision handling."""
    session = get_session()
    deid_agent = DeIDAgent()
    
    print("🛡️ Starting Security Scrub of legacy PII...")
    
    # 1. Find all patients not yet de-identified
    legacy_ids = [p.id for p in session.query(Patient).filter_by(is_deidentified=False).all()]
    count = len(legacy_ids)
    
    if count == 0:
        print("✅ No PII leaks detected. System is secure.")
        session.close()
        return

    print(f"🕵️ Found {count} legacy records to scrub.")
    
    for i, old_id in enumerate(legacy_ids):
        new_id = get_deid_id(old_id)
        
        p = session.query(Patient).filter_by(id=old_id).first()
        if not p: continue

        # Prepare de-id data
        raw_data = {
            "id": old_id,
            "birthdate": p.birthdate,
            "ssn": p.ssn,
            "first_name": p.first_name,
            "last_name": p.last_name,
            "gender": p.gender,
            "race": p.race,
            "ethnicity": p.ethnicity,
            "city": p.city,
            "state": p.state
        }
        
        res = deid_agent.deidentify_patient(raw_data)
        research = res['research_record']
        vault_pii = res['vault_pii']
        
        try:
            # Check if NEW ID already exists
            existing_new = session.query(Patient).filter_by(id=new_id).first()
            
            if not existing_new:
                # 1. Create the NEW De-identified Patient record
                new_patient = Patient(
                    id=new_id,
                    birthdate=research['birthdate'],
                    gender=p.gender,
                    race=p.race,
                    ethnicity=p.ethnicity,
                    city="REDACTED",
                    state=p.state,
                    is_deidentified=True,
                    age_group=research['age_group'],
                    original_id_hash=research['original_id_hash']
                )
                session.add(new_patient)
                session.flush()

                # 2. Create Vault entry
                vault_entry = PatientVault(
                    patient_id=new_id,
                    encrypted_pii=vault_pii
                )
                session.add(vault_entry)
            else:
                print(f"ℹ️  Merging legacy {old_id} into existing {new_id}")

            # 3. Update ALL referencing tables (Merge step)
            session.query(Condition).filter_by(patient_id=old_id).update({Condition.patient_id: new_id})
            session.query(Medication).filter_by(patient_id=old_id).update({Medication.patient_id: new_id})
            session.query(Observation).filter_by(patient_id=old_id).update({Observation.patient_id: new_id})
            session.query(Allergy).filter_by(patient_id=old_id).update({Allergy.patient_id: new_id})
            session.query(Immunization).filter_by(patient_id=old_id).update({Immunization.patient_id: new_id})
            session.query(PatientEligibility).filter_by(patient_id=old_id).update({PatientEligibility.patient_id: new_id})
            session.query(EligibilityAudit).filter_by(patient_id=old_id).update({EligibilityAudit.patient_id: new_id})

            # 4. Delete the original legacy record
            session.delete(p)
            session.flush()
            
            if (i + 1) % 10 == 0:
                print(f"✔️ Processed {i+1}/{count}...")
                session.commit()
                
        except Exception as e:
            print(f"❌ Error scrubbing patient {old_id}: {e}")
            session.rollback()
            session.close()
            return

    session.commit()
    print(f"✅ SUCCESS: {count} patients migrated to secure Vault.")
    session.close()

if __name__ == "__main__":
    scrub_legacy_data()
