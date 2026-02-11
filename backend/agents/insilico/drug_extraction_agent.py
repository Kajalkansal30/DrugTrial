import logging
import json
from typing import List, Dict, Any
from langchain_ollama import OllamaLLM
from backend.utils.domain_config import Domain

logger = logging.getLogger(__name__)

class DrugExtractionAgent:
    def __init__(self):
        self.llm = OllamaLLM(model="llama3.1")

    def extract_drug_data(self, text: str) -> Dict[str, Any]:
        """
        Use LLM to extract drug names, dosages, and prohibited meds.
        Uses a chunking strategy to process large protocols.
        """
        # Identify "hot zones" - paragraphs with keywords
        keywords = ["dosage", "administration", "intervention", "medication", "prohibited", "concomitant"]
        chunks = self._get_relevant_chunks(text, keywords)
        
        all_drugs = []
        all_prohibited = []
        dosing_summaries = []

        # Process top 5 most relevant chunks to keep it efficient but thorough
        for chunk in chunks[:5]:
            prompt = f"""
            Extract structured drug information from this protocol snippet.
            SNIPPET:
            {chunk}
            
            Return ONLY JSON:
            {{
              "trial_drugs": [
                {{ "name": "string", "dose": float, "unit": "mg", "route": "oral/IV", "frequency": "daily" }}
              ],
              "prohibited_meds": ["string"],
              "dosing_schedule": "short summary"
            }}
            """
            try:
                response = self.llm.invoke(prompt)
                start = response.find("{")
                end = response.rfind("}") + 1
                if start != -1 and end != -1:
                    data = json.loads(response[start:end])
                    all_drugs.extend(data.get("trial_drugs", []))
                    all_prohibited.extend(data.get("prohibited_meds", []))
                    if data.get("dosing_schedule"):
                        dosing_summaries.append(data["dosing_schedule"])
            except Exception as e:
                logger.warning(f"Chunk extraction failed: {e}")

        # Deduplicate and finalize
        unique_drugs = {d['name'].lower(): d for d in all_drugs if d.get('name')}.values()
        
        return {
            "trial_drugs": list(unique_drugs),
            "prohibited_meds": list(set(all_prohibited)),
            "dosing_schedule": " | ".join(dosing_summaries[:2])
        }

    def _get_relevant_chunks(self, text: str, keywords: List[str], chunk_size: int = 3000) -> List[str]:
        """Extract paragraphs containing relevant keywords."""
        paragraphs = text.split("\n\n")
        relevant = []
        for p in paragraphs:
            if any(k.lower() in p.lower() for k in keywords):
                relevant.append(p[:chunk_size])
        
        # If no relevant paragraphs found, use sliding window
        if not relevant:
            for i in range(0, len(text), chunk_size // 2):
                relevant.append(text[i:i+chunk_size])
                
        return relevant

if __name__ == "__main__":
    # Test
    agent = DrugExtractionAgent()
    sample_text = "Patients will receive Benznidazole 150mg daily oral for 4 weeks. Avoid alcohol and Warfarin."
    print(agent.extract_drug_data(sample_text))
