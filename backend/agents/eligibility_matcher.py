"""
Patient Eligibility Matching Agent
Rule-based patient screening for clinical trials

Category Handlers:
  AGE, WEIGHT, EKG                    - Numeric observation checks
  CONDITION_PRESENT, MEDICAL_HISTORY  - Condition / keyword matching
  MEDICATION, MEDICATION_HISTORY      - Medication matching
  LAB_THRESHOLD                       - Lab value comparison
  ALLERGY                             - Allergy record check
  IMMUNIZATION                        - Immunization record check
  PREGNANCY_EXCLUSION                 - Gender + pregnancy check
  CONDITION_ABSENT                    - Inverted condition check (absence = met)
  CONSENT_REQUIREMENT, CONTRACEPTION  - Administrative auto-pass
  PROCEDURE_HISTORY                   - Procedure keyword check
"""

from backend.db_models import (
    get_session, Patient, Condition, Medication, Observation,
    Allergy, Immunization, EligibilityCriteria, ClinicalTrial, EligibilityAudit
)
from datetime import datetime, date
from typing import Dict, List, Optional, Tuple
import re


# Phrases in exclusion criteria that are too vague for keyword matching
VAGUE_EXCLUSION_PHRASES = [
    'any other', 'in the opinion of', 'may interfere', 'otherwise unsuitable',
    'clinically significant', 'considered clinically', 'investigator will review',
    'likely to interfere', 'that in the opinion', 'upon his/her medical judgment',
    'the investigator will review', 'the investigator will decide',
    'upon his/her', 'medical judgment will decide',
]


