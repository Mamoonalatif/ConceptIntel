export type CourseVisibility = 'draft' | 'open' | 'closed';

/**
 * teacher      — creates/manages their own course offerings ("classes")
 * coordinator  — supervises ONE assigned course across all teachers' offerings of it
 * hod          — Head of Department: decides whether the catalog grows (adds new courses)
 * admin        — system-wide superuser
 */
export type UserCourseRole = 'teacher' | 'coordinator' | 'hod' | 'admin';

/**
 * Course catalog entries live in Postgres (backend/db/schema.sql), not in
 * frontend code — see courseCatalogService in services/courseService.ts.
 */
export interface CourseCatalogEntry {
  id: string;
  name: string;
  code: string;
  /** Catalog id of the prerequisite course, or null if none. */
  prerequisiteId: string | null;
  /** The Coordinator supervising this course, if assigned. */
  coordinatorId: string | null;
  coordinatorName: string | null;
}

export const SEMESTERS = [
  { value: 'fall2026', label: 'Fall 2026' },
  { value: 'spring2027', label: 'Spring 2027' },
  { value: 'summer2027', label: 'Summer 2027' },
  { value: 'fall2027', label: 'Fall 2027' },
] as const;

export interface CourseFormData {
  courseId: string;
  courseName: string;
  courseCode: string;
  /** Display name of the prerequisite course, or 'None'. */
  prerequisite: string;
  semester: string;
  description: string;
  maxStudents: number | null;
  courseStartDate: string;
  /** Course length in months; courseEndDate is derived from this + courseStartDate. */
  courseDurationMonths: number;
  /** Derived: courseStartDate + courseDurationMonths. Not user-editable. */
  courseEndDate: string;
  enrollmentStartDate: string;
  enrollmentEndDate: string;
  /** Derived from enrollment dates vs today — never set directly by the user. */
  visibility: CourseVisibility;
  /** Auto-generated on first save, e.g. "PHY101-FA26-X7K2". */
  enrollmentCode: string;
  inviteLink: string;
}

export interface Course extends CourseFormData {
  id: string;
  createdAt: string;
  updatedAt: string;
  teacherId: string;
  teacherName: string;
  /** Live count of students currently enrolled — not part of the editable form. */
  enrolledCount: number;
}

export const emptyCourseForm = (): CourseFormData => ({
  courseId: '',
  courseName: '',
  courseCode: '',
  prerequisite: 'None',
  semester: '',
  description: '',
  maxStudents: null,
  courseStartDate: '',
  courseDurationMonths: 4,
  courseEndDate: '',
  enrollmentStartDate: '',
  enrollmentEndDate: '',
  visibility: 'draft',
  enrollmentCode: '',
  inviteLink: '',
});
