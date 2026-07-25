import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import RequestTeacherAccess from './pages/RequestTeacherAccess';
import TeacherDashboard from './pages/TeacherDashboard';
import StudentDashboard from './pages/StudentDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ProgramCoordinatorDashboard from './pages/ProgramCoordinatorDashboard';
import CourseCoordinatorDashboard from './pages/CourseCoordinatorDashboard';
import CourseDetail from './pages/CourseDetail';
import KnowledgeGraph from './pages/KnowledgeGraph';
import JoinCourse from './pages/JoinCourse';

const queryClient = new QueryClient();

// A user's default landing dashboard is always their base role's - teacher stays on
// /teacher even if they also hold coordinator authority (they navigate to the
// coordinator panel via a link from there, see TeacherDashboard/CourseCoordinatorDashboard).
const defaultDashboardFor = (role: string) => {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  return '/student';
};

type Authority = 'program_coordinator' | 'course_coordinator';

const hasAuthority = (user: { role: string; is_program_coordinator: boolean; is_course_coordinator: boolean }, authority: Authority) => {
  if (user.role === 'admin') return true; // admin always has every coordinator authority too
  return authority === 'program_coordinator' ? user.is_program_coordinator : user.is_course_coordinator;
};

// Route wrapper to check if user is authenticated
const PrivateRoute: React.FC<{
  children: React.ReactElement;
  requiredRole?: 'teacher' | 'student' | 'admin';
  requiredAuthority?: Authority; // additive coordinator authority, independent of requiredRole
}> = ({ children, requiredRole, requiredAuthority }) => {
  const { user, token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-tr from-primary to-secondary rounded-xl flex items-center justify-center shadow-glow">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-text-secondary text-xs font-medium">Authenticating session...</p>
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && user && user.role !== requiredRole) {
    return <Navigate to={defaultDashboardFor(user.role)} replace />;
  }

  if (requiredAuthority && user && !hasAuthority(user, requiredAuthority)) {
    return <Navigate to={defaultDashboardFor(user.role)} replace />;
  }

  return children;
};

// Route wrapper for guest pages (login/register)
const GuestRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { user, token, isLoading } = useAuth();

  if (isLoading) {
    return null; // Silent load
  }

  if (token && user) {
    return <Navigate to={defaultDashboardFor(user.role)} replace />;
  }

  return children;
};

const AppContent: React.FC = () => {
  return (
    <Router>
      <Routes>
        {/* Public Guest Routes */}
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
        <Route path="/request-teacher-access" element={<RequestTeacherAccess />} />
        <Route path="/join/:code" element={<JoinCourse />} />

        {/* Teacher Protected Dashboard */}
        <Route
          path="/teacher"
          element={
            <PrivateRoute requiredRole="teacher">
              <TeacherDashboard />
            </PrivateRoute>
          }
        />

        {/* Student Protected Dashboard */}
        <Route
          path="/student"
          element={
            <PrivateRoute requiredRole="student">
              <StudentDashboard />
            </PrivateRoute>
          }
        />

        {/* Admin Protected Dashboard */}
        <Route
          path="/admin"
          element={
            <PrivateRoute requiredRole="admin">
              <AdminDashboard />
            </PrivateRoute>
          }
        />

        {/* Program Coordinator Protected Dashboard - an additive authority on a
            teacher account (or admin), not a separate base role */}
        <Route
          path="/program-coordinator"
          element={
            <PrivateRoute requiredAuthority="program_coordinator">
              <ProgramCoordinatorDashboard />
            </PrivateRoute>
          }
        />

        {/* Course Coordinator Protected Dashboard - same additive-authority pattern */}
        <Route
          path="/course-coordinator"
          element={
            <PrivateRoute requiredAuthority="course_coordinator">
              <CourseCoordinatorDashboard />
            </PrivateRoute>
          }
        />

        {/* Shared Course Viewer */}
        <Route 
          path="/course/:courseId" 
          element={
            <PrivateRoute>
              <CourseDetail />
            </PrivateRoute>
          } 
        />

        {/* Shared Knowledge Graph Canvas */}
        <Route 
          path="/course/:courseId/graph" 
          element={
            <PrivateRoute>
              <KnowledgeGraph />
            </PrivateRoute>
          } 
        />

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
};

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
