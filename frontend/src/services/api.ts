import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Without a timeout, a request that hangs (a dropped connection to the
  // database, a slow network blip) never resolves or rejects - the calling
  // button/form is left showing its loading spinner forever ("stuck in a
  // loading loop") instead of failing and letting the user retry.
  timeout: 20000,
});

// Inject authorization token on every request if present
// Token is stored in localStorage ("remember me") or sessionStorage (session-only);
// check both so requests keep working regardless of which one was used at login.
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default api;

// Minimal, read-only course preview shape returned by GET /courses/lookup/{code}
export interface CourseLookup {
  name: string;
  code: string | null;
}

// Shape returned by GET /files/course/{id}/search - a semantic search hit over the
// course's uploaded material (text chunks + image captions).
export interface ContentSearchResult {
  text: string;
  score: number;
  source_type: string;
  citation: string;
}

// Shape returned by POST /enrollment/join - includes the joined course's name/code
// so the UI can render "Successfully enrolled in {name} ({code})." without another round trip.
export interface EnrollmentJoinResult {
  id: number;
  student_id: number;
  course_id: number;
  status: string;
  enrolled_at: string;
  progress: number;
  last_accessed: string | null;
  course_name: string | null;
  course_code: string | null;
}

// Authentication Services
export const authService = {
  login: async (credentials: any) => {
    const res = await api.post('/auth/login', credentials);
    return res.data;
  },
  register: async (userData: any) => {
    const res = await api.post('/auth/register', userData);
    return res.data;
  },
  getMe: async () => {
    const res = await api.get('/auth/me');
    return res.data;
  },
  google: async (idToken: string) => {
    const res = await api.post('/auth/google', { id_token: idToken });
    return res.data;
  },
  changePassword: async (data: { current_password?: string; new_password: string }) => {
    const res = await api.post('/auth/change-password', data);
    return res.data;
  },
  requestTeacherAccess: async (data: { email: string; full_name: string; reason?: string }) => {
    const res = await api.post('/auth/teacher-requests', data);
    return res.data;
  },
  uploadAvatar: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post('/auth/me/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return res.data;
  },
  deleteAvatar: async () => {
    const res = await api.delete('/auth/me/avatar');
    return res.data;
  },
};

// Shape returned by GET/POST /api/programs, PUT /api/programs/{id}
export interface ProgramItem {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
}

// Shape returned by GET /auth/admin/staff/{user_id}/scope
export interface StaffScope {
  program_ids: number[];
  course_ids: number[];
}

// Program Services: admin-only CRUD over the Program catalog grouping
// (GET is available to any authenticated user - used by pickers elsewhere).
export const programService = {
  list: async (): Promise<ProgramItem[]> => {
    const res = await api.get('/programs');
    return res.data;
  },
  create: async (data: { name: string; code?: string; description?: string }): Promise<ProgramItem> => {
    const res = await api.post('/programs', data);
    return res.data;
  },
  update: async (id: number, data: { name?: string; code?: string; description?: string }): Promise<ProgramItem> => {
    const res = await api.put(`/programs/${id}`, data);
    return res.data;
  },
  delete: async (id: number): Promise<void> => {
    await api.delete(`/programs/${id}`);
  },
};

