import re
import json
import logging
from typing import List, Dict, Any, Optional
from neo4j import GraphDatabase
from openai import OpenAI

from app.config import settings
from app.upload.services import chunk_text
import os
import certifi

os.environ["SSL_CERT_FILE"] = certifi.where()

logger = logging.getLogger("conceptintel.graph")


class Neo4jService:
    def __init__(self):
        self.driver = None
        try:
            self.driver = GraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USERNAME, settings.NEO4J_PASSWORD)
            )
            self.driver.verify_connectivity()
            logger.info("Successfully connected to Neo4j database")
        except Exception as e:
            logger.error(f"Failed to connect to Neo4j database: {str(e)}")

    def close(self):
        if self.driver:
            self.driver.close()

    def get_session(self):
        if not self.driver:
            raise ConnectionError("Neo4j database connection is not available.")
        return self.driver.session()

    def query(self, query_str: str, parameters: Dict[str, Any] = None):
        """Execute a general Cypher query."""
        if not self.driver:
            logger.warning("Neo4j not connected. Mocking query execution.")
            return []
        with self.get_session() as session:
            result = session.run(query_str, parameters or {})
            return [record.data() for record in result]

    def create_concept_node(self, course_id: int, name: str, description: str, difficulty: str,
                            importance_score: int = 5, learning_outcomes: str = ""):
        """Merge/Create a Concept node in the graph with extended properties."""
        query = """
        MERGE (c:Concept {course_id: $course_id, name: $name})
        ON CREATE SET c.description = $description,
                      c.difficulty = $difficulty,
                      c.importance_score = $importance_score,
                      c.learning_outcomes = $learning_outcomes,
                      c.id = $node_id
        ON MATCH SET  c.description = $description,
                      c.difficulty = $difficulty,
                      c.importance_score = $importance_score,
                      c.learning_outcomes = $learning_outcomes
        RETURN c
        """
        node_id = f"{course_id}_{name.lower().strip().replace(' ', '_')}"
        params = {
            "course_id": course_id,
            "name": name.strip(),
            "description": description.strip(),
            "difficulty": difficulty,
            "importance_score": importance_score,
            "learning_outcomes": learning_outcomes,
            "node_id": node_id
        }
        self.query(query, params)

    def create_prerequisite_relationship(self, course_id: int, source_name: str, target_name: str):
        """Create a PREREQUISITE directed relationship from source to target concept."""
        query = """
        MATCH (src:Concept {course_id: $course_id, name: $source_name})
        MATCH (tgt:Concept {course_id: $course_id, name: $target_name})
        MERGE (src)-[r:PREREQUISITE]->(tgt)
        RETURN r
        """
        params = {
            "course_id": course_id,
            "source_name": source_name.strip(),
            "target_name": target_name.strip()
        }
        self.query(query, params)

    def get_course_graph(self, course_id: int) -> Dict[str, List[Dict[str, Any]]]:
        """Fetch all concept nodes and their relationships for a course."""
        if not self.driver:
            return get_mock_graph_data(course_id)

        node_query = """
        MATCH (c:Concept {course_id: $course_id})
        RETURN c.id AS id, c.name AS name, c.description AS description,
               c.difficulty AS difficulty, c.course_id AS course_id,
               c.importance_score AS importance_score,
               c.learning_outcomes AS learning_outcomes
        """
        nodes_res = self.query(node_query, {"course_id": course_id})

        rel_query = """
        MATCH (src:Concept {course_id: $course_id})-[r:PREREQUISITE]->(tgt:Concept {course_id: $course_id})
        RETURN src.id AS source, tgt.id AS target
        """
        edges_res = self.query(rel_query, {"course_id": course_id})

        return {
            "nodes": nodes_res,
            "edges": [{"id": f"{e['source']}->{e['target']}", "source": e["source"], "target": e["target"]} for e in edges_res]
        }

    def get_graph_stats(self, course_id: int) -> Dict[str, Any]:
        """Return analytics stats for a course graph."""
        if not self.driver:
            return {"node_count": 0, "edge_count": 0, "easy_count": 0, "medium_count": 0, "hard_count": 0}

        node_query = """
        MATCH (c:Concept {course_id: $course_id})
        RETURN count(c) AS total,
               sum(CASE WHEN toLower(c.difficulty) = 'easy'   THEN 1 ELSE 0 END) AS easy_count,
               sum(CASE WHEN toLower(c.difficulty) = 'medium' THEN 1 ELSE 0 END) AS medium_count,
               sum(CASE WHEN toLower(c.difficulty) = 'hard'   THEN 1 ELSE 0 END) AS hard_count
        """
        edge_query = """
        MATCH (src:Concept {course_id: $course_id})-[r:PREREQUISITE]->(tgt:Concept {course_id: $course_id})
        RETURN count(r) AS total_edges
        """
        node_stats = self.query(node_query, {"course_id": course_id})
        edge_stats  = self.query(edge_query,  {"course_id": course_id})

        stats = node_stats[0] if node_stats else {}
        edges = edge_stats[0] if edge_stats else {}

        return {
            "node_count":   stats.get("total", 0),
            "edge_count":   edges.get("total_edges", 0),
            "easy_count":   stats.get("easy_count", 0),
            "medium_count": stats.get("medium_count", 0),
            "hard_count":   stats.get("hard_count", 0),
        }

    def search_concepts(self, course_id: int, query: str) -> List[Dict[str, Any]]:
        """Full-text search for concept nodes matching the query."""
        if not self.driver:
            return []
        search_query = """
        MATCH (c:Concept {course_id: $course_id})
        WHERE toLower(c.name) CONTAINS toLower($q) OR toLower(c.description) CONTAINS toLower($q)
        RETURN c.id AS id, c.name AS name, c.difficulty AS difficulty, c.description AS description
        ORDER BY c.importance_score DESC
        LIMIT 10
        """
        return self.query(search_query, {"course_id": course_id, "q": query})

    def delete_concept_node(self, course_id: int, node_id: str):
        """Delete a concept node and all connected relationships."""
        query = """
        MATCH (c:Concept {course_id: $course_id, id: $node_id})
        DETACH DELETE c
        """
        self.query(query, {"course_id": course_id, "node_id": node_id})

    def update_concept_node(self, course_id: int, node_id: str, name: str, description: str, difficulty: str):
        """Update properties of an existing concept node."""
        query = """
        MATCH (c:Concept {course_id: $course_id, id: $node_id})
        SET c.name = $name, c.description = $description, c.difficulty = $difficulty
        RETURN c
        """
        self.query(query, {
            "course_id": course_id,
            "node_id": node_id,
            "name": name,
            "description": description,
            "difficulty": difficulty
        })

    def delete_relationship(self, course_id: int, source_id: str, target_id: str):
        """Delete a specific relationship between two nodes."""
        query = """
        MATCH (src:Concept {course_id: $course_id, id: $source_id})-[r:PREREQUISITE]->(tgt:Concept {course_id: $course_id, id: $target_id})
        DELETE r
        """
        self.query(query, {"course_id": course_id, "source_id": source_id, "target_id": target_id})

    def get_existing_concept_names(self, course_id: int) -> List[str]:
        """Return all existing concept names for a course (for deduplication)."""
        if not self.driver:
            return []
        result = self.query(
            "MATCH (c:Concept {course_id: $course_id}) RETURN c.name AS name",
            {"course_id": course_id}
        )
        return [r["name"] for r in result]


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
#  CONCEPT EXTRACTION PIPELINE
# ─────────────────────────────────────────────

