from datetime import datetime
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Assignment, AssignmentSubmission, Course, User
from app.assignments.schemas import AssignmentResponse, AssignmentUpdate, SubmissionSummary, SubmissionResponse
from app.auth.routes import get_current_user, get_current_teacher, get_current_student
from app.courses.access import assert_course_access
from app.upload.services import store_file, download_stored_file, delete_stored_file, get_content_type
from app.notifications.service import create_notification, notify_course_students
from app.notifications.types import NotificationType
from app.notifications.ai_summary import generate_posting_summary

router = APIRouter(prefix="/courses", tags=["Assignments"])

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".pptx", ".ppt", ".txt", ".zip", ".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


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

    try:
        due_str = f" Due {due_date.strftime('%b %d, %Y %I:%M %p')}." if due_date else ""
        points_str = f" Worth {points} points." if points else ""
        content = f"Posted in {course.name}.{due_str}{points_str} {description or ''}".strip()
        summary = generate_posting_summary("assignment", title, content)
        notify_course_students(
            db, course_id, NotificationType.ASSIGNMENT_POSTED,
            title=f"New assignment: {title}",
            message=summary,
            link=f"/course/{course_id}",
        )
    except Exception as e:
        print(f"Warning: failed to create assignment notifications: {str(e)}")

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
