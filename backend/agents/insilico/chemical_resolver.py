import pubchempy as pcp
import logging
from typing import Optional, Dict
import json
from pathlib import Path

logger = logging.getLogger(__name__)

class ChemicalResolver:
    def __init__(self, cache_dir: str = "/tmp/chem_cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_file = self.cache_dir / "smiles_cache.json"
        self._load_cache()

    def _load_cache(self):
        if self.cache_file.exists():
            try:
                self.cache = json.loads(self.cache_file.read_text())
            except Exception:
                self.cache = {}
        else:
            self.cache = {}

    def _save_cache(self):
        self.cache_file.write_text(json.dumps(self.cache))

    def resolve_name(self, name: str) -> Optional[Dict[str, str]]:
        """
        Resolve drug name to SMILES and CID using PubChem.
        """
        name = name.lower().strip()
        if name in self.cache:
            return self.cache[name]

        logger.info(f"🔍 Resolving chemical structure for: {name}")
        try:
            # Search PubChem
            results = pcp.get_compounds(name, 'name')
            if results:
                compound = results[0]
                data = {
                    "name": name,
                    "cid": str(compound.cid),
                    "smiles": compound.isomeric_smiles or compound.canonical_smiles,
                    "formula": compound.molecular_formula,
                    "weight": str(compound.molecular_weight)
                }
                self.cache[name] = data
                self._save_cache()
                return data
            
            # Try to handle common trial drugs if PubChem fails
            # (Standard trial drugs often have identifiers in protocols)
        except Exception as e:
            logger.error(f"PubChem resolution failed for {name}: {e}")

        return None

if __name__ == "__main__":
    # Test
    resolver = ChemicalResolver()
    print(resolver.resolve_name("Ibuprofen"))
    print(resolver.resolve_name("Benznidazole"))
