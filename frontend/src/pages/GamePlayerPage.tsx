// GamePlayerPage: hosts one generated concept game in a sandboxed iframe and records
// the score the game posts back via postMessage (students only are saved).
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Gamepad2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { FoxSpinner } from '../components/FoxSpinner';
import { gameService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../lib/apiError';

/**
 * Full-screen host for one generated concept game, opened in its own tab.
 *
 * This page exists so the new tab is a page WE control rather than the generated
 * markup itself. The HTML is written by an LLM and is untrusted, so it is never
 * navigated to directly: it is mounted here inside `sandbox="allow-scripts"`, without
 * `allow-same-origin`, which gives it a unique opaque origin. It can run its own
 * scripts and nothing else - no localStorage (so it cannot read the auth token), no
 * cookies, no reading this document, no top-level navigation.
 *
 * A `blob:` URL would NOT be equivalent. A blob URL created by this app inherits this
 * app's origin, so the page would be same-origin with ConceptIntel and could read the
 * token directly. That is why the game is fetched as text and passed via srcDoc.
 *
 * Being the parent frame is also what makes scoring possible: the game postMessages
 * its final score up, and this page records it against the student.
 */
export const GamePlayerPage: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const { user } = useAuth();
  const id = parseInt(gameId || '0', 10);
  // The backend rejects a non-student's play outright (mastery/points are
  // per-student), so the banner must not claim it was saved. Mirrors ConceptGames'
  // canSolve - this page is only reachable by direct URL now that ConceptGames
  // hides its "New tab" button for non-students.
  const isStudent = user?.role === 'student';

  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scored, setScored] = useState<number | null>(null);
  // A game that fires its completion event repeatedly must not spam the API or
  // inflate mastery, so only the first score of a session is recorded.
  const recorded = useRef(false);

  // Fetch the game's HTML text from the backend.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const markup = await gameService.fetchHtml(id);
        if (!cancelled) setHtml(markup);
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err, 'Could not load this game.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Listen for the game's "complete" message, validate/clamp the score and record it once.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // The frame is sandboxed without allow-same-origin, so its origin serializes to
      // the string "null"; there is no meaningful origin to allowlist. The score is
      // therefore treated as untrusted input: validated here, clamped, recorded once,
      // and clamped again server-side.
      const data = e.data;
      if (!data || data.type !== 'conceptintel:game-complete') return;
      if (recorded.current) return;
      const raw = Number(data.score);
      if (!Number.isFinite(raw)) return;
      const score = Math.max(0, Math.min(100, raw));
      recorded.current = true;
      setScored(score);
      gameService.recordPlay(id, score).catch(() => {
        // A failed record must not interrupt play - the student still finished.
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background gap-3">
        <FoxSpinner className="w-12 h-12" label="Loading your game..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full bg-surface border border-border rounded-2xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
          <h1 className="text-base font-bold text-text-primary mb-1">Couldn't open this game</h1>
          <p className="text-sm text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-background">
      <div className="shrink-0 px-4 py-2 bg-surface border-b border-border flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-bold text-text-primary">
          <Gamepad2 className="w-4 h-4 text-primary" />
          ConceptIntel
        </span>
        {scored !== null && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {isStudent
              ? `Scored ${Math.round(scored)}/100 — saved to your progress`
              : `Scored ${Math.round(scored)}/100 — preview, not recorded`}
          </span>
        )}
      </div>
      <iframe
        title="Concept game"
        srcDoc={html}
        sandbox="allow-scripts"
        className="flex-1 w-full border-0 bg-white"
      />
    </div>
  );
};

export default GamePlayerPage;
