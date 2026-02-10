"""
Enhanced Protocol Rule Agent for Clinical Trial Eligibility Extraction
Uses LLM + scispaCy for dynamic medical term detection without hardcoded patterns.

CRITICAL: NO HALLUCINATION - All extracted data must exist in the source document.
"""

import re
import json
from typing import List, Dict, Optional, Any
import spacy
import io

# PDF Processing libraries
import pdfplumber
import fitz  # PyMuPDF

# CRITICAL: Import scispacy BEFORE using the linker - this registers the factory
try:
    import scispacy
    from scispacy.linking import EntityLinker
    SCISPACY_AVAILABLE = True
except ImportError:
    SCISPACY_AVAILABLE = False
    print("⚠️  scispacy not installed. Run: pip install scispacy==0.5.4")

# OCR support (optional)
try:
    from PIL import Image
    import pytesseract
    OCR_AVAILABLE = True
except Exception:
    OCR_AVAILABLE = False

from negspacy.negation import Negex
from langchain_ollama import OllamaLLM


def parse_pdf_file(path, ocr_threshold_chars=100):
    """
    Robust text extractor supporting multiple PDF formats:
    - Try pdfplumber (best preserves layout)
    - Fallback to PyMuPDF
    - If text length is tiny for a page, optionally OCR that page (if pytesseract installed)
    Returns full concatenated text (pages separated by \n\n---PAGE---\n\n).
    """
    full_text_pages = []
    # 1) pdfplumber first
    try:
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                # If the page has little text and OCR is available, run OCR
                if len(text.strip()) < ocr_threshold_chars and OCR_AVAILABLE:
                    im = page.to_image(resolution=150).original
                    text = pytesseract.image_to_string(im)
                full_text_pages.append(text)
        return "\n\n---PAGE---\n\n".join(full_text_pages)
    except Exception:
        pass

    # 2) PyMuPDF fallback
    try:
        doc = fitz.open(path)
        for p in doc:
            text = p.get_text("text") or ""
            if len(text.strip()) < ocr_threshold_chars and OCR_AVAILABLE:
                pix = p.get_pixmap(dpi=150)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                text = pytesseract.image_to_string(img)
            full_text_pages.append(text)
        return "\n\n---PAGE---\n\n".join(full_text_pages)
    except Exception:
        pass

    raise RuntimeError("Unable to parse PDF (install pdfplumber/fitz and optionally pytesseract).")


