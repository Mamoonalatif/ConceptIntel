// Purpose: the course Content Library; browse, filter, sort, review (approve/reject), edit, export and delete generated study content.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Library, Search, Filter, ExternalLink, Download, Printer, FileJson, Trash2,
  Check, X, Layers, ListChecks, BookOpen, Sparkles, ShieldCheck, ShieldAlert,
  AlertTriangle, LayoutGrid, List, RefreshCw, Pencil, ArrowUpDown, Languages, ClipboardCheck,
} from 'lucide-react';
import { contentGenerationService } from '../../services/api';
import type { GeneratedContentItem } from '../../services/api';
import { EmptyStateIllustration } from '../illustrations';
import { downloadContentHtml, downloadContentJson, printContent } from '../../lib/contentExport';
import { apiErrorMessage } from '../../lib/apiError';
import { ContentEditor } from './ContentEditor';

// Props: course id, and whether the viewer is a teacher/manager (students only see approved items and fewer controls).
interface ContentLibraryProps {
  courseId: number;
  canManage: boolean;
}

// Label, icon and colour for each content type.
const TYPE_META: Record<string, { label: string; icon: React.ElementType; tint: string }> = {
  flashcard: { label: 'Flashcards', icon: Layers, tint: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20' },
  mcq: { label: 'Practice MCQs', icon: ListChecks, tint: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/20' },
  quiz: { label: 'Quiz', icon: ListChecks, tint: 'text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-500/10 border-fuchsia-200 dark:border-fuchsia-500/20' },
  study_guide: { label: 'Study Guide', icon: BookOpen, tint: 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-500/10 border-teal-200 dark:border-teal-500/20' },
  assignment: { label: 'Assignment', icon: ClipboardCheck, tint: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20' },
};

// Badge colours for each review status.
const STATUS_TINT: Record<string, string> = {
  Approved: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20',
  PendingReview: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20',
  Rejected: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20',
};

// Numeric ordering of difficulty levels, used for sorting.
const DIFF_ORDER: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };

// CSS class for a difficulty badge (defaults to medium).
const badgeClassFor = (d: string) => `badge-${(d || 'medium').toLowerCase()}`;

// Short human-readable size of an item (cards, points, rubric criteria or questions).
const itemSize = (item: GeneratedContentItem): string => {
  const p = item.payload || {};
  if (item.content_type === 'flashcard') return `${(p.cards || []).length} cards`;
  if (item.content_type === 'study_guide') return `${(p.key_points || []).length} points`;
  if (item.content_type === 'assignment') return `${(p.criteria || []).length} rubric criteria`;
  return `${(p.questions || []).length} questions`;
};

// Available sort orders.
type SortKey = 'newest' | 'oldest' | 'title' | 'concept' | 'difficulty';

/**
 * The library: where generated material is stored and used, as distinct from the
 * page where it is created.
 *
 * Splitting the two matters because they are different jobs done at different times.
 * Generating is a short, focused act with a composer and a lot of options; using the
 * result is browsing, filtering, reviewing, exporting and handing out. Cramming both
 * into one screen meant the composer pushed the library below the fold and the
 * library's filters cluttered the composer.
 */
export const ContentLibrary: React.FC<ContentLibraryProps> = ({ courseId, canManage }) => {
  // Data and UI state: items from the server, loading/error, item being edited, filters, sort order, grid/list view, and bulk-selection.
  const [items, setItems] = useState<GeneratedContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<GeneratedContentItem | null>(null);

  const [search, setSearch] = useState('');
  const [fType, setFType] = useState('');
  const [fDiff, setFDiff] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fConcept, setFConcept] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Fetches all content items for this course.
  const load = async () => {
    setLoading(true);
    try {
      setItems(await contentGenerationService.list(courseId));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the content library.'));
    } finally {
      setLoading(false);
    }
  };

  // Load the library on mount and when the course changes.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // Distinct concept names present in the library (feeds the concept filter dropdown).
  const concepts = useMemo(
    () => Array.from(new Set(items.map((i) => i.concept_name).filter(Boolean))).sort(),
    [items]
  );

  // Applies search text and filters, then sorts; recomputed only when its inputs change.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((i) =>
      (!fType || i.content_type === fType) &&
      (!fDiff || (i.difficulty || 'Medium') === fDiff) &&
      (!fStatus || i.status === fStatus) &&
      (!fConcept || i.concept_name === fConcept) &&
      (!q || i.title.toLowerCase().includes(q) || (i.concept_name || '').toLowerCase().includes(q))
    );
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'oldest': return a.created_at.localeCompare(b.created_at);
        case 'title': return a.title.localeCompare(b.title);
        case 'concept':
          // Grouped by concept, then hardest-first within a concept - that ordering
          // matches how a teacher checks coverage of one topic at a time.
          return (a.concept_name || '').localeCompare(b.concept_name || '')
            || (DIFF_ORDER[b.difficulty] ?? 1) - (DIFF_ORDER[a.difficulty] ?? 1);
        case 'difficulty':
          return (DIFF_ORDER[a.difficulty] ?? 1) - (DIFF_ORDER[b.difficulty] ?? 1);
        default: return b.created_at.localeCompare(a.created_at);
      }
    });
    return sorted;
  }, [items, search, fType, fDiff, fStatus, fConcept, sort]);

  // Selections are dropped when they leave the filtered view, so a bulk action can
  // never silently hit an item the teacher can no longer see.
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(filtered.map((i) => i.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  // Summary numbers for the tiles at the top.
  const counts = useMemo(() => ({
    total: items.length,
    approved: items.filter((i) => i.status === 'Approved').length,
    pending: items.filter((i) => i.status === 'PendingReview').length,
    ungrounded: items.filter((i) => !i.grounded_excerpts).length,
  }), [items]);

  // Adds/removes one item from the selection.
  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // True when every currently visible item is selected (drives the "All" checkbox).
  const allVisibleSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  // Approves or rejects one item on the server and updates it in the list.
  const review = async (item: GeneratedContentItem, approve: boolean) => {
    try {
      const updated = await contentGenerationService.review(courseId, item.id, approve);
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save your review decision.'));
    }
  };

  // Deletes one item after a confirmation prompt.
  const remove = async (item: GeneratedContentItem) => {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    try {
      await contentGenerationService.remove(courseId, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete this item.'));
    }
  };

  /**
   * Bulk review. Runs sequentially rather than with Promise.all: these are writes that
   * each invalidate the API cache, and firing 40 at once against one backend process
   * is a good way to make the whole page feel broken. Failures are counted rather than
   * aborting, so one bad item does not strand the other 39.
   */
  const bulkReview = async (approve: boolean) => {
    const targets = filtered.filter((i) => selected.has(i.id) && i.status === 'PendingReview');
    if (!targets.length) {
      setError('None of the selected items are awaiting review.');
      return;
    }
    setBulkBusy(true);
    setError('');
    let failed = 0;
    for (const item of targets) {
      try {
        const updated = await contentGenerationService.review(courseId, item.id, approve);
        setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
      } catch {
        failed += 1;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (failed) setError(`${failed} of ${targets.length} item(s) could not be updated.`);
  };

  const bulkDelete = async () => {
    const targets = filtered.filter((i) => selected.has(i.id));
    if (!targets.length) return;
    if (!window.confirm(`Delete ${targets.length} item(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    setError('');
    let failed = 0;
    for (const item of targets) {
      try {
        await contentGenerationService.remove(courseId, item.id);
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      } catch {
        failed += 1;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (failed) setError(`${failed} of ${targets.length} item(s) could not be deleted.`);
  };

  // Opens the full content viewer for an item in a new browser tab.
  const openInNewTab = (item: GeneratedContentItem) =>
    window.open(`/content/${courseId}/${item.id}`, '_blank', 'noopener,noreferrer');

  // While an item is being edited, show the editor instead of the library.
  if (editing) {
    return (
      <ContentEditor
        courseId={courseId}
        item={editing}
        onCancel={() => setEditing(null)}
        onSaved={(updated) => {
          setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
          setEditing(null);
        }}
      />
    );
  }

  // Whether any filter is set (shows the "Clear filters" line).
  const filtersActive = !!(search || fType || fDiff || fStatus || fConcept);

  return (
    <div className="space-y-5">
      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 rounded-xl p-4 flex items-start gap-3 text-sm animate-fade-in">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}
        </div>
      )}

      {/* ── summary tiles. Clicking one filters to it, so a count is a way in
             rather than just a number to read. ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total items', value: counts.total, icon: Library, tint: 'text-primary', on: () => { setFStatus(''); setSearch(''); } },
          { label: 'Live for students', value: counts.approved, icon: Check, tint: 'text-emerald-500', on: () => setFStatus('Approved') },
          { label: 'Awaiting review', value: counts.pending, icon: Sparkles, tint: 'text-amber-500', on: () => setFStatus('PendingReview') },
          { label: 'Ungrounded', value: counts.ungrounded, icon: ShieldAlert, tint: 'text-rose-500', on: undefined },
        ].map((s) => (
          <button
            key={s.label}
            onClick={s.on}
            disabled={!s.on || !canManage}
            className={`bg-surface border border-border rounded-2xl p-4 text-left animate-fade-up transition-all ${
              s.on && canManage ? 'hover:border-primary/30 cursor-pointer' : 'cursor-default'
            }`}
          >
            <s.icon className={`w-4 h-4 mb-2 ${s.tint}`} />
            <p className="text-xl font-bold text-text-primary">{s.value}</p>
            <p className="text-[11px] text-text-muted uppercase tracking-wide">{s.label}</p>
          </button>
        ))}
      </div>

      {/* ── filter bar ── */}
      <div className="glass-panel rounded-2xl p-4 border border-border shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          {canManage && filtered.length > 0 && (
            <label className="flex items-center gap-1.5 text-[12px] text-text-secondary shrink-0 cursor-pointer">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((i) => i.id)))}
              />
              All
            </label>
          )}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="input-light w-full text-xs pl-9"
              placeholder="Search by title or concept..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Filter className="w-3.5 h-3.5 text-text-muted" />
          <select className="input-light text-xs py-1.5" value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <select className="input-light text-xs py-1.5" value={fDiff} onChange={(e) => setFDiff(e.target.value)}>
            <option value="">All levels</option>
            {['Easy', 'Medium', 'Hard'].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {canManage && (
            <select className="input-light text-xs py-1.5" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Any status</option>
              <option value="Approved">Approved</option>
              <option value="PendingReview">Pending review</option>
              <option value="Rejected">Rejected</option>
            </select>
          )}
          {concepts.length > 1 && (
            <select className="input-light text-xs py-1.5 max-w-[170px]" value={fConcept} onChange={(e) => setFConcept(e.target.value)}>
              <option value="">All concepts</option>
              {concepts.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <ArrowUpDown className="w-3.5 h-3.5 text-text-muted" />
          <select className="input-light text-xs py-1.5" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A–Z</option>
            <option value="concept">By concept</option>
            <option value="difficulty">Easy → Hard</option>
          </select>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {([{ key: 'grid', icon: LayoutGrid }, { key: 'list', icon: List }] as const).map(({ key, icon: I }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`p-1.5 transition-all ${view === key ? 'bg-primary-muted text-primary' : 'bg-surface text-text-muted hover:text-text-primary'}`}
                aria-label={`${key} view`}
              >
                <I className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
          <button onClick={load} className="btn-ghost text-xs px-2.5 py-1.5" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {filtersActive && (
          <p className="text-[12px] text-text-muted mt-2">
            Showing {filtered.length} of {items.length} items.
            <button
              onClick={() => { setSearch(''); setFType(''); setFDiff(''); setFStatus(''); setFConcept(''); }}
              className="ml-2 text-primary font-semibold hover:underline"
            >
              Clear filters
            </button>
          </p>
        )}
      </div>

      {/* ── bulk action bar. Only rendered when something is selected, so it never
             occupies space it has no use for. Reviewing 40 items one card at a time
             was the most tedious thing about the old screen. ── */}
      {canManage && selected.size > 0 && (
        <div className="glass-panel rounded-2xl p-3 border border-primary/30 bg-primary-muted flex flex-wrap items-center justify-between gap-2 animate-fade-in sticky top-2 z-10">
          <span className="text-xs font-semibold text-text-primary">{selected.size} selected</span>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => bulkReview(true)} disabled={bulkBusy} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
              {bulkBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Approve
            </button>
            <button onClick={() => bulkReview(false)} disabled={bulkBusy} className="btn-ghost text-xs px-3 py-1.5 disabled:opacity-50">
              <X className="w-3.5 h-3.5" />
              Reject
            </button>
            <button onClick={bulkDelete} disabled={bulkBusy} className="btn-ghost text-xs px-3 py-1.5 text-rose-500 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
            <button onClick={() => setSelected(new Set())} className="btn-ghost text-xs px-3 py-1.5">Clear</button>
          </div>
        </div>
      )}

      {/* ── items ── */}
      {loading ? (
        <div className="glass-panel rounded-2xl p-6 border border-border shadow-card">
          <div className="shimmer-loader h-5 w-1/3 rounded mb-3" />
          <div className="shimmer-loader h-32 w-full rounded-xl" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 border border-border shadow-card text-center">
          <EmptyStateIllustration className="w-28 h-28 mx-auto mb-2" />
          <p className="text-sm text-text-secondary">
            {items.length === 0
              ? canManage
                ? 'Nothing generated yet — head to the Generate tab to make your first set.'
                : 'No study material has been approved for this course yet.'
              : 'No items match these filters.'}
          </p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((item) => (
            <GridCard
              key={item.id} item={item} canManage={canManage}
              selected={selected.has(item.id)} onToggleSelect={() => toggleSelect(item.id)}
              onOpen={() => openInNewTab(item)} onEdit={() => setEditing(item)}
              onDelete={() => remove(item)} onReview={(ok) => review(item, ok)}
            />
          ))}
        </div>
      ) : (
        /* A genuine dense table, not the same cards stacked - the only reason to switch
           views is to trade the visual weight of cards for rows you can scan. */
        <div className="glass-panel rounded-2xl border border-border shadow-card overflow-hidden">
          <div className="hidden md:flex items-center gap-3 px-4 py-2 border-b border-border bg-background text-[11px] font-bold uppercase tracking-wide text-text-muted">
            {canManage && <span className="w-4 shrink-0" />}
            <span className="flex-1">Title</span>
            <span className="w-32 shrink-0">Type</span>
            <span className="w-20 shrink-0">Level</span>
            <span className="w-24 shrink-0">Size</span>
            {canManage && <span className="w-24 shrink-0">Status</span>}
            <span className="w-28 shrink-0 text-right">Actions</span>
          </div>
          {filtered.map((item) => (
            <ListRow
              key={item.id} item={item} canManage={canManage}
              selected={selected.has(item.id)} onToggleSelect={() => toggleSelect(item.id)}
              onOpen={() => openInNewTab(item)} onEdit={() => setEditing(item)}
              onDelete={() => remove(item)} onReview={(ok) => review(item, ok)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ─────────────────────────── row renderers ─────────────────────────── */

// Props shared by the grid card and the list row renderers.
interface RowProps {
  item: GeneratedContentItem;
  canManage: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReview: (approve: boolean) => void;
}

// Small badge showing whether the content was written from course material ("grounded") and how many excerpts were used.
const GroundingChip: React.FC<{ item: GeneratedContentItem }> = ({ item }) => (
  <span
    className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border flex items-center gap-1 ${
      item.grounded_excerpts > 0
        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
        : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'
    }`}
    title={item.grounded_excerpts > 0
      ? `Written from ${item.grounded_excerpts} excerpt(s) of this course's own material.`
      : 'No course material matched - written from the concept description alone, so check it more carefully.'}
  >
    {item.grounded_excerpts > 0 ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
    {item.grounded_excerpts > 0 ? item.grounded_excerpts : 'Ungrounded'}
  </span>
);

// Card view of one content item: title, badges, export buttons, edit/delete and review actions.
const GridCard: React.FC<RowProps> = ({
  item, canManage, selected, onToggleSelect, onOpen, onEdit, onDelete, onReview,
}) => {
  const meta = TYPE_META[item.content_type] || TYPE_META.flashcard;
  const Icon = meta.icon;
  return (
    <div className={`glass-panel-interactive rounded-2xl border p-4 flex flex-col gap-3 animate-fade-up ${
      selected ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'
    }`}>
      <div className="flex items-start gap-3">
        {canManage && (
          <input type="checkbox" className="mt-1 shrink-0" checked={selected} onChange={onToggleSelect}
            aria-label={`Select ${item.title}`} />
        )}
        <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${meta.tint}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <button onClick={onOpen} className="text-sm font-bold text-text-primary hover:text-primary text-left line-clamp-2 transition-colors" title="Open in a new tab">
            {item.title}
          </button>
          <p className="text-[12px] text-text-muted mt-0.5 truncate">{item.concept_name}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${meta.tint}`}>{meta.label}</span>
        <span className={badgeClassFor(item.difficulty)}>{item.difficulty}</span>
        {/* Only shown when it is not English: on an otherwise English library, a
            "English" chip on every card is noise, while a "Spanish" one is the single
            most important thing about that set. */}
        {item.language && item.language.toLowerCase() !== 'english' && (
          <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 border border-border text-text-secondary flex items-center gap-1">
            <Languages className="w-3 h-3" />
            {item.language}
          </span>
        )}
        <span className="text-[11px] text-text-muted">{itemSize(item)}</span>
        {canManage && (
          <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 border ${STATUS_TINT[item.status] || STATUS_TINT.Rejected}`}>
            {item.status === 'PendingReview' ? 'Pending' : item.status}
          </span>
        )}
        {canManage && <GroundingChip item={item} />}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
        <button onClick={onOpen} className="btn-primary text-xs px-2.5 py-1.5">
          <ExternalLink className="w-3.5 h-3.5" />
          Open
        </button>
        <button onClick={() => printContent(item, canManage)} className="btn-ghost text-xs px-2 py-1.5" title="Print / save as PDF">
          <Printer className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => downloadContentHtml(item, canManage)} className="btn-ghost text-xs px-2 py-1.5" title="Download printable HTML">
          <Download className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => downloadContentJson(item)} className="btn-ghost text-xs px-2 py-1.5" title="Download raw JSON">
          <FileJson className="w-3.5 h-3.5" />
        </button>
        {canManage && (
          <>
            {/* An assignment draft is reviewed/approved by creating the real
                Assignment (see AssignmentDraftView's "Create Assignment"
                button, opened via onOpen below) - the generic questions/cards
                editor here doesn't know its shape, and approving it through
                the ordinary review action would mark it Approved without ever
                creating the Assignment + Rubric rows that make it real. */}
            {item.content_type !== 'assignment' && (
              <button onClick={onEdit} className="btn-ghost text-xs px-2 py-1.5" title="Edit this content">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onDelete} className="btn-ghost text-xs px-2 py-1.5 text-rose-500" title="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {canManage && item.status === 'PendingReview' && (
        <div className="flex gap-2 pt-2 border-t border-border">
          {/* An assignment draft can't be approved through this generic action -
              see the comment on the Edit button above and ContentLibrary's list-row
              layout, which already has this same guard. The backend rejects it
              with a 400 either way, but showing the button at all here was
              misleading - "approve this" for something clicking Approve can't
              actually approve. Reject is unaffected: rejecting an assignment
              draft doesn't need to create anything, so the backend allows it. */}
          {item.content_type !== 'assignment' && (
            <button onClick={() => onReview(true)} className="flex-1 justify-center btn-primary text-xs px-3 py-1.5">
              <Check className="w-3.5 h-3.5" />
              Approve
            </button>
          )}
          <button onClick={() => onReview(false)} className="flex-1 justify-center btn-ghost text-xs px-3 py-1.5 text-rose-500">
            <X className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      )}
    </div>
  );
};

// Compact table-row view of one content item with the same actions as the card.
const ListRow: React.FC<RowProps> = ({
  item, canManage, selected, onToggleSelect, onOpen, onEdit, onDelete, onReview,
}) => {
  const meta = TYPE_META[item.content_type] || TYPE_META.flashcard;
  const Icon = meta.icon;
  return (
    <div className={`flex flex-wrap md:flex-nowrap items-center gap-3 px-4 py-2.5 border-b border-border last:border-0 transition-colors ${
      selected ? 'bg-primary-muted' : 'hover:bg-background'
    }`}>
      {canManage && (
        <input type="checkbox" className="shrink-0" checked={selected} onChange={onToggleSelect}
          aria-label={`Select ${item.title}`} />
      )}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" />
        <button onClick={onOpen} className="text-xs font-semibold text-text-primary hover:text-primary truncate text-left" title={item.title}>
          {item.title}
        </button>
        {canManage && item.grounded_excerpts === 0 && (
          <ShieldAlert className="w-3 h-3 text-amber-500 shrink-0" aria-label="Ungrounded" />
        )}
      </div>
      <span className="w-32 shrink-0 text-[12px] text-text-secondary truncate">{meta.label}</span>
      <span className="w-20 shrink-0"><span className={badgeClassFor(item.difficulty)}>{item.difficulty}</span></span>
      <span className="w-24 shrink-0 text-[12px] text-text-muted">{itemSize(item)}</span>
      {canManage && (
        <span className="w-24 shrink-0">
          <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 border ${STATUS_TINT[item.status] || STATUS_TINT.Rejected}`}>
            {item.status === 'PendingReview' ? 'Pending' : item.status}
          </span>
        </span>
      )}
      <div className="w-28 shrink-0 flex items-center justify-end gap-0.5">
        <button onClick={onOpen} className="p-1.5 text-text-muted hover:text-primary rounded" title="Open in a new tab">
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => printContent(item, canManage)} className="p-1.5 text-text-muted hover:text-primary rounded" title="Print">
          <Printer className="w-3.5 h-3.5" />
        </button>
        {canManage && (
          <>
            {/* Assignment drafts skip the generic approve/edit actions - see the
                comment on the equivalent buttons in the grid card above. */}
            {item.status === 'PendingReview' && item.content_type !== 'assignment' && (
              <button onClick={() => onReview(true)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded" title="Approve">
                <Check className="w-3.5 h-3.5" />
              </button>
            )}
            {item.content_type !== 'assignment' && (
              <button onClick={onEdit} className="p-1.5 text-text-muted hover:text-primary rounded" title="Edit">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onDelete} className="p-1.5 text-text-muted hover:text-rose-500 rounded" title="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ContentLibrary;
