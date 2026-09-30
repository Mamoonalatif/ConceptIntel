// OutcomeAttainment: student card showing attainment scores for this course's CLOs and their program-wide PLOs, computed from graded assignments.
import React, { useEffect, useState } from 'react';
import { Target, Award } from 'lucide-react';
import { outcomesService } from '../services/api';
import type { CLOAttainment, PLOAttainment } from '../services/api';

interface OutcomeAttainmentProps {
  courseId: number;
}

// Colour for an attainment score: green >=75, amber >=50, red below.
const scoreColor = (score: number) =>
  score >= 75 ? 'text-emerald-600 dark:text-emerald-400'
    : score >= 50 ? 'text-amber-600 dark:text-amber-400'
    : 'text-rose-500';

/**
 * The student-visible end of the Concept -> CLO -> PLO -> GA outcome chain:
 * how they're actually doing against this course's Course Learning Outcomes,
 * and their Program Learning Outcomes rolled up across every course (PLOs are
 * program-level, not scoped to one course - see backend
 * app/outcomes/services.py recompute_plo_attainment). Both were being computed
 * and stored since the grading feature shipped, but neither had anywhere to be
 * read - this is that missing display.
 *
 * Renders nothing when there's no evidence yet (no CLO-tagged criterion has
 * been graded), same "don't show an empty state for a normal not-yet
 * situation" convention as RevisionPlanCard.
 */
// Main component: loads CLO and PLO attainment (failures become empty lists).
export const OutcomeAttainment: React.FC<OutcomeAttainmentProps> = ({ courseId }) => {
  const [clos, setClos] = useState<CLOAttainment[]>([]);
  const [plos, setPlos] = useState<PLOAttainment[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Fetch both attainment lists; `mounted` guards against setting state after unmount.
  useEffect(() => {
    let mounted = true;
    Promise.all([
      outcomesService.getMyCLOAttainment(courseId).catch(() => []),
      outcomesService.getMyPLOAttainment().catch(() => []),
    ]).then(([c, p]) => {
      if (!mounted) return;
      setClos(c);
      setPlos(p);
      setLoaded(true);
    });
    return () => { mounted = false; };
  }, [courseId]);

  // Render nothing until loaded, or when there is no CLO evidence yet.
  if (!loaded || clos.length === 0) return null;

  return (
    <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
      <h3 className="text-base font-bold text-text-primary flex items-center gap-2 mb-1">
        <Target className="w-4.5 h-4.5 text-secondary" />
        Learning Outcomes
      </h3>
      <p className="text-[12px] text-text-muted mb-3">
        How you're doing against this course's Course Learning Outcomes, based on graded assignments.
      </p>
      <div className="space-y-2 mb-4">
        {clos.map((c) => (
          <div key={c.clo_id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
            <div className="min-w-0">
              <span className="text-xs font-bold text-text-primary">{c.clo_code}</span>
              <span className="text-xs text-text-secondary ml-1.5 truncate">{c.clo_title}</span>
            </div>
            <span className={`text-xs font-extrabold shrink-0 ${scoreColor(c.attainment_score)}`}>
              {Math.round(c.attainment_score)}/100
            </span>
          </div>
        ))}
      </div>

      {plos.length > 0 && (
        <>
          <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-1.5 mb-2">
            <Award className="w-3.5 h-3.5" />
            Program Learning Outcomes <span className="font-normal normal-case text-text-muted">(across all your courses)</span>
          </h4>
          <div className="space-y-2">
            {plos.map((p) => (
              <div key={p.plo_id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-text-primary">{p.plo_code}</span>
                  <span className="text-xs text-text-secondary ml-1.5 truncate">{p.plo_title}</span>
                </div>
                <span className={`text-xs font-extrabold shrink-0 ${scoreColor(p.attainment_score)}`}>
                  {Math.round(p.attainment_score)}/100
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default OutcomeAttainment;
