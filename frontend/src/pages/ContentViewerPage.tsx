// ContentViewerPage: full-page viewer for one AI-generated item (flashcards, quiz, study
// guide) at /content/:courseId/:contentId. Teachers also get the answer key, a solve
// preview, student attempt stats and export buttons.
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Download, Printer, FileJson, AlertTriangle, Layers,
  ListChecks, BookOpen, ShieldCheck, ShieldAlert, Users, Eye, Play,
} from 'lucide-react';
import { contentGenerationService } from '../services/api';
import type { GeneratedContentItem, ContentAttemptSummary } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ContentBody, QuizPlayer, AnswerKeyView } from '../components/content/ContentViewers';
import type { MCQ } from '../components/content/ContentViewers';
import { downloadContentHtml, downloadContentJson, printContent } from '../lib/contentExport';
import { apiErrorMessage } from '../lib/apiError';
import { EmptyStateIllustration } from '../components/illustrations';
import { FoxSpinner } from '../components/FoxSpinner';

// Icon shown in the header for each content type.
const TYPE_ICON: Record<string, React.ElementType> = {
  flashcard: Layers, mcq: ListChecks, quiz: ListChecks, study_guide: BookOpen,
};

// Maps a difficulty string to its CSS badge class (defaults to "medium").
const badgeClassFor = (d: string) => `badge-${(d || 'medium').toLowerCase()}`;

/**
 * Full-screen view of a single generated item, at /content/:courseId/:contentId.
 *
 * A real route rather than a modal, so it can be opened in its own tab, bookmarked,
 * shared with a colleague and printed. That also makes it the natural home for the
 * things that do not fit in a card: the answer key beside the solving view, the list
 * of students who have attempted it, and the export actions.
 */
