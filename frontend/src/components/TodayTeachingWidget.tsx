// Purpose: dashboard card listing, per course, the topics scheduled for today (teacher: what to teach, student: what to revise).
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck2, ChevronRight } from 'lucide-react';
import { scheduleService } from '../services/api';
import type { TodayTopics } from '../services/api';

// Minimal course shape this widget needs.
interface CourseLite {
  id: number;
  name: string;
}

interface TodayTeachingWidgetProps {
  courses: CourseLite[];
  /** Copy differs by audience: a teacher is told what to TEACH, a student what
   *  to REVISE - same underlying schedule data, opposite framing. */
  role: 'teacher' | 'student';
}

/**
 * The daily teaching-calendar signal, automated end to end from the course's
 * (coordinator-approved) schedule and its start date - see
 * backend/app/schedule/service.py get_today_topics. No separate reminder job to
 * maintain: "today's topic" is just today's date compared against the approved
 * week-by-week plan, computed live, so it's automatically always in sync with
 * whatever the schedule currently says (including a coordinator-approved edit
 * made five minutes ago).
 *
 * Silently renders nothing when no course has anything to say today (not
 * started, no approved schedule yet, or past the schedule's last week) - this
 * is the normal case for most courses on most days, not a state worth a card.
 */
export const TodayTeachingWidget: React.FC<TodayTeachingWidgetProps> = ({ courses, role }) => {
  const navigate = useNavigate();
  // hits = courses that have topics today; loaded = fetch finished (avoids flashing an empty card).
  const [hits, setHits] = useState<Array<{ course: CourseLite; today: TodayTopics }>>([]);
  const [loaded, setLoaded] = useState(false);

  // Fetch today's topics for every course in parallel; failed lookups are ignored.
  // `cancelled` stops state updates if the component unmounts or the course list changes mid-request.
  useEffect(() => {
    if (courses.length === 0) { setLoaded(true); return; }
    let cancelled = false;
    Promise.all(
      courses.map((c) =>
        scheduleService.getToday(c.id).then((today) => ({ course: c, today })).catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      setHits(results.filter((r): r is { course: CourseLite; today: TodayTopics } => !!r && r.today.topics.length > 0));
      setLoaded(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses.map((c) => c.id).join(',')]);

  // Render nothing until loaded, and nothing if no course has topics today.
  if (!loaded || hits.length === 0) return null;

  return (
    <div className="bg-surface rounded-2xl p-5 border border-border animate-fade-up mb-6 space-y-3">
      <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
        <CalendarCheck2 className="w-4.5 h-4.5 text-secondary" />
        {role === 'teacher' ? "Today's teaching plan" : 'Revise today'}
      </h3>
      <div className="space-y-2">
        {hits.map(({ course, today }) => (
          <button
            key={course.id}
            onClick={() => navigate(`/course/${course.id}/schedule`)}
            className="w-full text-left border border-border rounded-xl p-3 hover:border-primary/30 hover:bg-primary-muted transition-all flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="text-xs font-bold text-text-primary truncate">
                {course.name} — {today.week_label}{today.title ? `: ${today.title}` : ''}
              </p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                {role === 'teacher' ? "You're covering: " : 'Likely covered today: '}
                {today.topics.join(', ')}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default TodayTeachingWidget;
