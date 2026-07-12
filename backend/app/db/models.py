import enum
import uuid

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.session import Base


class UserRole(str, enum.Enum):
    student = "student"
    teacher = "teacher"
    coordinator = "coordinator"
    hod = "hod"
    admin = "admin"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(150), nullable=False)
    email = Column(String(150), unique=True, nullable=False)
    role = Column(SAEnum(UserRole, name="user_role"), nullable=False, default=UserRole.student)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CourseCatalog(Base):
    __tablename__ = "course_catalog"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(150), nullable=False)
    code = Column(String(20), unique=True, nullable=False)
    prerequisite_id = Column(UUID(as_uuid=True), ForeignKey("course_catalog.id"), nullable=True)
    # The Coordinator supervising this course across all teachers' offerings
    # of it. Metadata only for now — access is not yet restricted by this.
    coordinator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    prerequisite = relationship("CourseCatalog", remote_side=[id])
    coordinator = relationship("User", foreign_keys=[coordinator_id])


class Course(Base):
    __tablename__ = "courses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    catalog_id = Column(UUID(as_uuid=True), ForeignKey("course_catalog.id"), nullable=False)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    semester = Column(String(20), nullable=False)
    description = Column(String(100), nullable=False)
    max_students = Column(Integer, nullable=True)
    course_start_date = Column(Date, nullable=False)
    course_duration_months = Column(Integer, nullable=False)
    course_end_date = Column(Date, nullable=False)
    enrollment_start_date = Column(Date, nullable=False)
    enrollment_end_date = Column(Date, nullable=False)
    enrollment_code = Column(String(20), unique=True, nullable=False)
    invite_link = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    catalog = relationship("CourseCatalog", foreign_keys=[catalog_id])
    teacher = relationship("User", foreign_keys=[teacher_id])


class Enrollment(Base):
    __tablename__ = "enrollments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id = Column(UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    enrolled_at = Column(DateTime(timezone=True), server_default=func.now())