def trigger_concept_extraction(course_id: int, text: str):
    """
    Processes document text: chunks it and uses OpenAI to extract concepts.
    All chunks are processed (not just 5), with deduplication between chunks.
    """
    if not text.strip():
        logger.warning(f"Empty text for course {course_id}. Skipping extraction.")
        return

    chunks = chunk_text(text, chunk_size=3000, overlap=400)
    logger.info(f"Processing {len(chunks)} chunks for course {course_id}")

    # Load existing concepts for dedup across all chunks
    existing_names: List[str] = neo4j_service.get_existing_concept_names(course_id)

    for i, chunk in enumerate(chunks):
        logger.info(f"Extracting concepts from chunk {i+1}/{len(chunks)} for course {course_id}...")
        try:
            extracted = extract_concepts_from_chunk_ai(chunk)
            save_extracted_concepts_to_graph(course_id, extracted, existing_names)
        except Exception as e:
            logger.error(f"Failed to extract from chunk {i+1}: {str(e)}")


def extract_concepts_from_chunk_ai(chunk: str) -> Dict[str, Any]:
    """
    Calls OpenAI API with an enhanced academic prompt to extract structured concepts.
    Includes importance_score, learning_outcomes, and close-plot deduplication guidance.
    """
    if not settings.OPENAI_API_KEY or settings.OPENAI_API_KEY.startswith("your_"):
        logger.warning("OpenAI API Key not configured. Using offline fallback parser.")
        return get_offline_mock_extraction(chunk)

    try:
        client = OpenAI(api_key=settings.OPENAI_API_KEY)

        system_prompt = """You are a senior academic curriculum architect and learning engineer.

Your task is to extract distinct, academically meaningful concepts from the provided educational content.

IMPORTANT RULES:
1. Extract ONLY substantive educational concepts — not generic terms like "Introduction", "Summary", or "Example".
2. Avoid near-duplicate concepts — if two concepts are closely related (e.g., "Machine Learning" and "ML Basics"), merge them into the more descriptive one.
3. Each concept must be a complete, learnable unit of knowledge.
4. Prerequisites must ONLY reference other concepts extracted in this same response.
5. Assign importance_score from 1 (minor) to 10 (foundational/critical) based on how central the concept is.

Respond ONLY with valid JSON in this exact format:
{
  "concepts": [
    {
      "name": "Concept Name",
      "description": "Precise 1-2 sentence explanation of what this concept covers",
      "difficulty": "Easy|Medium|Hard",
      "importance_score": 7,
      "learning_outcomes": "After studying this, students will be able to...",
      "prerequisites": ["Prerequisite Concept Name 1"]
    }
  ]
}"""

        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Analyze this educational content and extract concepts:\n\n{chunk}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.15,   # Lower temp → more consistent, less hallucination
            max_tokens=2000
        )

        data = json.loads(response.choices[0].message.content)
        return data

    except Exception as e:
        logger.error(f"OpenAI API call failed: {str(e)}. Falling back to offline extraction.")
        return get_offline_mock_extraction(chunk)


