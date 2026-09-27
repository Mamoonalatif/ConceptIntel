from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Date, Text, Boolean, UniqueConstraint, JSON, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from app.config import settings
from app.database.connection import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    # Nullable because Google-only accounts (see auth/routes.py google_login) have no password.
    hashed_password = Column(String, nullable=True)
    full_name = Column(String, nullable=False)
    role = Column(String, nullable=False)  # "teacher", "student", or "admin" - the base
    # identity, and it never changes on promotion (see the two flags below). A course/
    # program coordinator is still a teacher first - these are ADDITIONAL authorities
    # layered on top, not a replacement role. Getting this wrong once meant a promoted
    # teacher lost the ability to upload files or run their own courses.
    is_program_coordinator = Column(Boolean, default=False, nullable=False)
    is_course_coordinator = Column(Boolean, default=False, nullable=False)
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
    # Storage reference for the user's profile photo (local disk path, "s3://..." or
    # "supabase://..." - same private-storage convention as UploadedFile.file_url, see
    # app/upload/services.py). NOT a directly-loadable URL - the frontend fetches the
    # actual bytes through GET /auth/users/{id}/avatar (see auth/routes.py), same
    # pattern as course material attachments.
    avatar_url = Column(String, nullable=True)

    # Relationships
    courses_taught = relationship("Course", back_populates="teacher", cascade="all, delete-orphan")
    enrollments = relationship("Enrollment", back_populates="student", cascade="all, delete-orphan")
    uploaded_files = relationship("UploadedFile", back_populates="teacher", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")


class PasswordResetToken(Base):
    """A one-time "forgot password" link. Only the sha256 hash of the raw token is
    stored - same reasoning as never storing a plaintext password - so a database
    read alone can't be used to reset someone's account. The raw token only ever
    exists in the emailed link and briefly in memory server-side.

    A brand-new table rather than columns on User: this project has no Alembic (see
    app/main.py, Base.metadata.create_all() never alters an existing table), and a
    new table IS something create_all() can add on its own, unlike a new column."""
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class TeacherRequest(Base):
    """A prospective teacher's request for an account, reviewed by an admin."""
    __tablename__ = "teacher_requests"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    reason = Column(Text, nullable=True)
    status = Column(String, default="pending")  # "pending", "approved", "rejected"
    created_at = Column(DateTime, server_default=func.now())


class Program(Base):
    """A degree program (e.g. "Computer Science") that groups CourseCatalog entries.
    A Program Coordinator is scoped to one or more Programs (see
    ProgramCoordinatorAssignment) - courses don't carry a program directly, it's
    always derived through course.catalog_entry.program_id."""
    __tablename__ = "programs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    code = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    catalog_entries = relationship("CourseCatalog", back_populates="program")


class CourseCatalog(Base):
    """Predefined catalog of course offerings. Only admins/program coordinators may
    add/edit/remove entries; teachers may only pick from this list when creating a
    Course instance."""
    __tablename__ = "course_catalog"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=False)

    # Self-referencing prerequisite mapping (lives on the catalog, not the course instance)
    prerequisite_catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=True)
    prerequisite = relationship("CourseCatalog", remote_side=[id], backref="dependent_catalog_entries")

    # Nullable because this column was added after CourseCatalog already existed in
    # production (see backend/scripts/add_program_column.py for the one-time backfill) -
    # new rows should always set it going forward.
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=True)
    program = relationship("Program", back_populates="catalog_entries")


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=True)  # Course code like "CS-201" (populated from catalog entry)
    semester = Column(String, nullable=False)
    enrollment_code = Column(String, unique=True, index=True, nullable=False)
    max_students = Column(Integer, nullable=True)
    status = Column(String, default="Draft")  # "Draft", "Open", "Closed"

    # Teacher-chosen class theme color (Google Classroom-style banner customization) -
    # a CSS color/gradient key from the frontend's fixed palette (see
    # frontend/src/lib/courseTheme.ts). Null means "use the auto-derived default",
    # same as before this field existed.
    theme_color = Column(String, nullable=True)

    description = Column(Text, nullable=True)
    enrollment_start = Column(Date, nullable=True)
    enrollment_end = Column(Date, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    # Catalog entry this course instance was created from
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=True)
    catalog_entry = relationship("CourseCatalog")

    # Concept graph review state, set by a Course Coordinator - students may only
    # view a course's concept graph once it is "Approved" (see knowledge_graph/routes.py).
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


class CourseSchedule(Base):
    """The teacher-editable week/session -> topics outline for a course, shown to
    students and teachers as a lightweight preview of what's coming, ahead of the
    full (Neo4j) concept graph. One row per Course (a teacher's own section plan,
    not a shared-catalog artifact like the concept graph).

    No coordinator-approval gate: a generate/edit action writes straight to
    `sessions`, which is simply what students and teachers currently see - a
    schedule is one teacher's own section plan, not shared curriculum data like
    the concept graph, so there's no "one teacher's edit becomes visible to every
    other section" risk to guard against.

    `pending_sessions_json`/`decided_by_id`/`decision_notes` are unused leftovers
    from an earlier version of this feature that DID gate schedule changes behind
    approval - left in place (nullable, always NULL going forward) rather than
    migrated out, since dropping a column needs a manual ALTER in this no-Alembic
    project and there's no live data to lose."""
    __tablename__ = "course_schedules"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, unique=True, index=True)
    source_file_id = Column(Integer, ForeignKey("uploaded_files.id"), nullable=True)
    status = Column(String, nullable=False, default="Draft")
    # "Draft" | "Approved" | "Failed" - "Approved" just means "has sessions", not
    # "was approved by someone"; kept from the earlier approval-gated version.
    generated_by_ai = Column(Boolean, nullable=False, default=False)
    pending_sessions_json = Column(Text, nullable=True)  # unused, see class docstring
    # Who most recently generated/edited this schedule.
    submitted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    decided_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # unused, see class docstring
    decision_notes = Column(Text, nullable=True)  # unused, see class docstring
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    course = relationship("Course")
    sessions = relationship(
        "ScheduleSession", back_populates="schedule",
        cascade="all, delete-orphan", order_by="ScheduleSession.order_index",
    )


class ScheduleSession(Base):
    """One approved week/session row of a CourseSchedule: a shallow list of topic
    names (not full Concept nodes - no description/difficulty/prerequisites), plus
    optional links to the concepts they later expand into once the full graph exists."""
    __tablename__ = "schedule_sessions"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("course_schedules.id"), nullable=False, index=True)
    order_index = Column(Integer, nullable=False, default=0)
    week_label = Column(String, nullable=False)
    title = Column(String, nullable=True)
    topics_json = Column(Text, nullable=False, default="[]")
    linked_concept_ids_json = Column(Text, nullable=True)

    schedule = relationship("CourseSchedule", back_populates="sessions")


