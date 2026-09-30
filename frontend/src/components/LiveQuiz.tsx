// LiveQuiz: real-time Kahoot-style quiz. A teacher hosts a room (join code, start/next/end controls, live answer distribution) and students join with
// a code and nickname. Game state is pushed by the server over a WebSocket and this file only renders it.
import React, { useEffect, useRef, useState } from 'react';
import {
  Radio, Play, SkipForward, Square, Users, Timer, Trophy, RefreshCw, AlertTriangle,
  ArrowLeft, LogIn, Wifi, WifiOff, CheckCircle2, Plus,
} from 'lucide-react';
import { liveQuizService, questionBankService } from '../services/api';
import type { LiveSession, LiveState, BankQuestion } from '../services/api';
import { QuestionInput } from './Exams';
import { apiErrorMessage } from '../lib/apiError';

interface LiveQuizProps {
  courseId: number;
  canHost: boolean;
}

/**
 * Live multiplayer quiz: one host projects questions, everyone answers on their own
 * device, the leaderboard updates after each one.
 *
 * All game state comes from the server over a single WebSocket message shape, and the
 * client never derives it locally. That is what makes a mid-game refresh harmless: the
 * reconnecting client simply receives the current state and renders it, rather than
 * trying to replay what it missed.
 */
// Entry component: switches between the menu, the host room and the player room.
export const LiveQuiz: React.FC<LiveQuizProps> = ({ courseId, canHost }) => {
  const [mode, setMode] = useState<'menu' | 'host' | 'play'>('menu');
  const [code, setCode] = useState('');

  if (mode === 'host') return <HostRoom courseId={courseId} code={code} onExit={() => setMode('menu')} />;
  if (mode === 'play') return <PlayerRoom code={code} onExit={() => setMode('menu')} />;

  return (
    <LiveMenu
      courseId={courseId}
      canHost={canHost}
      onHost={(c) => { setCode(c); setMode('host'); }}
      onPlay={(c) => { setCode(c); setMode('play'); }}
    />
  );
};

/* ────────────────────────────── menu ────────────────────────────── */

