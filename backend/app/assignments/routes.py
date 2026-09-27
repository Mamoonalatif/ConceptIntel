import threading
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database.connection import get_db, SessionLocal
import json
from app.database.models import (
    Assignment, AssignmentSubmission, Course, User, Rubric, RubricCriterion, CLO, CLOAttainment, CLOAttainmentEvidence,
)
from app.assignments.schemas import (
    AssignmentResponse, AssignmentUpdate, SubmissionSummary, SubmissionResponse, ManualGradeUpdate,
    RubricSaveRequest, RubricOut, RubricCriterionOut,
)
from app.auth.routes import get_current_user, get_current_teacher, get_current_student
from app.courses.access import assert_course_access
from app.upload.services import store_file, download_stored_file, delete_stored_file, get_content_type
from app.notifications.service import create_notification, notify_course_students
from app.notifications.types import NotificationType
from app.notifications.ai_summary import generate_posting_summary
from app.assignments import grading_service, rubric_service
from app.knowledge_graph.services import neo4j_service, build_node_id
from app.mastery import service as mastery_service
from app.gamification import service as gamification_service
from app.outcomes import services as outcomes_service

router = APIRouter(prefix="/courses", tags=["Assignments"])

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".pptx", ".ppt", ".txt", ".zip", ".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _notify_assignment_posted_background(course_id: int, assignment_id: int) -> None:
    """Runs off the request thread - see the call site in create_assignment for
    why (an inline LLM call there made every "Post Assignment" click wait on it).

    Split into two short-lived DB sessions around the LLM call rather than one
    long-lived one held open across it: generate_posting_summary can take up to
    60 seconds (3 retries), and a pooled connection checked out for that whole
    window - multiplied by however many teachers post something around the same
    time - is exactly the kind of thing that starves the pool for every OTHER
    request the app is serving, unrelated ones included. Fetching first, closing,
    then reopening only to write keeps each checkout down to milliseconds."""
    bg_db = SessionLocal()
    try:
        course = bg_db.query(Course).filter(Course.id == course_id).first()
        assignment = bg_db.query(Assignment).filter(Assignment.id == assignment_id).first()
        if not course or not assignment:
            return
        due_str = f" Due {assignment.due_date.strftime('%b %d, %Y %I:%M %p')}." if assignment.due_date else ""
        points_str = f" Worth {assignment.points} points." if assignment.points else ""
        content = f"Posted in {course.name}.{due_str}{points_str} {assignment.description or ''}".strip()
        title = assignment.title
    finally:
        bg_db.close()

    try:
        summary = generate_posting_summary("assignment", title, content)
        bg_db = SessionLocal()
        try:
            notify_course_students(
                bg_db, course_id, NotificationType.ASSIGNMENT_POSTED,
                title=f"New assignment: {title}",
                message=summary,
                link=f"/course/{course_id}",
            )
        finally:
            bg_db.close()
    except Exception as e:
        print(f"Warning: failed to create assignment notifications: {str(e)}")


def _read_and_validate_upload(file: UploadFile) -> tuple[bytes, str, str]:
    extension = Path(file.filename).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Supported formats: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )
    content = file.file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File exceeds the 25MB size limit.")
    return content, extension, Path(file.filename).name


def _to_response(a: Assignment, current_user: User, is_oversight: bool) -> AssignmentResponse:
    my_submission = None
    submission_count = None

    if current_user.role.lower() == "student":
        sub = next((s for s in a.submissions if s.student_id == current_user.id), None)
        if sub:
            my_submission = SubmissionSummary.model_validate(sub)
    if is_oversight or a.teacher_id == current_user.id:
        submission_count = len(a.submissions)

    return AssignmentResponse(
        id=a.id, course_id=a.course_id, teacher_id=a.teacher_id,
        teacher_name=a.teacher.full_name if a.teacher else None,
        title=a.title, description=a.description, due_date=a.due_date, points=a.points,
        attachment_filename=a.attachment_filename,
        created_at=a.created_at, updated_at=a.updated_at,
        my_submission=my_submission, submission_count=submission_count,
    )


