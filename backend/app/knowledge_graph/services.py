import re
import time
import logging
from typing import List, Dict, Any, Optional
from neo4j import GraphDatabase

from app.config import settings
import os
import certifi

os.environ["SSL_CERT_FILE"] = certifi.where()

logger = logging.getLogger("conceptintel.graph")

# How long to wait before retrying a failed Neo4j connection. Long enough that a
# genuinely-down database doesn't add a connection attempt's latency to every
# single request; short enough that the app notices within a reasonable window
# once Neo4j (an Aura free-tier instance in this deployment, which pauses itself
# after inactivity) comes back online.
NEO4J_RECONNECT_COOLDOWN_SECONDS = 30


def build_node_id(catalog_id: int, name: str) -> str:
    """Same id scheme used everywhere a Concept node is created - kept as one
    function so callers (routes.py, services.py) can never construct a mismatched id."""
    return f"{catalog_id}_{name.lower().strip().replace(' ', '_')}"


class Neo4jService:
    """
    All Concept nodes/relationships are keyed by `catalog_id` (CourseCatalog.id), not
    by an individual Course section's id - this is what makes the graph shared across
    every teacher/section teaching the same catalog course, per the scope doc's
    "shared concept graph" requirement. Callers (routes.py) are responsible for
    resolving a Course.id to its catalog_id before calling into this service.
    """

    def __init__(self):
        self.driver = None
        self._last_connect_attempt = 0.0
        # Deliberately does NOT call self._connect() here. This class is
        # constructed as a module-level singleton (see `neo4j_service` below),
        # which means __init__ runs at IMPORT time - i.e. during backend startup,
        # before the app can serve a single request. Connecting here used to block
        # startup for ~20s whenever the Aura free-tier instance was paused
        # (measured directly), on every request the app makes... including every
        # `--reload` during local dev. That 20s was being paid on EVERY backend
        # start regardless of whether the request that follows even touches the
        # knowledge graph (most don't - course lists, enrollments, dashboards).
        # _ensure_connected() below is already called at the top of every real
        # graph operation (get_session/query), so the connection now happens
        # lazily on the first actual graph request instead - the cost moves to
        # where it's actually needed, and unrelated pages stop paying for it.

    def _connect(self) -> None:
        """(Re)attempts the connection. Safe to call more than once - records the
        attempt time regardless of outcome so _ensure_connected() below can rate-
        limit retries."""
        self._last_connect_attempt = time.monotonic()
        try:
            driver = GraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USERNAME, settings.NEO4J_PASSWORD)
            )
            driver.verify_connectivity()
            # Only published after connectivity is confirmed. Assigning self.driver
            # first (as this previously did) left a live-looking driver behind when
            # verify_connectivity() raised, so every `if not self.driver` guard in
            # this class silently never fired: instead of degrading to the mock
            # graph / empty result the guards promise, each call reached
            # driver.session() and raised ServiceUnavailable out of the request.
            self.driver = driver
            logger.info("Successfully connected to Neo4j database")
        except Exception as e:
            logger.error(f"Failed to connect to Neo4j database: {str(e)}")
            self.driver = None

    def _ensure_connected(self) -> None:
        """This service is a module-level singleton, constructed once when the app
        starts - so __init__ only ever gets ONE chance to connect. If Neo4j (an
        Aura free-tier instance in this deployment) happened to be paused at that
        moment, self.driver stayed None for the rest of the process's life, and
        every graph call silently fell back to get_mock_graph_data()/an empty
        result FOREVER, even after Neo4j came back online and a fresh connection
        would have succeeded - confirmed live: a course's Concept Graph page kept
        showing an unrelated placeholder graph long after the Aura instance had
        actually resumed, because this service never got a second chance to
        connect. Called at the top of every query so a resumed database is
        noticed within NEO4J_RECONNECT_COOLDOWN_SECONDS instead of requiring a
        manual backend restart."""
        if self.driver is not None:
            return
        if time.monotonic() - self._last_connect_attempt < NEO4J_RECONNECT_COOLDOWN_SECONDS:
            return
        self._connect()

    def close(self):
        if self.driver:
            self.driver.close()

    def get_session(self):
        self._ensure_connected()
        if not self.driver:
            raise ConnectionError("Neo4j database connection is not available.")
        return self.driver.session()

    def query(self, query_str: str, parameters: Dict[str, Any] = None):
        """Execute a general Cypher query."""
        self._ensure_connected()
        if not self.driver:
            logger.warning("Neo4j not connected. Mocking query execution.")
            return []
        try:
            with self.get_session() as session:
                result = session.run(query_str, parameters or {})
                return [record.data() for record in result]
        except Exception as e:
            # _ensure_connected() only helps when self.driver is already None - it
            # does nothing for a driver that connected fine at some point but has
            # since gone stale (e.g. this deployment's Neo4j Aura free-tier
            # instance auto-pausing after sitting idle). Without this, that first
            # query after a pause raised an uncaught neo4j exception straight out
            # of every caller as a 500, instead of the graceful mock-data/empty-
            # result fallback every caller already codes for via `if not
            # self.driver`. Clearing self.driver here routes this exact failure
            # into that same fallback immediately, and makes the NEXT call retry
            # the connection (cooldown already elapsed, since it's timed from the
            # original successful connect) instead of waiting on a process
            # restart.
            logger.error(f"Neo4j query failed ({type(e).__name__}: {e}) - marking connection dead for reconnect.")
            self.driver = None
            return []

    def create_concept_node(self, catalog_id: int, name: str, description: str, difficulty: str,
                            importance_score: int = 5, learning_outcomes: str = "", material: str = ""):
        """Merge/Create a Concept node in the graph with extended properties."""
        query = """
        MERGE (c:Concept {catalog_id: $catalog_id, name: $name})
        ON CREATE SET c.description = $description,
                      c.difficulty = $difficulty,
                      c.importance_score = $importance_score,
                      c.learning_outcomes = $learning_outcomes,
                      c.material = $material,
                      c.id = $node_id
        ON MATCH SET  c.description = $description,
                      c.difficulty = $difficulty,
                      c.importance_score = $importance_score,
                      c.learning_outcomes = $learning_outcomes,
                      c.material = $material
        RETURN c
        """
        node_id = build_node_id(catalog_id, name)
        params = {
            "catalog_id": catalog_id,
            "name": name.strip(),
            "description": description.strip(),
            "difficulty": difficulty,
            "importance_score": importance_score,
            "learning_outcomes": learning_outcomes,
            "material": material,
            "node_id": node_id
        }
        self.query(query, params)

    def create_prerequisite_relationship(self, catalog_id: int, source_name: str, target_name: str):
        """Create a PREREQUISITE directed relationship from source to target concept."""
        query = """
        MATCH (src:Concept {catalog_id: $catalog_id, name: $source_name})
        MATCH (tgt:Concept {catalog_id: $catalog_id, name: $target_name})
        MERGE (src)-[r:PREREQUISITE]->(tgt)
        RETURN r
        """
        params = {
            "catalog_id": catalog_id,
            "source_name": source_name.strip(),
            "target_name": target_name.strip()
        }
        self.query(query, params)

    # ── Bulk writes ──────────────────────────────────────────────────────────
    # Same Cypher as the two single-item methods above, but driven by UNWIND over
    # a parameter list so a whole approved revision is 2 statements instead of one
    # per concept and one per link.
    #
    # This is not a micro-optimisation. Neo4j here is Aura (neo4j+s://, hosted
    # region), and each self.query() opens its own session - measured at ~284ms
    # per round trip from this machine. A 79-concept / 117-link revision therefore
    # took 196 x 284ms = ~56 SECONDS, well past the frontend's 20s HTTP timeout,
    # so the coordinator saw "Failed to submit your decision" on a merge that was
    # actually still running and went on to succeed. Batched, the same merge is
    # two round trips.

    def create_concept_nodes_bulk(self, catalog_id: int, concepts: List[Dict[str, Any]]):
        """Merge many Concept nodes in a single statement. `concepts` items need
        name/description/difficulty/importance_score/learning_outcomes."""
        if not concepts:
            return
        query = """
        UNWIND $rows AS row
        MERGE (c:Concept {catalog_id: $catalog_id, name: row.name})
        ON CREATE SET c.description = row.description,
                      c.difficulty = row.difficulty,
                      c.importance_score = row.importance_score,
                      c.learning_outcomes = row.learning_outcomes,
                      c.material = row.material,
                      c.id = row.node_id
        ON MATCH SET  c.description = row.description,
                      c.difficulty = row.difficulty,
                      c.importance_score = row.importance_score,
                      c.learning_outcomes = row.learning_outcomes
        """
        rows = [
            {
                "name": c["name"].strip(),
                "description": (c.get("description") or "").strip(),
                "difficulty": c.get("difficulty", "Medium"),
                "importance_score": c.get("importance_score", 5),
                "learning_outcomes": c.get("learning_outcomes") or "",
                "material": c.get("material") or "",
                "node_id": build_node_id(catalog_id, c["name"]),
            }
            for c in concepts
        ]
        self.query(query, {"catalog_id": catalog_id, "rows": rows})

    def create_prerequisite_relationships_bulk(self, catalog_id: int, pairs: List[Dict[str, str]]):
        """Create many PREREQUISITE relationships in a single statement. `pairs`
        items need source_name/target_name. A pair naming a concept that doesn't
        exist is skipped by the MATCH, exactly as the single-item version is."""
        if not pairs:
            return
        query = """
        UNWIND $rows AS row
        MATCH (src:Concept {catalog_id: $catalog_id, name: row.source_name})
        MATCH (tgt:Concept {catalog_id: $catalog_id, name: row.target_name})
        MERGE (src)-[:PREREQUISITE]->(tgt)
        """
        rows = [
            {"source_name": p["source_name"].strip(), "target_name": p["target_name"].strip()}
            for p in pairs
        ]
        self.query(query, {"catalog_id": catalog_id, "rows": rows})

    def get_catalog_graph(self, catalog_id: int) -> Dict[str, List[Dict[str, Any]]]:
        """Fetch all concept nodes and their relationships shared by a catalog course."""
        self._ensure_connected()
        if not self.driver:
            return get_mock_graph_data(catalog_id)

        node_query = """
        MATCH (c:Concept {catalog_id: $catalog_id})
        RETURN c.id AS id, c.name AS name, c.description AS description,
               c.difficulty AS difficulty, c.catalog_id AS catalog_id,
               c.importance_score AS importance_score,
               c.learning_outcomes AS learning_outcomes,
               c.material AS material
        """
        nodes_res = self.query(node_query, {"catalog_id": catalog_id})

        rel_query = """
        MATCH (src:Concept {catalog_id: $catalog_id})-[r:PREREQUISITE]->(tgt:Concept {catalog_id: $catalog_id})
        RETURN src.id AS source, tgt.id AS target
        """
        edges_res = self.query(rel_query, {"catalog_id": catalog_id})

        return {
            "nodes": nodes_res,
            "edges": [{"id": f"{e['source']}->{e['target']}", "source": e["source"], "target": e["target"]} for e in edges_res]
        }

    def get_graph_stats(self, catalog_id: int) -> Dict[str, Any]:
        """Return analytics stats for a catalog course's shared graph."""
        self._ensure_connected()
        if not self.driver:
            return {"node_count": 0, "edge_count": 0, "easy_count": 0, "medium_count": 0, "hard_count": 0}

        node_query = """
        MATCH (c:Concept {catalog_id: $catalog_id})
        RETURN count(c) AS total,
               sum(CASE WHEN toLower(c.difficulty) = 'easy'   THEN 1 ELSE 0 END) AS easy_count,
               sum(CASE WHEN toLower(c.difficulty) = 'medium' THEN 1 ELSE 0 END) AS medium_count,
               sum(CASE WHEN toLower(c.difficulty) = 'hard'   THEN 1 ELSE 0 END) AS hard_count
        """
        edge_query = """
        MATCH (src:Concept {catalog_id: $catalog_id})-[r:PREREQUISITE]->(tgt:Concept {catalog_id: $catalog_id})
        RETURN count(r) AS total_edges
        """
        node_stats = self.query(node_query, {"catalog_id": catalog_id})
        edge_stats  = self.query(edge_query,  {"catalog_id": catalog_id})

        stats = node_stats[0] if node_stats else {}
        edges = edge_stats[0] if edge_stats else {}

        return {
            "node_count":   stats.get("total", 0),
            "edge_count":   edges.get("total_edges", 0),
            "easy_count":   stats.get("easy_count", 0),
            "medium_count": stats.get("medium_count", 0),
            "hard_count":   stats.get("hard_count", 0),
        }

    def search_concepts(self, catalog_id: int, query: str) -> List[Dict[str, Any]]:
        """Full-text search for concept nodes matching the query."""
        self._ensure_connected()
        if not self.driver:
            return []
        search_query = """
        MATCH (c:Concept {catalog_id: $catalog_id})
        WHERE toLower(c.name) CONTAINS toLower($q) OR toLower(c.description) CONTAINS toLower($q)
        RETURN c.id AS id, c.name AS name, c.difficulty AS difficulty, c.description AS description,
               c.material AS material
        ORDER BY c.importance_score DESC
        LIMIT 10
        """
        return self.query(search_query, {"catalog_id": catalog_id, "q": query})

    def delete_concept_node(self, catalog_id: int, node_id: str):
        """Delete a concept node and all connected relationships."""
        query = """
        MATCH (c:Concept {catalog_id: $catalog_id, id: $node_id})
        DETACH DELETE c
        """
        self.query(query, {"catalog_id": catalog_id, "node_id": node_id})

    def update_concept_node(self, catalog_id: int, node_id: str, name: str, description: str, difficulty: str,
                            material: Optional[str] = None):
        """Update properties of an existing concept node. `material` is only SET when
        explicitly provided, so a plain name/description/difficulty edit proposal never
        wipes out material that was generated/approved separately."""
        set_clauses = ["c.name = $name", "c.description = $description", "c.difficulty = $difficulty"]
        params = {
            "catalog_id": catalog_id,
            "node_id": node_id,
            "name": name,
            "description": description,
            "difficulty": difficulty,
        }
        if material is not None:
            set_clauses.append("c.material = $material")
            params["material"] = material
        query = f"""
        MATCH (c:Concept {{catalog_id: $catalog_id, id: $node_id}})
        SET {', '.join(set_clauses)}
        RETURN c
        """
        self.query(query, params)

    def update_concept_material(self, catalog_id: int, node_id: str, material: str):
        """Narrow, single-purpose setter for the detailed `material` field, used by the
        AI generate/edit-material approval path so those proposals don't need to carry
        name/description/difficulty just to update one field."""
        query = """
        MATCH (c:Concept {catalog_id: $catalog_id, id: $node_id})
        SET c.material = $material
        RETURN c
        """
        self.query(query, {"catalog_id": catalog_id, "node_id": node_id, "material": material})

    def delete_relationship(self, catalog_id: int, source_id: str, target_id: str):
        """Delete a specific relationship between two nodes."""
        query = """
        MATCH (src:Concept {catalog_id: $catalog_id, id: $source_id})-[r:PREREQUISITE]->(tgt:Concept {catalog_id: $catalog_id, id: $target_id})
        DELETE r
        """
        self.query(query, {"catalog_id": catalog_id, "source_id": source_id, "target_id": target_id})

    def get_existing_concept_names(self, catalog_id: int) -> List[str]:
        """Return all existing concept names for a catalog course (for deduplication)."""
        self._ensure_connected()
        if not self.driver:
            return []
        result = self.query(
            "MATCH (c:Concept {catalog_id: $catalog_id}) RETURN c.name AS name",
            {"catalog_id": catalog_id}
        )
        return [r["name"] for r in result]

    def get_concept_parents(self, catalog_id: int, node_id: str) -> List[Dict[str, Any]]:
        """Direct prerequisites of a concept - its 'parents' in teaching order.

        Edge direction in this schema is prerequisite -> dependent (see
        create_prerequisite_relationship), so a parent of X is the SOURCE of an edge
        pointing at X. Ordered by importance_score so a caller that only wants one
        parent gets the most foundational.

        Used by content generation's "generate for this concept's parent" action:
        when a student is failing X, the useful material is often about the thing X
        depends on, not about X again.
        """
        self._ensure_connected()
        if not self.driver:
            return []
        return self.query(
            """
            MATCH (parent:Concept {catalog_id: $catalog_id})-[:PREREQUISITE]->(c:Concept {catalog_id: $catalog_id, id: $node_id})
            RETURN parent.id AS id, parent.name AS name, parent.description AS description,
                   parent.difficulty AS difficulty, parent.importance_score AS importance_score
            ORDER BY parent.importance_score DESC, parent.name ASC
            """,
            {"catalog_id": catalog_id, "node_id": node_id},
        )

    def get_concept_children(self, catalog_id: int, node_id: str) -> List[Dict[str, Any]]:
        """Concepts that list this one as a prerequisite - the dependents."""
        self._ensure_connected()
        if not self.driver:
            return []
        return self.query(
            """
            MATCH (c:Concept {catalog_id: $catalog_id, id: $node_id})-[:PREREQUISITE]->(child:Concept {catalog_id: $catalog_id})
            RETURN child.id AS id, child.name AS name, child.description AS description,
                   child.difficulty AS difficulty, child.importance_score AS importance_score
            ORDER BY child.importance_score DESC, child.name ASC
            """,
            {"catalog_id": catalog_id, "node_id": node_id},
        )


