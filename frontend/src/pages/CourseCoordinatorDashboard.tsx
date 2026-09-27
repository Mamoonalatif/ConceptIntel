import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { courseCoordinatorService, courseService, graphService } from '../services/api';
import type { GraphRevision, GraphEditProposal } from '../services/api';
import { AppShell, type NavItem } from '../components/AppShell';
import { DiffGraphPreview } from '../components/DiffGraphPreview';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { apiErrorMessage } from '../lib/apiError';
import {
  Network, AlertCircle, Pencil, X, Check,
  Sparkles, ThumbsUp, ThumbsDown, RefreshCw, BookOpen,
} from 'lucide-react';
import { EmptyStateIllustration } from '../components/illustrations';

interface CourseInstance {
  id: number;
  name: string;
  code: string | null;
  semester: string;
  status: string;
  description: string | null;
  max_students: number | null;
  enrollment_start: string | null;
  enrollment_end: string | null;
  start_date: string | null;
  end_date: string | null;
  graph_status: string;
}

const graphBadgeClass = (status: string) => {
  if (status === 'Approved') return 'bg-primary-muted text-primary border-primary/20';
  if (status === 'Rejected') return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30';
  return 'bg-card text-text-secondary border-border';
};

const OPERATION_LABELS: Record<string, string> = {
  create_node: 'New concept',
  update_node: 'Concept update',
  delete_node: 'Delete concept',
  create_relationship: 'New prerequisite link',
  delete_relationship: 'Remove prerequisite link',
};

// Full detail of what a manual edit actually changes - shown in the coordinator's
// review queue so they can decide without having to reopen the graph themselves.
// Unlike the AI-pipeline revisions above (a bulk diff needing its own modal), each
// of these is one small change, so it fits inline as a compact before/after block.
const EditProposalDetail: React.FC<{ proposal: GraphEditProposal }> = ({ proposal }) => {
  const p = proposal.payload || {};
  switch (proposal.operation) {
    case 'create_node':
      return (
        <div className="mt-2 text-xs text-text-secondary space-y-1">
          <p><span className="font-semibold text-text-primary">{p.name}</span> <span className={p.difficulty === 'Easy' ? 'badge-easy' : p.difficulty === 'Hard' ? 'badge-hard' : 'badge-medium'}>{p.difficulty}</span></p>
          {p.description && <p className="text-text-muted">{p.description}</p>}
        </div>
      );
    case 'update_node': {
      const nameChanged = p.old_name !== p.name;
      const diffChanged = p.old_difficulty !== p.difficulty;
      const descChanged = p.old_description !== p.description;
      return (
        <div className="mt-2 text-xs text-text-secondary space-y-1">
          <p className="font-semibold text-text-primary">{p.name}</p>
          {nameChanged && <p><span className="text-text-muted">Name:</span> <span className="line-through text-text-muted">{p.old_name}</span> → <span className="font-medium text-text-primary">{p.name}</span></p>}
          {diffChanged && <p><span className="text-text-muted">Difficulty:</span> <span className="line-through text-text-muted">{p.old_difficulty}</span> → <span className="font-medium text-text-primary">{p.difficulty}</span></p>}
          {descChanged && (
            <div>
              <p className="text-text-muted">Description:</p>
              <p className="line-through text-text-muted">{p.old_description}</p>
              <p className="text-text-primary">{p.description}</p>
            </div>
          )}
          {!nameChanged && !diffChanged && !descChanged && <p className="text-text-muted italic">No visible field changes.</p>}
        </div>
      );
    }
    case 'delete_node':
      return (
        <div className="mt-2 text-xs text-text-secondary space-y-1">
          <p><span className="font-semibold text-rose-600 line-through">{p.name}</span> <span className={p.difficulty === 'Easy' ? 'badge-easy' : p.difficulty === 'Hard' ? 'badge-hard' : 'badge-medium'}>{p.difficulty}</span></p>
          {p.description && <p className="text-text-muted">{p.description}</p>}
          <p className="text-rose-600 italic">All of this concept's prerequisite links will also be removed.</p>
        </div>
      );
    case 'create_relationship':
      return (
        <p className="mt-2 text-xs text-text-secondary">
          <span className="font-semibold text-text-primary">{p.source_name}</span> is a prerequisite of <span className="font-semibold text-text-primary">{p.target_name}</span>
        </p>
      );
    case 'delete_relationship':
      return (
        <p className="mt-2 text-xs text-text-secondary">
          <span className="font-semibold text-rose-600 line-through">{p.source_name}</span> → <span className="font-semibold text-rose-600 line-through">{p.target_name}</span> will no longer be linked as a prerequisite
        </p>
      );
    default:
      return null;
  }
};

const CourseCoordinatorDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [courses, setCourses] = useState<CourseInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMaxStudents, setEditMaxStudents] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Reviewed-pipeline revisions awaiting this coordinator's final approval - the
  // point where a diff actually gets merged into Neo4j.
  const [pendingRevisions, setPendingRevisions] = useState<GraphRevision[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(true);
  const [reviewRevision, setReviewRevision] = useState<GraphRevision | null>(null);
  const [decidingRevision, setDecidingRevision] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');

  // Manual node/relationship edits made directly in the Concept Graph UI -
  // each needs its own approval before it reaches Neo4j, same principle as the
  // AI-pipeline revisions above but one edit at a time instead of a bulk diff.
  const [pendingEditProposals, setPendingEditProposals] = useState<GraphEditProposal[]>([]);
  const [loadingEditProposals, setLoadingEditProposals] = useState(true);
  const [decidingProposalId, setDecidingProposalId] = useState<number | null>(null);

  const fetchCourses = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await courseService.getAll();
      setCourses(data);
    } catch (err: any) {
      if (!silent) setError('Failed to load courses. Verify API connection.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchPendingRevisions = async () => {
    setLoadingRevisions(true);
    try {
      const data = await graphService.listPendingRevisions();
      setPendingRevisions(data);
    } catch (err: any) {
      setError('Failed to load pending graph revisions.');
    } finally {
      setLoadingRevisions(false);
    }
  };

  const fetchPendingEditProposals = async () => {
    setLoadingEditProposals(true);
    try {
      const data = await graphService.listPendingEditProposals();
      setPendingEditProposals(data);
    } catch (err: any) {
      setError('Failed to load pending manual edits.');
    } finally {
      setLoadingEditProposals(false);
    }
  };

  useEffect(() => {
    fetchCourses();
    fetchPendingRevisions();
    fetchPendingEditProposals();
  }, []);

  useAutoRefresh(() => fetchCourses(true));

  const handleEditProposalDecision = async (proposalId: number, action: 'approve' | 'reject') => {
    setDecidingProposalId(proposalId);
    setError('');
    try {
      if (action === 'approve') {
        await graphService.approveEditProposal(proposalId);
      } else {
        await graphService.rejectEditProposal(proposalId);
      }
      fetchPendingEditProposals();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Could not submit your decision.'));
    } finally {
      setDecidingProposalId(null);
    }
  };

  const handleCoordinatorDecision = async (action: 'approve' | 'reject') => {
    if (!reviewRevision) return;
    setDecidingRevision(true);
    setError('');
    try {
      if (action === 'approve') {
        await graphService.approveRevision(reviewRevision.id, reviewNotes || undefined);
      } else {
        await graphService.rejectRevision(reviewRevision.id, reviewNotes || undefined);
      }
      setReviewRevision(null);
      setReviewNotes('');
      fetchPendingRevisions();
      fetchCourses();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Could not submit your decision.'));
    } finally {
      setDecidingRevision(false);
    }
  };

  const startEdit = (course: CourseInstance) => {
    setEditingId(course.id);
    setEditStatus(course.status);
    setEditDescription(course.description || '');
    setEditMaxStudents(course.max_students ? String(course.max_students) : '');
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: number) => {
    setSavingEdit(true);
    setError('');
    try {
      await courseCoordinatorService.updateCourse(id, {
        status: editStatus,
        description: editDescription,
        max_students: editMaxStudents ? parseInt(editMaxStudents) : null,
      });
      setEditingId(null);
      fetchCourses();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update course info.');
    } finally {
      setSavingEdit(false);
    }
  };

  const navItems: NavItem[] = [
    { key: 'courses', label: 'Courses', icon: Network, active: true },
    // Coordinator authority is layered on top of the teacher role, not a
    // replacement for it - this account still teaches its own courses too.
    ...(user?.role === 'teacher'
      ? [{ key: 'teacher', label: 'My Teacher Dashboard', icon: BookOpen, onClick: () => navigate('/teacher') }]
      : []),
  ];

  return (
    <AppShell roleLabel="Course Coordinator Portal" logoIcon={Network} navItems={navItems}>
      <div className="space-y-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-center gap-3 text-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 cursor-pointer shrink-0" onClick={() => setError('')} />
            <span>{error}</span>
          </div>
        )}

        <div>
          <h3 className="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
            <Sparkles className="w-4.5 h-4.5 text-primary" />
            Pending Graph Revisions {pendingRevisions.length > 0 && `(${pendingRevisions.length})`}
          </h3>
          {loadingRevisions ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted mb-8">Loading...</div>
          ) : pendingRevisions.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted mb-8">
              No revisions awaiting approval right now.
            </div>
          ) : (
            <div className="space-y-3 mb-8">
              {pendingRevisions.map((rev) => (
                <div key={rev.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-bold text-text-primary">
                      {rev.course_name} <span className="text-text-muted font-normal">({rev.course_code})</span>
                      {rev.is_initial && <span className="ml-2 text-xs font-bold text-primary bg-primary-muted px-2 py-0.5 rounded-full">First graph</span>}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      Submitted by {rev.submitted_by_name} &middot; {rev.diff.new_concept_count} new concept(s), {rev.diff.new_relationship_count} link(s)
                    </p>
                  </div>
                  <button
                    onClick={() => { setReviewRevision(rev); setReviewNotes(''); }}
                    className="btn-primary text-xs px-3.5 py-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Review
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
            <Pencil className="w-4.5 h-4.5 text-primary" />
            Pending Manual Edits {pendingEditProposals.length > 0 && `(${pendingEditProposals.length})`}
          </h3>
          {loadingEditProposals ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted mb-8">Loading...</div>
          ) : pendingEditProposals.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted mb-8">
              No manual graph edits awaiting approval right now.
            </div>
          ) : (
            <div className="space-y-3 mb-8">
              {pendingEditProposals.map((p) => (
                <div key={p.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[240px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-primary bg-primary-muted px-2 py-0.5 rounded-full">
                        {OPERATION_LABELS[p.operation] || p.operation}
                      </span>
                      <p className="font-bold text-text-primary">
                        {p.course_name} <span className="text-text-muted font-normal">({p.course_code})</span>
                      </p>
                    </div>
                    <p className="text-xs text-text-muted mt-1">Requested by {p.teacher_name}</p>
                    <EditProposalDetail proposal={p} />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleEditProposalDecision(p.id, 'reject')}
                      disabled={decidingProposalId === p.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 font-semibold rounded-lg text-xs transition-all disabled:opacity-50"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" /> Reject
                    </button>
                    <button
                      onClick={() => handleEditProposalDecision(p.id, 'approve')}
                      disabled={decidingProposalId === p.id}
                      className="btn-primary text-xs px-3.5 py-1.5"
                    >
                      {decidingProposalId === p.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-base font-bold text-text-primary mb-4">Courses</h3>
          <p className="text-xs text-text-muted mb-4 max-w-2xl -mt-2">
            Graph status here is informational only - all approve/reject decisions happen in the
            "Pending Graph Revisions" queue above, where you can see the actual proposed concepts
            before deciding. Use "View Concept Graph" to inspect what's currently live.
          </p>
          {loading ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">Loading...</div>
          ) : courses.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 border border-border text-center text-sm text-text-muted">
              <EmptyStateIllustration className="w-20 h-20 mx-auto mb-2" />
              No courses created yet.
            </div>
          ) : (
            <div className="space-y-3">
              {courses.map((course) => {
                const isEditing = editingId === course.id;
                return (
                  <div key={course.id} className="glass-panel rounded-2xl p-5 border border-border shadow-card">
                    <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
                      <div>
                        <p className="font-bold text-text-primary">{course.name} <span className="text-text-muted font-normal">({course.code})</span></p>
                        <p className="text-xs text-text-muted mt-0.5">{course.semester} &middot; {course.status}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${graphBadgeClass(course.graph_status)}`}>
                          Graph: {course.graph_status}
                        </span>
                        <Link
                          to={`/course/${course.id}/graph`}
                          className="flex items-center gap-1.5 text-xs font-bold text-primary bg-primary-muted border border-primary/20 hover:bg-primary hover:text-white px-3 py-1.5 rounded-lg transition-all"
                        >
                          <Network className="w-3.5 h-3.5" /> View Concept Graph
                        </Link>
                        {!isEditing && (
                          <button onClick={() => startEdit(course)} className="btn-ghost text-xs px-3 py-1.5">
                            <Pencil className="w-3.5 h-3.5" /> Edit Info
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditing && (
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-start border-t border-border pt-4">
                        <div>
                          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Status</label>
                          <select className="input-light text-sm" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                            <option value="Draft">Draft</option>
                            <option value="Open">Open</option>
                            <option value="Closed">Closed</option>
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Description</label>
                          <input
                            className="input-light text-sm" value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            maxLength={100}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Max Students</label>
                          <input
                            type="number" min="1" className="input-light text-sm" placeholder="No limit"
                            value={editMaxStudents} onChange={(e) => setEditMaxStudents(e.target.value)}
                          />
                        </div>
                        <div className="flex items-center gap-2 sm:col-span-4">
                          <button onClick={() => saveEdit(course.id)} disabled={savingEdit} className="btn-primary text-xs px-3 py-2">
                            <Check className="w-3.5 h-3.5" /> Save
                          </button>
                          <button onClick={cancelEdit} className="btn-ghost text-xs px-3 py-2">
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Final approval modal - this is the point where a diff actually gets merged
          into Neo4j, so the full concept list is shown before deciding. */}
      {reviewRevision && (
        <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-hover border border-border max-w-2xl w-full max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                  <Sparkles className="w-4.5 h-4.5 text-primary" />
                  {reviewRevision.course_name} ({reviewRevision.course_code})
                </h3>
                <p className="text-xs text-text-muted mt-0.5">Reviewed by {reviewRevision.submitted_by_name || 'the teacher'} - now awaiting your final approval</p>
              </div>
              <button onClick={() => { setReviewRevision(null); setReviewNotes(''); }} className="p-1 text-text-muted hover:text-text-primary rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1 space-y-3">
              <div className="flex gap-4 text-xs text-text-secondary mb-2">
                <span>{reviewRevision.diff.new_concept_count} new concept(s)</span>
                <span>{reviewRevision.diff.matched_existing_count} already existed</span>
                <span>{reviewRevision.diff.new_relationship_count} new prerequisite link(s)</span>
              </div>

              <DiffGraphPreview concepts={reviewRevision.diff.concepts} className="h-72 mb-2" />

              {reviewRevision.diff.concepts.map((concept, i) => (
                <div key={i} className="bg-background border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-text-primary text-sm">{concept.name}</p>
                    <span className={
                      concept.difficulty === 'Easy' ? 'badge-easy' :
                      concept.difficulty === 'Hard' ? 'badge-hard' : 'badge-medium'
                    }>{concept.difficulty}</span>
                  </div>
                  <p className="text-text-secondary text-xs mt-1.5">{concept.description}</p>
                  <p className="text-text-muted text-[12px] mt-1.5 italic">{concept.learning_outcomes}</p>
                  <div className="flex items-center justify-between mt-2 text-[12px] text-text-muted">
                    <span>Importance: {concept.importance_score}/10</span>
                    {concept.prerequisites.length > 0 && (
                      <span>Prerequisites: {concept.prerequisites.join(', ')}</span>
                    )}
                  </div>
                </div>
              ))}

              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Notes (optional)</label>
                <textarea
                  className="input-light text-sm w-full"
                  rows={2}
                  placeholder="e.g. why you're rejecting this, or feedback for the teacher"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <button
                onClick={() => handleCoordinatorDecision('reject')}
                disabled={decidingRevision}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
              >
                <ThumbsDown className="w-4 h-4" />
                Reject
              </button>
              <button
                onClick={() => handleCoordinatorDecision('approve')}
                disabled={decidingRevision}
                className="btn-primary"
              >
                {decidingRevision ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
                Approve & Merge into Graph
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default CourseCoordinatorDashboard;
