"""
Airflow DAG for the ConceptIntel content-processing pipeline.

Triggered on demand (never on a schedule) by the FastAPI backend
(app/content_processing/routes.py -> POST /api/content-processing/trigger/{course_id})
via Airflow's REST API, passing {"conf": {"job_id": <GraphBuildJob.id>}}.

Each task is a thin wrapper around a function in
backend/app/content_processing/pipeline_service.py - the DAG imports and runs the
exact same code the FastAPI BackgroundTasks fallback uses, so behavior is identical
whether or not Airflow is set up.

Stops after diff_and_propose: the resulting GraphRevision sits at
"PendingTeacherReview". Teacher review and coordinator approval happen through
ordinary FastAPI endpoints (not Airflow tasks), since they can take hours/days and
shouldn't hold an Airflow worker slot open.
"""
from __future__ import annotations

import sys
from datetime import datetime

from airflow import DAG
from airflow.operators.python import PythonOperator

# The backend/ directory is mounted into the Airflow containers at this path
# (see docker-compose.yaml) so these tasks can `import app.*` directly.
sys.path.insert(0, "/opt/airflow/backend")


def _extract_text(**context):
    """Airflow task 1: gathers the extracted text for the job (passed as dag_run.conf["job_id"]); result goes to XCom."""
    from app.content_processing.pipeline_service import stage_extract_text
    job_id = context["dag_run"].conf["job_id"]
    return stage_extract_text(job_id)


def _clean_and_structure(**context):
    """Airflow task 2: reads task 1's text from XCom and runs AI cleaning/concept extraction."""
    from app.content_processing.pipeline_service import stage_clean_and_structure
    job_id = context["dag_run"].conf["job_id"]
    combined_text = context["ti"].xcom_pull(task_ids="extract_text")
    return stage_clean_and_structure(job_id, combined_text)


def _diff_and_propose(**context):
    """Airflow task 3: reads task 2's extractions from XCom, diffs them against the live graph and saves the revision for review."""
    from app.content_processing.pipeline_service import stage_diff_and_propose
    job_id = context["dag_run"].conf["job_id"]
    chunk_extractions = context["ti"].xcom_pull(task_ids="clean_and_structure")
    return stage_diff_and_propose(job_id, chunk_extractions)


# DAG definition: three PythonOperator tasks chained extract_text >> clean_and_structure >> diff_and_propose.
# schedule=None because the backend triggers it on demand through the REST API.
with DAG(
    dag_id="content_graph_pipeline",
    description="OCR'd text -> AI cleaning/structuring -> diff against the shared catalog graph",
    start_date=datetime(2026, 1, 1),
    schedule=None,
    catchup=False,
    max_active_runs=5,
    tags=["conceptintel"],
) as dag:
    extract_text = PythonOperator(task_id="extract_text", python_callable=_extract_text)
    clean_and_structure = PythonOperator(task_id="clean_and_structure", python_callable=_clean_and_structure)
    diff_and_propose = PythonOperator(task_id="diff_and_propose", python_callable=_diff_and_propose)

    extract_text >> clean_and_structure >> diff_and_propose
