"""
Enhanced FDA Form Processor V3.0 - Streamlined
Simplified pipeline: PDF → Tables → Entities (SciSpacy+UMLS) → LLM Refinement
Removes unnecessary glue code and focuses on accuracy
"""

import os
import re
import hashlib
from typing import Dict, Optional, List, Any
from datetime import datetime
import json

# PDF Processing
import fitz  # PyMuPDF
import pdfplumber

# NLP
import spacy


class FDAProcessor:
    """
    Streamlined FDA form extraction system
    Pipeline: PDF → Enhanced NER → Structured Extraction → LLM Validation
    """
    
    def __init__(self, load_linker=False):
        """Initialize processor with shared NLP models and LLM"""
        from backend.nlp_utils import get_nlp, get_llm
        self.nlp = get_nlp("en_core_sci_lg", load_linker=load_linker)
        self.nlp_general = get_nlp("en_core_web_sm", load_linker=False)
        self.llm = get_llm()
        self.has_entity_linker = "scispacy_linker" in self.nlp.pipe_names
        self._last_full_text = ""  # Cache last extracted text to avoid re-reading PDF
    
    def _parse_llm_json(self, response: str) -> Optional[Dict]:
        """Robustly parse JSON from LLM response, handling markdown and control characters."""
        if not response: return None
        try:
            # Strip markdown blocks
            clean_response = response.replace('```json', '').replace('```', '').strip()
            
            # Find the first { and its potential ending }
            # To handle multiple objects, we look for the first matching pair
            start = clean_response.find('{')
            if start == -1: return None
            
            # Simple brace counting to find the end of the first object
            brace_count = 0
            end = -1
            for i in range(start, len(clean_response)):
                if clean_response[i] == '{':
                    brace_count += 1
                elif clean_response[i] == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        end = i
                        break
            
            if end != -1:
                json_str = clean_response[start:end+1]
                # Remove control characters except newlines/tabs
                json_str = "".join(ch for ch in json_str if ord(ch) >= 32 or ch in ['\n', '\r', '\t'])
                # Strip // style comments
                json_str = re.sub(r'//.*', '', json_str)
                return json.loads(json_str)
        except Exception as e:
            print(f"⚠️  JSON parse failed: {e}. Response was: {response[:100]}...")
        return None

    def _llm_split_field(self, text: str, field_type: str) -> Optional[Dict[str, str]]:
        """
        Specialized LLM call to split merged fields (Name/Address)
        Returns dict with 'name' and 'address' or None
        """
        prompt = f"""
        You are a data extraction assistant. The following text contains a merged {field_type} Name and Address/Affiliation.
        
        Text: "{text}"
        
        Task: Split this into two distinct fields: 'name' and 'address'.
        - 'name': The person or organization name.
        - 'address': The full physical address, phone, fax, and email if present.
        
        Return ONLY valid JSON with keys "name" and "address".
        JSON:
        """
        try:
            response = self.llm.invoke(prompt).strip()
            return self._parse_llm_json(response)
        except Exception as e:
            print(f"⚠️  LLM split failed: {e}")
        return None
    
    def _clean_merged_text(self, text: str) -> str:
        """Clean common PDF merge artifacts"""
        if not text: return text
        # Fix "SwitzerlandPhone" -> "Switzerland Phone"
        text = re.sub(r'(?i)Switzerland(?=Phone)', 'Switzerland ', text)
        # Fix "GenevaSwitzerland" -> "Geneva Switzerland"
        text = re.sub(r'(?i)Geneva(?=Switzerland)', 'Geneva ', text)
        # Fix "Phone:+41" -> "Phone: +41"
        text = re.sub(r'(?i)Phone:(?=\+)', 'Phone: ', text)
        
        # Clean cid:XXX artifacts (pdfplumber artifacts)
        text = re.sub(r'\(cid:\d+\)', ' ', text)
        return ' '.join(text.split())

    def _validate_candidate(self, text: str, expected_type: str) -> bool:
        """
        Validate a candidate string using simple heuristics.
        expected_type: 'ORG' | 'PERSON' | 'PRODUCT'
        """
        if not text or len(text) < 3: return False
        text_lower = text.lower().strip()
        
        # Blacklist common garbage values
        garbage = ['null', 'none', 'n/a', 'unknown', 'redacted', 'signature', 'under', 'date', 'title']
        if text_lower in garbage:
            return False
        
        if expected_type == 'ORG':
            # Must contain organization indicators OR be recognized by NER
            org_indicators = ['inc', 'ltd', 'corp', 'llc', 'pharmaceuticals', 'company', 'therapeutics', 'pharma', 'dndi', 'foundation']
            if any(x in text_lower for x in org_indicators):
                return True
            # Try web model
            doc = self.nlp_general(text)
            for ent in doc.ents:
                if ent.label_ in ['ORG', 'ORGANIZATION']:
                    return True
            return False
                
        elif expected_type == 'PERSON':
            # Must look like a name (at least two words, title case)
            words = text.split()
            if len(words) < 2:
                return False
            # Check for common non-name patterns
            non_names = ['principal', 'investigator', 'study', 'director', 'medical', 'monitor']
            if all(w.lower() in non_names for w in words):
                return False
            # Try web model
            doc = self.nlp_general(text)
            for ent in doc.ents:
                if ent.label_ == 'PERSON':
                    return True
            # Fallback: accept if it looks like a name (First Last)
            if len(words) >= 2 and words[0][0].isupper() and words[-1][0].isupper():
                return True
            return False
            
        elif expected_type == 'PRODUCT':
            # Accept if it contains drug/product indicators OR is not an obvious ORG
            product_indicators = ['injection', 'tablet', 'capsule', 'mg', 'ml', 'dose', 'ibuprofen', 'acid']
            if any(x in text_lower for x in product_indicators):
                return True
            # Reject if it's purely an organization
            org_only_indicators = ['inc.', 'ltd.', 'corp.', 'llc']
            if any(x in text_lower for x in org_only_indicators) and not any(p in text_lower for p in product_indicators):
                return False
            return True

        return True

    def _extract_indication_ner(self, text: str) -> Optional[str]:
        """Extract medical indication using scispacy + UMLS"""
        # Focus on Title and Indication sections
        # We search specifically for DISEASE or SYMPTOM types
        
        # UMLS Semantic Types for Indications:
        # T047: Disease or Syndrome
        # T048: Mental or Behavioral Dysfunction
        # T190: Anatomical Abnormality
        # T184: Sign or Symptom
        target_sty = ['T047', 'T048', 'T190', 'T184']
        
        doc = self.nlp(text[:5000]) # Scan first few pages
        
        candidates = []
        for ent in doc.ents:
            # Check UMLS linking if available
            is_indication = False
            
            if self.has_entity_linker:
                for umls_ent in ent._.kb_ents:
                    # kb_ents is list of (cui, score) - we need to look up context if possible
                    # scispacy linker object doesn't easily expose looking up STY from CUI directly without linker.kb
                    # relying on entity label as proxy if linker detail unavailable
                    pass
            
            # Use Entity Labels from scispacy models (en_core_sci_lg uses generic labels, but we can check context)
            if ent.label_ in ['DISEASE', 'SYMPTOM', 'PROBLEM']: # Specific models
                is_indication = True
            elif ent.label_ == 'ENTITY': # generic sci model
                # Heuristic: ends with 'disorder', 'syndrome', 'disease', 'infection'
                if any(x in ent.text.lower() for x in ['disorder', 'syndrome', 'disease', 'infection', 'pain', 'fever']):
                    is_indication = True
            
            if is_indication:
                candidates.append(ent.text)
                
        if candidates:
            # Return the most frequent or first significant one?
            # Usually the one in the title or early text
            return candidates[0] # Simplest first
            
        return None

    def process_pdf(self, pdf_path: str, log_callback=None) -> Dict[str, Any]:
        """
        Main processing pipeline (V3.0 - Streamlined)
        Returns: {
            'document_hash': str,
            'fda_1571': dict,
            'fda_1572': dict,
            'validation': dict,
            'metadata': dict
        }
        """
        if log_callback: log_callback(f"📄 Processing PDF: {pdf_path}")
        print(f"📄 Processing PDF: {pdf_path}")
        
        # Stage 1: Extract text with table parsing
        if log_callback: log_callback("📑 Extracting text and tables...")
        full_text, structured_data = self._extract_text_with_tables(pdf_path)
        self._last_full_text = full_text  # Cache for reuse by router
        doc_hash = self._compute_hash(pdf_path)
        
        # Reuse text processing logic
        result = self.process_text(full_text, structured_data, log_callback)
        result['document_hash'] = doc_hash
        return result

    def process_text(self, full_text: str, structured_data: Dict = {}, log_callback=None) -> Dict[str, Any]:
        """
        Process raw text input (for testing or non-PDF sources).
        OPTIMIZED: Uses heuristic extraction first, then a SINGLE consolidated LLM call
        to fill all gaps at once (instead of 5-7 separate LLM calls).
        """
        if log_callback: log_callback("🔍 Analyzing text content and extracting FDA forms...")
        
        # Stage 1: Fast heuristic extraction (Tables + Regex + NER) - NO LLM calls
        hints_1571 = self._extract_1571(full_text, structured_data, use_llm=False)
        hints_1572 = self._extract_1572(full_text, structured_data)
        
        # Stage 2: SINGLE consolidated LLM call to fill ALL gaps at once
        # Reduced context to 6KB (most FDA data is in first 2-3 pages)
        if log_callback: log_callback("🤖 Running AI extraction (single consolidated pass)...")
        context_text = full_text[:6000]
        consolidated = self._llm_consolidated_extract_v2(context_text, hints_1571, hints_1572)
        
        # Merge LLM results into hints (LLM fills gaps, doesn't overwrite existing values)
        llm_1571 = consolidated.get('fda_1571', {})
        llm_1572 = consolidated.get('fda_1572', {})
        
        form_1571 = dict(hints_1571)
        for key, val in llm_1571.items():
            if key in form_1571 and (not form_1571[key] or str(form_1571[key]).lower().strip() in ['none', 'null', 'unknown', 'n/a']):
                if val and str(val).lower().strip() not in ['none', 'null', 'unknown', 'n/a']:
                    form_1571[key] = val
        
        form_1572 = dict(hints_1572)
        for key, val in llm_1572.items():
            if key in form_1572 and (not form_1572[key] or str(form_1572[key]).lower().strip() in ['none', 'null', 'unknown', 'n/a']):
                if val and str(val).lower().strip() not in ['none', 'null', 'unknown', 'n/a']:
                    form_1572[key] = val
        
        # Post-LLM Cleanup - reject garbage values
        garbage_values = ['null', 'none', 'n/a', 'unknown', 'redacted', 'signature', 'under']
        
        for field in ['sponsor_name', 'drug_name', 'contact_person', 'contact_phone', 'contact_email']:
            val = form_1571.get(field)
            if val and val.lower().strip() in garbage_values:
                form_1571[field] = None
                
        if form_1572.get('investigator_name'):
            inv = form_1572['investigator_name'].lower().strip()
            if inv in garbage_values:
                form_1572['investigator_name'] = None
        
        # Final clean for all string fields
        for k, v in form_1571.items():
            if isinstance(v, str):
                form_1571[k] = self._clean_merged_text(v)
        for k, v in form_1572.items():
            if isinstance(v, str):
                form_1572[k] = self._clean_merged_text(v)
        
        # Stage 3: Validation
        if log_callback: log_callback("✅ Validating extraction accuracy...")
        validation_1571 = self._validate_form(form_1571, '1571')
        validation_1572 = self._validate_form(form_1572, '1572')
        
        if log_callback: log_callback("🎉 Extraction complete!")
        
        return {
            'document_hash': hashlib.sha256(full_text.encode()).hexdigest(),
            'fda_1571': form_1571,
            'fda_1572': form_1572,
            'validation': {
                'form_1571': validation_1571,
                'form_1572': validation_1572
            },
            'metadata': {
                'processed_at': datetime.utcnow().isoformat(),
                'text_length': len(full_text),
                'structured_fields_found': len(structured_data)
            }
        }
    
    def _extract_text_with_tables(self, pdf_path: str) -> tuple:
        """
        Extract text AND parse tables for structured data
        Returns: (full_text, structured_data_from_tables)
        """
        full_text = ""
        structured_data = {}
        
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page_num, page in enumerate(pdf.pages):
                    # Extract tables from first 5 pages (protocol summary)
                    if page_num < 5:
                        tables = page.extract_tables()
                        for table in tables:
                            if table:
                                table_data = self._parse_protocol_table(table)
                                structured_data.update(table_data)
                    
                    # Extract text
                    text = page.extract_text() or ""
                    full_text += f"\\n--- PAGE {page_num + 1} ---\\n{text}\\n"
            
            # Check for silent failure (empty text)
            if len(full_text.strip()) < 200:
                raise ValueError("Extracted text is too short, likely a scanned or complex PDF.")
                
        except Exception as e:
            print(f"⚠️  Enhanced extraction failed (pdfplumber), falling back to PyMuPDF: {e}")
            # Fallback to PyMuPDF
            full_text = "" # Reset
            try:
                doc = fitz.open(pdf_path)
                for page in doc:
                    text = page.get_text("text")
                    full_text += text + "\\n\\n"
                doc.close()
            except Exception as e2:
                print(f"❌ PyMuPDF also failed: {e2}")
        
        return full_text, structured_data
    
    def _parse_protocol_table(self, table: List[List[str]]) -> Dict:
        """Parse key-value pairs from protocol summary tables"""
        data = {}
        
        # Field mappings for common protocol table fields
        field_mappings = {
            'protocol_number': ['protocol number', 'protocol id', 'study id', 'nct', 'study number'],
            'drug_name': ['name of product', 'investigational product', 'finished product', 'active ingredient', 'investigational medicinal product'],
            'drug_class': ['drug class'],
            'sponsor_name': ['sponsor', 'research initiating unit', 'name of sponsor'],
            'indication': ['indication', 'clinical indication'],
            'study_phase': ['phase'],
            'protocol_title': ['short title', 'protocol title', 'study title'],
            'investigator_name': ['coordinating investigator', 'principal investigator', 'national coordinating', 'study director', 'invaestigator'],
            'contact_phone': ['telephone', 'phone', 'tel'],
            'contact_email': ['email', 'e-mail'],
        }
        
        last_key = None
        
        for row in table:
            if not row: continue
            
            # Clean cells
            cells = [str(c).strip() if c else "" for c in row]
            if not any(cells): continue
            
            # Determine if this row is a key-value pair or a continuation
            # Heuristic: If col0 is short/known-label and col1+ has text -> KV pair
            # If col0 has text but is NOT a known label, and last_key exists -> Continuation
            
            key_candidate = cells[0].lower().strip(': ')
            value_candidate = ' '.join(cells[1:]).strip()
            
            is_known_label = any(any(syn in key_candidate for syn in synonyms) for synonyms in field_mappings.values())
            
            if is_known_label:
                # Map to internal key
                internal_key = None
                for ik, syns in field_mappings.items():
                    if any(syn in key_candidate for syn in syns):
                        internal_key = ik
                        break
                
                if internal_key:
                    if value_candidate:
                        data[internal_key] = value_candidate
                    last_key = internal_key
            elif last_key and (not value_candidate or cells[0]):
                # Continuation: either col0 is the value (label was on previous line) 
                # or col1+ is more of the previous value
                text_to_add = ' '.join([c for c in cells if c]).strip()
                if text_to_add and last_key in data:
                    data[last_key] += f" {text_to_add}"
                elif text_to_add:
                    data[last_key] = text_to_add
            
        return data
    
    def _compute_hash(self, pdf_path: str) -> str:
        """Compute SHA256 hash of PDF file"""
        sha256_hash = hashlib.sha256()
        with open(pdf_path, "rb") as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()
    
    def _extract_1571(self, text: str, structured_data: Dict, use_llm: bool = True) -> Dict:
        """
        Extract FDA Form 1571 data
        Priority: Tables → Regex Patterns → (Optional) LLM
        """
        result = {
            "ind_number": None,
            "submission_type": None,
            "drug_name": None,
            "dosage_form": None,
            "route_of_administration": None,
            "indication": None,
            "study_phase": None,
            "protocol_title": None,
            "protocol_number": None,
            "sponsor_name": None,
            "sponsor_address": None,
            "contact_person": None,
            "contact_phone": None,
            "contact_email": None,
        }
        
        # Priority 1: Use structured data from tables
        for key in result.keys():
            if key in structured_data and structured_data[key]:
                result[key] = structured_data[key]
        
        # Validate table extraction
        if result['sponsor_name']:
             # Use hybrid NER to validate or clear
             if not self._validate_candidate(result['sponsor_name'], 'ORG'):
                  print(f"⚠️ Clearing table-extracted Sponsor '{result['sponsor_name']}' - NER rejected")
                  result['sponsor_name'] = None
        
        if result['indication']:
             # Heuristic: reject numeric/administrative values often misclassified as indication
             if re.match(r'(?i)^(Number|Total|Subjects|Patients)', result['indication']):
                  result['indication'] = None
             # If too short, clear
             if result['indication'] and len(result['indication']) < 5:
                  result['indication'] = None
        
        # Priority 2: Pattern-based extraction for missing fields
        if not result['protocol_number']:
            patterns = [
                r'(?i)Study\s+Number[:\s]+([A-Z0-9][A-Z0-9-]{4,})',
                r'(?i)Protocol\s+Number[:\s]+([A-Z0-9][A-Z0-9-]{4,})',
                r'(?i)(NCT\d{8})',
                r'(?i)CPI-[A-Z]{2}-\d{3}',  # Specific Cumberland format
                r'(?i)[A-Z]{2,4}-[A-Z0-9]{2,4}-\d{3,}'
            ]
            for pattern in patterns:
                match = self._extract_pattern(text, pattern, max_length=50)
                if match:
                    result['protocol_number'] = match
                    break
        
        if not result['study_phase']:
            # Handle "Phase of Development: \n IV"
            patterns = [
                r'(?i)Phase\s+of\s+Development[:\s]+(I{1,3}|IV|[1-4]|2)\b',
                r'(?i)Phase[:\s]+(I{1,3}|IV|[1-4]|2)\b'
            ]
            for pattern in patterns:
                phase_match = self._extract_pattern(text, pattern, max_length=20)
                if phase_match:
                    phase_num = phase_match.upper().strip()
                    roman_to_num = {'I': '1', 'II': '2', 'III': '3', 'IV': '4'}
                    if phase_num in roman_to_num:
                        phase_num = roman_to_num[phase_num]
                    result['study_phase'] = f"Phase {phase_num}"
                    break

        if not result['sponsor_name']:
            # Handle "Name of Sponsor: \n Cumberland..." or "Research initiating unit:"
            clean_text = re.sub(r'\n+', ' ', text)
            # improved regex to stop before common next-field keywords
            candidate = self._extract_pattern(
                clean_text,
                r'(?i)(?:Name\s+of\s+Sponsor|Research\s+initiating\s+unit)[:\s]+(.+?)(?=Finished|Active|Investigational|Unit|Drug|Name|Protocol|Study|Phase)',
                max_length=100
            )
            if candidate:
                # NER Validation: Must be Organization, NOT Product
                if self._validate_candidate(candidate, 'ORG'):
                     result['sponsor_name'] = candidate
                else:
                    print(f"⚠️ Rejecting Sponsor candidate '{candidate}' - NER did not validate as ORG")

        # Fallback: Search for Organization entities in first page header/footer
        if not result['sponsor_name']:
            # Scan first 1000 chars for ORG entities
            doc = self.nlp(text[:1000])
            for ent in doc.ents:
                if ent.label_ in ['ORG', 'ORGANIZATION']:
                     # Filter out common false positives
                     if ent.text.lower() not in ['confidential', 'protocol', 'ind', 'fda']:
                         # If it looks like a Sponsor (e.g. Inc, Ltd), prefer it
                         if any(x in ent.text.lower() for x in ['inc', 'ltd', 'pharmaceuticals', 'therapeutics']):
                             result['sponsor_name'] = ent.text
                             break

        # Fix for merged Sponsor Name/Address (e.g. DNDi case)
        if result['sponsor_name']:
            # Validate if it looks like a drug name instead of a sponsor
            if result['drug_name'] and result['sponsor_name'].lower().startswith(result['drug_name'].lower()[:10]):
                result['sponsor_name'] = None # Too similar to drug name, likely misclassified
            
        if result['sponsor_name']:
            # Apply cleaning first
            result['sponsor_name'] = self._clean_merged_text(result['sponsor_name'])
            name_val = result['sponsor_name']
            
            # Check for split trigger
            should_split = False
            
            # 1. Regex Heuristic
            if re.search(r'(?i)(?:Phone|Fax|Tel|Street|Road|Box|Geneva|Switzerland)[:\.]', name_val):
                should_split = True
            
            # 2. Length Heuristic (If > 50 chars, it's almost certainly merged)
            if len(name_val) > 50:
                should_split = True

            if should_split and not result['sponsor_address']:
                split_data = self._llm_split_field(name_val, "Sponsor")
                if split_data:
                    if split_data.get('name') and split_data.get('name').lower() != 'null':
                        result['sponsor_name'] = split_data['name']
                    if split_data.get('address'):
                        result['sponsor_address'] = split_data['address']
        
        if not result['sponsor_address'] and use_llm:
             # Use LLM for address due to multi-column layout issues
            result['sponsor_address'] = self._llm_extract_field(
                'sponsor_address',
                text,
                "Extract the full address of the Sponsor found in the title page or contact details."
            )

        if not result['protocol_title']:
             # Try specific new line pattern first
             result['protocol_title'] = self._extract_pattern(
                 text,
                 r'(?i)(?:Short|Study|Full)\s+Title[:\s\n]+([A-Z][\s\S]+?)(?=\n\s*\n|\n\s*[A-Z][a-zA-Z\s]{2,15}:|$)',
                 max_length=500
             )
             if not result['protocol_title']:
                 patterns = [
                     r'(?i)Title\s+of\s+Study[:\s]+(.+?)(?=\n|Study)',
                     r'(?i)Study\s+Title[:\s]+(.+?)(?=\n|Background|Synopsis|Protocol)',
                     r'(?i)Full\s+Title[:\s]+(.+?)(?=\n|Background|Synopsis|Protocol)'
                 ]
                 for pattern in patterns:
                     match = self._extract_pattern(text, pattern, max_length=300)
                     if match:
                         result['protocol_title'] = match
                         break

        if not result['indication']:
            # Try NER extraction first (Generic)
            result['indication'] = self._extract_indication_ner(text)
            
            if not result['indication']:
                # Look for context in Synopsis or specific headers
                patterns = [
                     r'(?i)clinical\s+indication\s+of\s+(.+?)(?=\.|by)',
                     r'(?i)Indication[:\s]+(.+?)(?=\n|Subject|Objective)',
                     r'(?i)Study\s+Objectives?[:\s]+(.+?)(?=\n|Secondary)',
                ]
                for pattern in patterns:
                    match = self._extract_pattern(text, pattern, max_length=150)
                    if match:
                        result['indication'] = match
                        break
            
            # Fallback: Infer from Protocol Title if it contains "Safety Study for ..."
            if not result['indication'] and result['protocol_title']:
                title_lower = result['protocol_title'].lower()
                if "study for" in title_lower:
                    try:
                        start_idx = title_lower.find("study for") + 9
                        # Grab next 10 words or until newline
                        potential = result['protocol_title'][start_idx:].split('\n')[0].strip()
                        if len(potential) > 5:
                            result['indication'] = potential
                    except: pass

            if not result['indication'] and use_llm:
                 # LLM fallback
                 result['indication'] = self._llm_extract_field(
                    'indication',
                    text,
                    "Extract the primary indication or disease condition found in the 'Diagnosis and main criteria for inclusion', 'Indication', or Title section."
                )
        
        if not result['drug_name']:
            # Generic NER Search for PRODUCTS/CHEMICALS in Title Block
            doc = self.nlp(text[:2000])
            for ent in doc.ents:
                if ent.label_ in ['CHEMICAL', 'SIMPLE_CHEMICAL', 'DRUG', 'PRODUCT']:
                    if len(ent.text) > 3 and ent.text.lower() not in ['injection', 'tablets', 'capsules']:
                         result['drug_name'] = ent.text
                         break # Take first significant product
            
            # Fallback to patterns if NER fails
            if not result['drug_name']:
                patterns = [
                    r'(?i)Name\s+of\s+product\(?s?\)?[:\s\n]+([\s\S]+?)(?=\n\s*(?:Drug\s+Class|Phase|EudraCT|Indication|Sponsor|$))',
                    r'(?i)Finished\s+Product[:\s\n]+([\s\S]+?)(?=\n\s*(?:Drug\s+Class|Phase|EudraCT|Indication|Sponsor|Active|$))',
                    r'(?i)Active\s+Ingredient[:\s]+(.+?)(?=\n|$)',
                    r'(?i)Investigational\s+(?:Medicinal\s+)?Product[:\s\n]+([\s\S]+?)(?=\n\s*(?:Drug|Phase|EudraCT|Indication|Sponsor|$))',
                    r'(?i)Drug\s+Product[:\s]+(.+?)(?=\n|$)',
                    r'(?i)Investigational\s+Drug[:\s]+(.+?)(?=\n|$)',
                    r'(?i)Study\s+Drug[:\s]+(.+?)(?=\n|$)',
                    r'(?i)Name\s+of\s+Drug[:\s]+(.+?)(?=\n|$)'
                ]
                for pattern in patterns:
                    match = self._extract_pattern(text, pattern, max_length=300)
                    if match:
                        result['drug_name'] = match
                        break
        
        # Conflict Resolution: NER arbitration
        if result['sponsor_name'] and result['drug_name']:
             # If Sponsor validates as PRODUCT, it's wrong
             if self._validate_candidate(result['sponsor_name'], 'PRODUCT'):
                 print(f"⚠️ Sponsor '{result['sponsor_name']}' looks like a Product. Clearing.")
                 result['sponsor_name'] = None

        if not result['dosage_form']:
            # Search for dosage form near product/drug description (first 5000 chars)
            # Priority order: specific forms first, generic last
            dosage_forms = [
                ('Tablet', r'\btablets?\b'),
                ('Capsule', r'\bcapsules?\b'),
                ('Injection', r'\binjections?\b'),
                ('Suspension', r'\bsuspensions?\b'),
                ('Powder', r'\bpowder\b'),
                ('Cream', r'\bcream\b'),
                ('Solution', r'\b(?:oral\s+)?solution\b'),
            ]
            search_text = text[:5000]
            for form_name, pattern in dosage_forms:
                if re.search(pattern, search_text, re.IGNORECASE):
                    result['dosage_form'] = form_name
                    break
        
        if not result['route_of_administration']:
            routes = {
                'Oral': ['oral', 'by mouth', 'po'],
                'Intravenous': ['intravenous', 'iv', 'infusion', 'injection'], # Added injection
                'Subcutaneous': ['subcutaneous', 'sc'],
            }
            text_lower = text.lower()
            for route, keywords in routes.items():
                for keyword in keywords:
                    # STRICT matching to avoid "po" matching "Protocol" or "iv" in "drive"
                    # \b ensures word boundary
                    if re.search(fr'\b{keyword}\b', text_lower):
                        result['route_of_administration'] = route
                        break
                if result['route_of_administration']:
                    break
        
        if use_llm:
            # Priority 3: LLM for critical missing fields
            critical_fields = ['drug_name', 'study_phase', 'protocol_number', 'sponsor_name', 'protocol_title', 'indication']
            missing_critical = [f for f in critical_fields if not result[f]]
            
            if missing_critical:
                # Last Resort: Single LLM call for all missing fields using first 3 pages context
                try:
                    # Use a larger context for the prompt
                    context_text = text[:8000]
                    prompt = f"""
                    Analyze the following Clinical Trial Protocol text and extract these checking fields: {', '.join(missing_critical)}.
                    
                    Text Context (Page 1-3):
                    {context_text}
                    
                    Task: Find the values for the requested fields. 
                    - Look for "NCT" numbers for protocol number. 
                    - Look for institutions/hospitals for sponsor if "Sponsor" is not explicitly named.
                    - Look for the official Drug Name or Investigational Product name.
                    
                    Return ONLY valid JSON with these keys. If not found, use null.
                    Example: {{"drug_name": "Ibuprofen", "study_phase": "Phase 2"}}
                    """
                    response = self.llm.invoke(prompt).strip()
                    
                    json_data = self._parse_llm_json(response)
                    
                    if json_data:
                        for key, val in json_data.items():
                            if key in result and (not result[key] or str(result[key]).lower() in ['none', 'null', 'unknown']):
                                if val and str(val).lower() not in ['null', 'none', 'unknown', 'n/a']:
                                    result[key] = str(val).strip()
                except Exception as e:
                    print(f"⚠️  Last resort extraction failed: {e}")
                
        # Fill sponsor_name if still missing by using LLM specifically
        if not result['sponsor_name'] and use_llm:
             result['sponsor_name'] = self._llm_extract_field(
                'sponsor_name',
                text,
                "Extract the Sponsor Name (usually a pharmaceutical company) found in the title page or protocol summary."
            )

        if not result['contact_person'] and use_llm:
            result['contact_person'] = self._llm_extract_field(
                'contact_person',
                text,
                "Extract the sponsor's medical expert, responsible personnel, or contact person name. Return ONLY the person's name (e.g. 'John Smith'), NOT a label or section heading."
            )
        
        # Validate contact_person - reject if it looks like a label/heading
        if result['contact_person']:
            cp = result['contact_person']
            label_indicators = ['name, title', 'address, and telephone', 'telephone number', 'sponsor\'s medical', 'responsible for', 'name of the']
            if any(ind in cp.lower() for ind in label_indicators) or len(cp) > 120:
                print(f"⚠️ Rejecting contact_person '{cp[:60]}...' - looks like a label, not a name")
                result['contact_person'] = None

        # Extract contact phone from text
        if not result['contact_phone']:
            phone_patterns = [
                r'(?i)(?:Phone|Tel|Telephone)[:\s]*(\+?[\d\s\-\(\)]{7,20})',
                r'(\+\d{1,3}[\s\-]?\d{1,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4})',
            ]
            for pattern in phone_patterns:
                match = re.search(pattern, text[:10000])
                if match:
                    phone = match.group(1).strip()
                    if len(re.sub(r'[^\d]', '', phone)) >= 7:
                        result['contact_phone'] = phone
                        break

        # Extract contact email from text
        if not result['contact_email']:
            email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', text[:10000])
            if email_match:
                result['contact_email'] = email_match.group(0)
        
        # Final clean for all string fields
        for k, v in result.items():
            if isinstance(v, str):
                result[k] = self._clean_merged_text(v)
        
        return result
    
    def _llm_consolidated_extract_v2(self, context_text: str, hints_1571: Dict, hints_1572: Dict) -> Dict:
        """
        SINGLE consolidated LLM call that extracts ALL fields at once.
        Replaces the old approach of 5-7 separate LLM calls.
        """
        # Build a compact hints summary (only non-null values)
        compact_hints = {}
        for k, v in hints_1571.items():
            if v:
                compact_hints[k] = v
        for k, v in hints_1572.items():
            if v:
                compact_hints[f"inv_{k}"] = v

        prompt = f"""You are a Clinical Trial Protocol extractor. Extract ALL fields from this document. DO NOT HALLUCINATE.

TEXT (first pages):
{context_text}

PRELIMINARY HINTS (from pattern matching - verify against text):
{json.dumps(compact_hints)}

Extract ALL of these fields. Return null if not found in the text.

IMPORTANT RULES:
- "drug_name" must be the actual product/drug name(s) from "Name of product(s)" or "Investigational Product" fields. Do NOT use "Drug Class" as the drug name.
- "contact_person" must be an actual person's name, NOT a label like "Name, title, address..." or a section heading.
- "contact_phone" must be an actual phone number with digits, NOT a label.
- "contact_email" must be an actual email address, NOT a label.

Return ONLY valid JSON:
{{
  "fda_1571": {{
    "sponsor_name": "Pharmaceutical company name",
    "sponsor_address": "Full address of sponsor",
    "contact_person": "Actual person name (sponsor medical expert or contact)",
    "contact_phone": "Phone number with digits",
    "contact_email": "Email address",
    "drug_name": "Product name(s) from 'Name of product(s)' field, NOT drug class",
    "dosage_form": "tablet/capsule/injection/solution",
    "route_of_administration": "Oral/Intravenous/Subcutaneous",
    "indication": "Specific medical condition",
    "study_phase": "Phase 1/2/3/4",
    "protocol_title": "Full official study title",
    "protocol_number": "Study identifier (NCT/protocol number)",
    "ind_number": "IND number if present",
    "submission_type": "Initial/Amendment"
  }},
  "fda_1572": {{
    "investigator_name": "Principal Investigator (PERSON name only)",
    "investigator_address": "Investigator institution and address",
    "protocol_number": "Same protocol number",
    "irb_name": "IRB or Ethics Committee name"
  }}
}}"""
        try:
            print(f"🤖 Calling LLM for consolidated extraction (single pass)...")
            response = self.llm.invoke(prompt).strip()
            data = self._parse_llm_json(response)
            
            if data:
                print(f"✅ LLM Consolidated Extraction V2 successful")
                # Merge back hints ONLY if LLM returned null or empty for a field
                for form in ['fda_1571', 'fda_1572']:
                    if form not in data:
                        data[form] = {}
                    hints = hints_1571 if form == 'fda_1571' else hints_1572
                    for k, v in hints.items():
                        llm_val = data[form].get(k)
                        if (not llm_val or str(llm_val).lower() in ['null', 'none', '']) and v:
                            data[form][k] = v
                return data
        except Exception as e:
            print(f"⚠️  Consolidated extraction V2 failed: {e}")
        return {"fda_1571": hints_1571, "fda_1572": hints_1572}

    def _extract_1572(self, text: str, structured_data: Dict) -> Dict:
        """
        Extract FDA Form 1572 data
        Focus on investigator and site information
        """
        result = {
            "protocol_number": None,
            "investigator_name": None,
            "investigator_address": None,
            "study_sites": [],
            "irb_name": None,
            "sub_investigators": [],
            "clinical_laboratories": []
        }
        
        # Use structured data
        for key in ['protocol_number', 'investigator_name']:
            if key in structured_data and structured_data[key]:
                result[key] = structured_data[key]

        # Priority 2: Pattern-based extraction for Investigator if missing
        # (Crucial for docs where table extraction fails)
        
        # Helper to validate investigator names
        def is_valid_name(name):
            if not name: return False
            if len(name) < 3: return False
            if len(name) < 3: return False
            blacklist = ['at each trial site', 'principal investigator', 'investigator', 'study director', 'signature', 'date', 'name', 'title', 'redacted', 'unknown', 'none', 'n/a', 'under', 'signed']
            clean_name = re.sub(r'[^a-zA-Z\s]', '', name).lower().strip()
            
            # Must contain at least one space (First Last) and be mostly Title Case in original if possible
            # But heuristic: if it's all lowercase "under", it's wrong.
            if clean_name in blacklist: return False

            return clean_name not in blacklist and len(clean_name) > 3

        # Validate existing result (often table extraction grabs generic text)
        if result['investigator_name']:
            if not self._validate_candidate(result['investigator_name'], 'PERSON'):
                 result['investigator_name'] = None
            
        if not result['protocol_number']:
            patterns = [
                r'(?i)Study\s+Number[:\s]+([A-Z0-9][A-Z0-9-]{4,})',
                r'(?i)Protocol\s+Number[:\s]+([A-Z0-9][A-Z0-9-]{4,})',
                r'(?i)(NCT\d{8})',
                r'(?i)[A-Z]{2,4}-[A-Z0-9]{2,4}-\d{3,}'
            ]
            for pattern in patterns:
                match = self._extract_pattern(text, pattern, max_length=50)
                if match:
                    result['protocol_number'] = match
                    break

        if not result['investigator_name']:
            patterns = [
                r'(?i)Principal\s+Inv[ae]{1,2}stigator[:\s]+(.+?)(?=\n|$|Project)',
                r'(?i)National\s+Coordinating\s+Inv[ae]{1,2}stigator[:\s]+(.+?)(?=\n|$)',
                r'(?i)Study\s+Director[:\s]+(.+?)(?=\n|$)',
                r'(?i)Investigator[:\s]+(.+?)(?=\n|$)',
                r'(?i)Full\s+Name[:\s]+(.+?)(?=\n|$)',
                r'(?i)Name[:\s]+(.*?)(?=\s*Title:)', # Generic "Name: ... Title:" pattern
            ]
            for pattern in patterns:
                match = self._extract_pattern(text, pattern, max_length=150)
                if match:
                     # NER Validation: Must be a PERSON
                     if self._validate_candidate(match, 'PERSON'):
                        result['investigator_name'] = match
                        break
                     else:
                        print(f"⚠️ Rejecting Investigator candidate '{match}' - NER did not validate as PERSON")
        
        # Last attempt: Scan for "Study Director" or "Medical Monitor" blocks if PI missing
        if not result['investigator_name']:
             match = self._extract_pattern(text, r'(?i)Study\s+Director[:\n\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})', max_length=50)
             if match and is_valid_name(match):
                 result['investigator_name'] = match

        # Fix for merged Investigator Name/Address
        # Similar to Sponsor, the table often contains the full affiliation/address in the Name column
        if result['investigator_name'] and not result['investigator_address']:
            val = result['investigator_name']
            
            # Heuristic: Check for address indicators or length
            affiliation_indicators = ['hospital', 'center', 'university', 'clinic', 'institute', 'department', 'street', 'road', 'box', 'plataforma', 'centro', 'salud']
            
            if len(val) > 30 and any(ind in val.lower() for ind in affiliation_indicators):
                # Use LLM to split
                split_data = self._llm_split_field(val, "Investigator")
                
                if split_data:
                    new_name = split_data.get('name')
                    new_addr = split_data.get('address')
                    
                    if new_name and new_name.lower() not in ['null', 'none', 'redacted', 'unknown']:
                        result['investigator_name'] = new_name
                    elif new_name is None: 
                        # If LLM explicitly says null/redacted, we might clear the name
                        # But to be safe, if we have an address, we assume the original 'val' WAS the address/affiliation
                        pass

                    if new_addr:
                        result['investigator_address'] = new_addr
                        # If the name is null/redacted, and we extracted an address, 
                        # and the original value was basically the address, clear the name field
                        if not new_name or new_name.lower() == 'null':
                             result['investigator_name'] = "Redacted / Not Available"
        
        # Extract study sites
        result['study_sites'] = self._extract_sites(text)
        
        # Extract clinical laboratories
        result['clinical_laboratories'] = self._extract_laboratories(text)
        
        # Extract IRB
        irb_match = re.search(
            r'(?i)(?:IRB|Ethics\s+Committee|Institutional\s+Review\s+Board)\s*[:\s]+(.+?)(?:\n|$)',
            text[:20000]
        )
        if irb_match:
            result['irb_name'] = irb_match.group(1).strip()[:200]
        
        return result
    
    def _extract_sites(self, text: str) -> List[Dict]:
        """Extract clinical trial sites from protocol text"""
        sites = []
        
        # Strategy 1: Find explicit site section
        site_section = re.search(
            r'(?i)(?:trial\s+site|clinical\s+site|study\s+site|address.*trial\s+site)s?\s*[:\s]+(.*?)(?=\n\s*\d+\.\s+[A-Z]|\n{3,}|$)',
            text[:30000],
            re.DOTALL
        )
        
        if site_section:
            site_text = site_section.group(1)[:3000]
            doc = self.nlp_general(site_text)
            
            for ent in doc.ents:
                if ent.label_ in ['ORG', 'FAC', 'GPE'] and len(ent.text) > 5:
                    sites.append({
                        "site_name": ent.text,
                        "site_address": None
                    })
        
        # Strategy 2: Look for "Appendix" references to PI list
        if not sites:
            appendix_match = re.search(
                r'(?i)(?:Appendix\s+\d*\s*[-–]?\s*Principal\s+Investigators?|list\s+of\s+(?:principal\s+)?investigators?)',
                text[:30000]
            )
            if appendix_match:
                # Extract location mentions near investigator sections
                inv_section = text[max(0, appendix_match.start()-200):appendix_match.start()+2000]
                doc = self.nlp_general(inv_section)
                for ent in doc.ents:
                    if ent.label_ in ['GPE', 'LOC'] and len(ent.text) > 3:
                        sites.append({
                            "site_name": ent.text,
                            "site_address": None
                        })
        
        # Deduplicate
        seen = set()
        unique_sites = []
        for s in sites:
            key = s['site_name'].lower()
            if key not in seen:
                seen.add(key)
                unique_sites.append(s)
        
        return unique_sites[:10]
    
    def _extract_laboratories(self, text: str) -> List[Dict]:
        """Extract clinical laboratories from CONTACT DETAILS section"""
        labs = []
        
        # Find laboratory/lab sections in the text
        lab_patterns = [
            r'(?i)(?:clinical\s+)?laborator(?:y|ies)\s*[:\s]+(.*?)(?=\n\s*(?:\d+\.\s+[A-Z]|SIGNATURES|ABBREVIATIONS)|\n{3,})',
            r'(?i)(?:PCR\s+Analysis|Quality\s+Control\s+PCR|PK\s+Analysis)\s*\n(.*?)(?=\n\s*(?:[A-Z][a-z]+:|\d+\.\s+[A-Z])|\n{3,})',
        ]
        
        for pattern in lab_patterns:
            for match in re.finditer(pattern, text[:15000], re.DOTALL):
                lab_text = match.group(1).strip()[:500]
                if len(lab_text) > 10:
                    # Use NER to extract organization names
                    doc = self.nlp_general(lab_text)
                    for ent in doc.ents:
                        if ent.label_ in ['ORG', 'FAC'] and len(ent.text) > 5:
                            labs.append({
                                "lab_name": ent.text,
                                "lab_address": None
                            })
        
        # Also try to find lab names by pattern
        lab_name_matches = re.findall(
            r'(?i)((?:Laboratorio|Laboratory|Institut[eo]|Centro|Departamento|Núcleo)\s+[^\n]{5,60})',
            text[:15000]
        )
        for name in lab_name_matches:
            name = name.strip()
            if name and len(name) > 10:
                labs.append({"lab_name": name, "lab_address": None})
        
        # Deduplicate
        seen = set()
        unique_labs = []
        for lab in labs:
            key = lab['lab_name'].lower()[:30]
            if key not in seen:
                seen.add(key)
                unique_labs.append(lab)
        
        return unique_labs[:10]
    
    def _extract_pattern(self, text: str, pattern: str, max_length: int = 100) -> Optional[str]:
        """Extract text using regex pattern"""
        match = re.search(pattern, text[:30000], re.IGNORECASE)
        if match:
            value = match.group(1).strip()
            # Clean up
            value = ' '.join(value.split())
            if len(value) <= max_length and value.lower() not in ['na', 'n/a', 'none', 'null']:
                return value
        return None
    
    def _llm_extract_field(self, field: str, text: str, instruction: str) -> Optional[str]:
        """LLM extraction for single field"""
        prompt = f"""{instruction}

Context (first 6000 characters):
{text[:6000]}

Return ONLY the extracted value, or "null" if not found.
Value:"""
        
        try:
            response = self.llm.invoke(prompt).strip()
            # Clean response
            response = response.replace('"', '').replace("'", "").strip()
            if response.lower() in ['null', 'none', 'n/a', 'not found'] or len(response) < 2:
                return None
            return response[:200]  # Limit length
        except Exception as e:
            print(f"⚠️  LLM extraction failed for {field}: {e}")
            return None
    
    def _validate_form(self, data: Dict, form_type: str) -> Dict:
        """Validate extracted form data"""
        errors = []
        warnings = []
        
        if form_type == '1571':
            required = ['drug_name', 'study_phase', 'protocol_number', 'sponsor_name']
            for field in required:
                if not data.get(field):
                    errors.append(f"Missing required field: {field}")
        
        elif form_type == '1572':
            required = ['investigator_name', 'protocol_number']
            for field in required:
                if not data.get(field):
                    errors.append(f"Missing required field: {field}")
        
        # Calculate completeness
        non_null_fields = sum(1 for v in data.values() if v)
        completeness = non_null_fields / len(data) if data else 0
        
        return {
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings,
            'completeness': round(completeness, 2),
            'fields_found': non_null_fields,
            'total_fields': len(data)
        }
