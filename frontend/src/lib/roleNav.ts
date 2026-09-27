import { LayoutGrid, ListChecks, BookOpen, ShieldCheck, Network, Users, UserPlus, GraduationCap, ClipboardList } from 'lucide-react';
import type { NavItem } from '../components/AppShell';

interface RoleNavUser {
  role: string;
  is_program_coordinator?: boolean;
  is_course_coordinator?: boolean;
}

// A user's default landing dashboard is always their base role's - teacher stays
// on /teacher even if they also hold coordinator authority (they navigate to the
// coordinator panel via a link from there, see TeacherDashboard/
// CourseCoordinatorDashboard). Shared between App.tsx's route guards and the
// public marketing Nav (see Nav.tsx), so a logged-in visitor's "Dashboard" link
// always lands in the same place a role-based redirect would.
export function defaultDashboardFor(role: string): string {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  return '/student';
}

/** The role-specific top section of the sidebar (My Classes/To-Do, My Courses,
 * Admin sections, etc) - used on every page, not just each role's own
 * dashboard, so the sidebar looks identical everywhere instead of collapsing
 * down to just the global Calendar/Analytics/Assistant/Settings links whenever
 * the user isn't on their dashboard. Each item navigates back to the owning
 * dashboard route, passing which tab/section to land on via router state -
 * the dashboard reads that on mount (see StudentDashboard/AdminDashboard's
 * initial useState(() => location.state?.tab ...)). Nested per-course links
 * are deliberately NOT included here (those only make sense on the dashboard
 * itself, where the enrollment/course list is already loaded). */
export function getPrimaryNavItems(user: RoleNavUser | null | undefined, navigate: (path: string, opts?: any) => void): NavItem[] {
  if (!user) return [];

  const items: NavItem[] = [];

  if (user.role === 'student') {
    items.push(
      { key: 'classes', label: 'My Classes', icon: LayoutGrid, onClick: () => navigate('/student', { state: { tab: 'classes' } }) },
      { key: 'todo', label: 'To-Do', icon: ListChecks, onClick: () => navigate('/student', { state: { tab: 'todo' } }) },
    );
  } else if (user.role === 'teacher') {
    items.push({ key: 'courses', label: 'My Courses', icon: BookOpen, onClick: () => navigate('/teacher') });
    if (user.is_program_coordinator) {
      items.push({ key: 'program-coordinator', label: 'Program Coordinator Panel', icon: ShieldCheck, onClick: () => navigate('/program-coordinator') });
    }
    if (user.is_course_coordinator) {
      items.push({ key: 'course-coordinator', label: 'Course Coordinator Panel', icon: Network, onClick: () => navigate('/course-coordinator') });
    }
  } else if (user.role === 'program_coordinator') {
    items.push({ key: 'program-coordinator', label: 'Program Coordinator Panel', icon: ShieldCheck, onClick: () => navigate('/program-coordinator') });
  } else if (user.role === 'course_coordinator') {
    items.push({ key: 'course-coordinator', label: 'Course Coordinator Panel', icon: Network, onClick: () => navigate('/course-coordinator') });
  } else if (user.role === 'admin') {
    items.push(
      { key: 'users', label: 'All Students & Users', icon: Users, onClick: () => navigate('/admin', { state: { section: 'users' } }) },
      { key: 'create-teacher', label: 'Create Teacher Account', icon: UserPlus, onClick: () => navigate('/admin', { state: { section: 'create-teacher' } }) },
      { key: 'staff-roles', label: 'Manage Staff Roles', icon: GraduationCap, onClick: () => navigate('/admin', { state: { section: 'staff-roles' } }) },
      { key: 'programs', label: 'Manage Programs', icon: BookOpen, onClick: () => navigate('/admin', { state: { section: 'programs' } }) },
      { key: 'requests', label: 'Teacher Access Requests', icon: ClipboardList, onClick: () => navigate('/admin', { state: { section: 'requests' } }) },
      { key: 'logs', label: 'Activity Logs', icon: ListChecks, onClick: () => navigate('/admin', { state: { section: 'logs' } }) },
    );
  }

  return items;
}
