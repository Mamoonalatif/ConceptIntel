from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Date, Text, Boolean, UniqueConstraint, func
from sqlalchemy.orm import relationship
from app.database.connection import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    role = Column(String, nullable=False)  # "teacher", "student", or "admin"
    is_active = Column(Boolean, default=True, nullable=False)
    # Only meaningful for students; used for the optional semester-match enrollment check
    # (see enrollment/services.py). Nullable because teachers/admins don't have one and
    # older student rows may predate this field.
    current_semester = Column(Integer, nullable=True)

    # Relationships
    courses_taught = relationship("Course", back_populates="teacher", cascade="all, delete-orphan")
    enrollments = relationship("Enrollment", back_populates="student", cascade="all, delete-orphan")
    uploaded_files = relationship("UploadedFile", back_populates="teacher", cascade="all, delete-orphan")


class TeacherRequest(Base):
    """A prospective teacher's request for an account, reviewed by an admin."""
    __tablename__ = "teacher_requests"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    reason = Column(Text, nullable=True)
    status = Column(String, default="pending")  # "pending", "approved", "rejected"
    created_at = Column(DateTime, server_default=func.now())


class CourseCatalog(Base):
    """Predefined catalog of course offerings. Only admins may add/edit/remove entries;
    teachers may only pick from this list when creating a Course instance."""
    __tablename__ = "course_catalog"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=False)

    # Self-referencing prerequisite mapping (lives on the catalog, not the course instance)
    prerequisite_catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=True)
    prerequisite = relationship("CourseCatalog", remote_side=[id], backref="dependent_catalog_entries")


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=True)  # Course code like "CS-201" (populated from catalog entry)
    semester = Column(String, nullable=False)
    enrollment_code = Column(String, unique=True, index=True, nullable=False)
    max_students = Column(Integer, nullable=True)
    status = Column(String, default="Draft")  # "Draft", "Open", "Closed"

    description = Column(Text, nullable=True)
    enrollment_start = Column(Date, nullable=True)
    enrollment_end = Column(Date, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    # Catalog entry this course instance was created from
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=True)
    catalog_entry = relationship("CourseCatalog")

    # Self-referencing prerequisite course relationship. Derived server-side from the
    # catalog entry's prerequisite_catalog_id at creation time (see courses/routes.py) -
    # not directly editable by teachers.
    prerequisite_course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)

    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Relationships
    teacher = relationship("User", back_populates="courses_taught")
    enrollments = relationship("Enrollment", back_populates="course", cascade="all, delete-orphan")
    uploaded_files = relationship("UploadedFile", back_populates="course", cascade="all, delete-orphan")

    # Self-referencing relationships
    prerequisite = relationship("Course", remote_side=[id], backref="dependent_courses")


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint("student_id", "course_id", name="uq_student_course_enrollment"),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    status = Column(String, default="Active")  # "Active", "Completed", "Dropped"
    enrolled_at = Column(DateTime, server_default=func.now())
    progress = Column(Float, default=0.0)  # Completion progress percentage (0.0 to 100.0)
    last_accessed = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    student = relationship("User", back_populates="enrollments")
    course = relationship("Course", back_populates="enrollments")


class UploadedFile(Base):
    __tablename__ = "uploaded_files"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String, nullable=False)
    file_url = Column(String, nullable=False)  # Path relative to local upload folder or Supabase URL
    file_type = Column(String, nullable=False)  # "pdf", "docx", "pptx", "txt"
    file_size = Column(Integer, nullable=False)  # Size in bytes
    status = Column(String, default="Uploaded")  # "Uploaded", "Processing", "Completed", "Failed"
    extracted_text = Column(Text, nullable=True)  # Cleaned raw text content
    created_at = Column(DateTime, server_default=func.now())

    # Relationships
    course = relationship("Course", back_populates="uploaded_files")
    teacher = relationship("User", back_populates="uploaded_files")

