// Purpose: viewers for each kind of generated content (flashcard deck, study guide, answer key, quiz player, assignment draft).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, CheckCircle2, XCircle, RotateCcw, RefreshCw, Shuffle, Star,
  ChevronLeft, ChevronRight, Play, Pause, Maximize2, Minimize2, Lightbulb,
  AlertTriangle, Sigma, Link2, ListChecks, Volume2, Filter, ClipboardCheck, Target, ArrowRight, Sparkles, Download,
} from 'lucide-react';
import { contentGenerationService } from '../../services/api';
import type { GeneratedContentItem, QuizResult } from '../../services/api';
import { apiErrorMessage } from '../../lib/apiError';
import { downloadAuthenticated } from '../../lib/download';

/**
 * The renderers for every generated content type, shared by the library, the
 * full-screen viewer tab and the generate page.
 *
 * They live here rather than inside any one page because all three need identical
 * behaviour - a flashcard that flips differently depending on which screen you opened
 * it from would be a bug, not a feature.
 */

// Data shapes of the content payloads returned by the API (card, multiple-choice question, study guide, assignment draft).
export interface Flashcard { front: string; back: string }
export interface MCQ {
  question: string; options: string[]; correct_index: number; explanation: string;
}
export interface StudyGuide {
  summary: string;
  key_points: string[];
  worked_example?: string;
  common_mistakes?: string[];
  key_terms?: Array<{ term: string; definition: string }>;
  formulae?: string[];
  connections?: string;
}
export interface AssignmentDraft {
  title: string;
  instructions: string;
  points: number;
  // Extra detail for the formal Word handout; absent on drafts made before it existed.
  objectives?: string[];
  tasks?: Array<{ title: string; description: string; marks?: number | null }>;
  submission_guidelines?: string[];
  criteria: Array<{
    title: string; description?: string | null; max_points: number; clo_code?: string | null;
    levels?: Array<{ label: string; points: number; description?: string | null }>;
  }>;
}

/* ─────────────────────────── flashcards ─────────────────────────── */

/** Language name to a BCP-47 tag, for picking a speech voice.
 *
 *  Only the languages a course here plausibly teaches, because an unknown name is not
 *  an error: it falls through to the browser's default voice, which is exactly what
 *  should happen for an English deck. Keys are lower-cased on lookup. */
const SPEECH_LANGS: Record<string, string> = {
  english: 'en-US', urdu: 'ur-PK', spanish: 'es-ES', french: 'fr-FR', arabic: 'ar-SA',
  german: 'de-DE', italian: 'it-IT', portuguese: 'pt-BR', russian: 'ru-RU',
  chinese: 'zh-CN', mandarin: 'zh-CN', japanese: 'ja-JP', korean: 'ko-KR',
  hindi: 'hi-IN', bengali: 'bn-BD', punjabi: 'pa-IN', persian: 'fa-IR', farsi: 'fa-IR',
  turkish: 'tr-TR', dutch: 'nl-NL', greek: 'el-GR', hebrew: 'he-IL',
};

/**
 * Reads text aloud with the browser's own speech synthesis.
 *
 * No dependency and no API call: a language deck that cannot be heard is half a deck,
 * and shipping a pronunciation service for it would be absurd. Support is not
 * universal, so `supported` is exposed and the button is simply not rendered when the
 * API is missing rather than failing silently on click.
 */
const useSpeech = (language: string) => {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speaking, setSpeaking] = useState(false);

  // Anything still queued when the deck unmounts would carry on talking over whatever
  // the user navigated to.
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  const speak = useCallback((text: string) => {
    if (!supported || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LANGS[(language || 'english').trim().toLowerCase()] || 'en-US';
    // Slightly under normal pace: this is for learning a pronunciation, not skimming.
    u.rate = 0.92;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }, [supported, language]);

  return { supported, speaking, speak };
};

