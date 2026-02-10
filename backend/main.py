"""
FastAPI Main Application
Drug Trial Automation System
WARNING: This file is deprecated. Use app.py in the project root instead.
"""

import warnings
warnings.warn("backend/main.py is deprecated. Use app.py instead.", DeprecationWarning)

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from pydantic import BaseModel
from typing import List, Optional
import os
import sys

# Add current directory to path for imports

from backend.routers import trials
from backend.routers import fda_router

# Initialize FastAPI app
app = FastAPI(
    title="Drug Trial Automation API",
    description="End-to-end automated drug trial system",
    version="1.0.0"
)

# Include routers
app.include_router(trials.router)
app.include_router(fda_router.router, prefix="/api/fda", tags=["FDA Forms"])

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database connection
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://drugtrial:drugtrial123@localhost:5432/clinical_trials")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Pydantic Models
class PatientBase(BaseModel):
    id: str
    first_name: str
    last_name: str
    birthdate: str
    gender: str
    
class TrialBase(BaseModel):
    trial_id: str
    protocol_title: str
    phase: str
    indication: str
    drug_name: str
    status: str

class EligibilityRequest(BaseModel):
    patient_id: str
    trial_id: int

class EligibilityResponse(BaseModel):
    patient_id: str
    trial_id: int
    eligibility_status: str
    confidence_score: float
    reasons: dict

# Routes
@app.get("/")
async def root():
    return {
        "message": "Drug Trial Automation API",
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}

@app.get("/api/patients")
async def get_patients(db: Session = Depends(get_db)):
    """Get all patients"""
    result = db.execute(text("SELECT id, first_name, last_name, birthdate, gender FROM patients LIMIT 100"))
    patients = [
        {
            "id": row[0],
            "first_name": row[1],
            "last_name": row[2],
            "birthdate": str(row[3]),
            "gender": row[4]
        }
        for row in result
    ]
    return {"patients": patients, "count": len(patients)}

@app.get("/api/patients/{patient_id}")
async def get_patient_details(patient_id: str, db: Session = Depends(get_db)):
    """Get detailed patient information"""
    # Get patient basic info
    patient_result = db.execute(
        text("SELECT * FROM patients WHERE id = :id"),
        {"id": patient_id}
    ).fetchone()
    
    if not patient_result:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    # Get conditions
    conditions = db.execute(
        text("SELECT code, description, start_date FROM conditions WHERE patient_id = :id"),
        {"id": patient_id}
    ).fetchall()
    
    # Get medications
    medications = db.execute(
        text("SELECT code, description, start_date FROM medications WHERE patient_id = :id"),
        {"id": patient_id}
    ).fetchall()
    
    # Get observations
    observations = db.execute(
        text("SELECT code, description, value, units, observation_date FROM observations WHERE patient_id = :id ORDER BY observation_date DESC LIMIT 20"),
        {"id": patient_id}
    ).fetchall()
    
    return {
        "patient_id": patient_id,
        "conditions": [{"code": c[0], "description": c[1], "start_date": str(c[2])} for c in conditions],
        "medications": [{"code": m[0], "description": m[1], "start_date": str(m[2])} for m in medications],
        "observations": [{"code": o[0], "description": o[1], "value": o[2], "units": o[3], "date": str(o[4])} for o in observations]
    }

@app.get("/api/trials")
async def get_trials(db: Session = Depends(get_db)):
    """Get all clinical trials"""
    result = db.execute(text("SELECT id, trial_id, protocol_title, phase, indication, drug_name, status FROM clinical_trials"))
    trials = [
        {
            "id": row[0],
            "trial_id": row[1],
            "protocol_title": row[2],
            "phase": row[3],
            "indication": row[4],
            "drug_name": row[5],
            "status": row[6]
        }
        for row in result
    ]
    return {"trials": trials, "count": len(trials)}

