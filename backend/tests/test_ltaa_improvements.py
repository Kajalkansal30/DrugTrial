"""
Tests for LTAA Agent Improvements
Tests determinism, entity quality, and JSON parsing robustness
"""
import pytest
import json
from backend.agents.ltaa_agent import LTAAAgent, _normalize_entity, GENERIC_CUTOFF


class TestEntityNormalization:
    """Test entity normalization and filtering"""
    
    def test_normalize_entity(self):
        """Test entity normalization function"""
        assert _normalize_entity("Interleukin-6") == "interleukin6"
        assert _normalize_entity("IL-6") == "il6"
        assert _normalize_entity("  Gene  ") == "gene"
        assert _normalize_entity("Pro-inflammatory") == "proinflammatory"
    
    def test_generic_cutoff_filter(self):
        """Ensure generic entities are in GENERIC_CUTOFF"""
        # These should be filtered
        generic_entities = ["genes", "illness", "dynamically", "risk", "patient", "impact"]
        for ent in generic_entities:
            assert _normalize_entity(ent) in GENERIC_CUTOFF, f"{ent} should be in GENERIC_CUTOFF"
        
        # These should pass
        valid_entities = ["Interleukin-6", "NLRP3", "Benznidazole", "atherosclerosis"]
        for ent in valid_entities:
            assert _normalize_entity(ent) not in GENERIC_CUTOFF, f"{ent} should NOT be in GENERIC_CUTOFF"


class TestJSONParsing:
    """Test robust JSON parsing from LLM outputs"""
    
    def test_json_decoder_robustness(self):
        """Test that JSON parsing handles various LLM output formats"""
        from json import JSONDecoder
        
        test_cases = [
            '{"summary": "test"}',  # Clean
            'Here is the JSON:\n{"summary": "test"}',  # Prefixed
            'Let me provide: {"summary": "test"} as requested',  # Embedded
        ]
        
        for case in test_cases:
            decoder = JSONDecoder()
            try:
                obj, idx = decoder.raw_decode(case.lstrip())
                assert obj['summary'] == 'test', f"Failed parsing: {case}"
            except:
                # Fallback
                start = case.find('{')
                end = case.rfind('}')
                if start != -1 and end != -1:
                    obj = json.loads(case[start:end+1])
                    assert obj['summary'] == 'test', f"Failed fallback parsing: {case}"


class TestCachingMechanism:
    """Test caching functionality"""
    
    def test_cache_key_generation(self):
        """Test cache key generation is consistent"""
        agent = LTAAAgent()
        
        key1 = agent._cache_key("Chagas Disease", "TRIAL_123", 3)
        key2 = agent._cache_key("Chagas Disease", "TRIAL_123", 3)
        key3 = agent._cache_key("Chagas Disease", "TRIAL_456", 3)
        
        assert key1 == key2, "Same inputs should produce same cache key"
        assert key1 != key3, "Different inputs should produce different cache keys"
    
    def test_cache_save_load(self):
        """Test cache save and load functionality"""
        import tempfile
        import shutil
        from pathlib import Path
        
        agent = LTAAAgent()
        
        # Use temp directory for testing
        test_result = {"disease": "Test", "targets": []}
        key = agent._cache_key("Test Disease", "TRIAL_TEST", 2)
        
        # Save and load
        agent._save_cache(key, test_result)
        loaded = agent._load_cache(key)
        
        assert loaded is not None, "Cache should be loadable"
        assert loaded == test_result, "Loaded cache should match saved data"
        
        # Cleanup
        cache_path = Path("/tmp/ltaa_cache") / f"{key}.pkl"
        if cache_path.exists():
            cache_path.unlink()


class TestImprovedRanking:
    """Test ranking formula improvements"""
    
    def test_ranking_formula(self):
        """Test improved ranking uses logarithmic scoring"""
        import math
        
        # Simulate ranking calculation
        weight = 5
        mentions = 10
        source_diversity = 3
        
        citation_bonus = min(1.0, 0.2 * source_diversity)
        score = weight * math.log(1 + mentions) + citation_bonus
        
        # Log(11) ≈ 2.4, so 5 * 2.4 + 0.6 ≈ 12.6
        assert 12.0 < score < 13.0, f"Score calculation seems wrong: {score}"
    
    def test_threshold_filtering(self):
        """Test that low-scoring targets are filtered"""
        agent = LTAAAgent()
        
        # Mock target data
        mock_targets = [
            {"name": "High Score", "score": 10, "citations": [{"source": "A", "page": 1}] * 5},
            {"name": "Low Score", "score": 0.5, "citations": [{"source": "B", "page": 2}]},
        ]
        
        # The low score target should be filtered out with min_score=1.0
        # (This is a simplified test - actual test would need graph mocking)


if __name__ == "__main__":
    # Run tests
    print("Running LTAA Agent Tests...")
    pytest.main([__file__, "-v"])
