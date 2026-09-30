import React, { useEffect, useState } from 'react';
import {
  Megaphone, Send, Pencil, Trash2, X, Check, RefreshCw, User,
  ClipboardList, FolderOpen, Video, Paperclip, Download, Link as LinkIcon, Clock,
} from 'lucide-react';
import { announcementService, materialService, meetingService, streamService } from '../services/api';
import type { StreamItem } from '../services/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { timeAgo, parseUtc } from '../lib/time';
import { downloadAuthenticated } from '../lib/download';
import { EmptyStateIllustration } from './illustrations';
import { apiErrorMessage } from '../lib/apiError';

interface ClassStreamProps {
  courseId: number;
  isTeacher: boolean;
}

type ComposerKind = 'announcement' | 'material' | 'meeting' | null;

const POST_TYPE_META: Record<string, { label: string; icon: React.ElementType; badgeClass: string }> = {
  announcement: { label: 'Announcement', icon: Megaphone, badgeClass: 'bg-primary-muted text-primary border-primary/20' },
  assignment: { label: 'Assignment', icon: ClipboardList, badgeClass: 'bg-secondary-muted text-secondary border-secondary/20' },
  material: { label: 'Material', icon: FolderOpen, badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20' },
  meeting: { label: 'Meeting', icon: Video, badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' },
};

export const ClassStream: React.FC<ClassStreamProps> = ({ courseId, isTeacher }) => {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Announcement composer (kept as the default, always-visible composer)
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // Material/Meeting composer (teacher-only, toggled via tabs)
  const [composerKind, setComposerKind] = useState<ComposerKind>(null);
  const [matTitle, setMatTitle] = useState('');
  const [matDescription, setMatDescription] = useState('');
  const [matLink, setMatLink] = useState('');
  const [matFile, setMatFile] = useState<File | null>(null);
  const [mtgTitle, setMtgTitle] = useState('');
  const [mtgDescription, setMtgDescription] = useState('');
  const [mtgLink, setMtgLink] = useState('');
  const [mtgScheduledAt, setMtgScheduledAt] = useState('');
  const [mtgDuration, setMtgDuration] = useState('');
  const [composerPosting, setComposerPosting] = useState(false);

  const fetchItems = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await streamService.list(courseId);
      setItems(data);
    } catch (err) {
      if (!silent) setError(apiErrorMessage(err, 'Could not load the class stream.'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  useAutoRefresh(() => fetchItems(true));

  const handlePost = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    setError('');
    try {
      await announcementService.create(courseId, draft.trim());
      setDraft('');
      fetchItems();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to post announcement.'));
    } finally {
      setPosting(false);
    }
  };

  const startEdit = (item: StreamItem) => {
    setEditingId(item.id);
    setEditDraft(item.content || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
  };

  const saveEdit = async (id: number) => {
    if (!editDraft.trim()) return;
    setSaving(true);
    try {
      await announcementService.update(courseId, id, editDraft.trim());
      setEditingId(null);
      fetchItems();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to update announcement.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAnnouncement = async (id: number) => {
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await announcementService.remove(courseId, id);
      fetchItems();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete this announcement.'));
    }
  };

  const handleDeleteMaterial = async (id: number) => {
    if (!window.confirm('Delete this material?')) return;
    try {
      await materialService.remove(courseId, id);
      fetchItems();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete this material.'));
    }
  };

  const handleDeleteMeeting = async (id: number) => {
    if (!window.confirm('Delete this meeting?')) return;
    try {
      await meetingService.remove(courseId, id);
      fetchItems();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete this meeting.'));
    }
  };

  const resetComposer = () => {
    setComposerKind(null);
    setMatTitle(''); setMatDescription(''); setMatLink(''); setMatFile(null);
    setMtgTitle(''); setMtgDescription(''); setMtgLink(''); setMtgScheduledAt(''); setMtgDuration('');
  };

  const handlePostMaterial = async () => {
    if (!matTitle.trim()) return;
    setComposerPosting(true);
    setError('');
    try {
      await materialService.create(courseId, {
        title: matTitle.trim(),
        description: matDescription.trim() || undefined,
        external_link: matLink.trim() || undefined,
        file: matFile || undefined,
      });
      resetComposer();
      fetchItems();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to post material.'));
    } finally {
      setComposerPosting(false);
    }
  };

  const handlePostMeeting = async () => {
    if (!mtgTitle.trim() || !mtgLink.trim() || !mtgScheduledAt) return;
    setComposerPosting(true);
    setError('');
    try {
      await meetingService.create(courseId, {
        title: mtgTitle.trim(),
        description: mtgDescription.trim() || undefined,
        meeting_link: mtgLink.trim(),
        scheduled_at: new Date(mtgScheduledAt).toISOString(),
        duration_minutes: mtgDuration ? parseInt(mtgDuration) : undefined,
      });
      resetComposer();
      fetchItems();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to schedule meeting.'));
    } finally {
      setComposerPosting(false);
    }
  };

  return (
    <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
          <Megaphone className="w-4.5 h-4.5 text-primary" />
          Class Stream
        </h3>
        {isTeacher && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setComposerKind(composerKind === 'material' ? null : 'material')}
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1 ${
                composerKind === 'material' ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400' : 'border-border text-text-muted hover:text-amber-700 hover:border-amber-200 dark:hover:text-amber-400 dark:hover:border-amber-500/20'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" /> Material
            </button>
            <button
              onClick={() => setComposerKind(composerKind === 'meeting' ? null : 'meeting')}
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1 ${
                composerKind === 'meeting' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400' : 'border-border text-text-muted hover:text-emerald-700 hover:border-emerald-200 dark:hover:text-emerald-400 dark:hover:border-emerald-500/20'
              }`}
            >
              <Video className="w-3.5 h-3.5" /> Meeting
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400 rounded-xl p-3 mb-4 text-xs">{error}</div>
      )}

      {isTeacher && composerKind === 'material' && (
        <div className="border border-amber-200 dark:border-amber-500/20 rounded-xl p-4 mb-5 bg-amber-50/30 dark:bg-amber-500/5 space-y-3">
          <input
            className="input-light w-full"
            placeholder="Material title"
            value={matTitle}
            onChange={(e) => setMatTitle(e.target.value)}
          />
          <textarea
            className="input-light w-full resize-none"
            rows={2}
            placeholder="Description (optional)"
            value={matDescription}
            onChange={(e) => setMatDescription(e.target.value)}
          />
          <input
            className="input-light w-full text-sm"
            placeholder="External link (optional)"
            value={matLink}
            onChange={(e) => setMatLink(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-primary cursor-pointer">
            <Paperclip className="w-3.5 h-3.5" />
            {matFile ? matFile.name : 'Attach file (optional)'}
            <input type="file" className="hidden" onChange={(e) => setMatFile(e.target.files?.[0] || null)} />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={resetComposer} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
            <button
              onClick={handlePostMaterial}
              disabled={composerPosting || !matTitle.trim()}
              className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50"
            >
              {composerPosting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Post Material
            </button>
          </div>
        </div>
      )}

      {isTeacher && composerKind === 'meeting' && (
        <div className="border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-4 mb-5 bg-emerald-50/30 dark:bg-emerald-500/5 space-y-3">
          <input
            className="input-light w-full"
            placeholder="Meeting title"
            value={mtgTitle}
            onChange={(e) => setMtgTitle(e.target.value)}
          />
          <textarea
            className="input-light w-full resize-none"
            rows={2}
            placeholder="Description (optional)"
            value={mtgDescription}
            onChange={(e) => setMtgDescription(e.target.value)}
          />
          <input
            className="input-light w-full text-sm"
            placeholder="Meeting link (Zoom/Meet/etc.)"
            value={mtgLink}
            onChange={(e) => setMtgLink(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Scheduled at</label>
              <input
                type="datetime-local"
                className="input-light w-full text-sm"
                value={mtgScheduledAt}
                onChange={(e) => setMtgScheduledAt(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Duration (minutes, optional)</label>
              <input
                type="number" min="0"
                className="input-light w-full text-sm"
                value={mtgDuration}
                onChange={(e) => setMtgDuration(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={resetComposer} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
            <button
              onClick={handlePostMeeting}
              disabled={composerPosting || !mtgTitle.trim() || !mtgLink.trim() || !mtgScheduledAt}
              className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50"
            >
              {composerPosting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Schedule Meeting
            </button>
          </div>
        </div>
      )}

      {isTeacher && (
        <div className="flex items-start gap-3 mb-6">
          <div className="w-9 h-9 rounded-full bg-primary-muted flex items-center justify-center shrink-0">
            <User className="w-4.5 h-4.5 text-primary" />
          </div>
          <div className="flex-1">
            <textarea
              className="input-light w-full resize-none"
              rows={2}
              placeholder="Share something with your class..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={handlePost}
                disabled={posting || !draft.trim()}
                className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-50"
              >
                {posting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Post
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-sm text-text-muted">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
          <EmptyStateIllustration className="w-28 h-28 mx-auto mb-2" />
          Nothing posted yet.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const meta = POST_TYPE_META[item.post_type] || POST_TYPE_META.announcement;
            const Icon = meta.icon;
            const isOwner = isTeacher;
            const isEditingAnnouncement = item.post_type === 'announcement' && editingId === item.id;

            return (
              <div key={`${item.post_type}-${item.id}`} className="flex items-start gap-3 border-b border-border last:border-b-0 pb-4 last:pb-0">
                <div className="w-9 h-9 rounded-full bg-secondary-muted flex items-center justify-center shrink-0">
                  <User className="w-4.5 h-4.5 text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${meta.badgeClass}`}>
                        <Icon className="w-3 h-3" /> {meta.label}
                      </span>
                      <span className="text-sm font-bold text-text-primary">{item.teacher_name || 'Teacher'}</span>
                      <span className="text-xs text-text-muted">
                        {timeAgo(item.created_at)}
                        {item.updated_at && ' (edited)'}
                      </span>
                    </div>
                    {isOwner && !isEditingAnnouncement && (
                      <div className="flex items-center gap-1 shrink-0">
                        {item.post_type === 'announcement' && (
                          <button onClick={() => startEdit(item)} className="p-1 text-text-muted hover:text-primary rounded transition-all" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {item.post_type === 'announcement' && (
                          <button onClick={() => handleDeleteAnnouncement(item.id)} className="p-1 text-text-muted hover:text-rose-500 rounded transition-all" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {item.post_type === 'material' && (
                          <button onClick={() => handleDeleteMaterial(item.id)} className="p-1 text-text-muted hover:text-rose-500 rounded transition-all" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {item.post_type === 'meeting' && (
                          <button onClick={() => handleDeleteMeeting(item.id)} className="p-1 text-text-muted hover:text-rose-500 rounded transition-all" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {isEditingAnnouncement ? (
                    <div className="mt-2">
                      <textarea
                        className="input-light w-full resize-none"
                        rows={2}
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button onClick={cancelEdit} className="btn-ghost text-xs px-3 py-1.5">
                          <X className="w-3.5 h-3.5" /> Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(item.id)}
                          disabled={saving || !editDraft.trim()}
                          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" /> Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {item.title && <p className="text-sm font-bold text-text-primary mt-1">{item.title}</p>}
                      {item.content && <p className="text-sm text-text-secondary mt-1 whitespace-pre-wrap">{item.content}</p>}

                      {item.post_type === 'assignment' && (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {item.due_date && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-bold border bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20">
                              <Clock className="w-3 h-3" /> Due {parseUtc(item.due_date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </span>
                          )}
                          {item.points !== null && (
                            <span className="text-[12px] font-bold text-text-muted">{item.points} pts</span>
                          )}
                          <span className="text-[12px] font-semibold text-secondary">See Assignments below to submit/manage.</span>
                        </div>
                      )}

                      {item.post_type === 'material' && (
                        <div className="flex flex-wrap items-center gap-3 mt-2">
                          {item.attachment_filename && (
                            <button
                              onClick={() => downloadAuthenticated(materialService.downloadAttachmentUrl(courseId, item.id), item.attachment_filename!)}
                              className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
                            >
                              <Download className="w-3 h-3" /> {item.attachment_filename}
                            </button>
                          )}
                          {item.external_link && (
                            <a
                              href={item.external_link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
                            >
                              <LinkIcon className="w-3 h-3" /> Open link
                            </a>
                          )}
                        </div>
                      )}

                      {item.post_type === 'meeting' && (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {item.scheduled_at && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                              <Clock className="w-3 h-3" /> {parseUtc(item.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </span>
                          )}
                          {item.duration_minutes !== null && (
                            <span className="text-[12px] font-bold text-text-muted">{item.duration_minutes} min</span>
                          )}
                          {item.meeting_link && (
                            <a
                              href={item.meeting_link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[12px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 rounded-lg transition-all"
                            >
                              <Video className="w-3 h-3" /> Join
                            </a>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
