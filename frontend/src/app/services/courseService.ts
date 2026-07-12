import type { Course, CourseCatalogEntry, CourseFormData } from '../types/course';
import { api } from '../lib/apiClient';

/** Raw shape returned by the FastAPI/Postgres-backed course endpoints. */
interface ApiCourse {
  id: string;
  catalog_id: string;
  catalog_name: string;
  catalog_code: string;
  prerequisite_name: string | null;
  teacher_id: string;
  teacher_name: string;
  semester: string;
  description: string;
  max_students: number | null;
  course_start_date: string;
  course_duration_months: number;
  course_end_date: string;
  enrollment_start_date: string;
  enrollment_end_date: string;
  enrollment_code: string;
  invite_link: string | null;
  status: Course['visibility'];
  enrolled_count: number;
  created_at: string;
  updated_at: string;
}

interface ApiCatalogEntry {
  id: string;
  name: string;
  code: string;
  prerequisite_id: string | null;
  coordinator_id: string | null;
  coordinator_name: string | null;
}

function fromApiCourse(c: ApiCourse): Course {
  return {
    id: c.id,
    courseId: c.catalog_id,
    courseName: c.catalog_name,
    courseCode: c.catalog_code,
    prerequisite: c.prerequisite_name ?? 'None',
    teacherId: c.teacher_id,
    teacherName: c.teacher_name,
    semester: c.semester,
    description: c.description,
    maxStudents: c.max_students,
    courseStartDate: c.course_start_date,
    courseDurationMonths: c.course_duration_months,
    courseEndDate: c.course_end_date,
    enrollmentStartDate: c.enrollment_start_date,
    enrollmentEndDate: c.enrollment_end_date,
    enrollmentCode: c.enrollment_code,
    inviteLink: c.invite_link ?? '',
    visibility: c.status,
    enrolledCount: c.enrolled_count,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function toApiCoursePayload(form: CourseFormData, teacherId: string) {
  return {
    catalog_id: form.courseId,
    teacher_id: teacherId,
    semester: form.semester,
    description: form.description,
    max_students: form.maxStudents,
    course_start_date: form.courseStartDate,
    course_duration_months: form.courseDurationMonths,
    enrollment_start_date: form.enrollmentStartDate,
    enrollment_end_date: form.enrollmentEndDate,
  };
}

function fromApiCatalogEntry(c: ApiCatalogEntry): CourseCatalogEntry {
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    prerequisiteId: c.prerequisite_id,
    coordinatorId: c.coordinator_id,
    coordinatorName: c.coordinator_name,
  };
}

export interface CourseFilters {
  /** Only this teacher's own offerings — GCR-style "my classes". */
  teacherId?: string;
  /** Only offerings of this catalog course. */
  catalogId?: string;
}

export const courseService = {
  async getAll(filters?: CourseFilters): Promise<Course[]> {
    const params = new URLSearchParams();
    if (filters?.teacherId) params.set('teacher_id', filters.teacherId);
    if (filters?.catalogId) params.set('catalog_id', filters.catalogId);
    const query = params.toString();
    const courses = await api.get<ApiCourse[]>(`/courses${query ? `?${query}` : ''}`);
    return courses.map(fromApiCourse);
  },

  async getById(id: string): Promise<Course | undefined> {
    try {
      return fromApiCourse(await api.get<ApiCourse>(`/courses/${id}`));
    } catch {
      return undefined;
    }
  },

  async save(form: CourseFormData, teacherId: string, existingId?: string): Promise<Course> {
    const payload = toApiCoursePayload(form, teacherId);
    if (existingId) {
      const { catalog_id: _catalogId, teacher_id: _teacherId, ...updatable } = payload;
      return fromApiCourse(await api.patch<ApiCourse>(`/courses/${existingId}`, updatable));
    }
    return fromApiCourse(await api.post<ApiCourse>('/courses', payload));
  },

  delete(id: string): Promise<void> {
    return api.delete(`/courses/${id}`);
  },
};

/**
 * Course catalog lives entirely in Postgres (backend/db/schema.sql seeds the
 * 3 in-scope courses). Coordinators/Admins may extend it if the system is
 * expanded in the future.
 */
export const courseCatalogService = {
  async getAll(): Promise<CourseCatalogEntry[]> {
    const entries = await api.get<ApiCatalogEntry[]>('/catalog');
    return entries.map(fromApiCatalogEntry);
  },

  async add(entry: Omit<CourseCatalogEntry, 'id'>): Promise<CourseCatalogEntry> {
    const created = await api.post<ApiCatalogEntry>('/catalog', {
      name: entry.name,
      code: entry.code,
      prerequisite_id: entry.prerequisiteId,
    });
    return fromApiCatalogEntry(created);
  },

  async update(
    id: string,
    updates: Partial<Omit<CourseCatalogEntry, 'id'>>
  ): Promise<CourseCatalogEntry | null> {
    const body: Record<string, unknown> = {};
    if (updates.name !== undefined) body.name = updates.name;
    if (updates.code !== undefined) body.code = updates.code;
    if (updates.prerequisiteId !== undefined) body.prerequisite_id = updates.prerequisiteId;
    try {
      return fromApiCatalogEntry(await api.patch<ApiCatalogEntry>(`/catalog/${id}`, body));
    } catch {
      return null;
    }
  },

  async delete(id: string): Promise<boolean> {
    try {
      await api.delete(`/catalog/${id}`);
      return true;
    } catch {
      return false;
    }
  },
};

export type EnrollFailureReason = 'not_found' | 'not_open' | 'already_enrolled' | 'full';

export type EnrollByCodeResult =
  | { ok: true; course: Course }
  | { ok: false; reason: EnrollFailureReason };

const ENROLL_ERROR_REASONS: EnrollFailureReason[] = ['not_found', 'not_open', 'already_enrolled', 'full'];

/**
 * Students join a course with the enrollment code the Teacher generated,
 * mirroring a Google-Classroom-style class code.
 */
export const enrollmentService = {
  async enrollByCode(code: string, studentId: string): Promise<EnrollByCodeResult> {
    try {
      await api.post('/enrollments/join', { code, student_id: studentId });
      const courses = await api.get<ApiCourse[]>('/courses');
      const course = courses.find((c) => c.enrollment_code.toUpperCase() === code.trim().toUpperCase());
      return { ok: true, course: fromApiCourse(course!) };
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      const reason = ENROLL_ERROR_REASONS.find((r) => r === message) ?? 'not_found';
      return { ok: false, reason };
    }
  },
};