// Admin Services
export const adminService = {
  createTeacher: async (data: { email: string; full_name: string }) => {
    const res = await api.post('/auth/admin/teachers', data);
    return res.data;
  },
  listTeacherRequests: async (statusFilter?: string) => {
    const res = await api.get('/auth/admin/teacher-requests', {
      params: statusFilter ? { status_filter: statusFilter } : undefined,
    });
    return res.data;
  },
  approveTeacherRequest: async (id: number) => {
    const res = await api.post(`/auth/admin/teacher-requests/${id}/approve`);
    return res.data;
  },
  rejectTeacherRequest: async (id: number) => {
    const res = await api.post(`/auth/admin/teacher-requests/${id}/reject`);
    return res.data;
  },
  // Program/Course Coordinators are never created fresh - they're always an existing
  // teacher whose role is changed here, so they keep their existing login credentials.
  listStaff: async (role?: 'teacher' | 'program_coordinator' | 'course_coordinator') => {
    const res = await api.get('/auth/admin/staff', { params: role ? { role } : undefined });
    return res.data;
  },
  changeStaffRole: async (
    userId: number,
    role: 'teacher' | 'program_coordinator' | 'course_coordinator',
    scope?: { program_ids?: number[]; course_ids?: number[] }
  ) => {
    const res = await api.patch(`/auth/admin/staff/${userId}/role`, { role, ...scope });
    return res.data;
  },
  listStaffScope: async (userId: number): Promise<StaffScope> => {
    const res = await api.get(`/auth/admin/staff/${userId}/scope`);
    return res.data;
  },
  // Scoped to program coordinators (not admin-only) - used by their course-coordinator
  // assignment picker, since /auth/admin/staff is admin-gated.
  listCoordinatorEligibleUsers: async () => {
    const res = await api.get('/auth/coordinator/eligible-users');
    return res.data;
  },
  listAllUsers: async (params?: { role?: string; search?: string; is_active?: boolean }) => {
    const res = await api.get('/auth/admin/all-users', { params });
    return res.data;
  },
  updateUser: async (userId: number, data: { full_name?: string; email?: string; role?: string; is_active?: boolean }) => {
    const res = await api.put(`/auth/admin/users/${userId}`, data);
    return res.data;
  },
  deleteUser: async (userId: number) => {
    const res = await api.delete(`/auth/admin/users/${userId}`);
    return res.data;
  },
  exportUsersCsv: async (params?: { role?: string; search?: string; is_active?: boolean }) => {
    const res = await api.get('/auth/admin/users/export-csv', {
      params,
      responseType: 'blob',
    });
    return res.data;
  },
  listAdminLogs: async (event_type?: string) => {
    const res = await api.get('/auth/admin/logs', { params: event_type ? { event_type } : undefined });
    return res.data;
  },
  // Program/Course Coordinator as ADDITIONAL authority flags on an existing teacher
  // account (older, alternate model to the role-based listStaff/changeStaffRole above -
  // kept for callers still using it; see StaffAuthoritiesUpdate on the backend).
  listStaffByAuthority: async (authority?: 'program_coordinator' | 'course_coordinator') => {
    const res = await api.get('/auth/admin/staff', { params: authority ? { authority } : undefined });
    return res.data;
  },
  updateStaffAuthorities: async (userId: number, authorities: { is_program_coordinator?: boolean; is_course_coordinator?: boolean }) => {
    const res = await api.patch(`/auth/admin/staff/${userId}/authorities`, authorities);
    return res.data;
  },
};

// Program Coordinator Services: predefined-course catalog CRUD, prerequisite mapping,
// course deletion. Admin can hit the same endpoints too (see backend/app/auth/routes.py).
export const programCoordinatorService = {
  listCatalog: async () => {
    const res = await api.get('/courses/admin/catalog');
    return res.data;
  },
  createCatalogEntry: async (data: { name: string; code: string; prerequisite_catalog_id?: number | null }) => {
    const res = await api.post('/courses/admin/catalog', data);
    return res.data;
  },
  updateCatalogEntry: async (id: number, data: { name?: string; code?: string; prerequisite_catalog_id?: number | null }) => {
    const res = await api.put(`/courses/admin/catalog/${id}`, data);
    return res.data;
  },
  deleteCatalogEntry: async (id: number) => {
    const res = await api.delete(`/courses/admin/catalog/${id}`);
    return res.data;
  },
  updateCourse: async (id: number, data: any) => {
    const res = await api.put(`/courses/admin/${id}`, data);
    return res.data;
  },
  deleteCourse: async (id: number) => {
    const res = await api.delete(`/courses/admin/${id}`);
    return res.data;
  },
  // Course Coordinator assignment - a Program Coordinator (or admin) designates a
  // Course Coordinator for any course under their own program(s) without going
  // through admin. See backend/app/courses/routes.py:386-483.
  listCourseCoordinators: async (courseId: number): Promise<CourseCoordinatorEntry[]> => {
    const res = await api.get(`/courses/${courseId}/coordinators`);
    return res.data;
  },
  assignCourseCoordinator: async (courseId: number, userId: number) => {
    const res = await api.post(`/courses/${courseId}/coordinator`, { user_id: userId });
    return res.data;
  },
  removeCourseCoordinator: async (courseId: number, userId: number) => {
    const res = await api.delete(`/courses/${courseId}/coordinator/${userId}`);
    return res.data;
  },
};

