"""Fixed catalog of notification `type` values emitted across the app. Centralized
here so every call site uses the same string (no typos causing a silently
unmatched frontend icon) and so a future admin-facing "notification settings"
screen has one place to enumerate all possible types."""


class NotificationType:
    ENROLLMENT_JOINED = "enrollment_joined"                # -> student
    ENROLLMENT_NEW_STUDENT = "enrollment_new_student"       # -> teacher
    FILE_PROCESSING_COMPLETED = "file_processing_completed"  # -> teacher
    FILE_PROCESSING_FAILED = "file_processing_failed"       # -> teacher
    NEW_COURSE_CONTENT = "new_course_content"               # -> enrolled students
    GRAPH_APPROVED = "graph_approved"                       # -> teacher
    GRAPH_REJECTED = "graph_rejected"                       # -> teacher
    TEACHER_REQUEST_SUBMITTED = "teacher_request_submitted"  # -> admins
    ACCOUNT_APPROVED = "account_approved"                   # -> newly created staff user
    ANNOUNCEMENT_POSTED = "announcement_posted"             # -> enrolled students
    ASSIGNMENT_POSTED = "assignment_posted"                 # -> enrolled students
    ASSIGNMENT_SUBMITTED = "assignment_submitted"           # -> teacher
    MATERIAL_POSTED = "material_posted"                     # -> enrolled students
    MEETING_POSTED = "meeting_posted"                       # -> enrolled students
    COMMENT_POSTED = "comment_posted"                       # -> the other side of a comment thread


# priority drives icon/color on the frontend: "info" | "success" | "warning" | "error"
DEFAULT_PRIORITY = {
    NotificationType.ENROLLMENT_JOINED: "success",
    NotificationType.ENROLLMENT_NEW_STUDENT: "info",
    NotificationType.FILE_PROCESSING_COMPLETED: "success",
    NotificationType.FILE_PROCESSING_FAILED: "error",
    NotificationType.NEW_COURSE_CONTENT: "info",
    NotificationType.GRAPH_APPROVED: "success",
    NotificationType.GRAPH_REJECTED: "warning",
    NotificationType.TEACHER_REQUEST_SUBMITTED: "info",
    NotificationType.ACCOUNT_APPROVED: "success",
    NotificationType.ANNOUNCEMENT_POSTED: "info",
    NotificationType.ASSIGNMENT_POSTED: "warning",
    NotificationType.ASSIGNMENT_SUBMITTED: "success",
    NotificationType.MATERIAL_POSTED: "info",
    NotificationType.MEETING_POSTED: "info",
    NotificationType.COMMENT_POSTED: "info",
}
