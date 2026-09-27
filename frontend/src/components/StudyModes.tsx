import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain, ClipboardCheck, Shuffle, RefreshCw, ArrowLeft, Check, X,
  CheckCircle2, XCircle, Timer, Trophy, AlertTriangle, Layers, ListChecks,
} from 'lucide-react';
import { studyService } from '../services/api';
import type {
  StudyOverviewItem, LearnQueue, LearnQueueItem, StudyTest, StudyTestResult, MatchSet,
} from '../services/api';
import { EmptyStateIllustration } from './illustrations';
import { apiErrorMessage } from '../lib/apiError';

type Mode = 'learn' | 'test' | 'match';

interface StudyModesProps {
  courseId: number;
  /** False for teachers - Learn/Test/Match are the student drill surface, so a
   *  teacher sees the sets and their approval status but can't run a drill. */
  canSolve?: boolean;
}

const badgeClassFor = (d: string) => `badge-${(d || 'medium').toLowerCase()}`;

/**
 * Learn / Test / Match over already-approved generated material.
 *
 * None of these makes an AI call: the material was generated once and these are what
 * a student does with it repeatedly. That is why they are instant and can be retried
 * without cost, which is exactly the property a drilling loop needs.
 */
export const StudyModes: React.FC<StudyModesProps> = ({ courseId, canSolve = true }) => {
  const [sets, setSets] = useState<StudyOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState<{ set: StudyOverviewItem; mode: Mode } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setSets(await studyService.overview(courseId));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load your study sets.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  if (active && canSolve) {
    const back = () => { setActive(null); load(); };
    return (
      <div className="space-y-4">
        <button onClick={back} className="btn-ghost text-xs px-3 py-1.5">
          <ArrowLeft className="w-3.5 h-3.5" />
          All study sets
        </button>
        {active.mode === 'learn' && (
          <LearnRunner courseId={courseId} set={active.set} onDone={back} />
        )}
        {active.mode === 'test' && (
          <TestRunner courseId={courseId} set={active.set} onDone={back} />
        )}
        {active.mode === 'match' && (
          <MatchRunner courseId={courseId} set={active.set} onDone={back} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 text-sm animate-fade-in">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2 mb-1">
          <Brain className="w-4.5 h-4.5 text-secondary" />
          Study sets
          <span className="text-xs font-semibold text-text-muted">({sets.length})</span>
        </h3>
        <p className="text-xs text-text-secondary mb-4">
          Three ways to drill approved material. <strong>Learn</strong> repeats what you get wrong
          until it sticks, <strong>Test</strong> scores you in one sitting and counts towards
          mastery, and <strong>Match</strong> is a timed pairing race.
          {!canSolve && ' These are the student drill modes - as the instructor, you see the sets here but drill them from the student side, not this one.'}
        </p>

        {loading ? (
          <div className="text-center py-8 text-sm text-text-muted">Loading...</div>
        ) : sets.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
            <EmptyStateIllustration className="w-28 h-28 mx-auto mb-2" />
            No drillable material yet. Generate flashcards or MCQs first — study guides are read, not drilled.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {sets.map((s) => {
              const pct = s.total_items ? Math.round((s.mastered / s.total_items) * 100) : 0;
              const Icon = s.content_type === 'flashcard' ? Layers : ListChecks;
              return (
                <div key={s.content_id} className="border border-border rounded-xl p-4 bg-background flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-bold text-text-primary flex items-start gap-2">
                      <Icon className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
                      <span className="min-w-0">{s.title}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className={badgeClassFor(s.difficulty)}>{s.difficulty}</span>
                      <span className="text-[11px] font-semibold text-text-muted">{s.total_items} items</span>
                      {s.due > 0 && (
                        <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-full px-2 py-0.5">
                          {s.due} to review
                        </span>
                      )}
                    </div>
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                        <span>{s.mastered} of {s.total_items} known</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="progress-bar-track">
                        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                  {canSolve && (
                    <div className="flex flex-wrap gap-2 mt-auto">
                      <button onClick={() => setActive({ set: s, mode: 'learn' })} className="btn-primary text-xs px-3 py-1.5">
                        <Brain className="w-3.5 h-3.5" />
                        Learn
                      </button>
                      <button onClick={() => setActive({ set: s, mode: 'test' })} className="btn-ghost text-xs px-3 py-1.5">
                        <ClipboardCheck className="w-3.5 h-3.5" />
                        Test
                      </button>
                      {s.supports_match && (
                        <button onClick={() => setActive({ set: s, mode: 'match' })} className="btn-ghost text-xs px-3 py-1.5">
                          <Shuffle className="w-3.5 h-3.5" />
                          Match
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

/* ─────────────────────────────── Learn ─────────────────────────────── */

const LearnRunner: React.FC<{
  courseId: number; set: StudyOverviewItem; onDone: () => void;
}> = ({ courseId, set, onDone }) => {
  const [queue, setQueue] = useState<LearnQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<{ item_index: number; correct: boolean }[]>([]);
  const [finished, setFinished] = useState<{ score: number; correct: number; total: number } | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    (async () => {
      try {
        setQueue(await studyService.getLearnQueue(courseId, set.content_id));
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not start this Learn session.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId, set.content_id]);

  const items = queue?.queue ?? [];
  const current: LearnQueueItem | undefined = items[pos];

  const submitRound = async (all: { item_index: number; correct: boolean }[]) => {
    try {
      const res = await studyService.submitLearn(
        courseId, set.content_id, all, Math.round((Date.now() - startedAt.current) / 1000)
      );
      setFinished({ score: res.score, correct: res.items_correct, total: res.items_total });
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save this round.'));
    }
  };

  const advance = (correct: boolean) => {
    if (!current) return;
    const next = [...answers, { item_index: current.index, correct }];
    setAnswers(next);
    setRevealed(false);
    setPicked(null);
    if (pos + 1 >= items.length) submitRound(next);
    else setPos(pos + 1);
  };

  if (loading) return <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Loading...</div>;
  if (error) return <ErrorCard message={error} />;

  if (finished) {
    return (
      <ResultCard
        title="Round complete"
        score={finished.score}
        subtitle={`${finished.correct} of ${finished.total} correct`}
        note="Cards you missed will come back sooner; ones you got right rest for longer."
        onDone={onDone}
      />
    );
  }

  if (!current) {
    return (
      <div className="glass-panel rounded-2xl p-8 border border-border shadow-card text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
        <h3 className="text-base font-bold text-text-primary mb-1">Nothing due right now</h3>
        <p className="text-sm text-text-secondary">
          Every card in this set is resting. Come back later, or take a Test to check yourself.
        </p>
        <button onClick={onDone} className="btn-ghost text-xs px-3 py-1.5 mt-4">Back</button>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-6 border border-border shadow-card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">{set.title}</h3>
        <span className="text-xs text-text-muted">{pos + 1} / {items.length}</span>
      </div>
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${((pos) / items.length) * 100}%` }} />
      </div>

      <div className="bg-background border border-border rounded-xl p-5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted mb-2">
          {current.kind === 'card' ? 'Recall' : 'Choose the correct answer'}
          {current.times_seen > 0 && ` · seen ${current.times_seen}×`}
        </p>
        <p className="text-sm font-semibold text-text-primary">{current.prompt}</p>

        {current.kind === 'question' && current.options && (
          <div className="space-y-1.5 mt-4">
            {current.options.map((opt, oi) => {
              const isCorrect = oi === current.correct_index;
              const chosen = picked === oi;
              const cls = revealed
                ? isCorrect
                  ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-text-primary'
                  : chosen
                  ? 'border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 text-text-primary'
                  : 'border-border text-text-secondary'
                : chosen
                ? 'border-primary/40 bg-primary-muted text-text-primary'
                : 'border-border text-text-secondary hover:border-primary/20';
              return (
                <button
                  key={oi}
                  disabled={revealed}
                  onClick={() => { setPicked(oi); setRevealed(true); }}
                  className={`w-full text-left text-xs rounded-lg border p-2.5 transition-all ${cls}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {current.kind === 'card' && revealed && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-[11px] font-bold uppercase tracking-wide text-primary mb-1.5">Answer</p>
            <p className="text-sm text-text-secondary">{current.answer}</p>
          </div>
        )}

        {revealed && current.kind === 'question' && current.explanation && (
          <p className="text-[12px] text-text-muted mt-3 pt-3 border-t border-border">{current.explanation}</p>
        )}
      </div>

      {!revealed ? (
        current.kind === 'card' ? (
          <button onClick={() => setRevealed(true)} className="btn-primary text-xs px-3.5 py-1.5 w-full justify-center">
            Show answer
          </button>
        ) : (
          <p className="text-[12px] text-text-muted text-center">Pick an option to continue.</p>
        )
      ) : current.kind === 'card' ? (
        // Self-graded, like a physical flashcard: only the learner knows whether they
        // actually recalled it, and asking them is more accurate than string-matching.
        <div className="flex gap-2">
          <button onClick={() => advance(false)} className="flex-1 justify-center btn-ghost text-xs px-3 py-2 text-rose-500">
            <X className="w-3.5 h-3.5" />
            Didn't know it
          </button>
          <button onClick={() => advance(true)} className="flex-1 justify-center btn-primary text-xs px-3 py-2">
            <Check className="w-3.5 h-3.5" />
            Got it
          </button>
        </div>
      ) : (
        <button
          onClick={() => advance(picked === current.correct_index)}
          className="btn-primary text-xs px-3.5 py-1.5 w-full justify-center"
        >
          Next
        </button>
      )}
    </div>
  );
};

/* ──────────────────────────────── Test ─────────────────────────────── */

const TestRunner: React.FC<{ courseId: number; set: StudyOverviewItem; onDone: () => void }> = ({
  courseId, set, onDone,
}) => {
  const [test, setTest] = useState<StudyTest | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<StudyTestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const t = await studyService.startTest(courseId, set.content_id);
        setTest(t);
        setAnswers(new Array(t.questions.length).fill(-1));
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not start this test.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId, set.content_id]);

  const submit = async () => {
    if (!test) return;
    setSubmitting(true);
    try {
      setResult(await studyService.submitTest(courseId, set.content_id, test.attempt_token, answers));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not submit this test.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Building your test...</div>;
  if (error) return <ErrorCard message={error} />;
  if (!test) return null;

  if (result) {
    return (
      <div className="space-y-3">
        <ResultCard
          title="Test complete"
          score={result.score}
          subtitle={`${result.correct_count} of ${result.total_count} correct`}
          note="This counts towards your concept mastery."
          onDone={onDone}
        />
        {result.per_question.map((pq, i) => (
          <div
            key={i}
            className={`rounded-xl p-3 border ${
              pq.correct
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20'
            }`}
          >
            <p className="text-xs font-semibold text-text-primary flex items-start gap-1.5">
              {pq.correct
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-rose-500 mt-0.5 shrink-0" />}
              {pq.question}
            </p>
            {!pq.correct && (
              <p className="text-[12px] text-text-secondary mt-1.5 ml-5">
                Correct answer: <span className="font-semibold">{pq.options[pq.correct_index]}</span>
              </p>
            )}
            {pq.explanation && <p className="text-[12px] text-text-muted mt-1.5 ml-5">{pq.explanation}</p>}
          </div>
        ))}
      </div>
    );
  }

  const answered = answers.filter((a) => a >= 0).length;

  return (
    <div className="glass-panel rounded-2xl p-6 border border-border shadow-card space-y-4">
      <h3 className="text-sm font-bold text-text-primary">{test.title}</h3>
      {test.questions.map((q, qi) => (
        <div key={qi} className="bg-background border border-border rounded-xl p-3">
          <p className="text-xs font-semibold text-text-primary mb-2">{qi + 1}. {q.question}</p>
          <div className="space-y-1.5">
            {q.options.map((opt, oi) => {
              const selected = answers[qi] === oi;
              return (
                <label
                  key={oi}
                  className={`flex items-start gap-2.5 text-xs rounded-lg border p-2.5 cursor-pointer transition-all ${
                    selected
                      ? 'border-primary/40 bg-primary-muted text-text-primary font-semibold'
                      : 'border-border text-text-secondary hover:border-primary/20'
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-0.5"
                    name={`t-${qi}`}
                    checked={selected}
                    onChange={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)))}
                  />
                  {opt}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-text-muted">{answered} of {test.questions.length} answered</span>
        <button
          onClick={submit}
          disabled={submitting || answers.includes(-1)}
          className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Submit test
        </button>
      </div>
    </div>
  );
};

/* ─────────────────────────────── Match ─────────────────────────────── */

const MatchRunner: React.FC<{
  courseId: number; set: StudyOverviewItem; onDone: () => void;
}> = ({ courseId, set, onDone }) => {
  const [data, setData] = useState<MatchSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTerm, setSelectedTerm] = useState<number | null>(null);
  const [selectedDef, setSelectedDef] = useState<number | null>(null);
  const [solved, setSolved] = useState<Set<number>>(new Set());
  const [wrong, setWrong] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    (async () => {
      try {
        setData(await studyService.startMatch(courseId, set.content_id));
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not start Match.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId, set.content_id]);

  // Ticks only while the drill is live; stops the moment the last pair lands.
  useEffect(() => {
    if (loading || done || !data) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [loading, done, data]);

  // Definitions are shuffled once, on load - reshuffling on every render would move
  // the tiles under the player's cursor mid-drill.
  const shuffledDefs = useMemo(() => {
    if (!data) return [];
    return [...data.pairs].sort((a, b) => (a.definition > b.definition ? 1 : -1));
  }, [data]);

  useEffect(() => {
    if (!data || done) return;
    if (solved.size > 0 && solved.size === data.pairs.length) {
      setDone(true);
      const duration = Math.round((Date.now() - startedAt.current) / 1000);
      studyService
        .submitMatch(courseId, set.content_id, {
          pairs_total: data.pairs.length, pairs_matched: solved.size, duration_seconds: duration,
        })
        .catch(() => {});
    }
  }, [solved, data, done, courseId, set.content_id]);

  useEffect(() => {
    if (selectedTerm === null || selectedDef === null) return;
    if (selectedTerm === selectedDef) {
      setSolved((s) => new Set(s).add(selectedTerm));
      setSelectedTerm(null);
      setSelectedDef(null);
    } else {
      setWrong(true);
      const t = setTimeout(() => { setWrong(false); setSelectedTerm(null); setSelectedDef(null); }, 500);
      return () => clearTimeout(t);
    }
  }, [selectedTerm, selectedDef]);

  if (loading) return <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Loading...</div>;
  if (error) return <ErrorCard message={error} />;
  if (!data) return null;

  if (done) {
    return (
      <ResultCard
        title="All matched!"
        score={elapsed}
        scoreSuffix="s"
        subtitle={`${data.pairs.length} pairs`}
        note="Nice work — that counts towards your points."
        onDone={onDone}
      />
    );
  }

  const tileClass = (isSel: boolean, isSolved: boolean) =>
    `text-left text-xs rounded-xl border p-3 transition-all min-h-[64px] ${
      isSolved
        ? 'opacity-0 pointer-events-none'
        : isSel
        ? wrong
          ? 'border-rose-400 bg-rose-50 dark:bg-rose-500/10'
          : 'border-primary/50 bg-primary-muted'
        : 'border-border bg-background hover:border-primary/30'
    }`;

  return (
    <div className="glass-panel rounded-2xl p-6 border border-border shadow-card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">{data.title}</h3>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <Timer className="w-3.5 h-3.5" />
          {elapsed}s · {solved.size}/{data.pairs.length}
        </span>
      </div>
      <p className="text-[12px] text-text-muted">Tap a term, then its matching definition.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          {data.pairs.map((p) => (
            <button
              key={`t-${p.index}`}
              onClick={() => setSelectedTerm(p.index)}
              className={tileClass(selectedTerm === p.index, solved.has(p.index))}
              style={{ width: '100%' }}
            >
              {p.term}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {shuffledDefs.map((p) => (
            <button
              key={`d-${p.index}`}
              onClick={() => setSelectedDef(p.index)}
              className={tileClass(selectedDef === p.index, solved.has(p.index))}
              style={{ width: '100%' }}
            >
              {p.definition}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ────────────────────────────── shared ─────────────────────────────── */

const ErrorCard: React.FC<{ message: string }> = ({ message }) => (
  <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 text-sm">
    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
    {message}
  </div>
);

const ResultCard: React.FC<{
  title: string; score: number; scoreSuffix?: string; subtitle: string; note: string; onDone: () => void;
}> = ({ title, score, scoreSuffix, subtitle, note, onDone }) => (
  <div className="glass-panel rounded-2xl p-8 border border-border shadow-card text-center">
    <Trophy className="w-9 h-9 text-primary mx-auto mb-3" />
    <h3 className="text-base font-bold text-text-primary mb-1">{title}</h3>
    <p className="text-4xl font-bold text-text-primary mt-2">
      {Math.round(score)}
      <span className="text-base text-text-muted">{scoreSuffix ?? '/100'}</span>
    </p>
    <p className="text-xs text-text-secondary mt-1">{subtitle}</p>
    <p className="text-[12px] text-text-muted mt-3">{note}</p>
    <button onClick={onDone} className="btn-primary text-xs px-3.5 py-1.5 mt-5">Back to study sets</button>
  </div>
);

export default StudyModes;
