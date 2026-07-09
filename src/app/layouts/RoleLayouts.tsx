import { ProtectedRoute } from '../components/auth/ProtectedRoute';
import { DashboardLayout } from '../components/layout/DashboardLayout';

export function TeacherLayout() {
  return (
    <ProtectedRoute allowedRoles={['teacher']}>
      <DashboardLayout role="teacher" />
    </ProtectedRoute>
  );
}

export function StudentLayout() {
  return (
    <ProtectedRoute allowedRoles={['student']}>
      <DashboardLayout role="student" />
    </ProtectedRoute>
  );
}

export function CoordinatorLayout() {
  return (
    <ProtectedRoute allowedRoles={['coordinator', 'admin']}>
      <DashboardLayout role="coordinator" />
    </ProtectedRoute>
  );
}

export function AdminLayout() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <DashboardLayout role="admin" />
    </ProtectedRoute>
  );
}