class UploadedFile(Base):
    __tablename__ = "uploaded_files"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String, nullable=False)
    file_url = Column(String, nullable=False)  # Path relative to local upload folder or Supabase URL
    file_type = Column(String, nullable=False)  # "pdf", "docx", "pptx", "txt", "jpg", "jpeg", "png"
    file_size = Column(Integer, nullable=False)  # Size in bytes
    status = Column(String, default="Uploaded")  # "Uploaded", "Processing", "Completed", "Failed"
    extracted_text = Column(Text, nullable=True)  # Cleaned raw text content (OCR'd if scanned/image)
    used_ocr = Column(Boolean, default=False, nullable=False)  # True if OCR fallback was used to extract text
    # Added after this table shipped, so nullable with a default rather than NOT NULL -
    # backfilled to "material" for existing rows by scripts/add_material_kind_column.py.
    # "material" = lecture content that gets chunked and embedded for retrieval.
    # "outline"  = the course outline/syllabus. Deliberately NOT embedded: it is a
    #              table of contents, so its chunks match almost every query and
    #              crowd genuine explanatory passages out of the top-k. It is passed
    #              to the model as structured context instead (see
    #              app/content_processing/pipeline_service.py).
    material_kind = Column(String, nullable=False, default="material")  # "material" | "outline"
    # Tracks RAG ingestion (chunk/embed) separately from `status` above, which only
    # reflects text extraction. A file can be status="Completed" (text extracted
    # fine) while rag_status="Failed" (embedding/chunking blew up) - previously that
    # failure was invisible outside a server log. See app/upload/routes.py -
    # process_uploaded_file_task and app/rag/pipeline.py.
    # "Pending"  - extraction hasn't finished yet, or RAG hasn't run yet.
    # "Completed" - chunked and embedded successfully (0 chunks from empty/junk text
    #               still counts as a completed run, not a failure).
    # "Failed"   - process_file_for_rag raised; see rag_error for the message.
    # "Skipped"  - material_kind="outline": deliberately never embedded, by design.
    rag_status = Column(String, nullable=False, default="Pending")
    rag_error = Column(Text, nullable=True)  # Set only when rag_status="Failed"
    created_at = Column(DateTime, server_default=func.now())

    # Relationships
    course = relationship("Course", back_populates="uploaded_files")
    teacher = relationship("User", back_populates="uploaded_files")
    chunks = relationship("ContentChunk", back_populates="file", cascade="all, delete-orphan")


class ContentChunk(Base):
    """A single retrievable unit for RAG: either a text passage, a whole table, or an
    image caption. Embedding is a real pgvector column (Supabase has the `vector`
    extension available - enable it once via Dashboard > Database > Extensions), so
    nearest-neighbor search runs as a SQL query (see app/rag/retrieval.py) instead of
    pulling every chunk into Python - correct at any scale, and can take an ivfflat/
    hnsw index later with no query changes if a course ever accumulates thousands of
    chunks."""
    __tablename__ = "content_chunks"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    file_id = Column(Integer, ForeignKey("uploaded_files.id"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    # Width is taken from settings.EMBEDDING_DIM rather than a literal so the column
    # and the embedding model can never silently drift apart (they previously could:
    # the model name lived in app/rag/embeddings.py and the 384 was hardcoded here).
    # Changing EMBEDDING_DIM does NOT migrate an existing database - create_all()
    # never alters a live column - so it must be paired with
    # `python scripts/reembed_content_chunks.py`.
    embedding = Column(Vector(settings.EMBEDDING_DIM), nullable=False)
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


class Notification(Base):
    """An in-app notification for a single user, generated server-side in response
    to events elsewhere in the system (enrollment, upload processing, graph review,
    etc.) - see app/notifications/service.py for the emitters and
    app/notifications/types.py for the fixed set of `type` values."""
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    # Frontend route to navigate to when the notification is clicked, e.g.
    # "/course/12". Nullable since some notifications (e.g. account approved) have
    # no natural destination beyond the dashboard the user is already on.
    link = Column(String, nullable=True)
    # Drives icon/color on the frontend: "info" | "success" | "warning" | "error"
    priority = Column(String, nullable=False, default="info")
    is_read = Column(Boolean, default=False, nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)
    read_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="notifications")


class NotificationPreference(Base):
    """Per-user opt-out toggles for notification creation, one row per user - created
    lazily on first GET /notification-preferences/me (see
    app/notification_preferences/routes.py). Each column gates one or more
    NotificationType values - see NOTIFICATION_TYPE_TO_PREFERENCE_FIELD in
    app/notifications/service.py for the exact mapping, which is where these columns
    are actually enforced (create_notification/notify_many skip creation when the
    relevant column is False). All default True so existing/new users keep receiving
    everything until they explicitly opt out, mirroring Google Classroom's
    default-on behavior. Classroom's per-class "Class notifications" overrides are
    intentionally NOT modeled here (global toggles only) - noted as a future gap."""
    __tablename__ = "notification_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)

    # Classroom's "Classes you're enrolled in - work and other posts from teachers":
    # announcements, materials, meetings, and new processed course content.
    course_posts = Column(Boolean, default=True, nullable=False)
    # Classroom's due-date reminders / new classwork: assignment_posted.
    assignment_updates = Column(Boolean, default=True, nullable=False)
    # Classroom's "Returned work and grades". This app has no grade-returned
    # notification yet (left to the separate Assignment Evaluation module), so for
    # now this gates the closest existing analogue, assignment_submitted
    # (teacher-facing "a student turned something in").
    grading_updates = Column(Boolean, default=True, nullable=False)
    # Classroom's "Invitations to join classes as a student": enrollment_joined
    # (student side) and enrollment_new_student (teacher side).
    enrollment_updates = Column(Boolean, default=True, nullable=False)
    # No direct Classroom equivalent - this app's content pipeline (file
    # parsing/RAG + concept graph review) has its own async status separate from
    # a teacher's regular posts, so it gets its own toggle rather than being folded
    # into course_posts: file_processing_completed/failed, graph_approved/rejected.
    content_processing_updates = Column(Boolean, default=True, nullable=False)
    # Account/staffing lifecycle: teacher_request_submitted (-> admins) and
    # account_approved (-> newly approved staff user).
    system_updates = Column(Boolean, default=True, nullable=False)

    user = relationship("User")


class ChatMessage(Base):
    """A single message in a user's ongoing AI assistant conversation (the
    "Gemini"-style sidebar chat, OpenAI-backed - see app/assistant/). One
    continuous thread per user for this first pass, not scoped per-course."""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String, nullable=False)  # "user" | "assistant"
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    user = relationship("User")


class Announcement(Base):
    """A teacher's post to a course's class stream (Google Classroom-style). Visible
    to the teacher and any user with course access (see courses/access.py) - students
    only once actively enrolled."""
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), index=True)
    updated_at = Column(DateTime, nullable=True)

    course = relationship("Course")
    teacher = relationship("User")


