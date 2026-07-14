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
};