/**
 * Flashcard deck.
 *
 * The interaction details are what make a deck feel usable rather than like a list
 * of divs: a real 3D flip (preserve-3d + backface-hidden, with the back pre-rotated
 * so it lands face-up), arrow-key navigation, shuffle, a per-card "known" toggle that
 * filters the deck, and autoplay for hands-free review. The flip is delayed on
 * navigation so the next card's answer is never briefly visible mid-turn.
 *
 * The chrome sits ON the card - audio top-left, favourite top-right, hint bottom-left -
 * rather than in a toolbar above it, so the card is the only thing competing for
 * attention. Progress is a bar plus an "n / total" readout instead of one dot per
 * card, which stops being readable somewhere around a dozen cards and is unusable at
 * forty.
 */
export const FlashcardViewer: React.FC<{
  cards: Flashcard[]; compact?: boolean; language?: string;
}> = ({ cards, compact = false, language = 'English' }) => {
  // Deck state: card order (for shuffle), current position, flip state, known/starred card sets, filters, autoplay, fullscreen, hint visibility.
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [onlyUnknown, setOnlyUnknown] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [starred, setStarred] = useState<Set<number>>(new Set());
  const speech = useSpeech(language);

  // Cards currently in play (all, or only the ones not yet marked known).
  const visible = useMemo(
    () => (onlyUnknown ? order.filter((i) => !known.has(i)) : order),
    [order, onlyUnknown, known]
  );
  // Index of the card on screen in the original deck, and the card itself.
  const cardIndex = visible[Math.min(pos, Math.max(0, visible.length - 1))];
  const card = cards[cardIndex];

  // Move to the next/previous card (wrapping around); flips face-down first so the answer is not revealed mid-turn.
  const go = useCallback((delta: number) => {
    setFlipped(false);
    setHinted(false);
    // Delayed so the card is face-down again before the text swaps.
    setTimeout(() => {
      setPos((p) => {
        const next = p + delta;
        if (next < 0) return visible.length - 1;
        if (next >= visible.length) return 0;
        return next;
      });
    }, 150);
  }, [visible.length]);

  // Keyboard shortcuts: arrows navigate, Space/Enter flips, Escape leaves fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped((f) => !f); }
      else if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // Autoplay shows the answer, then moves on - the timings are asymmetric because
  // reading an answer takes longer than recognising a prompt.
  useEffect(() => {
    if (!autoplay || visible.length === 0) return;
    const t = setTimeout(() => (flipped ? go(1) : setFlipped(true)), flipped ? 2600 : 1800);
    return () => clearTimeout(t);
  }, [autoplay, flipped, pos, go, visible.length]);

  // Empty-deck and all-known states.
  if (!cards.length) return <p className="text-xs text-text-muted">This set has no cards.</p>;

  if (visible.length === 0) {
    return (
      <div className="text-center py-10 border-2 border-dashed border-border rounded-2xl">
        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
        <p className="text-sm font-bold text-text-primary">Every card marked as known</p>
        <button onClick={() => { setOnlyUnknown(false); setPos(0); }} className="btn-ghost text-xs px-3 py-1.5 mt-3">
          Show all cards
        </button>
      </div>
    );
  }

  // Per-card flags and layout size for the current card.
  const isKnown = known.has(cardIndex);
  const isStarred = starred.has(cardIndex);
  const height = fullscreen ? 'min-h-[58vh]' : compact ? 'min-h-[200px]' : 'min-h-[320px]';
  // Enough of the answer to jog a memory, not enough to be the answer. Cut at a word
  // boundary so a hint never ends mid-word, which reads as a bug.
  const hint = (() => {
    const words = (card.back || '').split(/\s+/);
    const take = Math.max(2, Math.ceil(words.length * 0.35));
    return words.slice(0, take).join(' ') + (take < words.length ? '…' : '');
  })();

  // Small round control that sits on the card. stopPropagation everywhere, because the
  // whole card is a flip target and a click on the speaker must not also turn it over.
  const cardBtn = (
    onClick: () => void, label: string, active: boolean, children: React.ReactNode
  ) => (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={label}
      aria-label={label}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
        active ? 'bg-primary text-white' : 'text-text-muted hover:bg-border/60 hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-background p-6 overflow-auto' : ''}>
      <div className={fullscreen ? 'max-w-4xl mx-auto space-y-3' : 'space-y-3'}>
        {/* ── the card ── */}
        <div
          className={`relative w-full ${height} cursor-pointer select-none`}
          style={{ perspective: '1600px' }}
          onClick={() => setFlipped((f) => !f)}
          role="button"
          tabIndex={0}
        >
          <div
            className={`relative w-full ${height} transition-transform duration-500`}
            style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'none' }}
          >
            {/* front */}
            <div
              className="absolute inset-0 bg-surface border border-border rounded-3xl shadow-card overflow-hidden"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                {speech.supported
                  ? cardBtn(() => speech.speak(card.front), `Read aloud in ${language}`, speech.speaking,
                      <Volume2 className="w-4 h-4" />)
                  : <span />}
                {cardBtn(
                  () => setStarred((s) => {
                    const n = new Set(s);
                    n.has(cardIndex) ? n.delete(cardIndex) : n.add(cardIndex);
                    return n;
                  }),
                  isStarred ? 'Remove from starred' : 'Star this card',
                  false,
                  <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
                )}
              </div>

              <div className="h-full flex flex-col items-center justify-center text-center px-8 py-14">
                <p className={`font-semibold text-text-primary leading-snug ${fullscreen ? 'text-2xl' : 'text-lg'}`}>
                  {card.front}
                </p>
                {hinted && (
                  <p className="mt-4 text-sm text-text-secondary italic max-w-prose">
                    {hint}
                  </p>
                )}
              </div>

              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                <button
                  onClick={(e) => { e.stopPropagation(); setHinted(true); }}
                  disabled={hinted}
                  className="text-xs font-semibold text-text-muted hover:text-primary px-2 py-1 rounded-lg hover:bg-primary-muted transition-all disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted flex items-center gap-1.5"
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  {hinted ? 'Hint shown' : 'Get a hint'}
                </button>
                <span className="text-[12px] text-text-muted pr-1">Click to flip</span>
              </div>
            </div>

            {/* back */}
            <div
              className="absolute inset-0 bg-primary-muted border border-primary/30 rounded-3xl shadow-card overflow-hidden"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div className="absolute top-3 left-3">
                {speech.supported && cardBtn(
                  () => speech.speak(card.back), `Read aloud in ${language}`, speech.speaking,
                  <Volume2 className="w-4 h-4" />
                )}
              </div>
              <div className="h-full flex flex-col items-center justify-center text-center px-8 py-14">
                <p className={`text-text-primary leading-relaxed ${fullscreen ? 'text-xl' : 'text-base'}`}>
                  {card.back}
                </p>
              </div>
              <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setKnown((k) => {
                      const n = new Set(k);
                      n.has(cardIndex) ? n.delete(cardIndex) : n.add(cardIndex);
                      return n;
                    });
                  }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                    isKnown
                      ? 'bg-emerald-500 text-white'
                      : 'text-text-secondary hover:bg-surface'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  {isKnown ? 'Got it' : 'I knew this'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── progress ── */}
        <div className="h-1 w-full bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${((pos + 1) / visible.length) * 100}%` }}
          />
        </div>

        {/* ── controls: navigation centred, deck actions to the right ── */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center justify-center gap-4">
            <button
              onClick={() => go(-1)}
              className="w-10 h-10 rounded-full border border-border text-text-secondary hover:border-primary/40 hover:text-primary flex items-center justify-center transition-all"
              aria-label="Previous card"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-bold text-text-primary tabular-nums min-w-[4.5rem] text-center">
              {pos + 1} <span className="text-text-muted font-normal">/ {visible.length}</span>
            </span>
            <button
              onClick={() => go(1)}
              className="w-10 h-10 rounded-full border border-border text-text-secondary hover:border-primary/40 hover:text-primary flex items-center justify-center transition-all"
              aria-label="Next card"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-0.5">
            {cardBtn(() => setAutoplay((v) => !v), autoplay ? 'Pause autoplay' : 'Play through the deck', autoplay,
              autoplay ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />)}
            {cardBtn(
              () => { setOrder((o) => [...o].sort(() => Math.random() - 0.5)); setPos(0); setFlipped(false); setHinted(false); },
              'Shuffle the deck', false, <Shuffle className="w-4 h-4" />
            )}
            {cardBtn(() => { setOnlyUnknown((v) => !v); setPos(0); setFlipped(false); },
              onlyUnknown ? 'Show every card' : 'Show only cards you have not marked known', onlyUnknown,
              <Filter className="w-4 h-4" />)}
            {cardBtn(() => setFullscreen((v) => !v), fullscreen ? 'Exit full screen' : 'Full screen', false,
              fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />)}
          </div>
        </div>

        <p className="text-[12px] text-text-muted">
          {known.size} of {cards.length} known
          {starred.size > 0 && ` · ${starred.size} starred`}
          <span className="hidden sm:inline"> · ← → to move, space to flip</span>
        </p>
      </div>
    </div>
  );
};

