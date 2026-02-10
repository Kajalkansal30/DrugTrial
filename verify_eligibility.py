#!/usr/bin/env python3
"""
Eligibility Verification Script

Compares the automated EligibilityMatcher results with a manual evaluation
to verify the matching is working correctly.
"""

import os
import sys
from datetime import datetime
from tabulate import tabulate

# Set up database URL for local development
os.environ.setdefault("DATABASE_URL", "postgresql://druguser:drugpass@localhost:5435/drugtrial")

from backend.db_models import get_session, Patient, Condition, Medication, Observation, EligibilityCriteria, ClinicalTrial
from backend.agents.eligibility_matcher import EligibilityMatcher


def calculate_age(birthdate):
    """Calculate age from birthdate"""
    if not birthdate:
        return None
    today = datetime.now().date()
    return (today - birthdate).days // 365


def manual_evaluate_criterion(patient_data, criterion):
    """
    Manually evaluate a single criterion against patient data.
    Returns: (is_met, reason)
    """
    patient = patient_data['patient']
    conditions = patient_data['conditions']
    medications = patient_data['medications']
    observations = patient_data['observations']
    
    category = (criterion.category or "").upper()
    criterion_text = criterion.text.lower()
    
    # Age criteria
    if category == 'AGE' or 'age' in criterion_text[:20]:
        age = calculate_age(patient.birthdate)
        if age is None:
            return None, "No birthdate"
        
        # Parse age requirements from criterion
        if criterion.operator == 'BETWEEN' and criterion.value:
            if '-' in criterion.value:
                try:
                    v1, v2 = map(float, criterion.value.split('-'))
                    is_met = v1 <= age <= v2
                    return is_met, f"Age={age}, range={v1}-{v2}"
                except:
                    pass
        elif criterion.operator == '>=':
            try:
                min_age = float(criterion.value)
                is_met = age >= min_age
                return is_met, f"Age={age}, min={min_age}"
            except:
                pass
        elif criterion.operator == '<=':
            try:
                max_age = float(criterion.value)
                is_met = age <= max_age
                return is_met, f"Age={age}, max={max_age}"
            except:
                pass
        
        return None, f"Age={age}, couldn't parse criterion"
    
    # Diagnosis/Condition criteria
    elif category in ['DIAGNOSIS', 'CONDITION_PRESENT', 'MEDICAL_HISTORY', 'HISTORY']:
        # Look for matching conditions
        search_terms = []
        if criterion.value:
            search_terms.append(criterion.value.lower())
        # Also extract key terms from criterion text
        key_medical_terms = ['diabetes', 'hypertension', 'htn', 'kidney', 'ckd', 'renal', 
                            'asthma', 'copd', 'bronchitis', 'cancer', 'tumor', 'hiv', 
                            'hepatitis', 'heart', 'cardiac', 'stroke', 'pregnant']
        for term in key_medical_terms:
            if term in criterion_text:
                search_terms.append(term)
        
        matched_conditions = []
        for cond in conditions:
            desc = (cond.description or "").lower()
            for term in search_terms:
                if term in desc:
                    matched_conditions.append(cond.description)
                    break
        
        is_met = len(matched_conditions) > 0
        if is_met:
            return True, f"Found: {', '.join(matched_conditions[:2])}"
        return False, f"No match for: {search_terms}"
    
    # Lab/Observation criteria  
    elif category in ['LAB', 'LAB_THRESHOLD', 'LAB_RESULT', 'VITAL_SIGN', 'VITALS', 'MEASUREMENT', 'OBSERVATION']:
        # Try to find matching observation
        lab_terms = []
        if criterion.unit and not criterion.unit[0].isdigit():
            lab_terms.append(criterion.unit.lower())
        
        # Extract lab terms from text
        lab_keywords = ['hba1c', 'a1c', 'hemoglobin', 'creatinine', 'egfr', 'gfr',
                       'blood pressure', 'systolic', 'diastolic', 'glucose', 'cholesterol',
                       'potassium', 'sodium', 'platelets', 'wbc', 'rbc']
        for kw in lab_keywords:
            if kw in criterion_text:
                lab_terms.append(kw)
        
        matching_obs = []
        for obs in observations:
            desc = (obs.description or "").lower()
            for term in lab_terms:
                if term in desc:
                    matching_obs.append(obs)
                    break
        
        if not matching_obs:
            return None, f"No obs for: {lab_terms}"
        
        # Get most recent
        latest = max(matching_obs, key=lambda x: x.observation_date)
        
        try:
            val_str = str(latest.value).replace('%', '').strip()
            if val_str.startswith('<') or val_str.startswith('>'):
                val_str = val_str[1:]
            value = float(val_str)
            
            # Get threshold
            threshold = 0.0
            if criterion.value:
                v_clean = criterion.value.replace('>', '').replace('<', '').replace('=', '').replace('%', '').strip()
                threshold = float(v_clean)
            
            op = criterion.operator or '=='
            if op == '>':
                is_met = value > threshold
            elif op == '>=':
                is_met = value >= threshold
            elif op == '<':
                is_met = value < threshold
            elif op == '<=':
                is_met = value <= threshold
            else:
                is_met = value == threshold
            
            return is_met, f"Value={value}, op={op}, threshold={threshold}"
        except Exception as e:
            return None, f"Parse error: {e}"
    
    # Medication criteria
    elif category in ['MEDICATION', 'DRUG', 'MEDICATION_HISTORY']:
        search_terms = []
        if criterion.value:
            search_terms.append(criterion.value.lower())
        
        matched_meds = []
        for med in medications:
            desc = (med.description or "").lower()
            for term in search_terms:
                if term in desc:
                    matched_meds.append(med.description)
                    break
        
        is_met = len(matched_meds) > 0
        if is_met:
            return True, f"Found: {', '.join(matched_meds[:2])}"
        return False, f"No match for: {search_terms}"
    
    # Fallback: keyword search
    else:
        # Search for any keywords from criterion text in all patient data
        all_text = []
        for c in conditions:
            all_text.append((c.description or "").lower())
        for m in medications:
            all_text.append((m.description or "").lower())
        for o in observations:
            all_text.append((o.description or "").lower())
        
        combined = " ".join(all_text)
        
        # Extract key words from criterion
        words = criterion_text.split()
        significant_words = [w for w in words if len(w) > 4 and w.isalpha()]
        
        matched = [w for w in significant_words[:5] if w in combined]
        
        if len(matched) >= 2:
            return True, f"Keyword match: {matched}"
        elif len(matched) == 1:
            return None, f"Weak match: {matched}"
        return False, "No keyword match"