# Initialize global Neo4j service instance
neo4j_service = Neo4jService()


# ─────────────────────────────────────────────
#  DEDUPLICATION HELPER
# ─────────────────────────────────────────────

def _normalize(name: str) -> str:
    """Normalize a concept name for fuzzy dedup comparison."""
    return re.sub(r'[^a-z0-9]', '', name.lower().strip())


def _find_existing_match(name: str, existing_names: List[str], threshold: int = 85) -> Optional[str]:
    """
    Try to find an existing concept name that is close enough to `name`.
    Uses simple normalized substring/prefix matching to avoid duplicates
    like 'Machine Learning' vs 'machine learning' vs 'Machine-Learning'.
    Returns the existing name if matched, else None.
    """
    norm_new = _normalize(name)
    if not norm_new:
        return None
    for existing in existing_names:
        norm_ex = _normalize(existing)
        if norm_ex == norm_new:
            return existing
        # Prefix match — handles abbreviations like 'OOP' vs 'Object-Oriented Programming'
        if len(norm_new) >= 4 and (norm_ex.startswith(norm_new) or norm_new.startswith(norm_ex)):
            return existing
    return None


# ─────────────────────────────────────────────
#  MOCK GRAPH (Neo4j offline fallback)
# ─────────────────────────────────────────────

