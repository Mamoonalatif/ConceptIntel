from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Date, Text, Boolean, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship
from app.database.connection import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    # Nullable because Google-only accounts (see auth/routes.py google_login) have no password.
    hashed_password = Column(String, nullable=True)
    full_name = Column(String, nullable=False)
    role = Column(String, nullable=False)  # "teacher", "student", or "admin"
    is_active = Column(Boolean, default=True, nullable=False)
    # Google account identifier ("sub" claim), set the first time a user signs in with Google.
    google_id = Column(String, unique=True, index=True, nullable=True)
    # Bridge to Supabase Auth's auth.users.id (UUID) - set once a user authenticates
    # through Supabase Auth (email/password or Google via Supabase). This table's own
    # integer id stays the source of truth for every foreign key in the app (courses,
    # enrollments, uploaded_files, etc.) - only this column changes to support Supabase
    # Auth, avoiding an integer -> UUID migration across the whole schema.
    supabase_uid = Column(String, unique=True, index=True, nullable=True)
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

    # Knowledge graph review state, set by a Course Coordinator - students may only
    # view a course's knowledge graph once it is "Approved" (see knowledge_graph/routes.py).
    graph_status = Column(String, default="Pending", nullable=False)  # "Pending", "Approved", "Rejected"

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
    chunks = relationship("ContentChunk", back_populates="file", cascade="all, delete-orphan")


class ContentChunk(Base):
    """A single retrievable unit for RAG: either a text passage, a whole table, or an
    image caption. Embedding is stored as a plain float array (not pgvector) since the
    vector extension isn't installed on this Postgres server - at this scale (a
    handful of courses) brute-force cosine similarity in Python is effectively instant,
    so no ANN index is needed. See app/rag/retrieval.py. Swapping to pgvector later
    only requires changing this column's type and the similarity query - the rest of
    the pipeline is unaffected."""
    __tablename__ = "content_chunks"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    file_id = Column(Integer, ForeignKey("uploaded_files.id"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    embedding = Column(ARRAY(Float), nullable=False)
    token_count = Column(Integer, nullable=False)
    # SHA-256 of the normalized chunk text - lets reprocessing skip re-embedding
    # identical chunks (e.g. a teacher re-uploading the same slide deck).
    chunk_hash = Column(String, nullable=False, index=True)
    section_heading = Column(String, nullable=True)  # nearest heading/slide title, for context
    source_type = Column(String, nullable=False, default="text")  # "text" | "table" | "image_caption"
    page_number = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    course = relationship("Course")
    file = relationship("UploadedFile", back_populates="chunks")