class Assignment(Base):
    """A teacher-posted assignment ("Classwork" in Google Classroom terms) with an
    optional due date, point value, and reference attachment. Submissions live in
    AssignmentSubmission, including the grade/feedback fields AI evaluation writes
    (see app/assignments/routes.py grade_submission / grading_service.py)."""
    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    due_date = Column(DateTime, nullable=True)
    points = Column(Integer, nullable=True)
    # Teacher's own reference material for the assignment (instructions, template) -
    # distinct from what students submit back (see AssignmentSubmission.file_url).
    attachment_url = Column(String, nullable=True)
    attachment_filename = Column(String, nullable=True)
    # Set when this assignment was created from an AI-generated, concept-grounded
    # draft (see content_generation/routes.py create_assignment_from_content) -
    # null for a plain manually-created assignment. Same convention as
    # GeneratedContent.concept_node_id/concept_name; kept here too (rather than
    # only on the now-approved GeneratedContent row) so the concept origin survives
    # for the assignment's whole lifetime, not just until approval.
    concept_node_id = Column(String, nullable=True)
    concept_name = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)
    updated_at = Column(DateTime, nullable=True)

    course = relationship("Course")
    teacher = relationship("User")
    submissions = relationship("AssignmentSubmission", back_populates="assignment", cascade="all, delete-orphan")


class AssignmentSubmission(Base):
    """A single student's submission for an assignment. Resubmitting before the
    teacher grades it overwrites the file/timestamp in place (one row per student)."""
    __tablename__ = "assignment_submissions"
    __table_args__ = (
        UniqueConstraint("assignment_id", "student_id", name="uq_assignment_student_submission"),
    )

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    file_url = Column(String, nullable=False)
    file_filename = Column(String, nullable=False)
    submitted_at = Column(DateTime, server_default=func.now())
    is_late = Column(Boolean, default=False, nullable=False)
    # Left nullable for the (separate) Assignment Evaluation module to populate.
    grade = Column(Float, nullable=True)
    feedback = Column(Text, nullable=True)
    # Per-criterion breakdown from the assignment's Rubric, if one exists at grading
    # time - [{"criterion_id": ..., "title": ..., "score": ..., "max_points": ...,
    # "clo_id": ..., "feedback": ...}, ...]. Null for a submission graded before a
    # rubric existed, or when the assignment has none - the UI falls back to the
    # plain overall grade/feedback in that case. Added post-ship, so nullable - see
    # scripts/add_clo_and_rubric_columns.py.
    rubric_scores_json = Column(Text, nullable=True)
    # Review gate for an AI grade, mirroring GraphRevision/GeneratedContent
    # elsewhere in this app: "Ungraded" (never graded) -> "PendingReview" (AI has
    # produced grade/feedback above, but they are a proposal only - not yet shown
    # to the student, no CLOAttainment/mastery/notification side effects run yet)
    # -> "Approved" (teacher approved as-is, or a manual override - now visible to
    # the student, side effects have run). See app/assignments/routes.py
    # grade_submission / approve_grade / reject_grade / override_grade.
    grade_status = Column(String, nullable=False, default="Ungraded")
    # Single-flight guard against a double "Grade"/"Re-grade" click (or a slow
    # request's retry) running two AI grading passes concurrently, which would
    # double-count CLOAttainment/mastery evidence. Set to the current time at the
    # start of grade_submission via an atomic conditional UPDATE, cleared in a
    # finally block - a stale lock older than GRADING_LOCK_TIMEOUT_SECONDS
    # (routes.py) is treated as abandoned (e.g. the process crashed mid-grade)
    # rather than wedging the submission un-gradeable forever.
    grading_locked_at = Column(DateTime, nullable=True)

    assignment = relationship("Assignment", back_populates="submissions")
    student = relationship("User")


class Material(Base):
    """A teacher-posted resource/multimedia post ("Material" in Google Classroom
    terms) - no due date, no grading, just reference content for students. Either an
    uploaded attachment, an external link, or both may be set (see
    app/materials/routes.py, which reuses app/upload/services.py the same way
    Assignment.attachment_url does)."""
    __tablename__ = "materials"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    attachment_url = Column(String, nullable=True)
    attachment_filename = Column(String, nullable=True)
    external_link = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)
    updated_at = Column(DateTime, nullable=True)

    course = relationship("Course")
    teacher = relationship("User")


class Meeting(Base):
    """A teacher-posted live-session/lecture link (e.g. Zoom/Meet) with a scheduled
    time - purely informational, the app itself does not host the call."""
    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    meeting_link = Column(String, nullable=False)
    scheduled_at = Column(DateTime, nullable=False)
    duration_minutes = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)
    updated_at = Column(DateTime, nullable=True)

    course = relationship("Course")
    teacher = relationship("User")


