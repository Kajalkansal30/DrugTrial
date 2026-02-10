
import unittest
from datetime import date, datetime, timedelta
from typing import List, Dict, Optional
import sys
import os

# Add project root to path (2 levels up from backend/tests)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from backend.db_models import Patient, Condition, Medication, Observation, EligibilityCriteria
# Import EligibilityMatcher - assuming it's available
# We might need to mock the session or use a real one if available
# For unit tests, mocking is better.

class MockSession:
    def query(self, *args):
        return self
    def filter(self, *args):
        return self
    def all(self):
        return []

from backend.agents.eligibility_matcher import EligibilityMatcher

class TestEligibilityMatcherV2(unittest.TestCase):
    
    def setUp(self):
        self.matcher = EligibilityMatcher(db_session=MockSession())
        
    def test_precise_age_calculation(self):
        """Test exact age calculation accounting for leap years"""
        today = date(2023, 10, 15)
        
        # Birthday tomorrow -> should be 29
        dob = date(1993, 10, 16)
        age = self.matcher.calculate_age(dob, on_date=today)
        self.assertEqual(age, 29)
        
        # Birthday today -> should be 30
        dob = date(1993, 10, 15)
        age = self.matcher.calculate_age(dob, on_date=today)
        self.assertEqual(age, 30)
        
        # Leap year baby (Feb 29)
        dob_leap = date(2000, 2, 29)
        # On Feb 28, 2023 (not leap) -> 22
        age = self.matcher.calculate_age(dob_leap, on_date=date(2023, 2, 28))
        self.assertEqual(age, 22)
        # On Mar 1, 2023 -> 23
        age = self.matcher.calculate_age(dob_leap, on_date=date(2023, 3, 1))
        self.assertEqual(age, 23)

    def test_numeric_parsing(self):
        """Test parsing of values like '7.4%', '<50'"""
        self.assertEqual(self.matcher.parse_numeric_value("7.4%"), (7.4, None))
        self.assertEqual(self.matcher.parse_numeric_value("< 50"), (50.0, '<'))
        self.assertEqual(self.matcher.parse_numeric_value(">=100"), (100.0, '>='))
        self.assertEqual(self.matcher.parse_numeric_value("invalid"), (None, None))

    def test_multi_drug_exclusion(self):
        """Test checking against a list of drugs (e.g., NOT on {A, B, C})"""
        meds = [
            Medication(description="Aspirin 81mg"),
            Medication(description="Lisinopril 10mg")
        ]
        
        # Case 1: Value list contains a match (Lisinopril)
        # Rule: NOT on {Warfarin, Lisinopril} -> Should be False (because they ARE on it)
        drug_list = ["Warfarin", "Lisinopril", "Apixaban"]
        found = self.matcher.check_medication_criteria(meds, drug_list=drug_list, negated=True)
        self.assertFalse(found, "Should return False because patient is on one of the forbidden drugs")
        
        # Case 2: Value list has no match
        # Rule: NOT on {Warfarin, Apixaban} -> Should be True
        drug_list_2 = ["Warfarin", "Apixaban"]
        found = self.matcher.check_medication_criteria(meds, drug_list=drug_list_2, negated=True)
        self.assertTrue(found, "Should return True because patient is NOT on any forbidden drugs")

    def test_condition_scoping(self):
        """Test filtering conditions by scope (personal vs family)"""
        conditions = [
            Condition(code="E11", description="Type 2 Diabetes", scope="personal"),
            Condition(code="Z80.3", description="Family history of breast cancer", scope="family")
        ]
        
        # 1. Check Personal Diabetes -> Should match
        self.assertTrue(self.matcher.check_condition_criteria(conditions, "E11", scope="personal"))
        
        # 2. Check Family Diabetes -> Should NOT match (E11 is personal)
        self.assertFalse(self.matcher.check_condition_criteria(conditions, "E11", scope="family"))
        
        # 3. Check Family Breast Cancer -> Should match
        self.assertTrue(self.matcher.check_condition_criteria(conditions, "Z80.3", scope="family"))
        
        # 4. Check Personal Breast Cancer -> Should NOT match (Z80.3 is family)
        self.assertFalse(self.matcher.check_condition_criteria(conditions, "Z80.3", scope="personal"))
        
    def test_compound_criteria_logic(self):
        """Test recursive evaluation of AND/OR logic"""
        # We need to mock _evaluate_criterion or just test evaluate_compound with mocked leaf evaluation
        # Let's mock _evaluate_criterion on the instance
        
        # Setup specific return values for criterion IDs
        results_map = {
            "c1": {'status': 'met', 'confidence': 0.9},      # Age >= 18
            "c2": {'status': 'met', 'confidence': 0.8},      # LVEF <= 50%
            "c3": {'status': 'not_met', 'confidence': 0.95}, # Diabetes
            "c4": {'status': 'not_met', 'confidence': 0.9},  # Hypertension
        }
        
        # Patch _evaluate_criterion
        original_eval = self.matcher._evaluate_criterion
        self.matcher._evaluate_criterion = lambda pd, c: results_map.get(str(c) if isinstance(c, (str,int)) else c.get('id', str(c)), {'status': 'missing'})
        
        criterion_lookup = {} # Not strictly needed if we mock _evaluate_criterion to handle IDs direct, but evaluate_compound looks up objects.
        # Let's adjust mock to handle lookup behavior if needed.
        # evaluate_compound uses `criterion_lookup.get(child)` -> `crit`. Then `_evaluate_criterion(pd, crit)`.
        # So we need criterion_lookup to return something that _evaluate_criterion accepts.
        
        criterion_lookup = {
            "c1": {"id": "c1"}, "c2": {"id": "c2"}, "c3": {"id": "c3"}, "c4": {"id": "c4"}
        }
        
        # Case 1: (c1 AND c2) -> Met AND Met -> Met
        node_and = {'logic': 'AND', 'children': ["c1", "c2"]}
        res = self.matcher.evaluate_compound(node_and, {}, criterion_lookup)
        self.assertEqual(res['status'], 'met')
        self.assertEqual(res['confidence'], 0.8) # Min confidence
        
        # Case 2: (c1 AND c3) -> Met AND NotMet -> NotMet
        node_and_fail = {'logic': 'AND', 'children': ["c1", "c3"]}
        res = self.matcher.evaluate_compound(node_and_fail, {}, criterion_lookup)
        self.assertEqual(res['status'], 'not_met')
        
        # Case 3: (c3 OR c4) -> NotMet OR NotMet -> NotMet
        node_or_fail = {'logic': 'OR', 'children': ["c3", "c4"]}
        res = self.matcher.evaluate_compound(node_or_fail, {}, criterion_lookup)
        self.assertEqual(res['status'], 'not_met')
        
        # Case 4: (c1 OR c3) -> Met OR NotMet -> Met
        node_or_pass = {'logic': 'OR', 'children': ["c1", "c3"]}
        res = self.matcher.evaluate_compound(node_or_pass, {}, criterion_lookup)
        self.assertEqual(res['status'], 'met')
        self.assertEqual(res['confidence'], 0.95) # Max confidence (0.9 vs 0.95)
        
        # Case 5: Complex Nested: (c1 AND c2) OR (c3 AND c4) -> Met OR NotMet -> Met
        node_nested = {
            'logic': 'OR',
            'children': [
                {'logic': 'AND', 'children': ["c1", "c2"]}, # Met
                {'logic': 'AND', 'children': ["c3", "c4"]}  # NotMet
            ]
        }
        res = self.matcher.evaluate_compound(node_nested, {}, criterion_lookup)
        self.assertEqual(res['status'], 'met')
        
        # Restore
        self.matcher._evaluate_criterion = original_eval

if __name__ == '__main__':
    unittest.main()
