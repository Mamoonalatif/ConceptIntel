import {
  LayoutDashboard,
  PlusCircle,
  BookOpen,
  FileText,
  Upload,
  Network,
  Settings,
  Users,
  BarChart3,
  Shield,
  GraduationCap,
  Trophy,
  Brain,
} from 'lucide-react';

export type UserRole = 'teacher' | 'student' | 'coordinator' | 'admin';

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

export const teacherNavItems: NavItem[] = [
  { title: 'Dashboard', href: '/teacher/dashboard', icon: LayoutDashboard },
  { title: 'Create Course', href: '/teacher/course/create', icon: PlusCircle },
  { title: 'My Courses', href: '/teacher/courses', icon: BookOpen },
  { title: 'Content Upload', href: '/teacher/courses', icon: Upload },
  { title: 'Knowledge Graph', href: '/teacher/courses', icon: Network },
  { title: 'Assignments', href: '/teacher/assignment/1/evaluate', icon: FileText },
];

export const studentNavItems: NavItem[] = [
  { title: 'Dashboard', href: '/student/dashboard', icon: LayoutDashboard },
  { title: 'Enroll in Course', href: '/student/enroll', icon: GraduationCap },
  { title: 'My Learning', href: '/student/course/1', icon: BookOpen },
  { title: 'Adaptive Path', href: '/student/course/1/adaptive', icon: Brain },
  { title: 'Gamification', href: '/student/gamification', icon: Trophy },
];

export const coordinatorNavItems: NavItem[] = [
  { title: 'Curriculum Intel', href: '/coordinator/dashboard', icon: BarChart3 },
  { title: 'Knowledge Graph', href: '/coordinator/knowledge-graph', icon: Network },
  { title: 'Teachers', href: '/coordinator/dashboard', icon: Users },
];

export const adminNavItems: NavItem[] = [
  { title: 'Platform Overview', href: '/admin/dashboard', icon: Shield },
  { title: 'Users', href: '/admin/dashboard', icon: Users },
  { title: 'Settings', href: '/admin/dashboard', icon: Settings },
];

export const roleNavMap: Record<UserRole, NavItem[]> = {
  teacher: teacherNavItems,
  student: studentNavItems,
  coordinator: coordinatorNavItems,
  admin: adminNavItems,
};

export const roleLabels: Record<UserRole, string> = {
  teacher: 'Teacher',
  student: 'Student',
  coordinator: 'Coordinator',
  admin: 'Administrator',
};
