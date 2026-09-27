import React, { useEffect, useState } from 'react';
import { graphService } from '../services/api';
import type { GraphRevision, GraphEditProposal } from '../services/api';
import { DiffGraphPreview } from './DiffGraphPreview';
import {
  History, ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock,
  Loader2, MessageSquare, Network, Pencil,
} from 'lucide-react';

// The teacher's side of the graph approval workflow. Until this existed a teacher
// could submit a draft graph and never learn what happened to it: the coordinator's
// decision and notes were recorded in the database but rendered nowhere, so a
// rejection was completely silent. This shows every submission with its status
// timeline, the coordinator's reasoning, and the proposed graph itself.

const STATUS_STYLES: Record<string, { label: string; className: string; Icon: React.ElementType }> = {
  PendingTeacherReview: { label: 'Awaiting your review', className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30', Icon: Clock },
  PendingCoordinatorApproval: { label: 'Awaiting coordinator approval', className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/30', Icon: Clock },
  Pending: { label: 'Awaiting coordinator approval', className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/30', Icon: Clock },
  Approved: { label: 'Approved & merged', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30', Icon: CheckCircle2 },
  Rejected: { label: 'Rejected', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30', Icon: XCircle },
};

const OPERATION_LABELS: Record<string, string> = {
  create_node: 'New concept',
  update_node: 'Concept update',
  delete_node: 'Delete concept',
  create_relationship: 'New prerequisite link',
  delete_relationship: 'Remove prerequisite link',
};

const formatWhen = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = STATUS_STYLES[status] || {
    label: status,
    className: 'bg-card text-text-secondary border-border',
    Icon: Clock,
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold px-2 py-0.5 rounded-full border ${s.className}`}>
      <s.Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
};

// Ordered audit trail for one submission. Only steps that actually happened are
// rendered, so a still-pending item doesn't imply a decision was made.
const Timeline: React.FC<{ steps: { label: string; when: string | null; note?: string | null; by?: string | null }[] }> = ({ steps }) => (
  <ol className="mt-3 space-y-2 border-l border-border pl-4">
    {steps.filter(s => s.when).map((s, i) => (
      <li key={i} className="relative">
        <span className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-primary" />
        <p className="text-xs font-semibold text-text-primary">{s.label}</p>
        <p className="text-[12px] text-text-muted">
          {formatWhen(s.when)}{s.by ? ` · ${s.by}` : ''}
        </p>
        {s.note && (
          <p className="mt-1 text-[12px] text-text-secondary bg-background border border-border rounded-lg px-2 py-1.5 flex items-start gap-1.5">
            <MessageSquare className="w-3 h-3 mt-0.5 shrink-0 text-text-muted" />
            <span>{s.note}</span>
          </p>
        )}
      </li>
    ))}
  </ol>
);

const RevisionRow: React.FC<{ revision: GraphRevision }> = ({ revision }) => {
  const [open, setOpen] = useState(false);
  const concepts = revision.diff?.concepts || [];

  return (
    <div className="bg-background border border-border rounded-xl p-4">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-start justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {open ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />}
            <span className="text-sm font-bold text-text-primary">
              {revision.subject_name || 'Graph revision'}
              {revision.subject_code && <span className="text-text-muted font-normal"> ({revision.subject_code})</span>}
            </span>
            {revision.is_initial && (
              <span className="text-[11px] font-bold text-primary bg-primary-muted px-2 py-0.5 rounded-full">First graph</span>
            )}
            <StatusBadge status={revision.status} />
          </div>
          <p className="text-[12px] text-text-muted mt-1 ml-6">
            {revision.diff?.new_concept_count ?? concepts.length} new concept(s) ·{' '}
            {revision.diff?.new_relationship_count ?? 0} link(s) · submitted {formatWhen(revision.created_at)}
          </p>
        </div>
      </button>

      {open && (
        <div className="mt-3 ml-6">
          <Timeline
            steps={[
              { label: 'Draft generated from uploaded material', when: revision.created_at },
              { label: 'You reviewed and sent for approval', when: revision.teacher_reviewed_at, note: revision.teacher_edit_notes },
              {
                label: revision.status === 'Approved' ? 'Coordinator approved — merged into the shared graph' : 'Coordinator rejected',
                when: revision.coordinator_decision_at,
                note: revision.coordinator_notes,
                by: revision.coordinator_name,
              },
            ]}
          />

          {concepts.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Proposed graph</p>
              <DiffGraphPreview concepts={concepts} className="h-64" />

              <details className="mt-3">
                <summary className="text-xs font-semibold text-text-secondary cursor-pointer hover:text-text-primary">
                  Concept list ({concepts.length})
                </summary>
                <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {concepts.map((c, i) => (
                    <div key={i} className="border border-border rounded-lg px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-text-primary">{c.name}</p>
                        <span className={c.difficulty === 'Easy' ? 'badge-easy' : c.difficulty === 'Hard' ? 'badge-hard' : 'badge-medium'}>
                          {c.difficulty}
                        </span>
                      </div>
                      {c.prerequisites.length > 0 && (
                        <p className="text-[11px] text-text-muted mt-0.5">Prerequisites: {c.prerequisites.join(', ')}</p>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ProposalRow: React.FC<{ proposal: GraphEditProposal }> = ({ proposal }) => {
  const p = proposal.payload || {};
  const summary = proposal.operation.includes('relationship')
    ? `${p.source_name} → ${p.target_name}`
    : p.name || '';

  return (
    <div className="bg-background border border-border rounded-xl px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary bg-primary-muted px-2 py-0.5 rounded-full">
              {OPERATION_LABELS[proposal.operation] || proposal.operation}
            </span>
            <span className="text-sm font-semibold text-text-primary truncate">{summary}</span>
            <StatusBadge status={proposal.status} />
          </div>
          <p className="text-[12px] text-text-muted mt-1">Submitted {formatWhen(proposal.created_at)}</p>
          {proposal.coordinator_decision_at && (
            <p className="text-[12px] text-text-muted">
              Decided {formatWhen(proposal.coordinator_decision_at)}
              {proposal.coordinator_name ? ` · ${proposal.coordinator_name}` : ''}
            </p>
          )}
          {proposal.coordinator_notes && (
            <p className="mt-1.5 text-[12px] text-text-secondary bg-card border border-border rounded-lg px-2 py-1.5 flex items-start gap-1.5">
              <MessageSquare className="w-3 h-3 mt-0.5 shrink-0 text-text-muted" />
              <span>{proposal.coordinator_notes}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

interface GraphSubmissionLogProps {
  /** Omit to show every submission this teacher has made, across all their courses. */
  courseId?: number;
}

export const GraphSubmissionLog: React.FC<GraphSubmissionLogProps> = ({ courseId }) => {
  const [revisions, setRevisions] = useState<GraphRevision[]>([]);
  const [proposals, setProposals] = useState<GraphEditProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await graphService.getMySubmissions(courseId);
        if (cancelled) return;
        setRevisions(data.revisions || []);
        setProposals(data.edit_proposals || []);
      } catch (err: any) {
        // A request aborted because this component unmounted mid-flight (fast
        // navigation, React's double-invoked effects in dev) is not a failure the
        // user should see an error for - only report a real response error.
        const aborted = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.message === 'canceled';
        if (!cancelled && !aborted) setError('Could not load your graph submissions.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [courseId]);

  const isEmpty = revisions.length === 0 && proposals.length === 0;

  return (
    <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
      <h3 className="text-base font-bold text-text-primary flex items-center gap-2 mb-1">
        <History className="w-4.5 h-4.5 text-primary" />
        My Graph Submissions
      </h3>
      <p className="text-text-secondary text-sm mb-4">
        Draft graphs and manual edits you've sent to the course coordinator, with their decision and notes.
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-muted py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : isEmpty ? (
        <p className="text-sm text-text-muted text-center py-6">
          Nothing submitted yet. Generate a graph from your uploaded material to get started.
        </p>
      ) : (
        <div className="space-y-5">
          {revisions.length > 0 && (
            <div>
              <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Network className="w-3.5 h-3.5" /> Draft graphs ({revisions.length})
              </p>
              <div className="space-y-2">
                {revisions.map(r => <RevisionRow key={r.id} revision={r} />)}
              </div>
            </div>
          )}

          {proposals.length > 0 && (
            <div>
              <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Pencil className="w-3.5 h-3.5" /> Manual edits ({proposals.length})
              </p>
              <div className="space-y-2">
                {proposals.map(p => <ProposalRow key={p.id} proposal={p} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GraphSubmissionLog;
