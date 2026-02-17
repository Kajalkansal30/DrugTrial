import logging
import threading
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
from concurrent.futures import ThreadPoolExecutor

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
        self._lock = threading.Lock()

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

    # Static synonym map for common disease terms (replaces slow LLM expansion)
    DISEASE_SYNONYMS = {
        "chagas disease": ["trypanosoma cruzi infection", "american trypanosomiasis"],
        "chronic indeterminate chagas disease": ["chagas disease", "trypanosoma cruzi infection"],
        "heart failure": ["cardiac failure", "congestive heart failure"],
        "myocardial infarction": ["heart attack", "acute coronary syndrome"],
        "diabetes": ["diabetes mellitus", "type 2 diabetes"],
        "type 2 diabetes": ["diabetes mellitus type 2", "T2DM"],
        "type 1 diabetes": ["diabetes mellitus type 1", "T1DM", "juvenile diabetes"],
        "hypertension": ["high blood pressure", "arterial hypertension"],
        "breast cancer": ["breast carcinoma", "breast neoplasm"],
        "lung cancer": ["pulmonary neoplasm", "non-small cell lung cancer"],
        "colorectal cancer": ["colon cancer", "rectal cancer"],
        "alzheimer's disease": ["alzheimer disease", "AD dementia"],
        "parkinson's disease": ["parkinson disease", "parkinsonian disorder"],
        "rheumatoid arthritis": ["RA", "inflammatory arthritis"],
        "asthma": ["bronchial asthma", "reactive airway disease"],
        "copd": ["chronic obstructive pulmonary disease", "emphysema"],
        "depression": ["major depressive disorder", "MDD"],
        "anxiety": ["generalized anxiety disorder", "GAD"],
        "fever": ["pyrexia", "febrile illness"],
        "pain": ["nociceptive pain", "analgesic management"],
    }

    def _expand_queries(self, disease_query: str) -> list:
        """Expand disease query using static synonym map (instant, no LLM)."""
        key = disease_query.lower().strip()
        # Direct match
        if key in self.DISEASE_SYNONYMS:
            return [disease_query] + self.DISEASE_SYNONYMS[key]
        # Partial match: check if any synonym key is contained in the query
        for disease_key, synonyms in self.DISEASE_SYNONYMS.items():
            if disease_key in key or key in disease_key:
                return [disease_query] + synonyms
        return [disease_query]

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
            print(f"✅ Returning cached analysis for: {disease_query}")
            return cached_result

        # 0. Early Exit for Generic Indications
        generic_indications = ['general', 'unknown', 'none', 'n/a', 'indication', 'diagnosis', 'study']
        if disease_query.lower().strip() in generic_indications:
            logger.warning(f"⚠️ Indication '{disease_query}' is too generic. Skipping PubMed research.")
            return {
                "disease": disease_query,
                "domain": "general",
                "status": "ready",
                "summary": "Indication is too generic for specific literature research. Please refine the trial diagnosis.",
                "ranked_targets": [],
                "report": {"summary": "Generic indication - no specific targets identified."},
                "excluded_entities": {"total_excluded": 0, "by_reason": {}, "top_excluded": []},
                "stats": {
                    "domain": "general",
                    "pubmed_count": 0,
                    "pdf_count": 0,
                    "targets_found": 0,
                    "entities_rejected": 0,
                    "total_score": 0
                }
            }

        # 0.5 Expand Indication for better PubMed coverage (static synonyms, no LLM)
        queries_to_try = self._expand_queries(disease_query)
        logger.info(f"🧬 Expanded queries: {queries_to_try}")
        
        # 1. Clear graph + Fetch PubMed + Process PDF in PARALLEL
        try:
            self.graph.clear_disease(disease_query)
        except Exception as e:
            logger.error(f"Failed to clear graph for {disease_query}: {e}")

        def _fetch_pubmed():
            for q in queries_to_try:
                print(f"📚 Searching PubMed for: '{q}'")
                records = fetch_pubmed_abstracts([q], max_results=max_papers)
                if records:
                    print(f"✅ Found {len(records)} abstracts for '{q}'")
                    return records
                print(f"⚠️ No results for '{q}', trying fallback...")
            print(f"❌ PubMed search failed for all queries: {queries_to_try}")
            return []

        def _process_pdfs():
            results = []
            pdf_path = Path(self.pdf_folder)
            if pdf_path.exists() and target_trial_id:
                search_pattern = f"*{target_trial_id}*.pdf"
                matching_files = sorted(pdf_path.glob(search_pattern))
                logger.info(f"🔍 Found {len(matching_files)} matching PDFs for {target_trial_id}")
                for pdf_file in matching_files[:1]:
                    try:
                        pdf_data = process_pdf_document(str(pdf_file))
                        sample_text = pdf_data['chunks'][0]['text'] if pdf_data.get('chunks') else ""
                        doc_type = classify_document_type(sample_text, pdf_file.name)
                        pdf_data['document_type'] = doc_type
                        results.append(pdf_data)
                        logger.info(f"📄 Processed PDF: {pdf_file.name} classified as {doc_type.value}")
                    except Exception as e:
                        logger.error(f"Failed to process PDF {pdf_file.name}: {e}")
            return results

        with ThreadPoolExecutor(max_workers=2) as io_executor:
            pubmed_future = io_executor.submit(_fetch_pubmed)
            pdf_future = io_executor.submit(_process_pdfs)
            pubmed_records = pubmed_future.result()
            pdf_records = pdf_future.result()

        # 3. Process Content & Build Graph with Citations (Parallelized)
        processing_tasks = []
        
        # PubMed - sorted by URL for determinism
        for pub in sorted(pubmed_records, key=lambda x: x.get('url', '')):
            processing_tasks.append({
                "disease_query": disease_query,
                "text": pub['text'],
                "source": pub['url'],
                "page": 0,
                "domain": current_domain,
                "doc_type": DocumentType.RESEARCH_PAPER
            })
            
        # Local PDFs
        for pdf in pdf_records:
            source_label = pdf.get('filename') or pdf.get('source', 'Protocol')
            doc_type = pdf.get('document_type', DocumentType.UNKNOWN)
            # Ensure chunks are in page order
            for chunk in sorted(pdf['chunks'], key=lambda x: x.get('page', 0)):
                processing_tasks.append({
                    "disease_query": disease_query,
                    "text": chunk['text'],
                    "source": source_label,
                    "page": chunk['page'],
                    "domain": current_domain,
                    "doc_type": doc_type
                })

        # Cap chunks to avoid OOM -- prioritize PubMed (research papers) then first N PDF chunks
        MAX_CHUNKS = 40
        if len(processing_tasks) > MAX_CHUNKS:
            logger.info(f"⚠️ Capping {len(processing_tasks)} chunks to {MAX_CHUNKS} to prevent OOM")
            processing_tasks = processing_tasks[:MAX_CHUNKS]

        print(f"🚀 Processing {len(processing_tasks)} chunks in parallel...")
        with ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(lambda t: self._process_text(**t), processing_tasks))

        # Flush any remaining batched graph writes
        try:
            self.graph.flush_evidence()
        except Exception as e:
            logger.warning(f"Graph flush failed: {e}")

        # 4. Get Ranked Targets with improved scoring
        ranked_results = self._get_ranked_targets_with_threshold(disease_query)
        
        logger.info(f"📊 Ranked {len(ranked_results)} high-quality targets")
        logger.info(f"🚫 Excluded {len(self.excluded_entities)} entities")
        
        # 5. Fast Template-Based Scientific Justification (Top 3 Targets)
        top_targets = ranked_results[:3]
        justification = self._generate_scientific_report_fast(disease_query, top_targets)
        
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
        
        # Flush persistent bio validation cache to disk
        from backend.utils.bio_validator import flush_validation_cache
        flush_validation_cache()
        
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
                with self._lock:
                    self.excluded_entities.append({
                        "entity": raw,
                        "reason": reason,
                        "source": source,
                        "page": page
                    })
                continue
                
            if ent_norm in domain_generics:
                with self._lock:
                    self.excluded_entities.append({
                        "entity": raw,
                        "reason": f"domain_generic_{domain.value}",
                        "source": source,
                        "page": page
                    })
                continue

            # 2. Skip very short or numeric tokens
            if len(ent_norm) < 3:
                with self._lock:
                    self.excluded_entities.append({
                        "entity": raw,
                        "reason": "too_short",
                        "source": source,
                        "page": page
                    })
                continue

            if ent_norm.isdigit():
                with self._lock:
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
                with self._lock:
                    self.excluded_entities.append({
                        "entity": raw,
                        "reason": "no_tui_match",
                        "source": source,
                        "page": page
                    })
                continue

            # 4. Blacklist check (safety net for old blacklist)
            if ent_norm in self.BLACKLIST:
                with self._lock:
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
                with self._lock:
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


    def _generate_scientific_report_fast(self, disease: str, top_targets: List[Dict]) -> Dict[str, Any]:
        """
        Template-based scientific report (instant, no LLM call).
        Produces the same JSON shape as the LLM version for UI compatibility.
        """
        if not top_targets:
            return {"summary": "No specific targets identified with high confidence."}

        justifications = []
        for t in top_targets:
            evidence = t.get("evidence", t.get("citations", []))
            unique_sources = list(set(
                c.get("source", "") for c in evidence if c.get("source")
            ))[:3]
            snippets = [
                c.get("snippet", c.get("context", ""))[:200]
                for c in evidence if c.get("snippet") or c.get("context")
            ][:3]

            target_name = t.get("name", "Unknown")
            target_type = t.get("type", "target")
            score = round(t.get("score", 0), 2)
            mentions = t.get("mentions", len(evidence))

            justifications.append({
                "target": target_name,
                "biological_context": (
                    f"{target_name} is a {target_type.lower()} identified through "
                    f"literature mining of {mentions} evidence sources related to {disease}."
                ),
                "disease_mechanism": (
                    f"{target_name} was found in {len(unique_sources)} distinct publications "
                    f"discussing {disease}, with an aggregate evidence score of {score}."
                ),
                "therapeutic_rationale": (
                    f"Targeting {target_name} may be relevant for {disease} based on "
                    f"converging evidence from PubMed literature and protocol analysis."
                ),
                "confidence_score": min(1.0, score / 10.0),
                "evidence_snippets": snippets if snippets else [
                    f"Referenced in {mentions} evidence sources for {disease}."
                ]
            })

        total_targets = len(top_targets)
        top_name = top_targets[0].get("name", "Unknown") if top_targets else "N/A"
        summary = (
            f"Literature analysis identified {total_targets} key molecular targets for {disease}. "
            f"The highest-scoring target is {top_name} with an evidence score of "
            f"{round(top_targets[0].get('score', 0), 2) if top_targets else 0}."
        )

        return {
            "summary": summary,
            "justifications": justifications
        }

    def _generate_scientific_report(self, disease: str, top_targets: List[Dict]) -> Dict[str, Any]:
        """
        Use LLM to generate a structured scientific justification (PhD Level).
        Deterministic LLM settings and robust JSON parsing.
        Kept for optional deep-analysis mode; not used in default flow.
        """
        if not top_targets:
            return {"summary": "No specific targets identified with high confidence."}

        # Ensure evidence keys exist
        for t in top_targets:
            t.setdefault("evidence", t.get("citations", []))

        targets_json = json.dumps(top_targets, indent=2)
        prompt = f"""
You are a Senior Biomedical Scientist (PhD). Produce JSON only.

INPUT:
- disease: "{disease}"
- targets: {targets_json}

TASK:
For each target, provide a high-rigor scientific assessment:
 - "target": canonical name
 - "biological_context": 2-3 sentences explaining the target's role in the human body.
 - "disease_mechanism": Exactly how this target relates to "{disease}" pathogenesis.
 - "therapeutic_rationale": Why targeting this would be beneficial.
 - "confidence_score": 0.0-1.0 (based on evidence strength).
 - "evidence_snippets": List up to 3 direct quotes or snippets from the provided evidence.

Return JSON shaped exactly like:
{{
  "summary": "High-level molecular overview",
  "justifications": [
    {{
      "target": "...",
      "biological_context": "...",
      "disease_mechanism": "...",
      "therapeutic_rationale": "...",
      "confidence_score": 0.9,
      "evidence_snippets": ["Quote 1", "Quote 2"]
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
