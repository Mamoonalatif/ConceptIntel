import axios from 'axios';

// VITE_API_URL lets a deployed build (Vercel) point at the real backend host
// instead of the local dev server - falls back to localhost so nothing has to
// change for local development. Exported so components that build a raw
// download URL (Avatar.tsx, CourseDetail.tsx) don't each hardcode their own
// copy of this same host.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

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

// ── Access-token refresh ─────────────────────────────────────────────────────
// ACCESS_TOKEN_EXPIRE_MINUTES on the backend defaults to 24h; without this, a
// session open longer than that got a hard 401 on its next request and the user
// was bounced to /login mid-task. login()/loginWithGoogle() in AuthContext now
// also store a long-lived refresh_token (see storeToken there) - on a 401 this
// interceptor exchanges it for a fresh access token via POST /auth/refresh and
// silently retries the request exactly once.
const REFRESH_EXEMPT_PATHS = ['/auth/login', '/auth/register', '/auth/google', '/auth/refresh', '/auth/2fa/verify-login'];

// Shared across every 401 that lands in the same tick, so five requests failing
// at once trigger one refresh call, not five.
let refreshPromise: Promise<string | null> | null = null;

const getStoredRefreshToken = (): string | null =>
  localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token');

/** Writes the new access token back into whichever storage currently holds the
 *  session, mirroring the remember-me choice made at login. */
const updateStoredAccessToken = (accessToken: string) => {
  const store = localStorage.getItem('refresh_token') ? localStorage : sessionStorage;
  store.setItem('token', accessToken);
};

const clearStoredAuth = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('refresh_token');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('refresh_token');
};

const refreshAccessToken = (): Promise<string | null> => {
  if (!refreshPromise) {
    const refreshToken = getStoredRefreshToken();
    refreshPromise = (refreshToken
      ? axios.post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken }).then((res) => res.data.access_token)
      : Promise.resolve(null)
    )
      .catch(() => null)
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const isAuthExempt = !config || REFRESH_EXEMPT_PATHS.some((p) => config.url?.includes(p));
    if (error.response?.status !== 401 || isAuthExempt || config._retriedAfterRefresh) {
      return Promise.reject(error);
    }
    config._retriedAfterRefresh = true;

    const newAccessToken = await refreshAccessToken();
    if (!newAccessToken) {
      // No refresh token, or the refresh token itself is invalid/expired - the
      // session is genuinely over. AuthContext listens for this to sign the user
      // out and redirect, rather than leaving every open tab quietly broken.
      clearStoredAuth();
      window.dispatchEvent(new Event('conceptintel:session-expired'));
      return Promise.reject(error);
    }

    updateStoredAccessToken(newAccessToken);
    config.headers = { ...config.headers, Authorization: `Bearer ${newAccessToken}` };
    return api(config);
  }
);

// ── GET response cache ───────────────────────────────────────────────────────
// Every page re-fetched everything from scratch on mount, so navigating back to
// a screen you opened seconds ago showed the same spinner all over again. This
// wraps api.get with two things:
//
//   1. In-flight de-duplication - when several components mount at once and each
//      asks for the same URL (dashboards do this constantly), they share ONE
//      request instead of firing N identical ones.
//   2. A short freshness window - a repeat GET for the same URL within TTL is
//      served from memory, so going back to an already-visited page is instant.
//
// Correctness rules, deliberately conservative:
//   - Only successful GETs with a JSON body are cached; downloads/blobs are not.
//   - ANY write (post/put/patch/delete) empties the whole cache. Blunt, but it
//     makes it impossible to show data that a mutation has just invalidated -
//     the alternative (per-URL invalidation) is where cache bugs actually live.
//   - The window is short, so nothing can be more than TTL out of date anyway.
//   - The cache is in memory only: a hard refresh always re-fetches.
const CACHE_TTL_MS = 45_000;

interface CacheEntry { at: number; response: any }

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<any>>();

const cacheKeyFor = (url: string, config?: any): string | null => {
  // Explicit opt-out, for callers that must see live server state on every tick
  // (status polling, "did this finish yet?" checks). Pass { cache: false }.
  if (config?.cache === false) return null;
  // Anything that isn't a plain JSON read is not safe (or useful) to memoize.
  if (config?.responseType && config.responseType !== 'json') return null;
  const params = config?.params ? JSON.stringify(config.params) : '';
  return `${url}|${params}`;
};

/** Drops every cached GET. Called on any write, and on logout so a second user
 *  signing in on the same browser can never see the first user's data. */
export const clearApiCache = () => {
  responseCache.clear();
  inFlight.clear();
};

const rawGet = api.get.bind(api);
const rawPost = api.post.bind(api);
const rawPut = api.put.bind(api);
const rawPatch = api.patch.bind(api);
const rawDelete = api.delete.bind(api);