// Shape returned by GET /courses/{course_id}/coordinators
export interface CourseCoordinatorEntry {
  id: number;
  full_name: string;
  email: string;
}

// Course Coordinator Services: course-info updates (status/dates/description/
// capacity - not catalog or prerequisite, see backend), plus the course-level
// knowledge-graph approve/reject toggle. Newer content also flows through
// graphService's revision approve/reject (content-visible, per-submission) - see
// CourseCoordinatorDashboard.tsx - but the blind course-level toggle below is still
// a live backend endpoint and kept here for any caller still using it.
export const courseCoordinatorService = {
  updateCourse: async (id: number, data: any) => {
    const res = await api.put(`/courses/admin/${id}`, data);
    return res.data;
  },
  approveGraph: async (courseId: number) => {
    const res = await api.post(`/graph/course/${courseId}/approve`);
    return res.data;
  },
  rejectGraph: async (courseId: number) => {
    const res = await api.post(`/graph/course/${courseId}/reject`);
    return res.data;
  },
};

// Course Services
export const courseService = {
  create: async (courseData: any) => {
    const res = await api.post('/courses', courseData);
    return res.data;
  },
  getAll: async () => {
    const res = await api.get('/courses/all');
    return res.data;
  },
  getTeacherCourses: async () => {
    const res = await api.get('/courses/teacher/my-courses');
    return res.data;
  },
  getCatalog: async () => {
    const res = await api.get('/courses/catalog');
    return res.data;
  },
  lookupByCode: async (enrollmentCode: string): Promise<CourseLookup> => {
    const res = await api.get(`/courses/lookup/${enrollmentCode}`);
    return res.data;
  },
  getDetails: async (id: number) => {
    const res = await api.get(`/courses/${id}`);
    return res.data;
  },
  update: async (id: number, updateData: any) => {
    const res = await api.put(`/courses/${id}`, updateData);
    return res.data;
  },
  delete: async (id: number) => {
    const res = await api.delete(`/courses/${id}`);
    return res.data;
  },
  regenerateCode: async (id: number) => {
    const res = await api.post(`/courses/${id}/generate-code`);
    return res.data;
  },
};

// Shape returned by GET/POST /assistant/messages - matches backend/app/assistant/schemas.py
export interface ChatMessageItem {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

// AI Assistant Services - a single ongoing per-user chat thread backed by OpenAI
// (with a graceful "not configured" fallback reply if the key is missing/invalid).
export const assistantService = {
  getMessages: async (limit?: number): Promise<ChatMessageItem[]> => {
    const res = await api.get('/assistant/messages', { params: limit ? { limit } : undefined });
    return res.data;
  },
  sendMessage: async (content: string): Promise<ChatMessageItem> => {
    const res = await api.post('/assistant/messages', { content });
    return res.data;
  },
  clearMessages: async (): Promise<void> => {
    await api.delete('/assistant/messages');
  },
};

// Enrollment Services
export const enrollmentService = {
  join: async (enrollmentCode: string): Promise<EnrollmentJoinResult> => {
    const res = await api.post('/enrollment/join', { enrollment_code: enrollmentCode });
    return res.data;
  },
  getMyCourses: async () => {
    const res = await api.get('/enrollment/my-courses');
    return res.data;
  },
  checkPrerequisite: async (courseId: number) => {
    const res = await api.get(`/enrollment/check-prerequisite/${courseId}`);
    return res.data;
  },
  getEnrolledStudents: async (courseId: number) => {
    const res = await api.get(`/enrollment/teacher/course/${courseId}/students`);
    return res.data;
  },
  drop: async (enrollmentId: number) => {
    const res = await api.delete(`/enrollment/${enrollmentId}`);
    return res.data;
  },
};

// Content Upload Services
export const uploadService = {
  uploadFile: async (courseId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post(`/files/upload/${courseId}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 60000,
    });
    return res.data;
  },
  getCourseFiles: async (courseId: number) => {
    const res = await api.get(`/files/course/${courseId}`);
    return res.data;
  },
  searchContent: async (courseId: number, query: string): Promise<ContentSearchResult[]> => {
    const res = await api.get(`/files/course/${courseId}/search`, { params: { q: query } });
    return res.data;
  },
  deleteFile: async (fileId: number) => {
    const res = await api.delete(`/files/${fileId}`);
    return res.data;
  },
  reprocessFile: async (fileId: number) => {
    const res = await api.post(`/files/${fileId}/process`);
    return res.data;
  },
  replaceFile: async (fileId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.put(`/files/${fileId}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 60000,
    });
    return res.data;
  },
};

