// CourseSchedule: week-by-week course outline page. Students see the published schedule;
// teachers can also generate one from the course outline, edit sessions and save/publish.
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { scheduleService, courseService, type ScheduleSessionItem, type CourseSchedule as CourseScheduleData } from '../services/api';
import { FoxSpinner } from '../components/FoxSpinner';
import { apiErrorMessage } from '../lib/apiError';
import {
  ArrowLeft, Sparkles, RefreshCw, Save, Plus, Trash2, CheckCircle2, AlertCircle,
} from 'lucide-react';

// Course schedule/outline preview - a lightweight, teacher-editable week-by-week
// breakdown of topics, shown to students and teachers ahead of the full concept
// graph. No coordinator-approval gate: a teacher's generate/edit action applies
// straight to the live schedule, visible to students immediately.
const emptySession = (): ScheduleSessionItem => ({ week_label: '', title: '', topics: [] });

/** Page component (route param :courseId): viewer for everyone, editor for teachers. */
const CourseSchedule: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const idNum = Number(courseId);
  const navigate = useNavigate();
  const { user } = useAuth();

  const isTeacher = user?.role === 'teacher';

  const [courseName, setCourseName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [schedule, setSchedule] = useState<CourseScheduleData | null>(null);

  // Teacher's editor, seeded from the current live sessions.
  const [draft, setDraft] = useState<ScheduleSessionItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Loads the course name and its published schedule (none yet is a normal case);
  // seeds the teacher's editable draft from the live sessions.
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const courseData = await courseService.getDetails(idNum);
      setCourseName(courseData.name);

      try {
        const data = await scheduleService.getApproved(idNum);
        setSchedule(data);
        if (isTeacher) setDraft(data.sessions ?? []);
      } catch {
        setSchedule(null);
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load this course.'));
    } finally {
      setLoading(false);
    }
  };

  // Reload whenever the course id in the URL changes.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idNum]);

  // Auto-dismiss the success banner after 4 seconds.
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t); }
  }, [success]);

  // Asks the backend (AI) to build a schedule from the course outline; it is published immediately.
  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const data = await scheduleService.generate(idNum);
      setSchedule(data);
      setDraft(data.sessions ?? []);
      setSuccess('Schedule generated from your course outline and published.');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not generate a schedule from the course outline.'));
    } finally {
      setGenerating(false);
    }
  };

  // Saves the teacher's edited draft as the live schedule.
  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const data = await scheduleService.update(idNum, draft);
      setSchedule(data);
      setSuccess('Schedule saved and published.');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save this schedule.'));
    } finally {
      setSaving(false);
    }
  };

  // Draft editing helpers: patch one session's fields.
  const updateDraftSession = (index: number, patch: Partial<ScheduleSessionItem>) => {
    setDraft((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  // Converts the comma-separated topics text box into a clean string array.
  const updateDraftTopics = (index: number, topicsText: string) => {
    updateDraftSession(index, { topics: topicsText.split(',').map((t) => t.trim()).filter(Boolean) });
  };

  // Append a blank session / delete a session by index.
  const addSession = () => setDraft((prev) => [...prev, emptySession()]);
  const removeSession = (index: number) => setDraft((prev) => prev.filter((_, i) => i !== index));
  // Swap a session with its neighbour (dir -1 = up, 1 = down); no-op at the ends.
  const moveSession = (index: number, dir: -1 | 1) => {
    setDraft((prev) => {
      const next = [...prev];
      const swap = index + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[index], next[swap]] = [next[swap], next[index]];
      return next;
    });
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <FoxSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="glass-panel border-b border-border py-3 px-5 flex items-center gap-3 shadow-soft">
        <button
          onClick={() => navigate(`/course/${courseId}`)}
          className="p-2 border border-border text-text-secondary hover:text-primary hover:bg-primary-muted rounded-xl transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-base font-bold text-text-primary flex items-center gap-1.5">
          <span className="gradient-text">Course Schedule</span>
          {courseName && <span className="text-text-muted font-normal">— {courseName}</span>}
        </h2>
      </header>

      <div className="max-w-3xl mx-auto p-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3 rounded-xl">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> {success}
          </div>
        )}

        {isTeacher && (
          <div className="bg-surface border border-border rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text-primary">Edit schedule</h3>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="btn-secondary text-xs disabled:opacity-60"
              >
                {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {generating ? 'Generating…' : 'Generate from outline'}
              </button>
            </div>

            <div className="space-y-3">
              {draft.map((s, i) => (
                <div key={i} className="border border-border rounded-xl p-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      className="input-light text-xs flex-1"
                      placeholder="Week 1"
                      value={s.week_label}
                      onChange={(e) => updateDraftSession(i, { week_label: e.target.value })}
                    />
                    <input
                      className="input-light text-xs flex-1"
                      placeholder="Optional title"
                      value={s.title ?? ''}
                      onChange={(e) => updateDraftSession(i, { title: e.target.value })}
                    />
                    <button type="button" onClick={() => moveSession(i, -1)} className="px-2 text-text-muted hover:text-primary">↑</button>
                    <button type="button" onClick={() => moveSession(i, 1)} className="px-2 text-text-muted hover:text-primary">↓</button>
                    <button type="button" onClick={() => removeSession(i)} className="px-2 text-rose-400 hover:text-rose-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    className="input-light text-xs w-full"
                    placeholder="Topics, comma-separated"
                    value={s.topics.join(', ')}
                    onChange={(e) => updateDraftTopics(i, e.target.value)}
                  />
                </div>
              ))}
              <button type="button" onClick={addSession} className="btn-secondary text-xs w-full justify-center">
                <Plus className="w-3.5 h-3.5" /> Add session
              </button>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || draft.length === 0}
              className="w-full py-2 btn-primary justify-center text-xs disabled:opacity-60"
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : 'Save & publish'}
            </button>
          </div>
        )}

        <div className="bg-surface border border-border rounded-2xl p-5">
          <h3 className="text-sm font-bold text-text-primary mb-3">
            {isTeacher ? 'Current schedule (what students see)' : "What you'll learn, and when"}
          </h3>
          {!schedule || schedule.sessions.length === 0 ? (
            <p className="text-xs text-text-muted italic">No schedule yet.</p>
          ) : (
            <div className="space-y-2">
              {schedule.sessions.map((s, i) => (
                <div key={i} className="border border-border rounded-lg p-3">
                  <span className="font-bold text-text-primary text-sm">{s.week_label}</span>
                  {s.title ? <span className="text-text-secondary text-sm"> — {s.title}</span> : null}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {s.topics.map((t, j) => (
                      <span key={j} className="text-[11px] font-semibold bg-primary-muted text-primary px-2 py-0.5 rounded-full border border-primary/20">{t}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CourseSchedule;
