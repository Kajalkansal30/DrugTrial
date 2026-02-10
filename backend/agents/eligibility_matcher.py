"""
Patient Eligibility Matching Agent
Rule-based patient screening for clinical trials
"""

from backend.db_models import get_session, Patient, Condition, Medication, Observation, Allergy, Immunization, EligibilityCriteria, ClinicalTrial, EligibilityAudit
from datetime import datetime, date
from typing import Dict, List, Optional, Tuple

class EligibilityMatcher:
    """Matches patients to trial eligibility criteria"""
    
    def __init__(self, db_session=None, weights=None):
        self.session = db_session or get_session()
        # Default: Data completeness 40%, Inclusion 35%, NLP 25%
        self.weights = weights or {
            'inclusion': 0.35,
            'data': 0.40,
            'nlp': 0.25
        }
    
    def calculate_age(self, birthdate: date, on_date: date = None) -> Optional[int]:
        """Calculate precise age in years accounting for leap years."""
        if not birthdate:
            return None
        today = on_date or date.today()
        years = today.year - birthdate.year
        if (today.month, today.day) < (birthdate.month, birthdate.day):
            years -= 1
        return years
    
    def parse_numeric_value(self, s: str) -> Tuple[Optional[float], Optional[str]]:
        """Parse numeric value from string, removing common formatting.
        
        Returns:
            (value, comparator) tuple where comparator is '<', '>', '=' or None
        """
        if s is None:
            return None, None
        s = str(s).strip().replace('%', '').replace(',', '')
        comparator = None
        
        # Check 2-char comparators first
        if len(s) >= 2 and s[:2] in ('>=', '<=', '=='):
            comparator = s[:2]
            s = s[2:].strip()
        elif s and s[0] in ('<', '>', '='):
            comparator = s[0]
            s = s[1:].strip()
        try:
            return float(s), comparator
        except:
            return None, None
    
    def get_patient_data(self, patient_id: str) -> Dict:
        """Get comprehensive patient data"""
        patient = self.session.query(Patient).filter_by(id=patient_id).first()
        
        if not patient:
            return None
        
        conditions = self.session.query(Condition).filter_by(patient_id=patient_id).all()
        medications = self.session.query(Medication).filter_by(patient_id=patient_id).all()
        observations = self.session.query(Observation).filter_by(patient_id=patient_id).all()
        allergies = self.session.query(Allergy).filter_by(patient_id=patient_id).all()
        immunizations = self.session.query(Immunization).filter_by(patient_id=patient_id).all()
        
        return {
            'patient': patient,
            'conditions': conditions,
            'medications': medications,
            'observations': observations,
            'allergies': allergies,
            'immunizations': immunizations
        }
    
    def check_age_criteria(self, patient: Patient, min_age: int = None, max_age: int = None) -> bool:
        """Check if patient meets age criteria"""
        if not patient.birthdate:
            return False
        
        age = self.calculate_age(patient.birthdate)
        
        if min_age and age < min_age:
            return False
        if max_age and age > max_age:
            return False
        
        return True
    
    def check_condition_criteria(self, conditions: List[Condition], required_code: str, scope: str = 'personal') -> bool:
        """Check if patient has required condition with correct scope"""
        return any(c.code == required_code and (c.scope or 'personal') == scope for c in conditions)
    
    
    def check_medication_criteria(self, medications: List[Medication], drug_name: str = None, drug_list: List[str] = None, negated: bool = False) -> bool:
        """Check if patient is taking specific medication(s).
        
        Args:
            medications: List of patient medications
            drug_name: Single drug name to check (fuzzy match)
            drug_list: List of drug names (any match)
            negated: If True, returns True when drug(s) NOT found
        """
        if not drug_name and not drug_list:
            return False
        
        meds_text = " ".join([(m.description or "").lower() for m in medications])
        
        if drug_list:
            found = any(d.lower() in meds_text for d in drug_list)
        elif drug_name:
            found = drug_name.lower().strip() in meds_text
        else:
            return False
        
        return (not found) if negated else found

    def check_allergy_criteria(self, allergies: List[Allergy], allergen: str) -> bool:
        """Check if patient has a specific allergy"""
        if not allergen: return False
        term = allergen.lower().strip()
        # Check description, type, category, and reactions
        for a in allergies:
            if term in (a.description or "").lower(): return True
            if term in (a.category or "").lower(): return True
            if term in (a.reaction1 or "").lower(): return True
        return False

    def check_keyword_criteria(self, patient_data: Dict, keyword: str) -> bool:
        """Fallback: Check for keyword in all patient records with multi-word support"""
        if not keyword: return False
        
        # Clean keyword and split into significant words
        ignore_words = {'the', 'a', 'an', 'at', 'in', 'of', 'and', 'or', 'for', 'with', 'on', 'is', 'to', 'be', 'by', 'that', 'who', 'had', 'any'}
        k_lower = keyword.lower()
        k_tokens = set([t.strip(',.;:()[]{}!?"') for t in k_lower.split() if t.strip(',.;:()[]{}!?"') not in ignore_words])
        k_tokens.discard('') # Remove empty strings if any
        
        def has_overlap(text):
            if not text: return False
            t_lower = text.lower()
            if k_lower in t_lower: return True # Exact phrase match found
            # Otherwise check if significant tokens match
            # Strip punctuation from each word in the description
            t_tokens = set([t.strip(',.;:()[]{}!?"') for t in t_lower.split()])
            overlap = k_tokens.intersection(t_tokens)
            # Match if at least 2 significant words overlap
            return len(overlap) >= 2

        # Check conditions
        if any(has_overlap(c.description) for c in patient_data['conditions']):
            return True
            
        # Check medications
        if any(has_overlap(m.description) for m in patient_data['medications']):
            return True
            
        # Check observations
        if any(has_overlap(o.description) for o in patient_data['observations']):
            return True

        # Check allergies
        if any(has_overlap(a.description) for a in patient_data.get('allergies', [])):
            return True
            
        # Check immunizations
        if any(has_overlap(i.description) for i in patient_data.get('immunizations', [])):
            return True
            
        return False
    
    def check_lab_criteria(self, observations: List[Observation], lab_name: str, 
                          operator: str, threshold: float, unit: str = None, window_months: int = None) -> Dict:
        """Check if patient meets lab value criteria with enhanced return data.
        
        Returns:
            Dict with keys: status, met, value, unit, date, confidence
        """
        try:
            from dateutil.relativedelta import relativedelta
        except ImportError:
            relativedelta = None
        
        # Find matching observations
        term = (lab_name or '').lower().strip()
        matching_obs = []
        
        if lab_name and lab_name.strip():
            matching_obs = [o for o in observations if (o.code and o.code == lab_name)]
        
        # Fallback: try description match
        if not matching_obs and lab_name:
            matching_obs = [o for o in observations if term in (o.description or '').lower()]
        
        # Filter by temporal window if specified
        if window_months and relativedelta:
            cutoff = datetime.now() - relativedelta(months=window_months)
            matching_obs = [o for o in matching_obs if o.observation_date and o.observation_date >= cutoff]
        
        if not matching_obs:
            return {'status': 'missing_data', 'met': False, 'value': None, 'unit': None, 'date': None, 'confidence': 0.0}
        
        # Get most recent
        latest = max(matching_obs, key=lambda x: x.observation_date or datetime.min)
        raw_val, comparator = self.parse_numeric_value(latest.value)
        
        if raw_val is None:
            return {'status': 'missing_data', 'met': False, 'value': latest.value, 'unit': latest.unit or None, 'date': latest.observation_date, 'confidence': 0.0}
        
        # Apply operator
        ops = {'>': lambda a, b: a > b, '>=': lambda a, b: a >= b, '<': lambda a, b: a < b, '<=': lambda a, b: a <= b, '==': lambda a, b: a == b}
        met = ops.get(operator, lambda a, b: False)(raw_val, float(threshold))
        
        return {
            'status': 'met' if met else 'not_met',
            'met': met,
            'value': raw_val,
            'unit': latest.unit or None,
            'date': latest.observation_date,
            'confidence': 0.95
        }

    
    def evaluate_compound(self, node: Dict, patient_data: Dict, criterion_lookup: Dict) -> Dict:
        """Recursively evaluate compound criteria with AND/OR logic.
        
        Args:
            node: Criterion with logic/children or dict with structure
            patient_data: Patient medical data
            criterion_lookup: Map of criterion id -> criterion object
        
        Returns:
            {'status': 'met'|'not_met', 'confidence': float, 'child_results': list}
        """
        logic = node.get('logic', node.get('group_logic', 'AND')).upper()
        children = node.get('children', [])
        
        if not children:
            # Leaf node - evaluate as normal criterion
            return self._evaluate_criterion(patient_data, node)
        
        child_results = []
        
        for child in children:
            if isinstance(child, dict):
                # Inline criterion structure
                res = self.evaluate_compound(child, patient_data, criterion_lookup)
            elif isinstance(child, (int, str)):
                # Child is criterion ID
                crit = criterion_lookup.get(child) or criterion_lookup.get(int(child))
                if crit:
                    if hasattr(crit, 'structured_data') and crit.structured_data and crit.structured_data.get('children'):
                        # Recursively evaluate nested group
                        res = self.evaluate_compound(crit.structured_data, patient_data, criterion_lookup)
                    else:
                        res = self._evaluate_criterion(patient_data, crit)
                else:
                    res = {'status': 'missing_data', 'confidence': 0.0}
            else:
                res = {'status': 'missing_data', 'confidence': 0.0}
                
            child_results.append(res)
        
        # Evaluate logic
        mets = [(r['status'] == 'met') for r in child_results]
        
        if logic == 'AND':
            overall = all(mets)
            # Confidence = min for AND (weakest link)
            confidence = min(r.get('confidence', 0.0) for r in child_results) if child_results else 0.0
        elif logic == 'OR':
            overall = any(mets)
            # Confidence = max for OR (strongest link)
            confidence = max(r.get('confidence', 0.0) for r in child_results) if child_results else 0.0
        else:
            overall = False
            confidence = 0.0
        
        return {
            'status': 'met' if overall else 'not_met',
            'confidence': confidence,
            'child_results': child_results,
            'logic': logic
        }
    
    
    def evaluate_batch(self, patient_ids: List[str], trial_id: int) -> Dict[str, Dict]:
        """
        Evaluate eligibility for multiple patients at once (Optimized)
        Returns: { patient_id: eligibility_result_dict }
        """
        # 1. Fetch Trial Criteria (Once)
        criteria = self.session.query(EligibilityCriteria).filter_by(trial_id=trial_id).all()
        
        if not criteria:
            error_res = {
                'eligible': False,
                'confidence': 0.0,
                'reasons': {'error': 'No eligibility criteria defined for trial'}
            }
            return {pid: error_res for pid in patient_ids}

        # 2. Bulk Fetch Patient Data
        # We need to fetch patients, conditions, meds, obs for ALL ids
        patients = self.session.query(Patient).filter(Patient.id.in_(patient_ids)).all()
        conditions = self.session.query(Condition).filter(Condition.patient_id.in_(patient_ids)).all()
        meds = self.session.query(Medication).filter(Medication.patient_id.in_(patient_ids)).all()
        obs = self.session.query(Observation).filter(Observation.patient_id.in_(patient_ids)).all()
        allergies = self.session.query(Allergy).filter(Allergy.patient_id.in_(patient_ids)).all()
        immunizations = self.session.query(Immunization).filter(Immunization.patient_id.in_(patient_ids)).all()

        # Fetch trial config
        trial = self.session.query(ClinicalTrial).filter(ClinicalTrial.id == trial_id).first()
        current_weights = self.weights.copy()
        if trial and trial.matching_config and 'weights' in trial.matching_config:
            current_weights.update(trial.matching_config['weights'])
        
        # 3. Organize Data by Patient ID
        patient_map = {p.id: {'patient': p, 'conditions': [], 'medications': [], 'observations': [], 'allergies': [], 'immunizations': []} for p in patients}
        
        for c in conditions:
            if c.patient_id in patient_map: patient_map[c.patient_id]['conditions'].append(c)
        for m in meds:
            if m.patient_id in patient_map: patient_map[m.patient_id]['medications'].append(m)
        for o in obs:
            if o.patient_id in patient_map: patient_map[o.patient_id]['observations'].append(o)
        for a in allergies:
            if a.patient_id in patient_map: patient_map[a.patient_id]['allergies'].append(a)
        for i in immunizations:
            if i.patient_id in patient_map: patient_map[i.patient_id]['immunizations'].append(i)
            
        # 4. Evaluate Each Patient (In-Memory)
        results = {}
        for pid in patient_ids:
            if pid not in patient_map:
                 results[pid] = {
                    'eligible': False,
                    'confidence': 0.0,
                    'reasons': {'error': 'Patient not found'}
                }
                 continue

            p_data = patient_map[pid]
            
            inclusion_results = []
            exclusion_results = []
            missing_data = []
            
            # For checking hard vs soft exclusions
            hard_exclusions_met = []
            soft_exclusions_met = []
            
            # Track processed groups to avoid re-evaluation
            processed_groups = set()
            
            # Build criterion lookup for compound evaluation
            criterion_lookup = {c.id: c for c in criteria}

            for criterion in criteria:
                # Check if this is part of a compound group
                if criterion.group_id and criterion.group_id not in processed_groups:
                    # Get all criteria in this group
                    group_criteria = [c for c in criteria if c.group_id == criterion.group_id]
                    
                    # Build compound node structure
                    compound_node = {
                        'logic': criterion.group_logic or 'AND',
                        'children': [c.id for c in group_criteria]
                    }
                    
                    # Evaluate compound group
                    result = self.evaluate_compound(compound_node, p_data, criterion_lookup)
                    result['text'] = f"Compound ({criterion.group_logic}): {', '.join(c.text[:30] for c in group_criteria[:3])}"
                    
                    # Mark group as processed
                    processed_groups.add(criterion.group_id)
                    
                elif criterion.group_id:
                    # Already processed as part of a group
                    continue
                else:
                    # Regular single criterion evaluation
                    result = self._evaluate_criterion(p_data, criterion)
                    result['text'] = criterion.text
                
                if criterion.criterion_type == 'inclusion':
                    inclusion_results.append(result)
                else:
                    exclusion_results.append(result)
                    if result['status'] == 'met':
                        # Determine if hard or soft
                        # Heuristic: "preferred", "relative" -> soft
                        text_lower = criterion.text.lower()
                        if 'preferred' in text_lower or 'relative' in text_lower or 'soft' in text_lower:
                            soft_exclusions_met.append(criterion.id)
                        else:
                            hard_exclusions_met.append(criterion.id)
                
                if result['status'] == 'missing_data':
                    missing_data.append(criterion.id)
            
            # --- SCORING LOGIC ---
            
            # 1. Inclusion Score = Matched / Total
            total_inclusions = len(inclusion_results)
            matched_inclusions = sum(1 for r in inclusion_results if r['status'] == 'met')
            inclusion_score = matched_inclusions / total_inclusions if total_inclusions > 0 else 0.0
            
            # 2. Data Completeness = Available / Required
            # Required = Total criteria. Available = Total - Missing
            total_criteria = len(inclusion_results) + len(exclusion_results)
            available_criteria = total_criteria - len(missing_data)
            data_completeness = available_criteria / total_criteria if total_criteria > 0 else 0.0
            
            # 3. NLP Certainty
            # Heuristic: 
            # - Exact code match = 1.0
            # - Fuzzy text match = 0.7
            # - LLM extraction (future) = 0.5-0.9
            # For now, we can iterate through results. If 'fuzzy' key is in result (to be added), use that.
            # Default to 0.9 for now to represent high confidence in regex/code matching
            nlp_scores = []
            for r in inclusion_results + exclusion_results:
                nlp_scores.append(r.get('confidence', 0.9)) # Default 0.9
            nlp_certainty = sum(nlp_scores) / len(nlp_scores) if nlp_scores else 1.0

            # --- DECISION LOGIC ---
            
            eligible = False
            confidence = 0.0
            status = "UNCERTAIN"

            # 4. HARD EXCLUSION RULE
            if hard_exclusions_met:
                eligible = False
                confidence = 0.0
                status = "INELIGIBLE"
            else:
                #  confidence = self.weights['inclusion'] * inclusion + self.weights['data'] * data + self.weights['nlp'] * nlp
                
                raw_confidence = (
                    current_weights['inclusion'] * inclusion_score +
                    current_weights['data'] * data_completeness +
                    current_weights['nlp'] * nlp_certainty
                )
                
                confidence = raw_confidence
                
                # Soft Exclusion Penalty
                if soft_exclusions_met:
                     confidence *= 0.7
                     
                confidence = round(confidence, 3)
                
                # Determine Eligibility Status based on Confidence
                if confidence >= 0.8:
                    status = "HIGHLY ELIGIBLE"
                    eligible = True
                elif confidence >= 0.5:
                    status = "POTENTIALLY ELIGIBLE"
                    eligible = True 
                else:
                    status = "UNCERTAIN / NEEDS REVIEW"
                    eligible = False 

            results[pid] = {
                'eligible': eligible,
                'confidence': confidence,
                'status': status,
                'reasons': {
                    'scoring_weights': current_weights,
                    'inclusion_score': round(inclusion_score, 2),
                    'data_completeness': round(data_completeness, 2),
                    'nlp_certainty': round(nlp_certainty, 2),
                    'hard_exclusions': len(hard_exclusions_met),
                    'soft_exclusions': len(soft_exclusions_met),
                    'inclusion_details': [{'text': r['text'], 'met': r['status'] == 'met'} for r in inclusion_results],
                    'exclusion_details': [{'text': r['text'], 'met': r['status'] == 'met', 'is_hard': r.get('criterion_id') in hard_exclusions_met if r.get('criterion_id') else False} for r in exclusion_results],
                    'missing_data': missing_data
                }
            }
            
            # Log Audit
            try:
                audit = EligibilityAudit(
                    trial_id=trial_id,
                    patient_id=pid,
                    status=status,
                    confidence=confidence,
                    criteria_met=len(inclusion_results), 
                    criteria_total=len(inclusion_results) + len(exclusion_results),
                    details=results[pid]
                )
                self.session.add(audit)
            except Exception as e:
                print(f"Error logging audit for patient {pid}: {e}")
            
        return results

    def evaluate_eligibility(self, patient_id: str, trial_id: int) -> Dict:
        """
        Evaluate patient eligibility for a trial (Legacy wrapper around batch)
        """
        batch_result = self.evaluate_batch([patient_id], trial_id)
        return batch_result.get(patient_id)

    
    def _evaluate_criterion(self, patient_data: Dict, criterion: EligibilityCriteria) -> Dict:
        """Evaluate a single criterion"""
        patient = patient_data['patient']
        conditions = patient_data['conditions']
        observations = patient_data['observations']
        
        # Normalize category
        cat = (criterion.category or "").upper()
        
        # Age criteria
        if cat in ['AGE', 'age']:
            try:
                if criterion.operator == 'BETWEEN' and criterion.value:
                    # Handle range "18-50" or separate value fields
                    if '-' in criterion.value:
                        try:
                            v1, v2 = map(float, criterion.value.split('-'))
                        except:
                            v1 = float(criterion.value.split('-')[0])
                            v2 = 999
                    else:
                        v1 = float(criterion.value)
                        v2 = float(criterion.unit) if (criterion.unit and criterion.unit.replace('.','').isdigit()) else 999
                    
                    met = self.check_age_criteria(patient, min_age=v1, max_age=v2)
                else:
                    threshold = int(criterion.value)
                    if criterion.operator == '>=':
                        met = self.check_age_criteria(patient, min_age=threshold)
                    elif criterion.operator == '<=':
                        met = self.check_age_criteria(patient, max_age=threshold)
                    elif criterion.operator == '>':
                        met = self.check_age_criteria(patient, min_age=threshold + 1)
                    elif criterion.operator == '<':
                        met = self.check_age_criteria(patient, max_age=threshold - 1)
                    else:
                        met = False
                
                return {
                    'criterion_id': criterion.id,
                    'status': 'met' if met else 'not_met',
                    'confidence': 1.0 # Deterministic calculation
                }
            except:
                return {'criterion_id': criterion.id, 'status': 'missing_data', 'confidence': 0.0}
        
        # Diagnosis/Condition criteria
        elif cat in ['DIAGNOSIS', 'CONDITION_PRESENT', 'diagnosis', 'medical_history', 'medical history', 'history']:
            # Try exact code if value is provided
            met = False
            confidence = 1.0
            
            # Extract scope from criterion (added in Phase 2 columns)
            scope = criterion.scope or 'personal'
            
            if criterion.value:
                met = self.check_condition_criteria(conditions, criterion.value, scope)
                if not met:
                    # Fuzzy fallback if value is a name, not code
                    term = criterion.value.lower()
                    met = any(term in (c.description or "").lower() and (c.scope or 'personal') == scope for c in conditions)
                    if met: confidence = 0.8 # Description match is less certain than code
            
            # If still not met or value was missing, try text keyword match
            if not met:
                met = self.check_keyword_criteria(patient_data, criterion.text)
                if met: confidence = 0.7 # Keyword fallback is lower confidence
                
            return {
                'criterion_id': criterion.id,
                'status': 'met' if met else 'not_met',
                'confidence': confidence
            }

        # Medication criteria
        elif cat in ['MEDICATION', 'medication', 'drug', 'medication_history']:
            # Extract structured data for multi-drug lists and negation
            structured = criterion.structured_data or {}
            drug_list = structured.get('value_list')
            negated = structured.get('negated', False)
            
            met = self.check_medication_criteria(
                patient_data['medications'], 
                drug_name=criterion.value if not drug_list else None,
                drug_list=drug_list,
                negated=negated
            )
            # Medication check uses "in description" which is semi-reliable
            return {
                'criterion_id': criterion.id,
                'status': 'met' if met else 'not_met',
                'confidence': 0.85
            }

        # Lab/Vital criteria
        elif cat in ['LAB', 'LAB_THRESHOLD', 'LAB_RESULT', 'lab', 'vital_sign', 'vital sign', 'ekg', 'measurement', 'observation', 'vitals']:
            try:
                # Value for lab in criteria might be a numeric threshold
                threshold = 0.0
                try:
                    # Clean value like "50%" or ">150"
                    v_clean = str(criterion.value or "0").replace('>', '').replace('<', '').replace('=', '').replace('%', '').strip()
                    threshold = float(v_clean)
                except:
                    pass 
                
                # Determine lab/observation name
                lab_name = None
                if criterion.structured_data and isinstance(criterion.structured_data, dict):
                     lab_name = criterion.structured_data.get('variable') or criterion.structured_data.get('entity')
                
                if not lab_name:
                    # Try to extract from text or unit
                    lab_name = criterion.unit if criterion.unit and not criterion.unit[0].isdigit() else criterion.text
                
                # Fallback to category if still empty
                if not lab_name: lab_name = criterion.category

                # Check if ANY data exists for this lab BEFORE checking value
                matching_obs = []
                if lab_name:
                    term = lab_name.lower().strip()
                    # Try exact code first (rare but possible in cleaner data)
                    matching_obs = [o for o in observations if o.code == term]
                    
                    # If no code match, try description match
                    if not matching_obs:
                        matching_obs = [o for o in observations if term in (o.description or "").lower()]

                if not matching_obs:
                     return {'criterion_id': criterion.id, 'status': 'missing_data', 'confidence': 0.0}

                # Extract temporal window from structured_data if present
                structured = criterion.structured_data or {}
                temporal = structured.get('temporal', {})
                window_months = None
                if isinstance(temporal, dict):
                    window_months = temporal.get('window')
                
                # Call check_lab_criteria with new signature
                lab_result = self.check_lab_criteria(
                    observations, 
                    lab_name, 
                    criterion.operator or '==',
                    threshold,
                    unit=criterion.unit,
                    window_months=window_months
                )
                
                return {
                    'criterion_id': criterion.id,
                    'status': lab_result['status'],
                    'confidence': lab_result['confidence'],
                    'observed': {
                        'value': lab_result.get('value'),
                        'unit': lab_result.get('unit'),
                        'date': str(lab_result.get('date')) if lab_result.get('date') else None
                    }
                }
            except:
                return {'criterion_id': criterion.id, 'status': 'missing_data', 'confidence': 0.0}
        
        # Allergy criteria
        elif cat in ['ALLERGY', 'allergy', 'hypersensitivity', 'contraindication']:
            allergen = criterion.value or criterion.text
            met = self.check_allergy_criteria(patient_data.get('allergies', []), allergen)
            return {
                'criterion_id': criterion.id,
                'status': 'met' if met else 'not_met',
                'confidence': 0.9
            }

        # Immunization criteria
        elif cat in ['IMMUNIZATION', 'immunization', 'vaccine', 'vaccination']:
            vaccine = criterion.value or criterion.text
            # Use fuzzy match similar to medications
            met = False
            confidence = 1.0
            if vaccine:
                term = vaccine.lower().strip()
                met = any(term in (i.description or "").lower() for i in patient_data.get('immunizations', []))
                confidence = 0.85 # Description match
            
            return {
                'criterion_id': criterion.id,
                'status': 'met' if met else 'not_met',
                'confidence': confidence
            }

        # Gender/Pregnancy
        elif cat in ['pregnancy_exclusion', 'gender']:
            # Check gender
            if 'gender' in criterion.text.lower() or 'female' in criterion.text.lower():
                if patient.gender == 'M': 
                     # If exclusion says "Female", and patient is Male -> Criterion is NOT MET (which is good for exclusion)
                     # But we are returning 'met' if the condition described is present.
                     # If criterion="Female", and patient="Male", met=False.
                     return {'criterion_id': criterion.id, 'status': 'not_met', 'confidence': 1.0 } 
            
            # Check pregnancy condition
            is_pregnant = any('pregnan' in (c.description or "").lower() for c in conditions)
            return {
                'criterion_id': criterion.id,
                'status': 'met' if is_pregnant else 'not_met',
                'confidence': 0.9
            }

        # Default / Fallback for unclassified
        # Try keyword search in all records
        found = self.check_keyword_criteria(patient_data, criterion.value or criterion.text)
        if found:
             return {'criterion_id': criterion.id, 'status': 'met', 'confidence': 0.6} # Keyword search is low confidence

        return {'criterion_id': criterion.id, 'status': 'missing_data', 'confidence': 0.0}

# Example usage
if __name__ == "__main__":
    matcher = EligibilityMatcher()
    
    # Example: Check patient P001 for trial 1
    result = matcher.evaluate_eligibility('SP001', 1)
    print(f"\nEligibility Result: {result}")
