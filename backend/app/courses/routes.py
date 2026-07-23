import random
import string
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database.connection import get_db
from app.database.models import Course, User, CourseCatalog
from app.courses.schemas import (
    CourseCreate, CourseResponse, CourseUpdate,
    CourseCatalogCreate, CourseCatalogUpdate, CourseCatalogResponse,
    AdminCourseUpdate, CourseLookupResponse,
)
from app.auth.routes import (
    get_current_teacher, get_current_user,
    get_current_program_coordinator, get_current_course_manager,
)
from app.courses.access import assert_course_access

router = APIRouter(prefix="/courses", tags=["Courses"])

def generate_unique_code(db: Session) -> str:
    """Generates a unique 8-character alphanumeric enrollment code."""
    characters = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choices(characters, k=8))
        # Ensure it doesn't already exist
        exists = db.query(Course).filter(Course.enrollment_code == code).first()
        if not exists:
            return code


def _get_catalog_entry_or_404(db: Session, catalog_id: int) -> CourseCatalog:
    entry = db.query(CourseCatalog).filter(CourseCatalog.id == catalog_id).first()
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Course catalog entry with ID {catalog_id} does not exist."
        )
    return entry


def _derive_prerequisite_course_id(db: Session, catalog_entry: CourseCatalog):
    """Best-effort lookup: finds any existing Course instance built from the catalog
    entry's prerequisite catalog mapping. NOTE: this is a simplification - if multiple
    course instances exist for the prerequisite catalog entry (e.g. across semesters),
    the first match is used arbitrarily, and if none exist yet the prerequisite is left
    null (it is not retroactively backfilled onto this course later)."""
    if not catalog_entry.prerequisite_catalog_id:
        return None
    prereq_course = (
        db.query(Course)
        .filter(Course.catalog_id == catalog_entry.prerequisite_catalog_id)
        .first()
    )
    return prereq_course.id if prereq_course else None


# --- Course Catalog: public/authenticated read-only listing (for teacher dropdown) ---

