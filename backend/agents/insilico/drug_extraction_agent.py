import logging
import json
from typing import List, Dict, Any
from backend.utils.domain_config import Domain

from concurrent.futures import ThreadPoolExecutor
import threading

logger = logging.getLogger(__name__)

class DrugExtractionAgent:
    def __init__(self):
        from backend.nlp_utils import get_llm
        self.llm = get_llm()
        self._lock = threading.Lock()

    def extract_drug_data(self, text: str) -> Dict[str, Any]:
        """
        Use LLM to extract drug names, dosages, and prohibited meds.
        Processes all relevant hot zones in parallel for exhaustive coverage.
        """
        # Identify "hot zones" - paragraphs with specific dosing/drug keywords
        # Removed overly generic words like 'drug', 'treatment', 'medication'
        keywords = ["dosage", "mg/kg", "mg", "mcg", "mL", "BID", "TID", "daily", "prohibited", "concomitant", "regimen", "administration", "intervention", "dose-escalation", "posology"]
        chunks = self._get_relevant_chunks(text, keywords)
        
        all_drugs = []
        all_prohibited = []
        dosing_summaries = []

        def process_chunk(chunk):
            prompt = f"""
            Identify drug names, dosages, and dosing schedules from this clinical protocol snippet.
            Include only specific drugs being tested or strictly prohibited.
            
            SNIPPET:
            {chunk}
            
            Return ONLY JSON in this format:
            {{
              "trial_drugs": [
                {{ 
                  "name": "drug name", 
                  "dose": "numeric value", 
                  "unit": "mg, mg/kg, etc", 
                  "route": "Oral, IV, etc", 
                  "frequency": "daily, BID, etc",
                  "duration": "duration"
                }}
              ],
              "prohibited_meds": ["list of drugs not allowed"],
              "dosing_schedule": "concise summary"
            }}
            """
            try:
                # Temperature is already 0.0 in __init__
                response = self.llm.invoke(prompt)
                start = response.find("{")
                end = response.rfind("}") + 1
                if start != -1 and end != -1:
                    data = json.loads(response[start:end])
                    with self._lock:
                        all_drugs.extend(data.get("trial_drugs", []))
                        all_prohibited.extend(data.get("prohibited_meds", []))
                        if data.get("dosing_schedule"):
                            dosing_summaries.append(data["dosing_schedule"])
            except Exception as e:
                logger.warning(f"Chunk extraction failed: {e}")

        # Process relevant chunks in parallel
        print(f"🚀 Processing {len(chunks)} relevant protocol chunks for In Silico modelling...")
        with ThreadPoolExecutor(max_workers=5) as executor:
            list(executor.map(process_chunk, chunks))

        # Deduplicate drugs by name (case-insensitive)
        unique_drugs_map = {}
        for drug in all_drugs:
            name = drug.get('name', '').lower().strip()
            if not name or len(name) < 2 or name in ['null', 'none']:
                continue
            if name not in unique_drugs_map:
                unique_drugs_map[name] = drug
            else:
                # Merge info if current has more details
                existing = unique_drugs_map[name]
                if not existing.get('dose') and drug.get('dose'):
                    existing['dose'] = drug['dose']
                if not existing.get('unit') and drug.get('unit'):
                    existing['unit'] = drug['unit']

        return {
            "trial_drugs": list(unique_drugs_map.values()),
            "prohibited_meds": sorted(list(set([m.strip() for m in all_prohibited if m and len(m) > 1]))),
            "dosing_schedule": " | ".join(list(set(dosing_summaries))[:3])
        }

    def _get_relevant_chunks(self, text: str, keywords: List[str], chunk_size: int = 3000) -> List[str]:
        """Extract paragraphs containing relevant keywords with filtering."""
        paragraphs = text.split("\n\n")
        relevant = []
        for p in paragraphs:
            p_strip = p.strip()
            # Filter: must be long enough and contain a keyword
            if len(p_strip) > 50 and any(k.lower() in p_strip.lower() for k in keywords):
                relevant.append(p_strip[:chunk_size])
        
        # Cap to top 10 most keyword-dense chunks for speed
        if len(relevant) > 10:
            relevant = sorted(relevant, key=lambda x: sum(1 for k in keywords if k.lower() in x.lower()), reverse=True)[:10]
        
        # If no relevant paragraphs found, use sliding window
        if not relevant:
            for i in range(0, min(len(text), 50000), chunk_size // 2):
                relevant.append(text[i:i+chunk_size])
                
        return relevant

if __name__ == "__main__":
    # Test
    agent = DrugExtractionAgent()
    sample_text = "Patients will receive Benznidazole 150mg daily oral for 4 weeks. Avoid alcohol and Warfarin."
    print(agent.extract_drug_data(sample_text))
