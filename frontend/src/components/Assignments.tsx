// Assignments: per-course assignment list. Teachers create/edit/delete assignments, manage an AI-drafted rubric, and review/grade submissions;
// students see due-date badges and submit (or resubmit) their work and read feedback.
import React, { useEffect, useState } from 'react';
import {
  ClipboardList, Send, Pencil, Trash2, X, Check, RefreshCw, Paperclip,
  Upload, Download, ChevronDown, ChevronUp, Clock, CheckCircle2, Sparkles, MessageSquare,
  ListChecks, Plus, Target, ShieldAlert, FileText, Lightbulb,
} from 'lucide-react';
import { assignmentService, outcomesService, contentGenerationService } from '../services/api';
import type {
  AssignmentItem, SubmissionItem, Rubric, RubricCriterion, CLO, GeneratedContentItem, MisconceptionGroup,
  SimilarityReport, Misconception,
} from '../services/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { parseUtc } from '../lib/time';
import { EmptyStateIllustration } from './illustrations';

// <input type="datetime-local"> always represents local wall-clock time with no
// timezone info - converting a UTC Date to it must subtract the local offset first,
// not just re-serialize to an ISO (UTC) string, or the displayed time silently
// shifts by the viewer's UTC offset (caught when editing an assignment moved its
// due time by 5 hours for a Pakistan-based user).
function toDatetimeLocalValue(iso: string): string {
  const date = parseUtc(iso);
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
import { downloadAuthenticated } from '../lib/download';
import { apiErrorMessage } from '../lib/apiError';

interface AssignmentsProps {
  courseId: number;
  isTeacher: boolean;
  /** The course's catalog subject - drives which CLOs the rubric editor's "Link to
   *  CLO" dropdown offers (CLOs are shared per catalog subject, same scoping as the
   *  concept graph). Null/undefined for a course with no catalog entry yet. */
  catalogId?: number | null;
}

// Builds the coloured "due" badge (label + Tailwind classes): neutral if already submitted, red if overdue, amber if due within 48h, blue otherwise.
function dueBadge(dueDate: string | null, submitted: boolean) {
  if (!dueDate) return null;
  const due = parseUtc(dueDate);
  const now = new Date();
  const hoursLeft = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
  const label = due.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  if (submitted) return { label: `Due ${label}`, className: 'bg-background text-text-secondary border-border' };
  if (hoursLeft < 0) return { label: `Overdue — was due ${label}`, className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20' };
  if (hoursLeft < 48) return { label: `Due soon — ${label}`, className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20' };
  return { label: `Due ${label}`, className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20' };
}

// Main component: holds all UI state (composer, edit form, submissions, grading, rubric draft) and renders the list for both teacher and student roles.
// Teacher-only badge for the similar-assignment result: level, strongest overlap and who it matches.
const SimilarityBadge: React.FC<{ report?: SimilarityReport | null }> = ({ report }) => {
  if (!report) return <p className="text-[11px] text-text-muted mt-0.5">Similarity check pending…</p>;
  if (report.level === 'none' || report.matches.length === 0) {
    return <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">No similar submissions found</p>;
  }
  const tone = report.level === 'high'
    ? 'text-rose-600 dark:text-rose-400'
    : report.level === 'medium' ? 'text-amber-600 dark:text-amber-400' : 'text-text-muted';
  return (
    <div className={`text-[11px] mt-0.5 ${tone}`}>
      <p className="flex items-center gap-1 font-bold">
        <ShieldAlert className="w-3 h-3" /> {report.level.toUpperCase()} similarity · {Math.round(report.max_score * 100)}% wording in common
      </p>
      {report.matches.map((m) => (
        <p key={m.submission_id} className="pl-4">
          {Math.round(m.score * 100)}% with {m.student_name || 'another student'}{m.same_assignment ? '' : ' (another assignment)'}
        </p>
      ))}
    </div>
  );
};

// AI-detected misconceptions for one submission (what was wrong and the correct idea); hidden when there are none.
const MisconceptionList: React.FC<{ items?: Misconception[] | null; audience: 'teacher' | 'student' }> = ({ items, audience }) => {
  if (!items || items.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 rounded-lg p-2.5 space-y-1.5">
      <p className="flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
        <Lightbulb className="w-3.5 h-3.5" /> {audience === 'student' ? 'Ideas to review' : 'Misconceptions detected'}
      </p>
      {items.map((m, i) => (
        <div key={i} className="text-[12px] text-text-secondary">
          {m.concept_name && <span className="font-semibold text-text-primary">{m.concept_name}: </span>}
          {m.misconception}
          <p className="text-emerald-700 dark:text-emerald-400">Correct idea: {m.correction}</p>
        </div>
      ))}
    </div>
  );
};

export const Assignments: React.FC<AssignmentsProps> = ({ courseId, isTeacher, catalogId }) => {
  // --- Assignment list and composer (new-assignment form) state ---
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showComposer, setShowComposer] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [points, setPoints] = useState('');
  const [posting, setPosting] = useState(false);
  // Generated (Content Studio) assignment drafts not yet posted - the composer picks one of these.
  const [drafts, setDrafts] = useState<GeneratedContentItem[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);
  // Teacher-only review tools: class-wide misconceptions per assignment and the similarity re-check flag.
  const [classMisconceptions, setClassMisconceptions] = useState<Record<number, MisconceptionGroup[]>>({});
  const [checkingSimilarityId, setCheckingSimilarityId] = useState<number | null>(null);

  // --- Inline edit form state ---
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editPoints, setEditPoints] = useState('');
  const [saving, setSaving] = useState(false);

  // --- Submissions panel and grading state ---
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [submissions, setSubmissions] = useState<Record<number, SubmissionItem[]>>({});
  const [submittingId, setSubmittingId] = useState<number | null>(null);

  const [gradingSubmissionId, setGradingSubmissionId] = useState<number | null>(null);
  const [feedbackOpenId, setFeedbackOpenId] = useState<number | null>(null);
  const [editingGradeId, setEditingGradeId] = useState<number | null>(null);
  const [editGradeValue, setEditGradeValue] = useState('');
  const [editFeedbackValue, setEditFeedbackValue] = useState('');
  const [savingGrade, setSavingGrade] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  // submissionId -> criterionId -> level_id - a teacher's in-progress level
  // overrides for a PendingReview grade, applied only once Approve is clicked.
  const [levelOverrides, setLevelOverrides] = useState<Record<number, Record<number, number>>>({});

  // ── Rubric (per assignment, shared across every student's submission) ──
  const [clos, setClos] = useState<CLO[]>([]);
  const [rubricOpenId, setRubricOpenId] = useState<number | null>(null);
  const [rubrics, setRubrics] = useState<Record<number, Rubric | null>>({});
  const [rubricDraft, setRubricDraft] = useState<RubricCriterion[]>([]);
  const [rubricLoading, setRubricLoading] = useState(false);
  const [rubricGenerating, setRubricGenerating] = useState(false);
  const [rubricSaving, setRubricSaving] = useState(false);

  // Load the CLOs (course learning outcomes) for this course's catalog subject so the rubric editor can link criteria to them.
  useEffect(() => {
    if (!catalogId) { setClos([]); return; }
    outcomesService.listCLOs(catalogId).then(setClos).catch(() => setClos([]));
  }, [catalogId]);

  // Expand/collapse the rubric panel for an assignment; lazily fetches the rubric the first time it is opened and loads it into the editable draft.
  const toggleRubric = async (assignmentId: number) => {
    if (rubricOpenId === assignmentId) { setRubricOpenId(null); return; }
    setRubricOpenId(assignmentId);
    if (rubrics[assignmentId] === undefined) {
      setRubricLoading(true);
      try {
        const rubric = await assignmentService.getRubric(courseId, assignmentId);
        setRubrics((prev) => ({ ...prev, [assignmentId]: rubric }));
        setRubricDraft(rubric?.criteria || []);
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not load the rubric.'));
      } finally {
        setRubricLoading(false);
      }
    } else {
      setRubricDraft(rubrics[assignmentId]?.criteria || []);
    }
  };

  // Ask the backend (AI) to draft a rubric for the assignment and load it into the draft editor.
  const handleGenerateRubric = async (assignmentId: number) => {
    setRubricGenerating(true);
    setError('');
    try {
      const rubric = await assignmentService.generateRubric(courseId, assignmentId);
      setRubrics((prev) => ({ ...prev, [assignmentId]: rubric }));
      setRubricDraft(rubric.criteria);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not generate a rubric. Is the AI grading service configured?'));
    } finally {
      setRubricGenerating(false);
    }
  };

  // Draft-rubric editing helpers: immutable updates to the rubricDraft array (criteria and their performance levels) before it is saved.
  const updateDraftCriterion = (index: number, patch: Partial<RubricCriterion>) => {
    setRubricDraft((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const addDraftCriterion = () => {
    setRubricDraft((prev) => [...prev, { title: '', description: '', max_points: 10, clo_id: null, levels: [] }]);
  };

  const removeDraftCriterion = (index: number) => {
    setRubricDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const updateDraftLevel = (criterionIndex: number, levelIndex: number, patch: Partial<RubricCriterion['levels'][number]>) => {
    setRubricDraft((prev) => prev.map((c, i) => (
      i === criterionIndex ? { ...c, levels: c.levels.map((lv, j) => (j === levelIndex ? { ...lv, ...patch } : lv)) } : c
    )));
  };

  const addDraftLevel = (criterionIndex: number) => {
    setRubricDraft((prev) => prev.map((c, i) => (
      i === criterionIndex ? { ...c, levels: [...c.levels, { label: '', points: 0, description: null }] } : c
    )));
  };

  const removeDraftLevel = (criterionIndex: number, levelIndex: number) => {
    setRubricDraft((prev) => prev.map((c, i) => (
      i === criterionIndex ? { ...c, levels: c.levels.filter((_, j) => j !== levelIndex) } : c
    )));
  };

  // Validate (at least one titled criterion) and publish the rubric draft to the backend, then refresh the local copy.
  const saveDraftRubric = async (assignmentId: number) => {
    const cleaned = rubricDraft.filter((c) => c.title.trim());
    if (cleaned.length === 0) {
      setError('A rubric needs at least one criterion with a title.');
      return;
    }
    setRubricSaving(true);
    setError('');
    try {
      const rubric = await assignmentService.saveRubric(courseId, assignmentId, cleaned, 'Published');
      setRubrics((prev) => ({ ...prev, [assignmentId]: rubric }));
      setRubricDraft(rubric.criteria);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the rubric.'));
    } finally {
      setRubricSaving(false);
    }
  };

  // Running total of criterion max points, shown next to the assignment's own points so the teacher can spot a mismatch.
  const rubricTotal = rubricDraft.reduce((sum, c) => sum + (Number(c.max_points) || 0), 0);

  // Fetch the course's assignments; "silent" mode (used by auto-refresh) skips the spinner and error message.
  const fetchItems = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await assignmentService.list(courseId);
      setItems(data);
    } catch (err) {
      if (!silent) setError(apiErrorMessage(err, 'Could not load the assignments.'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Initial load, and reload when the course changes.
  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // Poll periodically so new assignments/submissions appear without a manual refresh.
  useAutoRefresh(() => fetchItems(true));

  // Clear and close the new-assignment form.
  const resetComposer = () => {
    setTitle(''); setDescription(''); setDueDate(''); setPoints('');
    setSelectedDraftId(null); setShowComposer(false);
  };

  // Open the composer and load the generated assignments that have not been posted yet.
  const openComposer = async () => {
    setShowComposer(true);
    setDraftsLoading(true);
    try {
      const all = await contentGenerationService.list(courseId, 'assignment');
      setDrafts(all.filter((d) => d.assignment_id == null));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the generated assignments.'));
    } finally {
      setDraftsLoading(false);
    }
  };

  // Pick a generated assignment: prefill title, description and points (all still editable before posting).
  const selectDraft = (d: GeneratedContentItem) => {
    setSelectedDraftId(d.id);
    setTitle(d.payload?.title || d.title || '');
    setDescription(d.payload?.instructions || '');
    setPoints(d.payload?.points != null ? String(Math.round(d.payload.points)) : '');
  };

  // Post the selected generated assignment to students: the backend creates the assignment, its rubric and the Word handout attachment.
  const handlePost = async () => {
    if (selectedDraftId === null || !title.trim()) return;
    setPosting(true);
    setError('');
    try {
      await contentGenerationService.createAssignmentFromContent(courseId, selectedDraftId, {
        title: title.trim(),
        description: description.trim() || undefined,
        due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
        points: points ? parseInt(points) : undefined,
      });
      resetComposer();
      await fetchItems(true);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to post assignment.'));
    } finally {
      setPosting(false);
    }
  };

  // Edit flow: startEdit copies an assignment into the edit fields, cancelEdit closes the form, saveEdit sends the update and merges the result into the list.
  const startEdit = (item: AssignmentItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditDescription(item.description || '');
    setEditDueDate(item.due_date ? toDatetimeLocalValue(item.due_date) : '');
    setEditPoints(item.points !== null ? String(item.points) : '');
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: number) => {
    if (!editTitle.trim()) return;
    setSaving(true);
    try {
      const updated = await assignmentService.update(courseId, id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        due_date: editDueDate ? new Date(editDueDate).toISOString() : undefined,
        points: editPoints ? parseInt(editPoints) : undefined,
      });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, ...updated } : n)));
      setEditingId(null);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to update assignment.'));
    } finally {
      setSaving(false);
    }
  };

  // Delete an assignment after confirmation (its submissions are removed too by the backend).
  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this assignment? All student submissions will also be removed.')) return;
    try {
      await assignmentService.remove(courseId, id);
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete this assignment.'));
    }
  };

  // Teacher: expand/collapse an assignment's submissions, fetching them the first time.
  const toggleSubmissions = async (assignmentId: number) => {
    if (expandedId === assignmentId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(assignmentId);
    if (!submissions[assignmentId]) {
      try {
        const data = await assignmentService.listSubmissions(courseId, assignmentId);
        setSubmissions((prev) => ({ ...prev, [assignmentId]: data }));
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not load the submissions.'));
      }
    }
    // Class-wide misconceptions are best-effort extra context - never block the submissions list.
    assignmentService.listMisconceptions(courseId, assignmentId)
      .then((groups) => setClassMisconceptions((prev) => ({ ...prev, [assignmentId]: groups })))
      .catch(() => undefined);
  };

  // Teacher: re-run the similar-assignment check across all submissions of an assignment and refresh the list.
  const handleCheckSimilarity = async (assignmentId: number) => {
    setCheckingSimilarityId(assignmentId);
    setError('');
    try {
      const updated = await assignmentService.checkSimilarity(courseId, assignmentId);
      setSubmissions((prev) => ({ ...prev, [assignmentId]: updated }));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not run the similarity check.'));
    } finally {
      setCheckingSimilarityId(null);
    }
  };

  // Teacher: trigger AI grading of one submission and replace it in the cached list with the graded version.
  const handleGrade = async (assignmentId: number, submissionId: number) => {
    setGradingSubmissionId(submissionId);
    setError('');
    try {
      const updated = await assignmentService.gradeSubmission(courseId, assignmentId, submissionId);
      setSubmissions((prev) => ({
        ...prev,
        [assignmentId]: (prev[assignmentId] || []).map((s) => (s.id === submissionId ? updated : s)),
      }));
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to grade submission.'));
    } finally {
      setGradingSubmissionId(null);
    }
  };

  // Manual grading: startEditGrade opens the override form prefilled; saveGradeOverride saves the teacher's own grade + feedback.
  const startEditGrade = (sub: SubmissionItem) => {
    setEditingGradeId(sub.id);
    setEditGradeValue(sub.grade !== null ? String(sub.grade) : '');
    setEditFeedbackValue(sub.feedback || '');
  };

  const saveGradeOverride = async (assignmentId: number, submissionId: number) => {
    const grade = parseFloat(editGradeValue);
    if (isNaN(grade)) return;
    setSavingGrade(true);
    try {
      const updated = await assignmentService.overrideGrade(courseId, assignmentId, submissionId, {
        grade, feedback: editFeedbackValue,
      });
      setSubmissions((prev) => ({
        ...prev,
        [assignmentId]: (prev[assignmentId] || []).map((s) => (s.id === submissionId ? updated : s)),
      }));
      setEditingGradeId(null);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to save grade.'));
    } finally {
      setSavingGrade(false);
    }
  };

  // Teacher: approve an AI grade that is PendingReview, optionally sending rubric-level overrides chosen in the dropdowns.
  const handleApprove = async (assignmentId: number, submissionId: number) => {
    setApprovingId(submissionId);
    setError('');
    try {
      const overrides = levelOverrides[submissionId];
      const criterion_levels = overrides && Object.keys(overrides).length > 0
        ? Object.entries(overrides).map(([criterionId, levelId]) => ({ criterion_id: Number(criterionId), level_id: levelId }))
        : undefined;
      const updated = await assignmentService.approveGrade(
        courseId, assignmentId, submissionId, criterion_levels ? { criterion_levels } : undefined
      );
      setSubmissions((prev) => ({
        ...prev,
        [assignmentId]: (prev[assignmentId] || []).map((s) => (s.id === submissionId ? updated : s)),
      }));
      setLevelOverrides((prev) => {
        const next = { ...prev };
        delete next[submissionId];
        return next;
      });
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to approve grade.'));
    } finally {
      setApprovingId(null);
    }
  };

  // Teacher: reject an AI grade awaiting review.
  const handleReject = async (assignmentId: number, submissionId: number) => {
    setRejectingId(submissionId);
    setError('');
    try {
      const updated = await assignmentService.rejectGrade(courseId, assignmentId, submissionId);
      setSubmissions((prev) => ({
        ...prev,
        [assignmentId]: (prev[assignmentId] || []).map((s) => (s.id === submissionId ? updated : s)),
      }));
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to reject grade.'));
    } finally {
      setRejectingId(null);
    }
  };

  // Student: upload (or replace) their submission file and store the returned summary on the assignment.
  const handleSubmit = async (assignmentId: number, file: File) => {
    setSubmittingId(assignmentId);
    setError('');
    try {
      const summary = await assignmentService.submit(courseId, assignmentId, file);
      setItems((prev) => prev.map((n) => (n.id === assignmentId ? { ...n, my_submission: summary } : n)));
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to submit assignment.'));
    } finally {
      setSubmittingId(null);
    }
  };

  // Render: header + create button, error banner, teacher composer, then the list (loading / empty / items).
  return (
    <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
          <ClipboardList className="w-4.5 h-4.5 text-secondary" />
          Assignments
        </h3>
        {isTeacher && !showComposer && (
          <button onClick={openComposer} className="btn-primary text-xs px-3 py-1.5">
            + Create
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400 rounded-xl p-3 mb-4 text-xs">{error}</div>
      )}

      {isTeacher && showComposer && (
        <div className="border border-border rounded-xl p-4 mb-5 bg-background space-y-3">
          {/* Step 1: choose one of the assignments generated in Content Studio. */}
          <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Select a generated assignment</p>
          {draftsLoading ? (
            <p className="text-xs text-text-muted">Loading generated assignments...</p>
          ) : drafts.length === 0 ? (
            <div className="text-xs text-text-muted border border-dashed border-border rounded-lg p-3">
              No unposted generated assignments yet. Generate one in Content Studio (choose <strong>Assignment</strong>), then come back here to post it.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {drafts.map((d) => (
                <button
                  key={d.id}
                  onClick={() => selectDraft(d)}
                  className={`w-full text-left flex items-center gap-2 rounded-lg border px-3 py-2 transition-all ${
                    selectedDraftId === d.id ? 'border-primary bg-primary-muted/40' : 'border-border bg-surface hover:border-primary/40'
                  }`}
                >
                  <FileText className="w-4 h-4 text-secondary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{d.payload?.title || d.title}</p>
                    <p className="text-[11px] text-text-muted truncate">{d.concept_name} · {d.payload?.points ?? '-'} pts · {d.payload?.criteria?.length ?? 0} rubric criteria</p>
                  </div>
                  {selectedDraftId === d.id && <Check className="w-4 h-4 text-primary ml-auto shrink-0" />}
                </button>
              ))}
            </div>
          )}

          {/* Step 2: adjust what students see; the Word handout + rubric is attached automatically. */}
          {selectedDraftId !== null && (
            <>
              <input
                className="input-light w-full"
                placeholder="Assignment title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="input-light w-full resize-none"
                rows={3}
                placeholder="Description shown to students"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Due date (optional)</label>
                  <input
                    type="datetime-local"
                    className="input-light w-full text-sm"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Points</label>
                  <input
                    type="number" min="0"
                    className="input-light w-full text-sm"
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                  />
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-text-muted">
                <Paperclip className="w-3.5 h-3.5" />
                The assignment handout and detailed rubric will be attached as a Word document for students.
              </p>
            </>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={resetComposer} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
            <button
              onClick={handlePost}
              disabled={posting || selectedDraftId === null || !title.trim()}
              className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50"
            >
              {posting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Post Assignment
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-sm text-text-muted">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
          <EmptyStateIllustration className="w-28 h-28 mx-auto mb-2" />
          No assignments posted yet.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isEditing = editingId === item.id;
            const badge = dueBadge(item.due_date, !!item.my_submission);
            const isExpanded = expandedId === item.id;

            return (
              <div key={item.id} className="border border-border rounded-xl p-4">
                {isEditing ? (
                  <div className="space-y-2">
                    <input className="input-light w-full text-sm" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                    <textarea className="input-light w-full resize-none text-sm" rows={2} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="datetime-local" className="input-light w-full text-sm" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
                      <input type="number" min="0" className="input-light w-full text-sm" value={editPoints} onChange={(e) => setEditPoints(e.target.value)} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={cancelEdit} className="btn-ghost text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
                      <button onClick={() => saveEdit(item.id)} disabled={saving} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
                        <Check className="w-3.5 h-3.5" /> Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-text-primary">{item.title}</p>
                        {item.description && <p className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">{item.description}</p>}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {badge && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-bold border ${badge.className}`}>
                              <Clock className="w-3 h-3" /> {badge.label}
                            </span>
                          )}
                          {item.points !== null && (
                            <span className="text-[12px] font-bold text-text-muted">{item.points} pts</span>
                          )}
                          {item.attachment_filename && (
                            <button
                              onClick={() => downloadAuthenticated(assignmentService.downloadAttachmentUrl(courseId, item.id), item.attachment_filename!)}
                              className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
                            >
                              <Paperclip className="w-3 h-3" /> {item.attachment_filename}
                            </button>
                          )}
                        </div>
                      </div>
                      {isTeacher && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => startEdit(item)} className="p-1 text-text-muted hover:text-primary rounded transition-all" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(item.id)} className="p-1 text-text-muted hover:text-rose-500 rounded transition-all" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Teacher sees submission/rubric toggles; student sees their submission status, feedback and upload control. */}
                    {isTeacher ? (
                      <div className="flex items-center gap-4 mt-3">
                        <button
                          onClick={() => toggleSubmissions(item.id)}
                          className="flex items-center gap-1 text-xs font-semibold text-secondary hover:underline"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {item.submission_count ?? 0} submission{item.submission_count === 1 ? '' : 's'}
                        </button>
                        <button
                          onClick={() => toggleRubric(item.id)}
                          className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        >
                          <ListChecks className="w-3.5 h-3.5" />
                          {rubricOpenId === item.id ? 'Hide rubric' : 'Rubric'}
                          {rubrics[item.id] && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3">
                        {item.my_submission ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20 rounded-lg px-3 py-2">
                              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Submitted {item.my_submission.is_late ? '(late)' : ''} — {item.my_submission.file_filename}
                                {item.my_submission.grade !== null && ` · Grade: ${Math.round(item.my_submission.grade)}/100`}
                                {item.my_submission.grade_status === 'PendingReview' && ' · Grading in review'}
                              </span>
                              <label className="text-xs font-semibold text-primary hover:underline cursor-pointer">
                                Resubmit
                                <input
                                  type="file" className="hidden"
                                  disabled={submittingId === item.id}
                                  onChange={(e) => e.target.files?.[0] && handleSubmit(item.id, e.target.files[0])}
                                />
                              </label>
                            </div>
                            {item.my_submission.feedback && (
                              <div>
                                <button
                                  onClick={() => setFeedbackOpenId(feedbackOpenId === item.my_submission!.id ? null : item.my_submission!.id)}
                                  className="flex items-center gap-1 text-[12px] font-semibold text-secondary hover:underline"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  {feedbackOpenId === item.my_submission.id ? 'Hide feedback' : 'View feedback'}
                                </button>
                                {feedbackOpenId === item.my_submission.id && (
                                  <div className="mt-1.5 bg-background border border-border rounded-lg p-3 text-xs text-text-secondary whitespace-pre-wrap">
                                    {item.my_submission.feedback}
                                  </div>
                                )}
                                {feedbackOpenId === item.my_submission.id && <MisconceptionList items={item.my_submission.misconceptions} audience="student" />}
                              </div>
                            )}
                          </div>
                        ) : (
                          <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-2.5 text-xs font-semibold text-text-secondary hover:border-primary/40 hover:bg-primary-muted/30 cursor-pointer transition-all">
                            {submittingId === item.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            Submit your work
                            <input
                              type="file" className="hidden"
                              disabled={submittingId === item.id}
                              onChange={(e) => e.target.files?.[0] && handleSubmit(item.id, e.target.files[0])}
                            />
                          </label>
                        )}
                      </div>
                    )}

                    {isTeacher && rubricOpenId === item.id && (
                      <div className="mt-3 border-t border-border pt-3 space-y-3">
                        <p className="text-[11px] text-text-muted">
                          One shared rubric grades every student's submission to this assignment - editing it here
                          changes how the whole class is graded, not just one student.
                        </p>
                        {rubricLoading ? (
                          <p className="text-xs text-text-muted">Loading rubric...</p>
                        ) : (
                          <>
                            {rubricDraft.length === 0 ? (
                              <button
                                onClick={() => handleGenerateRubric(item.id)}
                                disabled={rubricGenerating}
                                className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                              >
                                {rubricGenerating
                                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  : <Sparkles className="w-3.5 h-3.5" />}
                                Generate rubric with AI
                              </button>
                            ) : (
                              <div className="space-y-2">
                                {rubricDraft.map((c, i) => (
                                  <div key={c.id ?? `new-${i}`} className="bg-background border border-border rounded-lg p-2.5 space-y-1.5">
                                    <div className="flex items-center gap-2">
                                      <input
                                        className="input-light flex-1 text-xs py-1"
                                        placeholder="Criterion title"
                                        value={c.title}
                                        onChange={(e) => updateDraftCriterion(i, { title: e.target.value })}
                                      />
                                      <input
                                        type="number" min="0"
                                        className="input-light w-16 text-xs py-1"
                                        value={c.max_points}
                                        onChange={(e) => updateDraftCriterion(i, { max_points: parseFloat(e.target.value) || 0 })}
                                      />
                                      <button onClick={() => removeDraftCriterion(i)} className="p-1 text-text-muted hover:text-rose-500" title="Remove criterion">
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                    <textarea
                                      className="input-light w-full resize-none text-xs"
                                      rows={1}
                                      placeholder="What earns full marks (optional)"
                                      value={c.description || ''}
                                      onChange={(e) => updateDraftCriterion(i, { description: e.target.value })}
                                    />
                                    {clos.length > 0 && (
                                      <div className="flex items-center gap-1.5">
                                        <Target className="w-3 h-3 text-text-muted shrink-0" />
                                        <select
                                          className="input-light text-xs py-1"
                                          value={c.clo_id ?? ''}
                                          onChange={(e) => updateDraftCriterion(i, { clo_id: e.target.value ? Number(e.target.value) : null })}
                                        >
                                          <option value="">No CLO link</option>
                                          {clos.map((clo) => (
                                            <option key={clo.id} value={clo.id}>{clo.code} — {clo.title}</option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                    <div className="pl-2 border-l-2 border-border space-y-1">
                                      {c.levels.map((lv, li) => (
                                        <div key={li} className="flex items-center gap-1.5">
                                          <input
                                            className="input-light flex-1 text-[11px] py-0.5"
                                            placeholder="Level label (e.g. Excellent)"
                                            value={lv.label}
                                            onChange={(e) => updateDraftLevel(i, li, { label: e.target.value })}
                                          />
                                          <input
                                            type="number" min="0" max={c.max_points}
                                            className="input-light w-14 text-[11px] py-0.5"
                                            value={lv.points}
                                            onChange={(e) => updateDraftLevel(i, li, { points: parseFloat(e.target.value) || 0 })}
                                          />
                                          <button onClick={() => removeDraftLevel(i, li)} className="p-0.5 text-text-muted hover:text-rose-500" title="Remove level">
                                            <X className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ))}
                                      <button onClick={() => addDraftLevel(i)} className="flex items-center gap-1 text-[11px] font-semibold text-secondary hover:underline">
                                        <Plus className="w-3 h-3" /> Add performance level
                                      </button>
                                    </div>
                                  </div>
                                ))}
                                <div className="flex items-center justify-between">
                                  <button onClick={addDraftCriterion} className="flex items-center gap-1 text-[12px] font-semibold text-secondary hover:underline">
                                    <Plus className="w-3.5 h-3.5" /> Add criterion
                                  </button>
                                  <span className={`text-[12px] font-bold ${rubricTotal === (item.points || rubricTotal) ? 'text-text-muted' : 'text-amber-600 dark:text-amber-400'}`}>
                                    Total: {rubricTotal} pts{item.points ? ` (assignment worth ${item.points})` : ''}
                                  </span>
                                </div>
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => handleGenerateRubric(item.id)}
                                    disabled={rubricGenerating}
                                    className="btn-ghost text-[12px] px-2.5 py-1 disabled:opacity-50"
                                  >
                                    {rubricGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                    Regenerate
                                  </button>
                                  <button
                                    onClick={() => saveDraftRubric(item.id)}
                                    disabled={rubricSaving}
                                    className="btn-primary text-[12px] px-2.5 py-1 disabled:opacity-50"
                                  >
                                    {rubricSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    Save rubric
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {isTeacher && isExpanded && (
                      <div className="mt-3 border-t border-border pt-3 space-y-2">
                        {!submissions[item.id] ? (
                          <p className="text-xs text-text-muted">Loading submissions...</p>
                        ) : submissions[item.id].length === 0 ? (
                          <div className="text-xs text-text-muted text-center py-2">
                            <EmptyStateIllustration className="w-14 h-14 mx-auto mb-1" />
                            No submissions yet.
                          </div>
                        ) : (
                          <>
                          {/* Class-wide misconceptions (AI) and the similar-assignment re-check control. */}
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">{submissions[item.id].length} submission(s)</p>
                            <button
                              onClick={() => handleCheckSimilarity(item.id)}
                              disabled={checkingSimilarityId === item.id}
                              className="flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline disabled:opacity-50"
                              title="Compare all submissions for copied wording"
                            >
                              {checkingSimilarityId === item.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                              Check similarity
                            </button>
                          </div>
                          {(classMisconceptions[item.id] || []).length > 0 && (
                            <div className="bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 rounded-lg p-2.5 space-y-1">
                              <p className="flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                                <Lightbulb className="w-3.5 h-3.5" /> Common misconceptions in this class
                              </p>
                              {classMisconceptions[item.id].map((g) => (
                                <p key={g.concept_name} className="text-[12px] text-text-secondary">
                                  <span className="font-semibold text-text-primary">{g.concept_name}</span> — {g.count} student{g.count === 1 ? '' : 's'}: {g.examples[0]?.misconception}
                                </p>
                              ))}
                            </div>
                          )}
                          {submissions[item.id].map((sub) => (
                            <div key={sub.id} className="bg-background rounded-lg px-3 py-2 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-text-primary truncate">{sub.student_name}</p>
                                  <p className="text-[11px] text-text-muted truncate">
                                    {sub.file_filename} {sub.is_late && <span className="text-rose-500 dark:text-rose-400 font-bold">· LATE</span>}
                                    {sub.grade !== null && <span className="ml-1.5 font-bold text-secondary">· {Math.round(sub.grade)}/100</span>}
                                    {sub.grade_status === 'PendingReview' && (
                                      <span className="ml-1.5 font-bold text-amber-600 dark:text-amber-400">· Pending review</span>
                                    )}
                                  </p>
                                  <SimilarityBadge report={sub.similarity} />
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => handleGrade(item.id, sub.id)}
                                    disabled={gradingSubmissionId === sub.id}
                                    className="flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline disabled:opacity-50"
                                    title="Grade with AI"
                                  >
                                    {gradingSubmissionId === sub.id
                                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      : <Sparkles className="w-3.5 h-3.5" />}
                                    {sub.grade !== null ? 'Re-grade' : 'Grade'}
                                  </button>
                                  <button
                                    onClick={() => downloadAuthenticated(assignmentService.downloadSubmissionUrl(courseId, item.id, sub.id), sub.file_filename)}
                                    className="p-1.5 text-text-muted hover:text-primary hover:bg-primary-muted rounded-lg transition-all"
                                    title="Download submission"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {sub.feedback && editingGradeId !== sub.id && (
                                <div className="bg-surface border border-border rounded-lg p-2.5 text-[12px] text-text-secondary whitespace-pre-wrap">
                                  {sub.feedback}
                                </div>
                              )}
                              {editingGradeId !== sub.id && <MisconceptionList items={sub.misconceptions} audience="teacher" />}

                              {sub.grade_status === 'PendingReview' && editingGradeId !== sub.id && (
                                <div className="space-y-1.5">
                                  {sub.rubric_scores?.map((cs) => {
                                    const criterion = rubrics[item.id]?.criteria.find((c) => c.id === cs.criterion_id);
                                    if (!criterion || criterion.levels.length === 0) return null;
                                    const currentLevelId = levelOverrides[sub.id]?.[cs.criterion_id] ?? cs.level_id ?? '';
                                    return (
                                      <div key={cs.criterion_id} className="flex items-center justify-between gap-2 text-[11px]">
                                        <span className="text-text-muted truncate">{cs.title}</span>
                                        <select
                                          className="input-light text-[11px] py-0.5 shrink-0"
                                          value={currentLevelId}
                                          onChange={(e) => {
                                            const levelId = Number(e.target.value);
                                            setLevelOverrides((prev) => ({
                                              ...prev,
                                              [sub.id]: { ...(prev[sub.id] || {}), [cs.criterion_id]: levelId },
                                            }));
                                          }}
                                        >
                                          {criterion.levels.map((lv) => (
                                            <option key={lv.id} value={lv.id}>{lv.label} ({lv.points}pts)</option>
                                          ))}
                                        </select>
                                      </div>
                                    );
                                  })}
                                  <div className="flex justify-end gap-2">
                                    <button
                                      onClick={() => handleReject(item.id, sub.id)}
                                      disabled={rejectingId === sub.id || approvingId === sub.id}
                                      className="btn-ghost text-[12px] px-2.5 py-1 disabled:opacity-50"
                                    >
                                      Reject
                                    </button>
                                    <button
                                      onClick={() => handleApprove(item.id, sub.id)}
                                      disabled={approvingId === sub.id || rejectingId === sub.id}
                                      className="btn-primary text-[12px] px-2.5 py-1 disabled:opacity-50"
                                    >
                                      {approvingId === sub.id ? 'Approving...' : 'Approve grade'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {editingGradeId === sub.id ? (
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-2">
                                    <label className="text-[11px] font-semibold text-text-muted">Grade (0-100)</label>
                                    <input
                                      type="number" min="0" max="100"
                                      className="input-light w-20 text-xs py-1"
                                      value={editGradeValue}
                                      onChange={(e) => setEditGradeValue(e.target.value)}
                                    />
                                  </div>
                                  <textarea
                                    className="input-light w-full resize-none text-xs"
                                    rows={3}
                                    placeholder="Feedback"
                                    value={editFeedbackValue}
                                    onChange={(e) => setEditFeedbackValue(e.target.value)}
                                  />
                                  <div className="flex justify-end gap-2">
                                    <button onClick={() => setEditingGradeId(null)} className="btn-ghost text-[12px] px-2.5 py-1">Cancel</button>
                                    <button
                                      onClick={() => saveGradeOverride(item.id, sub.id)}
                                      disabled={savingGrade}
                                      className="btn-primary text-[12px] px-2.5 py-1 disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => startEditGrade(sub)}
                                  className="flex items-center gap-1 text-[12px] font-semibold text-text-muted hover:text-secondary"
                                >
                                  <Pencil className="w-3 h-3" /> {sub.grade !== null ? 'Edit grade manually' : 'Enter grade manually'}
                                </button>
                              )}
                            </div>
                          ))}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
