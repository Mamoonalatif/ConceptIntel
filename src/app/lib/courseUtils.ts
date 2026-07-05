import type { CourseFormData, CourseModule } from '../types/course';

export function generateEnrollmentCode(subject: string, semester: string): string {
  const subj = (subject || 'GEN').slice(0, 3).toUpperCase();
  const sem = semester.replace(/\D/g, '').slice(-2) || '26';
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${subj}-${sem}${random.slice(0, 2)}-${random.slice(2)}`;
}

export function generateInviteLink(enrollmentCode: string): string {
  const slug = enrollmentCode.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `https://conceptintel.edu/join/${slug}`;
}

export function generateCourseId(): string {
  return `course_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

const SUBJECT_MODULES: Record<string, Omit<CourseModule, 'id'>[]> = {
  cs: [
    { title: 'Foundations & Complexity', week: 1, topics: ['Algorithm Analysis', 'Big-O Notation', 'Recursion'], duration: '2 weeks' },
    { title: 'Linear Data Structures', week: 3, topics: ['Arrays', 'Linked Lists', 'Stacks & Queues'], duration: '2 weeks' },
    { title: 'Trees & Graphs', week: 5, topics: ['Binary Trees', 'BST', 'Graph Traversal'], duration: '3 weeks' },
    { title: 'Sorting & Searching', week: 8, topics: ['Merge Sort', 'Quick Sort', 'Hash Tables'], duration: '2 weeks' },
    { title: 'Dynamic Programming', week: 10, topics: ['Memoization', 'Tabulation', 'Classic Problems'], duration: '2 weeks' },
    { title: 'Capstone & Review', week: 12, topics: ['Integration Project', 'Exam Prep'], duration: '2 weeks' },
  ],
  math: [
    { title: 'Linear Algebra Basics', week: 1, topics: ['Vectors', 'Matrices', 'Systems of Equations'], duration: '3 weeks' },
    { title: 'Calculus Review', week: 4, topics: ['Derivatives', 'Integrals', 'Multivariable'], duration: '3 weeks' },
    { title: 'Probability', week: 7, topics: ['Distributions', 'Bayes Theorem', 'Expectation'], duration: '3 weeks' },
    { title: 'Applied Mathematics', week: 10, topics: ['Optimization', 'Modeling'], duration: '3 weeks' },
  ],
  default: [
    { title: 'Introduction & Orientation', week: 1, topics: ['Course Overview', 'Learning Objectives', 'Assessment Plan'], duration: '1 week' },
    { title: 'Core Concepts I', week: 2, topics: ['Fundamentals', 'Key Terminology', 'Foundational Skills'], duration: '3 weeks' },
    { title: 'Core Concepts II', week: 5, topics: ['Advanced Topics', 'Case Studies', 'Applications'], duration: '3 weeks' },
    { title: 'Integration & Practice', week: 8, topics: ['Projects', 'Collaborative Work', 'Peer Review'], duration: '3 weeks' },
    { title: 'Assessment & Closure', week: 11, topics: ['Final Project', 'Review', 'Reflection'], duration: '2 weeks' },
  ],
};

export function generateAiCourseStructure(form: Pick<CourseFormData, 'title' | 'subject' | 'description' | 'clos'>): CourseModule[] {
  const template = SUBJECT_MODULES[form.subject] ?? SUBJECT_MODULES.default;
  const titleHint = form.title ? ` — ${form.title}` : '';

  return template.map((mod, i) => ({
    ...mod,
    id: `mod_${Date.now()}_${i}`,
    title: mod.title + (i === 0 && form.title ? titleHint : ''),
    description: form.clos[i % Math.max(form.clos.length, 1)] ?? `Covers essential ${mod.title.toLowerCase()} concepts`,
  }));
}

export function validateStep(step: number, form: CourseFormData): string | null {
  switch (step) {
    case 0:
      if (!form.title.trim()) return 'Course title is required';
      if (!form.subject) return 'Please select a subject';
      if (!form.semester) return 'Please select a semester';
      return null;
    case 1:
      if (form.clos.length === 0) return 'Add at least one Course Learning Outcome (CLO)';
      return null;
    case 2:
      if (!form.schedule.startDate) return 'Start date is required';
      if (!form.schedule.endDate) return 'End date is required';
      if (form.schedule.preferredDays.length === 0) return 'Select at least one session day';
      return null;
    case 3:
      if (!form.enrollmentCode) return 'Enrollment code is required';
      return null;
    case 4:
      if (form.aiAssisted && form.modules.length === 0) return 'Generate or add at least one module';
      return null;
    default:
      return null;
  }
}
