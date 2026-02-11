import os
from neo4j import GraphDatabase
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class GraphBuilder:
    def __init__(self):
        self.uri = os.getenv("NEO4J_URI", "bolt://drugtrial-neo4j:7687")
        self.user = os.getenv("NEO4J_USER", "neo4j")
        self.password = os.getenv("NEO4J_PASSWORD", "password")
        self.driver = None

    def connect(self):
        if not self.driver:
            # Inside Docker, use the URI from env (bolt://neo4j:7687)
            # Outside Docker (local tests), use bolt://localhost:7687
            uris_to_try = [self.uri, "bolt://neo4j:7687", "bolt://localhost:7687"]
            
            last_error = None
            for uri in uris_to_try:
                try:
                    logger.info(f"Attempting to connect to Neo4j at {uri}")
                    self.driver = GraphDatabase.driver(uri, auth=(self.user, self.password))
                    self.driver.verify_connectivity()
                    logger.info(f"Successfully connected to Neo4j at {uri}")
                    return
                except Exception as e:
                    last_error = e
                    logger.warning(f"Failed to connect to {uri}: {e}")
                    self.driver = None
            
            raise last_error

    def close(self):
        if self.driver:
            self.driver.close()

    def clear_disease(self, disease: str):
        """
        Clear existing evidence for a disease to prevent duplicates on re-analysis.
        Keeps the Disease node but removes outgoing HAS_EVIDENCE relationships.
        """
        self.connect()
        with self.driver.session() as session:
            session.run(
                "MATCH (d:Disease {name: $disease})-[r:HAS_EVIDENCE]->() DELETE r",
                disease=disease
            )
            logger.info(f"🧹 Cleared existing graph evidence for '{disease}'")
        """
        Create relationship with evidence provenance and weight.
        Includes biological validation metadata on the Target node.
        """
        self.connect()
        
        # Prepare validation props
        val_source = validation_info.get("source") if validation_info else None
        val_id = validation_info.get("accession") or validation_info.get("approved_symbol") if validation_info else None
        
        with self.driver.session() as session:
            # Create Target node with validation metadata
            # We use SET to update existing nodes if they gain validation info
            
            # Simplified query string construction
            query_merge = """MERGE (t:Target {name: $name}) SET t.type = $type"""
            
            if val_source:
                query_merge += ", t.validation_source = $val_source"
            if val_id:
                query_merge += ", t.validation_id = $val_id"
                
            session.run(query_merge, name=entity_name, type=entity_type, val_source=val_source, val_id=val_id)
            
            # Create Disease node
            session.run("MERGE (d:Disease {name: $disease})", disease=disease)
            
            # Create relationship with metadata and weight
            session.run(
                "MATCH (d:Disease {name: $disease}), (t:Target {name: $name}) "
                "CREATE (d)-[r:HAS_EVIDENCE {source: $source, page: $page, context: $context, weight: $weight, timestamp: datetime()}]->(t)",
                disease=disease, name=entity_name, source=source, page=page, context=context, weight=weight
            )

    def get_ranked_targets(self, disease: str) -> List[Dict[str, Any]]:
        """
        Retrieve ranked targets summing weights (Pharma-Grade Ranking).
        Returns validation metadata if available.
        """
        self.connect()
        # Return validation_source and validation_id
        query = """
        MATCH (d:Disease {name: $disease})-[r:HAS_EVIDENCE]->(t:Target)
        RETURN 
            t.name as name, 
            t.type as type, 
            t.validation_source as validation_source,
            t.validation_id as validation_id,
            sum(r.weight) as score, 
            collect({source: r.source, page: r.page, context: r.context}) as citations
        ORDER BY score DESC
        """
        with self.driver.session() as session:
            result = session.run(query, disease=disease)
            return [dict(record) for record in result]

if __name__ == "__main__":
    # Test (requires Neo4j running)
    builder = GraphBuilder()
    try:
        builder.add_evidence("Chagas Disease", "IL-6", "PROTEIN", "test_doc.pdf", 5, "IL-6 was elevated.")
        targets = builder.get_ranked_targets("Chagas Disease")
        print(targets)
    except Exception as e:
        print(f"Test failed: {e}")
    finally:
        builder.close()