// Reviewed content-processing pipeline: OCR'd text -> Kimi cleaning/structuring ->
// diff against the shared catalog graph -> teacher review -> coordinator approval.
export interface ConceptDiffItem {
  name: string;
  description: string;
  difficulty: string;
  importance_score: number;
  learning_outcomes: string;
  prerequisites: string[];
  is_new: boolean;
}

export interface GraphDiff {
  concepts: ConceptDiffItem[];
  new_concept_count: number;
  matched_existing_count: number;
  new_relationship_count: number;
}

export interface GraphBuildJob {
  id: number;
  catalog_id: number;
  course_id: number;
  triggered_by_teacher_id: number;
  status: string;
  teacher_notes: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface GraphEditProposal {
  id: number;
  catalog_id: number;
  course_id: number;
  teacher_id: number;
  operation: 'create_node' | 'update_node' | 'delete_node' | 'create_relationship' | 'delete_relationship';
  payload: Record<string, any>;
  status: string;
  coordinator_id: number | null;
  coordinator_decision_at: string | null;
  coordinator_notes: string | null;
  created_at: string;
  // present only on the pending-queue listing (list_pending_edit_proposals)
  course_name?: string;
  course_code?: string | null;
  teacher_name?: string;
}

export interface GraphRevision {
  id: number;
  job_id: number;
  catalog_id: number;
  is_initial: boolean;
  diff: GraphDiff;
  submitted_by_teacher_id: number;
  status: string;
  teacher_reviewed_by_id: number | null;
  teacher_reviewed_at: string | null;
  teacher_edit_notes: string | null;
  coordinator_id: number | null;
  coordinator_decision_at: string | null;
  coordinator_notes: string | null;
  created_at: string;
  // present only on the pending-queue listing (list_pending_revisions)
  course_name?: string;
  course_code?: string | null;
  course_id?: number | null;
  submitted_by_name?: string;
}

export const contentProcessingService = {
  triggerPipeline: async (courseId: number, teacherNotes?: string): Promise<GraphBuildJob> => {
    const res = await api.post(`/content-processing/trigger/${courseId}`, { teacher_notes: teacherNotes ?? null });
    return res.data;
  },
  getJob: async (jobId: number): Promise<GraphBuildJob> => {
    const res = await api.get(`/content-processing/jobs/${jobId}`);
    return res.data;
  },
  listJobsForCourse: async (courseId: number): Promise<GraphBuildJob[]> => {
    const res = await api.get(`/content-processing/jobs/course/${courseId}`);
    return res.data;
  },
  getJobRevision: async (jobId: number): Promise<GraphRevision> => {
    const res = await api.get(`/content-processing/jobs/${jobId}/revision`);
    return res.data;
  },
  teacherReview: async (
    revisionId: number,
    action: 'confirm' | 'reject',
    editedDiff?: GraphDiff,
    notes?: string
  ): Promise<GraphRevision> => {
    const res = await api.post(`/content-processing/revisions/${revisionId}/teacher-review`, {
      action,
      edited_diff: editedDiff ?? null,
      notes: notes ?? null,
    });
    return res.data;
  },
};

// Knowledge Graph Services
export const graphService = {
  getGraph: async (courseId: number) => {
    const res = await api.get(`/graph/course/${courseId}`);
    return res.data;
  },
  buildGraph: async (courseId: number) => {
    const res = await api.post(`/graph/build/${courseId}`);
    return res.data;
  },
  createNode: async (courseId: number, nodeData: { name: string; description: string; difficulty: string }) => {
    const res = await api.post(`/graph/node/${courseId}`, nodeData);
    return res.data;
  },
  updateNode: async (courseId: number, nodeId: string, nodeData: any) => {
    const res = await api.put(`/graph/node/${courseId}/${nodeId}`, nodeData);
    return res.data;
  },
  deleteNode: async (courseId: number, nodeId: string) => {
    const res = await api.delete(`/graph/node/${courseId}/${nodeId}`);
    return res.data;
  },
  createPrerequisite: async (sourceName: string, targetName: string, courseId: number) => {
    const res = await api.post('/graph/relationship', {
      course_id: courseId,
      source_name: sourceName,
      target_name: targetName,
    });
    return res.data;
  },
  deleteRelationship: async (courseId: number, sourceId: string, targetId: string) => {
    const res = await api.delete(`/graph/relationship/${courseId}/${sourceId}/${targetId}`);
    return res.data;
  },
  getGraphStats: async (courseId: number) => {
    const res = await api.get(`/graph/stats/${courseId}`);
    return res.data;
  },
  searchConcepts: async (courseId: number, query: string) => {
    const res = await api.get(`/graph/search/${courseId}`, { params: { q: query } });
    return res.data;
  },
  // Revision review workflow (produced by the reviewed content-processing pipeline)
  getRevision: async (revisionId: number): Promise<GraphRevision> => {
    const res = await api.get(`/graph/revisions/${revisionId}`);
    return res.data;
  },
  listPendingRevisions: async (): Promise<GraphRevision[]> => {
    const res = await api.get('/graph/revisions/pending');
    return res.data;
  },
  approveRevision: async (revisionId: number, notes?: string): Promise<GraphRevision> => {
    const res = await api.post(`/graph/revisions/${revisionId}/approve`, { action: 'approve', notes: notes ?? null });
    return res.data;
  },
  rejectRevision: async (revisionId: number, notes?: string): Promise<GraphRevision> => {
    const res = await api.post(`/graph/revisions/${revisionId}/reject`, { action: 'reject', notes: notes ?? null });
    return res.data;
  },
  // Manual edit approval workflow (single node/relationship edits made directly in
  // the Knowledge Graph UI - every one needs coordinator sign-off, same as above)
  listPendingEditProposals: async (): Promise<GraphEditProposal[]> => {
    const res = await api.get('/graph/edit-proposals/pending');
    return res.data;
  },
  approveEditProposal: async (proposalId: number, notes?: string): Promise<GraphEditProposal> => {
    const res = await api.post(`/graph/edit-proposals/${proposalId}/approve`, { action: 'approve', notes: notes ?? null });
    return res.data;
  },
  rejectEditProposal: async (proposalId: number, notes?: string): Promise<GraphEditProposal> => {
    const res = await api.post(`/graph/edit-proposals/${proposalId}/reject`, { action: 'reject', notes: notes ?? null });
    return res.data;
  },
};

// Shape returned by GET /notifications/* - matches backend/app/notifications/schemas.py
export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  priority: 'info' | 'success' | 'warning' | 'error';
  is_read: boolean;
  created_at: string;
  read_at: string | null;
}