@router.get("/{course_id}/assignments", response_model=List[AssignmentResponse])
def list_assignments(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    is_oversight = current_user.role.lower() in ("admin", "program_coordinator", "course_coordinator")

    assignments = (
        db.query(Assignment)
        .filter(Assignment.course_id == course_id)
        .order_by(Assignment.due_date.is_(None), Assignment.due_date.asc(), Assignment.created_at.desc())
        .all()
    )
    return [_to_response(a, current_user, is_oversight) for a in assignments]


@router.post("/{course_id}/assignments", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
def create_assignment(
    course_id: int,
    title: str = Form(...),
    description: Optional[str] = Form(None),
    due_date: Optional[datetime] = Form(None),
    points: Optional[int] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    course = _get_course_or_404(db, course_id)
    if course.teacher_id != current_teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course.")

    attachment_url = None
    attachment_filename = None
    if file is not None and file.filename:
        content, extension, safe_filename = _read_and_validate_upload(file)
        attachment_url = store_file(content, safe_filename, extension, f"assignments/{course_id}")
        attachment_filename = safe_filename

    assignment = Assignment(
        course_id=course_id, teacher_id=current_teacher.id, title=title, description=description,
        due_date=due_date, points=points, attachment_url=attachment_url, attachment_filename=attachment_filename,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    # AI-writes the notification summary, then fans it out to every enrolled
    # student - both best-effort (never blocks a successful post) and, more
    # importantly, both SLOW: generate_posting_summary is a real LLM call that
    # can easily take a second or more. This used to run inline, right here,
    # before the response was returned - so clicking "Post Assignment" sat
    # waiting on an AI call it never even saw the result of. Backgrounded now
    # (same pattern as the Supabase-link fix in auth/routes.py): the teacher's
    # button returns the instant the assignment is saved, and the notification
    # lands a moment later.
    threading.Thread(target=_notify_assignment_posted_background, args=(course_id, assignment.id), daemon=True).start()

    return _to_response(assignment, current_teacher, is_oversight=True)


def _get_owned_assignment(db: Session, course_id: int, assignment_id: int, teacher_id: int) -> Assignment:
    assignment = (
        db.query(Assignment)
        .filter(Assignment.id == assignment_id, Assignment.course_id == course_id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    if assignment.teacher_id != teacher_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only manage your own assignments.")
    return assignment


@router.patch("/{course_id}/assignments/{assignment_id}", response_model=AssignmentResponse)
def update_assignment(
    course_id: int,
    assignment_id: int,
    payload: AssignmentUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    assignment = _get_owned_assignment(db, course_id, assignment_id, current_teacher.id)
    if payload.title is not None:
        assignment.title = payload.title
    if payload.description is not None:
        assignment.description = payload.description
    if payload.due_date is not None:
        assignment.due_date = payload.due_date
    if payload.points is not None:
        assignment.points = payload.points
    assignment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assignment)
    return _to_response(assignment, current_teacher, is_oversight=True)


def _rubric_to_out(rubric: Rubric, db: Session) -> RubricOut:
    clo_codes = {c.id: c.code for c in db.query(CLO).filter(
        CLO.id.in_([c.clo_id for c in rubric.criteria if c.clo_id])
    ).all()} if rubric.criteria else {}
    criteria = [
        RubricCriterionOut(
            id=c.id, title=c.title, description=c.description, max_points=c.max_points,
            clo_id=c.clo_id, clo_code=clo_codes.get(c.clo_id), order_index=c.order_index,
        )
        for c in rubric.criteria
    ]
    return RubricOut(
        id=rubric.id, assignment_id=rubric.assignment_id, status=rubric.status,
        criteria=criteria, total_points=sum(c.max_points for c in criteria),
        created_at=rubric.created_at, updated_at=rubric.updated_at,
    )


@router.post("/{course_id}/assignments/{assignment_id}/rubric/generate", response_model=RubricOut, status_code=status.HTTP_201_CREATED)
def generate_rubric(
    course_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """AI-drafts a rubric from the assignment brief, the course's concepts/CLOs, and
    retrieved course material - saved immediately as a "Draft" rubric so the
    teacher can review/edit real criterion rows (see PUT below) rather than a
    throwaway preview object with no ids to edit against. Calling this again on an
    assignment that already has a rubric REPLACES its criteria with a fresh draft -
    the previous ones are gone, same as regenerating any other AI draft in this app."""
    course = _get_course_or_404(db, course_id)
    assignment = _get_owned_assignment(db, course_id, assignment_id, current_teacher.id)

    concepts: list[dict] = []
    clos: list[dict] = []
    if course.catalog_id:
        graph = neo4j_service.get_catalog_graph(course.catalog_id)
        concepts = [{"name": n["name"], "description": n.get("description") or ""} for n in graph.get("nodes", [])]
        clos = [
            {"code": c.code, "title": c.title}
            for c in db.query(CLO).filter(CLO.catalog_id == course.catalog_id).order_by(CLO.code.asc()).all()
        ]

    course_material = ""
    try:
        from app.rag.retrieval import retrieve, format_excerpts
        hits = retrieve(db, course.id, f"{assignment.title}. {assignment.description or ''}", top_k=6)
        course_material = format_excerpts(hits)
    except Exception as e:
        print(f"Warning: retrieval failed while drafting rubric for assignment {assignment.id}: {str(e)}")

    try:
        draft = rubric_service.generate_rubric_draft(
            assignment.title, assignment.description, float(assignment.points or 100),
            concepts, clos, course_material=course_material,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))

    clo_by_code = {c.code: c.id for c in db.query(CLO).filter(CLO.catalog_id == course.catalog_id).all()} if course.catalog_id else {}

    rubric = db.query(Rubric).filter(Rubric.assignment_id == assignment_id).first()
    if rubric:
        rubric.criteria.clear()
        rubric.status = "Draft"
    else:
        rubric = Rubric(assignment_id=assignment_id, created_by_id=current_teacher.id, status="Draft")
        db.add(rubric)
    db.flush()

    for i, c in enumerate(draft["criteria"]):
        db.add(RubricCriterion(
            rubric_id=rubric.id, title=c["title"], description=c.get("description"),
            max_points=c["max_points"], clo_id=clo_by_code.get(c.get("clo_code")), order_index=i,
        ))
    db.commit()
    db.refresh(rubric)
    return _rubric_to_out(rubric, db)


@router.get("/{course_id}/assignments/{assignment_id}/rubric", response_model=RubricOut)
def get_rubric(
    course_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    rubric = db.query(Rubric).filter(Rubric.assignment_id == assignment_id).first()
    if not rubric:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This assignment has no rubric yet.")
    return _rubric_to_out(rubric, db)


@router.put("/{course_id}/assignments/{assignment_id}/rubric", response_model=RubricOut)
def save_rubric(
    course_id: int,
    assignment_id: int,
    payload: RubricSaveRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Teacher's edited/approved rubric - full replace of criteria, same "review,
    edit, and approve every AI output" pattern used elsewhere in this app. Once
    status='Published' (the default), grading (see POST .../grade below) uses this
    rubric for every student's submission in the class."""
    assignment = _get_owned_assignment(db, course_id, assignment_id, current_teacher.id)
    if not payload.criteria:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A rubric needs at least one criterion.")

    rubric = db.query(Rubric).filter(Rubric.assignment_id == assignment_id).first()
    if rubric:
        rubric.criteria.clear()
        rubric.status = payload.status
    else:
        rubric = Rubric(assignment_id=assignment_id, created_by_id=current_teacher.id, status=payload.status)
        db.add(rubric)
    db.flush()

    for i, c in enumerate(payload.criteria):
        db.add(RubricCriterion(
            rubric_id=rubric.id, title=c.title, description=c.description,
            max_points=max(0.0, c.max_points), clo_id=c.clo_id, order_index=i,
        ))
    db.commit()
    db.refresh(rubric)
    return _rubric_to_out(rubric, db)


@router.delete("/{course_id}/assignments/{assignment_id}/rubric", status_code=status.HTTP_204_NO_CONTENT)
def delete_rubric(
    course_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    _get_owned_assignment(db, course_id, assignment_id, current_teacher.id)
    rubric = db.query(Rubric).filter(Rubric.assignment_id == assignment_id).first()
    if rubric:
        db.delete(rubric)
        db.commit()
    return None


@router.delete("/{course_id}/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(
    course_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    assignment = _get_owned_assignment(db, course_id, assignment_id, current_teacher.id)
    if assignment.attachment_url:
        try:
            delete_stored_file(assignment.attachment_url)
        except Exception as e:
            print(f"Warning: failed to delete assignment attachment: {str(e)}")
    for sub in assignment.submissions:
        try:
            delete_stored_file(sub.file_url)
        except Exception as e:
            print(f"Warning: failed to delete submission file: {str(e)}")
    db.delete(assignment)
    db.commit()
    return None


@router.get("/{course_id}/assignments/{assignment_id}/download")
def download_assignment_attachment(
    course_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id, Assignment.course_id == course_id).first()
    if not assignment or not assignment.attachment_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No attachment for this assignment")

    content = download_stored_file(assignment.attachment_url)
    content_type = get_content_type(Path(assignment.attachment_filename).suffix)
    return Response(
        content=content, media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{assignment.attachment_filename}"'},
    )


@router.post("/{course_id}/assignments/{assignment_id}/submit", response_model=SubmissionSummary, status_code=status.HTTP_201_CREATED)
def submit_assignment(
    course_id: int,
    assignment_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_student: User = Depends(get_current_student),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_student)

    assignment = db.query(Assignment).filter(Assignment.id == assignment_id, Assignment.course_id == course_id).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    content, extension, safe_filename = _read_and_validate_upload(file)
    is_late = bool(assignment.due_date and datetime.utcnow() > assignment.due_date)
    file_url = store_file(content, safe_filename, extension, f"assignment_submissions/{assignment_id}/{current_student.id}")

    existing = (
        db.query(AssignmentSubmission)
        .filter(AssignmentSubmission.assignment_id == assignment_id, AssignmentSubmission.student_id == current_student.id)
        .first()
    )
    if existing:
        try:
            delete_stored_file(existing.file_url)
        except Exception as e:
            print(f"Warning: failed to delete previous submission file: {str(e)}")
        existing.file_url = file_url
        existing.file_filename = safe_filename
        existing.submitted_at = datetime.utcnow()
        existing.is_late = is_late
        submission = existing
    else:
        submission = AssignmentSubmission(
            assignment_id=assignment_id, student_id=current_student.id,
            file_url=file_url, file_filename=safe_filename, is_late=is_late,
        )
        db.add(submission)

    db.commit()
    db.refresh(submission)

    try:
        create_notification(
            db, assignment.teacher_id, NotificationType.ASSIGNMENT_SUBMITTED,
            title="Assignment submitted",
            message=f"{current_student.full_name} submitted '{assignment.title}' in {course.name}.",
            link=f"/course/{course_id}",
        )
    except Exception as e:
        print(f"Warning: failed to notify teacher of submission: {str(e)}")

    return submission


@router.get("/{course_id}/assignments/{assignment_id}/submissions", response_model=List[SubmissionResponse])
def list_submissions(
    course_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    assignment = _get_owned_assignment(db, course_id, assignment_id, current_teacher.id)
    return [
        SubmissionResponse(
            id=s.id, assignment_id=s.assignment_id, student_id=s.student_id,
            student_name=s.student.full_name if s.student else None,
            student_email=s.student.email if s.student else None,
            file_filename=s.file_filename, submitted_at=s.submitted_at, is_late=s.is_late,
            grade=s.grade, feedback=s.feedback,
            rubric_scores=json.loads(s.rubric_scores_json) if s.rubric_scores_json else None,
        )
        for s in assignment.submissions
    ]


@router.get("/{course_id}/assignments/{assignment_id}/submissions/{submission_id}/download")
def download_submission(
    course_id: int,
    assignment_id: int,
    submission_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    assignment = _get_owned_assignment(db, course_id, assignment_id, current_teacher.id)
    submission = next((s for s in assignment.submissions if s.id == submission_id), None)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    content = download_stored_file(submission.file_url)
    content_type = get_content_type(Path(submission.file_filename).suffix)
    return Response(
        content=content, media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{submission.file_filename}"'},
    )


def _get_submission_or_404(assignment: Assignment, submission_id: int) -> AssignmentSubmission:
    submission = next((s for s in assignment.submissions if s.id == submission_id), None)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    return submission


@router.post(
    "/{course_id}/assignments/{assignment_id}/submissions/{submission_id}/grade",
    response_model=SubmissionResponse,
)
def grade_submission(
    course_id: int,
    assignment_id: int,
    submission_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Runs AI concept-level grading on one submission: extracts its text, compares
    it against the course's knowledge-graph concepts, and writes a grade + explainable
    per-concept feedback. Safe to call again on an already-graded submission (e.g.
    after a resubmission) - it simply overwrites the previous AI result; a teacher's
    own manual override (see the PATCH endpoint below) is a separate, later step."""
    course = _get_course_or_404(db, course_id)
    assignment = _get_owned_assignment(db, course_id, assignment_id, current_teacher.id)
    submission = _get_submission_or_404(assignment, submission_id)

    file_bytes = download_stored_file(submission.file_url)
    extension = Path(submission.file_filename).suffix
    try:
        submission_text = grading_service._extract_submission_text(file_bytes, extension)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not extract text from this submission ({submission.file_filename}): {str(e)}",
        )

    concepts: list[dict] = []
    if course.catalog_id:
        graph = neo4j_service.get_catalog_graph(course.catalog_id)
        concepts = [{"name": n["name"], "description": n.get("description") or ""} for n in graph.get("nodes", [])]

    # Retrieve what this course actually taught about the assignment topic, so grading
    # judges the student against their own course rather than the model's general
    # knowledge of the subject. Best-effort - a course with no uploaded material still
    # grades against the brief, exactly as before.
    course_material = ""
    try:
        from app.rag.retrieval import retrieve, format_excerpts
        hits = retrieve(
            db, course.id,
            f"{assignment.title}. {assignment.description or ''}",
            top_k=6,
        )
        course_material = format_excerpts(hits)
    except Exception as e:
        print(f"Warning: retrieval failed while grading submission {submission.id}, grading ungrounded: {str(e)}")

    # A "Published" rubric is what grading actually uses - a still-Draft one (not
    # yet reviewed by the teacher) is deliberately ignored here, same review-gate
    # as every other AI output in this app.
    rubric = db.query(Rubric).filter(Rubric.assignment_id == assignment_id, Rubric.status == "Published").first()
    rubric_criteria_for_prompt = (
        [{"id": c.id, "title": c.title, "description": c.description, "max_points": c.max_points} for c in rubric.criteria]
        if rubric else None
    )

    try:
        result = grading_service.grade_submission_text(
            assignment.title, assignment.description, submission_text, concepts,
            course_material=course_material, rubric_criteria=rubric_criteria_for_prompt,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))

    submission.grade = result["overall_grade"]
    submission.feedback = grading_service.format_feedback_text(result)

    touched_clo_ids: set = set()
    if rubric:
        clo_by_id = {c.id: c for c in rubric.criteria if c.clo_id}
        breakdown = []
        for cs in result.get("criterion_scores", []):
            crit_clo = clo_by_id.get(cs.get("criterion_id"))
            breakdown.append({**cs, "clo_id": crit_clo.clo_id if crit_clo else None})
            # CLO attainment: same running-average pattern as ConceptMastery, keyed
            # by clo_id instead of concept_node_id - only criteria a teacher tagged
            # with a CLO contribute, so an untagged criterion just grades normally.
            if crit_clo:
                touched_clo_ids.add(crit_clo.clo_id)
                pct = (cs["points_earned"] / cs["max_points"] * 100) if cs["max_points"] else 0.0
                db.add(CLOAttainmentEvidence(
                    student_id=submission.student_id, course_id=course_id, clo_id=crit_clo.clo_id,
                    source_type="assignment", source_id=submission.id, score=pct,
                ))
                attainment = db.query(CLOAttainment).filter(
                    CLOAttainment.student_id == submission.student_id,
                    CLOAttainment.course_id == course_id,
                    CLOAttainment.clo_id == crit_clo.clo_id,
                ).first()
                if attainment is None:
                    db.add(CLOAttainment(
                        student_id=submission.student_id, course_id=course_id, clo_id=crit_clo.clo_id,
                        attainment_score=pct, evidence_count=1,
                    ))
                else:
                    attainment.attainment_score = (
                        (attainment.attainment_score * attainment.evidence_count) + pct
                    ) / (attainment.evidence_count + 1)
                    attainment.evidence_count += 1
        submission.rubric_scores_json = json.dumps(breakdown)

    if course.catalog_id:
        for c in result.get("concept_scores", []):
            node_id = build_node_id(course.catalog_id, c.get("concept_name", ""))
            mastery_service.record_evidence(
                db, submission.student_id, course_id, course.catalog_id,
                node_id, c.get("concept_name", ""), float(c.get("score", 0)),
                source_type="assignment", source_id=submission.id,
            )

    gamification_service.award_points(
        db, submission.student_id, course_id, round(submission.grade / 10),
        reason=f"Graded: {assignment.title}", source_type="assignment", source_id=submission.id,
    )

    # Flush so the CLOAttainment rows just built above are visible to the
    # rollup's own queries within this same transaction, then roll each touched
    # CLO up to the PLO(s) it supports - the reporting half of the CLO -> PLO
    # chain that CLOAttainment alone never fed.
    if touched_clo_ids:
        db.flush()
        for clo_id in touched_clo_ids:
            outcomes_service.recompute_plo_attainment(db, submission.student_id, clo_id)

    db.commit()
    db.refresh(submission)

    try:
        create_notification(
            db, submission.student_id, NotificationType.ASSIGNMENT_GRADED,
            title=f"'{assignment.title}' has been graded",
            message=f"You scored {round(submission.grade)}/100 in {course.name}. Open the assignment to see concept-level feedback.",
            link=f"/course/{course_id}",
        )
    except Exception as e:
        print(f"Warning: failed to notify student of grading: {str(e)}")

    return SubmissionResponse(
        id=submission.id, assignment_id=submission.assignment_id, student_id=submission.student_id,
        student_name=submission.student.full_name if submission.student else None,
        student_email=submission.student.email if submission.student else None,
        file_filename=submission.file_filename, submitted_at=submission.submitted_at, is_late=submission.is_late,
        grade=submission.grade, feedback=submission.feedback,
        rubric_scores=json.loads(submission.rubric_scores_json) if submission.rubric_scores_json else None,
    )


@router.patch(
    "/{course_id}/assignments/{assignment_id}/submissions/{submission_id}/grade",
    response_model=SubmissionResponse,
)
def override_grade(
    course_id: int,
    assignment_id: int,
    submission_id: int,
    payload: ManualGradeUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Teacher review/approval step: replace or correct the AI-suggested grade and
    feedback with the teacher's own final call, per the proposal's requirement that
    teachers can "review, edit, and approve all AI-generated outputs". Does not
    touch ConceptMastery - that per-concept signal stays whatever the AI grading
    pass computed, since a teacher overriding the single overall number/feedback
    isn't necessarily correcting each concept's score."""
    course = _get_course_or_404(db, course_id)
    assignment = _get_owned_assignment(db, course_id, assignment_id, current_teacher.id)
    submission = _get_submission_or_404(assignment, submission_id)

    submission.grade = max(0.0, min(100.0, payload.grade))
    submission.feedback = payload.feedback
    db.commit()
    db.refresh(submission)

    try:
        create_notification(
            db, submission.student_id, NotificationType.ASSIGNMENT_GRADED,
            title=f"'{assignment.title}' grade updated",
            message=f"Your teacher updated your grade to {round(submission.grade)}/100 in {course.name}.",
            link=f"/course/{course_id}",
        )
    except Exception as e:
        print(f"Warning: failed to notify student of grade override: {str(e)}")

    return SubmissionResponse(
        id=submission.id, assignment_id=submission.assignment_id, student_id=submission.student_id,
        student_name=submission.student.full_name if submission.student else None,
        student_email=submission.student.email if submission.student else None,
        file_filename=submission.file_filename, submitted_at=submission.submitted_at, is_late=submission.is_late,
        grade=submission.grade, feedback=submission.feedback,
        rubric_scores=json.loads(submission.rubric_scores_json) if submission.rubric_scores_json else None,
    )
