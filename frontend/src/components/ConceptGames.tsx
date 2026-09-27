import React, { useEffect, useMemo, useState } from 'react';
import {
  Gamepad2, Sparkles, RefreshCw, ExternalLink, Play, X, Search, AlertTriangle,
} from 'lucide-react';
import { gameService, contentGenerationService } from '../services/api';
import type { ConceptGame, GeneratableConcept } from '../services/api';
import { EmptyStateIllustration } from './illustrations';
import { apiErrorMessage } from '../lib/apiError';
import { timeAgo } from '../lib/time';

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

interface ConceptGamesProps {
  courseId: number;
  /**
   * Whether this viewer may play a game at all.
   *
   * Teachers can still GENERATE games - they need to try one's quality before
   * pointing a class at it is an authoring concern, not a "solve" - but playing one
   * through to a recorded score is student-only: the backend rejects a non-student
   * play outright, since ConceptMastery/StudentPoints are per-student tables and a
   * teacher's id in them would invent a phantom learner on their own leaderboard.
   */
  canSolve?: boolean;
}

/**
 * Student-facing concept games: pick a concept, the model authors a complete
 * standalone HTML page, and it opens as a playable game.
 *
 * Two ways to play, on purpose:
 *
 *  - "Play here" mounts the page in a sandboxed iframe. sandbox="allow-scripts"
 *    (deliberately WITHOUT allow-same-origin) gives the page a unique opaque origin,
 *    so it can run its own JS but cannot read this app's localStorage token, cookies
 *    or DOM. Because it is a child frame it can postMessage its final score up to us,
 *    so playing here is what feeds concept mastery.
 *
 *  - "New tab" opens the same page as a blob: URL in its own tab for a full-screen
 *    run. That tab is opened with noopener, which severs window.opener - the right
 *    call for untrusted LLM-authored HTML, but it also means the page has no channel
 *    back to us, so a score earned there is not recorded. The UI says so rather than
 *    silently dropping it.
 */
