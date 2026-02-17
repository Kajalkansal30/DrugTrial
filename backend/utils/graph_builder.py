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
        self._connected_uri = None
        self._pending_evidence = []  # Batch buffer

    def connect(self):
        if self.driver and self._connected_uri:
            return
        
        uris_to_try = [self.uri, "bolt://neo4j:7687", "bolt://localhost:7687"]
        
        last_error = None
        for uri in uris_to_try:
            try:
                logger.info(f"Attempting to connect to Neo4j at {uri}")
                self.driver = GraphDatabase.driver(uri, auth=(self.user, self.password))
                self.driver.verify_connectivity()
                self._connected_uri = uri
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
            self.driver = None
            self._connected_uri = None

    def clear_disease(self, disease: str):
        """Clear existing evidence for a disease to prevent duplicates."""
        self.connect()
        with self.driver.session() as session:
            # Delete all relationships from this disease
            session.run(
                "MATCH (d:Disease {name: $disease})-[r:HAS_EVIDENCE]->() DELETE r",
                disease=disease
            )
            # Clean up orphaned Target nodes (no remaining relationships)
            session.run(
                "MATCH (t:Target) WHERE NOT (t)<-[:HAS_EVIDENCE]-() DELETE t"
            )
            logger.info(f"Cleared existing graph evidence for '{disease}'")

    def add_evidence(self, disease: str, entity_name: str, entity_type: str,
                     source: str, page: int, context: str, weight: float,
                     validation_info: Dict[str, Any] = None):
        """
        Buffer evidence for batch writing. Call flush_evidence() to commit.
        Falls back to immediate write if flush is not called.
        """
        self._pending_evidence.append({
            "disease": disease,
            "entity_name": entity_name,
            "entity_type": entity_type,
            "source": source,
            "page": page,
            "context": context,
            "weight": weight,
            "val_source": validation_info.get("source") if validation_info else None,
            "val_id": (validation_info.get("accession") or validation_info.get("approved_symbol"))
                      if validation_info else None,
        })
        
        # Auto-flush every 50 items to prevent unbounded memory growth
        if len(self._pending_evidence) >= 50:
            self.flush_evidence()

    def flush_evidence(self):
        """Batch-write all pending evidence in a single transaction."""
        if not self._pending_evidence:
            return
        
        self.connect()
        batch = self._pending_evidence[:]
        self._pending_evidence.clear()
        
        with self.driver.session() as session:
            def _batch_write(tx):
                for item in batch:
                    # Merge Target node
                    query_merge = "MERGE (t:Target {name: $name}) SET t.type = $type"
                    params = {"name": item["entity_name"], "type": item["entity_type"]}
                    
                    if item["val_source"]:
                        query_merge += ", t.validation_source = $val_source"
                        params["val_source"] = item["val_source"]
                    if item["val_id"]:
                        query_merge += ", t.validation_id = $val_id"
                        params["val_id"] = item["val_id"]
                    
                    tx.run(query_merge, **params)
                    
                    # Merge Disease node
                    tx.run("MERGE (d:Disease {name: $disease})", disease=item["disease"])
                    
                    # Create relationship
                    tx.run(
                        "MATCH (d:Disease {name: $disease}), (t:Target {name: $name}) "
                        "CREATE (d)-[r:HAS_EVIDENCE {source: $source, page: $page, "
                        "context: $context, weight: $weight, timestamp: datetime()}]->(t)",
                        disease=item["disease"],
                        name=item["entity_name"],
                        source=item["source"],
                        page=item["page"],
                        context=item["context"],
                        weight=item["weight"]
                    )
            
            session.execute_write(_batch_write)
            logger.info(f"Flushed {len(batch)} evidence items to Neo4j in single transaction")

    def get_ranked_targets(self, disease: str) -> List[Dict[str, Any]]:
        """Retrieve ranked targets summing weights."""
        # Flush any pending evidence first
        self.flush_evidence()
        
        self.connect()
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
    builder = GraphBuilder()
    try:
        builder.add_evidence("Chagas Disease", "IL-6", "PROTEIN", "test_doc.pdf", 5, "IL-6 was elevated.", 4.0)
        builder.flush_evidence()
        targets = builder.get_ranked_targets("Chagas Disease")
        print(targets)
    except Exception as e:
        print(f"Test failed: {e}")
    finally:
        builder.close()