def print_patient_summary(patient_data):
    """Print a summary of patient data"""
    p = patient_data['patient']
    age = calculate_age(p.birthdate)
    
    print(f"\n{'='*60}")
    print(f"PATIENT: {p.id} - {p.first_name} {p.last_name}")
    print(f"{'='*60}")
    print(f"  Age: {age} | Gender: {p.gender} | Location: {p.city}, {p.state}")
    
    print(f"\n  CONDITIONS ({len(patient_data['conditions'])}):")
    for c in patient_data['conditions']:
        print(f"    - [{c.code}] {c.description}")
    
    print(f"\n  OBSERVATIONS ({len(patient_data['observations'])}):")
    for o in patient_data['observations']:
        print(f"    - {o.observation_date}: {o.description} = {o.value} {o.units}")
    
    print(f"\n  MEDICATIONS ({len(patient_data['medications'])}):")
    for m in patient_data['medications']:
        print(f"    - {m.description}")


def compare_eligibility(session, patient_id, trial_id):
    """Compare automated vs manual eligibility evaluation"""
    
    # Get trial info
    trial = session.query(ClinicalTrial).filter_by(id=trial_id).first()
    if not trial:
        print(f"Trial {trial_id} not found!")
        return
    
    print(f"\n{'#'*70}")
    print(f"# TRIAL: {trial.trial_id} - {trial.protocol_title[:50] if trial.protocol_title else 'N/A'}...")
    print(f"# Phase: {trial.phase} | Drug: {trial.drug_name}")
    print(f"{'#'*70}")
    
    # Get criteria
    criteria = session.query(EligibilityCriteria).filter_by(trial_id=trial_id).all()
    if not criteria:
        print("No eligibility criteria found for this trial!")
        return None, None
    
    print(f"\nFound {len(criteria)} eligibility criteria")
    
    # Get patient data
    patient = session.query(Patient).filter_by(id=patient_id).first()
    if not patient:
        print(f"Patient {patient_id} not found!")
        return
    
    conditions = session.query(Condition).filter_by(patient_id=patient_id).all()
    medications = session.query(Medication).filter_by(patient_id=patient_id).all()
    observations = session.query(Observation).filter_by(patient_id=patient_id).all()
    
    patient_data = {
        'patient': patient,
        'conditions': conditions,
        'medications': medications,
        'observations': observations
    }
    
    print_patient_summary(patient_data)
    
    # Get automated result
    matcher = EligibilityMatcher(session)
    auto_result = matcher.evaluate_eligibility(patient_id, trial_id)
    
    # Manual evaluation
    print(f"\n{'-'*60}")
    print("CRITERION-BY-CRITERION COMPARISON")
    print(f"{'-'*60}")
    
    comparison_rows = []
    manual_inclusion_met = 0
    manual_exclusion_met = 0
    
    for criterion in criteria:
        # Manual evaluation
        manual_met, manual_reason = manual_evaluate_criterion(patient_data, criterion)
        
        # Get automated result for this criterion
        auto_met = None
        if auto_result and 'reasons' in auto_result:
            if criterion.criterion_type == 'inclusion':
                for detail in auto_result['reasons'].get('inclusion_details', []):
                    if detail['text'] == criterion.text:
                        auto_met = detail['met']
                        break
            else:
                for detail in auto_result['reasons'].get('exclusion_details', []):
                    if detail['text'] == criterion.text:
                        auto_met = detail['met']
                        break
        
        # Track manual results
        if criterion.criterion_type == 'inclusion' and manual_met:
            manual_inclusion_met += 1
        elif criterion.criterion_type == 'exclusion' and manual_met:
            manual_exclusion_met += 1
        
        # Compare
        match = "✓" if manual_met == auto_met else "✗"
        if manual_met is None:
            match = "?"
        
        comparison_rows.append([
            criterion.criterion_type.upper()[:3],
            criterion.category or "?",
            criterion.text[:40] + "..." if len(criterion.text) > 40 else criterion.text,
            "Yes" if auto_met else "No",
            "Yes" if manual_met else ("?" if manual_met is None else "No"),
            match,
            manual_reason[:30] + "..." if len(manual_reason) > 30 else manual_reason
        ])
    
    print(tabulate(comparison_rows, 
                   headers=["Type", "Category", "Criterion Text", "Auto", "Manual", "Match", "Reason"],
                   tablefmt="grid"))
    
    # Summary
    inclusion_criteria = [c for c in criteria if c.criterion_type == 'inclusion']
    exclusion_criteria = [c for c in criteria if c.criterion_type == 'exclusion']
    
    print(f"\n{'='*60}")
    print("FINAL ELIGIBILITY COMPARISON")
    print(f"{'='*60}")
    
    # Auto result
    auto_eligible = auto_result.get('eligible', False) if auto_result else False
    print(f"\n  AUTOMATED RESULT:")
    print(f"    Eligible: {'YES' if auto_eligible else 'NO'}")
    print(f"    Confidence: {auto_result.get('confidence', 0):.1%}" if auto_result else "")
    if auto_result and 'reasons' in auto_result:
        r = auto_result['reasons']
        print(f"    Inclusion: {r.get('inclusion_met', 0)}/{r.get('inclusion_total', 0)} met")
        print(f"    Exclusion: {r.get('exclusion_met', 0)}/{r.get('exclusion_total', 0)} triggered")
    
    # Manual result
    manual_inclusion_pass = manual_inclusion_met == len(inclusion_criteria)
    manual_exclusion_pass = manual_exclusion_met == 0
    manual_eligible = manual_inclusion_pass and manual_exclusion_pass
    
    print(f"\n  MANUAL RESULT:")
    print(f"    Eligible: {'YES' if manual_eligible else 'NO'}")
    print(f"    Inclusion: {manual_inclusion_met}/{len(inclusion_criteria)} met")
    print(f"    Exclusion: {manual_exclusion_met}/{len(exclusion_criteria)} triggered")
    
    # Agreement
    if auto_eligible == manual_eligible:
        print(f"\n  ✓ RESULTS MATCH: Both say {'ELIGIBLE' if auto_eligible else 'NOT ELIGIBLE'}")
    else:
        print(f"\n  ✗ MISMATCH: Auto={auto_eligible}, Manual={manual_eligible}")
    
    return auto_eligible, manual_eligible