export interface NotificationListResult {
  items: NotificationItem[];
  unread_count: number;
  total: number;
}

// Notification Services
export const notificationService = {
  list: async (params?: { unread_only?: boolean; limit?: number; offset?: number }): Promise<NotificationListResult> => {
    const res = await api.get('/notifications', { params });
    return res.data;
  },
  unreadCount: async (): Promise<{ unread_count: number }> => {
    const res = await api.get('/notifications/unread-count');
    return res.data;
  },
  markRead: async (id: number): Promise<NotificationItem> => {
    const res = await api.patch(`/notifications/${id}/read`);
    return res.data;
  },
  markAllRead: async (): Promise<{ updated: number }> => {
    const res = await api.post('/notifications/read-all');
    return res.data;
  },
  remove: async (id: number): Promise<void> => {
    await api.delete(`/notifications/${id}`);
  },
  clearRead: async (): Promise<{ deleted: number }> => {
    const res = await api.delete('/notifications/read');
    return res.data;
  },
};

// Shape returned by /courses/{id}/announcements - matches backend/app/announcements/schemas.py
export interface AnnouncementItem {
  id: number;
  course_id: number;
  teacher_id: number;
  teacher_name: string | null;
  content: string;
  created_at: string;
  updated_at: string | null;
}

// Class Stream (announcements) Services
export const announcementService = {
  list: async (courseId: number): Promise<AnnouncementItem[]> => {
    const res = await api.get(`/courses/${courseId}/announcements`);
    return res.data;
  },
  create: async (courseId: number, content: string): Promise<AnnouncementItem> => {
    const res = await api.post(`/courses/${courseId}/announcements`, { content });
    return res.data;
  },
  update: async (courseId: number, announcementId: number, content: string): Promise<AnnouncementItem> => {
    const res = await api.patch(`/courses/${courseId}/announcements/${announcementId}`, { content });
    return res.data;
  },
  remove: async (courseId: number, announcementId: number): Promise<void> => {
    await api.delete(`/courses/${courseId}/announcements/${announcementId}`);
  },
};

