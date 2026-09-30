// Purpose: modal that tracks a background AI content-generation job by polling until it completes, fails or times out.
import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, ExternalLink, Sparkles, Bell } from 'lucide-react';
import { contentGenerationService } from '../../services/api';
import type { GenerationJob } from '../../services/api';

// Props: course, the job to track, optional completion callback, and close handler.
interface GenerationProgressModalProps {
  courseId: number;
  job: GenerationJob;
  /** Fired once when the job completes successfully, so the caller can refresh. */
  onCompleted?: (job: GenerationJob) => void;
  onClose: () => void;
}

// How often (ms) to ask the server for the job's status.
const POLL_MS = 1500;
// Generation is bounded by three 60s attempts server-side; past this the job is stuck
// rather than slow, and pretending otherwise just leaves the modal spinning forever.
const GIVE_UP_MS = 5 * 60 * 1000;

/**
 * Progress for one background generation job.
 *
 * The important behaviour is that closing this modal does NOT cancel anything. The
 * job runs server-side and announces itself through a notification, so a teacher can
 * dismiss it, keep working, queue another, and come back - which is the whole reason
 * generation was moved off the request in the first place.
 */
export const GenerationProgressModal: React.FC<GenerationProgressModalProps> = ({
  courseId, job: initialJob, onCompleted, onClose,
}) => {
  // job = latest known job state; timedOut = we stopped waiting; startedAt = when polling began; notified = guards onCompleted from firing twice.
  const [job, setJob] = useState<GenerationJob>(initialJob);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());
  const notified = useRef(false);

  // The job has reached a final state (success or failure).
  const done = job.status === 'Completed' || job.status === 'Failed';

  // Polling loop: each render schedules one delayed status fetch; the effect re-runs when the job updates, forming a repeating poll.
  // Stops once the job is done or the overall time limit passes; cleanup cancels a pending timer.
  useEffect(() => {
    if (done || timedOut) return;
    const t = setTimeout(async () => {
      try {
        const next = await contentGenerationService.getJob(courseId, job.id);
        setJob(next);
        if (next.status === 'Completed' && !notified.current) {
          notified.current = true;
          onCompleted?.(next);
        }
      } catch {
        // A dropped poll is not a failed job - the next tick recovers. Only the
        // overall deadline below ends the wait.
      }
      if (Date.now() - startedAt.current > GIVE_UP_MS) setTimedOut(true);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [job, done, timedOut, courseId, onCompleted]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface rounded-2xl shadow-hover border border-border overflow-hidden animate-fade-up">
        <div className="px-6 py-4 border-b border-border bg-background flex items-center gap-2.5">
          <span className="w-7 h-7 bg-primary-muted rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </span>
          <p className="text-sm font-bold text-text-primary">
            {job.status === 'Completed' ? 'Ready' : job.status === 'Failed' ? "Couldn't generate" : 'Generating'}
          </p>
        </div>

        <div className="p-6 text-center">
          {/* In progress: animated dots, current stage and a reassurance that closing is safe. */}
          {!done && !timedOut && (
            <>
              <PulsingDots />
              <p className="text-base font-semibold text-text-primary mt-4">
                We are getting your questions ready
              </p>
              <p className="text-sm text-text-secondary mt-1">
                {job.stage || 'Starting'}
                {job.concept_name ? ` — ${job.concept_name}` : ''}
              </p>
              <div className="mt-5 rounded-xl border border-border bg-background p-3 flex items-start gap-2.5 text-left">
                <Bell className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-text-secondary">
                  You can close this and keep working. It'll appear in your library and
                  you'll get a notification when it's ready.
                </p>
              </div>
            </>
          )}

          {/* Gave up waiting: the job may still finish server-side. */}
          {timedOut && !done && (
            <>
              <XCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <p className="text-base font-semibold text-text-primary">This is taking unusually long</p>
              <p className="text-sm text-text-secondary mt-1">
                The job is still queued server-side. Close this — if it finishes you'll be
                notified, and it'll show up in your library.
              </p>
            </>
          )}

          {/* Success message. */}
          {job.status === 'Completed' && (
            <>
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
              <p className="text-base font-semibold text-text-primary">Your content is ready</p>
              <p className="text-sm text-text-secondary mt-1">
                {job.concept_name} — waiting for your review before students can see it.
              </p>
            </>
          )}

          {/* Failure message with the server's error. */}
          {job.status === 'Failed' && (
            <>
              <XCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
              <p className="text-base font-semibold text-text-primary">Generation failed</p>
              <p className="text-sm text-text-secondary mt-1">
                {job.error_message || 'Something went wrong. Nothing was saved.'}
              </p>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border bg-background flex justify-end gap-2">
          {/* Footer: open the generated content (when available) and the close button. */}
          {job.status === 'Completed' && job.result_content_id && (
            <button
              onClick={() =>
                window.open(`/content/${courseId}/${job.result_content_id}`, '_blank', 'noopener,noreferrer')
              }
              className="btn-primary text-xs px-3.5 py-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open it
            </button>
          )}
          <button onClick={onClose} className="btn-ghost text-xs px-3.5 py-1.5">
            {done || timedOut ? 'Close' : 'Close and keep working'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Three staggered dots - a determinate-looking cue for an indeterminate wait. */
const PulsingDots: React.FC = () => (
  <div className="flex items-center justify-center gap-2" aria-label="Working">
    {[0, 0.15, 0.3].map((delay, i) => (
      <span
        key={i}
        className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse"
        style={{ animationDelay: `${delay}s`, animationDuration: '1s' }}
      />
    ))}
  </div>
);

export default GenerationProgressModal;
