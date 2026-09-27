import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, type NavItem } from '../components/AppShell';
import { useAuth } from '../context/AuthContext';
import { calendarService } from '../services/api';
import type { CalendarEventItem } from '../services/api';
import { parseUtc } from '../lib/time';
import { EmptyStateIllustration } from '../components/illustrations';
import { getPrimaryNavItems } from '../lib/roleNav';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Video,
  RefreshCw,
  Clock,
} from 'lucide-react';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One calendar day cell's worth of data. */
interface DayCell {
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEventItem[];
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Builds a full 6-row (42-cell) month grid, including the trailing days of the
 * previous/next month needed to keep every week starting on Sunday. */
function buildMonthGrid(monthAnchor: Date, events: CalendarEventItem[]): DayCell[] {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay(); // 0 = Sunday
  const gridStart = new Date(year, month, 1 - startOffset);
  const today = new Date();

  const eventsByDay = new Map<string, CalendarEventItem[]>();
  for (const ev of events) {
    const d = parseUtc(ev.date);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const bucket = eventsByDay.get(key);
    if (bucket) bucket.push(ev);
    else eventsByDay.set(key, [ev]);
  }

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    cells.push({
      date,
      inCurrentMonth: date.getMonth() === month,
      isToday: isSameDay(date, today),
      events: (eventsByDay.get(key) ?? []).sort((a, b) => parseUtc(a.date).getTime() - parseUtc(b.date).getTime()),
    });
  }
  return cells;
}

const EVENT_STYLES: Record<CalendarEventItem['type'], { className: string; Icon: React.FC<{ className?: string }>; label: string }> = {
  assignment: {
    className: 'bg-primary/10 text-primary dark:text-primary-light border-primary/20',
    Icon: ClipboardList,
    label: 'Assignment',
  },
  meeting: {
    className: 'bg-secondary/10 text-secondary dark:text-secondary-light border-secondary/20',
    Icon: Video,
    label: 'Meeting',
  },
};

const CalendarPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [monthAnchor, setMonthAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    calendarService
      .getMyCalendar()
      .then((data) => {
        if (!cancelled) {
          setEvents(data);
          setError('');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load your calendar.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grid = useMemo(() => buildMonthGrid(monthAnchor, events), [monthAnchor, events]);

  const monthLabel = monthAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const goToToday = () => {
    const now = new Date();
    setMonthAnchor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDay(null);
  };
  const goPrevMonth = () => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const goNextMonth = () => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  // Same role-specific top section as the user's own dashboard, so the sidebar
  // looks identical everywhere instead of collapsing to just the global links.
  const navItems: NavItem[] = getPrimaryNavItems(user, navigate);

  const selectedDayEvents = selectedDay ? grid.find((c) => isSameDay(c.date, selectedDay))?.events ?? [] : [];

  return (
    <AppShell roleLabel="Calendar" logoIcon={CalendarDays} navItems={navItems}>
      <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Calendar</h1>
            <p className="text-text-secondary mt-1 text-sm">
              Assignment due dates and scheduled meetings across all your courses.
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400 rounded-xl p-3 text-xs">
            {error}
          </div>
        )}

        <div className="glass-panel rounded-2xl border border-border shadow-card p-4 sm:p-6">
          {/* Month navigation header */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="text-lg font-bold text-text-primary">{monthLabel}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={goToToday}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary-muted transition-all border border-border"
              >
                Today
              </button>
              <button
                onClick={goPrevMonth}
                aria-label="Previous month"
                className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary-muted transition-all border border-border"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={goNextMonth}
                aria-label="Next month"
                className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary-muted transition-all border border-border"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mb-4 text-xs text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-primary inline-block" /> Assignment due
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-secondary inline-block" /> Meeting
            </span>
          </div>

          {loading ? (
            <div className="text-center py-16 text-sm text-text-muted">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading calendar...
            </div>
          ) : (
            <>
              {/* Weekday header */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAY_LABELS.map((d) => (
                  <div key={d} className="text-center text-[11px] font-bold text-text-muted uppercase tracking-wider py-0.5">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-1">
                {grid.map((cell) => {
                  const isSelected = selectedDay && isSameDay(cell.date, selectedDay);
                  return (
                    <button
                      key={cell.date.toISOString()}
                      onClick={() => setSelectedDay(cell.date)}
                      className={`text-left min-h-[58px] sm:min-h-[68px] rounded-lg border p-1 flex flex-col gap-0.5 transition-all ${
                        cell.inCurrentMonth ? 'bg-background' : 'bg-background/40'
                      } ${
                        isSelected
                          ? 'border-primary ring-1 ring-primary/40'
                          : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <span
                        className={`text-[12px] font-bold w-5 h-5 flex items-center justify-center rounded-full shrink-0 ${
                          cell.isToday
                            ? 'bg-primary text-white'
                            : cell.inCurrentMonth
                            ? 'text-text-primary'
                            : 'text-text-muted'
                        }`}
                      >
                        {cell.date.getDate()}
                      </span>
                      <div className="flex flex-col gap-0.5 overflow-hidden">
                        {cell.events.slice(0, 3).map((ev) => {
                          const style = EVENT_STYLES[ev.type];
                          const Icon = style.Icon;
                          return (
                            <span
                              key={`${ev.type}-${ev.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/course/${ev.course_id}`);
                              }}
                              title={ev.title}
                              className={`flex items-center gap-0.5 px-1 py-px rounded border text-[9px] font-semibold truncate ${style.className}`}
                            >
                              <Icon className="w-2 h-2 shrink-0" />
                              <span className="truncate">{ev.title}</span>
                            </span>
                          );
                        })}
                        {cell.events.length > 3 && (
                          <span className="text-[9px] text-text-muted font-semibold px-1">
                            +{cell.events.length - 3} more
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Selected day detail panel */}
        {selectedDay && (
          <div className="glass-panel rounded-2xl border border-border shadow-card p-6 animate-fade-up">
            <h3 className="text-base font-bold text-text-primary mb-4">
              {selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </h3>
            {selectedDayEvents.length === 0 ? (
              <p className="text-sm text-text-muted">Nothing scheduled on this day.</p>
            ) : (
              <div className="space-y-2.5">
                {selectedDayEvents.map((ev) => {
                  const style = EVENT_STYLES[ev.type];
                  const Icon = style.Icon;
                  return (
                    <div
                      key={`${ev.type}-${ev.id}`}
                      onClick={() => navigate(`/course/${ev.course_id}`)}
                      className="flex items-center justify-between gap-3 border border-border rounded-xl p-3.5 hover:bg-background hover:border-primary/30 cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${style.className}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-text-primary truncate">{ev.title}</p>
                          <p className="text-xs text-text-muted truncate">
                            {style.label} &middot; {ev.course_name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-text-muted flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {parseUtc(ev.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </span>
                        {ev.points !== null && (
                          <span className="text-xs font-bold text-text-muted">{ev.points} pts</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!loading && events.length === 0 && !error && (
          <div className="text-center py-8 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
            <EmptyStateIllustration className="w-28 h-28 mx-auto mb-2" />
            No assignments or meetings scheduled yet.
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default CalendarPage;