@app.post("/api/eligibility/check")
async def check_eligibility(request: EligibilityRequest, db: Session = Depends(get_db)):
    """Check patient eligibility for a trial using AI agents"""
    from agents.eligibility_matcher import EligibilityMatcher
    
    matcher = EligibilityMatcher(db_session=db)
    
    try:
        # The agent expects integer trial_id based on db_models
        # App.js passes trial_id from pydantic which is int
        result = matcher.evaluate_eligibility(request.patient_id, request.trial_id)
        
        status = "eligible" if result.get('eligible') else "ineligible"
        
        return {
            "patient_id": request.patient_id,
            "trial_id": request.trial_id,
            "eligibility_status": status,
            "confidence_score": result.get('confidence', 0.0),
            "reasons": result.get('reasons', {})
        }
    except Exception as e:
        print(f"Error in eligibility check: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/data/import")
async def import_patient_data(db: Session = Depends(get_db)):
    """Import patient data from CSV files"""
    import csv
    import os
    
    data_dir = "data/sample_patients"
    
    if not os.path.exists(data_dir):
        raise HTTPException(status_code=404, detail="Data directory not found")
    
    # Import Patients
    patients_file = f"{data_dir}/patients.csv"
    count = 0
    if os.path.exists(patients_file):
        with open(patients_file, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                db.execute(text("""
                    INSERT INTO patients (id, birthdate, ssn, drivers, passport, prefix, first_name, middle_name, last_name, 
                                         marital_status, race, ethnicity, gender, birthplace, address, city, state, county, 
                                         fips, zip, lat, lon, healthcare_expenses, healthcare_coverage, income)
                    VALUES (:id, :birthdate, :ssn, :drivers, :passport, :prefix, :first, :middle, :last,
                           :marital, :race, :ethnicity, :gender, :birthplace, :address, :city, :state, :county,
                           :fips, :zip, :lat, :lon, :expenses, :coverage, :income)
                    ON CONFLICT (id) DO NOTHING
                """), {
                    "id": row['Id'],
                    "birthdate": row['BIRTHDATE'],
                    "ssn": row['SSN'],
                    "drivers": row['DRIVERS'],
                    "passport": row['PASSPORT'],
                    "prefix": row['PREFIX'],
                    "first": row['FIRST'],
                    "middle": row.get('MIDDLE', ''),
                    "last": row['LAST'],
                    "marital": row.get('MARITAL', ''),
                    "race": row['RACE'],
                    "ethnicity": row['ETHNICITY'],
                    "gender": row['GENDER'],
                    "birthplace": row['BIRTHPLACE'],
                    "address": row['ADDRESS'],
                    "city": row['CITY'],
                    "state": row['STATE'],
                    "county": row['COUNTY'],
                    "fips": row['FIPS'],
                    "zip": row['ZIP'],
                    "lat": float(row['LAT']),
                    "lon": float(row['LON']),
                    "expenses": float(row['HEALTHCARE_EXPENSES']),
                    "coverage": float(row['HEALTHCARE_COVERAGE']),
                    "income": float(row['INCOME'])
                })
                count += 1
            print(f"Imported {count} patients")

    # Import Conditions
    conditions_file = f"{data_dir}/conditions.csv"
    cond_count = 0
    if os.path.exists(conditions_file):
        with open(conditions_file, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if not row['START'] or not row['PATIENT']: continue
                db.execute(text("""
                    INSERT INTO conditions (start_date, patient_id, encounter_id, system, code, description)
                    VALUES (:start, :patient, :encounter, :system, :code, :desc)
                """), {
                    "start": row['START'],
                    "patient": row['PATIENT'],
                    "encounter": row['ENCOUNTER'],
                    "system": row['SYSTEM'],
                    "code": row['CODE'],
                    "desc": row['DESCRIPTION']
                })
                cond_count += 1
            print(f"Imported {cond_count} conditions")

    # Import Medications
    meds_file = f"{data_dir}/medications.csv"
    med_count = 0
    if os.path.exists(meds_file):
        with open(meds_file, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if not row['START'] or not row['PATIENT']: continue
                db.execute(text("""
                    INSERT INTO medications (start_date, patient_id, payer_id, encounter_id, code, description,
                                            base_cost, payer_coverage, dispenses, total_cost, reason_code, reason_description)
                    VALUES (:start, :patient, :payer, :encounter, :code, :desc,
                           :cost, :coverage, :dispenses, :total, :reason_code, :reason_desc)
                """), {
                    "start": row['START'],
                    "patient": row['PATIENT'],
                    "payer": row['PAYER'],
                    "encounter": row.get('ENCOUNTER'),
                    "code": row['CODE'],
                    "desc": row['DESCRIPTION'],
                    "cost": float(row['BASE_COST'] or 0),
                    "coverage": float(row['PAYER_COVERAGE'] or 0),
                    "dispenses": int(row['DISPENSES'] or 0),
                    "total": float(row['TOTALCOST'] or 0),
                    "reason_code": row.get('REASONCODE'),
                    "reason_desc": row.get('REASONDESCRIPTION')
                })
                med_count += 1
            print(f"Imported {med_count} medications")

    # Import Observations
    obs_file = f"{data_dir}/observations.csv"
    obs_count = 0
    if os.path.exists(obs_file):
        with open(obs_file, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if not row['DATE'] or not row['PATIENT']: continue
                db.execute(text("""
                    INSERT INTO observations (observation_date, patient_id, encounter_id, category, code, description, value, units, type)
                    VALUES (:date, :patient, :encounter, :category, :code, :desc, :value, :units, :type)
                """), {
                    "date": row['DATE'],
                    "patient": row['PATIENT'],
                    "encounter": row.get('ENCOUNTER'),
                    "category": row.get('CATEGORY'),
                    "code": row['CODE'],
                    "desc": row['DESCRIPTION'],
                    "value": row['VALUE'],
                    "units": row['UNITS'],
                    "type": row.get('TYPE')
                })
                obs_count += 1
            print(f"Imported {obs_count} observations")

    # Import Allergies
    alg_file = f"{data_dir}/allergies.csv"
    alg_count = 0
    if os.path.exists(alg_file):
        with open(alg_file, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if not row['START'] or not row['PATIENT']: continue
                db.execute(text("""
                    INSERT INTO allergies (start_date, patient_id, encounter_id, code, description, type, category, reaction1, severity1)
                    VALUES (:start, :patient, :encounter, :code, :desc, :type, :category, :reaction, :severity)
                """), {
                    "start": row['START'],
                    "patient": row['PATIENT'],
                    "encounter": row.get('ENCOUNTER'),
                    "code": row['CODE'],
                    "desc": row['DESCRIPTION'],
                    "type": row.get('TYPE'),
                    "category": row.get('CATEGORY'),
                    "reaction": row.get('REACTION1'),
                    "severity": row.get('SEVERITY1')
                })
                alg_count += 1
            print(f"Imported {alg_count} allergies")

    # Import Immunizations
    imm_file = f"{data_dir}/immunizations.csv"
    imm_count = 0
    if os.path.exists(imm_file):
        with open(imm_file, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if not row['DATE'] or not row['PATIENT']: continue
                db.execute(text("""
                    INSERT INTO immunizations (immunization_date, patient_id, encounter_id, code, description, base_cost)
                    VALUES (:date, :patient, :encounter, :code, :desc, :cost)
                """), {
                    "date": row['DATE'],
                    "patient": row['PATIENT'],
                    "encounter": row.get('ENCOUNTER'),
                    "code": row['CODE'],
                    "desc": row['DESCRIPTION'],
                    "cost": float(row['BASE_COST'] or 0)
                })
                imm_count += 1
            print(f"Imported {imm_count} immunizations")

    db.commit()
    
    return {
        "message": "Data import completed", 
        "summary": {
            "patients": count,
            "conditions": cond_count,
            "medications": med_count,
            "observations": obs_count,
            "allergies": alg_count,
            "immunizations": imm_count
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8201)