class Comment(Base):
    """A private note thread on a piece of course content (assignment,
    announcement, or material). Only the author and the course's teacher(s)
    can see a given thread - other students never see each other's comments,
    keeping this a 1:1 student<->teacher channel rather than a public reply
    feed."""
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    target_type = Column(String, nullable=False, index=True)  # "assignment" | "announcement" | "material"
    target_id = Column(Integer, nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    course = relationship("Course")
    author = relationship("User")


class ProgramCoordinatorAssignment(Base):
    """M2M: which Program(s) a given Program Coordinator user is scoped to. Absence of
    any row for a user does NOT mean unrestricted access - only "admin" role bypasses
    scoping entirely (see auth/routes.py resolve_program_ids)."""
    __tablename__ = "program_coordinator_assignments"
    __table_args__ = (
        UniqueConstraint("user_id", "program_id", name="uq_program_coordinator_assignment"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", backref="program_coordinator_assignments")
    program = relationship("Program", backref="coordinator_assignments")


class CourseCoordinatorAssignment(Base):
    """Which catalog SUBJECT a Course Coordinator is scoped to - not a specific
    running section. This matters because the concept graph itself is shared
    per catalog subject (see knowledge_graph/services.py Neo4jService), so a
    coordinator's approval authority over graph revisions naturally applies to
    the subject, not to whichever section happens to exist. It also lets a
    coordinator be assigned to a subject (e.g. "Applied Physics") before any
    teacher has created a running section for it yet.

    course_id is kept, nullable, only for the older exclusive-role assignment
    path (auth/routes.py change_staff_role) which predates this catalog-based
    model and still writes section-level rows - resolve_catalog_ids() in
    auth/routes.py reads both and unions them into one scope. New assignments
    (courses/routes.py assign_course_coordinator) only ever set catalog_id."""
    __tablename__ = "course_coordinator_assignments"
    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_course_coordinator_assignment"),
        UniqueConstraint("user_id", "catalog_id", name="uq_course_coordinator_catalog_assignment"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=True, index=True)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", backref="course_coordinator_assignments")
    course = relationship("Course", backref="coordinator_assignments")
    catalog_entry = relationship("CourseCatalog")


class ConceptMastery(Base):
    """Per-student, per-concept mastery score (0-100) - the shared observation signal
    that Assignment Evaluation grading writes into, and that Gamification/Analytics/
    the Adaptive Engine read from. Concepts live in Neo4j (see
    knowledge_graph/services.py build_node_id), not as a SQL table, so
    concept_node_id is that same deterministic string id rather than a foreign key -
    concept_name is denormalized alongside it purely so callers can render/sort
    without a graph round-trip.

    mastery_score is a running average of every graded evidence signal
    (evidence_count tracks how many), not just the latest one - one weak assignment
    shouldn't erase several strong quizzes, and vice versa. See
    app/mastery/service.py record_evidence for the update math."""
    __tablename__ = "concept_mastery"
    __table_args__ = (
        UniqueConstraint("student_id", "catalog_id", "concept_node_id", name="uq_student_concept_mastery"),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=False, index=True)
    concept_node_id = Column(String, nullable=False, index=True)
    concept_name = Column(String, nullable=False)
    mastery_score = Column(Float, default=0.0, nullable=False)
    evidence_count = Column(Integer, default=0, nullable=False)
    last_updated = Column(DateTime, server_default=func.now(), onupdate=func.now())

    student = relationship("User")
    course = relationship("Course")


class MasteryEvidence(Base):
    """Audit trail of exactly what fed each mastery update - one row per grading
    event, e.g. "assignment #12 -> concept 'derivatives' -> scored 72/100". Kept
    separate from ConceptMastery (which only holds the current rolled-up score) so
    the Adaptive Engine and Analytics Dashboard can show *why* a score is what it is,
    not just the number."""
    __tablename__ = "mastery_evidence"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    concept_node_id = Column(String, nullable=False, index=True)
    concept_name = Column(String, nullable=False)
    source_type = Column(String, nullable=False)  # "assignment" | "quiz"
    source_id = Column(Integer, nullable=False)  # AssignmentSubmission.id or (future) quiz attempt id
    score = Column(Float, nullable=False)  # 0-100 for this concept, this one signal
    created_at = Column(DateTime, server_default=func.now(), index=True)

    student = relationship("User")
    course = relationship("Course")


class GeneratedContent(Base):
    """One AI-generated learning artifact (flashcard set, MCQ set, quiz, or study
    guide) tied to a single knowledge-graph concept - the Content Generation
    module. Nothing is visible to students until a teacher approves it (same
    review-gate pattern as GraphRevision/GraphEditProposal), per the proposal's
    "teachers can review, edit, and approve all AI-generated outputs" requirement.

    payload_json's shape depends on content_type - see
    app/content_generation/schemas.py for the exact structure of each:
    - "flashcard": {"cards": [{"front": ..., "back": ...}, ...]}
    - "mcq" / "quiz": {"questions": [{"question": ..., "options": [...], "correct_index": ..., "explanation": ...}, ...]}
    - "study_guide": {"summary": ..., "key_points": [...]}
    """
    __tablename__ = "generated_content"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=False, index=True)
    concept_node_id = Column(String, nullable=False, index=True)
    concept_name = Column(String, nullable=False)
    content_type = Column(String, nullable=False)  # "flashcard" | "mcq" | "quiz" | "study_guide"
    title = Column(String, nullable=False)
    payload_json = Column(Text, nullable=False)
    # Added after this table shipped, so nullable with a default rather than NOT NULL -
    # backfilled to "Medium" for existing rows by scripts/add_difficulty_column.py.
    # Matches the per-concept difficulty vocabulary the extraction prompt already
    # emits (app/content_processing/kimi_service.py), so a concept's own difficulty
    # can seed the selector's default.
    difficulty = Column(String, nullable=False, default="Medium")  # "Easy" | "Medium" | "Hard"
    # How many retrieved course-material excerpts this item was generated from.
    # 0 means it came from the concept description alone (no material uploaded, or
    # nothing matched), which the review UI shows so a teacher knows how much to
    # scrutinise it. Also added post-ship - see scripts/add_difficulty_column.py.
    grounded_excerpts = Column(Integer, nullable=False, default=0)
    # The language the learner-facing text was written in. Stored rather than inferred
    # because the viewer needs it to read a card aloud in the right accent - a Spanish
    # card spoken by an English voice is worse than no audio at all for a language
    # course. Free text, since generation accepts any language the model can write.
    # Also added post-ship - see scripts/add_language_column.py.
    language = Column(String, nullable=False, default="English")
    # Which Course Learning Outcome this item was generated to support, chosen by the
    # teacher from the course catalog's CLO list at generation time (see the
    # "Link to CLO" dropdown in the Content Generation UI). Nullable - most content
    # generated before this field existed, and not every item needs one. Added
    # post-ship - see scripts/add_clo_and_rubric_columns.py.
    clo_id = Column(Integer, ForeignKey("clos.id"), nullable=True, index=True)

    status = Column(String, default="PendingReview", nullable=False)  # "PendingReview", "Approved", "Rejected"
    created_by_teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reviewed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())

    course = relationship("Course")
    creator = relationship("User", foreign_keys=[created_by_teacher_id])


class ContentGenerationJob(Base):
    """One background content-generation request.

    WHY GENERATION IS A JOB AND NOT A REQUEST
    -----------------------------------------
    Generating a set is an LLM call with up to three validation retries; it routinely
    takes 30-90 seconds and can exceed a proxy's idle timeout. Holding an HTTP request
    open for that long means the teacher must sit and watch a spinner, a refresh loses
    the work, and a browser or gateway timeout destroys a set that was actually
    generated fine server-side.

    So the request now returns immediately with a job id, the work happens in the
    background, and the teacher is told through a notification when it lands. That
    also makes queueing several sets in a row possible, which is what building out a
    whole course actually looks like.

    request_json stores the original GenerateContentRequest so a failed job can be
    retried verbatim without the teacher re-entering anything.
    """
    __tablename__ = "content_generation_jobs"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # "Queued" -> "Running" -> "Completed" | "Failed"
    status = Column(String, nullable=False, default="Queued", index=True)
    # Shown verbatim in the progress modal, so it reads as a step rather than a spinner:
    # "Finding relevant course material", "Writing 8 flashcards", ...
    stage = Column(String, nullable=True)

    concept_node_id = Column(String, nullable=True, index=True)
    concept_name = Column(String, nullable=True)
    content_type = Column(String, nullable=False)
    difficulty = Column(String, nullable=False, default="Medium")
    request_json = Column(Text, nullable=False, default="{}")

    # Set once the job succeeds; this is what the "View it" action links to.
    result_content_id = Column(Integer, ForeignKey("generated_content.id"), nullable=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), index=True)
    completed_at = Column(DateTime, nullable=True)

    course = relationship("Course")
    teacher = relationship("User")
    result = relationship("GeneratedContent")


