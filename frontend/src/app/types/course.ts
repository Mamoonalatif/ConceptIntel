export type CourseVisibility = 'draft' | 'open' | 'closed';

export interface CourseModule {
  id: string;
  title: string;
  week: number;
  topics: string[];
  duration: string;
  description?: string;
}

export interface CourseSchedule {
  startDate: string;
  endDate: string;
  sessionsPerWeek: number;
  sessionDuration: number;
  preferredDays: string[];
}

export interface CourseFormData {
  title: string;
  subject: string;
  semester: string;
  description: string;
  thumbnail: string | null;
  prerequisites: string[];
  clos: string[];
  plos: string[];
  visibility: CourseVisibility;
  enrollmentCode: string;
  inviteLink: string;
  schedule: CourseSchedule;
  modules: CourseModule[];
  aiAssisted: boolean;
}

export interface Course extends CourseFormData {
  id: string;
  createdAt: string;
  updatedAt: string;
  teacherId: string;
  teacherName: string;
}

export const SUBJECTS = [
  { value: 'cs', label: 'Computer Science' },
  { value: 'math', label: 'Mathematics' },
  { value: 'physics', label: 'Physics' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'business', label: 'Business' },
  { value: 'biology', label: 'Biology' },
] as const;

export const SEMESTERS = [
  { value: 'fall2026', label: 'Fall 2026' },
  { value: 'spring2027', label: 'Spring 2027' },
  { value: 'summer2027', label: 'Summer 2027' },
  { value: 'fall2027', label: 'Fall 2027' },
] as const;

export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

export const emptyCourseForm = (): CourseFormData => ({
  title: '',
  subject: '',
  semester: '',
  description: '',
  thumbnail: null,
  prerequisites: [],
  clos: [],
  plos: [],
  visibility: 'draft',
  enrollmentCode: '',
  inviteLink: '',
  schedule: {
    startDate: '',
    endDate: '',
    sessionsPerWeek: 2,
    sessionDuration: 90,
    preferredDays: ['Monday', 'Wednesday'],
  },
  modules: [],
  aiAssisted: false,
});
