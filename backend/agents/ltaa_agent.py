import logging
import os
import json
import re
import hashlib
import pickle
import math
from typing import List, Dict, Any
from collections import Counter
from json import JSONDecoder, JSONDecodeError
from backend.utils.pubmed_connector import fetch_pubmed_abstracts
from backend.utils.pdf_ingest import process_pdf_document
from backend.utils.bio_nlp import extract_bio_entities
from backend.utils.graph_builder import GraphBuilder
from backend.utils.bio_filters import is_generic_term, GENERIC_TERMS
from backend.utils.bio_validator import get_validator
from backend.utils.domain_config import Domain, DocumentType, infer_domain_from_disease, get_domain_generic_terms
from backend.utils.document_classifier import classify_document_type
from backend.nlp_utils import get_llm
from pathlib import Path

logger = logging.getLogger(__name__)

def _normalize_entity(ent_text: str) -> str:
    """Normalize entity text for deduplication and comparison."""
    text = ent_text.lower().strip()
    text = re.sub(r'[^a-z0-9\-\s]', '', text)  # Remove punctuation
    text = re.sub(r'\s+', ' ', text)  # Collapse whitespace
    return text

class LTAAAgent:
    """
    Literature & Target Analysis Agent (LTAA) v3
    Pharma-Grade Biomedical Target Discovery System
    """
    def __init__(self, domain: Domain = None):
        self.graph = GraphBuilder()
        self.llm = get_llm()
        self.pdf_folder = os.getenv("LTAA_PDF_FOLDER", "/app/uploads")
        self.domain = domain  # Can be set explicitly
        self.bio_validator = None # Initialized per analysis
        self.excluded_entities = []  # Track rejected entities

        # Pharma-Grade TUI Filtering (UMLS Semantic Types)
        self.ALLOWED_TUIS = {
            "T116": "PROTEIN", # Amino Acid, Peptide, or Protein
            "T123": "PROTEIN", # Biologically Active Substance
            "T121": "CHEMICAL", # Pharmacologic Substance
            "T109": "CHEMICAL", # Organic Chemical
            "T195": "CHEMICAL", # Antibiotic
            "T126": "GENE_OR_GENE_PRODUCT", # Enzyme
            "T028": "GENE_OR_GENE_PRODUCT", # Gene or Genome
            "T047": "DISEASE", # Disease or Syndrome
            "T191": "DISEASE", # Neoplastic Process (Cancer)
            "T046": "DISEASE", # Pathologic Function
            "T048": "DISEASE", # Mental or Behavioral Dysfunction
            "T184": "DISEASE", # Sign or Symptom
            "T049": "PATHWAY", # Molecular Function (often pathways)
        }

        # Weight scoring for ranking
        self.BIO_WEIGHT = {
            "GENE_OR_GENE_PRODUCT": 5,
            "PROTEIN": 4,
            "PATHWAY": 4,
            "CHEMICAL": 3,
            "DISEASE": 2,
        }

        # Hardcore regulatory noise blacklist (still useful for text that slips through)
        self.BLACKLIST = {
            "study","studies","subject","subjects","trial","trials","clinical",
            "investigator","investigators","patient","patients","participant",
            "participants","protocol","treatment","efficacy","safety","dose",
            "dosing","administration","results","analysis","data","group","arm",
            "phase","procedure","assessment","event","table","figure","page",
            "section","appendix","amendment","informed consent","ethics committee",
            "sponsor","cro","imp","ind","irb","ec","regulatory","submission",
            "case report form","crf","randomization","blinded","cohort",
            "pharmaceuticals","inc","ltd","company","site","hospital",
            "research", "method", "methods", "conclusion", "background",
            "introduction", "purpose", "objective", "objectives",
            "prevent", "prevention", "resolved", "progression", "complications",
            "infectious disease studies"
        }
        
        # Label mapping for user-friendly UI
        self.LABEL_MAP = {
            "CHEMICAL": "Drug/Chemical",
            "GENE_OR_GENE_PRODUCT": "Protein/Gene",
            "PROTEIN": "Protein",
            "DISEASE": "Condition",
            "PATHWAY": "Pathway"
        }

    def _cache_key(self, disease: str, trial_id: str, max_papers: int) -> str:
        """
        Generate cache key from disease query only.
        Salted with v4 to force invalidation.
        """
        h = hashlib.sha256()
        h.update(f"v4-{disease.lower().strip()}".encode('utf-8'))
        return h.hexdigest()

    def _load_cache(self, key: str) -> Dict[str, Any]:
        """Load cached result if exists and valid."""
        cache_dir = Path("/tmp/ltaa_cache")
        cache_path = cache_dir / f"{key}.pkl"
        if cache_path.exists():
            try:
                return pickle.loads(cache_path.read_bytes())
            except Exception as e:
                logger.warning(f"Cache load failed: {e}")
        return None

    def _save_cache(self, key: str, result: Dict[str, Any]):
        """Save result to cache."""
        cache_dir = Path("/tmp/ltaa_cache")
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / f"{key}.pkl"
        try:
            cache_path.write_bytes(pickle.dumps(result))
        except Exception as e:
            logger.warning(f"Cache save failed: {e}")

    def analyze_disease(self, disease_query: str, max_papers: int = 3, target_trial_id: str = None) -> Dict[str, Any]:
        """
        Analyze a disease across PubMed and specific trial documents.
        """
        # Infer domain from disease if not set
        current_domain = self.domain or infer_domain_from_disease(disease_query)
        self.bio_validator = get_validator(current_domain)
        
        print(f"🧬 [LTAA v3] Starting Analysis for: {disease_query} | Domain: {current_domain.value}")
        
        # Reset excluded entities for this analysis
        self.excluded_entities = []
        
        # Check cache first
        cache_key = self._cache_key(disease_query, target_trial_id, max_papers)
        cached_result = self._load_cache(cache_key)
        if cached_result:
            print("✅ Returning cached analysis result")
            return cached_result
        
        # 1. Fetch relevant PubMed abstracts with fallback strategy
        queries_to_try = [disease_query]
        
        # Generate relaxed query if original is complex
        qualifiers = ['chronic', 'acute', 'indeterminate', 'severe', 'mild', 'stage', 'grade', 
                     'type', 'relapsed', 'refractory', 'recurrent', 'metastatic', 'advanced', 'early']
        
        simplified_query = ' '.join([w for w in disease_query.split() if w.lower() not in qualifiers])
        if simplified_query.lower() != disease_query.lower() and len(simplified_query) > 3:
            queries_to_try.append(simplified_query)
        
        print(f"DEBUG: Queries to try: {queries_to_try}")
        
        # CLEAR previous graph data for this disease to prevent duplicates
        try:
            self.graph.clear_disease(disease_query)
        except Exception as e:
            logger.error(f"Failed to clear graph for {disease_query}: {e}")
        
        pubmed_records = []
        for q in queries_to_try:
            print(f"📚 Searching PubMed for: '{q}'")
            records = fetch_pubmed_abstracts([q], max_results=max_papers)
            if records:
                pubmed_records = records
                print(f"✅ Found {len(records)} abstracts for '{q}'")
                break
            print(f"⚠️ No results for '{q}', trying fallback...")
            
        if not pubmed_records:
            print(f"❌ PubMed search failed for all queries: {queries_to_try}")
        
        # 2. Process ONLY the target trial PDF - SORTED for determinism
        pdf_records = []
        pdf_path = Path(self.pdf_folder)
        if pdf_path.exists() and target_trial_id:
            search_pattern = f"*{target_trial_id}*.pdf"
            matching_files = sorted(pdf_path.glob(search_pattern))  # SORTED!
            logger.info(f"🔍 Found {len(matching_files)} matching PDFs for {target_trial_id}")
            
            for pdf_file in matching_files[:1]:
                try:
                    pdf_data = process_pdf_document(str(pdf_file))
                    
                    # Classify document type
                    sample_text = pdf_data['chunks'][0]['text'] if pdf_data.get('chunks') else ""
                    doc_type = classify_document_type(sample_text, pdf_file.name)
                    pdf_data['document_type'] = doc_type
                    
                    pdf_records.append(pdf_data)
                    logger.info(f"📄 Processed PDF: {pdf_file.name} classified as {doc_type.value}")
                except Exception as e:
                    logger.error(f"Failed to process PDF {pdf_file.name}: {e}")

        # 3. Process Content & Build Graph with Citations (Weighted)
        
        # PubMed - sorted by URL for determinism
        for pub in sorted(pubmed_records, key=lambda x: x.get('url', '')):
            self._process_text(disease_query, pub['text'], pub['url'], 0, current_domain, DocumentType.RESEARCH_PAPER)
            
        # Local PDFs
        for pdf in pdf_records:
            source_label = pdf.get('filename') or pdf.get('source', 'Protocol')
            doc_type = pdf.get('document_type', DocumentType.UNKNOWN)
            # Ensure chunks are in page order
            for chunk in sorted(pdf['chunks'], key=lambda x: x.get('page', 0)):
                self._process_text(disease_query, chunk['text'], source_label, chunk['page'], current_domain, doc_type)

        # 4. Get Ranked Targets with improved scoring
        ranked_results = self._get_ranked_targets_with_threshold(disease_query)
        
        logger.info(f"📊 Ranked {len(ranked_results)} high-quality targets")
        logger.info(f"🚫 Excluded {len(self.excluded_entities)} entities")
        
        # 5. LLM-Based Scientific Justification (Top 3 Targets)
        top_targets = ranked_results[:3]
        justification = self._generate_scientific_report(disease_query, top_targets)
        
        # 6. Summarize excluded entities
        excluded_summary = self._summarize_excluded_entities()
        
        result = {
            "disease": disease_query,
            "domain": current_domain.value,
            "summary": justification.get("summary", "Analysis complete."),
            "ranked_targets": ranked_results,
            "report": justification,
            "excluded_entities": excluded_summary,
            "stats": {
                "domain": current_domain.value,
                "document_types": [pdf.get('document_type', DocumentType.UNKNOWN).value for pdf in pdf_records],
                "pubmed_count": len(pubmed_records),
                "pdf_count": len(pdf_records),
                "targets_found": len(ranked_results),
                "entities_rejected": len(self.excluded_entities),
                "total_score": sum(t['score'] for t in ranked_results)
            }
        }
        
        # Cache the result
        self._save_cache(cache_key, result)
        
        return result

    def _process_text(self, disease_query: str, text: str, source: str, page: int, 
                     domain: Domain = Domain.GENERAL, doc_type: DocumentType = DocumentType.UNKNOWN):
        """
        Process text chunk with domain-aware validation and comprehensive filtering.
        """
        entities = extract_bio_entities(text)
        seen_entities = set()  # Per-chunk deduplication
        
        # Get domain-specific generic terms
        domain_generics = get_domain_generic_terms(domain)

        for ent in entities:
            raw = ent.get("text", "")
            if not raw:
                continue
                
            ent_norm = _normalize_entity(raw)

            # 1. Comprehensive generic check (base + domain specific)
            is_generic, reason = is_generic_term(raw)
            if is_generic:
                self.excluded_entities.append({
                    "entity": raw,
                    "reason": reason,
                    "source": source,
                    "page": page
                })
                continue
                
            if ent_norm in domain_generics:
                self.excluded_entities.append({
                    "entity": raw,
                    "reason": f"domain_generic_{domain.value}",
                    "source": source,
                    "page": page
                })
                continue

            # 2. Skip very short or numeric tokens
            if len(ent_norm) < 3:
                self.excluded_entities.append({
                    "entity": raw,
                    "reason": "too_short",
                    "source": source,
                    "page": page
                })
                continue

            if ent_norm.isdigit():
                self.excluded_entities.append({
                    "entity": raw,
                    "reason": "numeric_only",
                    "source": source,
                    "page": page
                })
                continue

            # 3. Find matching TUI category
            tuis = ent.get("types", [])
            matched_category = None
            for tui in tuis:
                if tui in self.ALLOWED_TUIS:
                    matched_category = self.ALLOWED_TUIS[tui]
                    break
            
            if not matched_category:
                self.excluded_entities.append({
                    "entity": raw,
                    "reason": "no_tui_match",
                    "source": source,
                    "page": page
                })
                continue

            # 4. Blacklist check (safety net for old blacklist)
            if ent_norm in self.BLACKLIST:
                self.excluded_entities.append({
                    "entity": raw,
                    "reason": "in_blacklist",
                    "source": source,
                    "page": page
                })
                continue

            # 5. Deduplicate within chunk
            if ent_norm in seen_entities:
                continue
            seen_entities.add(ent_norm)

            # 6. BIOLOGICAL VALIDATION (DOMAIN-AWARE)
            friendly_label = self.LABEL_MAP.get(matched_category, "Entity")
            is_valid, validation_info = self.bio_validator.validate_entity(raw, friendly_label)
            
            if not is_valid:
                self.excluded_entities.append({
                    "entity": raw,
                    "reason": f"not_in_{domain.value}_db",
                    "type": friendly_label,
                    "source": source,
                    "page": page
                })
                logger.debug(f"❌ Rejected {raw} - not found in {domain.value} databases")
                continue

            # 7. Valid entity - Calculate Weight with Document Type Boost
            weight = self.BIO_WEIGHT.get(matched_category, 1)
            
            # Boost weight for protocol eligibility criteria
            if doc_type == DocumentType.CLINICAL_PROTOCOL:
                if "inclusion" in text.lower() or "exclusion" in text.lower():
                    weight *= 1.5  # Boost eligibility-related entities
            
            # Use canonical name from validation if available
            canonical_name = raw
            if validation_info:
                canonical_name = (
                    validation_info.get("approved_symbol") or 
                    validation_info.get("protein_name") or 
                    raw
                )
            
            self.graph.add_evidence(
                disease=disease_query,
                entity_name=canonical_name,
                entity_type=friendly_label,
                source=source,
                page=page,
                context=text[:300] + "...",
                weight=weight,
                validation_info=validation_info  # Pass metadata to graph
            )
            
            logger.info(f"✅ Added validated entity: {canonical_name} ({friendly_label}) from {validation_info.get('source') if validation_info else 'unknown'}")

    def _summarize_excluded_entities(self) -> Dict[str, Any]:
        """Summarize excluded entities with counts and reasons"""
        if not self.excluded_entities:
            return {
                "total_excluded": 0,
                "by_reason": {},
                "top_excluded": []
            }
        
        reason_counts = Counter(e["reason"] for e in self.excluded_entities)
        entity_counts = Counter(e["entity"] for e in self.excluded_entities)
        
        return {
            "total_excluded": len(self.excluded_entities),
            "by_reason": dict(reason_counts),
            "top_excluded": [
                {"entity": ent, "count": count, "reason": next((e["reason"] for e in self.excluded_entities if e["entity"] == ent), "")}
                for ent, count in entity_counts.most_common(15)
            ]
        }


    def _get_ranked_targets_with_threshold(self, disease_query: str, min_score: float = 1.0) -> List[Dict[str, Any]]:
        """
        Get ranked targets with improved scoring formula and threshold.
        Score = weight * log(1 + mentions) + citation_bonus
        """
        raw_targets = self.graph.get_ranked_targets(disease_query)
        
        ranked = []
        for target in raw_targets:
            # Extract mentions count from citations
            citations = target.get('citations', [])
            mentions = len(citations)
            weight = target.get('score', 1)  # This is sum of weights from graph
            
            # Improved scoring formula
            citation_bonus = min(1.0, 0.2 * len(set(c.get('source', '') for c in citations)))
            score = weight * math.log(1 + mentions) + citation_bonus
            
            # Apply threshold
            if score < min_score:
                continue
            
            # Deduplicate and normalize citations
            unique_citations = []
            seen_sources = set()
            for c in citations:
                source = c.get('source', '')
                page = c.get('page', 0)
                context = c.get('context', '')[:150]
                
                source_key = f"{source}::{page}"
                if source_key not in seen_sources:
                    seen_sources.add(source_key)
                    unique_citations.append({
                        "source": source,
                        "page": page,
                        "snippet": context
                    })
            
            ranked.append({
                "name": target.get('name'),
                "type": target.get('type'),
                "score": round(score, 2),
                "mentions": mentions,
                "evidence": unique_citations[:5]  # Top 5 evidence items
            })
        
        # Sort by score descending
        ranked.sort(key=lambda x: x['score'], reverse=True)
        
        return ranked


    def _generate_scientific_report(self, disease: str, top_targets: List[Dict]) -> Dict[str, Any]:
        """
        Use LLM to generate a structured scientific justification (PhD Level).
        Deterministic LLM settings and robust JSON parsing.
        """
        if not top_targets:
            return {"summary": "No specific targets identified with high confidence."}

        # Ensure evidence keys exist
        for t in top_targets:
            t.setdefault("evidence", t.get("citations", []))

        targets_json = json.dumps(top_targets, indent=2)
        prompt = f"""
You are a biomedical research assistant. Produce JSON only.

INPUT:
- disease: "{disease}"
- targets: {targets_json}

TASK:
For each target, provide:
 - "target": canonical name
 - "mechanism": short mechanism if known or "Unknown"
 - "relevance": 1-2 sentence reason
 - "confidence": 0.0-1.0 numeric
 - "evidence": list of short provenance items

Return JSON shaped exactly like:
{{
  "summary": "one-line summary",
  "justifications": [
    {{
      "target": "ABC1",
      "mechanism": "plays X via ...",
      "relevance": "why relevant",
      "confidence": 0.85,
      "evidence": ["PubMed:xxxx", "Protocol:page 4"]
    }}
  ]
}}
"""
        try:
            # Deterministic LLM invocation
            response = self.llm.invoke(prompt, temperature=0.0, top_p=1.0, max_tokens=800)
            
            # Robust JSON parsing using JSONDecoder
            decoder = JSONDecoder()
            json_obj, idx = decoder.raw_decode(response)
            return json_obj
            
        except JSONDecodeError:
            # Salvage attempt: find JSON substring
            start = response.find('{')
            end = response.rfind('}')
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(response[start:end+1])
                except Exception:
                    logger.error("Failed to parse JSON after salvage attempt.")
            logger.error(f"LLM justification failed or produced invalid JSON. Response: {response[:200]}")
            
        except Exception as e:
            logger.error(f"LLM invocation error: {e}")

        return {"summary": "Target identification complete based on weighted evidence."}