api.get = ((url: string, config?: any) => {
  const key = cacheKeyFor(url, config);
  if (!key) return rawGet(url, config);

  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Promise.resolve(hit.response);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = rawGet(url, config)
    .then((response: any) => {
      responseCache.set(key, { at: Date.now(), response });
      return response;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}) as typeof api.get;

// Writes invalidate everything. Cleared on the way out too (not just on success)
// so a failed-but-partially-applied request can't leave stale reads behind.
const invalidatingWrite = <T extends (...args: any[]) => Promise<any>>(fn: T): T =>
  ((...args: any[]) => fn(...args).finally(() => clearApiCache())) as T;

api.post = invalidatingWrite(rawPost) as typeof api.post;
api.put = invalidatingWrite(rawPut) as typeof api.put;
api.patch = invalidatingWrite(rawPatch) as typeof api.patch;
api.delete = invalidatingWrite(rawDelete) as typeof api.delete;

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
  forgotPassword: async (email: string) => {
    const res = await api.post('/auth/forgot-password', { email });
    return res.data;
  },
  resetPassword: async (token: string, new_password: string) => {
    const res = await api.post('/auth/reset-password', { token, new_password });
    return res.data;
  },
  verifyEmail: async (token: string) => {
    const res = await api.post('/auth/verify-email', { token });
    return res.data;
  },
  resendVerification: async (email: string) => {
    const res = await api.post('/auth/resend-verification', { email });
    return res.data;
  },
  refresh: async (refreshToken: string) => {
    const res = await api.post('/auth/refresh', { refresh_token: refreshToken });
    return res.data;
  },
  // --- Two-factor authentication ---
  // login() above may resolve with { requires_2fa: true, temp_token } instead of a
  // normal token payload - see backend/app/auth/routes.py login(). The caller (see
  // AuthContext.login) checks for that shape and, if present, does NOT treat it as
  // a completed sign-in; the frontend then collects a code and calls this instead.
  verifyTwoFactorLogin: async (tempToken: string, code: string) => {
    const res = await api.post('/auth/2fa/verify-login', { temp_token: tempToken, code });
    return res.data;
  },
  twoFactorStatus: async (): Promise<{ is_2fa_enabled: boolean }> => {
    const res = await api.get('/auth/2fa/status');
    return res.data;
  },
  twoFactorSetup: async (): Promise<{ secret: string; otpauth_uri: string; qr_code_base64: string }> => {
    const res = await api.post('/auth/2fa/setup');
    return res.data;
  },
  twoFactorEnable: async (code: string): Promise<{ backup_codes: string[] }> => {
    const res = await api.post('/auth/2fa/enable', { code });
    return res.data;
  },
  twoFactorDisable: async (data: { password?: string; code?: string }) => {
    const res = await api.post('/auth/2fa/disable', data);
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
  // Program Coordinator scope - which program(s) a coordinator actually oversees.
  // Additive (a coordinator can cover more than one program), admin-only.
  listCoordinators: async (programId: number): Promise<ProgramCoordinatorEntry[]> => {
    const res = await api.get(`/programs/${programId}/coordinators`);
    return res.data;
  },
  assignCoordinator: async (programId: number, userId: number) => {
    const res = await api.post(`/programs/${programId}/coordinators`, { user_id: userId });
    return res.data;
  },
  removeCoordinator: async (programId: number, userId: number) => {
    const res = await api.delete(`/programs/${programId}/coordinators/${userId}`);
    return res.data;
  },
};

export interface ProgramCoordinatorEntry {
  id: number;
  full_name: string;
  email: string;
}

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
  // Course Coordinator for a catalog SUBJECT (not a specific running section)
  // under their own program(s), without going through admin. Scoped this way so
  // a coordinator can be assigned before any course section exists yet - see
  // backend/app/database/models.py CourseCoordinatorAssignment for why.
  listCourseCoordinators: async (catalogId: number): Promise<CourseCoordinatorEntry[]> => {
    const res = await api.get(`/courses/admin/catalog/${catalogId}/coordinators`);
    return res.data;
  },
  assignCourseCoordinator: async (catalogId: number, userId: number) => {
    const res = await api.post(`/courses/admin/catalog/${catalogId}/coordinator`, { user_id: userId });
    return res.data;
  },
  removeCourseCoordinator: async (catalogId: number, userId: number) => {
    const res = await api.delete(`/courses/admin/catalog/${catalogId}/coordinator/${userId}`);
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
  // materialKind splits the two genuinely different things a teacher uploads:
  //   'material' - slides/notes/chapters. Chunked and embedded, then retrieved to
  //                ground content generation and assignment grading.
  //   'outline'  - the course outline/syllabus. Never embedded; passed to concept
  //                extraction as scope context instead. Uploading an outline AS
  //                material is what previously put "Credit Hours" and "Halliday"
  //                into the concept graph as if they were concepts.
  uploadFile: async (courseId: number, file: File, materialKind: 'material' | 'outline' = 'material') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('material_kind', materialKind);
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
  // present only on the teacher's own-submissions listing (list_my_graph_submissions)
  subject_name?: string;
  subject_code?: string | null;
  coordinator_name?: string | null;
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
  // present only on the teacher's own-submissions listing (list_my_graph_submissions)
  subject_name?: string;
  subject_code?: string | null;
  coordinator_name?: string | null;
}

// The teacher's side of the approval workflow: everything they've submitted, with
// the coordinator's decision and notes attached.
export interface MyGraphSubmissions {
  revisions: GraphRevision[];
  edit_proposals: GraphEditProposal[];
}

export const contentProcessingService = {
  triggerPipeline: async (courseId: number, teacherNotes?: string): Promise<GraphBuildJob> => {
    const res = await api.post(`/content-processing/trigger/${courseId}`, { teacher_notes: teacherNotes ?? null });
    return res.data;
  },
  getJob: async (jobId: number): Promise<GraphBuildJob> => {
    // Never memoized: this is polled every few seconds precisely to watch the
    // job status change, so a cached response would freeze the progress UI.
    const res = await api.get(`/content-processing/jobs/${jobId}`, { cache: false } as any);
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

// Concept Graph Services
export const graphService = {
  getGraph: async (courseId: number) => {
    const res = await api.get(`/graph/course/${courseId}`);
    return res.data;
  },
  // buildGraph() removed along with the backend POST /graph/build/{id} route: it
  // wrote extracted concepts straight into the shared catalog graph with no
  // coordinator approval. Use contentProcessingService.trigger() instead.
  getMySubmissions: async (courseId?: number): Promise<MyGraphSubmissions> => {
    const res = await api.get('/graph/my-submissions', {
      params: courseId ? { course_id: courseId } : undefined,
    });
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
  // AI-generate/refine a concept's detailed material - both submit a
  // GraphEditProposal ("update_material") awaiting course coordinator approval,
  // same flow as any other node edit.
  generateNodeMaterial: async (courseId: number, nodeId: string, instruction?: string) => {
    const res = await api.post(
      `/graph/node/${courseId}/${nodeId}/material/generate`,
      { instruction: instruction ?? null },
      { timeout: 90000 },
    );
    return res.data;
  },
  editNodeMaterial: async (courseId: number, nodeId: string, instruction: string) => {
    const res = await api.post(
      `/graph/node/${courseId}/${nodeId}/material/edit`,
      { instruction },
      { timeout: 90000 },
    );
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
  // Approving is the one request that writes the whole revision into Neo4j, so
  // it is legitimately slower than a normal call and gets a longer ceiling than
  // the 20s instance default. Batched writes brought a 79-concept merge down to
  // ~1s, but the timeout must stay comfortably above the worst case regardless:
  // aborting mid-merge doesn't stop the server, it just reports a failure for
  // work that then succeeds - which is exactly the bug this margin prevents.
  approveRevision: async (revisionId: number, notes?: string): Promise<GraphRevision> => {
    const res = await api.post(
      `/graph/revisions/${revisionId}/approve`,
      { action: 'approve', notes: notes ?? null },
      { timeout: 120000 },
    );
    return res.data;
  },
  rejectRevision: async (revisionId: number, notes?: string): Promise<GraphRevision> => {
    const res = await api.post(`/graph/revisions/${revisionId}/reject`, { action: 'reject', notes: notes ?? null });
    return res.data;
  },
  // Manual edit approval workflow (single node/relationship edits made directly in
  // the Concept Graph UI - every one needs coordinator sign-off, same as above)
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

export interface ScheduleSessionItem {
  week_label: string;
  title?: string | null;
  topics: string[];
  linked_concept_ids?: string[] | null;
}

export interface CourseSchedule {
  id: number;
  course_id: number;
  status: string;
  generated_by_ai: boolean;
  sessions: ScheduleSessionItem[];
  updated_at: string;
}

// What the schedule says a course teaches THIS week, derived from
// Course.start_date - null fields mean "not started yet" or "schedule doesn't
// reach this far", not an error.
export interface TodayTopics {
  course_id: number;
  week_index: number | null;
  total_weeks: number | null;
  week_label: string | null;
  title: string | null;
  topics: string[];
}

// Course schedule/outline preview - a lightweight, teacher-editable week-by-week
// breakdown of topics, shown ahead of the full concept graph. No coordinator-
// approval gate: generate/update apply straight to the live, student-visible
// schedule.
export const scheduleService = {
  generate: async (courseId: number): Promise<CourseSchedule> => {
    const res = await api.post(`/schedule/course/${courseId}/generate`, {}, { timeout: 60000 });
    return res.data;
  },
  update: async (courseId: number, sessions: ScheduleSessionItem[]): Promise<CourseSchedule> => {
    const res = await api.put(`/schedule/course/${courseId}`, { sessions });
    return res.data;
  },
  getApproved: async (courseId: number): Promise<CourseSchedule> => {
    const res = await api.get(`/schedule/course/${courseId}`);
    return res.data;
  },
  getToday: async (courseId: number): Promise<TodayTopics> => {
    const res = await api.get(`/schedule/course/${courseId}/today`);
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
  // "Ungraded" | "PendingReview" | "Approved" - grade/feedback above are only
  // ever populated here once this is "Approved" (see backend _student_facing_submission).
  grade_status: 'Ungraded' | 'PendingReview' | 'Approved';
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

export interface RubricCriterionScore {
  criterion_id: number;
  title: string;
  points_earned: number;
  max_points: number;
  clo_id: number | null;
  feedback: string;
  // Set only when the criterion has performance levels and one was picked (by
  // the AI, or by a teacher's override at approval) - see grading_service.py.
  level_id?: number | null;
  level_label?: string | null;
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
  // Per-criterion breakdown from the assignment's rubric, if one exists and was
  // used for this grading pass. Null when the assignment has no rubric.
  rubric_scores: RubricCriterionScore[] | null;
  // "Ungraded" | "PendingReview" | "Approved" - teacher-facing, so unlike the
  // student's SubmissionSummary, grade/feedback here are always the real values
  // regardless of status (the teacher IS the reviewer the gate exists for).
  grade_status: 'Ungraded' | 'PendingReview' | 'Approved';
}

// One performance level of an analytic-rubric criterion (e.g. "Excellent" =
// 30pts) - matches backend/app/assignments/schemas.py RubricLevelIn/Out.
export interface RubricLevel {
  id?: number;
  label: string;
  points: number;
  description: string | null;
}

// One row of a Rubric, as the teacher edits/saves it - matches
// backend/app/assignments/schemas.py RubricCriterionIn/Out.
export interface RubricCriterion {
  id?: number;
  title: string;
  description: string | null;
  max_points: number;
  clo_id: number | null;
  clo_code?: string | null;
  order_index?: number;
  levels: RubricLevel[];
}

export interface Rubric {
  id: number;
  assignment_id: number;
  status: 'Draft' | 'Published';
  criteria: RubricCriterion[];
  total_points: number;
  created_at: string;
  updated_at: string | null;
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
    `${API_URL}/courses/${courseId}/materials/${materialId}/download`,
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
    `${API_URL}/courses/${courseId}/assignments/${assignmentId}/download`,
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
    `${API_URL}/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/download`,
  // AI concept-level grading - extracts the submission's text, compares it against
  // the course's knowledge-graph concepts, and returns a grade + explainable
  // per-concept feedback (see backend/app/assignments/grading_service.py). Safe to
  // call again on the same submission (e.g. after a resubmission).
  gradeSubmission: async (courseId: number, assignmentId: number, submissionId: number): Promise<SubmissionItem> => {
    const res = await api.post(
      `/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/grade`,
      undefined,
      { timeout: 60000 } // AI grading call can take longer than the default timeout
    );
    return res.data;
  },
  // Teacher review/approval step - replaces the AI-suggested grade/feedback with
  // the teacher's own final call. Immediately Approved, no further gate.
  overrideGrade: async (
    courseId: number, assignmentId: number, submissionId: number, data: { grade: number; feedback: string }
  ): Promise<SubmissionItem> => {
    const res = await api.patch(
      `/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/grade`, data
    );
    return res.data;
  },
  // Approves a PendingReview AI grade, making it visible to the student and
  // running its downstream side effects (CLO/PLO attainment, ConceptMastery,
  // gamification points, notification). criterion_levels lets the teacher
  // override which level the AI picked for one or more criteria before approving.
  approveGrade: async (
    courseId: number, assignmentId: number, submissionId: number,
    data?: { criterion_levels?: { criterion_id: number; level_id: number }[]; overall_feedback?: string }
  ): Promise<SubmissionItem> => {
    const res = await api.post(
      `/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/grade/approve`, data
    );
    return res.data;
  },
  // Discards a PendingReview AI grade entirely, resetting the submission back to Ungraded.
  rejectGrade: async (
    courseId: number, assignmentId: number, submissionId: number
  ): Promise<SubmissionItem> => {
    const res = await api.post(
      `/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/grade/reject`
    );
    return res.data;
  },
  // AI-drafts a rubric from the assignment brief + course concepts/CLOs + retrieved
  // course material, and saves it immediately as "Draft" so the teacher can edit
  // real rows (see saveRubric) rather than a throwaway preview with no ids.
  generateRubric: async (courseId: number, assignmentId: number): Promise<Rubric> => {
    const res = await api.post(
      `/courses/${courseId}/assignments/${assignmentId}/rubric/generate`, undefined, { timeout: 60000 }
    );
    return res.data;
  },
  getRubric: async (courseId: number, assignmentId: number): Promise<Rubric | null> => {
    try {
      const res = await api.get(`/courses/${courseId}/assignments/${assignmentId}/rubric`);
      return res.data;
    } catch (e: any) {
      if (e?.response?.status === 404) return null;
      throw e;
    }
  },
  // Full replace of the rubric's criteria - the teacher's edited/approved version.
  // status='Published' (the default) is what grading actually reads; 'Draft' keeps
  // it as a work-in-progress that grading ignores.
  saveRubric: async (
    courseId: number, assignmentId: number, criteria: RubricCriterion[], status: 'Draft' | 'Published' = 'Published'
  ): Promise<Rubric> => {
    const res = await api.put(`/courses/${courseId}/assignments/${assignmentId}/rubric`, { criteria, status });
    return res.data;
  },
  deleteRubric: async (courseId: number, assignmentId: number): Promise<void> => {
    await api.delete(`/courses/${courseId}/assignments/${assignmentId}/rubric`);
  },
};

// ── CLO / PLO / GA outcome chain (Concept -> CLO -> PLO -> GA) ─────────────
export interface GA {
  id: number;
  code: string;
  title: string;
  description: string | null;
  created_at: string;
}

export interface PLO {
  id: number;
  program_id: number;
  code: string;
  title: string;
  description: string | null;
  ga_ids: number[];
  created_at: string;
}

export interface CLO {
  id: number;
  catalog_id: number;
  code: string;
  title: string;
  description: string | null;
  plo_ids: number[];
  created_by_id: number;
  created_at: string;
}

export const outcomesService = {
  listGAs: async (): Promise<GA[]> => (await api.get('/outcomes/gas')).data,
  createGA: async (data: { code: string; title: string; description?: string }): Promise<GA> =>
    (await api.post('/outcomes/gas', data)).data,
  deleteGA: async (gaId: number): Promise<void> => { await api.delete(`/outcomes/gas/${gaId}`); },

  listPLOs: async (programId?: number): Promise<PLO[]> =>
    (await api.get('/outcomes/plos', { params: programId ? { program_id: programId } : {} })).data,
  createPLO: async (data: { program_id: number; code: string; title: string; description?: string }): Promise<PLO> =>
    (await api.post('/outcomes/plos', data)).data,
  setPLOGAs: async (ploId: number, gaIds: number[]): Promise<PLO> =>
    (await api.put(`/outcomes/plos/${ploId}/gas`, { ga_ids: gaIds })).data,
  deletePLO: async (ploId: number): Promise<void> => { await api.delete(`/outcomes/plos/${ploId}`); },

  listCLOs: async (catalogId: number): Promise<CLO[]> =>
    (await api.get('/outcomes/clos', { params: { catalog_id: catalogId } })).data,
  createCLO: async (data: { catalog_id: number; code: string; title: string; description?: string }): Promise<CLO> =>
    (await api.post('/outcomes/clos', data)).data,
  // AI-extracts CLOs from the course's uploaded outline, creates any that don't
  // already exist, then best-effort maps them to the program's existing PLOs and
  // tags any not-yet-tagged concept-graph nodes with the CLOs they address.
  autoExtractCLOs: async (courseId: number): Promise<{
    created_clos: CLO[]; skipped_existing_count: number; plo_links_created: number; concepts_tagged: number;
  }> => (await api.post('/outcomes/clos/auto-extract', {}, { params: { course_id: courseId }, timeout: 90000 })).data,
  setCLOPLOs: async (cloId: number, ploIds: number[]): Promise<CLO> =>
    (await api.put(`/outcomes/clos/${cloId}/plos`, { plo_ids: ploIds })).data,
  deleteCLO: async (cloId: number): Promise<void> => { await api.delete(`/outcomes/clos/${cloId}`); },

  listConceptCLOMap: async (catalogId: number): Promise<Array<{ concept_node_id: string; concept_name: string; clo_ids: number[] }>> =>
    (await api.get(`/outcomes/catalog/${catalogId}/concept-clo-map`)).data,
  setConceptCLOs: async (
    catalogId: number, conceptNodeId: string, conceptName: string, cloIds: number[]
  ): Promise<{ concept_node_id: string; concept_name: string; clo_ids: number[] }> =>
    (await api.put(`/outcomes/catalog/${catalogId}/concept-clo-map`, {
      concept_node_id: conceptNodeId, concept_name: conceptName, clo_ids: cloIds,
    })).data,

  getOutcomesGraph: async (catalogId: number): Promise<{
    clos: Array<{ id: string; code: string; title: string }>;
    plos: Array<{ id: string; code: string; title: string }>;
    gas: Array<{ id: string; code: string; title: string }>;
    clo_plo_edges: Array<{ clo_id: string; plo_id: string }>;
    plo_ga_edges: Array<{ plo_id: string; ga_id: string }>;
    concept_clo_edges: Array<{ concept_node_id: string; concept_name: string; clo_id: string }>;
  }> => (await api.get(`/outcomes/catalog/${catalogId}/graph`)).data,
  // The student's own progress up the outcome chain - written whenever a
  // rubric criterion tagged with a CLO is graded (see backend grade_submission),
  // rolled up to PLO automatically.
  getMyCLOAttainment: async (courseId: number): Promise<CLOAttainment[]> =>
    (await api.get('/outcomes/my-clo-attainment', { params: { course_id: courseId } })).data,
  getMyPLOAttainment: async (): Promise<PLOAttainment[]> =>
    (await api.get('/outcomes/my-plo-attainment')).data,
};

export interface CLOAttainment {
  clo_id: number;
  clo_code: string;
  clo_title: string;
  attainment_score: number;
  evidence_count: number;
}

export interface PLOAttainment {
  plo_id: number;
  plo_code: string;
  plo_title: string;
  attainment_score: number;
  evidence_count: number;
}

// Shape returned by /courses/{id}/content/* - matches backend/app/content_generation/schemas.py
export interface GeneratedContentItem {
  id: number;
  course_id: number;
  concept_node_id: string;
  concept_name: string;
  content_type: 'flashcard' | 'mcq' | 'quiz' | 'study_guide' | 'assignment';
  title: string;
  payload: any; // shape depends on content_type - see backend GeneratedContent docstring
  difficulty: 'Easy' | 'Medium' | 'Hard';
  // How many course-material excerpts this item was generated from. 0 means it was
  // written from the concept description alone, which the review UI surfaces so a
  // teacher knows how much to scrutinise it.
  grounded_excerpts: number;
  /** Language the learner-facing text is written in. Drives the read-aloud voice. */
  language: string;
  /** Course Learning Outcome this item was generated to support, if the teacher
   *  picked one from the "Link to CLO" dropdown at generation time. */
  clo_id: number | null;
  clo_code: string | null;
  status: 'PendingReview' | 'Approved' | 'Rejected';
  created_by_teacher_id: number;
  reviewed_by_id: number | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

/** One student's attempt at a generated quiz set - teacher-facing results view. */
export interface ContentAttemptSummary {
  id: number;
  student_id: number;
  student_name: string | null;
  score: number;
  correct_count: number;
  total_count: number;
  completed_at: string;
}

export interface QuizResult {
  score: number;
  correct_count: number;
  total_count: number;
  per_question: Array<{
    question: string; your_answer: number; correct_index: number; correct: boolean; explanation: string;
  }>;
}

// Shape returned by GET /courses/{id}/content-concepts - concepts shaped for a picker,
// with each concept's direct prerequisites already resolved so the UI can offer
// "generate for the parent concept instead" without another round-trip.
export interface GeneratableConcept {
  id: string;
  name: string;
  description: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  importance_score: number;
  parents: Array<{ id: string; name: string }>;
  has_parent: boolean;
}

/** A background generation job - what the progress modal polls. */
export interface GenerationJob {
  id: number;
  course_id: number;
  status: 'Queued' | 'Running' | 'Completed' | 'Failed';
  stage: string | null;
  concept_name: string | null;
  content_type: string;
  difficulty: string;
  result_content_id: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/** The shapes of question a teacher can ask for. Must match QUESTION_STYLES in
 *  backend/app/content_generation/schemas.py - the API rejects anything else. */
export type QuestionStyle = 'recall' | 'application' | 'true_false' | 'fill_blank' | 'analysis';

/** One generation request. Shared by the synchronous and queued endpoints, which take
 *  the same body - keeping one type stops the two drifting apart, which is how the
 *  synchronous path ended up silently ignoring language and source_text. */
export interface GenerateContentPayload {
  concept_node_id: string;
  concept_name: string;
  content_type: string;
  question_count?: number;
  card_count?: number;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  // Which concept(s) the material covers. The client always sends the concept the
  // teacher is looking at; the backend resolves the parent from Neo4j, so no
  // parent node id is needed here.
  //   'concept'  - the concept alone
  //   'parent'   - its prerequisite instead
  //   'combined' - both, integrated into one set
  target?: 'concept' | 'parent' | 'combined';
  use_course_material?: boolean;
  /** Language the learner-facing material is written in. */
  language?: string;
  /** Text from a document the teacher supplied for this generation only. */
  source_text?: string;
  /** Question shapes to mix. Empty/omitted lets the model choose. Questions only. */
  question_styles?: QuestionStyle[];
  /** The supplied document already holds questions: transcribe rather than write. */
  import_existing?: boolean;
  /** Course Learning Outcome this generated item is meant to support, chosen from
   *  the course catalog's CLO list via the "Link to CLO" dropdown. */
  clo_id?: number | null;
  /** Assignment only: how many rubric criteria to draft. Omitted lets the model decide. */
  criteria_count?: number | null;
}

// Content Generation (flashcards/MCQs/quizzes/study guides from concept-graph concepts)
export const contentGenerationService = {
  generate: async (
    courseId: number,
    data: GenerateContentPayload
  ): Promise<GeneratedContentItem> => {
    // Generation is a multi-step AI call (retrieval + generation + up to 3 validation
    // retries), so it needs far longer than the 20s default.
    const res = await api.post(`/courses/${courseId}/content/generate`, data, { timeout: 120000 });
    return res.data;
  },
  /**
   * Queues generation and returns immediately with a job to poll.
   *
   * Preferred over generate(): a 30-90 second request makes the teacher watch a
   * spinner, loses the work on refresh, and can be killed by a gateway timeout after
   * the model has already been paid for.
   */
  generateAsync: async (
    courseId: number,
    data: GenerateContentPayload
  ): Promise<GenerationJob> => {
    const res = await api.post(`/courses/${courseId}/content/generate-async`, data);
    return res.data;
  },
  getJob: async (courseId: number, jobId: number): Promise<GenerationJob> => {
    // Opted out of the GET cache: a poll that returns a 45s-old status would report
    // "Running" long after the job finished.
    const res = await api.get(`/courses/${courseId}/content/jobs/${jobId}`, { cache: false } as any);
    return res.data;
  },
  // Turns an "assignment"-type draft into a real Assignment + Published Rubric -
  // the approve step for this content type (see backend create_assignment_from_content).
  createAssignmentFromContent: async (
    courseId: number, contentId: number
  ): Promise<{ assignment_id: number; course_id: number; rubric_id: number }> => {
    const res = await api.post(`/courses/${courseId}/content/${contentId}/create-assignment`);
    return res.data;
  },
  listJobs: async (courseId: number, activeOnly = false): Promise<GenerationJob[]> => {
    const res = await api.get(`/courses/${courseId}/content/jobs`, {
      params: { active_only: activeOnly }, cache: false,
    } as any);
    return res.data;
  },
  /**
   * Reads the text out of a document to generate from. The file is NOT uploaded to
   * the course - it is a one-off source for a single generation, so it never enters
   * the RAG index, the files list or concept extraction.
   */
  extractSource: async (
    courseId: number, file: File
  ): Promise<{ filename: string; characters: number; truncated: boolean; used_ocr: boolean; source_text: string }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post(`/courses/${courseId}/content/extract-source`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
    });
    return res.data;
  },
  listConcepts: async (courseId: number): Promise<GeneratableConcept[]> => {
    const res = await api.get(`/courses/${courseId}/content-concepts`);
    return res.data;
  },
  list: async (courseId: number, contentType?: string): Promise<GeneratedContentItem[]> => {
    const res = await api.get(`/courses/${courseId}/content`, { params: contentType ? { content_type: contentType } : undefined });
    return res.data;
  },
  get: async (courseId: number, contentId: number): Promise<GeneratedContentItem> => {
    const res = await api.get(`/courses/${courseId}/content/${contentId}`);
    return res.data;
  },
  edit: async (courseId: number, contentId: number, data: { title?: string; payload?: any }): Promise<GeneratedContentItem> => {
    const res = await api.patch(`/courses/${courseId}/content/${contentId}`, data);
    return res.data;
  },
  // AI-refine a still-pending draft with a targeted instruction (assignment drafts
  // only, for now - see backend refine_content).
  refine: async (courseId: number, contentId: number, instruction: string): Promise<GeneratedContentItem> => {
    const res = await api.post(`/courses/${courseId}/content/${contentId}/refine`, { instruction }, { timeout: 60000 });
    return res.data;
  },
  review: async (courseId: number, contentId: number, approve: boolean, notes?: string): Promise<GeneratedContentItem> => {
    const res = await api.post(`/courses/${courseId}/content/${contentId}/review`, { approve, notes });
    return res.data;
  },
  remove: async (courseId: number, contentId: number): Promise<void> => {
    await api.delete(`/courses/${courseId}/content/${contentId}`);
  },
  submitAttempt: async (courseId: number, contentId: number, answers: number[]): Promise<QuizResult> => {
    const res = await api.post(`/courses/${courseId}/content/${contentId}/attempt`, { answers });
    return res.data;
  },
  /** Teacher-only: every student attempt at one generated quiz set. */
  attempts: async (courseId: number, contentId: number): Promise<ContentAttemptSummary[]> => {
    const res = await api.get(`/courses/${courseId}/content/${contentId}/attempts`);
    return res.data;
  },
};

// Shape returned by /courses/{id}/gamification/* and /gamification/badges -
// matches backend/app/gamification/schemas.py
export interface BadgeItem {
  id: number;
  code: string;
  name: string;
  description: string;
  icon: string;
  points_reward: number;
}

export interface LeaderboardEntry {
  student_id: number;
  student_name: string;
  total_points: number;
  current_streak_days: number;
  rank: number;
}

export interface MyGamificationSummary {
  course_id: number;
  total_points: number;
  current_streak_days: number;
  longest_streak_days: number;
  badges: BadgeItem[];
}

// ── Practice: mock tests + analytics - matches backend/app/practice ──
export interface MockTest {
  attempt_token: string;
  question_count: number;
  total_points: number;
  questions: ServedQuestion[];
}

export interface MockResult {
  score: number;
  points_earned: number;
  points_possible: number;
  per_question: Array<{
    id: number; prompt: string; question_type: string; concept_name: string | null;
    difficulty: string; points: number; points_earned: number; correct: boolean;
    answered: boolean; explanation: string;
  }>;
  by_concept: Array<{ name: string; accuracy: number; points_possible: number }>;
  by_difficulty: Array<{ name: string; accuracy: number; points_possible: number }>;
}

export interface PracticeAnalytics {
  window_days: number;
  concepts: Array<{ concept_node_id: string; concept_name: string; mastery: number; evidence_count: number }>;
  weakest: Array<{ concept_node_id: string; concept_name: string; mastery: number; evidence_count: number }>;
  strongest: Array<{ concept_node_id: string; concept_name: string; mastery: number; evidence_count: number }>;
  mode_breakdown: Array<{ mode: string; sessions: number; average_score: number }>;
  practice_trend: Array<{ date: string | null; mode: string; score: number }>;
  assessment_trend: Array<{ date: string | null; source: string; score: number; concept_name: string | null }>;
  total_sessions: number;
  active_days: number;
  current_streak_days: number;
  longest_streak_days: number;
  total_points: number;
}

export const practiceService = {
  bankSize: async (courseId: number): Promise<{ available: number; max_size: number }> => {
    const res = await api.get(`/courses/${courseId}/practice/bank-size`);
    return res.data;
  },
  startMock: async (courseId: number, size = 20): Promise<MockTest> => {
    const res = await api.post(`/courses/${courseId}/practice/mock-test`, { size });
    return res.data;
  },
  submitMock: async (
    courseId: number, attemptToken: string, responses: Record<string, any>, durationSeconds?: number
  ): Promise<MockResult> => {
    const res = await api.post(`/courses/${courseId}/practice/mock-test/submit`, {
      attempt_token: attemptToken, responses, duration_seconds: durationSeconds,
    });
    return res.data;
  },
  analytics: async (courseId: number, days = 30): Promise<PracticeAnalytics> => {
    const res = await api.get(`/courses/${courseId}/practice/analytics`, { params: { days } });
    return res.data;
  },
};

// ── Live multiplayer quiz - matches backend/app/live ──
export interface LiveSession {
  id: number;
  code: string;
  title: string;
  status: 'waiting' | 'question' | 'reveal' | 'ended';
  question_count: number;
  seconds_per_question: number;
  speed_bonus_max: number;
  participants: number;
}

export interface LiveState {
  type: 'state';
  code: string;
  title: string;
  status: 'waiting' | 'question' | 'reveal' | 'ended';
  current_index: number;
  total_questions: number;
  participants: number;
  seconds_per_question: number;
  remaining_seconds?: number;
  leaderboard: Array<{ participant_id: number; nickname: string; score: number; correct_count: number; rank: number }>;
  question?: ServedQuestion & { index: number; total: number };
  reveal?: {
    answered: number; correct: number;
    distribution: Record<string, number>; answer_key: string;
  };
}

export const liveQuizService = {
  createSession: async (
    courseId: number,
    data: { title: string; question_ids: number[]; seconds_per_question?: number; speed_bonus_max?: number }
  ): Promise<LiveSession> => {
    const res = await api.post(`/courses/${courseId}/live/sessions`, data);
    return res.data;
  },
  listSessions: async (courseId: number): Promise<LiveSession[]> => {
    const res = await api.get(`/courses/${courseId}/live/sessions`);
    return res.data;
  },
  join: async (code: string, nickname: string): Promise<{
    session_id: number; participant_id: number; code: string; title: string; nickname: string; status: string;
  }> => {
    const res = await api.post('/live/join', { code, nickname });
    return res.data;
  },
  /**
   * Opens the play socket.
   *
   * A browser WebSocket cannot send an Authorization header, so the JWT goes in the
   * query string and the server decodes it with the same helper the HTTP dependency
   * uses. Same-origin and never logged by this app; the alternative - an
   * unauthenticated socket trusting a client-sent user id - would be far worse.
   */
  connect: (code: string): WebSocket => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    const wsBase = API_URL.replace(/^http/, 'ws');
    return new WebSocket(`${wsBase}/live/ws/${encodeURIComponent(code)}?token=${encodeURIComponent(token)}`);
  },
};

// ── Question bank + exams - matches backend/app/question_bank and app/exams ──
export type QuestionType = 'single_choice' | 'multi_select' | 'true_false' | 'fill_blank' | 'matching';

/** Answer-key shape per type. Teacher-facing only; never sent to a sitting student. */
export interface QuestionPayload {
  options?: string[];
  correct_index?: number;
  correct_indices?: number[];
  correct?: boolean;
  accepted?: string[];
  case_sensitive?: boolean;
  pairs?: Array<{ left: string; right: string }>;
}

export interface BankQuestion {
  id: number;
  course_id: number;
  question_type: QuestionType;
  question_type_label: string;
  prompt: string;
  payload: QuestionPayload;
  explanation: string | null;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  points: number;
  time_limit_seconds: number | null;
  concept_node_id: string | null;
  concept_name: string | null;
  /** Course Learning Outcome this question assesses, if tagged. */
  clo_id: number | null;
  clo_code: string | null;
  source: 'generated' | 'imported' | 'manual';
  status: string;
  created_at: string;
}

export interface ExamItem {
  id: number;
  course_id: number;
  title: string;
  description: string | null;
  question_ids: number[];
  question_count: number;
  missing_question_count: number;
  total_points: number;
  time_limit_seconds: number | null;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  max_attempts: number;
  pass_mark: number;
  show_answers_after: boolean;
  status: 'Draft' | 'Published' | 'Closed';
  created_at: string;
}

/** A question as a sitting student receives it - deliberately has no answer key. */
export interface ServedQuestion {
  id: number;
  question_type: QuestionType;
  prompt: string;
  points: number;
  difficulty: string;
  concept_name: string | null;
  time_limit_seconds: number | null;
  options?: string[];
  left_items?: string[];
  right_items?: string[];
}

export interface ExamAttempt {
  attempt_id: number;
  exam_id: number;
  title: string;
  description: string | null;
  attempt_number: number;
  questions: ServedQuestion[];
  remaining_seconds: number | null;
  time_limit_seconds: number | null;
  started_at: string;
}

export interface ExamResult {
  attempt_id: number;
  score: number;
  points_earned: number;
  points_possible: number;
  passed: boolean;
  pass_mark: number;
  late: boolean;
  per_question: Array<{
    id: number; prompt: string; question_type: string; points: number;
    points_earned: number; correct: boolean; answered: boolean;
    explanation?: string; answer_key?: string;
  }>;
}

export interface ExamAttemptSummary {
  id: number;
  student_id: number;
  student_name: string | null;
  attempt_number: number;
  score: number | null;
  passed: boolean | null;
  submitted_at: string | null;
}

export const questionBankService = {
  types: async (courseId: number): Promise<Array<{ key: QuestionType; label: string }>> => {
    const res = await api.get(`/courses/${courseId}/question-bank/types`);
    return res.data;
  },
  list: async (
    courseId: number,
    filters?: { question_type?: string; difficulty?: string; concept_node_id?: string; search?: string }
  ): Promise<BankQuestion[]> => {
    const res = await api.get(`/courses/${courseId}/question-bank`, { params: filters });
    return res.data;
  },
  create: async (courseId: number, data: any): Promise<BankQuestion> => {
    const res = await api.post(`/courses/${courseId}/question-bank`, data);
    return res.data;
  },
  update: async (courseId: number, questionId: number, data: any): Promise<BankQuestion> => {
    const res = await api.patch(`/courses/${courseId}/question-bank/${questionId}`, data);
    return res.data;
  },
  remove: async (courseId: number, questionId: number): Promise<void> => {
    await api.delete(`/courses/${courseId}/question-bank/${questionId}`);
  },
  importFromContent: async (
    courseId: number, contentId: number
  ): Promise<{ imported: number; skipped: number; message: string }> => {
    const res = await api.post(`/courses/${courseId}/question-bank/import`, { content_id: contentId });
    return res.data;
  },
  generate: async (
    courseId: number,
    data: { concept_node_id: string; question_type: QuestionType; count?: number; difficulty?: string }
  ): Promise<BankQuestion[]> => {
    // Writing several questions with validated answer keys, with up to 3 retries.
    const res = await api.post(`/courses/${courseId}/question-bank/generate`, data, { timeout: 120000 });
    return res.data;
  },
};

export const examService = {
  list: async (courseId: number): Promise<ExamItem[]> => {
    const res = await api.get(`/courses/${courseId}/exams`);
    return res.data;
  },
  create: async (courseId: number, data: any): Promise<ExamItem> => {
    const res = await api.post(`/courses/${courseId}/exams`, data);
    return res.data;
  },
  update: async (courseId: number, examId: number, data: any): Promise<ExamItem> => {
    const res = await api.patch(`/courses/${courseId}/exams/${examId}`, data);
    return res.data;
  },
  remove: async (courseId: number, examId: number): Promise<void> => {
    await api.delete(`/courses/${courseId}/exams/${examId}`);
  },
  attempts: async (courseId: number, examId: number): Promise<ExamAttemptSummary[]> => {
    const res = await api.get(`/courses/${courseId}/exams/${examId}/attempts`);
    return res.data;
  },
  startAttempt: async (courseId: number, examId: number): Promise<ExamAttempt> => {
    const res = await api.post(`/courses/${courseId}/exams/${examId}/attempt`);
    return res.data;
  },
  submitAttempt: async (
    courseId: number, examId: number, attemptId: number, responses: Record<string, any>
  ): Promise<ExamResult> => {
    const res = await api.post(
      `/courses/${courseId}/exams/${examId}/attempt/${attemptId}/submit`, { responses }
    );
    return res.data;
  },
};

// ── Study modes (Learn / Test / Match) - matches backend/app/study/schemas.py ──
// These run entirely on already-approved generated material and make no AI calls,
// which is why they are instant and free to repeat.
export interface StudyOverviewItem {
  content_id: number;
  title: string;
  content_type: 'flashcard' | 'mcq' | 'quiz';
  concept_name: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  total_items: number;
  mastered: number;
  due: number;
  supports_match: boolean;
}

export interface LearnQueueItem {
  kind: 'card' | 'question';
  index: number;
  prompt: string;
  answer?: string | null;
  options?: string[] | null;
  correct_index?: number | null;
  explanation?: string | null;
  box: number;
  times_seen: number;
}

export interface LearnProgress {
  total: number; new: number; due: number; mastered: number; resting: number;
}

export interface LearnQueue {
  content_id: number;
  title: string;
  content_type: string;
  queue: LearnQueueItem[];
  progress: LearnProgress;
}

export interface StudyTest {
  content_id: number;
  title: string;
  attempt_token: string;
  // No correct_index: the answer key stays on the server and scoring happens there.
  questions: Array<{ source_index: number; question: string; options: string[]; explanation: string }>;
}

export interface StudyTestResult {
  score: number;
  correct_count: number;
  total_count: number;
  per_question: Array<{
    question: string; options: string[]; your_answer: number;
    correct_index: number; correct: boolean; explanation: string;
  }>;
}

export interface MatchSet {
  content_id: number;
  title: string;
  pairs: Array<{ index: number; term: string; definition: string }>;
}

export interface StudySessionItem {
  id: number;
  mode: 'learn' | 'test' | 'match';
  score: number;
  items_total: number;
  items_correct: number;
  duration_seconds: number | null;
  concept_name: string | null;
  created_at: string;
}

export const studyService = {
  overview: async (courseId: number): Promise<StudyOverviewItem[]> => {
    const res = await api.get(`/courses/${courseId}/study/overview`);
    return res.data;
  },
  getLearnQueue: async (courseId: number, contentId: number, limit = 20): Promise<LearnQueue> => {
    const res = await api.get(`/courses/${courseId}/study/${contentId}/learn`, { params: { limit } });
    return res.data;
  },
  submitLearn: async (
    courseId: number, contentId: number,
    answers: Array<{ item_index: number; correct: boolean }>, durationSeconds?: number
  ): Promise<{ score: number; items_total: number; items_correct: number; progress: LearnProgress }> => {
    const res = await api.post(`/courses/${courseId}/study/${contentId}/learn`, {
      answers, duration_seconds: durationSeconds,
    });
    return res.data;
  },
  startTest: async (courseId: number, contentId: number, count?: number): Promise<StudyTest> => {
    const res = await api.get(`/courses/${courseId}/study/${contentId}/test`, {
      params: count ? { count } : undefined,
    });
    return res.data;
  },
  submitTest: async (
    courseId: number, contentId: number, attemptToken: string, answers: number[]
  ): Promise<StudyTestResult> => {
    const res = await api.post(`/courses/${courseId}/study/${contentId}/test`, {
      attempt_token: attemptToken, answers,
    });
    return res.data;
  },
  startMatch: async (courseId: number, contentId: number, pairs = 6): Promise<MatchSet> => {
    const res = await api.get(`/courses/${courseId}/study/${contentId}/match`, { params: { pairs } });
    return res.data;
  },
  submitMatch: async (
    courseId: number, contentId: number,
    data: { pairs_total: number; pairs_matched: number; duration_seconds: number }
  ): Promise<void> => {
    await api.post(`/courses/${courseId}/study/${contentId}/match`, data);
  },
  sessions: async (courseId: number, limit = 20): Promise<StudySessionItem[]> => {
    const res = await api.get(`/courses/${courseId}/study/sessions`, { params: { limit } });
    return res.data;
  },
};

// Shape returned by /games/* - matches backend GeneratedGame. html_source is
// deliberately NOT included: the page is fetched separately and only as text.
export interface ConceptGame {
  id: number;
  course_id: number;
  concept_node_id: string;
  concept_name: string;
  title: string;
  game_kind: string | null;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  created_by_student_id: number;
  created_at: string;
}

// Concept games - a student picks a concept and the model authors a complete,
// self-contained HTML page they can play.
export const gameService = {
  generate: async (
    courseId: number,
    data: { concept_node_id: string; difficulty?: 'Easy' | 'Medium' | 'Hard' }
  ): Promise<ConceptGame> => {
    // Authoring a whole HTML page is the largest generation call in the app and can
    // take a couple of minutes, including a repair retry if the first page is malformed.
    const res = await api.post(`/games/course/${courseId}/generate`, data, { timeout: 240000 });
    return res.data;
  },
  list: async (courseId: number): Promise<ConceptGame[]> => {
    const res = await api.get(`/games/course/${courseId}`);
    return res.data;
  },
  recordPlay: async (gameId: number, score: number): Promise<void> => {
    await api.post(`/games/${gameId}/play`, { score });
  },
  /**
   * Fetches the game page as raw markup, for mounting in a sandboxed iframe.
   *
   * The play endpoint requires the Authorization header, so the page cannot simply be
   * pointed at with an <iframe src> - it would arrive unauthenticated and 401. Fetching
   * it here and handing the markup to srcDoc also lets the frame carry its own
   * sandbox attribute, which is what actually isolates this untrusted LLM-authored
   * HTML (the server's CSP response header does not survive into a srcDoc frame).
   */
  fetchHtml: async (gameId: number): Promise<string> => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const res = await fetch(`${API_URL}/games/${gameId}/play`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Could not load the game (${res.status})`);
    return res.text();
  },
  /**
   * Opens the game full-screen in a new tab.
   *
   * The new tab loads OUR OWN /game/:id route, which then mounts the untrusted markup
   * in a sandboxed iframe - it does NOT navigate straight to the generated HTML.
   *
   * The obvious shortcut, fetching the page and opening it as a `blob:` URL, is
   * unsafe and was removed: a blob: URL created by this document INHERITS this
   * document's origin. The generated page would then be same-origin with the app and
   * could read the auth token straight out of localStorage. `noopener` does not help,
   * because the problem is the origin, not the window reference. Routing through a
   * page we control keeps the LLM output inside `sandbox="allow-scripts"`, which is
   * the only thing here that actually gives it an opaque origin.
   */
  openInNewTab: (gameId: number): Window | null =>
    window.open(`/game/${gameId}`, '_blank', 'noopener,noreferrer'),
};

// Gamification Service - points, streaks, badges, leaderboard
export const gamificationService = {
  getLeaderboard: async (courseId: number): Promise<LeaderboardEntry[]> => {
    const res = await api.get(`/courses/${courseId}/gamification/leaderboard`);
    return res.data;
  },
  getMySummary: async (courseId: number): Promise<MyGamificationSummary> => {
    const res = await api.get(`/courses/${courseId}/gamification/my-summary`);
    return res.data;
  },
  listAllBadges: async (): Promise<BadgeItem[]> => {
    const res = await api.get('/gamification/badges');
    return res.data;
  },
};

// Shape returned by /courses/{id}/adaptive/* - matches backend/app/adaptive_engine/schemas.py
export interface RevisionPlanItem {
  concept_node_id: string;
  concept_name: string;
  mastery_score: number;
  is_foundational: boolean;
  dependents_count: number;
  reason: string;
  recommended_materials: Array<{ content_id: number; content_type: string; title: string }>;
}

export interface RevisionPlan {
  course_id: number;
  overall_progress: number | null;
  plan: RevisionPlanItem[];
}

// Adaptive Engine Service - personalized revision plans (Observe/Analyze/Plan/Act)
export const adaptiveEngineService = {
  getMyPlan: async (courseId: number): Promise<RevisionPlan> => {
    const res = await api.get(`/courses/${courseId}/adaptive/my-plan`);
    return res.data;
  },
  getStudentPlan: async (courseId: number, studentId: number): Promise<RevisionPlan> => {
    const res = await api.get(`/courses/${courseId}/adaptive/student/${studentId}`);
    return res.data;
  },
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

export interface ConceptMasteryStat {
  concept_node_id: string;
  concept_name: string;
  avg_mastery: number;
  students_with_evidence: number;
  at_risk_count: number;
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
  concept_mastery: ConceptMasteryStat[];
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

export interface RoleCounts {
  students: number;
  teachers: number;
  program_coordinators: number;
  course_coordinators: number;
  admins: number;
}

export interface CourseSummary {
  course_id: number;
  course_name: string;
  student_count: number;
  avg_completion_rate: number;
  avg_mastery: number | null;
}

export interface PlatformOverview {
  total_courses: number;
  total_programs: number;
  roles: RoleCounts;
  avg_completion_rate: number;
  courses: CourseSummary[];
  concept_mastery: ConceptMasteryStat[];
}

export const analyticsService = {
  getPlatformOverview: async (): Promise<PlatformOverview> => {
    const res = await api.get('/analytics/platform-overview');
    return res.data;
  },
  getCourseAnalytics: async (courseId: number): Promise<CourseAnalytics> => {
    const res = await api.get(`/analytics/course/${courseId}`);
    return res.data;
  },
  getMyProgress: async (): Promise<MyCourseProgress[]> => {
    const res = await api.get('/analytics/my-progress');
    return res.data;
  },
};
