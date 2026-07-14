import os
import certifi

os.environ["SSL_CERT_FILE"] = certifi.where()

from neo4j import GraphDatabase

uri = "neo4j+s://850736f6.databases.neo4j.io"
auth = ("850736f6", "DFvpq5AL2kj2xG3lc_jYYjNssBbER4U5mncB_0eEeRs")

driver = GraphDatabase.driver(
    uri,
    auth=auth
)

driver.verify_connectivity()
print("Connected!")
