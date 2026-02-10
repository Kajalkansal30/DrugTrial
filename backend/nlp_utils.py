import os
import spacy
from typing import Dict, Any

_shared_nlp = {}
_shared_llm = None

def get_nlp(model_name: str = "en_core_sci_lg", load_linker: bool = False):
    """Get or load a shared spaCy model with medical pipelines."""
    global _shared_nlp
    
    # Create a unique key that accounts for the linker status
    cache_key = f"{model_name}_{'linker' if load_linker else 'basic'}"
    
    # Standardize names to avoid redundant loads (logic kept for legacy but simplified)
    if model_name == "en_core_sci_sm" and f"en_core_sci_lg_{'linker' if load_linker else 'basic'}" in _shared_nlp:
         return _shared_nlp[f"en_core_sci_lg_{'linker' if load_linker else 'basic'}"]
            
    if cache_key not in _shared_nlp:
        print(f"⏳ Loading shared NLP model: {model_name} (Linker: {load_linker})...")
        try:
            # PRUNING: Disable components we don't use for criteria extraction
            # parser and lemmatizer are usually heavy and not strictly needed for NER/Linker
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
                # Add sentencizer because we disabled the parser
                if "sentencizer" not in nlp.pipe_names:
                    nlp.add_pipe("sentencizer")
                model_name = fallback
                print(f"✅ Loaded fallback NLP model: {model_name}")
            except:
                nlp = spacy.load("en_core_web_sm", disable=["parser", "attribute_ruler", "lemmatizer"])
                if "sentencizer" not in nlp.pipe_names:
                    nlp.add_pipe("sentencizer")
                model_name = "en_core_web_sm"
                print(f"⚠️  Using basic spaCy")

        # Initialize common medical pipelines once
        if "sentencizer" not in nlp.pipe_names and "parser" not in nlp.pipe_names:
            nlp.add_pipe("sentencizer")
            
        if "negex" not in nlp.pipe_names:
            try:
                # We still want negex for basic logic
                nlp.add_pipe("negex", config={"ent_types": ["ENTITY"]})
                print(f"✅ NegEx added to {model_name}")
            except:
                pass
                
        # ONLY load linker if explicitly requested (saves ~9GB RAM)
        if load_linker and "sci" in model_name and "scispacy_linker" not in nlp.pipe_names:
            try:
                import scispacy
                from scispacy.linking import EntityLinker
                print(f"🧬 Loading heavy UMLS Linker for {model_name}...")
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
    """Get a shared Ollama LLM instance."""
    global _shared_llm
    if _shared_llm is None:
        from langchain_ollama import OllamaLLM
        _shared_llm = OllamaLLM(
            model="llama3.1",
            temperature=0,
            base_url=os.getenv("OLLAMA_URL", "http://localhost:11434")
        )
    return _shared_llm