export const ContentViewerPage: React.FC = () => {
  const { courseId, contentId } = useParams<{ courseId: string; contentId: string }>();
  const cId = parseInt(courseId || '0', 10);
  const id = parseInt(contentId || '0', 10);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';

  const [item, setItem] = useState<GeneratedContentItem | null>(null);
  const [attempts, setAttempts] = useState<ContentAttemptSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Teachers default to the key; the solve view is opt-in so they can walk the paper
  // exactly as a student sees it before publishing.
  const [mode, setMode] = useState<'key' | 'solve'>('key');

  // Fetch the content item from the URL params.
  useEffect(() => {
    (async () => {
      try {
        setItem(await contentGenerationService.get(cId, id));
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not load this content.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [cId, id]);

  const isQuiz = item?.content_type === 'mcq' || item?.content_type === 'quiz';

  // Teachers only: load the list of student attempts for quiz-type content.
  useEffect(() => {
    if (!isTeacher || !isQuiz || !item) return;
    contentGenerationService.attempts(cId, item.id).then(setAttempts).catch(() => setAttempts([]));
  }, [isTeacher, isQuiz, item, cId]);

  // Summary numbers (attempt count, distinct students, average/best/worst score) from the attempts list.
  const stats = useMemo(() => {
    if (!attempts?.length) return null;
    const scores = attempts.map((a) => a.score);
    return {
      count: attempts.length,
      students: new Set(attempts.map((a) => a.student_id)).size,
      avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      best: Math.round(Math.max(...scores)),
      worst: Math.round(Math.min(...scores)),
    };
  }, [attempts]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <FoxSpinner className="w-12 h-12" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full bg-surface border border-border rounded-2xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
          <h1 className="text-base font-bold text-text-primary mb-1">Couldn't open this</h1>
          <p className="text-sm text-text-secondary">{error || 'Content not found.'}</p>
          <button onClick={() => navigate(-1)} className="btn-ghost text-xs px-3 py-1.5 mt-4">Go back</button>
        </div>
      </div>
    );
  }

  const Icon = TYPE_ICON[item.content_type] || Layers;

  return (
    <div className="min-h-screen bg-background">
      {/* header */}
      <div className="sticky top-0 z-20 bg-surface border-b border-border shadow-soft">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <button onClick={() => navigate(-1)} className="btn-ghost text-xs px-2.5 py-1.5 shrink-0">
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <span className="w-9 h-9 bg-primary-muted rounded-xl flex items-center justify-center shrink-0">
              <Icon className="w-4.5 h-4.5 text-primary" />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-text-primary truncate">{item.title}</h1>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className={badgeClassFor(item.difficulty)}>{item.difficulty}</span>
                <span className="text-[11px] text-text-muted">{item.concept_name}</span>
                {isTeacher && (
                  <span
                    className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border flex items-center gap-1 ${
                      item.grounded_excerpts > 0
                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                        : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'
                    }`}
                    title={item.grounded_excerpts > 0
                      ? `Written from ${item.grounded_excerpts} excerpt(s) of this course's own material.`
                      : 'No course material matched — written from the concept description alone.'}
                  >
                    {item.grounded_excerpts > 0 ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                    {item.grounded_excerpts > 0 ? `${item.grounded_excerpts} sources` : 'Ungrounded'}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isQuiz && isTeacher && (
              <div className="flex rounded-lg border border-border overflow-hidden">
                {([
                  { key: 'key', label: 'Answer key', icon: Eye },
                  { key: 'solve', label: 'Solve it', icon: Play },
                ] as const).map(({ key, label, icon: I }) => (
                  <button
                    key={key}
                    onClick={() => setMode(key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all ${
                      mode === key ? 'bg-primary-muted text-primary' : 'bg-surface text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <I className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => printContent(item, isTeacher)} className="btn-ghost text-xs px-2.5 py-1.5" title="Print or save as PDF">
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button onClick={() => downloadContentHtml(item, isTeacher)} className="btn-ghost text-xs px-2.5 py-1.5" title="Download a printable page">
              <Download className="w-3.5 h-3.5" />
              HTML
            </button>
            {isTeacher && isQuiz && (
              <button onClick={() => downloadContentHtml(item, false)} className="btn-ghost text-xs px-2.5 py-1.5" title="Download without the answers">
                <Download className="w-3.5 h-3.5" />
                Worksheet
              </button>
            )}
            <button onClick={() => downloadContentJson(item)} className="btn-ghost text-xs px-2.5 py-1.5" title="Download the raw payload">
              <FileJson className="w-3.5 h-3.5" />
              JSON
            </button>
          </div>
        </div>
      </div>

      {/* body */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
          {isQuiz && isTeacher && mode === 'solve' ? (
            <QuizPlayer item={item} courseId={cId} instantFeedback />
          ) : isQuiz && isTeacher ? (
            <AnswerKeyView questions={(item.payload?.questions || []) as MCQ[]} />
          ) : (
            <ContentBody item={item} courseId={cId} isTeacher={false} />
          )}
        </div>

        {/* who has attempted it */}
        {isTeacher && isQuiz && (
          <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
            <h2 className="text-base font-bold text-text-primary flex items-center gap-2 mb-4">
              <Users className="w-4.5 h-4.5 text-secondary" />
              Student attempts
              {attempts && <span className="text-xs font-semibold text-text-muted">({attempts.length})</span>}
            </h2>

            {attempts === null ? (
              <p className="text-sm text-text-muted">Loading attempts...</p>
            ) : attempts.length === 0 ? (
              <div className="text-xs text-text-muted border border-dashed border-border rounded-xl p-3 text-center">
                <EmptyStateIllustration className="w-14 h-14 mx-auto mb-1" />
                No student has attempted this yet.
              </div>
            ) : (
              <>
                {stats && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: 'Attempts', value: stats.count },
                      { label: 'Students', value: stats.students },
                      { label: 'Average', value: `${stats.avg}%` },
                      { label: 'Range', value: `${stats.worst}–${stats.best}%` },
                    ].map((s) => (
                      <div key={s.label} className="bg-background border border-border rounded-xl p-3 text-center">
                        <p className="text-lg font-bold text-text-primary">{s.value}</p>
                        <p className="text-[11px] text-text-muted uppercase tracking-wide">{s.label}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  {attempts.map((a) => (
                    <div key={a.id} className="flex items-center justify-between border border-border rounded-xl p-3 bg-background">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-text-primary truncate">
                          {a.student_name || `Student #${a.student_id}`}
                        </p>
                        <p className="text-[11px] text-text-muted">
                          {a.correct_count} of {a.total_count} correct
                        </p>
                      </div>
                      <p className={`text-sm font-bold shrink-0 ml-2 ${
                        a.score >= 75 ? 'text-emerald-600 dark:text-emerald-400'
                        : a.score >= 50 ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-500'}`}>
                        {Math.round(a.score)}%
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContentViewerPage;
