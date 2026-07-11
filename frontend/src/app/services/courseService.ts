import type { Course, CourseFormData, CourseModule } from '../types/course';
import { generateCourseId, generateEnrollmentCode, generateInviteLink, generateAiCourseStructure } from '../lib/courseUtils';
import { authHeaders, getStoredToken } from './authService';

const STORAGE_KEY = 'conceptintel_courses';
const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function readCourses(): Course[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Course[]) : [];
  } catch {
    return [];
  }
}

function writeCourses(courses: Course[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
}

export const courseService = {
  getAll(): Course[] {
    return readCourses().sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  },

  getById(id: string): Course | undefined {
    return readCourses().find((c) => c.id === id);
  },

  save(form: CourseFormData, existingId?: string, teacher?: { id: string; name: string }): Course {
    const courses = readCourses();
    const now = new Date().toISOString();
    const enrollmentCode =
      form.enrollmentCode || generateEnrollmentCode(form.subject, form.semester);
    const inviteLink = form.inviteLink || generateInviteLink(enrollmentCode);
    const teacherId = teacher?.id ?? 'teacher_001';
    const teacherName = teacher?.name ?? 'Teacher';

    if (existingId) {
      const index = courses.findIndex((c) => c.id === existingId);
      if (index >= 0) {
        const updated: Course = {
          ...courses[index],
          ...form,
          enrollmentCode,
          inviteLink,
          updatedAt: now,
        };
        courses[index] = updated;
        writeCourses(courses);
        return updated;
      }
    }

    const course: Course = {
      ...form,
      id: generateCourseId(),
      enrollmentCode,
      inviteLink,
      createdAt: now,
      updatedAt: now,
      teacherId,
      teacherName,
    };
    courses.push(course);
    writeCourses(courses);
    return course;
  },

  delete(id: string): void {
    writeCourses(readCourses().filter((c) => c.id !== id));
  },

  async generateAiStructure(payload: {
    title: string;
    subject: string;
    description: string;
    clos: string[];
    prerequisites: string[];
  }): Promise<{ modules: CourseModule[]; clos: string[] }> {
    const token = getStoredToken();
    if (token) {
      try {
        const res = await fetch(`${API_BASE}/courses/generate-structure`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          return res.json();
        }
      } catch {
        // Fall through to client-side generation when backend is unavailable
      }
    }

    const modules = generateAiCourseStructure(payload);
    const suggestedClos =
      payload.clos.length > 0
        ? payload.clos
        : modules.map((m) => `Demonstrate understanding of ${m.title.toLowerCase()}`);

    return { modules, clos: suggestedClos };
  },
};
