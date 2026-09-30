// Purpose: lets a teacher hand-edit AI-generated content (flashcards, quizzes, study guides) and save it back via the API.
import React, { useState } from 'react';
import {
  ArrowLeft, Save, RefreshCw, Plus, Trash2, AlertTriangle, Check, Info, X,
} from 'lucide-react';
import { contentGenerationService } from '../../services/api';
import type { GeneratedContentItem } from '../../services/api';
import { apiErrorMessage } from '../../lib/apiError';

// Props: course id, the content item being edited, and cancel / saved callbacks.
interface ContentEditorProps {
  courseId: number;
  item: GeneratedContentItem;
  onCancel: () => void;
  onSaved: (updated: GeneratedContentItem) => void;
}

/**
 * Hand-editing for every generated content type.
 *
 * The PATCH endpoint has existed since the module was written, but nothing exposed
 * it - so the only correction available to a teacher was delete-and-regenerate, which
 * costs tokens and rerolls everything that was already fine. This is the fix for the
 * common case: one wrong MCQ answer, one clumsy flashcard, one missing key point.
 *
 * Validation mirrors the backend's Pydantic rules (a question needs 2-5 non-empty
 * options and a correct answer among them) so a teacher is told what is wrong here
 * rather than getting a 422 from the save.
 */
// Kept in step with MCQOut in backend/app/content_generation/schemas.py.
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

