// ContentGeneration: AI study-material studio. A teacher picks a concept, material type (flashcards/MCQs/quiz/study guide/assignment), difficulty,
// language and optional source document, starts an async generation job, then reviews (approve/reject) and browses the results.
// Used as an embedded card in CourseDetail or as a standalone "page" layout.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, RefreshCw, Layers, ListChecks, BookOpen, Check, X, Search,
  ChevronDown, ChevronUp, Trash2, XCircle, CornerLeftUp, GitMerge,
  ShieldCheck, ShieldAlert, History, FileText, Upload, ClipboardCheck,
} from 'lucide-react';
import { contentGenerationService, outcomesService } from '../services/api';
import type { GeneratedContentItem, GeneratableConcept, GenerationJob, QuestionStyle, CLO, PLO } from '../services/api';
import { EmptyStateIllustration } from './illustrations';
import { GenerationProgressModal } from './content/GenerationProgressModal';
// The renderers live in one place: this page used to carry its own thinner copies of
// them, so the same study guide showed key terms and worked examples in the library
// and a bare summary here.
import { ContentBody } from './content/ContentViewers';
import { apiErrorMessage } from '../lib/apiError';

interface ContentGenerationProps {
  courseId: number;
  isTeacher: boolean;
  /** 'card' embeds in CourseDetail; 'page' is the roomier standalone studio layout. */
  variant?: 'card' | 'page';
  /** The course's catalog subject - drives the "Link to CLO" dropdown's options
   *  (CLOs are shared per catalog subject, same scoping as the concept graph).
   *  Null/undefined for a course with no catalog entry yet. */
  catalogId?: number | null;
  /** Pre-selects a content type and opens the composer immediately - used by the
   *  "Create Assignment (AI)" entry point on the teacher dashboard, which deep-links
   *  here wanting the concept+difficulty picker ready to go, not one extra click away. */
  initialContentType?: string;
}

// Display metadata (label, icon, one-line description) for each content type.
interface TypeMeta { label: string; icon: React.ElementType; blurb: string }

// Keyed by the backend's content_type value.
const TYPE_META: Record<string, TypeMeta> = {
  flashcard: { label: 'Flashcards', icon: Layers, blurb: 'Two-sided cards for self-testing' },
  mcq: { label: 'Practice MCQs', icon: ListChecks, blurb: 'Ungraded practice questions' },
  quiz: { label: 'Quiz', icon: ListChecks, blurb: 'Scored, feeds concept mastery' },
  study_guide: { label: 'Study Guide', icon: BookOpen, blurb: 'Summary plus key points' },
  assignment: { label: 'Assignment', icon: ClipboardCheck, blurb: 'Brief + grading rubric together' },
};

// Difficulty levels offered for generated material (and for filtering concepts).
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

/** Mirrors MAX_SOURCE_CHARS in backend/app/content_generation/routes.py. Enforced
 *  server-side too - this only exists so a teacher pasting a long paper is told
 *  before they wait for a generation, not after. */
const MAX_SOURCE_CHARS = 20000;

/** Question shapes a teacher can mix. Keys must match QUESTION_STYLES in the backend
 *  schema; the blurbs here are the short UI version of the prompt text that lives
 *  there. Matching and multi-select are deliberately absent - they need a different
 *  payload and a different player, and live in the question bank instead. */
const QUESTION_STYLE_META: { key: QuestionStyle; label: string; blurb: string }[] = [
  { key: 'recall', label: 'Recall', blurb: 'State or identify a fact' },
  { key: 'application', label: 'Application', blurb: 'Apply it to a scenario' },
  { key: 'true_false', label: 'True / false', blurb: 'One statement, two options' },
  { key: 'fill_blank', label: 'Fill in the blank', blurb: 'A sentence with a gap' },
  { key: 'analysis', label: 'Analysis', blurb: 'Compare, contrast, explain why' },
];

/** Reuses the existing global .badge-easy/.badge-medium/.badge-hard vocabulary so
 *  difficulty reads identically here and on the concept graph. */
const badgeClassFor = (d: string) => `badge-${(d || 'medium').toLowerCase()}`;