export const ConceptGames: React.FC<ConceptGamesProps> = ({ courseId, canSolve = true }) => {
  const [games, setGames] = useState<ConceptGame[]>([]);
  const [concepts, setConcepts] = useState<GeneratableConcept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [conceptQuery, setConceptQuery] = useState('');
  const [conceptId, setConceptId] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium');
  const [generating, setGenerating] = useState(false);

  const [playing, setPlaying] = useState<ConceptGame | null>(null);
  const [playingHtml, setPlayingHtml] = useState('');
  const [loadingPlay, setLoadingPlay] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [g, c] = await Promise.all([
        gameService.list(courseId),
        contentGenerationService.listConcepts(courseId).catch(() => []),
      ]);
      setGames(g);
      setConcepts(c);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the games for this course.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const filteredConcepts = useMemo(() => {
    const q = conceptQuery.trim().toLowerCase();
    if (!q) return concepts;
    return concepts.filter((c) => c.name.toLowerCase().includes(q));
  }, [concepts, conceptQuery]);

  const handleGenerate = async () => {
    if (!conceptId) return;
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const created = await gameService.generate(courseId, { concept_node_id: conceptId, difficulty });
      setGames((prev) => [created, ...prev]);
      setNotice(`"${created.title}" is ready to play.`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not generate a game for this concept.'));
    } finally {
      setGenerating(false);
    }
  };

  const handlePlayHere = async (game: ConceptGame) => {
    setLoadingPlay(true);
    setError('');
    try {
      const html = await gameService.fetchHtml(game.id);
      setPlayingHtml(html);
      setPlaying(game);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not open this game.'));
    } finally {
      setLoadingPlay(false);
    }
  };

  const handleNewTab = (game: ConceptGame) => {
    setError('');
    // Not checked for null: window.open() with `noopener` returns null by
    // specification even on success, so a null test here would report "blocked" every
    // single time. The opened tab loads our own /game/:id route, which sandboxes the
    // untrusted markup - see gameService.openInNewTab.
    gameService.openInNewTab(game.id);
  };

  // The sandboxed frame reports its own score when the student finishes. Its origin
  // serializes to "null" (sandbox without allow-same-origin), so there is no origin to
  // allowlist - the payload is treated as untrusted input instead: shape-checked,
  // clamped, recorded at most once per opened game, and clamped again server-side.
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

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 text-sm animate-fade-in">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-primary-muted border border-primary/20 text-primary rounded-xl p-4 text-sm animate-fade-in">
          {notice}
        </div>
      )}

      {/* ---- composer ---- */}
      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card space-y-4 animate-fade-up">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
          <Gamepad2 className="w-4.5 h-4.5 text-secondary" />
          Make a game for any concept
        </h3>
        <p className="text-xs text-text-secondary">
          Pick a concept and the AI writes a small playable game that teaches it. Generating takes
          up to a minute or two — it is writing a whole page.
          {!canSolve && ' Games you make are available to everyone on this course; playing one through is the student side, not this one.'}
        </p>

        {concepts.length === 0 ? (
          <p className="text-xs text-text-muted border border-dashed border-border rounded-xl p-3">
            This course has no knowledge-graph concepts yet, so there is nothing to build a game from.
          </p>
        ) : (
          <>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Concept</label>
              <div className="relative mb-2">
                <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  className="input-light w-full text-sm pl-9"
                  placeholder={`Filter ${concepts.length} concepts...`}
                  value={conceptQuery}
                  onChange={(e) => setConceptQuery(e.target.value)}
                />
              </div>
              <select
                className="input-light w-full text-sm"
                value={conceptId}
                onChange={(e) => setConceptId(e.target.value)}
              >
                <option value="">Select a concept...</option>
                {filteredConcepts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Difficulty</label>
                <div className="flex gap-2">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDifficulty(d)}
                      className={`rounded-lg border px-3 py-2 text-xs font-bold transition-all ${
                        difficulty === d
                          ? 'border-primary/40 bg-primary-muted text-primary'
                          : 'border-border bg-background text-text-secondary hover:border-primary/20'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating || !conceptId}
                className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Building your game...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Generate game
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ---- library ---- */}
      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2 mb-4">
          <Play className="w-4.5 h-4.5 text-secondary" />
          Games for this course
          <span className="text-xs font-semibold text-text-muted">({games.length})</span>
        </h3>

        {loading ? (
          <div className="text-center py-8 text-sm text-text-muted">Loading...</div>
        ) : games.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
            <EmptyStateIllustration className="w-28 h-28 mx-auto mb-2" />
            No games yet — generate one above.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {games.map((g) => (
              <div key={g.id} className="border border-border rounded-xl p-4 bg-background flex flex-col gap-3">
                <div>
                  <p className="text-sm font-bold text-text-primary">{g.title}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{g.concept_name}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className={`badge-${(g.difficulty || 'medium').toLowerCase()}`}>{g.difficulty}</span>
                    {g.game_kind && (
                      <span className="text-[11px] font-semibold text-text-muted bg-surface border border-border rounded-full px-2 py-0.5">
                        {g.game_kind}
                      </span>
                    )}
                    <span className="text-[11px] text-text-muted">{timeAgo(g.created_at)}</span>
                  </div>
                </div>
                {canSolve && (
                  <div className="flex gap-2 mt-auto">
                    <button
                      onClick={() => handlePlayHere(g)}
                      disabled={loadingPlay}
                      className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Play here
                    </button>
                    <button onClick={() => handleNewTab(g)} className="btn-ghost text-xs px-3 py-1.5" title="Opens full screen; score is not recorded">
                      <ExternalLink className="w-3.5 h-3.5" />
                      New tab
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
            {/* allow-scripts WITHOUT allow-same-origin: the page runs its own JS in an
                opaque origin and cannot touch this app's storage, cookies or DOM. */}
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

export default ConceptGames;