/* ────────────────────────── study guide ────────────────────────── */

/** Renders every optional section a richer study guide may carry, skipping the ones
 *  an older or sparser payload doesn't have. */
export const StudyGuideViewer: React.FC<{ guide: StudyGuide }> = ({ guide }) => (
  <div className="space-y-5">
    <div className="bg-primary-muted border border-primary/20 rounded-2xl p-5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-primary mb-2">Summary</p>
      <p className="text-sm text-text-secondary leading-relaxed">{guide.summary}</p>
    </div>

    {!!guide.key_points?.length && (
      <Section icon={ListChecks} title="Key points">
        <ul className="space-y-2">
          {guide.key_points.map((p, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-text-secondary bg-background border border-border rounded-xl p-3">
              <span className="w-5 h-5 rounded-lg bg-primary-muted text-primary text-[12px] font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              {p}
            </li>
          ))}
        </ul>
      </Section>
    )}

    {!!guide.key_terms?.length && (
      <Section icon={Link2} title="Key terms">
        <dl className="grid sm:grid-cols-2 gap-2">
          {guide.key_terms.map((t, i) => (
            <div key={i} className="bg-background border border-border rounded-xl p-3">
              <dt className="text-xs font-bold text-text-primary">{t.term}</dt>
              <dd className="text-xs text-text-secondary mt-0.5">{t.definition}</dd>
            </div>
          ))}
        </dl>
      </Section>
    )}

    {!!guide.formulae?.length && (
      <Section icon={Sigma} title="Formulae to remember">
        <ul className="space-y-1.5">
          {guide.formulae.map((f, i) => (
            <li key={i} className="font-mono text-xs bg-background border border-border rounded-lg px-3 py-2 text-text-primary overflow-x-auto">
              {f}
            </li>
          ))}
        </ul>
      </Section>
    )}

    {guide.worked_example && (
      <Section icon={Lightbulb} title="Worked example">
        <div className="bg-background border border-border rounded-xl p-4 text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
          {guide.worked_example}
        </div>
      </Section>
    )}

    {!!guide.common_mistakes?.length && (
      <Section icon={AlertTriangle} title="Common mistakes">
        <ul className="space-y-2">
          {guide.common_mistakes.map((m, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {m}
            </li>
          ))}
        </ul>
      </Section>
    )}

    {guide.connections && (
      <Section icon={Link2} title="How this connects">
        <p className="text-sm text-text-secondary bg-background border border-border rounded-xl p-4 leading-relaxed">
          {guide.connections}
        </p>
      </Section>
    )}
  </div>
);