def list_available_data(session):
    """List available patients and trials"""
    print("\n" + "="*60)
    print("AVAILABLE DATA")
    print("="*60)
    
    # Patients
    patients = session.query(Patient).all()
    print(f"\nPATIENTS ({len(patients)}):")
    for p in patients:
        age = calculate_age(p.birthdate)
        cond_count = session.query(Condition).filter_by(patient_id=p.id).count()
        obs_count = session.query(Observation).filter_by(patient_id=p.id).count()
        print(f"  {p.id}: {p.first_name} {p.last_name} (Age {age}, {p.gender}) - {cond_count} conditions, {obs_count} observations")
    
    # Trials
    trials = session.query(ClinicalTrial).all()
    print(f"\nTRIALS ({len(trials)}):")
    for t in trials:
        criteria_count = session.query(EligibilityCriteria).filter_by(trial_id=t.id).count()
        print(f"  ID={t.id}: {t.trial_id} - {t.protocol_title[:40] if t.protocol_title else 'N/A'}... ({criteria_count} criteria)")


def main():
    """Main entry point"""
    session = get_session()
    
    try:
        # List available data
        list_available_data(session)
        
        # Get user input or use defaults
        if len(sys.argv) >= 3:
            patient_id = sys.argv[1]
            trial_id = int(sys.argv[2])
        else:
            # Default: find first trial with criteria
            trials = session.query(ClinicalTrial).all()
            if not trials:
                print("\nNo trials found in database!")
                return
            
            # Find trial with criteria
            trial_id = None
            for t in trials:
                criteria_count = session.query(EligibilityCriteria).filter_by(trial_id=t.id).count()
                if criteria_count > 0:
                    trial_id = t.id
                    print(f"\nUsing trial ID: {trial_id} ({criteria_count} criteria)")
                    break
            
            if trial_id is None:
                print("\nNo trials with criteria found!")
                return
            
            patients = session.query(Patient).all()
            if not patients:
                print("\nNo patients found in database!")
                return
            
            print(f"\nComparing all {len(patients)} patients against trial {trial_id}...")
            print("="*70)
            
            results = []
            for p in patients:
                result = compare_eligibility(session, p.id, trial_id)
                if result is None or result[0] is None:
                    continue
                auto, manual = result
                results.append({
                    'patient': p.id,
                    'auto': auto,
                    'manual': manual,
                    'match': auto == manual
                })
            
            # Summary table
            print("\n\n" + "#"*70)
            print("# OVERALL SUMMARY")
            print("#"*70)
            
            summary_rows = []
            for r in results:
                summary_rows.append([
                    r['patient'],
                    "Eligible" if r['auto'] else "Not Eligible",
                    "Eligible" if r['manual'] else "Not Eligible",
                    "✓ Match" if r['match'] else "✗ Mismatch"
                ])
            
            print(tabulate(summary_rows, 
                           headers=["Patient", "Automated", "Manual", "Agreement"],
                           tablefmt="grid"))
            
            match_count = sum(1 for r in results if r['match'])
            print(f"\nAgreement Rate: {match_count}/{len(results)} ({match_count/len(results)*100:.1f}%)")
            
            return
        
        compare_eligibility(session, patient_id, trial_id)
        
    finally:
        session.close()


if __name__ == "__main__":
    main()
