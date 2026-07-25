import React, { useEffect, useState } from 'react';
import {
  ClipboardList, Send, Pencil, Trash2, X, Check, RefreshCw, Paperclip,
  Upload, Download, ChevronDown, ChevronUp, Clock, CheckCircle2,
} from 'lucide-react';
import { assignmentService } from '../services/api';
import type { AssignmentItem, SubmissionItem } from '../services/api';
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

interface AssignmentsProps {
  courseId: number;
  isTeacher: boolean;
}

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

export const Assignments: React.FC<AssignmentsProps> = ({ courseId, isTeacher }) => {
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showComposer, setShowComposer] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [points, setPoints] = useState('');
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editPoints, setEditPoints] = useState('');
  const [saving, setSaving] = useState(false);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [submissions, setSubmissions] = useState<Record<number, SubmissionItem[]>>({});
  const [submittingId, setSubmittingId] = useState<number | null>(null);

  const fetchItems = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await assignmentService.list(courseId);
      setItems(data);
    } catch {
      if (!silent) setError('Failed to load assignments.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  useAutoRefresh(() => fetchItems(true));

  const resetComposer = () => {
    setTitle(''); setDescription(''); setDueDate(''); setPoints(''); setAttachFile(null); setShowComposer(false);
  };

  const handlePost = async () => {
    if (!title.trim()) return;
    setPosting(true);
    setError('');
    try {
      const created = await assignmentService.create(courseId, {
        title: title.trim(),
        description: description.trim() || undefined,
        due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
        points: points ? parseInt(points) : undefined,
        file: attachFile || undefined,
      });
      setItems((prev) => [created, ...prev]);
      resetComposer();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to post assignment.');
    } finally {
      setPosting(false);
    }
  };

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
      setError(err.response?.data?.detail || 'Failed to update assignment.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this assignment? All student submissions will also be removed.')) return;
    try {
      await assignmentService.remove(courseId, id);
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch {
      setError('Failed to delete assignment.');
    }
  };

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
      } catch {
        setError('Failed to load submissions.');
      }
    }
  };

  const handleSubmit = async (assignmentId: number, file: File) => {
    setSubmittingId(assignmentId);
    setError('');
    try {
      const summary = await assignmentService.submit(courseId, assignmentId, file);
      setItems((prev) => prev.map((n) => (n.id === assignmentId ? { ...n, my_submission: summary } : n)));
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to submit assignment.');
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
          <ClipboardList className="w-4.5 h-4.5 text-secondary" />
          Assignments
        </h3>
        {isTeacher && !showComposer && (
          <button onClick={() => setShowComposer(true)} className="btn-primary text-xs px-3 py-1.5">
            + Create
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400 rounded-xl p-3 mb-4 text-xs">{error}</div>
      )}

      {isTeacher && showComposer && (
        <div className="border border-border rounded-xl p-4 mb-5 bg-background space-y-3">
          <input
            className="input-light w-full"
            placeholder="Assignment title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="input-light w-full resize-none"
            rows={2}
            placeholder="Instructions (optional)"
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
              <label className="block text-xs font-semibold text-text-secondary mb-1">Points (optional)</label>
              <input
                type="number" min="0"
                className="input-light w-full text-sm"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-primary cursor-pointer">
              <Paperclip className="w-3.5 h-3.5" />
              {attachFile ? attachFile.name : 'Attach reference file (optional)'}
              <input type="file" className="hidden" onChange={(e) => setAttachFile(e.target.files?.[0] || null)} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={resetComposer} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
            <button
              onClick={handlePost}
              disabled={posting || !title.trim()}
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
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${badge.className}`}>
                              <Clock className="w-3 h-3" /> {badge.label}
                            </span>
                          )}
                          {item.points !== null && (
                            <span className="text-[11px] font-bold text-text-muted">{item.points} pts</span>
                          )}
                          {item.attachment_filename && (
                            <button
                              onClick={() => downloadAuthenticated(assignmentService.downloadAttachmentUrl(courseId, item.id), item.attachment_filename!)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
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

                    {isTeacher ? (
                      <button
                        onClick={() => toggleSubmissions(item.id)}
                        className="flex items-center gap-1 text-xs font-semibold text-secondary mt-3 hover:underline"
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {item.submission_count ?? 0} submission{item.submission_count === 1 ? '' : 's'}
                      </button>
                    ) : (
                      <div className="mt-3">
                        {item.my_submission ? (
                          <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20 rounded-lg px-3 py-2">
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Submitted {item.my_submission.is_late ? '(late)' : ''} — {item.my_submission.file_filename}
                              {item.my_submission.grade !== null && ` · Grade: ${item.my_submission.grade}`}
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

                    {isTeacher && isExpanded && (
                      <div className="mt-3 border-t border-border pt-3 space-y-2">
                        {!submissions[item.id] ? (
                          <p className="text-xs text-text-muted">Loading submissions...</p>
                        ) : submissions[item.id].length === 0 ? (
                          <p className="text-xs text-text-muted">No submissions yet.</p>
                        ) : (
                          submissions[item.id].map((sub) => (
                            <div key={sub.id} className="flex items-center justify-between gap-2 bg-background rounded-lg px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-text-primary truncate">{sub.student_name}</p>
                                <p className="text-[10px] text-text-muted truncate">
                                  {sub.file_filename} {sub.is_late && <span className="text-rose-500 dark:text-rose-400 font-bold">· LATE</span>}
                                </p>
                              </div>
                              <button
                                onClick={() => downloadAuthenticated(assignmentService.downloadSubmissionUrl(courseId, item.id, sub.id), sub.file_filename)}
                                className="p-1.5 text-text-muted hover:text-primary hover:bg-primary-muted rounded-lg transition-all shrink-0"
                                title="Download submission"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
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
