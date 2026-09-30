// RevisionPlan: student card with the adaptive engine's personalised revision plan (weakest concepts first, with reasons and recommended materials)
// and an "I don't understand this" button that generates an AI mini-game for the concept and plays it in a sandboxed iframe.
import React, { useEffect, useState } from 'react';
import { Compass, AlertTriangle, BookOpen, ChevronRight, Gamepad2, RefreshCw, X } from 'lucide-react';
import { adaptiveEngineService, gameService } from '../services/api';
import type { RevisionPlan, ConceptGame } from '../services/api';
import { apiErrorMessage } from '../lib/apiError';

interface RevisionPlanProps {
  courseId: number;
}

// Student-only widget - the Adaptive Engine's "Act" step made visible: a
// personalized, explainable list of what to review next and why.
// Component name is RevisionPlanCard: loads the student's plan and handles game generation/playback for a weak concept.
export const RevisionPlanCard: React.FC<RevisionPlanProps> = ({ courseId }) => {
  const [plan, setPlan] = useState<RevisionPlan | null>(null);
  const [loading, setLoading] = useState(true);

  // "I don't understand this" -> AI writes a small playable game for that one
  // concept (same generation/sandboxing pipeline as the Concept Games composer,
  // see ConceptGames.tsx - just triggered from here with the concept pre-filled
  // instead of picked from a dropdown). Keyed by concept_node_id so each row's
  // button tracks its own in-flight/error state independently.
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [gameError, setGameError] = useState('');
  const [playing, setPlaying] = useState<ConceptGame | null>(null);
  const [playingHtml, setPlayingHtml] = useState('');
  const [notice, setNotice] = useState('');

  // Load the student's revision plan for the course.
  useEffect(() => {
    let mounted = true;
    adaptiveEngineService.getMyPlan(courseId)
      .then((data) => mounted && setPlan(data))
      .catch(() => {})
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [courseId]);

  // Generate an easy game for the chosen concept, fetch its HTML and open the player overlay.
  const handleMakeGame = async (conceptNodeId: string) => {
    setGeneratingFor(conceptNodeId);
    setGameError('');
    try {
      // Easy, not the concept's own graph difficulty: a student who just said "I
      // don't understand this" needs the gentlest on-ramp, not a match to how hard
      // the topic is rated for someone who already gets it.
      const game = await gameService.generate(courseId, { concept_node_id: conceptNodeId, difficulty: 'Easy' });
      const html = await gameService.fetchHtml(game.id);
      setPlayingHtml(html);
      setPlaying(game);
    } catch (err) {
      setGameError(apiErrorMessage(err, 'Could not generate a game for this concept.'));
    } finally {
      setGeneratingFor(null);
    }
  };

  // Same untrusted-postMessage contract as ConceptGames.tsx: the sandboxed frame
  // (allow-scripts, no allow-same-origin) reports its own score, shape-checked and
  // clamped before it's recorded.
  // Listen for the game's completion message and record the (clamped) score once.
  useEffect(() => {
    if (!playing) return;
    let recorded = false;
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type !== 'conceptintel:game-complete') return;
      if (recorded) return;
      const score = Number(data.score);
      if (!Number.isFinite(score)) return;
      recorded = true;
      const clamped = Math.max(0, Math.min(100, score));
      gameService
        .recordPlay(playing.id, clamped)
        .then(() => setNotice(`Scored ${Math.round(clamped)}/100 on "${playing.title}" — added to your progress.`))
        .catch(() => {});
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [playing]);

  // Loading state.
  if (loading) {
    return (
      <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
        <div className="text-center py-6 text-sm text-text-muted">Loading...</div>
      </div>
    );
  }

  // Empty state: no plan yet (no evidence) or nothing weak detected.
  if (!plan || plan.plan.length === 0) {
    return (
      <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2 mb-2">
          <Compass className="w-4.5 h-4.5 text-secondary" />
          Your Revision Plan
        </h3>
        <p className="text-xs text-text-muted">
          {plan?.overall_progress === null
            ? "Complete a quiz or assignment and we'll build your personalized revision plan."
            : "You're on track — no weak concepts detected right now."}
        </p>
      </div>
    );
  }

  // Main render: progress header, up to six plan items with recommended materials and the make-a-game button, plus the player overlay.
  return (
    <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
          <Compass className="w-4.5 h-4.5 text-secondary" />
          Your Revision Plan
        </h3>
        {plan.overall_progress !== null && (
          <span className="text-xs font-bold text-text-muted">{Math.round(plan.overall_progress)}% overall</span>
        )}
      </div>
      <p className="text-[12px] text-text-muted mb-3">Ordered by what will help you most, based on your quiz and assignment results.</p>

      {gameError && <p className="text-xs text-rose-500 mb-2">{gameError}</p>}
      {notice && <p className="text-xs text-primary mb-2">{notice}</p>}

      <div className="space-y-2.5">
        {plan.plan.slice(0, 6).map((item) => (
          <div key={item.concept_node_id} className="border border-border rounded-xl p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                  {item.is_foundational && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                  {item.concept_name}
                </p>
                <p className="text-[12px] text-text-muted mt-0.5">{item.reason}</p>
              </div>
              <span className="text-xs font-bold text-rose-500 shrink-0">{Math.round(item.mastery_score)}/100</span>
            </div>
            {item.recommended_materials.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {item.recommended_materials.map((m) => (
                  <span key={m.content_id} className="flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary-muted rounded-full px-2 py-0.5">
                    <BookOpen className="w-2.5 h-2.5" /> {m.title} <ChevronRight className="w-2.5 h-2.5" />
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={() => handleMakeGame(item.concept_node_id)}
              disabled={generatingFor === item.concept_node_id}
              className="mt-2.5 flex items-center gap-1.5 text-[11px] font-bold text-secondary hover:text-secondary-hover disabled:opacity-60 disabled:cursor-not-allowed"
              title="AI writes a small playable game to help this concept click"
            >
              {generatingFor === item.concept_node_id ? (
                <><RefreshCw className="w-3 h-3 animate-spin" /> Building your game…</>
              ) : (
                <><Gamepad2 className="w-3 h-3" /> I don't understand this — make me a game</>
              )}
            </button>
          </div>
        ))}
      </div>

      {/* ---- sandboxed player ---- */}
      {playing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-5xl h-[85vh] bg-surface rounded-2xl shadow-hover border border-border overflow-hidden animate-fade-up flex flex-col">
            <div className="px-6 py-4 border-b border-border bg-background flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 bg-primary-muted rounded-lg flex items-center justify-center shrink-0">
                  <Gamepad2 className="w-4 h-4 text-primary" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text-primary truncate">{playing.title}</p>
                  <p className="text-[12px] text-text-muted truncate">{playing.concept_name}</p>
                </div>
              </div>
              <button
                onClick={() => { setPlaying(null); setPlayingHtml(''); }}
                className="p-2 text-text-muted hover:text-primary rounded-lg hover:bg-primary-muted transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* allow-scripts WITHOUT allow-same-origin: same untrusted-content
                sandboxing as ConceptGames.tsx's player. */}
            <iframe
              title={playing.title}
              srcDoc={playingHtml}
              sandbox="allow-scripts"
              className="flex-1 w-full border-0 bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
};
