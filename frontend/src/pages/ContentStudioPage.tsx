// ContentStudioPage: hosts Content Studio / Content Library. Picks a course, then shows
// one tab (generate, library, study, practice, exams, live quiz, question bank, games)
// which renders the matching component. The active tab and course live in the URL.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Sparkles, BookOpen, Network, AlertTriangle, Gamepad2, Brain, FileCheck2,
  Library, LibraryBig as Library2, Target, Radio,
} from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { getPrimaryNavItems } from '../lib/roleNav';
import { useAuth } from '../context/AuthContext';
import { courseService, enrollmentService } from '../services/api';
import { ContentGeneration } from '../components/ContentGeneration';
import { ConceptGames } from '../components/ConceptGames';
import { StudyModes } from '../components/StudyModes';
import { Exams } from '../components/Exams';
import { QuestionBank } from '../components/QuestionBank';
import { EmptyStateIllustration } from '../components/illustrations';
import { ContentLibrary } from '../components/content/ContentLibrary';
import { PracticeHub } from '../components/PracticeHub';
import { LiveQuiz } from '../components/LiveQuiz';
import { apiErrorMessage } from '../lib/apiError';

// Normalised course shape used by the picker (teacher, admin and student APIs return different shapes).
interface CourseLite {
  id: number;
  name: string;
  code?: string | null;
  semester?: string | null;
  catalog_id?: number | null;
}

/**
 * Standalone home for AI-generated learning material.
 *
 * It exists separately from the card embedded in CourseDetail because generating
 * material is its own task, not something done in passing while looking at a course:
 * it needs room for a searchable concept picker, a difficulty choice, a type choice
 * and a review queue. The CourseDetail card stays as the quick path for a single
 * item; this page is where a teacher builds out a whole course's material and works
 * through what is pending review.
 *
 * Students get the same page in read-only form - the approved library plus the
 * concept games - so there is one place to go for "study material" regardless of role.
 */
type StudioTab = 'generate' | 'library' | 'study' | 'practice' | 'exams' | 'live' | 'bank' | 'games';

