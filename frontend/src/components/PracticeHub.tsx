// PracticeHub: student practice tab. Lets a student start a mock test drawn from the whole question bank (weighted to weak concepts) and shows
// practice analytics (sessions, streak, points, weakest/strongest concepts, per-mode accuracy). Teachers see the dashboard but cannot take a mock.
import React, { useEffect, useRef, useState } from 'react';
import {
  Target, TrendingUp, Flame, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  ArrowLeft, Trophy, BarChart3,
} from 'lucide-react';
import { practiceService } from '../services/api';
import type { MockTest, MockResult, PracticeAnalytics } from '../services/api';
import { QuestionInput } from './Exams';
import { apiErrorMessage } from '../lib/apiError';

interface PracticeHubProps {
  courseId: number;
  /** Mock tests are student-only: a teacher owns the question bank a mock draws
   *  from, so them "practising" against it isn't a real signal, and this is the
   *  same solve surface a student uses. */
  canSolve?: boolean;
}

// Text colour for an accuracy/mastery percentage: green >=75, amber >=50, red below.
const accuracyColor = (pct: number) =>
  pct >= 75 ? 'text-emerald-600 dark:text-emerald-400'
  : pct >= 50 ? 'text-amber-600 dark:text-amber-400'
  : 'text-rose-500';

// Progress-bar fill colour using the same thresholds.
const barColor = (pct: number) =>
  pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500';

/**
 * Mock tests and the practice dashboard.
 *
 * A mock draws from the whole question bank rather than one concept, weighted towards
 * whatever this student is weakest at - so it doubles as revision guidance, not just
 * assessment. Nothing here is an Exam row: mocks are repeatable and student-initiated,
 * so materialising each one would fill the teacher's exam list with noise.
 */
