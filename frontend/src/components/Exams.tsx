import React, { useEffect, useRef, useState } from 'react';
import {
  FileCheck2, Plus, RefreshCw, Play, Timer, Users, AlertTriangle,
  CheckCircle2, XCircle, Trophy, ArrowLeft, Settings2, Lock,
  MoreHorizontal, Send, Undo2, Trash2,
} from 'lucide-react';
import { examService } from '../services/api';
import type { ExamItem, ExamAttempt, ExamResult, ExamAttemptSummary, ServedQuestion } from '../services/api';
import { QuestionBank } from './QuestionBank';
import { EmptyStateIllustration } from './illustrations';
import { apiErrorMessage } from '../lib/apiError';

interface ExamsProps {
  courseId: number;
  /** Teachers build and publish; students only sit published exams. */
  canAuthor: boolean;
}

const fmtTime = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** One row of an overflow menu. Trivial, but it keeps the menu markup readable and
 *  stops the destructive item from drifting out of step with the rest. */
const MenuItem: React.FC<{
  icon: React.ElementType; onClick: () => void; destructive?: boolean; children: React.ReactNode;
}> = ({ icon: Icon, onClick, destructive, children }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-left transition-colors ${
      destructive
        ? 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10'
        : 'text-text-secondary hover:bg-background hover:text-text-primary'
    }`}
  >
    <Icon className="w-3.5 h-3.5 shrink-0" />
    {children}
  </button>
);

const STATUS_STYLES: Record<string, string> = {
  Draft: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20',
  Published: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20',
  Closed: 'text-text-muted bg-surface border-border',
};

export const Exams: React.FC<ExamsProps> = ({ courseId, canAuthor }) => {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'list' | 'build' | 'sit' | 'results'>('list');
  const [editing, setEditing] = useState<ExamItem | null>(null);
  const [sitting, setSitting] = useState<ExamItem | null>(null);
  // Which row's overflow menu is open, and which row is mid-request. Both are keyed by
  // exam id rather than held per-row so only one menu can ever be open at a time.
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setExams(await examService.list(courseId));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load exams.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const back = () => { setView('list'); setEditing(null); setSitting(null); load(); };

  // Publishing from the list, rather than only from inside the builder. Re-opening and
  // re-saving an exam just to flip its status is the kind of step that gets an exam
  // left in Draft on the morning it was meant to open.
  const setStatus = async (exam: ExamItem, next: 'Draft' | 'Published' | 'Closed') => {
    setBusyId(exam.id);
    setError('');
    setMenuFor(null);
    try {
      const updated = await examService.update(courseId, exam.id, { status: next });
      setExams((prev) => prev.map((e) => (e.id === exam.id ? updated : e)));
    } catch (err) {
      setError(apiErrorMessage(err, `Could not change this exam to ${next}.`));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (exam: ExamItem) => {
    // An exam carries student attempts with it, so this one gets a confirmation.
    if (!window.confirm(`Delete "${exam.title}"? Any attempts students have made will go with it.`)) return;
    setBusyId(exam.id);
    setError('');
    setMenuFor(null);
    try {
      await examService.remove(courseId, exam.id);
      setExams((prev) => prev.filter((e) => e.id !== exam.id));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete this exam.'));
    } finally {
      setBusyId(null);
    }
  };

  if (view === 'build') {
    return <ExamBuilder courseId={courseId} exam={editing} onDone={back} />;
  }
  if (view === 'sit' && sitting) {
    return <ExamPlayer courseId={courseId} exam={sitting} onDone={back} />;
  }
  if (view === 'results' && editing) {
    return <ExamResults courseId={courseId} exam={editing} onDone={back} />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
            <FileCheck2 className="w-4.5 h-4.5 text-secondary" />
            Exams
            <span className="text-xs font-semibold text-text-muted">({exams.length})</span>
          </h3>
          {canAuthor && (
            <button onClick={() => { setEditing(null); setView('build'); }} className="btn-primary text-xs px-3 py-1.5">
              <Plus className="w-3.5 h-3.5" />
              New exam
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center py-8 text-sm text-text-muted">Loading...</div>
        ) : exams.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
            <EmptyStateIllustration className="w-24 h-24 mx-auto mb-2" />
            {canAuthor ? 'No exams yet — build one from your question bank.' : 'No exams are open right now.'}
          </div>
        ) : (
          <div className="space-y-3">
            {exams.map((e) => (
              <div key={e.id} className="border border-border rounded-xl p-4 bg-background">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-text-primary">{e.title}</p>
                    {e.description && <p className="text-xs text-text-secondary mt-0.5">{e.description}</p>}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 border ${STATUS_STYLES[e.status] || STATUS_STYLES.Closed}`}>
                        {e.status}
                      </span>
                      <span className="text-[11px] text-text-muted">{e.question_count} questions · {e.total_points} pts</span>
                      {e.time_limit_seconds && (
                        <span className="text-[11px] text-text-muted flex items-center gap-1">
                          <Timer className="w-3 h-3" />{Math.round(e.time_limit_seconds / 60)} min
                        </span>
                      )}
                      <span className="text-[11px] text-text-muted">pass {e.pass_mark}%</span>
                      <span className="text-[11px] text-text-muted">
                        {e.max_attempts === 0 ? 'unlimited attempts' : `${e.max_attempts} attempt${e.max_attempts === 1 ? '' : 's'}`}
                      </span>
                      {e.missing_question_count > 0 && (
                        <span className="text-[11px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-full px-2 py-0.5">
                          {e.missing_question_count} question(s) missing
                        </span>
                      )}
                    </div>
                  </div>
                  {/* One primary action, one secondary, everything else behind the
                      overflow. Four equal-weight buttons per row made a list of six
                      exams read as twenty-four things to decide between. */}
                  <div className="flex items-center gap-2 shrink-0">
                    {canAuthor && e.status === 'Draft' ? (
                      <button
                        onClick={() => setStatus(e, 'Published')}
                        disabled={busyId === e.id || e.question_count === 0}
                        title={e.question_count === 0 ? 'Add at least one question first' : 'Open this exam to students'}
                        className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {busyId === e.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        Publish
                      </button>
                    ) : (!canAuthor && e.status === 'Published') && (
                      <button onClick={() => { setSitting(e); setView('sit'); }} className="btn-primary text-xs px-3 py-1.5">
                        <Play className="w-3.5 h-3.5" />
                        Start
                      </button>
                    )}

                    {canAuthor && (
                      <div className="relative">
                        <button
                          onClick={() => setMenuFor((id) => (id === e.id ? null : e.id))}
                          className="w-8 h-8 rounded-lg text-text-muted hover:bg-border/60 hover:text-text-primary flex items-center justify-center transition-all"
                          aria-label={`More actions for ${e.title}`}
                          aria-expanded={menuFor === e.id}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {menuFor === e.id && (
                          <>
                            {/* Click-away layer rather than a document listener: it
                                cannot leak if the row unmounts while open. */}
                            <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                            <div className="absolute right-0 top-9 z-20 w-52 bg-surface border border-border rounded-xl shadow-card py-1">
                              <MenuItem icon={Settings2} onClick={() => { setMenuFor(null); setEditing(e); setView('build'); }}>
                                Edit questions & settings
                              </MenuItem>
                              <MenuItem icon={Users} onClick={() => { setMenuFor(null); setEditing(e); setView('results'); }}>
                                Student results
                              </MenuItem>
                              {e.status === 'Published' && (
                                <>
                                  <MenuItem icon={Undo2} onClick={() => setStatus(e, 'Draft')}>
                                    Unpublish (back to draft)
                                  </MenuItem>
                                  <MenuItem icon={Lock} onClick={() => setStatus(e, 'Closed')}>
                                    Close to new attempts
                                  </MenuItem>
                                </>
                              )}
                              {e.status === 'Closed' && (
                                <MenuItem icon={Send} onClick={() => setStatus(e, 'Published')}>
                                  Re-open to students
                                </MenuItem>
                              )}
                              <div className="my-1 border-t border-border" />
                              <MenuItem icon={Trash2} destructive onClick={() => remove(e)}>
                                Delete exam
                              </MenuItem>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ───────────────────────────── builder ───────────────────────────── */

const ExamBuilder: React.FC<{ courseId: number; exam: ExamItem | null; onDone: () => void }> = ({
  courseId, exam, onDone,
}) => {
  const [title, setTitle] = useState(exam?.title || '');
  const [description, setDescription] = useState(exam?.description || '');
  const [ids, setIds] = useState<number[]>(exam?.question_ids || []);
  const [minutes, setMinutes] = useState(exam?.time_limit_seconds ? Math.round(exam.time_limit_seconds / 60) : 0);
  const [shuffleQ, setShuffleQ] = useState(exam?.shuffle_questions ?? true);
  const [shuffleO, setShuffleO] = useState(exam?.shuffle_options ?? true);
  const [maxAttempts, setMaxAttempts] = useState(exam?.max_attempts ?? 1);
  const [passMark, setPassMark] = useState(exam?.pass_mark ?? 50);
  const [showAnswers, setShowAnswers] = useState(exam?.show_answers_after ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id: number) =>
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async (publish: boolean) => {
    if (!title.trim()) { setError('Give the exam a title first.'); return; }
    if (publish && ids.length === 0) { setError('Add at least one question before publishing.'); return; }
    setSaving(true);
    setError('');
    const body = {
      title: title.trim(),
      description: description.trim() || null,
      question_ids: ids,
      time_limit_seconds: minutes > 0 ? minutes * 60 : null,
      shuffle_questions: shuffleQ,
      shuffle_options: shuffleO,
      max_attempts: maxAttempts,
      pass_mark: passMark,
      show_answers_after: showAnswers,
    };
    try {
      const saved = exam
        ? await examService.update(courseId, exam.id, body)
        : await examService.create(courseId, body);
      if (publish) await examService.update(courseId, saved.id, { status: 'Published' });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save this exam.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onDone} className="btn-ghost text-xs px-3 py-1.5">
        <ArrowLeft className="w-3.5 h-3.5" />
        All exams
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card space-y-4">
        <h3 className="text-base font-bold text-text-primary">{exam ? 'Edit exam' : 'New exam'}</h3>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Title</label>
          <input className="input-light w-full text-sm" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Midterm — Differential Calculus" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Instructions (optional)</label>
          <textarea className="input-light w-full text-sm" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Time limit (min)</label>
            <input type="number" min={0} max={360} className="input-light w-full text-sm" value={minutes}
              onChange={(e) => setMinutes(Math.max(0, parseInt(e.target.value) || 0))} />
            <p className="text-[11px] text-text-muted mt-1">0 = untimed</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Max attempts</label>
            <input type="number" min={0} max={20} className="input-light w-full text-sm" value={maxAttempts}
              onChange={(e) => setMaxAttempts(Math.max(0, parseInt(e.target.value) || 0))} />
            <p className="text-[11px] text-text-muted mt-1">0 = unlimited</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Pass mark (%)</label>
            <input type="number" min={0} max={100} className="input-light w-full text-sm" value={passMark}
              onChange={(e) => setPassMark(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))} />
          </div>
          <div className="space-y-2 pt-6">
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={shuffleQ} onChange={(e) => setShuffleQ(e.target.checked)} />
              Shuffle questions
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={shuffleO} onChange={(e) => setShuffleO(e.target.checked)} />
              Shuffle options
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} />
              Show answers after
            </label>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
        <h4 className="text-sm font-bold text-text-primary mb-1">
          Pick questions <span className="text-xs font-semibold text-text-muted">({ids.length} selected)</span>
        </h4>
        <p className="text-xs text-text-secondary mb-4">Tick questions from your bank to include them.</p>
        <QuestionBank courseId={courseId} selectable selectedIds={ids} onToggleSelect={toggle} />
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
        <button onClick={() => save(false)} disabled={saving} className="btn-ghost text-xs px-3 py-1.5 disabled:opacity-50">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
          Save draft
        </button>
        <button onClick={() => save(true)} disabled={saving} className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Save & publish
        </button>
      </div>
    </div>
  );
};

/* ───────────────────────────── player ────────────────────────────── */

const ExamPlayer: React.FC<{
  courseId: number; exam: ExamItem; onDone: () => void;
}> = ({ courseId, exam, onDone }) => {
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const autoSubmitted = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const a = await examService.startAttempt(courseId, exam.id);
        setAttempt(a);
        setRemaining(a.remaining_seconds);
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not start this exam.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId, exam.id]);

  const submit = async (auto = false) => {
    if (!attempt || submitting || result) return;
    if (auto) autoSubmitted.current = true;
    setSubmitting(true);
    try {
      setResult(await examService.submitAttempt(courseId, exam.id, attempt.attempt_id, responses));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not submit this exam.'));
    } finally {
      setSubmitting(false);
    }
  };

  // The countdown mirrors a server-issued remaining_seconds. When it hits zero the
  // paper is submitted automatically rather than left hanging - the server enforces
  // the real deadline regardless, so this exists to save the student's work, not to
  // be the source of truth.
  useEffect(() => {
    if (remaining === null || result) return;
    if (remaining <= 0) {
      if (!autoSubmitted.current) submit(true);
      return;
    }
    const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, result]);

  if (loading) return <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Preparing your paper...</div>;
  if (error && !attempt) {
    return (
      <div className="space-y-3">
        <button onClick={onDone} className="btn-ghost text-xs px-3 py-1.5"><ArrowLeft className="w-3.5 h-3.5" />Back</button>
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 text-sm">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />{error}
        </div>
      </div>
    );
  }
  if (!attempt) return null;

  if (result) {
    return (
      <div className="space-y-3">
        <div className="glass-panel rounded-2xl p-8 border border-border shadow-card text-center">
          <Trophy className={`w-9 h-9 mx-auto mb-3 ${result.passed ? 'text-emerald-500' : 'text-text-muted'}`} />
          <p className="text-4xl font-bold text-text-primary">
            {Math.round(result.score)}<span className="text-base text-text-muted">/100</span>
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {result.points_earned} of {result.points_possible} points · pass mark {result.pass_mark}%
          </p>
          <p className={`text-sm font-bold mt-2 ${result.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
            {result.passed ? 'Passed' : 'Not passed'}
          </p>
          {result.late && <p className="text-[12px] text-amber-600 dark:text-amber-400 mt-2">Submitted after the time limit.</p>}
          <button onClick={onDone} className="btn-primary text-xs px-3.5 py-1.5 mt-5">Back to exams</button>
        </div>

        {result.per_question.map((pq) => (
          <div key={pq.id} className={`rounded-xl p-3 border ${
            pq.correct ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                       : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20'}`}>
            <p className="text-xs font-semibold text-text-primary flex items-start gap-1.5">
              {pq.correct ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                          : <XCircle className="w-3.5 h-3.5 text-rose-500 mt-0.5 shrink-0" />}
              {pq.prompt}
            </p>
            <p className="text-[12px] text-text-muted mt-1 ml-5">
              {pq.points_earned} / {pq.points} points{!pq.answered && ' · not answered'}
            </p>
            {pq.answer_key && (
              <p className="text-[12px] text-text-secondary mt-1 ml-5">
                Answer: <span className="font-semibold">{pq.answer_key}</span>
              </p>
            )}
            {pq.explanation && <p className="text-[12px] text-text-muted mt-1 ml-5">{pq.explanation}</p>}
          </div>
        ))}
      </div>
    );
  }

  const answeredCount = attempt.questions.filter((q) => responses[String(q.id)] !== undefined).length;

  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-2xl p-4 border border-border shadow-card flex flex-wrap items-center justify-between gap-3 sticky top-2 z-10">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary truncate">{attempt.title}</p>
          <p className="text-[12px] text-text-muted">
            Attempt {attempt.attempt_number} · {answeredCount} of {attempt.questions.length} answered
          </p>
        </div>
        {remaining !== null && (
          <span className={`flex items-center gap-1.5 text-sm font-bold ${
            remaining < 60 ? 'text-rose-500' : 'text-text-secondary'}`}>
            <Timer className="w-4 h-4" />
            {fmtTime(remaining)}
          </span>
        )}
      </div>

      {attempt.description && (
        <p className="text-xs text-text-secondary bg-background border border-border rounded-xl p-3">{attempt.description}</p>
      )}

      {attempt.questions.map((q, i) => (
        <QuestionInput
          key={q.id}
          index={i}
          question={q}
          value={responses[String(q.id)]}
          onChange={(v) => setResponses((prev) => ({ ...prev, [String(q.id)]: v }))}
        />
      ))}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-3 text-xs">{error}</div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button onClick={onDone} className="btn-ghost text-xs px-3 py-1.5">Leave (saves nothing)</button>
        <button onClick={() => submit()} disabled={submitting} className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50">
          {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Submit exam
        </button>
      </div>
    </div>
  );
};