class EligibilityMatcher:
    """Matches patients to trial eligibility criteria"""

    def __init__(self, db_session=None, weights=None):
        self.session = db_session or get_session()
        self.weights = weights or {
            'inclusion': 0.50,
            'exclusion': 0.25,
            'data': 0.15,
            'nlp': 0.10,
        }

    # ── Utility Methods ──────────────────────────────────────────────────

    def calculate_age(self, birthdate: date, on_date: date = None) -> Optional[int]:
        if not birthdate:
            return None
        today = on_date or date.today()
        years = today.year - birthdate.year
        if (today.month, today.day) < (birthdate.month, birthdate.day):
            years -= 1
        return years

    def parse_numeric_value(self, s: str) -> Tuple[Optional[float], Optional[str]]:
        if s is None:
            return None, None
        s = str(s).strip().replace('%', '').replace(',', '')
        comparator = None
        if len(s) >= 2 and s[:2] in ('>=', '<=', '=='):
            comparator = s[:2]
            s = s[2:].strip()
        elif s and s[0] in ('<', '>', '='):
            comparator = s[0]
            s = s[1:].strip()
        try:
            return float(s), comparator
        except Exception:
            return None, None

    @staticmethod
    def _is_administrative_category(cat: str) -> bool:
        return cat in ('CONSENT_REQUIREMENT', 'CONTRACEPTION')

    @staticmethod
    def _is_vague_exclusion(text: str) -> bool:
        t = text.lower()
        return any(phrase in t for phrase in VAGUE_EXCLUSION_PHRASES)

    # ── Data Retrieval ───────────────────────────────────────────────────

    def get_patient_data(self, patient_id: str) -> Optional[Dict]:
        patient = self.session.query(Patient).filter_by(id=patient_id).first()
        if not patient:
            return None
        return {
            'patient': patient,
            'conditions': self.session.query(Condition).filter_by(patient_id=patient_id).all(),
            'medications': self.session.query(Medication).filter_by(patient_id=patient_id).all(),
            'observations': self.session.query(Observation).filter_by(patient_id=patient_id).all(),
            'allergies': self.session.query(Allergy).filter_by(patient_id=patient_id).all(),
            'immunizations': self.session.query(Immunization).filter_by(patient_id=patient_id).all(),
        }

    # ── Individual Check Methods ─────────────────────────────────────────

    def check_age_criteria(self, patient: Patient, min_age: int = None, max_age: int = None) -> bool:
        if not patient.birthdate:
            return False
        age = self.calculate_age(patient.birthdate)
        if min_age is not None and age < min_age:
            return False
        if max_age is not None and age > max_age:
            return False
        return True

    def check_condition_criteria(self, conditions: List[Condition], required_code: str, scope: str = 'personal') -> bool:
        return any(
            c.code == required_code and (c.scope or 'personal') == scope
            for c in conditions
        )

    def check_medication_criteria(self, medications: List[Medication],
                                  drug_name: str = None, drug_list: List[str] = None,
                                  negated: bool = False) -> bool:
        if not drug_name and not drug_list:
            return not negated
        meds_text = " ".join((m.description or "").lower() for m in medications)
        if drug_list:
            found = any(d.lower() in meds_text for d in drug_list)
        elif drug_name:
            found = drug_name.lower().strip() in meds_text
        else:
            return not negated
        return (not found) if negated else found

    def check_allergy_criteria(self, allergies: List[Allergy], allergen: str) -> bool:
        if not allergen:
            return False
        term = allergen.lower().strip()
        for a in allergies:
            if term in (a.description or "").lower():
                return True
            if term in (a.category or "").lower():
                return True
            if term in (a.reaction1 or "").lower():
                return True
        return False

    def check_keyword_criteria(self, patient_data: Dict, keyword: str,
                               min_overlap: int = 2) -> bool:
        """Fallback: Check for keyword in all patient records.

        Args:
            min_overlap: minimum number of significant-word overlaps required.
                         Use 2 for inclusion, 3 for exclusion criteria.
        """
        if not keyword:
            return False
        ignore_words = {
            'the', 'a', 'an', 'at', 'in', 'of', 'and', 'or', 'for', 'with',
            'on', 'is', 'to', 'be', 'by', 'that', 'who', 'had', 'any', 'must',
            'not', 'no', 'are', 'were', 'been', 'has', 'have', 'may', 'can',
            'will', 'should', 'other', 'all', 'their', 'this', 'from',
        }
        k_lower = keyword.lower()
        k_tokens = {
            t.strip(',.;:()[]{}!?"\'')
            for t in k_lower.split()
            if t.strip(',.;:()[]{}!?"\'') not in ignore_words
        }
        k_tokens.discard('')

        if len(k_tokens) < min_overlap:
            return False

        def has_overlap(text):
            if not text:
                return False
            t_lower = text.lower()
            if k_lower in t_lower:
                return True
            t_tokens = {t.strip(',.;:()[]{}!?"\'') for t in t_lower.split()}
            return len(k_tokens.intersection(t_tokens)) >= min_overlap

        for source in ('conditions', 'medications', 'observations', 'allergies', 'immunizations'):
            records = patient_data.get(source, [])
            if any(has_overlap(getattr(r, 'description', '')) for r in records):
                return True
        return False

    def check_lab_criteria(self, observations: List[Observation], lab_name: str,
                           operator: str, threshold: float,
                           unit: str = None, window_months: int = None) -> Dict:
        try:
            from dateutil.relativedelta import relativedelta
        except ImportError:
            relativedelta = None

        term = (lab_name or '').lower().strip()
        matching_obs = []
        if lab_name and lab_name.strip():
            matching_obs = [o for o in observations if o.code and o.code == lab_name]
        if not matching_obs and lab_name:
            matching_obs = [o for o in observations if term in (o.description or '').lower()]

        if window_months and relativedelta:
            cutoff = datetime.now() - relativedelta(months=window_months)
            matching_obs = [o for o in matching_obs if o.observation_date and o.observation_date >= cutoff.date()]

        if not matching_obs:
            return {'status': 'missing_data', 'met': False, 'value': None, 'unit': None, 'date': None, 'confidence': 0.0}

        latest = max(matching_obs, key=lambda x: x.observation_date or date.min)
        raw_val, _ = self.parse_numeric_value(latest.value)
        if raw_val is None:
            return {'status': 'missing_data', 'met': False, 'value': latest.value, 'unit': latest.units, 'date': latest.observation_date, 'confidence': 0.0}

        ops = {'>': lambda a, b: a > b, '>=': lambda a, b: a >= b,
               '<': lambda a, b: a < b, '<=': lambda a, b: a <= b,
               '==': lambda a, b: a == b}
        met = ops.get(operator, lambda a, b: False)(raw_val, float(threshold))
        return {
            'status': 'met' if met else 'not_met',
            'met': met,
            'value': raw_val,
            'unit': latest.units or None,
            'date': latest.observation_date,
            'confidence': 0.95,
        }

    def _find_observation_value(self, observations: List[Observation],
                                search_terms: List[str]) -> Optional[Observation]:
        """Find the most recent observation matching any of the search terms."""
        matches = []
        for o in observations:
            desc = (o.description or '').lower()
            if any(t in desc for t in search_terms):
                matches.append(o)
        if not matches:
            return None
        return max(matches, key=lambda x: x.observation_date or date.min)

    # ── Compound Evaluation ──────────────────────────────────────────────

    def evaluate_compound(self, node: Dict, patient_data: Dict, criterion_lookup: Dict) -> Dict:
        logic = node.get('logic', node.get('group_logic', 'AND')).upper()
        children = node.get('children', [])
        if not children:
            return self._evaluate_criterion(patient_data, node)

        child_results = []
        for child in children:
            if isinstance(child, dict):
                res = self.evaluate_compound(child, patient_data, criterion_lookup)
            elif isinstance(child, (int, str)):
                crit = criterion_lookup.get(child) or criterion_lookup.get(int(child) if str(child).isdigit() else child)
                if crit:
                    sd = getattr(crit, 'structured_data', None)
                    if sd and isinstance(sd, dict) and sd.get('children'):
                        res = self.evaluate_compound(sd, patient_data, criterion_lookup)
                    else:
                        res = self._evaluate_criterion(patient_data, crit)
                else:
                    res = {'status': 'missing_data', 'confidence': 0.0}
            else:
                res = {'status': 'missing_data', 'confidence': 0.0}
            child_results.append(res)

        mets = [r['status'] == 'met' for r in child_results]
        if logic == 'AND':
            overall = all(mets)
            confidence = min((r.get('confidence', 0.0) for r in child_results), default=0.0)
        elif logic == 'OR':
            overall = any(mets)
            confidence = max((r.get('confidence', 0.0) for r in child_results), default=0.0)
        else:
            overall, confidence = False, 0.0

        return {'status': 'met' if overall else 'not_met', 'confidence': confidence,
                'child_results': child_results, 'logic': logic}

    # ── Batch Evaluation ─────────────────────────────────────────────────

    def evaluate_batch(self, patient_ids: List[str], trial_id: int) -> Dict[str, Dict]:
        criteria = self.session.query(EligibilityCriteria).filter_by(trial_id=trial_id).all()
        if not criteria:
            err = {'eligible': False, 'confidence': 0.0,
                   'reasons': {'error': 'No eligibility criteria defined for trial'}}
            return {pid: err for pid in patient_ids}

        patients = self.session.query(Patient).filter(Patient.id.in_(patient_ids)).all()
        all_conditions = self.session.query(Condition).filter(Condition.patient_id.in_(patient_ids)).all()
        all_meds = self.session.query(Medication).filter(Medication.patient_id.in_(patient_ids)).all()
        all_obs = self.session.query(Observation).filter(Observation.patient_id.in_(patient_ids)).all()
        all_allergies = self.session.query(Allergy).filter(Allergy.patient_id.in_(patient_ids)).all()
        all_imms = self.session.query(Immunization).filter(Immunization.patient_id.in_(patient_ids)).all()

        trial = self.session.query(ClinicalTrial).filter(ClinicalTrial.id == trial_id).first()
        current_weights = self.weights.copy()
        if trial and trial.matching_config and isinstance(trial.matching_config, dict):
            current_weights.update(trial.matching_config.get('weights', {}))

        patient_map = {
            p.id: {'patient': p, 'conditions': [], 'medications': [],
                    'observations': [], 'allergies': [], 'immunizations': []}
            for p in patients
        }
        for c in all_conditions:
            if c.patient_id in patient_map: patient_map[c.patient_id]['conditions'].append(c)
        for m in all_meds:
            if m.patient_id in patient_map: patient_map[m.patient_id]['medications'].append(m)
        for o in all_obs:
            if o.patient_id in patient_map: patient_map[o.patient_id]['observations'].append(o)
        for a in all_allergies:
            if a.patient_id in patient_map: patient_map[a.patient_id]['allergies'].append(a)
        for i in all_imms:
            if i.patient_id in patient_map: patient_map[i.patient_id]['immunizations'].append(i)

        results = {}
        criterion_lookup = {c.id: c for c in criteria}

        for pid in patient_ids:
            if pid not in patient_map:
                results[pid] = {'eligible': False, 'confidence': 0.0,
                                'reasons': {'error': 'Patient not found'}}
                continue

            p_data = patient_map[pid]
            inclusion_results = []
            exclusion_results = []
            administrative_results = []
            missing_data = []
            hard_exclusions_met = []
            soft_exclusions_met = []
            processed_groups = set()

            for criterion in criteria:
                # Compound group handling
                if criterion.group_id and criterion.group_id not in processed_groups:
                    group_criteria = [c for c in criteria if c.group_id == criterion.group_id]
                    compound_node = {
                        'logic': criterion.group_logic or 'AND',
                        'children': [c.id for c in group_criteria],
                    }
                    result = self.evaluate_compound(compound_node, p_data, criterion_lookup)
                    result['text'] = f"Compound ({criterion.group_logic}): {', '.join(c.text[:30] for c in group_criteria[:3])}"
                    processed_groups.add(criterion.group_id)
                elif criterion.group_id:
                    continue
                else:
                    result = self._evaluate_criterion(p_data, criterion)
                    result['text'] = criterion.text

                cat = (criterion.category or '').upper()

                # Route to the right bucket
                if self._is_administrative_category(cat):
                    administrative_results.append(result)
                elif criterion.criterion_type == 'inclusion':
                    inclusion_results.append(result)
                else:
                    exclusion_results.append(result)
                    if result['status'] == 'met':
                        text_lower = criterion.text.lower()
                        if 'preferred' in text_lower or 'relative' in text_lower or 'soft' in text_lower:
                            soft_exclusions_met.append(criterion.id)
                        else:
                            hard_exclusions_met.append(criterion.id)

                if result['status'] == 'missing_data':
                    missing_data.append(criterion.id)

            # ── Scoring ──────────────────────────────────────────────
            total_inclusions = len(inclusion_results)
            matched_inclusions = sum(1 for r in inclusion_results if r['status'] == 'met')
            inclusion_score = matched_inclusions / total_inclusions if total_inclusions > 0 else 0.0

            total_exclusions = len(exclusion_results)
            exclusion_score = 1.0 - (len(hard_exclusions_met) / max(total_exclusions, 1))

            scorable = len(inclusion_results) + len(exclusion_results)
            available = scorable - len(missing_data)
            data_completeness = available / scorable if scorable > 0 else 0.0

            nlp_scores = [r.get('confidence', 0.9) for r in inclusion_results + exclusion_results]
            nlp_certainty = sum(nlp_scores) / len(nlp_scores) if nlp_scores else 1.0

            # ── Decision ─────────────────────────────────────────────
            raw_confidence = (
                current_weights.get('inclusion', 0.50) * inclusion_score +
                current_weights.get('exclusion', 0.25) * exclusion_score +
                current_weights.get('data', 0.15) * data_completeness +
                current_weights.get('nlp', 0.10) * nlp_certainty
            )

            if soft_exclusions_met:
                raw_confidence *= 0.85

            confidence = round(raw_confidence, 3)

            if hard_exclusions_met:
                confidence = round(min(confidence, 0.15), 3)
                status = "INELIGIBLE"
                eligible = False
            elif confidence >= 0.75:
                status = "HIGHLY ELIGIBLE"
                eligible = True
            elif confidence >= 0.45:
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
                    'exclusion_score': round(exclusion_score, 2),
                    'data_completeness': round(data_completeness, 2),
                    'nlp_certainty': round(nlp_certainty, 2),
                    'hard_exclusions': len(hard_exclusions_met),
                    'soft_exclusions': len(soft_exclusions_met),
                    'administrative_auto_passed': len(administrative_results),
                    'inclusion_details': [
                        {'text': r['text'], 'met': r['status'] == 'met'}
                        for r in inclusion_results
                    ],
                    'exclusion_details': [
                        {'text': r['text'], 'met': r['status'] == 'met',
                         'is_hard': r.get('criterion_id') in hard_exclusions_met
                                    if r.get('criterion_id') else False}
                        for r in exclusion_results
                    ],
                    'missing_data': missing_data,
                },
            }

            try:
                audit = EligibilityAudit(
                    trial_id=trial_id,
                    patient_id=pid,
                    status=status,
                    confidence=confidence,
                    criteria_met=matched_inclusions,
                    criteria_total=scorable,
                    details=results[pid],
                )
                self.session.add(audit)
            except Exception as e:
                print(f"Error logging audit for patient {pid}: {e}")

        return results

    def evaluate_eligibility(self, patient_id: str, trial_id: int) -> Dict:
        return self.evaluate_batch([patient_id], trial_id).get(patient_id)

    # ── Single Criterion Evaluation ──────────────────────────────────────

    def _evaluate_criterion(self, patient_data: Dict, criterion) -> Dict:
        patient = patient_data['patient']
        conditions = patient_data['conditions']
        observations = patient_data['observations']

        cat = (getattr(criterion, 'category', '') or '').upper()
        cid = getattr(criterion, 'id', None)
        structured = getattr(criterion, 'structured_data', None) or {}
        if not isinstance(structured, dict):
            structured = {}

        # ── AGE ──────────────────────────────────────────────────────
        if cat == 'AGE':
            try:
                if getattr(criterion, 'operator', None) == 'BETWEEN' and criterion.value:
                    if '-' in criterion.value:
                        parts = criterion.value.split('-')
                        v1, v2 = float(parts[0]), float(parts[1]) if len(parts) > 1 else 999
                    else:
                        v1 = float(criterion.value)
                        v2 = float(criterion.unit) if (criterion.unit and criterion.unit.replace('.', '').isdigit()) else 999
                    met = self.check_age_criteria(patient, min_age=int(v1), max_age=int(v2))
                else:
                    threshold = int(float(criterion.value))
                    op = criterion.operator or '>'
                    if op == '>=':
                        met = self.check_age_criteria(patient, min_age=threshold)
                    elif op == '<=':
                        met = self.check_age_criteria(patient, max_age=threshold)
                    elif op == '>':
                        met = self.check_age_criteria(patient, min_age=threshold + 1)
                    elif op == '<':
                        met = self.check_age_criteria(patient, max_age=threshold - 1)
                    else:
                        met = False
                return {'criterion_id': cid, 'status': 'met' if met else 'not_met', 'confidence': 1.0}
            except Exception:
                return {'criterion_id': cid, 'status': 'missing_data', 'confidence': 0.0}

        # ── WEIGHT ───────────────────────────────────────────────────
        elif cat == 'WEIGHT':
            try:
                obs = self._find_observation_value(observations, ['weight', 'body weight'])
                if not obs:
                    return {'criterion_id': cid, 'status': 'missing_data', 'confidence': 0.0}
                raw_val, _ = self.parse_numeric_value(obs.value)
                if raw_val is None:
                    return {'criterion_id': cid, 'status': 'missing_data', 'confidence': 0.0}
                threshold = float(criterion.value or '0')
                op = criterion.operator or '>'
                ops = {'>': lambda a, b: a > b, '>=': lambda a, b: a >= b,
                       '<': lambda a, b: a < b, '<=': lambda a, b: a <= b}
                met = ops.get(op, lambda a, b: False)(raw_val, threshold)
                return {'criterion_id': cid, 'status': 'met' if met else 'not_met', 'confidence': 0.95}
            except Exception:
                return {'criterion_id': cid, 'status': 'missing_data', 'confidence': 0.0}

        # ── EKG ──────────────────────────────────────────────────────
        elif cat == 'EKG':
            try:
                obs = self._find_observation_value(observations, ['ekg', 'ecg', 'electrocardiogram'])
                if not obs:
                    return {'criterion_id': cid, 'status': 'missing_data', 'confidence': 0.0}
                raw_val, _ = self.parse_numeric_value(obs.value)
                if raw_val is not None and criterion.value:
                    threshold = float(criterion.value)
                    op = criterion.operator or '<='
                    ops = {'>': lambda a, b: a > b, '>=': lambda a, b: a >= b,
                           '<': lambda a, b: a < b, '<=': lambda a, b: a <= b}
                    met = ops.get(op, lambda a, b: False)(raw_val, threshold)
                    return {'criterion_id': cid, 'status': 'met' if met else 'not_met', 'confidence': 0.9}
                # Non-numeric EKG (e.g. "Normal") -- check if "normal" in value
                if obs.value and 'normal' in obs.value.lower():
                    return {'criterion_id': cid, 'status': 'met', 'confidence': 0.85}
                return {'criterion_id': cid, 'status': 'not_met', 'confidence': 0.7}
            except Exception:
                return {'criterion_id': cid, 'status': 'missing_data', 'confidence': 0.0}

        # ── CONDITION_PRESENT / MEDICAL_HISTORY / DIAGNOSIS ──────────
        elif cat in ('CONDITION_PRESENT', 'DIAGNOSIS', 'MEDICAL_HISTORY', 'HISTORY'):
            crit_text = getattr(criterion, 'text', '') or ''
            if self._is_vague_exclusion(crit_text):
                return {'criterion_id': cid, 'status': 'not_met', 'confidence': 0.5}

            # operator=NO means "patient should NOT have this condition".
            # These are exclusion criteria phrased as "No history of X".
            # For these: we search for X in patient data.
            #   - If X IS found → exclusion is met (patient disqualified)
            #   - If X is NOT found → exclusion not met (patient is fine)
            # So we search for the CONDITION (not the negation) in patient data.
            is_negated_phrasing = (getattr(criterion, 'operator', '') or '').upper() == 'NO'

            if is_negated_phrasing:
                # Use the structured_data 'field' for targeted search, or strip "No " prefix
                search_text = structured.get('field') or crit_text
                # Strip leading "No " or "No history of " for better matching
                for prefix in ['no history of ', 'no family history of ', 'no medical history of ', 'no ']:
                    if search_text.lower().startswith(prefix):
                        search_text = search_text[len(prefix):]
                        break
                found = self.check_keyword_criteria(patient_data, search_text, min_overlap=3)
                return {'criterion_id': cid, 'status': 'met' if found else 'not_met', 'confidence': 0.8}

            met = False
            confidence = 1.0
            scope = getattr(criterion, 'scope', None) or 'personal'

            if criterion.value:
                met = self.check_condition_criteria(conditions, criterion.value, scope)
                if not met:
                    term = criterion.value.lower()
                    met = any(
                        term in (c.description or '').lower() and (c.scope or 'personal') == scope
                        for c in conditions
                    )
                    if met:
                        confidence = 0.8

            if not met:
                if cat == 'MEDICAL_HISTORY':
                    meds_text = ' '.join((m.description or '').lower() for m in patient_data['medications'])
                    text_lower = (crit_text or '').lower()
                    terms = [w for w in re.split(r'\W+', text_lower) if len(w) >= 4]
                    if terms and any(t in meds_text for t in terms[:5]):
                        met = True
                        confidence = 0.7

            if not met:
                is_exclusion = getattr(criterion, 'criterion_type', '') == 'exclusion'
                min_kw = 3 if is_exclusion else 2
                met = self.check_keyword_criteria(patient_data, crit_text, min_overlap=min_kw)
                if met:
                    confidence = 0.7

            return {'criterion_id': cid, 'status': 'met' if met else 'not_met', 'confidence': confidence}

        # ── CONDITION_ABSENT (inverted: met = condition NOT found) ────
        elif cat == 'CONDITION_ABSENT':
            # These are exclusion criteria describing conditions that should be ABSENT.
            # As exclusions: status='met' means the exclusion fires (patient is disqualified).
            # So: if the condition IS found -> exclusion met (bad).
            #     if the condition is NOT found -> exclusion not_met (good).
            # Use the structured_data 'field' for a more targeted search if available.
            search_text = structured.get('field') or criterion.text or ''
            # Use strict 3-word overlap to avoid false positives
            found = self.check_keyword_criteria(patient_data, search_text, min_overlap=3)
            return {'criterion_id': cid, 'status': 'met' if found else 'not_met', 'confidence': 0.8}

        # ── MEDICATION / MEDICATION_HISTORY ───────────────────────────
        elif cat in ('MEDICATION', 'MEDICATION_HISTORY', 'DRUG'):
            # Check if this is a vague exclusion
            crit_text = getattr(criterion, 'text', '') or ''
            if self._is_vague_exclusion(crit_text):
                return {'criterion_id': cid, 'status': 'not_met', 'confidence': 0.5}

            drug_list = structured.get('value_list')
            negated = structured.get('negated', False)
            # operator=NO also means negated
            if (getattr(criterion, 'operator', '') or '').upper() == 'NO':
                negated = True
            met = self.check_medication_criteria(
                patient_data['medications'],
                drug_name=criterion.value if not drug_list else None,
                drug_list=drug_list,
                negated=negated,
            )
            return {'criterion_id': cid, 'status': 'met' if met else 'not_met', 'confidence': 0.85}

        # ── LAB_THRESHOLD / LAB / VITAL_SIGN ─────────────────────────
        elif cat in ('LAB', 'LAB_THRESHOLD', 'LAB_RESULT', 'VITAL_SIGN', 'MEASUREMENT', 'OBSERVATION', 'VITALS'):
            try:
                threshold = 0.0
                try:
                    v_clean = str(criterion.value or '0')
                    v_clean = re.sub(r'[><=±+/\-]', '', v_clean).strip()
                    threshold = float(v_clean) if v_clean else 0.0
                except Exception:
                    pass

                lab_name = structured.get('variable') or structured.get('entity')
                if not lab_name:
                    lab_name = criterion.unit if criterion.unit and not criterion.unit[0].isdigit() else criterion.text
                if not lab_name:
                    lab_name = criterion.category

                if lab_name:
                    term = lab_name.lower().strip()
                    matching = [o for o in observations if o.code and o.code == term]
                    if not matching:
                        matching = [o for o in observations if term in (o.description or '').lower()]
                    if not matching:
                        return {'criterion_id': cid, 'status': 'missing_data', 'confidence': 0.0}

                temporal = structured.get('temporal', {})
                window_months = temporal.get('window') if isinstance(temporal, dict) else None

                lab_result = self.check_lab_criteria(
                    observations, lab_name,
                    criterion.operator or '==', threshold,
                    unit=criterion.unit, window_months=window_months,
                )
                return {
                    'criterion_id': cid,
                    'status': lab_result['status'],
                    'confidence': lab_result['confidence'],
                    'observed': {
                        'value': lab_result.get('value'),
                        'unit': lab_result.get('unit'),
                        'date': str(lab_result.get('date')) if lab_result.get('date') else None,
                    },
                }
            except Exception:
                return {'criterion_id': cid, 'status': 'missing_data', 'confidence': 0.0}

        # ── ALLERGY / HYPERSENSITIVITY ───────────────────────────────
        elif cat in ('ALLERGY', 'HYPERSENSITIVITY', 'CONTRAINDICATION'):
            allergen = criterion.value or criterion.text
            met = self.check_allergy_criteria(patient_data.get('allergies', []), allergen)
            return {'criterion_id': cid, 'status': 'met' if met else 'not_met', 'confidence': 0.9}

        # ── IMMUNIZATION ─────────────────────────────────────────────
        elif cat in ('IMMUNIZATION', 'VACCINE', 'VACCINATION'):
            vaccine = criterion.value or criterion.text
            met = False
            if vaccine:
                term = vaccine.lower().strip()
                met = any(term in (i.description or '').lower() for i in patient_data.get('immunizations', []))
            return {'criterion_id': cid, 'status': 'met' if met else 'not_met', 'confidence': 0.85}

        # ── PREGNANCY_EXCLUSION / GENDER ─────────────────────────────
        elif cat in ('PREGNANCY_EXCLUSION', 'GENDER'):
            text_lower = (criterion.text or '').lower()
            if 'female' in text_lower or 'gender' in text_lower:
                if patient.gender == 'M':
                    return {'criterion_id': cid, 'status': 'not_met', 'confidence': 1.0}
            is_pregnant = any('pregnan' in (c.description or '').lower() for c in conditions)
            return {'criterion_id': cid, 'status': 'met' if is_pregnant else 'not_met', 'confidence': 0.9}

        # ── CONSENT_REQUIREMENT (administrative auto-pass) ───────────
        elif cat == 'CONSENT_REQUIREMENT':
            return {'criterion_id': cid, 'status': 'met', 'confidence': 1.0, 'administrative': True}

        # ── CONTRACEPTION (administrative / gender-conditional) ──────
        elif cat == 'CONTRACEPTION':
            applies_to = structured.get('applies_to', 'FEMALE').upper()
            if applies_to == 'FEMALE' and patient.gender == 'M':
                return {'criterion_id': cid, 'status': 'met', 'confidence': 1.0, 'administrative': True}
            # For females, check pregnancy test observation
            preg_obs = self._find_observation_value(observations, ['pregnancy test', 'serum pregnancy'])
            if preg_obs and 'negative' in (preg_obs.value or '').lower():
                return {'criterion_id': cid, 'status': 'met', 'confidence': 0.95}
            return {'criterion_id': cid, 'status': 'not_met', 'confidence': 0.7}

        # ── PROCEDURE_HISTORY ────────────────────────────────────────
        elif cat == 'PROCEDURE_HISTORY':
            found = self.check_keyword_criteria(patient_data, criterion.text, min_overlap=3)
            return {'criterion_id': cid, 'status': 'met' if found else 'not_met', 'confidence': 0.7}

        # ── DEFAULT FALLBACK ─────────────────────────────────────────
        else:
            # For exclusion criteria with vague language, auto-pass (not_met)
            if criterion.criterion_type == 'exclusion' and self._is_vague_exclusion(criterion.text or ''):
                return {'criterion_id': cid, 'status': 'not_met', 'confidence': 0.5}

            # Conservative keyword search: 3-word overlap for exclusions, 2 for inclusions
            is_exclusion = getattr(criterion, 'criterion_type', '') == 'exclusion'
            min_overlap = 3 if is_exclusion else 2
            found = self.check_keyword_criteria(
                patient_data, criterion.value or criterion.text,
                min_overlap=min_overlap,
            )
            if found:
                return {'criterion_id': cid, 'status': 'met', 'confidence': 0.6}
            return {'criterion_id': cid, 'status': 'missing_data', 'confidence': 0.0}


if __name__ == "__main__":
    matcher = EligibilityMatcher()
    result = matcher.evaluate_eligibility('SP001', 1)
    print(f"\nEligibility Result: {result}")
