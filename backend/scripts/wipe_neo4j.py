"""One-off script: delete every node and relationship in the Neo4j graph database
(all Concept nodes across every catalog course, and their PREREQUISITE edges).
Irreversible.

Run from `backend/` with the project's virtualenv:

    backend\\.venv\\Scripts\\python.exe scripts\\wipe_neo4j.py
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from neo4j import GraphDatabase
from app.config import settings


def main():
    """Deletes every node and relationship in the Neo4j graph (irreversible)."""
    parser = argparse.ArgumentParser(description="Delete every node/relationship in Neo4j.")
    parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")
    args = parser.parse_args()

    driver = GraphDatabase.driver(settings.NEO4J_URI, auth=(settings.NEO4J_USERNAME, settings.NEO4J_PASSWORD))
    try:
        with driver.session() as session:
            counts = session.run("MATCH (n) RETURN count(n) AS node_count").single()
            print(f"Found {counts['node_count']} node(s) in the graph.")

            if not args.yes:
                confirm = input("This will PERMANENTLY delete every node/relationship in Neo4j. Type 'yes' to continue: ")
                if confirm.strip().lower() != "yes":
                    print("Aborted.")
                    return

            session.run("MATCH (n) DETACH DELETE n")
            print("Neo4j graph wiped.")
    finally:
        driver.close()


if __name__ == "__main__":
    main()