class QuizAttempt(Base):
    """One student's attempt at a "quiz"/"mcq" GeneratedContent item. Scoring is
    purely mechanical (compare selected_index to the stored correct_index - no AI
    call needed, so this is instant and free) - the resulting score feeds
    ConceptMastery via app/mastery/service.py, same as Assignment Evaluation does."""
    __tablename__ = "quiz_attempts"

    id = Column(Integer, primary_key=True, index=True)
    content_id = Column(Integer, ForeignKey("generated_content.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    answers_json = Column(Text, nullable=False)  # list[int] - selected option index per question, in order
    score = Column(Float, nullable=False)  # 0-100
    completed_at = Column(DateTime, server_default=func.now())

    content = relationship("GeneratedContent")
    student = relationship("User")


class LiveQuizSession(Base):
    """A hosted, real-time quiz round that several people play at once.

    The whole point of this table is that live play needs SERVER-side state. Which
    question is currently on screen, and when it was pushed, cannot live in the host's
    browser: a host who refreshes mid-game would otherwise reset everyone, and a
    player who joins late would have no way to find out where the game is up to. Every
    connected client renders from this row.

    access_code is the join key - short, unambiguous and unique among LIVE sessions
    only, so codes can be recycled once a game ends rather than being burned forever.
    question_ids_json snapshots the questions at start time, so editing the bank
    mid-game cannot change the paper underneath the players.
    """
    __tablename__ = "live_quiz_sessions"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    host_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    access_code = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    question_ids_json = Column(Text, nullable=False, default="[]")

    # "waiting" (lobby) -> "question" (a question is live) -> "reveal" (answers shown)
    # -> ... -> "ended". Players poll/receive this and render accordingly.
    status = Column(String, nullable=False, default="waiting")
    current_index = Column(Integer, nullable=False, default=-1)  # -1 = not started
    # When the current question was pushed. The per-question countdown and the speed
    # bonus are both computed from this server timestamp, never the client's clock.
    question_started_at = Column(DateTime, nullable=True)
    seconds_per_question = Column(Integer, nullable=False, default=30)
    # Awards up to this many extra points for answering fastest, on top of the
    # question's own points. Set to 0 for a plain correctness-only game.
    speed_bonus_max = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, server_default=func.now(), index=True)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)

    course = relationship("Course")
    host = relationship("User")


class LiveQuizParticipant(Base):
    """One player in a live session.

    nickname is what everyone else sees, so a student can stay anonymous on the
    leaderboard while still being linked to their account for progress. user_id is
    nullable to leave room for guest play, but every join today is authenticated.
    """
    __tablename__ = "live_quiz_participants"
    __table_args__ = (
        UniqueConstraint("session_id", "nickname", name="uq_live_session_nickname"),
    )

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("live_quiz_sessions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    nickname = Column(String, nullable=False)
    score = Column(Float, nullable=False, default=0.0)
    correct_count = Column(Integer, nullable=False, default=0)
    joined_at = Column(DateTime, server_default=func.now())

    session = relationship("LiveQuizSession")
    user = relationship("User")


class LiveQuizAnswer(Base):
    """One player's answer to one live question.

    Stored per answer rather than aggregated onto the participant because the host
    view shows the distribution across options after each question ("which answer did
    people pick?"), and that is only reconstructable if individual responses are kept.
    The unique constraint is what makes a double-submit harmless.
    """
    __tablename__ = "live_quiz_answers"
    __table_args__ = (
        UniqueConstraint("session_id", "participant_id", "question_index", name="uq_live_answer_once"),
    )

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("live_quiz_sessions.id"), nullable=False, index=True)
    participant_id = Column(Integer, ForeignKey("live_quiz_participants.id"), nullable=False, index=True)
    question_index = Column(Integer, nullable=False)
    question_id = Column(Integer, ForeignKey("question_bank_items.id"), nullable=False)
    response_json = Column(Text, nullable=True)
    correct = Column(Boolean, nullable=False, default=False)
    points_awarded = Column(Float, nullable=False, default=0.0)
    # Seconds between the question being pushed and this answer arriving - drives the
    # speed bonus and the "how fast was the room" readout.
    answered_in_seconds = Column(Float, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class QuestionBankItem(Base):
    """One reusable question, independent of any single quiz - the exam builder's
    unit of currency.

    WHY A BANK RATHER THAN MORE GeneratedContent
    --------------------------------------------
    GeneratedContent stores a whole *set* as one JSON blob tied to one concept. That
    is right for "here are 8 flashcards on Limits", but wrong for building an exam:
    an exam pulls individual questions from many concepts, reuses the same question
    across terms, and needs per-question settings (points, a time limit). Those are
    properties of a question, not of a set, so questions get their own rows.

    question_type drives both the payload shape and the grading rule
    (app/question_bank/service.py owns both):
      single_choice - {"options": [...], "correct_index": n}
      multi_select  - {"options": [...], "correct_indices": [n, ...]}
      true_false    - {"correct": true|false}
      fill_blank    - {"accepted": ["...", "..."], "case_sensitive": false}
      matching      - {"pairs": [{"left": "...", "right": "..."}, ...]}

    Concepts are referenced by node id + denormalized name, never a FK, because they
    live in Neo4j (same convention as ConceptMastery/GeneratedContent).
    """
    __tablename__ = "question_bank_items"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=True, index=True)
    concept_node_id = Column(String, nullable=True, index=True)
    concept_name = Column(String, nullable=True)

    question_type = Column(String, nullable=False, index=True)  # see docstring for the five shapes
    prompt = Column(Text, nullable=False)
    payload_json = Column(Text, nullable=False)  # type-specific answer data
    explanation = Column(Text, nullable=True)
    difficulty = Column(String, nullable=False, default="Medium")  # "Easy" | "Medium" | "Hard"
    points = Column(Integer, nullable=False, default=1)
    # Per-question countdown, in seconds. Null means "no limit for this question";
    # an exam-wide limit is stored on Exam instead.
    time_limit_seconds = Column(Integer, nullable=True)

    # "generated" (AI), "imported" (lifted out of a GeneratedContent set), "manual".
    source = Column(String, nullable=False, default="generated")
    source_content_id = Column(Integer, ForeignKey("generated_content.id"), nullable=True)
    status = Column(String, nullable=False, default="Approved")  # "Approved" | "PendingReview" | "Retired"
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    course = relationship("Course")
    creator = relationship("User", foreign_keys=[created_by_id])


class Exam(Base):
    """A teacher-assembled assessment drawn from the question bank, with the delivery
    settings that make it an exam rather than a practice set.

    question_ids_json holds an ordered list of QuestionBankItem ids rather than a join
    table: order is part of the exam, the list is short, and it is only ever read as a
    whole. A question deleted from the bank is skipped at delivery time rather than
    cascading - retiring a question should never silently shorten a live exam without
    the teacher noticing, so the exam reports the discrepancy instead.
    """
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    question_ids_json = Column(Text, nullable=False, default="[]")

    # ── delivery settings ──
    time_limit_seconds = Column(Integer, nullable=True)     # whole-exam limit; null = untimed
    shuffle_questions = Column(Boolean, nullable=False, default=True)
    shuffle_options = Column(Boolean, nullable=False, default=True)
    max_attempts = Column(Integer, nullable=False, default=1)   # 0 = unlimited
    pass_mark = Column(Float, nullable=False, default=50.0)     # percentage
    # Whether a student sees which questions they got wrong, and the explanations,
    # after submitting. Off for a real assessment, on for practice.
    show_answers_after = Column(Boolean, nullable=False, default=True)

    status = Column(String, nullable=False, default="Draft")  # "Draft" | "Published" | "Closed"
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    course = relationship("Course")
    creator = relationship("User", foreign_keys=[created_by_id])