def save_extracted_concepts_to_graph(
    course_id: int,
    extraction_result: Dict[str, Any],
    existing_names: List[str]
):
    """
    Stores concepts and prerequisite links into Neo4j with deduplication.
    Updates `existing_names` list in-place so subsequent chunks benefit too.
    """
    concepts = extraction_result.get("concepts", [])
    if not concepts:
        return

    # Phase 1: Create concept nodes (with dedup)
    name_mapping: Dict[str, str] = {}   # Maps extracted name → canonical stored name

    for concept in concepts:
        raw_name = concept.get("name", "").strip()
        if not raw_name:
            continue

        # Check if a close-enough name already exists
        matched = _find_existing_match(raw_name, existing_names)
        if matched:
            logger.debug(f"Dedup: '{raw_name}' → merged into existing '{matched}'")
            name_mapping[raw_name] = matched
            continue

        # New concept — store it
        canonical_name = raw_name
        name_mapping[raw_name] = canonical_name

        neo4j_service.create_concept_node(
            course_id=course_id,
            name=canonical_name,
            description=concept.get("description", "")[:500],
            difficulty=concept.get("difficulty", "Medium"),
            importance_score=concept.get("importance_score", 5),
            learning_outcomes=concept.get("learning_outcomes", "")[:300],
        )
        existing_names.append(canonical_name)

    # Phase 2: Create prerequisite relationships
    for concept in concepts:
        raw_name = concept.get("name", "").strip()
        target_canonical = name_mapping.get(raw_name)
        if not target_canonical:
            continue

        for prereq_raw in concept.get("prerequisites", []):
            prereq_canonical = name_mapping.get(prereq_raw)
            if not prereq_canonical:
                # Try to find a close match in all known names
                prereq_canonical = _find_existing_match(prereq_raw, existing_names)
            if prereq_canonical and prereq_canonical != target_canonical:
                neo4j_service.create_prerequisite_relationship(
                    course_id, prereq_canonical, target_canonical
                )


# ─────────────────────────────────────────────
#  OFFLINE FALLBACK EXTRACTION
# ─────────────────────────────────────────────