// Shape returned by /courses/{id}/assignments - matches backend/app/assignments/schemas.py
export interface SubmissionSummary {
  id: number;
  file_filename: string;
  submitted_at: string;
  is_late: boolean;
  grade: number | null;
  feedback: string | null;
}

export interface AssignmentItem {
  id: number;
  course_id: number;
  teacher_id: number;
  teacher_name: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  points: number | null;
  attachment_filename: string | null;
  created_at: string;
  updated_at: string | null;
  my_submission: SubmissionSummary | null;
  submission_count: number | null;
}

export interface SubmissionItem {
  id: number;
  assignment_id: number;
  student_id: number;
  student_name: string | null;
  student_email: string | null;
  file_filename: string;
  submitted_at: string;
  is_late: boolean;
  grade: number | null;
  feedback: string | null;
}

// Shape returned by /courses/{id}/materials - matches backend/app/materials/schemas.py
export interface MaterialItem {
  id: number;
  course_id: number;
  teacher_id: number;
  teacher_name: string | null;
  title: string;
  description: string | null;
  attachment_filename: string | null;
  external_link: string | null;
  created_at: string;
  updated_at: string | null;
}

// Materials (Classroom-style resource posts) Services
export const materialService = {
  list: async (courseId: number): Promise<MaterialItem[]> => {
    const res = await api.get(`/courses/${courseId}/materials`);
    return res.data;
  },
  create: async (
    courseId: number,
    data: { title: string; description?: string; external_link?: string; file?: File }
  ): Promise<MaterialItem> => {
    const formData = new FormData();
    formData.append('title', data.title);
    if (data.description) formData.append('description', data.description);
    if (data.external_link) formData.append('external_link', data.external_link);
    if (data.file) formData.append('file', data.file);
    const res = await api.post(`/courses/${courseId}/materials`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return res.data;
  },
  update: async (
    courseId: number,
    materialId: number,
    data: { title?: string; description?: string; external_link?: string }
  ): Promise<MaterialItem> => {
    const res = await api.patch(`/courses/${courseId}/materials/${materialId}`, data);
    return res.data;
  },
  remove: async (courseId: number, materialId: number): Promise<void> => {
    await api.delete(`/courses/${courseId}/materials/${materialId}`);
  },
  downloadAttachmentUrl: (courseId: number, materialId: number) =>
    `http://localhost:8000/api/courses/${courseId}/materials/${materialId}/download`,
};

// Shape returned by /courses/{id}/meetings - matches backend/app/meetings/schemas.py
export interface MeetingItem {
  id: number;
  course_id: number;
  teacher_id: number;
  teacher_name: string | null;
  title: string;
  description: string | null;
  meeting_link: string;
  scheduled_at: string;
  duration_minutes: number | null;
  created_at: string;
  updated_at: string | null;
}

// Meetings (lecture/live-session posts) Services
export const meetingService = {
  list: async (courseId: number): Promise<MeetingItem[]> => {
    const res = await api.get(`/courses/${courseId}/meetings`);
    return res.data;
  },
  create: async (
    courseId: number,
    data: { title: string; description?: string; meeting_link: string; scheduled_at: string; duration_minutes?: number }
  ): Promise<MeetingItem> => {
    const res = await api.post(`/courses/${courseId}/meetings`, data);
    return res.data;
  },
  update: async (
    courseId: number,
    meetingId: number,
    data: { title?: string; description?: string; meeting_link?: string; scheduled_at?: string; duration_minutes?: number }
  ): Promise<MeetingItem> => {
    const res = await api.patch(`/courses/${courseId}/meetings/${meetingId}`, data);
    return res.data;
  },
  remove: async (courseId: number, meetingId: number): Promise<void> => {
    await api.delete(`/courses/${courseId}/meetings/${meetingId}`);
  },
};

// Shape returned by GET /courses/{id}/stream - matches backend/app/stream/schemas.py.
// A flattened union of Announcement/Assignment/Material/Meeting fields tagged by
// `post_type`; fields that don't apply to a given post_type are null.
export interface StreamItem {
  id: number;
  post_type: 'announcement' | 'assignment' | 'material' | 'meeting';
  course_id: number;
  teacher_id: number;
  teacher_name: string | null;
  title: string | null;
  content: string | null;
  created_at: string;
  updated_at: string | null;
  due_date: string | null;
  points: number | null;
  attachment_filename: string | null;
  external_link: string | null;
  meeting_link: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
}

// Unified Class Stream Service - merges announcements/assignments/materials/meetings
export const streamService = {
  list: async (courseId: number): Promise<StreamItem[]> => {
    const res = await api.get(`/courses/${courseId}/stream`);
    return res.data;
  },
};

// Shape returned by GET /students/me/todo - matches backend/app/students/schemas.py
export interface TodoItem {
  assignment_id: number;
  course_id: number;
  course_name: string;
  title: string;
  due_date: string | null;
  points: number | null;
  status: 'missing' | 'submitted' | 'late';
  submitted_at: string | null;
  grade: number | null;
}

// Student To-Do Service
export const studentService = {
  getTodo: async (sort?: 'due_date' | 'course', filter?: 'upcoming' | 'missing' | 'done'): Promise<TodoItem[]> => {
    const res = await api.get('/students/me/todo', { params: { sort, filter } });
    return res.data;
  },
};

// Shape returned by GET/PATCH /notification-preferences/me - matches
// backend/app/notification_preferences/schemas.py. Every field is a boolean
// opt-out toggle (all default true - "everything on" until the user disables one).
export interface NotificationPreferences {
  course_posts: boolean;
  assignment_updates: boolean;
  grading_updates: boolean;
  enrollment_updates: boolean;
  content_processing_updates: boolean;
  system_updates: boolean;
}

// Notification Preferences Service (Settings > Notifications page)
export const notificationPreferencesService = {
  get: async (): Promise<NotificationPreferences> => {
    const res = await api.get('/notification-preferences/me');
    return res.data;
  },
  update: async (data: Partial<NotificationPreferences>): Promise<NotificationPreferences> => {
    const res = await api.patch('/notification-preferences/me', data);
    return res.data;
  },
};

// Shape returned by GET /calendar/me - matches backend/app/calendar/schemas.py.
// A flattened Assignment-due-date / Meeting-time entry, Google-Classroom-Calendar
// style, across every course the current user has a stake in.
export interface CalendarEventItem {
  id: number;
  type: 'assignment' | 'meeting';
  title: string;
  course_id: number;
  course_name: string;
  date: string;
  points: number | null;
  meeting_link: string | null;
}

// Calendar Service - aggregated assignment due dates + meeting times
export const calendarService = {
  getMyCalendar: async (): Promise<CalendarEventItem[]> => {
    const res = await api.get('/calendar/me');
    return res.data;
  },
};

// Contact Service - public (no-auth) landing-page contact form, forwards to the
// platform's configured SMTP_EMAIL via backend/app/contact/routes.py.
export const contactService = {
  send: async (data: { name: string; email: string; message: string }): Promise<{ success: boolean; detail: string }> => {
    const res = await api.post('/contact', data);
    return res.data;
  },
};

// Assignments (Classwork) Services
export const assignmentService = {
  list: async (courseId: number): Promise<AssignmentItem[]> => {
    const res = await api.get(`/courses/${courseId}/assignments`);
    return res.data;
  },
  create: async (
    courseId: number,
    data: { title: string; description?: string; due_date?: string; points?: number; file?: File }
  ): Promise<AssignmentItem> => {
    const formData = new FormData();
    formData.append('title', data.title);
    if (data.description) formData.append('description', data.description);
    if (data.due_date) formData.append('due_date', data.due_date);
    if (data.points !== undefined) formData.append('points', String(data.points));
    if (data.file) formData.append('file', data.file);
    const res = await api.post(`/courses/${courseId}/assignments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return res.data;
  },
  update: async (
    courseId: number,
    assignmentId: number,
    data: { title?: string; description?: string; due_date?: string; points?: number }
  ): Promise<AssignmentItem> => {
    const res = await api.patch(`/courses/${courseId}/assignments/${assignmentId}`, data);
    return res.data;
  },
  remove: async (courseId: number, assignmentId: number): Promise<void> => {
    await api.delete(`/courses/${courseId}/assignments/${assignmentId}`);
  },
  downloadAttachmentUrl: (courseId: number, assignmentId: number) =>
    `http://localhost:8000/api/courses/${courseId}/assignments/${assignmentId}/download`,
  submit: async (courseId: number, assignmentId: number, file: File): Promise<SubmissionSummary> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post(`/courses/${courseId}/assignments/${assignmentId}/submit`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return res.data;
  },
  listSubmissions: async (courseId: number, assignmentId: number): Promise<SubmissionItem[]> => {
    const res = await api.get(`/courses/${courseId}/assignments/${assignmentId}/submissions`);
    return res.data;
  },
  downloadSubmissionUrl: (courseId: number, assignmentId: number, submissionId: number) =>
    `http://localhost:8000/api/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/download`,
};

export interface AssignmentStat {
  id: number;
  title: string;
  due_date: string | null;
  total_students: number;
  submitted_count: number;
  late_count: number;
  graded_count: number;
  avg_grade: number | null;
}

export interface StudentStat {
  student_id: number;
  full_name: string;
  email: string;
  submitted_count: number;
  total_assignments: number;
  completion_rate: number;
  graded_count: number;
  avg_grade: number | null;
  /** One entry per CourseAnalytics.assignments, same order: 'submitted' | 'late' | 'missing'. */
  assignment_status: ('submitted' | 'late' | 'missing')[];
}

export interface CourseAnalytics {
  course_id: number;
  course_name: string;
  total_students: number;
  total_assignments: number;
  concept_count: number;
  edge_count: number;
  easy_count: number;
  medium_count: number;
  hard_count: number;
  avg_completion_rate: number;
  at_risk_count: number;
  assignments: AssignmentStat[];
  students: StudentStat[];
}

export interface MyCourseProgress {
  course_id: number;
  course_name: string;
  submitted_count: number;
  total_assignments: number;
  completion_rate: number;
  graded_count: number;
  avg_grade: number | null;
}

export const analyticsService = {
  getCourseAnalytics: async (courseId: number): Promise<CourseAnalytics> => {
    const res = await api.get(`/analytics/course/${courseId}`);
    return res.data;
  },
  getMyProgress: async (): Promise<MyCourseProgress[]> => {
    const res = await api.get('/analytics/my-progress');
    return res.data;
  },
};