/**
 * One answer widget per question type.
 *
 * Exported because exams, mock tests and the live quiz all have to render the same
 * five answer shapes. Three copies of this would guarantee three subtly different
 * behaviours - especially for multi-select and matching, where the response format
 * has to match what the grader expects exactly.
 */
export const QuestionInput: React.FC<{
  index: number; question: ServedQuestion; value: any; onChange: (v: any) => void;
}> = ({ index, question: q, value, onChange }) => {
  const body = () => {
    if (q.question_type === 'single_choice') {
      return (
        <div className="space-y-1.5">
          {(q.options || []).map((opt, oi) => (
            <label key={oi} className={`flex items-start gap-2.5 text-xs rounded-lg border p-2.5 cursor-pointer transition-all ${
              value === oi ? 'border-primary/40 bg-primary-muted text-text-primary font-semibold'
                           : 'border-border text-text-secondary hover:border-primary/20'}`}>
              <input type="radio" className="mt-0.5" name={`q-${q.id}`} checked={value === oi} onChange={() => onChange(oi)} />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    if (q.question_type === 'multi_select') {
      const arr: number[] = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-1.5">
          <p className="text-[12px] text-text-muted">Select every correct option — wrong picks cancel out right ones.</p>
          {(q.options || []).map((opt, oi) => (
            <label key={oi} className={`flex items-start gap-2.5 text-xs rounded-lg border p-2.5 cursor-pointer transition-all ${
              arr.includes(oi) ? 'border-primary/40 bg-primary-muted text-text-primary font-semibold'
                               : 'border-border text-text-secondary hover:border-primary/20'}`}>
              <input type="checkbox" className="mt-0.5" checked={arr.includes(oi)}
                onChange={() => onChange(arr.includes(oi) ? arr.filter((x) => x !== oi) : [...arr, oi])} />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    if (q.question_type === 'true_false') {
      return (
        <div className="flex gap-2">
          {[true, false].map((v) => (
            <button key={String(v)} onClick={() => onChange(v)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-bold transition-all ${
                value === v ? 'border-primary/40 bg-primary-muted text-primary'
                            : 'border-border bg-background text-text-secondary hover:border-primary/20'}`}>
              {v ? 'True' : 'False'}
            </button>
          ))}
        </div>
      );
    }
    if (q.question_type === 'fill_blank') {
      return (
        <input className="input-light w-full text-sm" placeholder="Type your answer"
          value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
      );
    }
    // matching
    const map: Record<string, string> = (value && typeof value === 'object') ? value : {};
    return (
      <div className="space-y-2">
        {(q.left_items || []).map((left) => (
          <div key={left} className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-text-primary min-w-[110px]">{left}</span>
            <select className="input-light text-xs py-1.5 flex-1 min-w-[140px]"
              value={map[left] || ''}
              onChange={(e) => onChange({ ...map, [left]: e.target.value })}>
              <option value="">Choose...</option>
              {(q.right_items || []).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="glass-panel rounded-2xl p-5 border border-border shadow-card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm font-semibold text-text-primary">{index + 1}. {q.prompt}</p>
        <span className="text-[11px] text-text-muted shrink-0">{q.points} pt{q.points === 1 ? '' : 's'}</span>
      </div>
      {body()}
    </div>
  );
};

/* ───────────────────────────── results ───────────────────────────── */

const ExamResults: React.FC<{ courseId: number; exam: ExamItem; onDone: () => void }> = ({
  courseId, exam, onDone,
}) => {
  const [rows, setRows] = useState<ExamAttemptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setRows(await examService.attempts(courseId, exam.id));
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not load results.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId, exam.id]);

  const submitted = rows.filter((r) => r.submitted_at);
  const avg = submitted.length
    ? Math.round(submitted.reduce((a, r) => a + (r.score || 0), 0) / submitted.length)
    : 0;
  const passRate = submitted.length
    ? Math.round((submitted.filter((r) => r.passed).length / submitted.length) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <button onClick={onDone} className="btn-ghost text-xs px-3 py-1.5">
        <ArrowLeft className="w-3.5 h-3.5" />All exams
      </button>
      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
        <h3 className="text-base font-bold text-text-primary mb-4">{exam.title} — results</h3>
        {error && <div className="text-xs text-rose-500 mb-3">{error}</div>}
        {loading ? (
          <div className="text-center py-8 text-sm text-text-muted">Loading...</div>
        ) : submitted.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
            <EmptyStateIllustration className="w-20 h-20 mx-auto mb-2" />
            No one has submitted this exam yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Submissions', value: submitted.length },
                { label: 'Average', value: `${avg}%` },
                { label: 'Pass rate', value: `${passRate}%` },
              ].map((s) => (
                <div key={s.label} className="bg-background border border-border rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-text-primary">{s.value}</p>
                  <p className="text-[11px] text-text-muted uppercase tracking-wide">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {submitted.map((r) => (
                <div key={r.id} className="flex items-center justify-between border border-border rounded-xl p-3 bg-background">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">{r.student_name || `Student #${r.student_id}`}</p>
                    <p className="text-[11px] text-text-muted">Attempt {r.attempt_number}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className="text-sm font-bold text-text-primary">{Math.round(r.score || 0)}%</p>
                    <p className={`text-[11px] font-bold ${r.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                      {r.passed ? 'Passed' : 'Failed'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Exams;