def get_offline_mock_extraction(chunk: str) -> Dict[str, Any]:
    """
    Generates structured mock concepts from text using regex pattern matching.
    Used when OpenAI API is unavailable.
    """
    # Find capitalized multi-word phrases (likely academic terms)
    words = re.findall(r'\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b', chunk)
    blacklist = {
        "The", "A", "An", "And", "Or", "But", "This", "For", "With", "By",
        "To", "From", "In", "On", "At", "Of", "Is", "Are", "Was", "Were",
        "That", "These", "Those", "Which", "When", "Where", "Figure", "Table",
        "Section", "Chapter", "Example", "Note", "Summary", "Introduction"
    }
    keywords = list(dict.fromkeys([w for w in words if w not in blacklist and len(w) > 5]))[:8]

    if not keywords:
        keywords = ["Core Principles", "Fundamental Concepts", "Advanced Theory", "Practical Methods"]

    concepts = []
    for i, kw in enumerate(keywords):
        # Pull a sentence from the chunk mentioning this keyword
        sentence = f"Core concept covering the details and application of {kw} within the course curriculum."
        for line in chunk.split("."):
            if kw in line and len(line.strip()) > 20:
                sentence = line.strip() + "."
                break

        difficulty = "Easy" if i == 0 else "Hard" if i >= len(keywords) - 2 else "Medium"
        importance = max(1, 10 - i)
        prerequisites = [keywords[i - 1]] if i > 0 else []

        concepts.append({
            "name": kw,
            "description": sentence[:300],
            "difficulty": difficulty,
            "importance_score": importance,
            "learning_outcomes": f"Students will understand and apply {kw} in relevant contexts.",
            "prerequisites": prerequisites
        })

    return {"concepts": concepts}


# ─────────────────────────────────────────────
#  MOCK GRAPH (Neo4j offline fallback)
# ─────────────────────────────────────────────

def get_mock_graph_data(course_id: int) -> Dict[str, List[Dict[str, Any]]]:
    """Generates complete mock node/edge graph data when Neo4j is offline."""
    nodes = [
        {"id": f"{course_id}_fundamentals",    "name": "Fundamentals of Programming",   "description": "Variables, operations, control flows, and basic syntax elements.",                             "difficulty": "Easy",   "course_id": course_id, "importance_score": 9, "learning_outcomes": "Understand basic programming constructs."},
        {"id": f"{course_id}_functions",        "name": "Functions & Modularity",        "description": "Declaring functions, parameters, return types, and local/global scope.",                      "difficulty": "Easy",   "course_id": course_id, "importance_score": 8, "learning_outcomes": "Design modular, reusable functions."},
        {"id": f"{course_id}_oop_concepts",     "name": "Object-Oriented Design",        "description": "Classes, objects, attributes, methods, encapsulation, and access control.",                   "difficulty": "Medium", "course_id": course_id, "importance_score": 9, "learning_outcomes": "Implement OOP principles in code."},
        {"id": f"{course_id}_inheritance",      "name": "Inheritance & Polymorphism",    "description": "Deriving sub-classes, method overriding, super calls, and interface polymorphism.",           "difficulty": "Medium", "course_id": course_id, "importance_score": 7, "learning_outcomes": "Apply inheritance for code reuse."},
        {"id": f"{course_id}_data_structures",  "name": "Basic Data Structures",         "description": "Arrays, Lists, Maps, Queues, Stacks, and introductory complexity analysis.",                 "difficulty": "Hard",   "course_id": course_id, "importance_score": 8, "learning_outcomes": "Select appropriate data structures for problems."},
        {"id": f"{course_id}_algorithms",       "name": "Sorting & Searching Algorithms","description": "Bubble sort, merge sort, binary search, and Big-O notation fundamentals.",                   "difficulty": "Hard",   "course_id": course_id, "importance_score": 7, "learning_outcomes": "Analyze algorithm efficiency using Big-O."},
    ]
    edges = [
        {"id": f"{course_id}_fund->func",      "source": f"{course_id}_fundamentals",   "target": f"{course_id}_functions"},
        {"id": f"{course_id}_func->oop",       "source": f"{course_id}_functions",       "target": f"{course_id}_oop_concepts"},
        {"id": f"{course_id}_oop->inherit",    "source": f"{course_id}_oop_concepts",    "target": f"{course_id}_inheritance"},
        {"id": f"{course_id}_oop->ds",         "source": f"{course_id}_oop_concepts",    "target": f"{course_id}_data_structures"},
        {"id": f"{course_id}_ds->algo",        "source": f"{course_id}_data_structures", "target": f"{course_id}_algorithms"},
    ]
    return {"nodes": nodes, "edges": edges}