class ExamAttempt(Base):
    """One student's sitting of an Exam.

    responses_json stores the raw submitted answer per question keyed by question id,
    so a regrade after a corrected answer key is possible without asking students to
    re-sit. started_at exists so a timed exam can be enforced against the server's
    clock rather than the client's.
    """
    __tablename__ = "exam_attempts"

    id = Column(Integer, primary_key=True, index=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    attempt_number = Column(Integer, nullable=False, default=1)

    question_order_json = Column(Text, nullable=False, default="[]")  # ids in the order served
    responses_json = Column(Text, nullable=True)     # {question_id: raw response}
    score = Column(Float, nullable=True)             # percentage, null until submitted
    points_earned = Column(Float, nullable=True)
    points_possible = Column(Float, nullable=True)
    passed = Column(Boolean, nullable=True)

    started_at = Column(DateTime, server_default=func.now())
    submitted_at = Column(DateTime, nullable=True)

    exam = relationship("Exam")
    student = relationship("User")


class StudyCardState(Base):
    """One student's spaced-repetition state for ONE item inside a GeneratedContent
    payload - the engine behind the "Learn" study mode.

    Scheduling is a Leitner box system, deliberately, rather than SM-2/Anki-style
    interval math: boxes are trivial to explain to a student ("you got it wrong, it
    goes back to box 1"), need no per-card ease factor, and behave sensibly when a
    student does one burst of study a week before an exam - which is the actual usage
    pattern here. Box 0 = brand new, box 5 = well known. A correct answer promotes one
    box, a wrong answer drops it straight back to 0.

    The item is addressed by (content_id, item_index) rather than a foreign key,
    because payload items are positions inside a JSON blob, not rows. If a teacher
    edits an item the index is preserved; if they delete one, the orphaned state row
    is harmless and is filtered out when the queue is built.
    """
    __tablename__ = "study_card_states"
    __table_args__ = (
        UniqueConstraint("student_id", "content_id", "item_index", name="uq_student_content_card"),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    content_id = Column(Integer, ForeignKey("generated_content.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    item_index = Column(Integer, nullable=False)  # position within payload cards/questions
    box = Column(Integer, nullable=False, default=0)  # 0 (new/failed) .. 5 (mastered)
    correct_streak = Column(Integer, nullable=False, default=0)
    times_seen = Column(Integer, nullable=False, default=0)
    times_correct = Column(Integer, nullable=False, default=0)
    # When this card becomes eligible again. Nullable so a brand-new card is always due.
    due_at = Column(DateTime, nullable=True, index=True)
    last_seen_at = Column(DateTime, nullable=True)

    student = relationship("User")
    content = relationship("GeneratedContent")


class StudySession(Base):
    """A completed run of one study mode, kept so practice shows up in analytics
    alongside quizzes and games rather than vanishing.

    mode is the study mode played: "learn" | "test" | "match". Scores from test and
    match feed ConceptMastery through mastery_service exactly as a quiz attempt does;
    "learn" is self-paced drilling and records progress without a single headline
    score, so its score column holds the session's accuracy percentage.
    """
    __tablename__ = "study_sessions"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    content_id = Column(Integer, ForeignKey("generated_content.id"), nullable=True, index=True)
    concept_node_id = Column(String, nullable=True, index=True)
    concept_name = Column(String, nullable=True)
    mode = Column(String, nullable=False)  # "learn" | "test" | "match"
    score = Column(Float, nullable=False)  # 0-100 accuracy for this session
    items_total = Column(Integer, nullable=False, default=0)
    items_correct = Column(Integer, nullable=False, default=0)
    duration_seconds = Column(Integer, nullable=True)  # match mode is timed; null elsewhere
    created_at = Column(DateTime, server_default=func.now(), index=True)

    student = relationship("User")


class GeneratedGame(Base):
    """A self-contained, playable HTML mini-game teaching one knowledge-graph
    concept - the interactive half of the Gamification module. A student picks a
    concept, the model authors a complete standalone page, and it is served to a
    new browser tab from app/gamification/game_routes.py.

    Stored rather than regenerated per play for three reasons: authoring a whole
    page is the most expensive generation call in the project, a student
    replaying a game should get the same game, and a stored page can be
    inspected by a teacher after the fact.

    html_source holds an ENTIRE standalone document (doctype through </html>)
    with all CSS and JS inlined - it must not reference any external asset,
    because it is served from a sandboxed endpoint with a restrictive CSP.
    Concepts are referenced by node id + denormalized name, never a FK, since
    they live in Neo4j (same convention as ConceptMastery/GeneratedContent).
    """
    __tablename__ = "generated_games"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=False, index=True)
    concept_node_id = Column(String, nullable=False, index=True)
    concept_name = Column(String, nullable=False)
    title = Column(String, nullable=False)
    game_kind = Column(String, nullable=True)  # model's own label for what it built, e.g. "matching", "quiz-runner"
    difficulty = Column(String, nullable=False, default="Medium")  # "Easy" | "Medium" | "Hard"
    html_source = Column(Text, nullable=False)  # complete standalone document, all assets inlined
    created_by_student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    course = relationship("Course")
    creator = relationship("User", foreign_keys=[created_by_student_id])


class GamePlay(Base):
    """One student's completed play of a GeneratedGame. Mirrors QuizAttempt so a
    game can feed ConceptMastery as observation evidence exactly like a quiz
    does - the game page reports its own score back via the play endpoint."""
    __tablename__ = "game_plays"

    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("generated_games.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    score = Column(Float, nullable=False)  # 0-100, self-reported by the game page
    completed_at = Column(DateTime, server_default=func.now())

    game = relationship("GeneratedGame")
    student = relationship("User")


class Badge(Base):
    """A fixed, seeded catalog of achievements (see app/gamification/seed.py) -
    deliberately rule-based rather than AI-generated, since a rewards system needs
    to be fair and deterministic, not subject to LLM variance. `code` is the stable
    identifier the awarding logic (app/gamification/service.py) checks against."""
    __tablename__ = "badges"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    icon = Column(String, nullable=False)  # emoji, kept simple - no icon asset pipeline needed
    points_reward = Column(Integer, default=0, nullable=False)


class StudentBadge(Base):
    """One student earning one badge, once. course_id is null for badges that are
    student-wide (e.g. a login/activity streak) rather than tied to a single
    course's concepts."""
    __tablename__ = "student_badges"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    badge_id = Column(Integer, ForeignKey("badges.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    earned_at = Column(DateTime, server_default=func.now())

    student = relationship("User")
    badge = relationship("Badge")


class StudentPoints(Base):
    """Running points total + activity streak for one student in one course - the
    data a leaderboard and streak-based badges read from. Updated by
    app/gamification/service.py.award_points, called whenever a quiz is completed
    or an assignment is graded (see content_generation/routes.py, assignments/routes.py)."""
    __tablename__ = "student_points"
    __table_args__ = (
        UniqueConstraint("student_id", "course_id", name="uq_student_points_course"),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    total_points = Column(Integer, default=0, nullable=False)
    current_streak_days = Column(Integer, default=0, nullable=False)
    longest_streak_days = Column(Integer, default=0, nullable=False)
    last_activity_date = Column(Date, nullable=True)

    student = relationship("User")
    course = relationship("Course")


class PointsLedgerEntry(Base):
    """Audit trail of every points award - one row per event, so a student can see
    *why* they have the points they have, not just the running total."""
    __tablename__ = "points_ledger"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    points = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)
    source_type = Column(String, nullable=False)  # "assignment" | "quiz" | "streak" | "badge"
    source_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class GraphBuildJob(Base):
    """Tracks one run of the content-processing pipeline (Kimi cleaning/structuring →
    diff against the shared catalog graph → teacher/coordinator review), from trigger
    to merge. A course's catalog may accumulate many jobs over time as different
    teachers upload more material."""
    __tablename__ = "graph_build_jobs"

    id = Column(Integer, primary_key=True, index=True)
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)  # the section that triggered it
    triggered_by_teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # "Queued", "ExtractingText", "CleaningAndStructuring", "Diffing",
    # "AwaitingTeacherReview", "AwaitingCoordinatorApproval", "Merged", "Rejected", "Failed"
    status = Column(String, default="Queued", nullable=False)

    teacher_notes = Column(Text, nullable=True)  # optional free-text hint fed into the Kimi prompt
    airflow_run_id = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class GraphRevision(Base):
    """A proposed change-set to a catalog course's shared concept graph, produced by
    one GraphBuildJob. Nothing here is written to Neo4j until status == 'Approved'."""
    __tablename__ = "graph_revisions"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("graph_build_jobs.id"), nullable=False)
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=False)

    is_initial = Column(Boolean, default=False, nullable=False)  # True if the catalog had no graph yet
    diff_json = Column(Text, nullable=False)  # JSON: added/modified concepts + relationships

    submitted_by_teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # "PendingTeacherReview", "PendingCoordinatorApproval", "Approved", "Rejected"
    status = Column(String, default="PendingTeacherReview", nullable=False)

    teacher_reviewed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    teacher_reviewed_at = Column(DateTime, nullable=True)
    teacher_edit_notes = Column(Text, nullable=True)

    coordinator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    coordinator_decision_at = Column(DateTime, nullable=True)
    coordinator_notes = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())


class GraduateAttribute(Base):
    """A fixed, institution-wide Graduate Attribute (GA) - the top of the outcome
    chain in an Outcome-Based Education (OBE) model: Concept -> CLO -> PLO -> GA.
    Global (not scoped to a Program), mirroring how accreditation bodies (e.g. PEC's
    12 GAs for engineering) define a single shared list every program's PLOs map
    into. Mirrored into Neo4j as a `GA` node (see app/outcomes/services.py) so the
    knowledge graph can render/traverse the full outcome chain, not just Concepts."""
    __tablename__ = "graduate_attributes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, nullable=False, unique=True)  # e.g. "GA1"
    title = Column(String, nullable=False)  # e.g. "Engineering Knowledge"
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class PLO(Base):
    """A Program Learning Outcome, scoped to one Program - what a graduate of that
    program should be able to do. Maps up to one or more GraduateAttributes
    (PLOGAMap) and down to one or more CLOs (CLOPLOMap)."""
    __tablename__ = "plos"
    __table_args__ = (
        UniqueConstraint("program_id", "code", name="uq_plo_program_code"),
    )

    id = Column(Integer, primary_key=True, index=True)
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=False, index=True)
    code = Column(String, nullable=False)  # e.g. "PLO1", scoped unique per program
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    program = relationship("Program")


class PLOGAMap(Base):
    """M2M: which GraduateAttribute(s) a PLO maps up to."""
    __tablename__ = "plo_ga_map"
    __table_args__ = (
        UniqueConstraint("plo_id", "ga_id", name="uq_plo_ga_map"),
    )

    id = Column(Integer, primary_key=True, index=True)
    plo_id = Column(Integer, ForeignKey("plos.id"), nullable=False, index=True)
    ga_id = Column(Integer, ForeignKey("graduate_attributes.id"), nullable=False, index=True)

    plo = relationship("PLO")
    ga = relationship("GraduateAttribute")


class CLO(Base):
    """A Course Learning Outcome, scoped to a CourseCatalog subject (shared across
    every section/teacher teaching that catalog entry, same scoping as the concept
    graph itself - see Neo4jService's catalog_id-keyed Concept nodes). Maps up to
    one or more PLOs (CLOPLOMap) and links down to the concepts that address it
    (ConceptCLOMap) and to the rubric criteria that assess it (RubricCriterion.clo_id)."""
    __tablename__ = "clos"
    __table_args__ = (
        UniqueConstraint("catalog_id", "code", name="uq_clo_catalog_code"),
    )

    id = Column(Integer, primary_key=True, index=True)
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=False, index=True)
    code = Column(String, nullable=False)  # e.g. "CLO1", scoped unique per catalog subject
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    catalog_entry = relationship("CourseCatalog")