export const ContentEditor: React.FC<ContentEditorProps> = ({ courseId, item, onCancel, onSaved }) => {
  // Editable copy of the title; payload (below) is an editable copy of the content body; saving/error track the save request.
  const [title, setTitle] = useState(item.title);
  // Deep-cloned so abandoning the edit cannot mutate the list behind it.
  const [payload, setPayload] = useState<any>(() => JSON.parse(JSON.stringify(item.payload || {})));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Which editor section to show, based on the item's content type (anything that is not flashcard/study guide is a quiz).
  const isFlash = item.content_type === 'flashcard';
  const isGuide = item.content_type === 'study_guide';
  const isQuiz = !isFlash && !isGuide;

  // Checks the edited content against the same rules as the backend; returns an error message, or null if valid.
  const validate = (): string | null => {
    if (!title.trim()) return 'The title cannot be empty.';
    if (isFlash) {
      const cards = payload.cards || [];
      if (!cards.length) return 'A flashcard set needs at least one card.';
      if (cards.some((c: any) => !c.front?.trim() || !c.back?.trim()))
        return 'Every card needs both a front and a back.';
    }
    if (isQuiz) {
      const qs = payload.questions || [];
      if (!qs.length) return 'A quiz needs at least one question.';
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i];
        if (!q.question?.trim()) return `Question ${i + 1} has no text.`;
        const opts = q.options || [];
        // 2 to 5, matching MCQOut in the backend schema: a true/false question is two
        // options, and pinning this at four made those impossible to edit at all.
        if (opts.length < MIN_OPTIONS || opts.length > MAX_OPTIONS)
          return `Question ${i + 1} must have between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.`;
        if (opts.some((o: string) => !o?.trim())) return `Question ${i + 1} has an empty option.`;
        if (typeof q.correct_index !== 'number' || q.correct_index < 0 || q.correct_index >= opts.length)
          return `Question ${i + 1} has no correct answer marked.`;
      }
    }
    if (isGuide) {
      if (!payload.summary?.trim()) return 'The study guide needs a summary.';
      if ((payload.key_points || []).some((p: string) => !p?.trim()))
        return 'Remove or fill in the empty key points.';
    }
    return null;
  };

  // Validates, then sends the changes to the server and hands the updated item back to the parent.
  const save = async () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      onSaved(await contentGenerationService.edit(courseId, item.id, { title: title.trim(), payload }));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save your changes.'));
    } finally {
      setSaving(false);
    }
  };

  // Immutable-update helper: clones the payload, lets `fn` modify the clone, then stores it so React re-renders.
  const set = (fn: (draft: any) => void) => {
    setPayload((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onCancel} className="btn-ghost text-xs px-3 py-1.5">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to library
        </button>
        <button onClick={save} disabled={saving} className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save changes
        </button>
      </div>

      {/* Validation / save error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}
        </div>
      )}

      {/* Warning: editing an approved item changes what students see immediately. */}
      {item.status === 'Approved' && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-300 rounded-xl p-3 flex items-start gap-2.5 text-xs">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          This item is already live for students. Your edits take effect immediately —
          anyone part-way through it will see the change.
        </div>
      )}

      <div className="glass-panel rounded-2xl p-6 border border-border shadow-card space-y-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Title</label>
          <input className="input-light w-full text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {/* ── flashcards ── */}
        {isFlash && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-secondary">
                Cards ({(payload.cards || []).length})
              </label>
              <button
                onClick={() => set((d) => { d.cards = [...(d.cards || []), { front: '', back: '' }]; })}
                className="btn-ghost text-xs px-2.5 py-1"
              >
                <Plus className="w-3.5 h-3.5" />Add card
              </button>
            </div>
            {(payload.cards || []).map((c: any, i: number) => (
              <div key={i} className="border border-border rounded-xl p-3 bg-background space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-text-muted uppercase tracking-wide">Card {i + 1}</span>
                  <button
                    onClick={() => set((d) => { d.cards.splice(i, 1); })}
                    className="p-1 text-text-muted hover:text-rose-500 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  className="input-light w-full text-xs" placeholder="Front (the prompt)"
                  value={c.front || ''}
                  onChange={(e) => set((d) => { d.cards[i].front = e.target.value; })}
                />
                <textarea
                  className="input-light w-full text-xs" rows={2} placeholder="Back (the answer)"
                  value={c.back || ''}
                  onChange={(e) => set((d) => { d.cards[i].back = e.target.value; })}
                />
              </div>
            ))}
          </div>
        )}

        {/* ── quizzes / MCQs ── */}
        {isQuiz && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-secondary">
                Questions ({(payload.questions || []).length})
              </label>
              <button
                onClick={() => set((d) => {
                  d.questions = [...(d.questions || []),
                    { question: '', options: ['', '', '', ''], correct_index: 0, explanation: '' }];
                })}
                className="btn-ghost text-xs px-2.5 py-1"
              >
                <Plus className="w-3.5 h-3.5" />Add question
              </button>
            </div>
            {(payload.questions || []).map((q: any, qi: number) => (
              <div key={qi} className="border border-border rounded-xl p-3 bg-background space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-text-muted uppercase tracking-wide">Question {qi + 1}</span>
                  <button
                    onClick={() => set((d) => { d.questions.splice(qi, 1); })}
                    className="p-1 text-text-muted hover:text-rose-500 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <textarea
                  className="input-light w-full text-xs" rows={2} placeholder="Question text"
                  value={q.question || ''}
                  onChange={(e) => set((d) => { d.questions[qi].question = e.target.value; })}
                />
                <p className="text-[11px] text-text-muted">
                  Click the circle to mark the correct answer. {MIN_OPTIONS} to {MAX_OPTIONS} options
                  — use two for a true/false question.
                </p>
                {(q.options || []).map((opt: string, oi: number) => (
                  <div key={oi} className="flex items-center gap-2">
                    <button
                      onClick={() => set((d) => { d.questions[qi].correct_index = oi; })}
                      className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                        q.correct_index === oi
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-border hover:border-emerald-400'
                      }`}
                      title="Mark as the correct answer"
                    >
                      {q.correct_index === oi && <Check className="w-3 h-3" />}
                    </button>
                    <input
                      className="input-light flex-1 text-xs"
                      placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                      value={opt || ''}
                      onChange={(e) => set((d) => { d.questions[qi].options[oi] = e.target.value; })}
                    />
                    <button
                      onClick={() => set((d) => {
                        d.questions[qi].options.splice(oi, 1);
                        // The correct answer moves with the list: deleting an option
                        // above the marked one would otherwise silently re-point the
                        // answer at whatever slid into its place.
                        const ci = d.questions[qi].correct_index;
                        if (ci === oi) d.questions[qi].correct_index = 0;
                        else if (ci > oi) d.questions[qi].correct_index = ci - 1;
                      })}
                      disabled={(q.options || []).length <= MIN_OPTIONS}
                      className="p-1 text-text-muted hover:text-rose-500 rounded shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={(q.options || []).length <= MIN_OPTIONS
                        ? `A question needs at least ${MIN_OPTIONS} options`
                        : 'Remove this option'}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {(q.options || []).length < MAX_OPTIONS && (
                  <button
                    onClick={() => set((d) => { d.questions[qi].options = [...(d.questions[qi].options || []), '']; })}
                    className="btn-ghost text-[11px] px-2 py-1"
                  >
                    <Plus className="w-3 h-3" />Add option
                  </button>
                )}
                <textarea
                  className="input-light w-full text-xs" rows={2}
                  placeholder="Explanation shown after answering"
                  value={q.explanation || ''}
                  onChange={(e) => set((d) => { d.questions[qi].explanation = e.target.value; })}
                />
              </div>
            ))}
          </div>
        )}

        {/* ── study guide ── */}
        {isGuide && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Summary</label>
              <textarea
                className="input-light w-full text-sm" rows={3}
                value={payload.summary || ''}
                onChange={(e) => set((d) => { d.summary = e.target.value; })}
              />
            </div>

            <ListEditor
              label="Key points"
              items={payload.key_points || []}
              onAdd={() => set((d) => { d.key_points = [...(d.key_points || []), '']; })}
              onChange={(i, v) => set((d) => { d.key_points[i] = v; })}
              onRemove={(i) => set((d) => { d.key_points.splice(i, 1); })}
            />

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                Worked example <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <textarea
                className="input-light w-full text-xs font-mono" rows={4}
                value={payload.worked_example || ''}
                onChange={(e) => set((d) => { d.worked_example = e.target.value; })}
              />
            </div>

            <ListEditor
              label="Common mistakes"
              items={payload.common_mistakes || []}
              onAdd={() => set((d) => { d.common_mistakes = [...(d.common_mistakes || []), '']; })}
              onChange={(i, v) => set((d) => { d.common_mistakes[i] = v; })}
              onRemove={(i) => set((d) => { d.common_mistakes.splice(i, 1); })}
            />

            <ListEditor
              label="Formulae"
              items={payload.formulae || []}
              mono
              onAdd={() => set((d) => { d.formulae = [...(d.formulae || []), '']; })}
              onChange={(i, v) => set((d) => { d.formulae[i] = v; })}
              onRemove={(i) => set((d) => { d.formulae.splice(i, 1); })}
            />

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                How this connects <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <textarea
                className="input-light w-full text-xs" rows={2}
                value={payload.connections || ''}
                onChange={(e) => set((d) => { d.connections = e.target.value; })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save changes
        </button>
      </div>
    </div>
  );
};

// Reusable editor for a list of text entries (key points, mistakes, formulae) with add / edit / remove controls.
// `mono` switches to a monospace single-line style for formulae.
const ListEditor: React.FC<{
  label: string; items: string[]; mono?: boolean;
  onAdd: () => void; onChange: (i: number, v: string) => void; onRemove: (i: number) => void;
}> = ({ label, items, mono, onAdd, onChange, onRemove }) => (
  <div>
    <div className="flex items-center justify-between mb-1.5">
      <label className="text-xs font-semibold text-text-secondary">
        {label} <span className="text-text-muted font-normal">({items.length})</span>
      </label>
      <button onClick={onAdd} className="btn-ghost text-xs px-2 py-1">
        <Plus className="w-3.5 h-3.5" />Add
      </button>
    </div>
    {items.length === 0 ? (
      <p className="text-[12px] text-text-muted border border-dashed border-border rounded-lg p-2.5">None yet.</p>
    ) : (
      <div className="space-y-1.5">
        {items.map((v, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-[11px] text-text-muted w-4 pt-2 shrink-0">{i + 1}</span>
            <textarea
              className={`input-light flex-1 text-xs ${mono ? 'font-mono' : ''}`}
              rows={mono ? 1 : 2}
              value={v}
              onChange={(e) => onChange(i, e.target.value)}
            />
            <button onClick={() => onRemove(i)} className="p-1 mt-1 text-text-muted hover:text-rose-500 rounded shrink-0">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default ContentEditor;