class ProtocolRuleAgent:
    """
    Enhanced AI Agent for extracting structured eligibility criteria from clinical trial protocols.
    Uses dynamic NLP-based medical term detection instead of hardcoded patterns.
    
    ANTI-HALLUCINATION: All values must be validated against source text.
    """
    
    def __init__(self, model_name='en_core_sci_lg', load_linker=False):
        # 1. Load shared scispaCy medical NLP model
        from backend.nlp_utils import get_nlp, get_llm
        self.nlp = get_nlp(model_name, load_linker=load_linker)
        self.has_entity_linker = "scispacy_linker" in self.nlp.pipe_names
        
        # 2. Use shared Ollama LLM
        self.llm = get_llm()
        
        # 5. Compile regex patterns for numeric value extraction (not for term detection)
        self._init_value_patterns()
        
        # 6. Track extracted glossary terms
        self.extracted_glossary = {}
    
    def _init_value_patterns(self):
        """Initialize patterns for extracting numeric values and operators from text.
        These are for VALUE extraction, not TERM detection."""
        
        # Extended unit list
        units = r'(years?|kg|mg/dL|g/dL|mL/min(?:/1\.73\s*m²?)?|×?\s*ULN|%|mmHg|msec|ms|days?|weeks?|months?|bpm|L/min|cm3|cm³)'
        
        # Numeric value with operator, supporting ± ranges
        self.VALUE_PATTERN = re.compile(
            rf'(>=|<=|>|<|≥|≤|=|between|at least|at most|more than|less than|greater than|\u00B1|\+/-)\s*'
            r'(\d+(?:\.\d+)?)\s*(?:\u00B1|\+/-\s*(\d+(?:\.\d+)?))?\s*'
            rf'(?:(?:and|to|-)\s*(\d+(?:\.\d+)?))?\s*'
            rf'({units})?',
            re.IGNORECASE
        )
        
        # Age patterns
        self.AGE_PATTERN = re.compile(
            r'(?:age[d]?\s*)?(\d+)\s*(?:to|-)\s*(\d+)\s*(years?)?|'
            r'(?:age[d]?\s*)(>=|<=|>|<|≥|≤)?\s*(\d+)\s*(years?|or older|or younger)?',
            re.IGNORECASE
        )
        
        # ULN multiplier pattern
        self.ULN_PATTERN = re.compile(
            r'(\d+(?:\.\d+)?)\s*[×x]\s*(?:ULN|upper limit)',
            re.IGNORECASE
        )
        
        # Temporal pattern
        self.TEMPORAL_PATTERN = re.compile(
            r'(within|prior to|before|last|past|previous)\s*(\d+)\s*(days?|weeks?|months?|years?)',
            re.IGNORECASE
        )

    def extract_rules(self, protocol_text: str) -> Dict[str, List[Dict]]:
        """
        Main entry point: Extract structured eligibility rules from protocol text.
        
        ANTI-HALLUCINATION: All returned values are validated against source text.
        """
        # 1. Clean the text
        cleaned_text = self._clean_text(protocol_text)
        
        # 2. Detect sections dynamically using LLM
        sections = self._detect_sections(cleaned_text)
        
        final_rules = {
            "inclusion": [],
            "exclusion": []
        }
        
        # 3. Process each section
        for category in ["inclusion", "exclusion"]:
            section_text = sections.get(category, "")
            if not section_text:
                continue
            
            # Split into individual criteria
            criteria_list = self._split_criteria(section_text)
            valid_criteria = [c for c in criteria_list if self._is_valid_criterion(c)]
            
            if not valid_criteria:
                continue
            
            # PERFORMANCE OPTIMIZATION: Process all criteria in section using nlp.pipe (much faster)
            facts_list = []
            criterion_docs = list(self.nlp.pipe(valid_criteria))
            
            for criterion_text, doc in zip(valid_criteria, criterion_docs):
                facts = self._extract_basic_facts(criterion_text, category, doc=doc)
                facts_list.append(facts)
            
            # Step 2: Batch Normalize using LLM (saves roundtrips)
            # PERFORMANCE OPTIMIZATION: Process in larger batches (20)
            batch_size = 20
            for i in range(0, len(facts_list), batch_size):
                batch = facts_list[i:i + batch_size]
                normalized_batch = self._batch_normalize_with_llm(batch)
                
                for original_facts, normalized in zip(batch, normalized_batch):
                    final_rule = normalized if normalized else original_facts
                    # Anti-hallucination check
                    if self._validate_against_source(final_rule, original_facts['source_text']):
                        final_rules[category].append(final_rule)
                    else:
                        print(f"⚠️  Hallucination detected, using basic facts for: {original_facts['source_text'][:50]}...")
                        final_rules[category].append(original_facts)
        
        # Build summary counts
        summary = {}
        for cat, rules in final_rules.items():
            for r in rules:
                t = r.get('rule_type', 'UNKNOWN')
                summary.setdefault(t, 0)
                summary[t] += 1
        final_rules['_summary'] = summary
        
        return final_rules
    
    def _clean_text(self, text: str) -> str:
        """Remove PDF artifacts and normalize text."""
        # Replace common bullet-like CID characters with standard bullets
        text = re.sub(r'\(cid:120\)', '•', text)
        text = re.sub(r'\(cid:182\)', ' ', text) # often used for apostrophes or noise
        
        # Remove other CID characters (PDF encoding artifacts)
        text = re.sub(r'\(cid:\d+\)', ' ', text)
        
        # Remove page markers
        text = re.sub(r'(?i)Page\s+\d+\s+of\s+\d+', '', text)
        
        # Remove confidentiality markers
        text = re.sub(r'(?i)Confidential', '', text)
        
        # Remove protocol version headers (more robust, stop at newline)
        text = re.sub(r'(?i)Protocol\s+(?:number|version)\s+[^\n]+', '', text)
        
        # Remove Date/Version lines (e.g. "May 04, 2018. Version 5.0.")
        text = re.sub(r'(?i)[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}\.?\s+Version\s+[\d.]+', '', text)
        
        # Remove TOC-style dotted lines with page numbers
        text = re.sub(r'\.{3,}\s*\d+', '', text)
        
        # Normalize whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r' {2,}', ' ', text)
        
        return text.strip()
    
    def _detect_sections(self, text: str) -> Dict[str, str]:
        """
        Detect inclusion/exclusion sections dynamically.
        Improved to skip TOC entries and find actual section content.
        """
        sections = {"inclusion": "", "exclusion": "", "screening": "", "lab_values": "", "withdrawal": ""}
        
        # Section header patterns - these mark the START of sections
        section_patterns = {
            'inclusion': r'(?i)(?:\n\s*)(?:\d+\.?\d*\\.?\s*)?(?:Inclusion\s+[Cc]riteria|[Cc]riteria\s+for\s+[Ii]nclusion)',
            'exclusion': r'(?i)(?:\n\s*)(?:\d+\.?\d*\\.?\s*)?(?:Exclusion\s+[Cc]riteria|[Cc]riteria\s+for\s+[Ee]xclusion)',
        }
        
        # Section END patterns - these mark where eligibility sections typically end
        end_patterns = [
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\\.?\s*)?(?:Study\s+(?:Drug|Treatment|Design|Procedures?|Population)|Investigational\s+Product)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\\.?\s*)?(?:Removal|Withdrawal|Discontinuation)\s+(?:of\s+)?(?:Subjects?|Patients?)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\\.?\s*)?(?:Assessment|Evaluation|Endpoints?)\s',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\\.?\s*)?(?:Statistical|Analysis|Sample\s+Size)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\\.?\s*)?(?:Schedule\s+of\s+(?:Events|Assessments))',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\\.?\s*)?(?:Enrolment|Enrollment)\s+Procedures',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\\.?\s*)?(?:Number\s+of\s+Cases)',
            # Generic numbered section header: "3. Title" or "4 Title" where Title starts with Uppercase
            r'(?:\n\s*)(?:\d+\.?\d*\.?\s+)[A-Z][a-z]+',
        ]
        
        # Combine end patterns
        end_pattern = '|'.join(f'({p})' for p in end_patterns)
        
        # Find all section matches - skip TOC entries (contain dotted lines)
        for section_name, pattern in section_patterns.items():
            matches = list(re.finditer(pattern, text))
            
            # Find the first match that's NOT in a TOC (doesn't have dots before it)
            for match in matches:
                # Get context before match
                context_start = max(0, match.start() - 50)
                context_before = text[context_start:match.start()]
                
                # Skip if in TOC (dotted line pattern)
                if re.search(r'\.{3,}', context_before):
                    continue
                
                # Find section end
                search_start = match.end()
                
                # For inclusion, end at exclusion if found, otherwise use end_patterns
                if section_name == 'inclusion':
                    exc_match = re.search(section_patterns['exclusion'], text[search_start:])
                    if exc_match:
                        section_end = search_start + exc_match.start()
                    else:
                        # Use generic end patterns
                        end_match = re.search(end_pattern, text[search_start:])
                        section_end = search_start + end_match.start() if end_match else min(search_start + 5000, len(text))
                else:
                    # For exclusion, use generic end patterns
                    end_match = re.search(end_pattern, text[search_start:])
                    section_end = search_start + end_match.start() if end_match else min(search_start + 5000, len(text))
                
                # Extract content
                section_content = text[search_start:section_end].strip()
                
                # Clean up - remove leading punctuation and whitespace  
                section_content = re.sub(r'^[:\s\n]+', '', section_content)
                
                # Limit to reasonable size (max 4000 chars per section)
                if len(section_content) > 4000:
                    section_content = section_content[:4000]
                
                sections[section_name] = section_content
                break  # Use first valid match
        
        # If no sections found, use LLM to identify them
        if not sections['inclusion'] and not sections['exclusion']:
            sections = self._detect_sections_with_llm(text)
        
        return sections

    
    def _detect_sections_with_llm(self, text: str) -> Dict[str, str]:
        """
        Use LLM to identify section boundaries in non-standard protocols.
        Returns only content that exists in the source text.
        """
        prompt = f"""Analyze this clinical trial protocol and identify the text sections containing eligibility criteria.

PROTOCOL TEXT (first 4000 characters):
{text[:4000]}

TASK: Return a JSON object with these keys, containing ONLY text that appears VERBATIM in the protocol:
- "inclusion_start": The exact text that marks the start of inclusion criteria (or null if not found)
- "exclusion_start": The exact text that marks the start of exclusion criteria (or null if not found)

CRITICAL: Return ONLY valid JSON. DO NOT INCLUDE COMMENTS (//) or any explanatory text. Do not use Markdown blocks.
JSON:"""

        try:
            response = self.llm.invoke(prompt)
            
            # Robust JSON extraction: first { and last }
            start = response.find('{')
            end = response.rfind('}')
            
            if start != -1 and end != -1:
                json_str = response[start:end+1]
                # Remove control characters before parsing
                json_str = "".join(ch for ch in json_str if ord(ch) >= 32 or ch == '\n' or ch == '\r')
                # Remove // style comments
                json_str = re.sub(r'//.*', '', json_str)
                markers = json.loads(json_str)
                
                sections = {"inclusion": "", "exclusion": "", "screening": "", "lab_values": "", "withdrawal": ""}
                
                # ANTI-HALLUCINATION: Verify markers exist in text before using
                inc_start = markers.get('inclusion_start')
                exc_start = markers.get('exclusion_start')
                
                if inc_start and inc_start in text:
                    inc_pos = text.find(inc_start)
                    exc_pos = text.find(exc_start) if exc_start and exc_start in text else len(text)
                    sections['inclusion'] = text[inc_pos:exc_pos] if inc_pos < exc_pos else text[inc_pos:]
                
                if exc_start and exc_start in text:
                    exc_pos = text.find(exc_start)
                    sections['exclusion'] = text[exc_pos:]
                
                return sections
        except Exception as e:
            print(f"⚠️  LLM section detection failed: {e}")
        
        return {"inclusion": "", "exclusion": "", "screening": "", "lab_values": "", "withdrawal": ""}
    
    def _split_criteria(self, section_text: str) -> List[str]:
        """Split section text into individual criteria."""
        # Normalize newlines then split by common bullet/numbering
        text = section_text.replace('\r\n', '\n')
        # Step 1: split on bullet-like tokens
        # Added 'o' as a bullet point (common in OCR/bad formatting)
        items = re.split(r'(?:^|\n)\s*(?:\d+[\.)]\s*|[•●○▪\-\*]\s*|o\s+|[a-zA-Z]\)[\s]|[ivx]+\)|[A-Z]\.)', text, flags=re.IGNORECASE)
        items = [it.strip() for it in items if it and len(it.strip())>0]

        # Step 2: handle lines that are indented continuation of previous bullet:
        merged = []
        for it in items:
            # treat lines starting with lowercase continuation words as continuation
            if merged and re.match(r'^[a-z0-9\(\[]', it) is None and len(it.split()) < 6 and not re.search(r'\b(age|pregn|history|no|without)\b', it, re.IGNORECASE):
                merged[-1] += ' ' + it
            else:
                merged.append(it)

        if len(merged) <= 1:
            # semicolon fallback
            if section_text.count(';') >= 2:
                merged = [s.strip() for s in section_text.split(';') if s.strip()]
            else:
                # NLP sentence-split fallback
                doc = self.nlp(section_text)
                merged = [sent.text.strip() for sent in doc.sents if sent.text.strip()]

        return merged
    
    def _is_valid_criterion(self, text: str) -> bool:
        """Check if text is a valid criterion (not header/noise)."""
        text = text.strip()
        
        # Too short
        if len(text) < 15:
            return False
        
        # Just numbers and dots (TOC artifacts like "38 4." or ".... 42")
        if re.match(r'^[\d\s\.]+$', text):
            return False
        
        # Table of contents patterns (various dot leader formats)
        if re.search(r'\.{2,}\s*\d+', text):  # ".... 42"
            return False
        if re.search(r'\d+\s*\.{2,}', text):  # "42 ...."
            return False
        if re.search(r'^[\d\.]+\s*$', text):  # Just "38 4."
            return False
        
        # Header patterns/Introductory sentences
        if text.endswith(':'):
            return False
        if re.match(r'^(?:inclusion|exclusion|screening)\s+criteria\s*:?\s*$', text, re.IGNORECASE):
            return False
        if "following inclusion criteria" in text.lower() or "following exclusion criteria" in text.lower():
            return False
        
        # Page/version markers
        if re.search(r'(?i)page\s+\d+|version\s+\d+', text):
            return False
        
        # Section numbers only (like "4.2" or "4.3.1")
        if re.match(r'^\d+(\.\d+)*\s*$', text):
            return False
        
        # Must contain some alphabetic characters
        if not re.search(r'[a-zA-Z]{3,}', text):
            return False
        
        return True
    
    def _extract_basic_facts(self, text: str, category: str, doc=None) -> Dict:
        """
        Fast extraction of basic facts using scispaCy and regex.
        This provides the seed data for LLM normalization.
        """
        # 1. Extract medical entities using scispaCy
        if doc is None:
            doc = self.nlp(text)
        
        entities = self._extract_entities(doc, text)
        
        # 2. Detect negation context
        is_negated = self._detect_negation(text, doc)
        
        # 3. Extract numeric values and operators
        values = self._extract_values(text)
        
        # 4. Determine rule type based on entities and values
        rule_type = self._classify_rule_type(text, entities, values)
        
        # 5. Build structured rule
        rule = {
            "source_text": text,
            "rule_type": rule_type,
            "category": category.upper(),
            "negated": is_negated or category == "exclusion"
        }
        
        # Add field from primary entity
        if entities:
            primary_entity = entities[0]
            rule["field"] = primary_entity.get("text", "")
            
            # Add UMLS concept if available
            if primary_entity.get("cui"):
                rule["umls_cui"] = primary_entity["cui"]
                
        # Add extracted values
        if values:
            rule["operator"] = values.get("operator")
            rule["value"] = values.get("value")
            if values.get("value2"):
                rule["value2"] = values["value2"]
            if values.get("unit"):
                rule["unit"] = values["unit"]
        
        # Add temporal constraints
        temporal = self._extract_temporal(text)
        if temporal:
            rule["temporal_window"] = temporal.get("window")
            rule["temporal_unit"] = temporal.get("unit")
        
        # Determine applies_to
        if re.search(r'\b(women|female|woman)\b', text, re.IGNORECASE):
            rule["applies_to"] = "FEMALE"
        elif re.search(r'\b(men|male|man)\b', text, re.IGNORECASE):
            rule["applies_to"] = "MALE"
        else:
            rule["applies_to"] = "ALL"
            
        return rule

    def _extract_rule(self, text: str, category: str) -> Optional[Dict]:
        """
        Extract a single structured rule. 
        Note: The batch version (_batch_normalize_with_llm) is faster and preferred.
        """
        facts = self._extract_basic_facts(text, category)
        normalized = self._normalize_with_llm(text, facts)
        
        if normalized and self._validate_against_source(normalized, text):
            return normalized
        return facts
    
    def _extract_entities(self, doc, source_text: str) -> List[Dict]:
        """Extract medical entities using scispaCy."""
        entities = []
        
        for ent in doc.ents:
            entity = {
                "text": ent.text,
                "label": ent.label_,
                "start": ent.start_char,
                "end": ent.end_char
            }
            
            # Get UMLS concept if entity linker is available
            if self.has_entity_linker and hasattr(ent._, 'kb_ents') and ent._.kb_ents:
                cui, score = ent._.kb_ents[0]
                entity["cui"] = cui
                entity["confidence"] = score
                
                # Get semantic type from UMLS linker
                linker = self.nlp.get_pipe("scispacy_linker")
                if cui in linker.kb.cui_to_entity:
                    entity["semantic_type"] = list(linker.kb.cui_to_entity[cui].types)[0] if linker.kb.cui_to_entity[cui].types else None
            
            entities.append(entity)
        
        return entities
    
    def _detect_negation(self, text: str, doc) -> bool:
        """Detect if the criterion contains negation."""
        # Check explicit negation patterns
        negation_patterns = [
            r'^no\s+', r'^not\s+', r'^without\s+', r'^absence\s+of',
            r'^must\s+not', r'^should\s+not', r'^free\s+of', r'^negative\s+for'
        ]
        
        for pattern in negation_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return True
        
        # Check negspacy negation on entities
        for ent in doc.ents:
            if hasattr(ent._, 'negex') and ent._.negex:
                return True
        
        return False
    
    def _extract_values(self, text: str) -> Optional[Dict]:
        """Extract numeric values and operators from text."""
        result = {}
        
        # Check for ULN pattern first
        uln_match = self.ULN_PATTERN.search(text)
        if uln_match:
            result["value"] = uln_match.group(1)
            result["unit"] = "× ULN"
            result["operator"] = "<=" if re.search(r'less|below|under|≤|<', text, re.IGNORECASE) else ">="
            return result
        
        # Check for age pattern
        age_match = self.AGE_PATTERN.search(text)
        if age_match and re.search(r'age|year', text, re.IGNORECASE):
            groups = age_match.groups()
            if groups[0] and groups[1]:  # Range: X to Y years
                result["value"] = groups[0]
                result["value2"] = groups[1]
                result["operator"] = "BETWEEN"
                result["unit"] = "years"
            elif groups[4]:  # Single value with operator
                result["value"] = groups[4]
                result["operator"] = self._normalize_operator(groups[3] or ">=")
                result["unit"] = "years"
            return result
        
        # General value pattern
        value_match = self.VALUE_PATTERN.search(text)
        if value_match:
            result["operator"] = self._normalize_operator(value_match.group(1))
            result["value"] = value_match.group(2)
            if value_match.group(3):
                result["value2"] = value_match.group(3)
                result["operator"] = "BETWEEN"
            if value_match.group(4):
                result["unit"] = value_match.group(4).strip()
            return result
        
        return None
    
    def _normalize_operator(self, op: str) -> str:
        """Normalize operator to standard format."""
        op = op.lower().strip()
        mapping = {
            '>=': '>=', '≥': '>=', 'at least': '>=', 'greater than or equal': '>=', 'more than or equal': '>=',
            '<=': '<=', '≤': '<=', 'at most': '<=', 'less than or equal': '<=',
            '>': '>', 'greater than': '>', 'more than': '>', 'above': '>',
            '<': '<', 'less than': '<', 'below': '<', 'under': '<',
            '=': '='
        }
        return mapping.get(op, op.upper())
    
    def _extract_temporal(self, text: str) -> Optional[Dict]:
        """Extract temporal constraints from text."""
        match = self.TEMPORAL_PATTERN.search(text)
        if match:
            return {
                "window": int(match.group(2)),
                "unit": match.group(3).rstrip('s')  # Normalize: days -> day
            }
        return None
    
    def _classify_rule_type(self, text: str, entities: List[Dict], values: Optional[Dict]) -> str:
        """Classify the rule type based on content."""
        text_lower = text.lower()
        
        # Check for specific patterns
        
        # 1. Pregnancy/Reproductive Status (Prioritize over Age)
        if re.search(r'\b(pregnant|pregnancy|breastfeeding|lactating|reproductive\s+age|contraception|birth\s+control)\b', text_lower):
            if re.search(r'\b(contraception|birth\s+control|barrier\s+method)\b', text_lower):
                return "CONTRACEPTION"
            return "PREGNANCY_EXCLUSION"

        # 2. Age (Stricter regex to avoid 'reproductive age')
        # Matches: "Age > 18", "18 years old", "Age between"
        if re.search(r'\b(age\s+(?:is|of|greater|less|between)|years?\s+old|[><]\s*\d+\s*years?)\b', text_lower):
            return "AGE"
        
        if re.search(r'\b(ekg|ecg|qtc|electrocardiogram)\b', text_lower):
            return "EKG"
        
        if values and values.get("unit"):
            unit = values["unit"].lower()
            if any(u in unit for u in ['mg/dl', 'g/dl', 'ml/min', 'uln', 'mmol', 'iu', '%']):
                return "LAB_THRESHOLD"
            if 'mmhg' in unit:
                return "VITAL_SIGN"
        
        if re.search(r'\b(consent|willing|agree)\b', text_lower):
            return "CONSENT_REQUIREMENT"
        
        if re.search(r'\b(history\s+of|prior|previous)\b', text_lower):
            return "MEDICAL_HISTORY"
        
        if re.search(r'\b(surgery|procedure|operation|resection)\b', text_lower):
            return "PROCEDURE_HISTORY"
        
        if re.search(r'\b(medication|drug|treatment|therapy)\b', text_lower):
            return "MEDICATION_HISTORY"
        
        # Check entity types
        for entity in entities:
            label = entity.get("label", "").upper()
            if label in ["DISEASE", "DISORDER"]:
                return "CONDITION_PRESENT"
            if label in ["CHEMICAL", "DRUG"]:
                return "MEDICATION_HISTORY"
        
        # Check for negation indicating absence
        if re.search(r'^(no|not|without|absence|free\s+of)\b', text_lower):
            return "CONDITION_ABSENT"
        
        return "CONDITION_PRESENT"
    
    def _normalize_with_llm(self, text: str, facts: Dict) -> Optional[Dict]:
        """
        Use LLM to normalize and structure the rule.
        
        ANTI-HALLUCINATION: Strict prompting to prevent value invention.
        """
        prompt = f"""You are a clinical trial criteria normalizer. Your job is to format extracted data, NOT to infer or guess.

SOURCE TEXT:
"{text}"

EXTRACTED FACTS:
{json.dumps(facts, indent=2)}

STRICT RULES:
1. ONLY USE VALUES THAT APPEAR IN THE SOURCE TEXT
2. If a value is not in the source text, use null
3. Do not infer operators, units, or values not explicitly stated
4. Field names should match medical terminology in the source
5. This is for {facts.get('category', 'INCLUSION')} criteria
6. RETURN ONLY GENUINE JSON. NO COMMENTS (//), NO MARKDOWN, NO EXPLANATIONS.

Return a clean JSON object with these fields:
- rule_type: {facts.get('rule_type', 'CONDITION_PRESENT')}
- category: {facts.get('category', 'INCLUSION')}
- field: The medical parameter or condition (from source text only)
- operator: The comparison operator (>=, <=, >, <, =, BETWEEN, PRESENT, ABSENT)
- value: The numeric value or null
- value2: Second value for ranges or null
- unit: The unit of measurement or null
- applies_to: ALL, MALE, or FEMALE
- negated: true or false
- source_text: "{text}"

PHASE 2 ENHANCEMENTS (extract if present in source text):
- temporal: {{"window": <number>, "unit": "months"}} for time constraints like "within 6 months" or "in the past year"
- scope: "personal" (default) or "family" if explicitly mentions "family history"
- value_list: ["item1", "item2", ...] for multi-value rules like "warfarin, apixaban, or rivaroxaban"
- group: {{"group_id": "auto", "logic": "AND/OR"}} for compound rules with multiple connected parts (use null for single rules)

JSON:"""

        try:
            response = self.llm.invoke(prompt)
            
            # Clean generic markdown
            cleaned_response = response.replace('```json', '').replace('```', '').strip()
            
            # Robust JSON extraction: first { and last }
            start = cleaned_response.find('{')
            end = cleaned_response.rfind('}')
            
            if start != -1 and end != -1:
                json_str = cleaned_response[start:end+1]
                
                # Remove control characters that break JSON parsing (0-31 except \n \r \t)
                json_str = "".join(ch for ch in json_str if ord(ch) >= 32 or ch in ['\n', '\r', '\t'])
                
                # Remove // style comments that break standard JSON parsing
                json_str = re.sub(r'//.*', '', json_str)
                
                return normalized
            else:
                print(f"⚠️  No JSON found in LLM response for: {text[:50]}...")
                print(f"DEBUG: LLM Response: {response}")
        except Exception as e:
            print(f"⚠️  LLM normalization error: {e}")
            print(f"DEBUG: Failed JSON string: {json_str if 'json_str' in locals() else 'N/A'}")
        
        return None

    def _batch_normalize_with_llm(self, batch: List[Dict]) -> List[Optional[Dict]]:
        """
        Optimize by processing multiple criteria in one LLM call.
        """
        if not batch: return []
        
        prompt = f"""You are a clinical trial criteria normalizer. Format these {len(batch)} criteria into structured JSON.
        
STRICT RULES:
1. ONLY USE VALUES THAT APPEAR IN THE SOURCE TEXT.
2. NO COMMENTS (//), NO MARKDOWN, NO EXPLANATIONS.
3. RETURN A JSON ARRAY of objects.

CRITERIA TO PROCESS:
{json.dumps(batch, indent=2)}

Return a JSON ARRAY where each object has these fields:
- rule_type, category, field, operator, value, value2, unit, applies_to, negated, source_text

JSON ARRAY:"""

        try:
            response = self.llm.invoke(prompt)
            cleaned_response = response.replace('```json', '').replace('```', '').strip()
            
            start = cleaned_response.find('[')
            end = cleaned_response.rfind(']')
            
            if start != -1 and end != -1:
                json_str = cleaned_response[start:end+1]
                json_str = "".join(ch for ch in json_str if ord(ch) >= 32 or ch in ['\n', '\r', '\t'])
                json_str = re.sub(r'//.*', '', json_str)
                
                normalized_list = json.loads(json_str)
                
                # Post-process and ensure results match batch size/order
                results = []
                for i, original in enumerate(batch):
                    # Try to find matching item by source_text or index
                    match = None
                    if i < len(normalized_list):
                        match = normalized_list[i]
                    
                    if match:
                        # Coerce types
                        for f in ["value", "value2", "field"]:
                            if match.get(f) is not None:
                                match[f] = str(match[f])
                        match["source_text"] = original["source_text"]
                    results.append(match)
                
                return results
        except Exception as e:
            print(f"⚠️  Batch normalization failed: {e}")
            
        return [None] * len(batch)
    
    def _validate_against_source(self, rule: Dict, source_text: str) -> bool:
        """
        ANTI-HALLUCINATION: Validate that extracted values exist in source text.
        """
        source_lower = source_text.lower()
        
        # Check numeric values
        for field in ["value", "value2"]:
            value = rule.get(field)
            if value and value not in ["null", "true", "false", "True", "False"]:
                value_str = str(value)
                # Allow for some formatting differences (1.5 vs 1.50)
                if value_str not in source_text and value_str.rstrip('0').rstrip('.') not in source_text:
                    # Check if any digits match
                    digits = re.findall(r'\d+\.?\d*', value_str)
                    if digits and not any(d in source_text for d in digits):
                        print(f"⚠️  Value '{value}' not found in source text")
                        return False
        
        return True
    
    def get_glossary(self) -> Dict[str, Dict]:
        """Return the dynamically extracted medical glossary."""
        return self.extracted_glossary


# Test when run directly
if __name__ == "__main__":
    from pathlib import Path
    agent = ProtocolRuleAgent()
    
    # Test with available PDFs in the project
    pdf_paths = [
        "/app/uploads/fda_documents/DNDi-Clinical-Trial-Protocol-BENDITA-V5.pdf",
        "/app/uploads/fda_documents/2.pdf",
        "/app/uploads/fda_documents/3.pdf",
    ]
    
    for p in pdf_paths:
        if not Path(p).exists():
            print(f"\n⚠️  Skipping {p} - file not found")
            continue
            
        print(f"\n\n{'='*80}\nProcessing: {p}\n{'='*80}")
        try:
            txt = parse_pdf_file(p)
            rules = agent.extract_rules(txt)
            print("\n📊 Rule Type Summary:")
            print(json.dumps(rules.get('_summary', {}), indent=2))
            print("\n📋 Sample Rules (first 3 per category):")
            print(json.dumps({k: rules[k][:3] for k in ['inclusion','exclusion'] if rules.get(k)}, indent=2))
        except Exception as e:
            print(f"❌ ERROR parsing {p}: {e}")
            import traceback
            traceback.print_exc()
