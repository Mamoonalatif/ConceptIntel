"""
One-off cleanup: backfill Neo4j Concept.catalog_id where it's NULL.

Found live: some Concept nodes have catalog_id set to NULL even though their
`id` property correctly encodes it (build_node_id(catalog_id, name) ==
f"{catalog_id}_{name...}" - see app/knowledge_graph/services.py). Every graph
query in that file filters by the catalog_id PROPERTY
(`MATCH (c:Concept {catalog_id: $catalog_id})`), so these nodes were completely
invisible to the app - get_graph_stats/get_catalog_graph silently showed 0/
incomplete results for affected catalogs even though real extracted data
existed in Neo4j.

This is leftover legacy data, not an active bug: the current node-creation
code (MERGE (c:Concept {catalog_id: $catalog_id, name: $name}), services.py)
sets catalog_id as part of the MERGE pattern itself, so a node created by
today's code can never end up with a null value. This script only needs to
run once, to clean up nodes that predate that guarantee.

Run it from the `backend/` directory with the project's virtualenv:

    backend\\.venv\\Scripts\\python.exe scripts\\backfill_concept_catalog_id.py

Safe to run more than once - a node with no matching id-prefix pattern (or
whose catalog_id is already set) is left untouched.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.knowledge_graph.services import neo4j_service

ID_PREFIX_RE = re.compile(r"^(\d+)_")


def main():
    neo4j_service._ensure_connected()
    if not neo4j_service.driver:
        print("Could not connect to Neo4j - aborting.")
        return

    with neo4j_service.get_session() as session:
        result = session.run(
            "MATCH (c:Concept) WHERE c.catalog_id IS NULL RETURN c.id AS id"
        )
        rows = [r["id"] for r in result]

        print(f"Found {len(rows)} Concept node(s) with catalog_id IS NULL.")

        updates_by_catalog = {}
        unparseable = []
        for node_id in rows:
            match = ID_PREFIX_RE.match(node_id)
            if not match:
                unparseable.append(node_id)
                continue
            catalog_id = int(match.group(1))
            updates_by_catalog.setdefault(catalog_id, []).append(node_id)

        if unparseable:
            print(f"WARNING: {len(unparseable)} node(s) have no parseable catalog_id "
                  f"prefix in their id and were left untouched: {unparseable[:10]}"
                  + (" ..." if len(unparseable) > 10 else ""))

        total_updated = 0
        for catalog_id, node_ids in sorted(updates_by_catalog.items()):
            res = session.run(
                """
                MATCH (c:Concept) WHERE c.id IN $ids AND c.catalog_id IS NULL
                SET c.catalog_id = $catalog_id
                RETURN count(c) AS updated
                """,
                {"ids": node_ids, "catalog_id": catalog_id},
            )
            updated = res.single()["updated"]
            total_updated += updated
            print(f"catalog_id={catalog_id}: backfilled {updated} node(s)")

        print(f"Done. Backfilled {total_updated} node(s) total.")


if __name__ == "__main__":
    main()
