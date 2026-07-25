import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
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
  // Program/Course Coordinator are ADDITIONAL authority flags on an existing teacher
  // account, not a replacement role - the account keeps every teacher capability
  // plus whichever coordinator authority it's given (see StaffAuthoritiesUpdate).
  listStaff: async (authority?: 'program_coordinator' | 'course_coordinator') => {
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
};

// Course Coordinator Services: course-info updates (status/dates/description/
// capacity - not catalog or prerequisite, see backend). Knowledge-graph decisions
// go through graphService's revision approve/reject (content-visible), not a
// blind course-level toggle - see CourseCoordinatorDashboard.tsx.
export const courseCoordinatorService = {
  updateCourse: async (id: number, data: any) => {
    const res = await api.put(`/courses/admin/${id}`, data);
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
    });
    return res.data;
  },
  getCourseFiles: async (courseId: number) => {
    const res = await api.get(`/files/course/${courseId}`);
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
