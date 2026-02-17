import os
import spacy
from typing import Dict, Any

# spaCy NLP runs on CPU (fast enough for our entity extraction workload).
# Ollama LLM runs on GPU (handles the heavy inference).
# Attempting spacy.prefer_gpu() with cupy on cuda-runtime images causes
# cuda_fp16.h compilation errors, so we explicitly stay on CPU.

_shared_nlp = {}
_shared_llm = None

def get_nlp(model_name: str = "en_core_sci_lg", load_linker: bool = False):
    """Get or load a shared spaCy model with medical pipelines."""
    global _shared_nlp
    
    cache_key = f"{model_name}_{'linker' if load_linker else 'basic'}"
    
    # Reuse larger model if smaller variant requested
    if model_name == "en_core_sci_sm" and f"en_core_sci_lg_{'linker' if load_linker else 'basic'}" in _shared_nlp:
         return _shared_nlp[f"en_core_sci_lg_{'linker' if load_linker else 'basic'}"]
            
    if cache_key not in _shared_nlp:
        print(f"⏳ Loading shared NLP model: {model_name} (Linker: {load_linker})...")
        try:
            disable_pipes = ["parser", "attribute_ruler", "lemmatizer"]
            nlp = spacy.load(model_name, disable=disable_pipes)
            print(f"✅ Loaded NLP model: {model_name}")
        except Exception as e:
            print(f"⚠️  Failed to load {model_name}: {e}")
            fallback = "en_core_sci_sm" if "lg" in model_name else "en_core_web_sm"
            if f"{fallback}_{'linker' if load_linker else 'basic'}" in _shared_nlp:
                return _shared_nlp[f"{fallback}_{'linker' if load_linker else 'basic'}"]
            print(f"🔄 Retrying with fallback: {fallback}")
            try:
                nlp = spacy.load(fallback, disable=["parser", "attribute_ruler", "lemmatizer"])
                if "sentencizer" not in nlp.pipe_names:
                    nlp.add_pipe("sentencizer")
                model_name = fallback
                print(f"✅ Loaded fallback NLP model: {model_name}")
            except Exception:
                nlp = spacy.load("en_core_web_sm", disable=["parser", "attribute_ruler", "lemmatizer"])
                if "sentencizer" not in nlp.pipe_names:
                    nlp.add_pipe("sentencizer")
                model_name = "en_core_web_sm"
                print(f"⚠️  Using basic spaCy")

        if "sentencizer" not in nlp.pipe_names and "parser" not in nlp.pipe_names:
            nlp.add_pipe("sentencizer")
            
        if "negex" not in nlp.pipe_names:
            try:
                nlp.add_pipe("negex", config={"ent_types": ["ENTITY"]})
                print(f"✅ NegEx added to {model_name}")
            except Exception:
                pass
                
        # ONLY load linker if explicitly requested (saves ~9GB RAM)
        if load_linker and "sci" in model_name and "scispacy_linker" not in nlp.pipe_names:
            try:
                import scispacy
                from scispacy.linking import EntityLinker
                print(f"🧬 Loading UMLS Linker for {model_name}...")
                nlp.add_pipe(
                    "scispacy_linker",
                    config={
                        "linker_name": "umls",
                        "resolve_abbreviations": True,
                        "threshold": 0.7
                    }
                )
                print(f"✅ UMLS Linker added to {model_name}")
            except Exception as e:
                print(f"⚠️ Failed to add UMLS linker: {e}")
        
        _shared_nlp[cache_key] = nlp
        
    return _shared_nlp[cache_key]

def get_llm():
    """Get a shared Ollama LLM instance. Model is configurable via OLLAMA_MODEL env var."""
    global _shared_llm
    if _shared_llm is None:
        from langchain_ollama import OllamaLLM
        model_name = os.getenv("OLLAMA_MODEL", "llama3.1")
        _shared_llm = OllamaLLM(
            model=model_name,
            temperature=0,
            base_url=os.getenv("OLLAMA_URL", "http://localhost:11434")
        )
        print(f"✅ Shared LLM initialized: {model_name}")
    return _shared_llm
