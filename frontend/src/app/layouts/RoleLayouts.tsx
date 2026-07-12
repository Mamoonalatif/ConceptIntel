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

export function HodLayout() {
  return <DashboardLayout role="hod" />;
}

export function AdminLayout() {
  return <DashboardLayout role="admin" />;
}
