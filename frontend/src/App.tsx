import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Pages
import { LandingPage } from './pages/LandingPage';
import { AboutPage } from './pages/AboutPage';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import RequestTeacherAccess from './pages/RequestTeacherAccess';
import TeacherDashboard from './pages/TeacherDashboard';
import StudentDashboard from './pages/StudentDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ProgramCoordinatorDashboard from './pages/ProgramCoordinatorDashboard';
import CourseCoordinatorDashboard from './pages/CourseCoordinatorDashboard';
import CourseDetail from './pages/CourseDetail';
import KnowledgeGraph from './pages/KnowledgeGraph';
import CourseSchedule from './pages/CourseSchedule';
import JoinCourse from './pages/JoinCourse';
import ProfilePage from './pages/ProfilePage';
import CalendarPage from './pages/CalendarPage';
import AssistantPage from './pages/AssistantPage';
import SettingsPage from './pages/SettingsPage';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import ContentStudioPage from './pages/ContentStudioPage';
import GamePlayerPage from './pages/GamePlayerPage';
import ContentViewerPage from './pages/ContentViewerPage';
import NotFoundPage from './pages/NotFoundPage';
import { FoxSpinner } from './components/FoxSpinner';
import { defaultDashboardFor } from './lib/roleNav';

const queryClient = new QueryClient();

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
        <FoxSpinner className="w-12 h-12" label="Authenticating session..." />
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // token is set but the /auth/me fetch it triggered hasn't resolved yet - render
  // nothing (rather than the protected page with a null user) until it does, so a
  // requiredRole/requiredAuthority check below never runs against a user that just
  // hasn't loaded yet. Skipping this used to let the wrong dashboard render for a
  // moment right after login, before the redirect below caught up.
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <FoxSpinner className="w-12 h-12" label="Authenticating session..." />
      </div>
    );
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to={defaultDashboardFor(user.role)} replace />;
  }

  if (requiredAuthority && !hasAuthority(user, requiredAuthority)) {
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
        <Route path="/" element={<LandingPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
        <Route path="/forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />
        <Route path="/reset-password" element={<GuestRoute><ResetPassword /></GuestRoute>} />
        <Route path="/request-teacher-access" element={<RequestTeacherAccess />} />
        <Route path="/join/:code" element={<JoinCourse />} />

        {/* Shared Profile Page (all authenticated roles) */}
        <Route
          path="/profile"
          element={
            <PrivateRoute>
              <ProfilePage />
            </PrivateRoute>
          }
        />

        {/* Shared global destinations (all authenticated roles) */}
        <Route
          path="/calendar"
          element={
            <PrivateRoute>
              <CalendarPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/assistant"
          element={
            <PrivateRoute>
              <AssistantPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <SettingsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <PrivateRoute>
              <AnalyticsDashboard />
            </PrivateRoute>
          }
        />
        {/* Content Studio - generating/reviewing AI study material and concept games.
            Open to every signed-in role: it renders as an authoring surface for
            teachers and a read-only library plus game launcher for students. */}
        <Route
          path="/content-studio"
          element={
            <PrivateRoute>
              <ContentStudioPage />
            </PrivateRoute>
          }
        />
        {/* Full-screen view of one generated item, opened in its own tab from the
            library. A real route rather than a modal so it can be bookmarked, shared
            and printed. */}
        <Route
          path="/content/:courseId/:contentId"
          element={
            <PrivateRoute>
              <ContentViewerPage />
            </PrivateRoute>
          }
        />
        {/* Full-screen host for one generated game, opened in its own tab. The
            untrusted LLM-authored markup is mounted in a sandboxed iframe here rather
            than being navigated to directly - see GamePlayerPage for why a blob: URL
            would not be safe. */}
        <Route
          path="/game/:gameId"
          element={
            <PrivateRoute>
              <GamePlayerPage />
            </PrivateRoute>
          }
        />

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

        {/* Shared Concept Graph Canvas */}
        <Route
          path="/course/:courseId/graph"
          element={
            <PrivateRoute>
              <KnowledgeGraph />
            </PrivateRoute>
          }
        />

        {/* Course Schedule/Outline Preview */}
        <Route
          path="/course/:courseId/schedule"
          element={
            <PrivateRoute>
              <CourseSchedule />
            </PrivateRoute>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<NotFoundPage />} />
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
