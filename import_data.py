"""
Data Import Utility
Imports CSV data from your existing patient files into the configured database (PostgreSQL)
"""

import csv
import hashlib
from datetime import datetime
from backend.db_models import get_session, Patient, Condition, Medication, Observation, Allergy, Immunization, PatientVault
from backend.agents.deid_agent import DeIDAgent
import os

def get_deidentified_id(original_id: str) -> str:
    """Helper to consistently compute de-identified ID."""
    if not original_id: return None
    suffix = hashlib.sha256(original_id.encode()).hexdigest()[:12].upper()
    return f"PAT_{suffix}"

def import_patients(csv_path='data/sample_patients/patients.csv'):
    """Import patients from CSV with automated de-identification"""
    session = get_session()
    deid_agent = DeIDAgent()
    count = 0
    
    if not os.path.exists(csv_path):
        print(f"❌ File not found: {csv_path}")
        return 0
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Check if patient already exists using hash of original ID for idempotency
            original_id = row['Id']
            id_hash = hashlib.sha256(original_id.encode()).hexdigest()
            
            existing = session.query(Patient).filter_by(original_id_hash=id_hash).first()
            if existing:
                continue
            
            # De-identify data before storing
            anonymized_id = get_deidentified_id(original_id)
            
            raw_patient_data = {
                "id": original_id,
                "birthdate": row['BIRTHDATE'],
                "ssn": row['SSN'],
                "first_name": row['FIRST'],
                "last_name": row['LAST'],
                "gender": row['GENDER'],
                "race": row['RACE'],
                "ethnicity": row['ETHNICITY'],
                "city": row['CITY'],
                "state": row['STATE']
            }
            
            deid_result = deid_agent.deidentify_patient(raw_patient_data)
            research_record = deid_result['research_record']
            vault_pii = deid_result['vault_pii']
            
            # 1. Save Research Record (De-identified)
            patient = Patient(
                id=research_record['id'],
                birthdate=research_record['birthdate'],
                gender=research_record['gender'],
                race=research_record['race'],
                ethnicity=research_record['ethnicity'],
                city=research_record['city'],
                state=research_record['state'],
                is_deidentified=True,
                age_group=research_record['age_group'],
                original_id_hash=id_hash
            )
            session.add(patient)
            session.flush() # Get generated ID if needed
            
            # 2. Save PII to Vault
            vault_entry = PatientVault(
                patient_id=patient.id,
                encrypted_pii=vault_pii
            )
            session.add(vault_entry)
            
            count += 1
    
    session.commit()
    session.close()
    print(f"✅ Imported and De-identified {count} patients")
    return count
    
    session.commit()
    session.close()
    print(f"✅ Imported {count} patients")
    return count

def import_conditions(csv_path='data/sample_patients/conditions.csv'):
    """Import conditions from CSV"""
    session = get_session()
    count = 0
    
    if not os.path.exists(csv_path):
        print(f"❌ File not found: {csv_path}")
        return 0
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row['START'] or not row['PATIENT']:
                continue
            
            start_date = datetime.strptime(row['START'], '%Y-%m-%d').date()
            deid_id = get_deidentified_id(row['PATIENT'])
            
            existing = session.query(Condition).filter_by(
                patient_id=deid_id,
                code=row['CODE'],
                start_date=start_date
            ).first()
            if existing:
                continue

            condition = Condition(
                start_date=start_date,
                patient_id=deid_id,
                code=row['CODE'],
                description=row['DESCRIPTION']
            )
            session.add(condition)
            count += 1
    
    session.commit()
    session.close()
    print(f"✅ Imported {count} conditions")
    return count

def import_medications(csv_path='data/sample_patients/medications.csv'):
    """Import medications from CSV"""
    session = get_session()
    count = 0
    
    if not os.path.exists(csv_path):
        print(f"❌ File not found: {csv_path}")
        return 0
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row['START'] or not row['PATIENT']:
                continue
            
            start_date = datetime.strptime(row['START'], '%Y-%m-%d').date()
            deid_id = get_deidentified_id(row['PATIENT'])
            
            existing = session.query(Medication).filter_by(
                patient_id=deid_id,
                code=row['CODE'],
                start_date=start_date
            ).first()
            if existing:
                continue

            medication = Medication(
                start_date=start_date,
                patient_id=deid_id,
                code=row['CODE'],
                description=row['DESCRIPTION']
            )
            session.add(medication)
            count += 1
    
    session.commit()
    session.close()
    print(f"✅ Imported {count} medications")
    return count