// LiveMenu: students enter a join code + nickname; teachers create a new live session from question-bank questions or reopen an existing one.
const LiveMenu: React.FC<{
  courseId: number; canHost: boolean;
  onHost: (code: string) => void; onPlay: (code: string) => void;
}> = ({ courseId, canHost, onHost, onPlay }) => {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [bank, setBank] = useState<BankQuestion[]>([]);
  const [error, setError] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [joining, setJoining] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(30);
  const [bonus, setBonus] = useState(10);
  const [creating, setCreating] = useState(false);

  // Teachers: load their past sessions and the question bank (used to pick questions).
  useEffect(() => {
    if (!canHost) return;
    liveQuizService.listSessions(courseId).then(setSessions).catch(() => {});
    questionBankService.list(courseId).then(setBank).catch(() => {});
  }, [courseId, canHost]);

  // Student: join a session by code and move to the player room.
  const join = async () => {
    if (!joinCode.trim() || !nickname.trim()) return;
    setJoining(true);
    setError('');
    try {
      const r = await liveQuizService.join(joinCode.trim().toUpperCase(), nickname.trim());
      onPlay(r.code);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not join that quiz.'));
    } finally {
      setJoining(false);
    }
  };

  // Teacher: create a session (title, questions, seconds per question, speed bonus) and open its host room.
  const create = async () => {
    if (!title.trim() || picked.length === 0) {
      setError('Give the quiz a title and pick at least one question.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const s = await liveQuizService.createSession(courseId, {
        title: title.trim(), question_ids: picked,
        seconds_per_question: seconds, speed_bonus_max: bonus,
      });
      onHost(s.code);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create the live quiz.'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}
        </div>
      )}

      {/* Joining as a player is student-only: a teacher's role here is Host, below -
          the backend rejects a non-student join attempt regardless, but the UI
          shouldn't offer an action it knows will be refused. */}
      {!canHost && (
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
          <h3 className="text-base font-bold text-text-primary flex items-center gap-2 mb-1">
            <LogIn className="w-4.5 h-4.5 text-secondary" />
            Join a live quiz
          </h3>
          <p className="text-xs text-text-secondary mb-4">Enter the code your instructor is showing.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Code</label>
              <input
                className="input-light w-36 text-lg font-bold tracking-[0.2em] uppercase text-center"
                maxLength={6} placeholder="ABC123"
                value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Your nickname</label>
              <input className="input-light w-full text-sm" placeholder="Shown on the leaderboard"
                maxLength={24} value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </div>
            <button onClick={join} disabled={joining || !joinCode.trim() || !nickname.trim()}
              className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50">
              {joining ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
              Join
            </button>
          </div>
        </div>
      )}

      {canHost && (
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
              <Radio className="w-4.5 h-4.5 text-secondary" />
              Host a live quiz
            </h3>
            <button onClick={() => setShowNew((v) => !v)} className="btn-primary text-xs px-3 py-1.5">
              <Plus className="w-3.5 h-3.5" />New live quiz
            </button>
          </div>

          {showNew && (
            <div className="border border-border rounded-xl p-4 bg-background space-y-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Title</label>
                <input className="input-light w-full text-sm" value={title}
                  onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday recap" />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">Seconds per question</label>
                  <input type="number" min={5} max={300} className="input-light w-full text-sm" value={seconds}
                    onChange={(e) => setSeconds(Math.max(5, Math.min(300, parseInt(e.target.value) || 30)))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">Speed bonus (max points)</label>
                  <input type="number" min={0} max={100} className="input-light w-full text-sm" value={bonus}
                    onChange={(e) => setBonus(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))} />
                  <p className="text-[11px] text-text-muted mt-1">0 = correctness only, no race</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                  Questions ({picked.length} picked)
                </label>
                {bank.length === 0 ? (
                  <p className="text-xs text-text-muted border border-dashed border-border rounded-xl p-3">
                    Your question bank is empty — add questions first.
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                    {bank.map((q) => (
                      <label key={q.id} className={`flex items-start gap-2 text-xs rounded-lg border p-2 cursor-pointer ${
                        picked.includes(q.id) ? 'border-primary/40 bg-primary-muted' : 'border-border'}`}>
                        <input type="checkbox" className="mt-0.5" checked={picked.includes(q.id)}
                          onChange={() => setPicked((p) => p.includes(q.id) ? p.filter((x) => x !== q.id) : [...p, q.id])} />
                        <span className="min-w-0">
                          <span className="block text-text-primary font-semibold truncate">{q.prompt}</span>
                          <span className="block text-[11px] text-text-muted">{q.question_type_label} · {q.points} pts</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowNew(false)} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
                <button onClick={create} disabled={creating} className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50">
                  {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
                  Open the room
                </button>
              </div>
            </div>
          )}

          {sessions.length > 0 && (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between border border-border rounded-xl p-3 bg-background">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-text-primary truncate">{s.title}</p>
                    <p className="text-[11px] text-text-muted">
                      {s.question_count} questions · {s.participants} joined · {s.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-sm font-bold tracking-widest text-primary">{s.code}</span>
                    {s.status !== 'ended' && (
                      <button onClick={() => onHost(s.code)} className="btn-ghost text-xs px-3 py-1.5">Open</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ───────────────────────── shared socket hook ───────────────────────── */

// useLiveSocket: custom hook that connects to the session's WebSocket, keeps the latest server state, knows if this user is the host,
// auto-reconnects after a drop, and exposes send() for actions (start/next/end/answer).
function useLiveSocket(code: string) {
  const [state, setState] = useState<LiveState | null>(null);
  const [connected, setConnected] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [notice, setNotice] = useState('');
  const socketRef = useRef<WebSocket | null>(null);

  // Open the socket on mount/code change and clean up (close + cancel retry) on unmount.
  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (closed) return;
      const ws = liveQuizService.connect(code);
      socketRef.current = ws;

      ws.onopen = () => setConnected(true);
      // Handle server messages: "state" = full game state, "welcome" = tells us if we are the host, "answer_received" = result of our answer, "error" = show the message.
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'state') setState(msg);
          else if (msg.type === 'welcome') setIsHost(!!msg.is_host);
          else if (msg.type === 'answer_received') {
            setNotice(msg.correct
              ? `Correct — +${msg.points_awarded} points`
              : 'Not quite — no points this round');
          } else if (msg.type === 'error') setNotice(msg.detail || 'Something went wrong.');
        } catch {
          // A malformed frame is not worth tearing the room down for.
        }
      };
      ws.onclose = () => {
        setConnected(false);
        // Reconnect and re-read state rather than trying to replay missed messages -
        // the server's next state broadcast is the source of truth anyway.
        if (!closed) retry = setTimeout(open, 2000);
      };
      ws.onerror = () => ws.close();
    };

    open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
    };
  }, [code]);

  // Send a JSON action to the server if the socket is open.
  const send = (payload: Record<string, any>) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  return { state, connected, isHost, notice, setNotice, send };
}

// ConnectionPill: shows "Live" or "Reconnecting..." depending on the socket status.
const ConnectionPill: React.FC<{ connected: boolean }> = ({ connected }) => (
  <span className={`flex items-center gap-1.5 text-[12px] font-semibold ${
    connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
    {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
    {connected ? 'Live' : 'Reconnecting...'}
  </span>
);

// Leaderboard: ranked list of players by score; `highlight` marks the current player's row.
const Leaderboard: React.FC<{ rows: LiveState['leaderboard']; highlight?: string }> = ({ rows, highlight }) => (
  <div className="space-y-1.5">
    {rows.length === 0 ? (
      <p className="text-xs text-text-muted">Nobody has scored yet.</p>
    ) : rows.map((r) => (
      <div key={r.participant_id}
        className={`flex items-center justify-between rounded-lg border p-2.5 ${
          highlight === r.nickname ? 'border-primary/40 bg-primary-muted' : 'border-border bg-background'}`}>
        <span className="text-xs font-semibold text-text-primary truncate">
          <span className="text-text-muted mr-2">{r.rank}</span>{r.nickname}
        </span>
        <span className="text-xs font-bold text-text-primary shrink-0 ml-2">{r.score}</span>
      </div>
    ))}
  </div>
);

/* ────────────────────────────── host ────────────────────────────── */

// HostRoom: projector-style view for the teacher: join code, player count, question with live answer bars, control buttons and leaderboard.
const HostRoom: React.FC<{ courseId: number; code: string; onExit: () => void }> = ({ code, onExit }) => {
  const { state, connected, send } = useLiveSocket(code);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onExit} className="btn-ghost text-xs px-3 py-1.5">
          <ArrowLeft className="w-3.5 h-3.5" />Leave room
        </button>
        <ConnectionPill connected={connected} />
      </div>

      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card text-center">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted mb-1">Join code</p>
        <p className="text-5xl font-bold tracking-[0.3em] text-primary">{code}</p>
        <p className="text-xs text-text-secondary mt-3 flex items-center justify-center gap-3">
          <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{state?.participants ?? 0} joined</span>
          {state && <span>Question {Math.max(0, state.current_index + 1)} of {state.total_questions}</span>}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {state?.status === 'waiting' && (
          <button onClick={() => send({ action: 'start' })} className="btn-primary text-xs px-3.5 py-1.5">
            <Play className="w-3.5 h-3.5" />Start quiz
          </button>
        )}
        {(state?.status === 'question' || state?.status === 'reveal') && (
          <button onClick={() => send({ action: 'next' })} className="btn-primary text-xs px-3.5 py-1.5">
            <SkipForward className="w-3.5 h-3.5" />
            {state.status === 'question' ? 'Reveal answers' : 'Next question'}
          </button>
        )}
        {state?.status !== 'ended' && (
          <button onClick={() => send({ action: 'end' })} className="btn-ghost text-xs px-3.5 py-1.5">
            <Square className="w-3.5 h-3.5" />End quiz
          </button>
        )}
      </div>

      {state?.question && (
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
          <div className="flex items-start justify-between gap-3 mb-3">
            <p className="text-lg font-bold text-text-primary">{state.question.prompt}</p>
            {state.remaining_seconds !== undefined && state.status === 'question' && (
              <span className={`flex items-center gap-1.5 text-sm font-bold shrink-0 ${
                state.remaining_seconds <= 5 ? 'text-rose-500' : 'text-text-secondary'}`}>
                <Timer className="w-4 h-4" />{state.remaining_seconds}s
              </span>
            )}
          </div>
          {state.question.options && (
            <div className="grid sm:grid-cols-2 gap-2">
              {state.question.options.map((o) => {
                const count = state.reveal?.distribution?.[o] ?? 0;
                const answered = state.reveal?.answered || 0;
                const pct = answered ? Math.round((count / answered) * 100) : 0;
                const isKey = state.status === 'reveal' && state.reveal?.answer_key === o;
                return (
                  <div key={o} className={`rounded-xl border p-3 ${
                    isKey ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10'
                          : 'border-border bg-background'}`}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-primary font-semibold">{o}</span>
                      <span className="text-text-muted">{count} · {pct}%</span>
                    </div>
                    <div className="progress-bar-track mt-2">
                      <div className={`h-full rounded-full ${isKey ? 'bg-emerald-500' : 'bg-primary/50'}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {state.reveal && (
            <p className="text-xs text-text-secondary mt-3">
              {state.reveal.answered} answered · {state.reveal.correct} correct ·
              answer: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{state.reveal.answer_key}</span>
            </p>
          )}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2 mb-3">
          <Trophy className="w-4.5 h-4.5 text-secondary" />Leaderboard
        </h3>
        <Leaderboard rows={state?.leaderboard || []} />
      </div>
    </div>
  );
};

/* ───────────────────────────── player ───────────────────────────── */

// PlayerRoom: student view: waiting screen, current question with an answer widget, locked-in/reveal screen, final results and leaderboard.
const PlayerRoom: React.FC<{ code: string; onExit: () => void }> = ({ code, onExit }) => {
  const { state, connected, notice, setNotice, send } = useLiveSocket(code);
  const [answer, setAnswer] = useState<any>(undefined);
  const [sentFor, setSentFor] = useState<number | null>(null);

  // A new question clears the previous answer, so the widget never shows a stale
  // selection from the question before it.
  useEffect(() => {
    if (state?.current_index !== undefined && state.current_index !== sentFor) {
      setAnswer(undefined);
      setNotice('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.current_index]);

  // Send the chosen answer to the server and remember which question it was for (prevents answering twice).
  const submit = () => {
    if (answer === undefined || !state?.question) return;
    send({ action: 'answer', response: answer });
    setSentFor(state.current_index);
  };

  // True once this player has already answered the current question.
  const alreadyAnswered = sentFor === state?.current_index;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onExit} className="btn-ghost text-xs px-3 py-1.5">
          <ArrowLeft className="w-3.5 h-3.5" />Leave
        </button>
        <ConnectionPill connected={connected} />
      </div>

      {state?.status === 'waiting' && (
        <div className="glass-panel rounded-2xl p-8 border border-border shadow-card text-center">
          <Radio className="w-9 h-9 text-primary mx-auto mb-3 animate-pulse" />
          <h3 className="text-base font-bold text-text-primary mb-1">You're in — waiting for the host</h3>
          <p className="text-sm text-text-secondary">{state.participants} player(s) in the room.</p>
        </div>
      )}

      {state?.status === 'ended' && (
        <div className="glass-panel rounded-2xl p-8 border border-border shadow-card text-center">
          <Trophy className="w-9 h-9 text-primary mx-auto mb-3" />
          <h3 className="text-base font-bold text-text-primary mb-3">That's the end!</h3>
          <Leaderboard rows={state.leaderboard} />
        </div>
      )}

      {state?.question && state.status !== 'ended' && (
        <>
          <div className="glass-panel rounded-2xl p-4 border border-border shadow-card flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Question {state.question.index + 1} of {state.question.total}
            </span>
            {state.remaining_seconds !== undefined && state.status === 'question' && (
              <span className={`flex items-center gap-1.5 text-sm font-bold ${
                state.remaining_seconds <= 5 ? 'text-rose-500' : 'text-text-secondary'}`}>
                <Timer className="w-4 h-4" />{state.remaining_seconds}s
              </span>
            )}
          </div>

          {state.status === 'question' && !alreadyAnswered ? (
            <>
              <QuestionInput index={state.question.index} question={state.question}
                value={answer} onChange={setAnswer} />
              <button onClick={submit} disabled={answer === undefined}
                className="btn-primary text-xs px-3.5 py-1.5 w-full justify-center disabled:opacity-50">
                <CheckCircle2 className="w-3.5 h-3.5" />Lock in my answer
              </button>
            </>
          ) : (
            <div className="glass-panel rounded-2xl p-6 border border-border shadow-card text-center">
              <p className="text-sm font-semibold text-text-primary">{state.question.prompt}</p>
              <p className="text-xs text-text-secondary mt-2">
                {state.status === 'reveal'
                  ? `Answer: ${state.reveal?.answer_key ?? '—'}`
                  : 'Answer locked in — waiting for everyone else.'}
              </p>
              {notice && <p className="text-xs font-semibold text-primary mt-2">{notice}</p>}
            </div>
          )}
        </>
      )}

      {state && (
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
          <h3 className="text-base font-bold text-text-primary flex items-center gap-2 mb-3">
            <Trophy className="w-4.5 h-4.5 text-secondary" />Leaderboard
          </h3>
          <Leaderboard rows={state.leaderboard} />
        </div>
      )}
    </div>
  );
};

export default LiveQuiz;