// Titled block with an icon, used for each part of a study guide.
const Section: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({
  icon: Icon, title, children,
}) => (
  <div>
    <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-2 flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5" />
      {title}
    </p>
    {children}
  </div>
);

/* ──────────────────────────── quiz / MCQ ─────────────────────────── */

/** Read-only answer key, for teachers and for the library's preview. */
export const AnswerKeyView: React.FC<{ questions: MCQ[] }> = ({ questions }) => (
  <div className="space-y-3">
    {questions.map((q, i) => (
      <div key={i} className="bg-background border border-border rounded-xl p-3">
        <p className="text-xs font-semibold text-text-primary mb-2">{i + 1}. {q.question}</p>
        <ul className="space-y-1 mb-2">
          {q.options.map((opt, oi) => (
            <li
              key={oi}
              className={`text-xs flex items-start gap-2 ${
                oi === q.correct_index
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-text-secondary'
              }`}
            >
              {oi === q.correct_index ? <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
              {opt}
            </li>
          ))}
        </ul>
        {q.explanation && (
          <p className="text-[12px] text-text-muted italic border-t border-border pt-2">{q.explanation}</p>
        )}
      </div>
    ))}
  </div>
);

/** The student-facing solving experience. */
export const QuizPlayer: React.FC<{
  item: GeneratedContentItem;
  courseId: number;
  /** Reveal correctness immediately after each answer instead of only at the end. */
  instantFeedback?: boolean;
  onSubmitted?: (result: QuizResult) => void;
}> = ({ item, courseId, instantFeedback = false, onSubmitted }) => {
  const questions = (item.payload?.questions || []) as MCQ[];
  // answers[i] = chosen option for question i (-1 = unanswered); revealed = questions whose feedback is shown; result = score after submitting.
  const [answers, setAnswers] = useState<number[]>(() => new Array(questions.length).fill(-1));
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<QuizResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // How many questions have been answered so far.
  const answered = answers.filter((a) => a >= 0).length;

  // Sends all answers to the server for marking and shows the result screen.
  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await contentGenerationService.submitAttempt(courseId, item.id, answers);
      setResult(res);
      onSubmitted?.(res);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not submit your answers.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!questions.length) return <p className="text-xs text-text-muted">This set has no questions.</p>;

  // Result screen: score, then per-question feedback with a "Try again" button.
  if (result) {
    const pct = Math.round(result.score);
    return (
      <div className="space-y-3">
        <div className="bg-background border border-border rounded-2xl p-6 text-center">
          <p className="text-4xl font-bold text-text-primary">
            {pct}<span className="text-base text-text-muted">/100</span>
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {result.correct_count} of {result.total_count} correct
          </p>
          <div className="progress-bar-track mt-3">
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
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
                Correct answer: <span className="font-semibold">{questions[i]?.options[pq.correct_index]}</span>
              </p>
            )}
            <p className="text-[12px] text-text-muted mt-1.5 ml-5">{pq.explanation}</p>
          </div>
        ))}
        <button
          onClick={() => {
            setResult(null);
            setAnswers(new Array(questions.length).fill(-1));
            setRevealed(new Set());
          }}
          className="btn-ghost text-xs px-3 py-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-3 text-xs">
          {error}
        </div>
      )}
      {questions.map((q, qi) => {
        // Whether to colour this question's options as right/wrong (instant-feedback mode, after answering).
        const show = instantFeedback && revealed.has(qi);
        return (
          <div key={qi} className="bg-background border border-border rounded-xl p-4">
            <p className="text-sm font-semibold text-text-primary mb-2.5">{qi + 1}. {q.question}</p>
            <div className="space-y-1.5">
              {q.options.map((opt, oi) => {
                const selected = answers[qi] === oi;
                const cls = show
                  ? oi === q.correct_index
                    ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-text-primary font-semibold'
                    : selected
                    ? 'border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 text-text-primary'
                    : 'border-border text-text-secondary'
                  : selected
                  ? 'border-primary/40 bg-primary-muted text-text-primary font-semibold'
                  : 'border-border text-text-secondary hover:border-primary/20';
                return (
                  <label key={oi} className={`flex items-start gap-2.5 text-xs rounded-lg border p-2.5 cursor-pointer transition-all ${cls}`}>
                    <input
                      type="radio"
                      className="mt-0.5"
                      name={`q-${item.id}-${qi}`}
                      checked={selected}
                      disabled={show}
                      onChange={() => {
                        setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)));
                        if (instantFeedback) setRevealed((r) => new Set(r).add(qi));
                      }}
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
            {show && q.explanation && (
              <p className="text-[12px] text-text-muted mt-2.5 pt-2.5 border-t border-border">{q.explanation}</p>
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-text-muted">{answered} of {questions.length} answered</span>
        <button
          onClick={handleSubmit}
          disabled={submitting || answers.includes(-1)}
          className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Submit answers
        </button>
      </div>
    </div>
  );
};

/**
 * An AI-drafted assignment shown as a formal handout: objectives, overview, numbered
 * tasks, submission guidelines and the detailed rubric grid (criteria x performance
 * levels) - the same content as the Word document the teacher downloads here and that
 * students later receive. The teacher can refine it with AI and download the .docx.
 * Posting it to students is done from the course's Assignments tab ("Create"
 * lists the generated drafts), so this view only links there; once it has been
 * posted it links straight to the live assignment instead.
 */
const AssignmentDraftView: React.FC<{
  item: GeneratedContentItem; courseId: number; isTeacher: boolean;
}> = ({ item: initialItem, courseId, isTeacher }) => {
  const navigate = useNavigate();
  // Local copy of the draft so AI refinement shows immediately; plus request flags and refine-box state.
  const [item, setItem] = useState(initialItem);
  const draft = item.payload as AssignmentDraft;
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  // Driven by item.assignment_id (the real Assignment created from this draft, if any).
  const postedAssignmentId = item.assignment_id ?? null;
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState('');
  const [refining, setRefining] = useState(false);

  // Sum of rubric criteria points, shown in the rubric heading.
  const totalPoints = (draft.criteria || []).reduce((sum, c) => sum + (c.max_points || 0), 0);
  // Level column headings (best -> worst) taken from the first criterion that has levels.
  const levelLabels = useMemo(() => {
    const withLevels = (draft.criteria || []).find((c) => c.levels && c.levels.length > 0);
    return withLevels ? [...withLevels.levels!].sort((x, y) => y.points - x.points).map((l) => l.label) : [];
  }, [draft]);

  // Asks the AI to revise the draft according to the teacher's instruction and swaps in the updated version.
  const handleRefine = async () => {
    if (!refineInstruction.trim()) return;
    setRefining(true);
    setError('');
    try {
      const updated = await contentGenerationService.refine(courseId, item.id, refineInstruction.trim());
      setItem(updated);
      setRefineInstruction('');
      setRefineOpen(false);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not refine this draft.'));
    } finally {
      setRefining(false);
    }
  };

  // Downloads the formal Word document (assignment handout + detailed rubric).
  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      await downloadAuthenticated(
        contentGenerationService.assignmentDocxUrl(courseId, item.id),
        `${(draft.title || 'Assignment').replace(/[^\w \-]/g, '_')}.docx`,
      );
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not download the Word document.'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Handout header: university, title and marks. */}
      <div className="text-center border-b border-border pb-3">
        <p className="text-[11px] font-bold tracking-[0.2em] text-primary">AIR UNIVERSITY</p>
        <h3 className="text-base font-bold text-text-primary mt-1">{draft.title}</h3>
        <p className="text-xs font-semibold text-text-muted mt-1">Total marks: {draft.points}</p>
      </div>

      {(draft.objectives || []).length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Learning objectives</h4>
          <ul className="list-disc pl-5 space-y-0.5 text-sm text-text-secondary">
            {draft.objectives!.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Assignment overview</h4>
        <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">{draft.instructions}</p>
      </div>

      {(draft.tasks || []).length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Tasks / questions</h4>
          <div className="space-y-2">
            {draft.tasks!.map((t, i) => (
              <div key={i} className="bg-background border border-border rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-text-primary">Task {i + 1}: {t.title}</span>
                  {t.marks != null && <span className="text-xs font-bold text-text-muted shrink-0">{t.marks} marks</span>}
                </div>
                <p className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">{t.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {(draft.submission_guidelines || []).length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Submission guidelines</h4>
          <ul className="list-disc pl-5 space-y-0.5 text-sm text-text-secondary">
            {draft.submission_guidelines!.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      )}

      {/* Detailed rubric: criteria as rows, performance levels as columns (falls back to a simple list for older drafts). */}
      <div>
        <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">
          Grading rubric ({totalPoints} pts)
        </h4>
        {levelLabels.length > 0 ? (
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-background text-text-secondary">
                  <th className="text-left p-2 font-bold">Criterion</th>
                  {levelLabels.map((l) => <th key={l} className="text-left p-2 font-bold">{l}</th>)}
                  <th className="p-2 font-bold">Max</th>
                </tr>
              </thead>
              <tbody>
                {(draft.criteria || []).map((c, i) => {
                  const byLabel = new Map((c.levels || []).map((l) => [l.label, l]));
                  return (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="p-2 min-w-[140px]">
                        <div className="font-semibold text-text-primary">{c.title}</div>
                        {c.description && <div className="text-text-secondary mt-0.5">{c.description}</div>}
                        {c.clo_code && (
                          <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border text-primary bg-primary-muted border-primary/20">
                            <Target className="w-3 h-3" /> {c.clo_code}
                          </span>
                        )}
                      </td>
                      {levelLabels.map((l) => {
                        const lv = byLabel.get(l);
                        return (
                          <td key={l} className="p-2 min-w-[110px] text-text-secondary">
                            {lv ? <><span className="font-bold text-text-primary">({lv.points})</span> {lv.description}</> : '-'}
                          </td>
                        );
                      })}
                      <td className="p-2 text-center font-bold text-text-primary">{c.max_points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-2">
            {(draft.criteria || []).map((c, i) => (
              <div key={i} className="bg-background border border-border rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-text-primary">{c.title}</span>
                  <span className="text-xs font-bold text-text-muted shrink-0">{c.max_points} pts</span>
                </div>
                {c.description && <p className="text-xs text-text-secondary mt-1">{c.description}</p>}
                {c.clo_code && (
                  <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 border text-primary bg-primary-muted border-primary/20">
                    <Target className="w-3 h-3" /> {c.clo_code}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-rose-500">{error}</p>}

      {/* Teacher actions: refine box, Word download, and the next step (posting happens on the Assignments tab). */}
      {isTeacher && (
        <div className="space-y-2">
          {refineOpen && postedAssignmentId === null && (
            <div className="space-y-2 bg-background border border-border rounded-lg p-3">
              <textarea
                rows={2}
                placeholder="e.g. add a criterion for citations, make the brief shorter…"
                className="input-light text-xs resize-none w-full"
                value={refineInstruction}
                onChange={(e) => setRefineInstruction(e.target.value)}
              />
              <button
                onClick={handleRefine}
                disabled={refining || !refineInstruction.trim()}
                className="btn-secondary text-xs disabled:opacity-60"
              >
                {refining ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {refining ? 'Refining…' : 'Submit refinement'}
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {postedAssignmentId === null && (
              <button onClick={() => setRefineOpen((v) => !v)} className="btn-secondary text-sm">
                <Sparkles className="w-4 h-4" /> Refine with AI
              </button>
            )}
            <button onClick={handleDownload} disabled={downloading} className="btn-secondary text-sm disabled:opacity-60">
              {downloading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Download Word (.docx)
            </button>
            <button onClick={() => navigate(`/course/${courseId}?tab=classwork`)} className="btn-primary text-sm">
              {postedAssignmentId === null ? <ClipboardCheck className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {postedAssignmentId === null ? 'Go to Assignments' : 'View in Classwork'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          {postedAssignmentId === null && (
            <p className="text-xs text-text-muted">
              To publish this to students: open the course, go to <strong>Assignments → Create</strong> and select this assignment.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/** Dispatches to the right renderer for a content item. */
export const ContentBody: React.FC<{
  item: GeneratedContentItem; courseId: number; isTeacher: boolean;
}> = ({ item, courseId, isTeacher }) => {
  if (item.content_type === 'flashcard') {
    return (
      <FlashcardViewer
        cards={(item.payload?.cards || []) as Flashcard[]}
        language={item.language || 'English'}
      />
    );
  }
  if (item.content_type === 'study_guide') {
    return <StudyGuideViewer guide={item.payload as StudyGuide} />;
  }
  if (item.content_type === 'assignment') {
    return <AssignmentDraftView item={item} courseId={courseId} isTeacher={isTeacher} />;
  }
  // Teachers see the key rather than "taking" their own quiz.
  return isTeacher
    ? <AnswerKeyView questions={(item.payload?.questions || []) as MCQ[]} />
    : <QuizPlayer item={item} courseId={courseId} />;
};
