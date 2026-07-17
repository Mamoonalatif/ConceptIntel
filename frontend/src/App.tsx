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

const defaultDashboardFor = (role: string) => {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  if (role === 'program_coordinator') return '/program-coordinator';
  if (role === 'course_coordinator') return '/course-coordinator';
  return '/student';
};

// Route wrapper to check if user is authenticated
const PrivateRoute: React.FC<{ children: React.ReactElement; requiredRole?: 'teacher' | 'student' | 'admin' | 'program_coordinator' | 'course_coordinator' }> = ({
  children,
  requiredRole
}) => {
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
    // Redirect unauthorized roles back to their default dashboard
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

        {/* Program Coordinator Protected Dashboard */}
        <Route
          path="/program-coordinator"
          element={
            <PrivateRoute requiredRole="program_coordinator">
              <ProgramCoordinatorDashboard />
            </PrivateRoute>
          }
        />

        {/* Course Coordinator Protected Dashboard */}
        <Route
          path="/course-coordinator"
          element={
            <PrivateRoute requiredRole="course_coordinator">
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
