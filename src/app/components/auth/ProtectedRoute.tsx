import { Navigate, useLocation } from 'react-router';
import { useAuth, type AuthRole } from '../../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: AuthRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!allowedRoles.includes(user.role)) {
    const fallback =
      user.role === 'teacher'
        ? '/teacher/dashboard'
        : user.role === 'admin'
          ? '/admin/dashboard'
          : '/student/dashboard';
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}

interface PublicOnlyRouteProps {
  children: React.ReactNode;
}

export function PublicOnlyRoute({ children }: PublicOnlyRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    const fallback =
      user.role === 'teacher'
        ? '/teacher/dashboard'
        : user.role === 'admin'
          ? '/admin/dashboard'
          : '/student/dashboard';
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
