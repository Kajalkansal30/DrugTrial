#!/usr/bin/env python3
"""
Patch script to apply Phase 1 critical fixes to eligibility_matcher.py
"""

import re
import sys

def patch_lab_criteria_method(content):
    """Replace check_lab_criteria method with enhanced version"""
    
    # Find the method start and end
    pattern = r'(    def check_lab_criteria\(self.*?\n).*?(\n    def evaluate_batch)'
    
    replacement = r'''    def check_lab_criteria(self, observations, lab_name, operator, threshold, unit=None, window_months=None):
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
        matching = []
        
        if lab_name and lab_name.strip():
            matching = [o for o in observations if (o.code and o.code == lab_name)]
        
        # Fallback: try description match
        if not matching and lab_name:
            matching = [o for o in observations if term in (o.description or '').lower()]
        
        # Filter by temporal window if specified
        if window_months and relativedelta:
            cutoff = datetime.now() - relativedelta(months=window_months)
            matching = [o for o in matching if o.observation_date and o.observation_date >= cutoff]
        
        if not matching:
            return {'status': 'missing_data', 'met': False, 'value': None, 'unit': None, 'date': None, 'confidence': 0.0}
        
        # Get most recent
        latest = max(matching, key=lambda x: x.observation_date or datetime.min)
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

\2'''
    
    content = re.sub(pattern, replacement, content, flags=re.DOTALL)
    return content

def patch_lab_criteria_usage(content):
    """Update LAB_THRESHOLD evaluation to handle new dictionary return"""
    
    # Find the LAB_THRESHOLD section
    pattern = r'(# Lab/Vital criteria\s+elif cat in.*?\n)(.*?)(met = self\.check_lab_criteria\(observations.*?\n)(.*?)(return \{.*?\'criterion_id\': criterion\.id.*?\})'
    
    def replace_func(match):
        intro = match.group(1)
        before_call = match.group(2)
        # Extract structured_data fields for temporal window
        new_code = f'''{intro}{before_call}                # Extract temporal window from structured_data
                structured = criterion.structured_data or {{}}
                window_months = structured.get('temporal', {{}}).get('window') if isinstance(structured.get('temporal'), dict) else None
                
                lab_result = self.check_lab_criteria(
                    observations, 
                    lab_name, 
                    criterion.operator or '>=',
                    threshold,
                    unit=criterion.unit,
                    window_months=window_months
                )
                
                return {{
                    'criterion_id': criterion.id,
                    'status': lab_result['status'],
                    'confidence': lab_result['confidence'],
                    'observed': {{
                        'value': lab_result.get('value'),
                        'unit': lab_result.get('unit'),
                        'date': str(lab_result.get('date')) if lab_result.get('date') else None
                    }}
                }}'''
        return new_code
    
    content = re.sub(pattern, replace_func, content, flags=re.DOTALL)
    return content

def patch_medication_usage(content):
    """Update medication criteria to support value_list and negated"""
    
    # Find medication evaluation section
    pattern = r'(elif cat in \[\'MEDICATION\'.*?\n.*?)met = self\.check_medication_criteria\(patient_data\[\'medications\'\], criterion\.value\)'
    
    replacement = r'''\1# Extract structured data for multi-drug lists
                structured = criterion.structured_data or {}
                drug_list = structured.get('value_list')
                negated = structured.get('negated', False)
                
                met = self.check_medication_criteria(
                    patient_data['medications'], 
                    drug_name=criterion.value if not drug_list else None,
                    drug_list=drug_list,
                    negated=negated
                )'''
    
    content = re.sub(pattern, replacement, content, flags=re.DOTALL)
    return content

if __name__ == '__main__':
    file_path = '/home/veersa/Projects/Hackathon/DrugTrial/backend/agents/eligibility_matcher.py'
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    print("Applying Phase 1 patches...")
    
    # Apply patches
    content = patch_lab_criteria_method(content)
    content = patch_lab_criteria_usage(content)
    content = patch_medication_usage(content)
    
    # Write back
    with open(file_path, 'w') as f:
        f.write(content)
    
    print("✅ Phase 1 critical fixes applied successfully!")