def get_mock_graph_data(catalog_id: int) -> Dict[str, List[Dict[str, Any]]]:
    """Generates complete mock node/edge graph data when Neo4j is offline."""
    nodes = [
        {"id": f"{catalog_id}_fundamentals",    "name": "Fundamentals of Programming",   "description": "Variables, operations, control flows, and basic syntax elements.",                             "difficulty": "Easy",   "catalog_id": catalog_id, "importance_score": 9, "learning_outcomes": "Understand basic programming constructs."},
        {"id": f"{catalog_id}_functions",        "name": "Functions & Modularity",        "description": "Declaring functions, parameters, return types, and local/global scope.",                      "difficulty": "Easy",   "catalog_id": catalog_id, "importance_score": 8, "learning_outcomes": "Design modular, reusable functions."},
        {"id": f"{catalog_id}_oop_concepts",     "name": "Object-Oriented Design",        "description": "Classes, objects, attributes, methods, encapsulation, and access control.",                   "difficulty": "Medium", "catalog_id": catalog_id, "importance_score": 9, "learning_outcomes": "Implement OOP principles in code."},
        {"id": f"{catalog_id}_inheritance",      "name": "Inheritance & Polymorphism",    "description": "Deriving sub-classes, method overriding, super calls, and interface polymorphism.",           "difficulty": "Medium", "catalog_id": catalog_id, "importance_score": 7, "learning_outcomes": "Apply inheritance for code reuse."},
        {"id": f"{catalog_id}_data_structures",  "name": "Basic Data Structures",         "description": "Arrays, Lists, Maps, Queues, Stacks, and introductory complexity analysis.",                 "difficulty": "Hard",   "catalog_id": catalog_id, "importance_score": 8, "learning_outcomes": "Select appropriate data structures for problems."},
        {"id": f"{catalog_id}_algorithms",       "name": "Sorting & Searching Algorithms","description": "Bubble sort, merge sort, binary search, and Big-O notation fundamentals.",                   "difficulty": "Hard",   "catalog_id": catalog_id, "importance_score": 7, "learning_outcomes": "Analyze algorithm efficiency using Big-O."},
    ]
    edges = [
        {"id": f"{catalog_id}_fund->func",      "source": f"{catalog_id}_fundamentals",   "target": f"{catalog_id}_functions"},
        {"id": f"{catalog_id}_func->oop",       "source": f"{catalog_id}_functions",       "target": f"{catalog_id}_oop_concepts"},
        {"id": f"{catalog_id}_oop->inherit",    "source": f"{catalog_id}_oop_concepts",    "target": f"{catalog_id}_inheritance"},
        {"id": f"{catalog_id}_oop->ds",         "source": f"{catalog_id}_oop_concepts",    "target": f"{catalog_id}_data_structures"},
        {"id": f"{catalog_id}_ds->algo",        "source": f"{catalog_id}_data_structures", "target": f"{catalog_id}_algorithms"},
    ]
    return {"nodes": nodes, "edges": edges}
