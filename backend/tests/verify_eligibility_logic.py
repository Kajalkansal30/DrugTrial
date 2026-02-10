
import unittest
from unittest.mock import MagicMock, ANY
from backend.agents.eligibility_matcher import EligibilityMatcher
from backend.db_models import Patient, Condition, EligibilityCriteria, Observation

class TestEligibilityLogic(unittest.TestCase):
    def setUp(self):
        self.mock_session = MagicMock()
        self.matcher = EligibilityMatcher(db_session=self.mock_session)

    def test_hard_exclusion(self):
        """Test that any hard exclusion results in 0 confidence"""
        # Setup Criteria
        c1 = EligibilityCriteria(id=1, trial_id=1, criterion_id='EX1', criterion_type='exclusion', text='History of Heart Failure', category='CONDITION_PRESENT', value='Heart Failure')
        
        # Setup Patient with Condition
        p1 = Patient(id='P1', birthdate=None)
        cond1 = Condition(patient_id='P1', code='HF', description='Heart Failure')
        
        # Mock DB queries
        self.mock_session.query.return_value.filter_by.return_value.all.return_value = [c1] # Criteria
        
        # For bulk fetch
        self.mock_session.query.return_value.filter.return_value.all.side_effect = [
            [p1], # Patients
            [cond1], # Conditions
            [], # Meds
            [], # Obs
            [], # Allergies
            []  # Immunizations
        ]

        results = self.matcher.evaluate_batch(['P1'], 1)
        res = results['P1']
        
        print(f"\nTest Hard Exclusion: Eligible={res['eligible']}, Confidence={res['confidence']}")
        self.assertFalse(res['eligible'])
        self.assertEqual(res['confidence'], 0.0)
        self.assertEqual(res['status'], "INELIGIBLE")

    def test_weighted_scoring_perfect(self):
        """Test perfect match scoring"""
        # 1 Inclusion (Met), No Exclusion
        c1 = EligibilityCriteria(id=1, trial_id=1, criterion_id='IN1', criterion_type='inclusion', text='Has Diabetes', category='CONDITION_PRESENT', value='Diabetes')
        
        p1 = Patient(id='P1')
        cond1 = Condition(patient_id='P1', description='Diabetes')
        
        self.mock_session.query.return_value.filter_by.return_value.all.return_value = [c1]
        self.mock_session.query.return_value.filter.return_value.all.side_effect = [
            [p1], [cond1], [], [], [], []
        ]

        results = self.matcher.evaluate_batch(['P1'], 1)
        res = results['P1']
        
        # Inclusion Score: 1.0 (60%)
        # Data Completeness: 1.0 (30%)
        # NLP: 0.8 (Keyword) or 1.0 (Code)? 'Diabetes' matches description -> _evaluate_criterion returns 0.8
        # Wait, if I provided value='Diabetes', and condition has description 'Diabetes', it matches via keyword fallback or fuzzy?
        # In `_evaluate_criterion`: if criterion.value is set, self.check_condition_criteria checks exact code or fuzzy description.
        # If `Diabetes` is in `c.description`, checks `term in description`. returns met=True.
        # Confidence logic: `met = any(...) if met: confidence = 0.8`.
        
        # So:
        # Inclusion = 1.0 * 0.6 = 0.6
        # Data = 1.0 * 0.3 = 0.3
        # NLP = 0.8 * 0.1 = 0.08
        # Total = 0.98
        # Bonus: Eligible + Data>=0.8 -> +0.15 => 1.0 (capped)
        
        print(f"\nTest Perfect Match: Eligible={res['eligible']}, Confidence={res['confidence']}")
        self.assertTrue(res['eligible'])
        self.assertGreaterEqual(res['confidence'], 0.9)

    def test_soft_exclusion(self):
        """Test soft exclusion penalty"""
        # 1 Inclusion (Met), 1 Soft Exclusion (Met)
        c1 = EligibilityCriteria(id=1, trial_id=1, criterion_type='inclusion', text='Has Diabetes', value='Diabetes', category='CONDITION')
        c2 = EligibilityCriteria(id=2, trial_id=1, criterion_type='exclusion', text='Preferred no smoking', value='Smoking', category='CONDITION')
        
        p1 = Patient(id='P1')
        cond1 = Condition(patient_id='P1', description='Diabetes')
        cond2 = Condition(patient_id='P1', description='Smoking')
        
        self.mock_session.query.return_value.filter_by.return_value.all.return_value = [c1, c2]
        self.mock_session.query.return_value.filter.return_value.all.side_effect = [
            [p1], [cond1, cond2], [], [], [], []
        ]

        results = self.matcher.evaluate_batch(['P1'], 1)
        res = results['P1']
        
        # Inclusion: 1/1 = 1.0
        # Inclusion Score (Contribution): 0.6 * 1.0 = 0.6
        # Data: 2/2 = 1.0 -> 0.3
        # NLP: 0.8 (Diabetes) + 0.8 (Smoking) -> 0.8 -> 0.08
        # Raw = 0.98
        # Soft exclusion penalty: * 0.7 = 0.686
        # Bonus won't apply because eligible=False?
        # Logic: eligible = inclusion_pass AND exclusion_pass
        # exclusion_pass = NOT any(met). Here exclusion IS met. So eligible=False.
        # Wait, my logic says exclusion_pass = not any(...).
        # So eligible is False.
        # If eligible is False, no bonus.
        # Confidence = 0.686 -> ~0.69
        
        print(f"\nTest Soft Exclusion: Eligible={res['eligible']}, Confidence={res['confidence']}")
        self.assertTrue(res['eligible']) # Eligible but low confidence ("Potentially Eligible")
        self.assertLess(res['confidence'], 0.8)
        self.assertGreater(res['confidence'], 0.0)
        self.assertEqual(res['status'], 'POTENTIALLY ELIGIBLE') # > 0.5

    def test_missing_data(self):
        """Test missing data impact"""
        # 1 Inclusion (Missing)
        c1 = EligibilityCriteria(id=1, trial_id=1, criterion_type='inclusion', text='HbA1c > 7.0', category='LAB', value='>7.0')
        
        p1 = Patient(id='P1')
        # No obs
        
        self.mock_session.query.return_value.filter_by.return_value.all.return_value = [c1]
        self.mock_session.query.return_value.filter.return_value.all.side_effect = [
            [p1], [], [], [], [], []
        ]

        results = self.matcher.evaluate_batch(['P1'], 1)
        res = results['P1']
        
        # Missing data -> status='missing_data'
        # Inclusion Match: 0/1 = 0.0 -> 0.0
        # Data Coverage: 0/1 = 0.0 -> 0.0
        # NLP: 1.0 (default empty? no results in nlp_scores?)
        # nlp_scores=[] -> default 1.0? yes. 
        # Raw = 0.1
        # Floor 0.1
        
        print(f"\nTest Missing Data: Eligible={res['eligible']}, Confidence={res['confidence']}")
        self.assertFalse(res['eligible'])
        self.assertLess(res['confidence'], 0.3)

if __name__ == '__main__':
    unittest.main()