def import_observations(csv_path='data/sample_patients/observations.csv'):
    """Import observations from CSV"""
    session = get_session()
    count = 0
    
    if not os.path.exists(csv_path):
        print(f"❌ File not found: {csv_path}")
        return 0
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row['DATE'] or not row['PATIENT']:
                continue
            
            observation_date = datetime.strptime(row['DATE'], '%Y-%m-%d').date()
            deid_id = get_deidentified_id(row['PATIENT'])
            
            existing = session.query(Observation).filter_by(
                patient_id=deid_id,
                code=row['CODE'],
                observation_date=observation_date
            ).first()
            if existing:
                continue

            observation = Observation(
                observation_date=observation_date,
                patient_id=deid_id,
                code=row['CODE'],
                description=row['DESCRIPTION'],
                value=row['VALUE'],
                units=row['UNITS']
            )
            session.add(observation)
            count += 1
    
    session.commit()
    session.close()
    print(f"✅ Imported {count} observations")
    return count

    print(f"✅ Imported {count} observations")
    return count

def import_allergies(csv_path='data/sample_patients/allergies.csv'):
    """Import allergies from CSV"""
    session = get_session()
    count = 0
    
    if not os.path.exists(csv_path):
        print(f"❌ File not found: {csv_path}")
        return 0
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row['START'] or not row['PATIENT']:
                continue
            
            # Check for duplicates based on patient, code, start date
            start_date = datetime.strptime(row['START'], '%Y-%m-%d').date() if row['START'] else None
            deid_id = get_deidentified_id(row['PATIENT'])
            
            existing = session.query(Allergy).filter_by(
                patient_id=deid_id,
                code=row['CODE'],
                start_date=start_date
            ).first()
            if existing:
                continue

            allergy = Allergy(
                start_date=start_date,
                patient_id=deid_id,
                code=row['CODE'],
                description=row['DESCRIPTION'],
                allergy_type=row['TYPE'],
                category=row['CATEGORY'],
                reaction1=row['REACTION1'],
                severity1=row['SEVERITY1'],
                reaction2=row['REACTION2'],
                severity2=row['SEVERITY2']
            )
            session.add(allergy)
            count += 1
    
    session.commit()
    session.close()
    print(f"✅ Imported {count} allergies")
    return count

def import_immunizations(csv_path='data/sample_patients/immunizations.csv'):
    """Import immunizations from CSV"""
    session = get_session()
    count = 0
    
    if not os.path.exists(csv_path):
        print(f"❌ File not found: {csv_path}")
        return 0
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row['DATE'] or not row['PATIENT']:
                continue
            
            immunization_date = datetime.strptime(row['DATE'], '%Y-%m-%d').date()
            deid_id = get_deidentified_id(row['PATIENT'])
            
            existing = session.query(Immunization).filter_by(
                patient_id=deid_id,
                code=row['CODE'],
                immunization_date=immunization_date
            ).first()
            if existing:
                continue

            immunization = Immunization(
                immunization_date=immunization_date,
                patient_id=deid_id,
                code=row['CODE'],
                description=row['DESCRIPTION'],
                base_cost=float(row['BASE_COST']) if row['BASE_COST'] else 0.0
            )
            session.add(immunization)
            count += 1
    
    session.commit()
    session.close()
    print(f"✅ Imported {count} immunizations")
    return count

def import_all_data():
    """Import all CSV data"""
    print("\n🔄 Starting data import...\n")
    
    # Import patients (already has duplicate check)
    import_patients()
    
    # These tables don't currently have duplicate checks in previous functions
    # For now, let's catch integrity errors at block level or just clear tables first?
    # Better approach: Add checks to all functions.
    import_conditions()
    import_medications()
    import_observations()
    import_allergies()
    import_immunizations()
    
    print("\n✨ Data import complete!\n")

if __name__ == "__main__":
    import_all_data()
