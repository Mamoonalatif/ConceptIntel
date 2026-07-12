import type { CourseFormData, CourseVisibility } from '../types/course';

/** Formats a Date using its local calendar fields (avoids UTC-conversion off-by-one-day bugs). */
function toLocalISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO(): string {
  return toLocalISO(new Date());
}

/** Adds whole months to an ISO (YYYY-MM-DD) date string. */
export function addMonthsToDate(isoDate: string, months: number): string {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setMonth(d.getMonth() + months);
  return toLocalISO(d);
}

/** Course end date is always derived from start date + duration, never picked directly. */
export function computeCourseEndDate(courseStartDate: string, courseDurationMonths: number): string {
  return addMonthsToDate(courseStartDate, courseDurationMonths);
}

/**
 * Status is never set manually: Draft before the enrollment window opens,
 * Open during the enrollment window, Closed once it ends.
 */
export function computeCourseStatus(
  enrollmentStartDate: string,
  enrollmentEndDate: string,
  today: string = todayISO()
): CourseVisibility {
  if (!enrollmentStartDate || !enrollmentEndDate) return 'draft';
  if (today < enrollmentStartDate) return 'draft';
  if (today <= enrollmentEndDate) return 'open';
  return 'closed';
}

/** Step 0: course selection, semester, description, max students. */
function validateDetailsStep(form: CourseFormData): string | null {
  if (!form.courseId) return 'Please select a course';
  if (!form.semester) return 'Please select a semester';
  const len = form.description.trim().length;
  if (len < 20 || len > 100) return 'Course description must be between 20 and 100 characters';
  if (form.maxStudents !== null && form.maxStudents <= 0) {
    return 'Maximum number of students must be a positive number';
  }
  return null;
}

/** Step 1: course dates and enrollment window (status is derived, not entered). */
function validateDatesStep(form: CourseFormData): string | null {
  if (!form.courseStartDate) return 'Course start date is required';
  if (form.courseStartDate < todayISO()) return 'Course start date cannot be in the past';
  if (!form.courseDurationMonths || form.courseDurationMonths <= 0) {
    return 'Course duration must be at least 1 month';
  }

  const courseEndDate = computeCourseEndDate(form.courseStartDate, form.courseDurationMonths);

  if (!form.enrollmentStartDate) return 'Enrollment start date is required';
  if (!form.enrollmentEndDate) return 'Enrollment end date is required';
  if (form.enrollmentEndDate <= form.enrollmentStartDate) {
    return 'Enrollment end date must be after the enrollment start date';
  }
  if (form.enrollmentEndDate > courseEndDate) {
    return 'Enrollment end date cannot be after the course end date';
  }
  return null;
}

export function validateStep(step: number, form: CourseFormData): string | null {
  switch (step) {
    case 0:
      return validateDetailsStep(form);
    case 1:
      return validateDatesStep(form);
    default:
      return null;
  }
}
