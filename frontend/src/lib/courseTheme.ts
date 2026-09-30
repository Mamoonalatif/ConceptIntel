// Course banner theming helper: maps a course's theme colour name to Tailwind gradient classes.
// Google Classroom-style per-course banner theming. Named colors, not raw hex -
// keeps every banner visually consistent with the app's existing brand palette
// instead of letting teachers pick an arbitrary, possibly-clashing color.
export const COURSE_THEME_PALETTE: Record<string, string> = {
  blue: 'from-primary to-primary-hover',
  teal: 'from-secondary to-secondary-hover',
  rose: 'from-rose-500 to-rose-600',
  amber: 'from-amber-500 to-amber-600',
  emerald: 'from-emerald-600 to-emerald-700',
  violet: 'from-violet-500 to-violet-600',
  sky: 'from-sky-500 to-sky-600',
};

// Fallback gradients, used when a course has no (valid) theme colour.
const DEFAULT_ROTATION = Object.values(COURSE_THEME_PALETTE);

/** A course's banner gradient class: the teacher's chosen theme_color if set and
 * valid, otherwise a stable default derived from the course id (so a course
 * without a chosen theme still looks consistent across renders/pages). */
export function getCourseBannerClass(course: { id: number; theme_color?: string | null }): string {
  if (course.theme_color && COURSE_THEME_PALETTE[course.theme_color]) {
    return COURSE_THEME_PALETTE[course.theme_color];
  }
  return DEFAULT_ROTATION[Math.abs(course.id) % DEFAULT_ROTATION.length];
}
