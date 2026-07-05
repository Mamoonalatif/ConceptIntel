import { createBrowserRouter } from 'react-router';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { CourseCreationPage } from './pages/CourseCreationPage';
import { MyCoursesPage } from './pages/MyCoursesPage';
import { ContentUploadPage } from './pages/ContentUploadPage';
import { KnowledgeGraphPage } from './pages/KnowledgeGraphPage';
import { CourseEnrollmentPage } from './pages/CourseEnrollmentPage';
import { StudentDashboard } from './pages/StudentDashboard';
import { CourseLearningHub } from './pages/CourseLearningHub';
import { AdaptiveLearningPage } from './pages/AdaptiveLearningPage';
import { AssignmentSubmissionPage } from './pages/AssignmentSubmissionPage';
import { TeacherDashboard } from './pages/TeacherDashboard';
import { AssignmentEvaluationPage } from './pages/AssignmentEvaluationPage';
import { CurriculumIntelligenceDashboard } from './pages/CurriculumIntelligenceDashboard';
import { KnowledgeGraphSupervisionPage } from './pages/KnowledgeGraphSupervisionPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { GamificationPage } from './pages/GamificationPage';
import {
  TeacherLayout,
  StudentLayout,
  CoordinatorLayout,
  AdminLayout,
} from './layouts/RoleLayouts';

export const router = createBrowserRouter([
  { path: '/', Component: LandingPage },
  { path: '/login', Component: LoginPage },
  { path: '/signup', Component: SignupPage },

  {
    path: '/teacher',
    Component: TeacherLayout,
    children: [
      { path: 'dashboard', Component: TeacherDashboard },
      { path: 'courses', Component: MyCoursesPage },
      { path: 'courses/:courseId', Component: MyCoursesPage },
      { path: 'course/create', Component: CourseCreationPage },
      { path: 'course/:courseId/content', Component: ContentUploadPage },
      { path: 'course/:courseId/knowledge-graph', Component: KnowledgeGraphPage },
      { path: 'assignment/:assignmentId/evaluate', Component: AssignmentEvaluationPage },
    ],
  },

  {
    path: '/student',
    Component: StudentLayout,
    children: [
      { path: 'dashboard', Component: StudentDashboard },
      { path: 'enroll', Component: CourseEnrollmentPage },
      { path: 'course/:courseId', Component: CourseLearningHub },
      { path: 'course/:courseId/adaptive', Component: AdaptiveLearningPage },
      { path: 'assignment/:assignmentId/submit', Component: AssignmentSubmissionPage },
      { path: 'gamification', Component: GamificationPage },
    ],
  },

  {
    path: '/coordinator',
    Component: CoordinatorLayout,
    children: [
      { path: 'dashboard', Component: CurriculumIntelligenceDashboard },
      { path: 'knowledge-graph', Component: KnowledgeGraphSupervisionPage },
    ],
  },

  {
    path: '/admin',
    Component: AdminLayout,
    children: [
      { path: 'dashboard', Component: AdminDashboard },
    ],
  },
]);
