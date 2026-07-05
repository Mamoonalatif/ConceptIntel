import { DashboardLayout } from '../components/layout/DashboardLayout';

export function TeacherLayout() {
  return <DashboardLayout role="teacher" />;
}

export function StudentLayout() {
  return <DashboardLayout role="student" />;
}

export function CoordinatorLayout() {
  return <DashboardLayout role="coordinator" />;
}

export function AdminLayout() {
  return <DashboardLayout role="admin" />;
}