class CLOPLOMap(Base):
    """M2M: which PLO(s) a CLO maps up to."""
    __tablename__ = "clo_plo_map"
    __table_args__ = (
        UniqueConstraint("clo_id", "plo_id", name="uq_clo_plo_map"),
    )

    id = Column(Integer, primary_key=True, index=True)
    clo_id = Column(Integer, ForeignKey("clos.id"), nullable=False, index=True)
    plo_id = Column(Integer, ForeignKey("plos.id"), nullable=False, index=True)

    clo = relationship("CLO")
    plo = relationship("PLO")


class ConceptCLOMap(Base):
    """Links one knowledge-graph Concept to one CLO. Concepts live in Neo4j, not as a
    SQL table (same convention as ConceptMastery/GeneratedContent), so concept_node_id
    is the deterministic string id (see knowledge_graph/services.py build_node_id),
    not a foreign key. This is the Postgres source of truth; app/outcomes/services.py
    mirrors it into Neo4j as an (Concept)-[:ADDRESSES]->(CLO) relationship so the
    graph itself can be queried/visualized with the full Concept -> CLO -> PLO -> GA
    chain, not just prerequisites."""
    __tablename__ = "concept_clo_map"
    __table_args__ = (
        UniqueConstraint("catalog_id", "concept_node_id", "clo_id", name="uq_concept_clo_map"),
    )

    id = Column(Integer, primary_key=True, index=True)
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=False, index=True)
    concept_node_id = Column(String, nullable=False, index=True)
    concept_name = Column(String, nullable=False)
    clo_id = Column(Integer, ForeignKey("clos.id"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())

    clo = relationship("CLO")


class Rubric(Base):
    """One grading rubric, one per Assignment - shared across every student's
    submission in that class (grading always reads THIS row, never a per-student
    copy). AI-drafted from the assignment brief + the course's own RAG-retrieved
    material (see app/assignments/rubric_service.py), then shown to the teacher at
    assignment-creation time to edit/approve before it's used for grading."""
    __tablename__ = "rubrics"

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=False, unique=True, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # "Draft" (AI-generated, not yet reviewed) | "Published" (teacher approved/edited -
    # this is the version grading uses). Mirrors the review-gate pattern used by
    # GraphRevision/GeneratedContent elsewhere in this app.
    status = Column(String, nullable=False, default="Draft")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    assignment = relationship("Assignment", backref="rubric", uselist=False)
    criteria = relationship(
        "RubricCriterion", back_populates="rubric",
        cascade="all, delete-orphan", order_by="RubricCriterion.order_index",
    )


class RubricCriterion(Base):
    """One row of a Rubric - what is being graded, out of how many points, and
    (optionally) which CLO it is evidence for. A criterion with no clo_id still
    grades normally, it just doesn't roll into CLO attainment."""
    __tablename__ = "rubric_criteria"

    id = Column(Integer, primary_key=True, index=True)
    rubric_id = Column(Integer, ForeignKey("rubrics.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    max_points = Column(Float, nullable=False, default=10.0)
    clo_id = Column(Integer, ForeignKey("clos.id"), nullable=True, index=True)
    order_index = Column(Integer, nullable=False, default=0)

    rubric = relationship("Rubric", back_populates="criteria")
    clo = relationship("CLO")
    levels = relationship(
        "RubricLevel", back_populates="criterion",
        cascade="all, delete-orphan", order_by="RubricLevel.order_index.desc()",
    )


class RubricLevel(Base):
    """One performance level of an analytic rubric criterion (e.g. "Excellent" /
    "Good" / "Fair" / "Poor"), each with its own fixed point value and a
    description of what earns it - the standard grading-rubric grid, rather than
    a criterion being just a single free-form point count. Grading (see
    grading_service.py) picks ONE level per criterion for a submission; the
    awarded points always come from THIS row's `points`, never a number the AI
    invents - the rubric is the single source of truth for what every point on
    it is worth, the same way a human grader picks a cell in a rubric grid
    instead of free-typing a score."""
    __tablename__ = "rubric_levels"

    id = Column(Integer, primary_key=True, index=True)
    criterion_id = Column(Integer, ForeignKey("rubric_criteria.id"), nullable=False, index=True)
    label = Column(String, nullable=False)  # e.g. "Excellent", "Good", "Fair", "Poor"
    points = Column(Float, nullable=False)
    description = Column(Text, nullable=True)  # what a submission must do to earn this level
    # Highest level first (see the relationship's order_by above) - matches how a
    # rubric grid reads left-to-right / best-to-worst.
    order_index = Column(Integer, nullable=False, default=0)

    criterion = relationship("RubricCriterion", back_populates="levels")


class CLOAttainment(Base):
    """Per-student, per-CLO running attainment score (0-100) - the CLO-level mirror
    of ConceptMastery, fed by rubric-criterion scores at grading time (see
    app/assignments/routes.py grade_submission). Read by Analytics/Program
    Coordinator views to report CLO/PLO/GA attainment, not just concept mastery."""
    __tablename__ = "clo_attainment"
    __table_args__ = (
        UniqueConstraint("student_id", "course_id", "clo_id", name="uq_student_course_clo_attainment"),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    clo_id = Column(Integer, ForeignKey("clos.id"), nullable=False, index=True)
    attainment_score = Column(Float, default=0.0, nullable=False)
    evidence_count = Column(Integer, default=0, nullable=False)
    last_updated = Column(DateTime, server_default=func.now(), onupdate=func.now())

    student = relationship("User")
    course = relationship("Course")
    clo = relationship("CLO")


class CLOAttainmentEvidence(Base):
    """Audit trail behind CLOAttainment - one row per rubric-criterion score that
    fed it, mirroring MasteryEvidence's role for ConceptMastery."""
    __tablename__ = "clo_attainment_evidence"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    clo_id = Column(Integer, ForeignKey("clos.id"), nullable=False, index=True)
    source_type = Column(String, nullable=False)  # "assignment"
    source_id = Column(Integer, nullable=False)  # AssignmentSubmission.id
    score = Column(Float, nullable=False)  # 0-100 for this one criterion
    created_at = Column(DateTime, server_default=func.now(), index=True)


class PLOAttainment(Base):
    """Per-student, per-PLO attainment score (0-100) - the other half of the
    Concept -> CLO -> PLO -> GA chain that CLOAttainment never rolled up into.
    CLOPLOMap already records WHICH PLOs a CLO supports (used for tagging), but
    nothing computed a student's actual PLO-level score from it until this table -
    see app/outcomes/services.py recompute_plo_attainment, called from
    app/assignments/routes.py grade_submission right after CLOAttainment updates.

    A PLO is program-level (not course-scoped, unlike CLOAttainment) since a
    program's PLOs are meant to be demonstrated across the whole degree, not one
    course - so this is simply keyed by student + plo, not + course_id too."""
    __tablename__ = "plo_attainment"
    __table_args__ = (
        UniqueConstraint("student_id", "plo_id", name="uq_student_plo_attainment"),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    plo_id = Column(Integer, ForeignKey("plos.id"), nullable=False, index=True)
    attainment_score = Column(Float, default=0.0, nullable=False)
    # How many of the PLO's own mapped CLOs currently have any evidence at all -
    # not a running count of writes like CLOAttainment.evidence_count, since this
    # score is recomputed as an average over CLOAttainment rows each time, not
    # accumulated incrementally.
    evidence_count = Column(Integer, default=0, nullable=False)
    last_updated = Column(DateTime, server_default=func.now(), onupdate=func.now())

    student = relationship("User")
    plo = relationship("PLO")


class GraphEditProposal(Base):
    """A single manual graph edit (add/update/delete a node, add/delete a relationship)
    made by a teacher directly in the Concept Graph UI - as opposed to a bulk
    GraphRevision produced by the AI content-processing pipeline. Nothing here is
    written to Neo4j until status == 'Approved': every manual edit, not just the
    initial AI-built graph, needs course coordinator sign-off before it's live."""
    __tablename__ = "graph_edit_proposals"

    id = Column(Integer, primary_key=True, index=True)
    catalog_id = Column(Integer, ForeignKey("course_catalog.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)  # the section the teacher edited from
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # "create_node", "update_node", "delete_node", "create_relationship",
    # "delete_relationship", "update_material" (AI-generated/refined concept material)
    operation = Column(String, nullable=False)
    payload_json = Column(Text, nullable=False)  # JSON: operation-specific fields (see revision_service.py)

    # "Pending", "Approved", "Rejected"
    status = Column(String, default="Pending", nullable=False)

    coordinator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    coordinator_decision_at = Column(DateTime, nullable=True)
    coordinator_notes = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())

