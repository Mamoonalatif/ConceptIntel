// Purpose: student dashboard to-do list of assignments with sort (due date/course) and status filters, auto-refreshing.
import React, { useEffect, useState } from 'react';
import { ListChecks, Clock, AlertTriangle, CheckCircle2, RefreshCw, ArrowUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { studentService } from '../services/api';
import type { TodoItem } from '../services/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { parseUtc } from '../lib/time';
import { EmptyStateIllustration } from './illustrations';
import { apiErrorMessage } from '../lib/apiError';

// Sort options sent to the API, and the filter tabs shown above the list.
type SortKey = 'due_date' | 'course';
type FilterKey = 'all' | 'upcoming' | 'missing' | 'done';

// Tab definitions for the status filter row.
const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'missing', label: 'Missing' },
  { key: 'done', label: 'Done' },
];

// Maps an assignment status (submitted / late / missing) to its badge label, colours and icon.
function statusBadge(status: TodoItem['status']) {
  switch (status) {
    case 'submitted':
      return { label: 'Submitted', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20', Icon: CheckCircle2 };
    case 'late':
      return { label: 'Submitted (late)', className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20', Icon: Clock };
    default:
      return { label: 'Missing', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20', Icon: AlertTriangle };
  }
}

// Lists the student's assignments as clickable cards; clicking one opens its course.
export const ToDoList: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<SortKey>('due_date');
  const [filter, setFilter] = useState<FilterKey>('all');

  // Loads to-do items for the current sort/filter. `silent` is used by the background refresh so the spinner/errors don't flicker.
  const fetchItems = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await studentService.getTodo(sort, filter === 'all' ? undefined : filter);
      setItems(data);
      if (!silent) setError('');
    } catch (err) {
      if (!silent) setError(apiErrorMessage(err, 'Could not load your to-do list.'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Reload whenever the sort or filter changes.
  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, filter]);

  // Periodically re-fetch in the background to keep the list current.
  useAutoRefresh(() => fetchItems(true));

  return (
    <div className="bg-surface rounded-2xl p-6 border border-border animate-fade-up">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
          <ListChecks className="w-4.5 h-4.5 text-primary" />
          To-Do
        </h3>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-text-muted" />
          <select
            className="input-light text-xs py-1.5"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="due_date">Sort by due date</option>
            <option value="course">Sort by course</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-5 border-b border-border pb-3">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
              filter === tab.key
                ? 'bg-primary text-white'
                : 'text-text-muted hover:text-primary hover:bg-primary-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400 rounded-xl p-3 mb-4 text-xs">{error}</div>
      )}

      {/* Three states: loading spinner, empty message, or the list of assignment cards. */}
      {loading ? (
        <div className="text-center py-8 text-sm text-text-muted">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
          Loading...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm border-2 border-dashed border-border rounded-xl">
          <EmptyStateIllustration className="w-28 h-28 mx-auto mb-2" />
          Nothing here — you're all caught up.
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => {
            const badge = statusBadge(item.status);
            const BadgeIcon = badge.Icon;
            return (
              <div
                key={item.assignment_id}
                onClick={() => navigate(`/course/${item.course_id}`)}
                className="flex items-center justify-between gap-3 border border-border rounded-xl p-3.5 hover:bg-background hover:border-primary/30 cursor-pointer transition-all"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-text-primary truncate">{item.title}</p>
                  <p className="text-xs text-text-muted truncate">{item.course_name}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {item.due_date && (
                    <span className="text-xs text-text-muted flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {parseUtc(item.due_date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  )}
                  {item.points !== null && (
                    <span className="text-xs font-bold text-text-muted">{item.points} pts</span>
                  )}
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-bold border ${badge.className}`}>
                    <BadgeIcon className="w-3 h-3" /> {badge.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
