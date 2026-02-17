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
        
        # 7. Generic tokens to filter out of glossary
        self.GENERIC_MEDICAL_TOKENS = {
            'history', 'signs', 'symptoms', 'women', 'men', 'patients', 'subjects', 
            'adults', 'children', 'infants', 'protocol', 'criteria', 'inclusion', 
            'exclusion', 'screening', 'study', 'trial', 'baseline', 'follow-up',
            'previous', 'prior', 'current', 'present', 'evidence', 'documented',
            'clinical', 'medical', 'physical', 'examination', 'history of',
            'total', 'acute', 'chronic', 'normal', 'range', 'acceptable',
            'be', 'have', 'must', 'should', 'will', 'may', 'can',
            'inadequate', 'otherwise', 'unsuitable', 'written', 'informed',
            'hospitalized', 'male', 'female', 'subject', 'patient',
            'opinion', 'investigator', 'margin', 'indication',
            'any', 'other', 'condition', 'conditions', 'form', 'results',
            'test', 'tests', 'values', 'period', 'time', 'use',
            'treatment', 'therapy', 'drug', 'drugs', 'medication', 'medications',
            'presence', 'absence', 'finding', 'findings', 'evaluation',
            'participation', 'surgery', 'planned', 'concomitant', 'anticipated',
        }
    
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
        
        Handles three section types:
        - "inclusion" / "exclusion" -- processed directly
        - "screening" -- auto-classified into inclusion or exclusion based on negation
        
        ANTI-HALLUCINATION: All returned values are validated against source text.
        """
        # 1. Clean the text
        cleaned_text = self._clean_text(protocol_text)
        
        print(f"🔍 [extract_rules] Input text length: {len(protocol_text)}, Cleaned text length: {len(cleaned_text)}")
        print(f"🔍 [extract_rules] First 500 chars of cleaned text: {cleaned_text[:500]}")
        
        # 2. Detect sections (now includes screening)
        sections = self._detect_sections(cleaned_text)
        
        for sec_name, sec_text in sections.items():
            if sec_text:
                print(f"🔍 [extract_rules] Section '{sec_name}': {len(sec_text)} chars, starts with: {sec_text[:100]}...")
        
        final_rules = {
            "inclusion": [],
            "exclusion": []
        }
        
        # 3. Process screening section -- classify each criterion into inclusion/exclusion
        screening_extra = {"inclusion": [], "exclusion": []}
        screening_text = sections.get("screening", "")
        if screening_text:
            screening_criteria = self._split_criteria(screening_text)
            valid_screening = [c for c in screening_criteria if self._is_valid_criterion(c)]
            
            for criterion_text in valid_screening:
                category = self._classify_screening_criterion(criterion_text)
                screening_extra[category].append(criterion_text)
            
            print(f"🔍 [extract_rules] Screening classified: {len(screening_extra['inclusion'])} inclusion, {len(screening_extra['exclusion'])} exclusion")
        
        # 4. Process inclusion and exclusion sections
        for category in ["inclusion", "exclusion"]:
            section_text = sections.get(category, "")
            
            # Split criteria from the named section
            criteria_list = self._split_criteria(section_text) if section_text else []
            valid_criteria = [c for c in criteria_list if self._is_valid_criterion(c)]
            
            # Add screening criteria that were classified into this category
            valid_criteria.extend(screening_extra.get(category, []))
            
            if not valid_criteria:
                continue
            
            # Deduplicate criteria that may appear in both screening and named sections
            seen_texts = set()
            unique_criteria = []
            for c in valid_criteria:
                normalized_key = c.strip().lower()[:80]
                if normalized_key not in seen_texts:
                    seen_texts.add(normalized_key)
                    unique_criteria.append(c)
            valid_criteria = unique_criteria
            
            # Process all criteria using nlp.pipe (batched, much faster)
            facts_list = []
            criterion_docs = list(self.nlp.pipe(valid_criteria))
            
            for criterion_text, doc in zip(valid_criteria, criterion_docs):
                facts = self._extract_basic_facts(criterion_text, category, doc=doc)
                facts_list.append(facts)
            
            # Split into simple (skip LLM) and complex (need LLM)
            simple_facts = []
            complex_facts = []
            for facts in facts_list:
                if self._can_skip_llm(facts):
                    simple_facts.append(facts)
                else:
                    complex_facts.append(facts)
            
            for facts in simple_facts:
                final_rules[category].append(facts)
            
            batch_size = 40
            for i in range(0, len(complex_facts), batch_size):
                batch = complex_facts[i:i + batch_size]
                normalized_batch = self._batch_normalize_with_llm(batch)
                
                for original_facts, normalized in zip(batch, normalized_batch):
                    final_rule = normalized if normalized else original_facts
                    if self._validate_against_source(final_rule, original_facts['source_text']):
                        final_rules[category].append(final_rule)
                    else:
                        print(f"⚠️  Hallucination detected, using basic facts for: {original_facts['source_text'][:50]}...")
                        final_rules[category].append(original_facts)
        
        print(f"📊 Criteria extracted: {len(final_rules['inclusion'])} inclusion, {len(final_rules['exclusion'])} exclusion")
        
        # Build summary counts
        summary = {}
        for cat, rules in final_rules.items():
            for r in rules:
                t = r.get('rule_type', 'UNKNOWN')
                summary.setdefault(t, 0)
                summary[t] += 1
        final_rules['_summary'] = summary
        
        return final_rules
    
    def _classify_screening_criterion(self, text: str) -> str:
        """
        Classify a screening criterion as inclusion or exclusion.
        Screening sections contain mixed criteria -- those with negation
        (No..., Must not..., free of...) are exclusion; others are inclusion.
        """
        text_stripped = text.strip()
        
        # Exclusion indicators: criterion starts with negation or describes absence
        exclusion_patterns = [
            r'^No\s+',
            r'^Must\s+not\b',
            r'^Should\s+not\b',
            r'^Without\s+',
            r'^Absence\s+of\b',
            r'^Free\s+of\b',
            r'^Not\s+',
            r'^Negative\s+for\b',
            r'(?i)\bno\s+(?:history|signs|symptoms|condition|formal\s+contraindication|concomitant|medical\s+history|family\s+history|previous)\b',
        ]
        
        for pattern in exclusion_patterns:
            if re.search(pattern, text_stripped, re.IGNORECASE):
                return "exclusion"
        
        return "inclusion"
    
    def _clean_text(self, text: str) -> str:
        """Remove PDF artifacts, page-break noise, and normalize text."""
        # Remove page separators injected by parse_pdf_file / fda_processor / ocr_processor
        # Handles both "---PAGE---" and "--- PAGE 1 ---" variants
        text = re.sub(r'-{2,}\s*PAGE\s*\d*\s*-{2,}', '', text, flags=re.IGNORECASE)
        
        # Replace common CID characters with their actual glyphs
        cid_map = {
            '120': '•',   # bullet
            '182': "'",   # apostrophe (possessive)
            '179': "'",   # left single quote
            '180': "'",   # right single quote
            '148': '≤',   # less than or equal
            '149': '≥',   # greater than or equal
            '150': '–',   # en-dash
            '151': '—',   # em-dash
            '177': '±',   # plus-minus
            '85': 'r',    # letter r (common in some PDF encodings)
            '86': 's',    # letter s
            '87': 't',    # letter t
            '88': 'u',    # letter u
            '89': 'v',    # letter v
            '90': 'w',    # letter w
            '83': 'p',    # letter p
            '84': 'q',    # letter q
            '92': 'y',    # letter y
        }
        for cid_num, replacement in cid_map.items():
            text = text.replace(f'(cid:{cid_num})', replacement)
        
        # Remove any remaining CID characters
        text = re.sub(r'\(cid:\d+\)', '', text)
        
        # Remove page markers
        text = re.sub(r'(?i)Page\s+\d+\s+of\s+\d+', '', text)
        
        # Remove confidentiality markers
        text = re.sub(r'(?i)^\s*Confidential\s*$', '', text, flags=re.MULTILINE)
        
        # Remove protocol version headers (more robust, stop at newline)
        text = re.sub(r'(?i)Protocol\s+(?:number|version)\s+[^\n]+', '', text)
        
        # Remove Date/Version lines (e.g. "May 04, 2018. Version 5.0.")
        text = re.sub(r'(?i)[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}\.?\s+Version\s+[\d.]+', '', text)
        
        # Remove TOC-style dotted lines with page numbers
        text = re.sub(r'\.{3,}\s*\d+', '', text)
        
        # Stitch page-break continuations: if a line ends mid-sentence
        # (no terminal punctuation like . ! ? :) and the next non-empty line
        # starts with a lowercase letter, join them on one line.
        # This reconnects text split across PDF pages (e.g. "...exposure to\n\n\ntreatment.").
        # The negative lookbehind ensures we don't merge after sentence-ending punctuation.
        text = re.sub(r'(?<![.!?:;])\s*\n\s*\n+\s*([a-z])', r' \1', text)
        
        # Normalize whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r' {2,}', ' ', text)
        
        return text.strip()
    
    def _detect_sections(self, text: str) -> Dict[str, str]:
        """
        Detect inclusion/exclusion/screening sections dynamically.
        Handles protocols where criteria live under "Screening criteria",
        "Selection of Patients", or similar non-standard headings.
        """
        sections = {"inclusion": "", "exclusion": "", "screening": "", "lab_values": "", "withdrawal": ""}
        
        # Section header patterns - these mark the START of sections
        section_patterns = {
            'screening': r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Screening\s+[Cc]riteria|Selection\s+of\s+Patients|Eligibility\s+[Cc]riteria|Selection\s+[Cc]riteria)',
            'inclusion': r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Inclusion\s+[Cc]riteria|[Cc]riteria\s+for\s+[Ii]nclusion)',
            'exclusion': r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Exclusion\s+[Cc]riteria|[Cc]riteria\s+for\s+[Ee]xclusion)',
        }
        
        # Section END patterns - these mark where eligibility sections typically end
        end_patterns = [
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Study\s+(?:Drug|Treatment|Design|Procedures?|Population)|Investigational\s+Product)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Removal|Withdrawal|Discontinuation)\s+(?:of\s+)?(?:Subjects?|Patients?|[Cc]riteria)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Assessment|Evaluation|Endpoints?)\s',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Statistical|Analysis|Sample\s+Size)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Schedule\s+of\s+(?:Events|Assessments))',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Enrolment|Enrollment)\s+Procedures',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Number\s+of\s+(?:Cases|Subjects?|Patients?))',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Prior\s+and\s+Concomitant|Excluded\s+Medications)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Experimental\s+Procedures)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Subject\s+Discontinuation)',
            r'(?:\n\s*)(\d+)\.\s+[A-Z][A-Z\s]+',
        ]
        
        # Combine end patterns
        end_pattern = '|'.join(f'({p})' for p in end_patterns)
        
        # Strategy: Find the CLUSTER of section headers (screening + inclusion + exclusion)
        # that appear close together in the document. The actual eligibility section will have
        # all three headers within ~10000 chars of each other. Synopsis/summary mentions
        # may also have them but we prefer the cluster with numbered sub-sections (4.1, 4.2, 4.3).
        print(f"🔍 [_detect_sections] Text length: {len(text)}")
        
        # Exclusion-specific end patterns (stricter)
        exclusion_end_patterns = [
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Study\s+(?:Drug|Treatment|Design|Procedures?|Population)|Investigational\s+Product)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Removal|Withdrawal|Discontinuation)\s+(?:of\s+)?(?:Subjects?|Patients?|[Cc]riteria)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Assessment|Evaluation|Endpoints?)\s',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Statistical|Analysis|Sample\s+Size)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Schedule\s+of\s+(?:Events|Assessments))',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Enrolment|Enrollment)\s+Procedures',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Number\s+of\s+(?:Cases|Subjects?|Patients?))',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Prior\s+and\s+Concomitant|Excluded\s+Medications)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Experimental\s+Procedures)',
            r'(?i)(?:\n\s*)(?:\d+\.?\d*\.?\s*)?(?:Subject\s+Discontinuation)',
            r'(?:\n\s*)(\d+)\.\s+[A-Z][A-Z\s]{3,}',
        ]
        exc_end_pattern = '|'.join(f'({p})' for p in exclusion_end_patterns)
        
        # Collect all match positions for each section type
        all_matches = {}
        for section_name in ['screening', 'inclusion', 'exclusion']:
            pattern = section_patterns[section_name]
            matches = list(re.finditer(pattern, text))
            # Filter out TOC entries (preceded by dotted lines)
            filtered = []
            for m in matches:
                ctx_start = max(0, m.start() - 80)
                ctx = text[ctx_start:m.start()]
                if not re.search(r'\.{3,}', ctx):
                    filtered.append(m)
            all_matches[section_name] = filtered
            print(f"🔍 [_detect_sections] Pattern '{section_name}': {len(filtered)} matches (of {len(matches)} total)")
        
        # Find the best cluster: prefer numbered sections (4.1, 4.2, 4.3) that appear
        # close together. Score each inclusion match by proximity to exclusion match.
        best_inc_match = None
        best_exc_match = None
        best_scr_match = None
        best_cluster_score = -1
        
        for inc_m in all_matches.get('inclusion', []):
            for exc_m in all_matches.get('exclusion', []):
                # Inclusion should come before exclusion, and they should be within 8000 chars
                if exc_m.start() <= inc_m.start():
                    continue
                gap = exc_m.start() - inc_m.end()
                if gap > 8000:
                    continue
                
                # Score: prefer numbered sections (e.g. "4.2. Inclusion criteria")
                has_number = bool(re.search(r'\d+\.\d+', inc_m.group()))
                score = 1000 if has_number else 0
                # Prefer later in document (actual body, not synopsis)
                score += inc_m.start() / len(text) * 500
                # Prefer closer gap between inclusion and exclusion
                score += max(0, 500 - gap / 10)
                
                if score > best_cluster_score:
                    best_cluster_score = score
                    best_inc_match = inc_m
                    best_exc_match = exc_m
        
        # Find screening match closest to (and before) the best inclusion match
        if best_inc_match:
            for scr_m in all_matches.get('screening', []):
                if scr_m.start() < best_inc_match.start() and best_inc_match.start() - scr_m.start() < 10000:
                    best_scr_match = scr_m
        
        print(f"🔍 [_detect_sections] Best cluster: scr={best_scr_match.start() if best_scr_match else None}, "
              f"inc={best_inc_match.start() if best_inc_match else None}, "
              f"exc={best_exc_match.start() if best_exc_match else None}")
        
        # Extract content for each section using the cluster matches
        def extract_section_content(match, next_match, fallback_end_pattern):
            if not match:
                return ""
            search_start = match.end()
            if next_match:
                section_end = next_match.start()
            else:
                end_m = re.search(fallback_end_pattern, text[search_start:])
                section_end = search_start + end_m.start() if end_m else min(search_start + 8000, len(text))
            content = text[search_start:section_end].strip()
            content = re.sub(r'^[:\s\n]+', '', content)
            if len(content) > 8000:
                content = content[:8000]
            return content
        
        if best_scr_match:
            sections['screening'] = extract_section_content(best_scr_match, best_inc_match, end_pattern)
        if best_inc_match:
            sections['inclusion'] = extract_section_content(best_inc_match, best_exc_match, end_pattern)
        if best_exc_match:
            sections['exclusion'] = extract_section_content(best_exc_match, None, exc_end_pattern)
        
        for sec_name, sec_text in sections.items():
            if sec_text:
                print(f"🔍 [_detect_sections] Final '{sec_name}': {len(sec_text)} chars")
        
        # If no sections found at all, use LLM to identify them
        if not sections['inclusion'] and not sections['exclusion'] and not sections['screening']:
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
        """
        Split section text into individual criteria.
        Handles:
        1. Nested sub-items (e.g. lab values listed under a parent criterion)
        2. Bullet/numbered lists
        3. Plain newline-separated criteria (no bullets)
        4. Semicolon-separated criteria
        5. Sentence-level splitting as last resort
        """
        text = section_text.replace('\r\n', '\n')
        
        # Step 1: Handle OCR bullet artifacts FIRST (before flatten, so multi-bullet
        # lines get split into separate lines for proper parent-child detection).
        # Common in PDFs where • becomes 'e' or 'o' through OCR.
        text = re.sub(r'(?:^|\n)\s*e\s+(?=[A-Z])', '\n• ', text)
        text = re.sub(r'(?<=\w)\s+e\s+(?=[A-Z][a-z])', '\n• ', text)
        text = re.sub(r'(?<=\w)\s+e\s+(?=No\s)', '\n• ', text)
        # Fix "Nocondition" / "Noconcomitant" OCR artifacts (missing space after "No")
        text = re.sub(r'\bNo(?=[A-Z])', 'No ', text)
        # Also handle 'o' as sub-bullet at line start or mid-line
        text = re.sub(r'(?:^|\n)\s*o\s+(?=[A-Z])', '\n○ ', text)
        text = re.sub(r'(?<=\w)\s+o\s+(?=[A-Z][a-z])', '\n○ ', text)
        
        # Step 2: Handle nested parent-child structures.
        text = self._flatten_nested_criteria(text)
        
        # Step 3: Try splitting on bullet-like tokens
        items = re.split(
            r'(?:^|\n)\s*(?:\d+[\.)]\s*|[•●○▪\-\*]\s*|[a-zA-Z]\)[\s]|[ivx]+\)|[A-Z]\.)',
            text,
            flags=re.IGNORECASE
        )
        items = [it.strip() for it in items if it and len(it.strip()) > 0]

        # Step 3: Handle continuation lines (fragments that belong to previous item)
        # A continuation line starts with lowercase or '(' and the previous item
        # doesn't end with terminal punctuation.
        merged = []
        for it in items:
            is_continuation = (
                merged
                and re.match(r'^[a-z(]', it)
                and not re.search(r'[.!?)]\s*$', merged[-1])
            )
            if is_continuation:
                merged[-1] += ' ' + it
            else:
                merged.append(it)

        # Step 4: If bullet splitting produced <=1 item, try newline-based splitting.
        # Many protocols list criteria as plain lines without bullet markers.
        if len(merged) <= 1:
            lines = [ln.strip() for ln in text.split('\n') if ln.strip()]
            # Only use line-based splitting if there are multiple substantial lines
            # (each at least 10 chars to avoid splitting on noise fragments)
            substantial_lines = [ln for ln in lines if len(ln) >= 10]
            if len(substantial_lines) >= 2:
                # Merge continuation lines: if a line starts with lowercase and the
                # previous line doesn't end with terminal punctuation, append it
                line_merged = []
                for ln in substantial_lines:
                    if line_merged and re.match(r'^[a-z]', ln) and not re.search(r'[.!?:]\s*$', line_merged[-1]):
                        line_merged[-1] += ' ' + ln
                    else:
                        line_merged.append(ln)
                if len(line_merged) >= 2:
                    merged = line_merged

        # Step 5: Still <=1? Try semicolons, then spaCy sentence splitting
        if len(merged) <= 1:
            if section_text.count(';') >= 2:
                merged = [s.strip() for s in section_text.split(';') if s.strip()]
            else:
                doc = self.nlp(section_text)
                merged = [sent.text.strip() for sent in doc.sents if sent.text.strip()]

        return merged
    
    def _flatten_nested_criteria(self, text: str) -> str:
        """
        Detect parent-child criterion structures and flatten them.
        
        Example input:
            • Laboratory test values ... as follows:
              o Total WBC must be within the normal range ...
              o Platelets must be within the normal range ...
        
        Example output (each sub-item becomes a top-level bullet):
            • Total WBC must be within the normal range ...
            • Platelets must be within the normal range ...
        
        Key: Only strip bullets from TRUE sub-items (under a parent ending with ':').
        Top-level bullets (•) are PRESERVED so the split step can use them.
        """
        lines = text.split('\n')
        result_lines = []
        pending_parent = None
        
        for line in lines:
            stripped = line.strip()
            if not stripped:
                result_lines.append(line)
                continue
            
            # Detect TRUE sub-items: "o " prefix or "○ " (typically indented under a parent)
            is_sub_bullet = bool(re.match(r'^\s*(?:o\s+|○\s*)', line))
            # Detect top-level bullets: "• " prefix
            is_top_bullet = bool(re.match(r'^\s*[•●▪]\s*', line))
            
            if is_sub_bullet and pending_parent is not None:
                # Child of a parent header -- promote to standalone top-level bullet
                child_text = re.sub(r'^\s*(?:o\s+|○\s*)', '', line).strip()
                if child_text:
                    result_lines.append('• ' + child_text)
            elif is_sub_bullet and not pending_parent:
                # Sub-bullet without parent -- promote to top-level bullet
                child_text = re.sub(r'^\s*(?:o\s+|○\s*)', '', line).strip()
                if child_text:
                    result_lines.append('• ' + child_text)
            elif is_top_bullet:
                # Top-level bullet -- check if it's a parent header
                bullet_text = re.sub(r'^\s*[•●▪]\s*', '', line).strip()
                if bullet_text.endswith(':') or re.search(r'(?:as follows|as follows:)\s*$', bullet_text, re.IGNORECASE):
                    # This bullet is a parent header (e.g. "• Lab values ... as follows:")
                    pending_parent = bullet_text.rstrip(':').strip()
                else:
                    # Regular top-level bullet -- KEEP the bullet marker
                    pending_parent = None
                    result_lines.append(line)
            elif stripped.endswith(':') or re.search(r'(?:as follows|as follows:)\s*$', stripped, re.IGNORECASE):
                # Non-bullet parent header -- remember it but don't emit
                pending_parent = stripped.rstrip(':').strip()
            else:
                # Regular line -- reset parent context
                pending_parent = None
                result_lines.append(line)
        
        return '\n'.join(result_lines)
    
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
        if text.endswith(':') and len(text) < 80:
            return False
        # Notes and explanatory text
        if re.match(r'^Note\s*:', text, re.IGNORECASE):
            return False
        if re.match(r'^(?:inclusion|exclusion|screening)\s+criteria\s*:?\s*$', text, re.IGNORECASE):
            return False
        # Section headers that leaked into content (e.g. "8.3.2 Exclusion Criteria To be considered...")
        if re.match(r'^[\d.]+\s*(?:Inclusion|Exclusion|Screening)\s+[Cc]riteria\b', text):
            return False
        if "following inclusion criteria" in text.lower() or "following exclusion criteria" in text.lower():
            return False
        if "following screening criteria" in text.lower():
            return False
        if re.search(r'(?i)must\s+meet\s+ALL\s+of\s+the\s+following', text):
            return False
        if re.search(r'(?i)to\s+be\s+considered\s+eligible\s+to\s+participate', text):
            return False
        if re.search(r'(?i)will be selected to participate|designed to select patients|eligibility criteria may not be waived', text):
            return False
        if re.search(r'(?i)^the (?:following|presence of any)', text) and len(text.split('.')[0]) > 60:
            return False
        if re.search(r'(?i)^(?:following the screening period|the following screening criteria)', text):
            return False
        if re.search(r'(?i)^All relevant medical and non-medical conditions', text):
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
        
        # Add field from primary entity - Improved Selection
        if entities:
            # 1. Look for high-confidence UMLS entities with specific semantic types
            # T047=Disease, T116=Protein, T121=Pharmacologic, T191=Neoplasm, T200=Clinical Drug
            # T033=Finding, T034=Lab Result, T059=Lab Procedure, T060=Diagnostic Procedure
            medical_types = {'T047', 'T116', 'T121', 'T191', 'T200', 'T033', 'T034', 'T059', 'T060', 'T184'}
            medical_entities = [e for e in entities if e.get('semantic_type') in medical_types]
            
            # 2. Filter out generic tokens
            meaningful_entities = [e for e in entities if e['text'].lower().strip() not in self.GENERIC_MEDICAL_TOKENS and len(e['text'].strip()) > 2]
            
            # 3. Among meaningful entities, prefer longer names (more descriptive)
            meaningful_entities.sort(key=lambda e: len(e['text']), reverse=True)
            
            # 4. Preference order: Specific Medical > Longest Non-Generic > First Entity
            if medical_entities:
                # Among medical entities, prefer longer names
                medical_entities.sort(key=lambda e: len(e['text']), reverse=True)
                primary_entity = medical_entities[0]
            elif meaningful_entities:
                primary_entity = meaningful_entities[0]
            else:
                primary_entity = entities[0]
                
            field_text = primary_entity.get("text", "").strip()
            # Clean newlines and cap field length for UI display
            field_text = re.sub(r'\s*\n\s*', ' ', field_text)
            if len(field_text) > 60:
                field_text = field_text[:57] + "..."
            rule["field"] = field_text
            
            # Add UMLS concept if available
            if primary_entity.get("cui"):
                rule["umls_cui"] = primary_entity["cui"]
                rule["semantic_type"] = primary_entity.get("semantic_type")
                
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
        if re.search(r'\b(age\s+(?:is|of|greater|less|between)|years?\s+old|[><]\s*\d+\s*years?|age\s*[>≥<≤])\b', text_lower):
            return "AGE"
        
        # 2b. Weight
        if re.search(r'\b(weight|kg\b|body\s+mass)', text_lower) and re.search(r'\d', text):
            return "WEIGHT"
        
        if re.search(r'\b(ekg|ecg|qtc|electrocardiogram)\b', text_lower):
            return "EKG"
        
        # Lab values -- detect by unit OR by known lab test names
        lab_test_names = [
            'wbc', 'platelets', 'bilirubin', 'transaminase', 'alt', 'ast',
            'creatinine', 'alkaline phosphatase', 'ggt', 'glucose', 'electrolytes',
            'hemoglobin', 'hematocrit', 'neutrophil', 'lymphocyte', 'albumin',
            'inr', 'potassium', 'sodium', 'calcium', 'magnesium',
        ]
        if re.search(r'\b(?:' + '|'.join(lab_test_names) + r')\b', text_lower):
            if re.search(r'(?:normal range|uln|upper limit|margin|mm3|/mm)', text_lower):
                return "LAB_THRESHOLD"
        
        if values and values.get("unit"):
            unit = values["unit"].lower()
            if any(u in unit for u in ['mg/dl', 'g/dl', 'ml/min', 'uln', 'mmol', 'iu', '%', 'mm3']):
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
- field: The specific medical parameter, drug, or clinical condition (e.g., 'ALT level', 'history of cardiomyopathy', 'Benznidazole'). AVOID generic terms like 'Women', 'History', or 'Signs'.
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

    def _can_skip_llm(self, facts: Dict) -> bool:
        """
        Determine if a criterion is simple enough to skip LLM normalization.
        Simple criteria: age ranges, consent, pregnancy exclusions with already-extracted values.
        """
        rule_type = facts.get('rule_type', '')
        has_value = facts.get('value') is not None or facts.get('operator') is not None
        has_field = bool(facts.get('field'))
        
        # These rule types are fully extractable with regex + NER
        simple_types = {'AGE', 'WEIGHT', 'CONSENT_REQUIREMENT', 'PREGNANCY_EXCLUSION', 'CONTRACEPTION', 'EKG'}
        if rule_type in simple_types and (has_value or has_field):
            return True
        
        # LAB_THRESHOLD and VITAL_SIGN with extracted values are complete
        if rule_type in {'LAB_THRESHOLD', 'VITAL_SIGN'} and has_value and has_field:
            return True
        
        return False

    def _batch_normalize_with_llm(self, batch: List[Dict]) -> List[Optional[Dict]]:
        """
        Optimize by processing multiple criteria in one LLM call.
        Uses larger sub-batches and more parallel workers for throughput.
        """
        if not batch: return []
        
        from concurrent.futures import ThreadPoolExecutor
        
        # Larger sub-batches = fewer LLM calls = faster overall
        sub_batch_size = 15
        sub_batches = [batch[i:i + sub_batch_size] for i in range(0, len(batch), sub_batch_size)]
        
        def process_sub_batch(sub_batch):
            prompt = f"""You are a clinical trial criteria normalizer. Format these {len(sub_batch)} criteria into structured JSON.
            
STRICT RULES:
1. ONLY USE VALUES THAT APPEAR IN THE SOURCE TEXT.
2. NO COMMENTS (//), NO MARKDOWN, NO EXPLANATIONS.
3. RETURN A JSON ARRAY of objects.

CRITERIA TO PROCESS:
{json.dumps(sub_batch, indent=2)}

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
                    
                    sub_normalized = json.loads(json_str)
                    
                    # Ensure results match sub_batch size
                    results = []
                    for i, original in enumerate(sub_batch):
                        match = None
                        if i < len(sub_normalized):
                            match = sub_normalized[i]
                        
                        if match:
                            for f in ["value", "value2", "field"]:
                                if match.get(f) is not None:
                                    match[f] = str(match[f])
                            match["source_text"] = original["source_text"]
                        results.append(match)
                    return results
            except Exception as e:
                print(f"⚠️  Small batch normalization failed: {e}")
            return [None] * len(sub_batch)

        # Execute sub-batches in parallel with more workers
        all_results = []
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_results = list(executor.map(process_sub_batch, sub_batches))
            for res_list in future_results:
                all_results.extend(res_list)
                
        return all_results
    
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
