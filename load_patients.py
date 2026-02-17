#!/usr/bin/env python3
"""
Load patients from CSV files into the database with HIPAA-compliant de-identification.

Reads raw patient data from data/sample_patients/*.csv, de-identifies PII using
DeIDAgent, stores de-identified records in the patients table and original PII
in the patient_vault table. All clinical data (conditions, medications, observations,
allergies, immunizations) is linked via the pseudonymized patient ID.
"""

import os
import csv
from datetime import datetime

os.environ.setdefault("DATABASE_URL", "postgresql://druguser:drugpass@localhost:5435/drugtrial")

from backend.db_models import (
    get_session, Patient, PatientVault, Condition, Medication,
    Observation, Allergy, Immunization
)
from backend.agents.deid_agent import DeIDAgent

DATA_DIR = "data/sample_patients"

def load_all():
    session = get_session()
    deid = DeIDAgent(load_nlp=False)

    id_map = {}

    # ── 1. Load & de-identify patients ──────────────────────────────────
    patients_file = os.path.join(DATA_DIR, "patients.csv")
    pat_count = 0
    with open(patients_file, "r") as f:
        for row in csv.DictReader(f):
            raw = {
                "id": row["Id"],
                "first_name": row["FIRST"],
                "last_name": row["LAST"],
                "ssn": row["SSN"],
                "birthdate": row["BIRTHDATE"],
                "gender": row["GENDER"],
                "race": row["RACE"],
                "ethnicity": row["ETHNICITY"],
                "city": row["CITY"],
                "state": row["STATE"],
            }

            result = deid.deidentify_patient(raw)
            rec = result["research_record"]
            vault = result["vault_pii"]

            original_id = row["Id"]
            anon_id = rec["id"]
            id_map[original_id] = anon_id

            p = Patient(
                id=anon_id,
                birthdate=rec["birthdate"],
                gender=rec["gender"],
                race=rec["race"],
                ethnicity=rec["ethnicity"],
                city=rec["city"],
                state=rec["state"],
                first_name=None,
                last_name=None,
                ssn=None,
                is_deidentified=True,
                age_group=rec["age_group"],
                original_id_hash=rec["original_id_hash"],
            )
            session.merge(p)

            pv = PatientVault(
                patient_id=anon_id,
                encrypted_pii=vault,
            )
            existing_vault = session.query(PatientVault).filter_by(patient_id=anon_id).first()
            if existing_vault:
                existing_vault.encrypted_pii = vault
            else:
                session.add(pv)

            pat_count += 1

    session.flush()
    print(f"Loaded {pat_count} de-identified patients")

    # ── 2. Load conditions ──────────────────────────────────────────────
    cond_file = os.path.join(DATA_DIR, "conditions.csv")
    cond_count = 0
    if os.path.exists(cond_file):
        with open(cond_file, "r") as f:
            for row in csv.DictReader(f):
                pid = id_map.get(row["PATIENT"])
                if not pid or not row["START"]:
                    continue
                session.add(Condition(
                    start_date=datetime.strptime(row["START"], "%Y-%m-%d").date(),
                    patient_id=pid,
                    code=row.get("CODE", ""),
                    description=row.get("DESCRIPTION", ""),
                ))
                cond_count += 1
    print(f"Loaded {cond_count} conditions")

    # ── 3. Load medications ─────────────────────────────────────────────
    med_file = os.path.join(DATA_DIR, "medications.csv")
    med_count = 0
    if os.path.exists(med_file):
        with open(med_file, "r") as f:
            for row in csv.DictReader(f):
                pid = id_map.get(row["PATIENT"])
                if not pid or not row["START"]:
                    continue
                session.add(Medication(
                    start_date=datetime.strptime(row["START"], "%Y-%m-%d").date(),
                    patient_id=pid,
                    code=row.get("CODE", ""),
                    description=row.get("DESCRIPTION", ""),
                ))
                med_count += 1
    print(f"Loaded {med_count} medications")

    # ── 4. Load observations ────────────────────────────────────────────
    obs_file = os.path.join(DATA_DIR, "observations.csv")
    obs_count = 0
    if os.path.exists(obs_file):
        with open(obs_file, "r") as f:
            for row in csv.DictReader(f):
                pid = id_map.get(row["PATIENT"])
                if not pid or not row["DATE"]:
                    continue
                session.add(Observation(
                    observation_date=datetime.strptime(row["DATE"], "%Y-%m-%d").date(),
                    patient_id=pid,
                    code=row.get("CODE", ""),
                    description=row.get("DESCRIPTION", ""),
                    value=row.get("VALUE", ""),
                    units=row.get("UNITS", ""),
                ))
                obs_count += 1
    print(f"Loaded {obs_count} observations")

    # ── 5. Load allergies ───────────────────────────────────────────────
    alg_file = os.path.join(DATA_DIR, "allergies.csv")
    alg_count = 0
    if os.path.exists(alg_file):
        with open(alg_file, "r") as f:
            for row in csv.DictReader(f):
                pid = id_map.get(row["PATIENT"])
                if not pid or not row["START"]:
                    continue
                session.add(Allergy(
                    start_date=datetime.strptime(row["START"], "%Y-%m-%d").date(),
                    patient_id=pid,
                    code=row.get("CODE", ""),
                    description=row.get("DESCRIPTION", ""),
                    allergy_type=row.get("TYPE", ""),
                    category=row.get("CATEGORY", ""),
                    reaction1=row.get("REACTION1", ""),
                    severity1=row.get("SEVERITY1", ""),
                ))
                alg_count += 1
    print(f"Loaded {alg_count} allergies")

    # ── 6. Load immunizations ───────────────────────────────────────────
    imm_file = os.path.join(DATA_DIR, "immunizations.csv")
    imm_count = 0
    if os.path.exists(imm_file):
        with open(imm_file, "r") as f:
            for row in csv.DictReader(f):
                pid = id_map.get(row["PATIENT"])
                if not pid or not row["DATE"]:
                    continue
                session.add(Immunization(
                    immunization_date=datetime.strptime(row["DATE"], "%Y-%m-%d").date(),
                    patient_id=pid,
                    code=row.get("CODE", ""),
                    description=row.get("DESCRIPTION", ""),
                    base_cost=float(row.get("BASE_COST", 0) or 0),
                ))
                imm_count += 1
    print(f"Loaded {imm_count} immunizations")

    # ── Commit ──────────────────────────────────────────────────────────
    session.commit()
    session.close()

    print(f"\nDone! Loaded {pat_count} de-identified patients with all clinical data.")
    print(f"  Conditions:    {cond_count}")
    print(f"  Medications:   {med_count}")
    print(f"  Observations:  {obs_count}")
    print(f"  Allergies:     {alg_count}")
    print(f"  Immunizations: {imm_count}")
    print(f"  Vault entries: {pat_count}")


if __name__ == "__main__":
    load_all()