@router.get("/catalog", response_model=List[CourseCatalogResponse])
def list_catalog(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Read-only listing of the predefined course catalog, for the teacher-facing dropdown."""
    return db.query(CourseCatalog).all()


# --- Admin: Course Catalog management ---

@router.get("/admin/catalog", response_model=List[CourseCatalogResponse])
def admin_list_catalog(db: Session = Depends(get_db), current_user: User = Depends(get_current_program_coordinator)):
    return db.query(CourseCatalog).all()


@router.post("/admin/catalog", response_model=CourseCatalogResponse, status_code=status.HTTP_201_CREATED)
def admin_create_catalog_entry(
    entry_in: CourseCatalogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_program_coordinator)
):
    if entry_in.prerequisite_catalog_id:
        _get_catalog_entry_or_404(db, entry_in.prerequisite_catalog_id)

    new_entry = CourseCatalog(
        name=entry_in.name,
        code=entry_in.code,
        prerequisite_catalog_id=entry_in.prerequisite_catalog_id,
    )
    db.add(new_entry)
    db.commit()
    db.refresh(new_entry)
    return new_entry


@router.put("/admin/catalog/{id}", response_model=CourseCatalogResponse)
def admin_update_catalog_entry(
    id: int,
    entry_in: CourseCatalogUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_program_coordinator)
):
    entry = _get_catalog_entry_or_404(db, id)

    update_data = entry_in.model_dump(exclude_unset=True)
    if "prerequisite_catalog_id" in update_data and update_data["prerequisite_catalog_id"]:
        if update_data["prerequisite_catalog_id"] == id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A catalog entry cannot be its own prerequisite.")
        _get_catalog_entry_or_404(db, update_data["prerequisite_catalog_id"])

    for field, value in update_data.items():
        setattr(entry, field, value)

    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/admin/catalog/{id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_catalog_entry(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_program_coordinator)
):
    entry = _get_catalog_entry_or_404(db, id)
    db.delete(entry)
    db.commit()
    return None


# --- Course instances ---

@router.post("", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
def create_course(
    course_in: CourseCreate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    catalog_entry = _get_catalog_entry_or_404(db, course_in.catalog_id)

    code = generate_unique_code(db)
    prerequisite_course_id = _derive_prerequisite_course_id(db, catalog_entry)

    new_course = Course(
        name=catalog_entry.name,
        code=catalog_entry.code,
        semester=course_in.semester,
        enrollment_code=code,
        max_students=course_in.max_students,
        status="Open",  # Default to Open so students can enroll immediately
        catalog_id=catalog_entry.id,
        description=course_in.description,
        enrollment_start=course_in.enrollment_start,
        enrollment_end=course_in.enrollment_end,
        start_date=course_in.start_date,
        end_date=course_in.end_date,
        prerequisite_course_id=prerequisite_course_id,
        teacher_id=current_teacher.id
    )
    db.add(new_course)
    db.commit()
    db.refresh(new_course)
    return new_course


@router.get("/teacher/my-courses", response_model=List[CourseResponse])
def get_teacher_courses(
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Retrieve courses created by the authenticated teacher."""
    return db.query(Course).filter(Course.teacher_id == current_teacher.id).all()


@router.get("/all", response_model=List[CourseResponse])
def get_all_courses(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve all courses (accessible by any logged in user)."""
    return db.query(Course).all()


@router.get("/lookup/{enrollment_code}", response_model=CourseLookupResponse)
def lookup_course_by_code(
    enrollment_code: str,
    db: Session = Depends(get_db),
):
    """Read-only, no-side-effect, PUBLIC lookup (no auth) - used both by the student
    enrollment form and by the /join/:code landing page, which a logged-out visitor
    can land on straight from a shared join link before they've signed in. Only
    exposes name/code - nothing else."""
    code = enrollment_code.strip().upper()
    course = db.query(Course).filter(Course.enrollment_code == code).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found.")
    return CourseLookupResponse(name=course.name, code=course.code)


@router.get("/{id}", response_model=CourseResponse)
def get_course_details(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    course = db.query(Course).filter(Course.id == id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )
    assert_course_access(db, course, current_user)
    return course


@router.put("/{id}", response_model=CourseResponse)
def update_course(
    id: int,
    course_in: CourseUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    course = db.query(Course).filter(Course.id == id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you do not have permission to edit it"
        )

    update_data = course_in.model_dump(exclude_unset=True)

    if "catalog_id" in update_data:
        catalog_entry = _get_catalog_entry_or_404(db, update_data["catalog_id"])
        course.catalog_id = catalog_entry.id
        course.name = catalog_entry.name
        course.code = catalog_entry.code
        course.prerequisite_course_id = _derive_prerequisite_course_id(db, catalog_entry)
        update_data.pop("catalog_id")

    for field, value in update_data.items():
        setattr(course, field, value)

    db.commit()
    db.refresh(course)
    return course


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    course = db.query(Course).filter(Course.id == id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you do not have permission to delete it"
        )
    db.delete(course)
    db.commit()
    return None


@router.post("/{id}/generate-code", response_model=CourseResponse)
def regenerate_enrollment_code(
    id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Regenerate a new enrollment code for a course."""
    course = db.query(Course).filter(Course.id == id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you do not have permission to edit it"
        )

    course.enrollment_code = generate_unique_code(db)
    db.commit()
    db.refresh(course)
    return course


# --- Admin: full control over any course instance ---

@router.put("/admin/{id}", response_model=CourseResponse)
def admin_update_course(
    id: int,
    course_in: AdminCourseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_course_manager)
):
    """Shared course-info update endpoint for admin / program coordinator / course
    coordinator. Catalog reassignment and prerequisite mapping are Program Coordinator
    (or admin) duties only - a Course Coordinator may update everything else (status,
    dates, description, capacity) but is blocked from those two fields."""
    course = db.query(Course).filter(Course.id == id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")

    update_data = course_in.model_dump(exclude_unset=True)
    role = current_user.role.lower()
    is_catalog_manager = role in ("admin", "program_coordinator")

    if not is_catalog_manager and ("catalog_id" in update_data or "prerequisite_course_id" in update_data):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a Program Coordinator (or admin) may change a course's catalog entry or prerequisite mapping."
        )

    if "catalog_id" in update_data and update_data["catalog_id"] is not None:
        catalog_entry = _get_catalog_entry_or_404(db, update_data["catalog_id"])
        course.catalog_id = catalog_entry.id
        course.name = catalog_entry.name
        course.code = catalog_entry.code
        update_data.pop("catalog_id")

    if "prerequisite_course_id" in update_data and update_data["prerequisite_course_id"]:
        if update_data["prerequisite_course_id"] == course.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A course cannot be its own prerequisite.")
        prereq = db.query(Course).filter(Course.id == update_data["prerequisite_course_id"]).first()
        if not prereq:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Specified prerequisite course does not exist.")

    for field, value in update_data.items():
        setattr(course, field, value)

    db.commit()
    db.refresh(course)
    return course


@router.delete("/admin/{id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_course(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_program_coordinator)
):
    course = db.query(Course).filter(Course.id == id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    db.delete(course)
    db.commit()
    return None
