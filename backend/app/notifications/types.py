"""Fixed catalog of notification `type` values emitted across the app. Centralized
here so every call site uses the same string (no typos causing a silently
unmatched frontend icon) and so a future admin-facing "notification settings"
screen has one place to enumerate all possible types."""


# String constants for every notification type; the comment on each line says who receives it.
class NotificationType:
    ENROLLMENT_JOINED = "enrollment_joined"                # -> student
    ENROLLMENT_NEW_STUDENT = "enrollment_new_student"       # -> teacher
    FILE_PROCESSING_COMPLETED = "file_processing_completed"  # -> teacher
    FILE_PROCESSING_FAILED = "file_processing_failed"       # -> teacher
    NEW_COURSE_CONTENT = "new_course_content"               # -> enrolled students
    GRAPH_APPROVED = "graph_approved"                       # -> teacher
    GRAPH_REJECTED = "graph_rejected"                       # -> teacher
    # Coordinator's decision on a reviewed-pipeline revision or a single manual graph
    # edit. Distinct from GRAPH_APPROVED/GRAPH_REJECTED above, which belong to the
    # older course-level graph_status flag rather than an actual merge into Neo4j.
    GRAPH_REVISION_APPROVED = "graph_revision_approved"      # -> submitting teacher
    GRAPH_REVISION_REJECTED = "graph_revision_rejected"      # -> submitting teacher
    GRAPH_EDIT_APPROVED = "graph_edit_approved"              # -> proposing teacher
    GRAPH_EDIT_REJECTED = "graph_edit_rejected"              # -> proposing teacher
    TEACHER_REQUEST_SUBMITTED = "teacher_request_submitted"  # -> admins
    ACCOUNT_APPROVED = "account_approved"                   # -> newly created staff user
    ANNOUNCEMENT_POSTED = "announcement_posted"             # -> enrolled students
    ASSIGNMENT_POSTED = "assignment_posted"                 # -> enrolled students
    ASSIGNMENT_SUBMITTED = "assignment_submitted"           # -> teacher
    ASSIGNMENT_GRADED = "assignment_graded"                 # -> student
    MATERIAL_POSTED = "material_posted"                     # -> enrolled students
    MEETING_POSTED = "meeting_posted"                       # -> enrolled students
    COMMENT_POSTED = "comment_posted"                       # -> the other side of a comment thread
    # Generation is a background job now, so the teacher who started it has almost
    # certainly navigated away by the time it finishes - the notification IS how they
    # find out, not a nicety on top of an on-screen result.
    CONTENT_GENERATION_READY = "content_generation_ready"    # -> requesting teacher
    CONTENT_GENERATION_FAILED = "content_generation_failed"  # -> requesting teacher
    SCHEDULE_APPROVED = "schedule_approved"                  # -> submitting teacher
    SCHEDULE_REJECTED = "schedule_rejected"                  # -> submitting teacher


# priority drives icon/color on the frontend: "info" | "success" | "warning" | "error"
# Default priority (icon/colour) for each notification type.
DEFAULT_PRIORITY = {
    NotificationType.ENROLLMENT_JOINED: "success",
    NotificationType.ENROLLMENT_NEW_STUDENT: "info",
    NotificationType.FILE_PROCESSING_COMPLETED: "success",
    NotificationType.FILE_PROCESSING_FAILED: "error",
    NotificationType.NEW_COURSE_CONTENT: "info",
    NotificationType.CONTENT_GENERATION_READY: "success",
    NotificationType.CONTENT_GENERATION_FAILED: "error",
    NotificationType.GRAPH_APPROVED: "success",
    NotificationType.GRAPH_REJECTED: "warning",
    NotificationType.GRAPH_REVISION_APPROVED: "success",
    NotificationType.GRAPH_REVISION_REJECTED: "warning",
    NotificationType.GRAPH_EDIT_APPROVED: "success",
    NotificationType.GRAPH_EDIT_REJECTED: "warning",
    NotificationType.SCHEDULE_APPROVED: "success",
    NotificationType.SCHEDULE_REJECTED: "warning",
    NotificationType.TEACHER_REQUEST_SUBMITTED: "info",
    NotificationType.ACCOUNT_APPROVED: "success",
    NotificationType.ANNOUNCEMENT_POSTED: "info",
    NotificationType.ASSIGNMENT_POSTED: "warning",
    NotificationType.ASSIGNMENT_SUBMITTED: "success",
    NotificationType.ASSIGNMENT_GRADED: "success",
    NotificationType.MATERIAL_POSTED: "info",
    NotificationType.MEETING_POSTED: "info",
    NotificationType.COMMENT_POSTED: "info",
}