export const ContentStudioPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Coordinators are teachers carrying an extra flag, so role === 'teacher' covers
  // them. Admins are neither enrolled in courses nor teaching them, so they get the
  // full catalogue - without this they fell through to the student endpoint, which is
  // student-only and returns nothing useful for an admin.
  const isTeacher = user?.role === 'teacher';
  const isAdmin = user?.role === 'admin';
  const canAuthor = isTeacher || isAdmin;
  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 'generate' composes new material; 'library' is where it is stored and used.
  // Two separate surfaces because they are different jobs: one is a focused
  // authoring act, the other is browsing, reviewing, exporting and handing out.
  //
  // The tab lives in the URL rather than in component state so it can be linked to.
  // The sidebar needs that: Content Studio and Content Library are two entries there,
  // and with the tab held in state both would have landed on whichever one happened to
  // be the default. It also means a reload, a back button and a shared link all put
  // you back where you were.
  const requestedTab = (searchParams.get('tab') || (canAuthor ? 'generate' : 'library')) as StudioTab;
  // Authoring-only tabs fall back to the library rather than rendering an empty page,
  // so a student following a bookmarked or shared ?tab=generate link lands somewhere
  // real. The tab strip below already hides these; this covers the URL.
  const tab: StudioTab =
    !canAuthor && (requestedTab === 'generate' || requestedTab === 'bank') ? 'library' : requestedTab;
  // Switch tab by writing ?tab= into the URL (keeps other params).
  const setTab = (next: StudioTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  // Load the courses visible to this role and pick the initial one (from ?course= if valid).
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Teachers own courses; students are enrolled in them - two different endpoints
        // returning two different SHAPES. getTeacherCourses() returns courses directly,
        // but getMyCourses() returns EnrollmentDetailResponse - {id, status, progress,
        // course: {...}} - where `id` is the ENROLLMENT id, not the course id. Reading
        // it as a course silently produced the wrong id and undefined names.
        const list: CourseLite[] = isAdmin
          ? ((await courseService.getAll()) || []).map((c: any) => ({
              id: c.id, name: c.name, code: c.code, semester: c.semester, catalog_id: c.catalog_id ?? null,
            }))
          : isTeacher
          ? ((await courseService.getTeacherCourses()) || []).map((c: any) => ({
              id: c.id, name: c.name, code: c.code, semester: c.semester, catalog_id: c.catalog_id ?? null,
            }))
          : ((await enrollmentService.getMyCourses()) || [])
              .map((e: any) => e.course)
              .filter(Boolean)
              .map((c: any) => ({ id: c.id, name: c.name, code: c.code, semester: c.semester, catalog_id: c.catalog_id ?? null }));
        const cleaned = list.filter((c) => !!c.id && !!c.name);
        setCourses(cleaned);

        // ?course=<id> lets the concept graph's Generate button deep-link straight
        // into this page with the right course already selected.
        const fromUrl = parseInt(searchParams.get('course') || '', 10);
        const initial = cleaned.find((c) => c.id === fromUrl)?.id ?? cleaned[0]?.id ?? null;
        setCourseId(initial);
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not load your courses.'));
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTeacher, isAdmin]);

  const navItems = useMemo(() => getPrimaryNavItems(user, navigate), [user, navigate]);
  const selectedCourse = courses.find((c) => c.id === courseId) || null;

  // The heading follows the tab. The sidebar offers Content Studio and Content Library
  // as two destinations, so landing on the library under a heading that says "Content
  // Studio" would read as having clicked the wrong thing.
  const PageIcon = tab === 'library' ? Library2 : Sparkles;
  const pageTitle = tab === 'library' ? 'Content Library' : 'Content Studio';
  const pageBlurb =
    tab === 'library'
      ? canAuthor
        ? 'Everything generated for this course. Review it, edit it, export it, or open any item in its own tab.'
        : 'Study material your instructors have approved. Open any item to study it, or download it to work offline.'
      : canAuthor
        ? 'Generate flashcards, quizzes and study guides from your concept graph, grounded in the material you uploaded. Nothing reaches students until you approve it.'
        : 'Study material your instructors have approved, plus playable games generated for any concept.';

  // Select a course and mirror it into ?course= in the URL.
  const handleCourseChange = (id: number) => {
    setCourseId(id);
    // Merged into the existing params rather than replacing them: writing a bare
    // {course} object here would drop the tab and bounce you back to Generate every
    // time you switched course.
    const params = new URLSearchParams(searchParams);
    if (id) params.set('course', String(id));
    else params.delete('course');
    setSearchParams(params, { replace: true });
  };

  return (
    <AppShell roleLabel={pageTitle} logoIcon={PageIcon} navItems={navItems}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="animate-fade-up">
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2.5">
            <PageIcon className="w-6 h-6 text-secondary" />
            {pageTitle}
          </h1>
          <p className="text-sm text-text-secondary mt-1">{pageBlurb}</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-center gap-3 text-sm animate-fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
            <div className="shimmer-loader h-5 w-1/3 rounded mb-3" />
            <div className="shimmer-loader h-24 w-full rounded-xl" />
          </div>
        ) : courses.length === 0 ? (
          <div className="glass-panel rounded-2xl p-8 border border-border shadow-card text-center">
            <EmptyStateIllustration className="w-24 h-24 mx-auto mb-3" />
            <h3 className="text-base font-bold text-text-primary mb-1">No courses yet</h3>
            <p className="text-sm text-text-secondary">
              {canAuthor
                ? 'Create a course and upload some material, then come back to generate study content.'
                : 'Join a course to see its study material here.'}
            </p>
          </div>
        ) : (
          <>
            <div className="glass-panel rounded-2xl p-5 border border-border shadow-card animate-fade-up">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">Course</label>
                  <select
                    className="input-light w-full text-sm"
                    value={courseId ?? ''}
                    onChange={(e) => handleCourseChange(parseInt(e.target.value, 10))}
                  >
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.code ? ` (${c.code})` : ''}{c.semester ? ` — ${c.semester}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedCourse && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate(`/course/${selectedCourse.id}/graph`)}
                      className="btn-ghost text-xs px-3 py-1.5"
                    >
                      <Network className="w-3.5 h-3.5" />
                      Concept graph
                    </button>
                    <button
                      onClick={() => navigate(`/course/${selectedCourse.id}`)}
                      className="btn-ghost text-xs px-3 py-1.5"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      Course page
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 animate-fade-up">
              {/* Generate and Library are deliberately absent from this strip: the
                  sidebar (AppShell) already carries dedicated "Content Studio" and
                  "Content Library" links that set the same ?tab= param, so repeating
                  them here would just be a second, redundant way to reach the exact
                  same two destinations. The question bank is authoring-only: students
                  meet those questions through an exam, never as a browsable list with
                  answer keys. */}
              {([
                { key: 'study', label: 'Learn / Test / Match', icon: Brain },
                { key: 'practice', label: 'Practice & progress', icon: Target },
                { key: 'exams', label: 'Exams', icon: FileCheck2 },
                { key: 'live', label: 'Live quiz', icon: Radio },
                ...(canAuthor ? [{ key: 'bank', label: 'Question bank', icon: Library }] as const : []),
                { key: 'games', label: 'Concept games', icon: Gamepad2 },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all border ${
                    tab === key
                      ? 'border-primary/40 bg-primary-muted text-primary'
                      : 'border-border bg-surface text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content: each tab renders one component, keyed by course so it resets on course change. */}
            {courseId && tab === 'generate' && canAuthor && (
              <ContentGeneration
                key={`g-${courseId}`}
                courseId={courseId}
                isTeacher
                variant="page"
                catalogId={selectedCourse?.catalog_id}
                initialContentType={searchParams.get('type') || undefined}
              />
            )}
            {courseId && tab === 'library' && (
              <ContentLibrary key={`lib-${courseId}`} courseId={courseId} canManage={canAuthor} />
            )}
            {courseId && tab === 'study' && (
              <StudyModes key={`s-${courseId}`} courseId={courseId} canSolve={!canAuthor} />
            )}
            {courseId && tab === 'practice' && (
              <PracticeHub key={`p-${courseId}`} courseId={courseId} canSolve={!canAuthor} />
            )}
            {courseId && tab === 'live' && (
              <LiveQuiz key={`l-${courseId}`} courseId={courseId} canHost={canAuthor} />
            )}
            {courseId && tab === 'exams' && (
              <Exams key={`e-${courseId}`} courseId={courseId} canAuthor={canAuthor} />
            )}
            {courseId && tab === 'bank' && canAuthor && (
              <QuestionBank key={`b-${courseId}`} courseId={courseId} />
            )}
            {courseId && tab === 'games' && (
              <ConceptGames key={`g-${courseId}`} courseId={courseId} canSolve={!canAuthor} />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
};

export default ContentStudioPage;