export const PracticeHub: React.FC<PracticeHubProps> = ({ courseId, canSolve = true }) => {
  const [analytics, setAnalytics] = useState<PracticeAnalytics | null>(null);
  const [bank, setBank] = useState<{ available: number; max_size: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [size, setSize] = useState(20);
  const [test, setTest] = useState<MockTest | null>(null);
  const [starting, setStarting] = useState(false);

  // Load the practice analytics and how many questions are available in the bank (bank size failure is tolerated).
  const load = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        practiceService.analytics(courseId),
        practiceService.bankSize(courseId).catch(() => null),
      ]);
      setAnalytics(a);
      setBank(b);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load your practice data.'));
    } finally {
      setLoading(false);
    }
  };

  // Load on mount / course change.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // Ask the server to build a mock test of `size` questions and switch to the runner.
  const startMock = async () => {
    setStarting(true);
    setError('');
    try {
      setTest(await practiceService.startMock(courseId, size));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not start a mock test.'));
    } finally {
      setStarting(false);
    }
  };

  // When a mock is in progress (student only), show the runner; its onDone clears the test and reloads the analytics.
  if (test && canSolve) {
    return (
      <MockRunner
        courseId={courseId}
        test={test}
        onDone={() => { setTest(null); load(); }}
      />
    );
  }

  // Number of bank questions, and the largest mock size allowed (capped by the server max and what is available).
  const available = bank?.available ?? 0;
  const maxSize = Math.min(bank?.max_size ?? 60, available || 60);

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}
        </div>
      )}

      {/* ── mock test launcher ──
          Student-only: a teacher owns the bank a mock draws from, so this tab
          shows them what a mock looks like without letting them take one. */}
      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2 mb-1">
          <Target className="w-4.5 h-4.5 text-secondary" />
          Mock test
        </h3>
        <p className="text-xs text-text-secondary mb-4">
          A full-course paper drawn from the whole question bank, weighted towards the concepts
          a student is weakest at. Repeatable — each one is a fresh selection.
        </p>

        {!canSolve ? (
          <p className="text-xs text-text-muted border border-dashed border-border rounded-xl p-3">
            Mock tests are for students to practise with — as the instructor, you won't take one
            yourself.
          </p>
        ) : available === 0 ? (
          <p className="text-xs text-text-muted border border-dashed border-border rounded-xl p-3">
            The question bank is empty, so there's nothing to build a mock test from yet.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Questions</label>
              <input
                type="number" min={1} max={maxSize} className="input-light w-28 text-sm"
                value={size}
                onChange={(e) => setSize(Math.max(1, Math.min(maxSize, parseInt(e.target.value) || 20)))}
              />
              <p className="text-[11px] text-text-muted mt-1">{available} available in the bank</p>
            </div>
            <button onClick={startMock} disabled={starting} className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50">
              {starting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
              Start mock test
            </button>
          </div>
        )}
      </div>

      {/* ── analytics ── */}
      {loading ? (
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
          <div className="shimmer-loader h-5 w-1/3 rounded mb-3" />
          <div className="shimmer-loader h-24 w-full rounded-xl" />
        </div>
      ) : analytics && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Practice sessions', value: analytics.total_sessions, icon: BarChart3 },
              { label: 'Active days', value: analytics.active_days, icon: TrendingUp },
              { label: 'Current streak', value: `${analytics.current_streak_days}d`, icon: Flame },
              { label: 'Points', value: analytics.total_points, icon: Trophy },
            ].map((s) => (
              <div key={s.label} className="bg-surface border border-border rounded-2xl p-4 animate-fade-up">
                <s.icon className="w-4 h-4 text-secondary mb-2" />
                <p className="text-xl font-bold text-text-primary">{s.value}</p>
                <p className="text-[11px] text-text-muted uppercase tracking-wide">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <ConceptList
              title="Needs the most work"
              subtitle="Your weakest concepts — a mock test will ask about these most."
              rows={analytics.weakest}
              empty="No mastery recorded yet. Take a quiz or a mock test to get started."
            />
            <ConceptList
              title="Strongest"
              subtitle="Concepts you're consistently getting right."
              rows={analytics.strongest}
              empty="Nothing here yet."
            />
          </div>

          {analytics.mode_breakdown.length > 0 && (
            <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
              <h3 className="text-base font-bold text-text-primary mb-3">How you've been practising</h3>
              <div className="space-y-2">
                {analytics.mode_breakdown.map((m) => (
                  <div key={m.mode} className="flex items-center justify-between border border-border rounded-xl p-3 bg-background">
                    <div>
                      <p className="text-xs font-bold text-text-primary capitalize">{m.mode}</p>
                      <p className="text-[11px] text-text-muted">{m.sessions} session{m.sessions === 1 ? '' : 's'}</p>
                    </div>
                    <p className={`text-sm font-bold ${accuracyColor(m.average_score)}`}>
                      {Math.round(m.average_score)}%
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ConceptList: card listing concepts with a mastery bar and number of assessments (used for "weakest" and "strongest").
const ConceptList: React.FC<{
  title: string; subtitle: string;
  rows: Array<{ concept_node_id: string; concept_name: string; mastery: number; evidence_count: number }>;
  empty: string;
}> = ({ title, subtitle, rows, empty }) => (
  <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
    <h3 className="text-base font-bold text-text-primary mb-1">{title}</h3>
    <p className="text-xs text-text-secondary mb-4">{subtitle}</p>
    {rows.length === 0 ? (
      <p className="text-xs text-text-muted border border-dashed border-border rounded-xl p-3">{empty}</p>
    ) : (
      <div className="space-y-2.5">
        {rows.map((c) => (
          <div key={c.concept_node_id}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-text-primary truncate">{c.concept_name}</span>
              <span className={`text-xs font-bold shrink-0 ml-2 ${accuracyColor(c.mastery)}`}>
                {Math.round(c.mastery)}%
              </span>
            </div>
            <div className="progress-bar-track">
              <div className={`h-full rounded-full ${barColor(c.mastery)}`} style={{ width: `${c.mastery}%` }} />
            </div>
            <p className="text-[11px] text-text-muted mt-0.5">
              {c.evidence_count} assessment{c.evidence_count === 1 ? '' : 's'}
            </p>
          </div>
        ))}
      </div>
    )}
  </div>
);

// MockRunner: student answers every question of the mock, submits once with the attempt token and time taken, then sees the score with breakdowns by concept and difficulty.
const MockRunner: React.FC<{
  courseId: number; test: MockTest; onDone: () => void;
}> = ({ courseId, test, onDone }) => {
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [result, setResult] = useState<MockResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const startedAt = useRef(Date.now());

  // Submit all responses, and the elapsed seconds, for grading.
  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      setResult(await practiceService.submitMock(
        courseId, test.attempt_token, responses,
        Math.round((Date.now() - startedAt.current) / 1000)
      ));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not submit this mock test.'));
    } finally {
      setSubmitting(false);
    }
  };

  // Result screen after submitting: score, breakdown cards and per-question review.
  if (result) {
    return (
      <div className="space-y-4">
        <button onClick={onDone} className="btn-ghost text-xs px-3 py-1.5">
          <ArrowLeft className="w-3.5 h-3.5" />Back to practice
        </button>

        <div className="glass-panel rounded-2xl p-8 border border-border shadow-card text-center">
          <Trophy className="w-9 h-9 text-primary mx-auto mb-3" />
          <p className="text-4xl font-bold text-text-primary">
            {Math.round(result.score)}<span className="text-base text-text-muted">/100</span>
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {result.points_earned} of {result.points_possible} points
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <BreakdownCard title="By concept" rows={result.by_concept} hint="Weakest first — start your revision here." />
          <BreakdownCard title="By difficulty" rows={result.by_difficulty} hint="Where the marks were lost." />
        </div>

        <div className="space-y-2">
          {result.per_question.map((pq, i) => (
            <div key={pq.id} className={`rounded-xl p-3 border ${
              pq.correct ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                         : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20'}`}>
              <p className="text-xs font-semibold text-text-primary flex items-start gap-1.5">
                {pq.correct ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                            : <XCircle className="w-3.5 h-3.5 text-rose-500 mt-0.5 shrink-0" />}
                {i + 1}. {pq.prompt}
              </p>
              <p className="text-[11px] text-text-muted mt-1 ml-5">
                {pq.concept_name || 'Unassigned'} · {pq.difficulty} · {pq.points_earned}/{pq.points} pts
                {!pq.answered && ' · not answered'}
              </p>
              {pq.explanation && <p className="text-[12px] text-text-muted mt-1 ml-5">{pq.explanation}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Number of questions answered so far, shown in the sticky header.
  const answered = test.questions.filter((q) => responses[String(q.id)] !== undefined).length;

  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-2xl p-4 border border-border shadow-card flex items-center justify-between sticky top-2 z-10">
        <div>
          <p className="text-sm font-bold text-text-primary">Mock test</p>
          <p className="text-[12px] text-text-muted">{answered} of {test.questions.length} answered · {test.total_points} points</p>
        </div>
        <button onClick={onDone} className="btn-ghost text-xs px-3 py-1.5">Abandon</button>
      </div>

      {test.questions.map((q, i) => (
        <QuestionInput
          key={q.id} index={i} question={q} value={responses[String(q.id)]}
          onChange={(v) => setResponses((prev) => ({ ...prev, [String(q.id)]: v }))}
        />
      ))}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-3 text-xs">{error}</div>
      )}

      <div className="flex justify-end">
        <button onClick={submit} disabled={submitting} className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50">
          {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Submit mock test
        </button>
      </div>
    </div>
  );
};

// BreakdownCard: list of accuracy bars for a grouping (by concept or by difficulty) in the mock result.
const BreakdownCard: React.FC<{
  title: string; hint: string; rows: Array<{ name: string; accuracy: number; points_possible: number }>;
}> = ({ title, hint, rows }) => (
  <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
    <h3 className="text-base font-bold text-text-primary mb-1">{title}</h3>
    <p className="text-xs text-text-secondary mb-4">{hint}</p>
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.name}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-text-primary truncate">{r.name}</span>
            <span className={`text-xs font-bold shrink-0 ml-2 ${accuracyColor(r.accuracy)}`}>
              {Math.round(r.accuracy)}%
            </span>
          </div>
          <div className="progress-bar-track">
            <div className={`h-full rounded-full ${barColor(r.accuracy)}`} style={{ width: `${r.accuracy}%` }} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default PracticeHub;