// Main component. Holds composer state (concept, type, difficulty, count, language, CLO, source text) plus the list of already generated items.
export const ContentGeneration: React.FC<ContentGenerationProps> = ({
  courseId, isTeacher, variant = 'card', catalogId, initialContentType,
}) => {
  const [items, setItems] = useState<GeneratedContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Composer
  const [concepts, setConcepts] = useState<GeneratableConcept[]>([]);
  const [showComposer, setShowComposer] = useState(variant === 'page' || !!initialContentType);
  const [conceptQuery, setConceptQuery] = useState('');
  // Filters WHICH concepts are offered, by the concept's own difficulty in the
  // concept graph. Distinct from `difficulty` below, which controls how hard the
  // generated material should be - you can legitimately want easy questions on a hard
  // concept, or hard questions on an easy one.
  const [conceptLevel, setConceptLevel] = useState<'' | Difficulty>('');
  const [selectedConceptId, setSelectedConceptId] = useState('');
  const [contentType, setContentType] = useState(initialContentType || 'flashcard');
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium');
  const [target, setTarget] = useState<'concept' | 'parent' | 'combined'>('concept');
  const [count, setCount] = useState(5);
  // Assignment only: how many rubric criteria to draft. null lets the model decide
  // (its own "3-6" default judgement call).
  const [criteriaCount, setCriteriaCount] = useState<number | null>(null);
  // Learner-facing language. Free text rather than a fixed list so a language course
  // can generate in anything the model writes; the presets are just shortcuts.
  const [language, setLanguage] = useState('English');
  // Which Course Learning Outcome this generation is meant to support - populated
  // from the course catalog's CLO list, empty string means "no link".
  const [clos, setClos] = useState<CLO[]>([]);
  const [selectedCloId, setSelectedCloId] = useState('');
  // Every PLO, just to resolve a selected CLO's plo_ids into codes for the badge
  // row below the dropdown - the CLO -> PLO link itself lives on the CLO row.
  const [plos, setPlos] = useState<PLO[]>([]);

  // Load this catalog subject's CLOs for the "Link to CLO" dropdown.
  useEffect(() => {
    if (!catalogId) { setClos([]); return; }
    outcomesService.listCLOs(catalogId).then(setClos).catch(() => setClos([]));
  }, [catalogId]);

  // Load all PLOs, only used to show which PLOs a chosen CLO rolls up to.
  useEffect(() => {
    outcomesService.listPLOs().then(setPlos).catch(() => setPlos([]));
  }, []);

  // Resolve the selected CLO and the PLOs it maps to, for the "Rolls up to" badges.
  const selectedClo = clos.find((c) => String(c.id) === selectedCloId);
  const selectedCloPlos = selectedClo ? plos.filter((p) => selectedClo.plo_ids.includes(p.id)) : [];
  // A one-off document to generate from. Held in memory only - it is never uploaded
  // to the course, so it never reaches the RAG index or concept extraction.
  const [source, setSource] = useState<{ filename: string; characters: number; truncated: boolean; text: string } | null>(null);
  const [extracting, setExtracting] = useState(false);
  // Pasting is offered next to the file picker because plenty of question sets arrive
  // as an email or a chunk of a Word document rather than a file worth saving.
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  // Empty means "you choose" - a teacher with no opinion should not have to have one.
  const [questionStyles, setQuestionStyles] = useState<QuestionStyle[]>([]);
  const [importExisting, setImportExisting] = useState(false);
  const [generating, setGenerating] = useState(false);
  // The job currently being watched. Closing the modal clears this but does NOT
  // cancel the job - it keeps running and announces itself by notification.
  const [activeJob, setActiveJob] = useState<GenerationJob | null>(null);

  // No library filters here any more: filtering lives in ContentLibrary, and the
  // embedded CourseDetail card shows the course's items unfiltered.

  // Load this course's generated content items.
  const fetchItems = async () => {
    setLoading(true);
    try {
      setItems(await contentGenerationService.list(courseId));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the generated content.'));
    } finally {
      setLoading(false);
    }
  };

  // On mount / course change: load items, and (teachers only) the list of concepts that material can be generated for.
  useEffect(() => {
    fetchItems();
    if (isTeacher) {
      contentGenerationService
        .listConcepts(courseId)
        .then(setConcepts)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // The full concept object for the current dropdown selection.
  const selectedConcept = useMemo(
    () => concepts.find((c) => c.id === selectedConceptId) || null,
    [concepts, selectedConceptId]
  );

  // Filtering the concept list rather than relying on a bare <select> - a course can
  // easily carry a few hundred concepts, at which point scrolling a native dropdown
  // is unusable.
  const filteredConcepts = useMemo(() => {
    const q = conceptQuery.trim().toLowerCase();
    return concepts.filter(
      (c) =>
        (!conceptLevel || (c.difficulty || 'Medium') === conceptLevel) &&
        (!q || c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q))
    );
  }, [concepts, conceptQuery, conceptLevel]);

  // How many concepts sit at each level, so the filter buttons can show counts and
  // disable a level that would return nothing.
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = { Easy: 0, Medium: 0, Hard: 0 };
    for (const c of concepts) counts[c.difficulty || 'Medium'] = (counts[c.difficulty || 'Medium'] || 0) + 1;
    return counts;
  }, [concepts]);

  // Clearing a selection the filter just hid: leaving a Hard concept selected while
  // the list shows only Easy ones means the Generate button silently acts on a
  // concept that is no longer on screen.
  useEffect(() => {
    if (!selectedConceptId) return;
    if (!filteredConcepts.some((c) => c.id === selectedConceptId)) setSelectedConceptId('');
  }, [filteredConcepts, selectedConceptId]);

  // Everything already generated for the concept currently selected, so the composer
  // can warn before a teacher spends tokens duplicating a set they already have.
  const existingForConcept = useMemo(
    () => (selectedConcept ? items.filter((i) => i.concept_node_id === selectedConcept.id) : []),
    [items, selectedConcept]
  );

  // A stricter signal than "something exists": same concept AND same type AND same
  // difficulty is almost certainly an accidental repeat.
  const duplicateWarning = useMemo(
    () => existingForConcept.some(
      (i) => i.content_type === contentType && (i.difficulty || 'Medium') === difficulty
    ),
    [existingForConcept, contentType, difficulty]
  );

  // Both parent-related options need an actual prerequisite, so they reset themselves
  // when the chosen concept has none rather than silently 400ing on Generate.
  useEffect(() => {
    if (!selectedConcept?.has_parent && target !== 'concept') setTarget('concept');
  }, [selectedConcept, target]);

  // Start an asynchronous generation job with the chosen options. The request only creates the job; progress is shown in GenerationProgressModal.
  const handleGenerate = async () => {
    if (!selectedConcept) return;
    setGenerating(true);
    setError('');
    try {
      const job = await contentGenerationService.generateAsync(courseId, {
        concept_node_id: selectedConcept.id,
        concept_name: selectedConcept.name,
        content_type: contentType,
        question_count: count,
        card_count: count,
        difficulty,
        target,
        language,
        source_text: source?.text,
        clo_id: selectedCloId ? Number(selectedCloId) : null,
        // Both are question-only concepts, so they are left off entirely for
        // flashcards and study guides rather than sent and ignored.
        ...(contentType === 'mcq' || contentType === 'quiz'
          ? { question_styles: questionStyles, import_existing: importExisting && !!source }
          : {}),
        ...(contentType === 'assignment' ? { criteria_count: criteriaCount } : {}),
      });
      setActiveJob(job);
      if (variant === 'card') setShowComposer(false);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not generate this content.'));
    } finally {
      setGenerating(false);
    }
  };

  /** Pasted text takes the same shape as an extracted file so everything downstream -
   *  the badge, the import checkbox, the grounding footer - has one case to handle. */
  const usePastedText = () => {
    const text = pasted.trim();
    if (!text) return;
    setSource({
      filename: 'Pasted text',
      characters: text.length,
      truncated: text.length > MAX_SOURCE_CHARS,
      text: text.slice(0, MAX_SOURCE_CHARS),
    });
    setPasting(false);
  };

  // Dropping the source must also drop the import choice: "transcribe the questions in
  // this document" cannot survive the document going away.
  const clearSource = () => {
    setSource(null);
    setImportExisting(false);
    setPasted('');
  };

  const handleSourceFile = async (file: File | null) => {
    if (!file) return;
    setExtracting(true);
    setError('');
    try {
      const res = await contentGenerationService.extractSource(courseId, file);
      setSource({
        filename: res.filename, characters: res.characters,
        truncated: res.truncated, text: res.source_text,
      });
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not read that file.'));
    } finally {
      setExtracting(false);
    }
  };

  // Teacher approves or rejects a generated item (PendingReview -> Approved/Rejected) and updates it in the list.
  const handleReview = async (item: GeneratedContentItem, approve: boolean) => {
    try {
      const updated = await contentGenerationService.review(courseId, item.id, approve);
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save your review decision.'));
    }
  };

  // Delete a generated item after confirmation and remove it from the list.
  const handleDelete = async (item: GeneratedContentItem) => {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    try {
      await contentGenerationService.remove(courseId, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete this item.'));
    }
  };

  // Students only see Approved items; teachers see everything.
  const visibleItems = useMemo(() => {
    let list = isTeacher ? items : items.filter((i) => i.status === 'Approved');
    return list;
  }, [items, isTeacher]);

  // Outer wrapper styling differs between the roomy page layout and the embedded card.
  const wrapperClass =
    variant === 'page'
      ? 'space-y-6'
      : 'bg-surface rounded-2xl p-6 border border-border animate-fade-up';

  // Render: card header, error banner, composer (teachers), then the library list (card variant only), plus the progress modal for an active job.
  return (
    <div className={wrapperClass}>
      {variant === 'card' && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
            <Sparkles className="w-4.5 h-4.5 text-secondary" />
            Study Materials
          </h3>
          {isTeacher && !showComposer && (
            <button onClick={() => setShowComposer(true)} className="btn-primary text-xs px-3 py-1.5">
              + Generate
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 mb-4 text-sm animate-fade-in">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isTeacher && showComposer && (
        <div
          className={
            variant === 'page'
              ? 'glass-panel rounded-2xl p-6 border border-border shadow-card space-y-5 animate-fade-up'
              : 'border border-border rounded-xl p-4 mb-5 bg-background space-y-4'
          }
        >
          {variant === 'page' && (
            <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
              <Sparkles className="w-4.5 h-4.5 text-secondary" />
              Generate new material
            </h3>
          )}

          {/* ---- concept picker ---- */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Concept</label>
            {concepts.length === 0 ? (
              <p className="text-xs text-text-muted border border-dashed border-border rounded-xl p-3">
                This course has no knowledge-graph concepts yet. Upload course material and build the
                graph first, then come back here.
              </p>
            ) : (
              <>
                {/* Step 1: narrow the list by the concept's OWN difficulty. */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <button
                    type="button"
                    onClick={() => setConceptLevel('')}
                    className={`rounded-lg border px-2.5 py-1 text-[12px] font-bold transition-all ${
                      conceptLevel === ''
                        ? 'border-primary/40 bg-primary-muted text-primary'
                        : 'border-border bg-background text-text-secondary hover:border-primary/20'
                    }`}
                  >
                    All levels ({concepts.length})
                  </button>
                  {DIFFICULTIES.map((d) => {
                    const n = levelCounts[d] || 0;
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={n === 0}
                        onClick={() => setConceptLevel(conceptLevel === d ? '' : d)}
                        className={`rounded-lg border px-2.5 py-1 text-[12px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                          conceptLevel === d
                            ? 'border-primary/40 bg-primary-muted text-primary'
                            : 'border-border bg-background text-text-secondary hover:border-primary/20'
                        }`}
                        title={n === 0 ? `No ${d.toLowerCase()} concepts in this course` : undefined}
                      >
                        {d} ({n})
                      </button>
                    );
                  })}
                </div>

                <div className="relative mb-2">
                  <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    className="input-light w-full text-sm pl-9"
                    placeholder={`Filter ${filteredConcepts.length} concept${filteredConcepts.length === 1 ? '' : 's'}...`}
                    value={conceptQuery}
                    onChange={(e) => setConceptQuery(e.target.value)}
                  />
                </div>
                <select
                  className="input-light w-full text-sm"
                  value={selectedConceptId}
                  onChange={(e) => setSelectedConceptId(e.target.value)}
                  size={variant === 'page' ? 6 : undefined}
                >
                  {variant !== 'page' && <option value="">Select a concept...</option>}
                  {filteredConcepts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {/* The level is only worth repeating when the list isn't already
                          filtered to a single one. */}
                      {conceptLevel ? c.name : `[${c.difficulty || 'Medium'}] ${c.name}`}
                      {c.has_parent ? ` — builds on ${c.parents[0].name}` : ''}
                    </option>
                  ))}
                </select>
                {filteredConcepts.length === 0 ? (
                  <p className="text-[12px] text-amber-600 dark:text-amber-400 mt-1">
                    No concepts match{conceptLevel ? ` the ${conceptLevel.toLowerCase()} level` : ''}
                    {conceptQuery ? ' and that search' : ''}.
                  </p>
                ) : (conceptQuery || conceptLevel) && (
                  <p className="text-[12px] text-text-muted mt-1">
                    Showing {filteredConcepts.length} of {concepts.length} concepts.
                  </p>
                )}
              </>
            )}
          </div>

          {/* What already exists for this concept.
              Shown before the Generate button, not after, because the whole point is
              to answer "have I already made this?" at the moment a teacher is about to
              spend tokens making it again. Regenerating is still allowed - a second
              set at a different difficulty is a legitimate thing to want - but it is
              now a decision rather than an accident. */}
          {selectedConcept && (
            <div className={`rounded-xl border p-3 ${
              existingForConcept.length
                ? 'border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10'
                : 'border-border bg-background'
            }`}>
              {existingForConcept.length === 0 ? (
                <p className="text-xs text-text-secondary flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-text-muted" />
                  Nothing generated for "{selectedConcept.name}" yet.
                </p>
              ) : (
                <>
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    Already generated for "{selectedConcept.name}" ({existingForConcept.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {existingForConcept.map((e) => (
                      <span
                        key={e.id}
                        className="text-[11px] font-semibold rounded-full px-2 py-0.5 border border-border bg-surface text-text-secondary"
                        title={`${e.title} — ${e.status}`}
                      >
                        {TYPE_META[e.content_type]?.label || e.content_type} · {e.difficulty}
                        {e.status === 'PendingReview' ? ' · pending' : e.status === 'Rejected' ? ' · rejected' : ''}
                      </span>
                    ))}
                  </div>
                  {duplicateWarning && (
                    <p className="text-[12px] text-amber-800 dark:text-amber-300 mt-2">
                      You already have <strong>{TYPE_META[contentType]?.label}</strong> at{' '}
                      <strong>{difficulty}</strong> for this concept. Generating again will create a
                      second set, not replace it.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {selectedConcept && (
            <>
              {selectedConcept.description && (
                <p className="text-xs text-text-secondary bg-background border border-border rounded-xl p-3">
                  {selectedConcept.description}
                </p>
              )}

              {/* ---- what the material should cover ---- */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                  What should this cover?
                </label>
                {!selectedConcept.has_parent ? (
                  <p className="text-[12px] text-text-muted border border-dashed border-border rounded-xl p-3">
                    "{selectedConcept.name}" has no prerequisite in the concept graph, so material
                    can only be generated for the concept itself.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {([
                      {
                        key: 'concept',
                        icon: Sparkles,
                        label: `Just "${selectedConcept.name}"`,
                        blurb: 'The concept on its own. Its prerequisite is assumed, not taught.',
                      },
                      {
                        key: 'combined',
                        icon: GitMerge,
                        label: `"${selectedConcept.parents[0].name}" + "${selectedConcept.name}" together`,
                        blurb: 'One integrated set: the foundation first, then what builds on it, plus items that only work if the student holds both. Use this when students are failing the topic because the thing underneath it never landed.',
                      },
                      {
                        key: 'parent',
                        icon: CornerLeftUp,
                        label: `Just "${selectedConcept.parents[0].name}"`,
                        blurb: 'The prerequisite on its own, instead of the concept.',
                      },
                    ] as const).map(({ key, icon: Icon, label, blurb }) => (
                      <label
                        key={key}
                        className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs cursor-pointer transition-all ${
                          target === key
                            ? 'border-primary/40 bg-primary-muted'
                            : 'border-border hover:border-primary/30'
                        }`}
                      >
                        <input
                          type="radio"
                          name="generation-target"
                          className="mt-0.5"
                          checked={target === key}
                          onChange={() => setTarget(key)}
                        />
                        <span className="min-w-0">
                          <span className="font-semibold text-text-primary flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            {label}
                          </span>
                          <span className="block text-text-muted mt-0.5">{blurb}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ---- type ---- */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Material type</label>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {Object.entries(TYPE_META).map(([key, meta]) => {
                const Icon = meta.icon;
                const active = contentType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setContentType(key)}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      active
                        ? 'border-primary/40 bg-primary-muted'
                        : 'border-border bg-background hover:border-primary/20'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-bold text-text-primary">
                      <Icon className="w-3.5 h-3.5" />
                      {meta.label}
                    </span>
                    <span className="block text-[12px] text-text-muted mt-0.5">{meta.blurb}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- difficulty + count ---- */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Difficulty</label>
              <div className="flex gap-2">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulty(d)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-bold transition-all ${
                      difficulty === d
                        ? 'border-primary/40 bg-primary-muted text-primary'
                        : 'border-border bg-background text-text-secondary hover:border-primary/20'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-text-muted mt-1.5">
                {difficulty === 'Easy' && 'Recall and recognition of the core definition.'}
                {difficulty === 'Medium' && 'Applying the concept to a concrete situation.'}
                {difficulty === 'Hard' && 'Multi-step reasoning, edge cases and tempting distractors.'}
              </p>
            </div>

            {contentType !== 'study_guide' && contentType !== 'assignment' && (
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                  {contentType === 'flashcard' ? 'Number of cards' : 'Number of questions'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  className="input-light w-full text-sm"
                  value={count}
                  onChange={(e) => setCount(Math.min(20, Math.max(1, parseInt(e.target.value) || 5)))}
                />
              </div>
            )}

            {contentType === 'assignment' && (
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                  Rubric criteria <span className="text-text-muted font-normal">(optional)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  placeholder="Let AI decide"
                  className="input-light w-full text-sm"
                  value={criteriaCount ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setCriteriaCount(v ? Math.min(10, Math.max(1, parseInt(v) || 1)) : null);
                  }}
                />
              </div>
            )}
          </div>

          {/* ── link to CLO ── */}
          {clos.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                Link to CLO <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <select
                className="input-light w-full text-sm"
                value={selectedCloId}
                onChange={(e) => setSelectedCloId(e.target.value)}
              >
                <option value="">No CLO link</option>
                {clos.map((clo) => (
                  <option key={clo.id} value={clo.id}>{clo.code} — {clo.title}</option>
                ))}
              </select>
              <p className="text-[12px] text-text-muted mt-1.5">
                Tags this item as supporting one Course Learning Outcome, for CLO/PLO attainment reporting.
              </p>
              {selectedClo && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[11px] text-text-muted">Rolls up to:</span>
                  {selectedCloPlos.length > 0 ? selectedCloPlos.map((p) => (
                    <span key={p.id} className="text-[11px] font-semibold rounded-full px-2 py-0.5 border text-secondary bg-secondary-muted border-secondary/20">
                      {p.code}
                    </span>
                  )) : (
                    <span className="text-[11px] text-text-muted italic">no PLO linked yet</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── question styles ── */}
          {contentType !== 'flashcard' && contentType !== 'study_guide' && contentType !== 'assignment' && (
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <label className="block text-xs font-semibold text-text-secondary">
                  Question styles <span className="text-text-muted font-normal">(optional)</span>
                </label>
                {questionStyles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQuestionStyles([])}
                    className="text-[12px] text-text-muted hover:text-primary font-semibold"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {QUESTION_STYLE_META.map((s) => {
                  const on = questionStyles.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() =>
                        setQuestionStyles((prev) =>
                          prev.includes(s.key) ? prev.filter((k) => k !== s.key) : [...prev, s.key]
                        )
                      }
                      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${
                        on
                          ? 'border-primary/40 bg-primary-muted'
                          : 'border-border bg-background hover:border-primary/20'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          on ? 'bg-primary border-primary text-white' : 'border-border'
                        }`}
                      >
                        {on && <Check className="w-3 h-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-xs font-bold ${on ? 'text-primary' : 'text-text-primary'}`}>
                          {s.label}
                        </span>
                        <span className="block text-[12px] text-text-muted">{s.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[12px] text-text-muted mt-1.5">
                {questionStyles.length === 0
                  ? 'Nothing ticked: the model picks whatever suits each question.'
                  : `Only these styles, spread evenly across the ${count} questions.`}
              </p>
            </div>
          )}

          {/* ── language ── */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">
              Language of the material
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {['English', 'Urdu', 'Spanish', 'French', 'Arabic'].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLanguage(l)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                    language === l
                      ? 'border-primary/40 bg-primary-muted text-primary'
                      : 'border-border bg-background text-text-secondary hover:border-primary/20'
                  }`}
                >
                  {l}
                </button>
              ))}
              <input
                className="input-light text-xs py-1.5 w-36"
                placeholder="Other language"
                value={['English', 'Urdu', 'Spanish', 'French', 'Arabic'].includes(language) ? '' : language}
                onChange={(e) => setLanguage(e.target.value || 'English')}
              />
            </div>
            {language.toLowerCase() !== 'english' && (
              <p className="text-[12px] text-text-muted mt-1.5">
                Cards and questions will be written in {language}; explanations stay in English,
                which is what a learner of {language} can still read.
              </p>
            )}
          </div>

          {/* ── generate from a document instead ── */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <label className="block text-xs font-semibold text-text-secondary">
                Generate from a document <span className="text-text-muted font-normal">(optional)</span>
              </label>
              {!source && (
                <button
                  type="button"
                  onClick={() => setPasting((p) => !p)}
                  className="text-[12px] text-text-muted hover:text-primary font-semibold"
                >
                  {pasting ? 'Upload a file instead' : 'Or paste text'}
                </button>
              )}
            </div>
            {source ? (
              <div className="rounded-xl border border-primary/30 bg-primary-muted p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{source.filename}</span>
                  </p>
                  <p className="text-[12px] text-text-muted mt-0.5">
                    {source.characters.toLocaleString()} characters read
                    {source.truncated && ' (truncated to the first 20,000)'} — this replaces
                    the course material for this generation.
                  </p>
                </div>
                <button onClick={clearSource} className="p-1 text-text-muted hover:text-rose-500 rounded shrink-0" title="Remove">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : pasting ? (
              <div>
                <textarea
                  rows={6}
                  className="input-light w-full text-sm font-mono"
                  placeholder={
                    'Paste a quiz, a handout, or any notes to generate from.\n\n'
                    + '1. Which of these is a prime number?\n   a) 4  b) 7  c) 9  d) 12'
                  }
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                />
                <div className="flex items-center justify-between gap-3 mt-1.5">
                  <p className="text-[12px] text-text-muted">
                    {pasted.length.toLocaleString()} characters
                    {pasted.length > MAX_SOURCE_CHARS && ` — only the first ${MAX_SOURCE_CHARS.toLocaleString()} will be used`}
                  </p>
                  <button
                    type="button"
                    onClick={usePastedText}
                    disabled={pasted.trim().length < 40}
                    className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Use this text
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative border-2 border-dashed border-border rounded-xl p-4 text-center bg-background hover:border-primary/40 transition-all">
                <input
                  type="file"
                  accept=".pdf,.docx,.pptx,.ppt,.txt"
                  disabled={extracting}
                  onChange={(e) => handleSourceFile(e.target.files?.[0] || null)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="pointer-events-none flex flex-col items-center gap-1">
                  {extracting
                    ? <RefreshCw className="w-5 h-5 text-primary animate-spin" />
                    : <Upload className="w-5 h-5 text-text-muted" />}
                  <p className="text-xs font-semibold text-text-primary">
                    {extracting ? 'Reading your file...' : 'Drop a file, or click to choose'}
                  </p>
                  <p className="text-[12px] text-text-muted">
                    PDF, DOCX, PPTX, TXT — up to 5MB. Not added to the course.
                  </p>
                </div>
              </div>
            )}

            {/* Only offered once there is something to transcribe, and only for
                questions - "transcribe the flashcards in this paper" is meaningless. */}
            {source && contentType !== 'flashcard' && contentType !== 'study_guide' && contentType !== 'assignment' && (
              <button
                type="button"
                onClick={() => setImportExisting((v) => !v)}
                className={`mt-2 w-full flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${
                  importExisting ? 'border-primary/40 bg-primary-muted' : 'border-border bg-background hover:border-primary/20'
                }`}
              >
                <span
                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    importExisting ? 'bg-primary border-primary text-white' : 'border-border'
                  }`}
                >
                  {importExisting && <Check className="w-3 h-3" />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-xs font-bold ${importExisting ? 'text-primary' : 'text-text-primary'}`}>
                    This already contains questions — import them
                  </span>
                  <span className="block text-[12px] text-text-muted">
                    Keeps the original wording and options, works out any missing answers,
                    and writes an explanation for each. Nothing new is invented.
                  </span>
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[12px] text-text-muted flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              {importExisting && source
                ? 'Taken from the questions in the document you supplied.'
                : source
                  ? 'Grounded in the document you supplied.'
                  : "Grounded in this course's uploaded material."}
            </p>
            <div className="flex gap-2">
              {variant === 'card' && (
                <button onClick={() => setShowComposer(false)} className="btn-ghost text-xs px-3 py-1.5">
                  Cancel
                </button>
              )}
              <button
                onClick={handleGenerate}
                disabled={generating || !selectedConceptId}
                className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Generate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The standalone Generate page ends here: browsing, reviewing and exporting
          live in the Library tab, so this screen stays a composer. The embedded
          CourseDetail card keeps its inline list, since there is no Library there. */}
      {variant === 'page' ? null : (
      <>
      {/* ---- library ---- */}
      <div>

        {loading ? (
          <div className="text-center py-8 text-sm text-text-muted">Loading...</div>
        ) : visibleItems.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
            <EmptyStateIllustration className="w-28 h-28 mx-auto mb-2" />
            {items.length === 0
              ? `No study materials ${isTeacher ? 'generated' : 'available'} yet.`
              : 'No materials match these filters.'}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleItems.map((item) => {
              const meta = TYPE_META[item.content_type];
              const Icon = meta?.icon || Sparkles;
              const isExpanded = expandedId === item.id;
              return (
                <div key={item.id} className="border border-border rounded-xl p-4 bg-background">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="flex items-start gap-2.5 min-w-0 text-left flex-1"
                    >
                      <Icon className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-text-primary truncate">{item.title}</span>
                        <span className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className={badgeClassFor(item.difficulty)}>{item.difficulty || 'Medium'}</span>
                          {item.clo_code && (
                            <span
                              className="text-[11px] font-semibold rounded-full px-2 py-0.5 border text-primary bg-primary-muted border-primary/20"
                              title="Linked Course Learning Outcome"
                            >
                              {item.clo_code}
                            </span>
                          )}
                          {item.clo_id && clos.find((c) => c.id === item.clo_id)?.plo_ids.map((ploId) => {
                            const p = plos.find((x) => x.id === ploId);
                            return p ? (
                              <span key={ploId} className="text-[11px] font-semibold rounded-full px-2 py-0.5 border text-secondary bg-secondary-muted border-secondary/20"
                                title="Program Learning Outcome this CLO rolls up to">
                                {p.code}
                              </span>
                            ) : null;
                          })}
                          {isTeacher && (
                            <span
                              className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border flex items-center gap-1 ${
                                item.grounded_excerpts > 0
                                  ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                                  : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'
                              }`}
                              title={
                                item.grounded_excerpts > 0
                                  ? `Written from ${item.grounded_excerpts} excerpt(s) of this course's own material.`
                                  : 'No course material matched this concept, so this was written from the concept description alone — check it more carefully.'
                              }
                            >
                              {item.grounded_excerpts > 0 ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                              {item.grounded_excerpts > 0 ? `${item.grounded_excerpts} sources` : 'Ungrounded'}
                            </span>
                          )}
                        </span>
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
                      )}
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      {isTeacher && item.status === 'PendingReview' && (
                        <>
                          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-full px-2 py-0.5">
                            Pending review
                          </span>
                          <button
                            onClick={() => handleReview(item, true)}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded"
                            title="Approve"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleReview(item, false)}
                            className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded"
                            title="Reject"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {isTeacher && item.status === 'Rejected' && (
                        <span className="text-[11px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-full px-2 py-0.5">
                          Rejected
                        </span>
                      )}
                      {isTeacher && (
                        <button
                          onClick={() => handleDelete(item)}
                          className="p-1 text-text-muted hover:text-rose-500 rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 border-t border-border pt-4">
                      <ContentBody item={item} courseId={courseId} isTeacher={isTeacher} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}

      {activeJob && (
        <GenerationProgressModal
          courseId={courseId}
          job={activeJob}
          onCompleted={() => fetchItems()}
          onClose={() => setActiveJob(null)}
        />
      )}
    </div>
  );
};

