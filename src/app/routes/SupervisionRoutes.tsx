import { TeacherSupervisionPage } from '../pages/TeacherSupervisionPage';
import { ContentReviewPage } from '../pages/ContentReviewPage';

export function TeacherSupervisionRoute() {
  return <TeacherSupervisionPage basePath="/teacher" />;
}

export function TeacherContentReviewRoute() {
  return <ContentReviewPage basePath="/teacher" />;
}

export function CoordinatorSupervisionRoute() {
  return <TeacherSupervisionPage basePath="/coordinator" />;
}

export function CoordinatorContentReviewRoute() {
  return <ContentReviewPage basePath="/coordinator" />;
}
