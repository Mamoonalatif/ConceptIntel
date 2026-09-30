// Purpose: the common page layout for every logged-in screen: sidebar navigation, top bar (theme, notifications, profile menu) and content area.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';
import { ChangePasswordModal } from './ChangePasswordModal';
import { useNavigate, useLocation } from 'react-router-dom';
import { KeyRound, LogOut, Menu, X, CalendarDays, Sparkles, Settings, Bell, User, ChevronDown, BarChart3, Wand2, BookOpen, Network, LibraryBig, type LucideIcon } from 'lucide-react';
import { courseService, enrollmentService } from '../services/api';
import { Avatar } from './Avatar';
import { FoxMark } from '../components/FoxMark';

// One entry in the sidebar; may be top-level or an indented course/section link.
export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  /** Optional small trailing indicator (e.g. a colored dot or count). */
  badge?: React.ReactNode;
  /** Renders as a smaller, indented row (used for per-course links under a section). */
  nested?: boolean;
  /**
   * Indent level. 1 = a course under "My Courses"/"My Classes"; 2 = a section
   * within the course you are currently looking at. Omitted (or 0) is a top-level
   * item. `nested: true` is treated as depth 1 for backwards compatibility.
   */
  depth?: 0 | 1 | 2;
}

// Props: role subtitle, the page's own nav items, page content, and optional top-right action buttons.
interface AppShellProps {
  /** Small subtitle shown under the app name, e.g. "Student Hub", "Admin Console". */
  roleLabel: string;
  /** Icon shown in the logo badge at the top of the sidebar (defaults to GraduationCap). */
  logoIcon?: LucideIcon;
  navItems: NavItem[];
  children: React.ReactNode;
  /** Page-specific action button(s) (e.g. "Join a class"), rendered top-right of the content area. */
  headerActions?: React.ReactNode;
}

/**
 * Shared persistent left-sidebar app shell used by every role dashboard and
 * CourseDetail. Replaces the old per-page sticky glass-panel `<header>` markup.
 *
 * Structure: fixed-width sidebar (logo + role label, nav list, user/actions
 * footer) + a flat scrollable main content area. Collapses into a slide-out
 * drawer behind a hamburger button below the `lg:` breakpoint.
 */
export const AppShell: React.FC<AppShellProps> = ({ roleLabel, navItems, children, headerActions }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // UI state: change-password modal, mobile drawer, notification dropdown and profile menu visibility; ref used for click-outside on the profile menu.
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // While the profile menu is open, close it when the user clicks outside of it.
  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [profileMenuOpen]);

  // Global nav items available to every role, appended below the page's own
  // role-specific navItems - Calendar/Assistant/Settings aren't dashboard
  // sections, they're app-wide destinations (their own routes).
  // Content Studio is deliberately NOT here. It is always scoped to one course, so a
  // global entry would land you on whichever course happened to be first and make you
  // re-pick - the per-course link nested under the active course (below) is the only
  // way in that already knows which course you mean.
  // `active` is derived from the current URL so the right row is highlighted.
  const globalNavItems: NavItem[] = [
    { key: 'calendar', label: 'Calendar', icon: CalendarDays, active: location.pathname === '/calendar', onClick: () => navigate('/calendar') },
    { key: 'analytics', label: 'Analytics', icon: BarChart3, active: location.pathname === '/analytics', onClick: () => navigate('/analytics') },
    { key: 'assistant', label: 'AI Assistant', icon: Sparkles, active: location.pathname === '/assistant', onClick: () => navigate('/assistant') },
    { key: 'settings', label: 'Settings', icon: Settings, active: location.pathname === '/settings', onClick: () => navigate('/settings') },
  ];

  // ── Per-course sidebar navigation ──
  // Fetched here rather than in each page's getPrimaryNavItems() so every screen
  // shows the same course list without 15 call sites having to load it. Purely a
  // convenience layer: a failure leaves the sidebar exactly as it was.
  const [myCourses, setMyCourses] = useState<{ id: number; name: string }[]>([]);

  // Load the user's courses (teacher: courses they teach; student: courses they are enrolled in) for the sidebar; de-duplicated by id.
  useEffect(() => {
    if (!user) { setMyCourses([]); return; }
    let cancelled = false;
    (async () => {
      try {
        // Two endpoints, two shapes: getTeacherCourses() returns courses, while
        // getMyCourses() returns enrollments with the course nested under `course`.
        const list =
          user.role === 'teacher'
            ? ((await courseService.getTeacherCourses()) || []).map((c: any) => ({ id: c.id, name: c.name }))
            : user.role === 'student'
            ? ((await enrollmentService.getMyCourses()) || [])
                .map((e: any) => e.course)
                .filter(Boolean)
                .map((c: any) => ({ id: c.id, name: c.name }))
            : [];
        if (!cancelled) {
          const seen = new Set<number>();
          const deduped = list.filter((c: any) => c.id && c.name && !seen.has(c.id) && seen.add(c.id));
          setMyCourses(deduped);
        }
      } catch {
        // Sidebar courses are additive - never let this break the shell.
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  // Which course the user is currently looking at, from either /course/:id[/graph]
  // or /content-studio?course=:id. Drives which course expands its sub-sections.
  // Course id taken from the URL (used to expand the current course's sub-links).
  const activeCourseId = useMemo(() => {
    const m = location.pathname.match(/^\/course\/(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (location.pathname === '/content-studio') {
      const q = parseInt(new URLSearchParams(location.search).get('course') || '', 10);
      return Number.isFinite(q) ? q : null;
    }
    return null;
  }, [location.pathname, location.search]);

  // The studio's open tab, so Content Studio and Content Library can highlight
  // separately even though they are the same route. Absent means the page's own
  // default, which is Generate for anyone who can author and the library otherwise.
  // Which Content Studio tab is open, so Studio and Library can be highlighted separately.
  const studioTab = useMemo(() => {
    if (location.pathname !== '/content-studio') return null;
    return new URLSearchParams(location.search).get('tab')
      || (user?.role === 'student' ? 'library' : 'generate');
  }, [location.pathname, location.search, user?.role]);

  // Splice the course list in directly beneath the role's own "My Courses" /
  // "My Classes" entry, and expand the active course into its sections.
  // Builds the final sidebar list by inserting each course (and, for the active one, Concept Graph / Content Studio / Content Library links) under the role's courses entry.
  const expandedNavItems = useMemo<NavItem[]>(() => {
    const anchorKey = user?.role === 'teacher' ? 'courses' : 'classes';
    const idx = navItems.findIndex((i) => i.key === anchorKey);
    if (idx === -1 || myCourses.length === 0) return navItems;

    const children: NavItem[] = [];
    for (const c of myCourses) {
      const isActive = c.id === activeCourseId;
      children.push({
        key: `course-${c.id}`,
        label: c.name,
        icon: BookOpen,
        depth: 1,
        active: isActive && location.pathname === `/course/${c.id}`,
        onClick: () => navigate(`/course/${c.id}`),
      });
      if (!isActive) continue;
      // Three destinations, not two. The library used to be a tab you could only
      // reach by opening the studio first and then noticing it - which made the
      // place all the finished material lives the hardest thing in the course to
      // find. They are separate jobs (map the course, make material, use material)
      // so they get separate rows.
      children.push({
        key: `course-${c.id}-graph`,
        label: 'Concept Graph',
        icon: Network,
        depth: 2,
        active: location.pathname === `/course/${c.id}/graph`,
        onClick: () => navigate(`/course/${c.id}/graph`),
      });
      // Authoring only. The studio's Generate surface renders nothing for a student,
      // so a row that took them to a blank page would be worse than no row - they
      // reach the study modes from the library's own tab strip.
      if (user?.role !== 'student') {
        children.push({
          key: `course-${c.id}-studio`,
          label: 'Content Studio',
          icon: Wand2,
          depth: 2,
          active: studioTab !== null && studioTab !== 'library',
          onClick: () => navigate(`/content-studio?course=${c.id}&tab=generate`),
        });
      }
      children.push({
        key: `course-${c.id}-library`,
        label: 'Content Library',
        icon: LibraryBig,
        depth: 2,
        active: studioTab === 'library',
        onClick: () => navigate(`/content-studio?course=${c.id}&tab=library`),
      });
    }

    const out = [...navItems];
    out.splice(idx + 1, 0, ...children);
    return out;
  }, [navItems, myCourses, activeCourseId, location.pathname, studioTab, user?.role, navigate]);

  // Renders one sidebar row as a button, styled by nesting depth and active state; closes the mobile drawer on click.
  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const depth = item.depth ?? (item.nested ? 1 : 0);

    // Selection is a filled row plus a left accent bar, which is what a vertical nav
    // is read as: one row out of a column is currently the page. The previous
    // treatment underlined the label text, which reads as a hyperlink rather than a
    // selected row, and left the row itself looking untouched.
    //
    // Nesting is carried by indent, type size and a guide line down the left. The
    // guide is drawn as a pseudo-element deliberately overhanging the row by the
    // exact size of the list gap (space-y-1 = 4px, so 2px at each end), because a
    // plain border-l on each row renders as a column of dashes with a gap between
    // every pair - it looks broken rather than like a tree.
    const guide =
      "before:content-[''] before:absolute before:left-0 before:-top-0.5 before:-bottom-0.5 before:w-px";

    const depthClasses =
      depth === 0
        ? 'px-3 py-2.5 text-sm'
        : depth === 1
        ? `ml-3 pl-3.5 pr-3 py-2 text-[13px] ${guide} ${item.active ? 'before:bg-primary/50' : 'before:bg-border'}`
        : `ml-7 pl-3.5 pr-3 py-1.5 text-xs ${guide} ${item.active ? 'before:bg-primary/50' : 'before:bg-border'}`;

    const stateClasses = item.active
      ? depth === 0
        ? 'bg-primary-muted text-primary font-bold'
        : 'bg-primary-muted/70 text-primary font-bold'
      : 'text-text-secondary hover:text-text-primary hover:bg-background';

    // Rounded on the right only for nested rows, so the fill does not cut across the
    // guide line it is sitting against.
    const radius = depth === 0 ? 'rounded-lg' : 'rounded-r-lg';

    const baseClasses =
      `relative w-full flex items-center gap-2.5 font-semibold transition-all text-left ${radius} ${depthClasses} ${stateClasses}`;

    const iconSize = depth === 0 ? 'w-4.5 h-4.5' : depth === 1 ? 'w-4 h-4' : 'w-3.5 h-3.5';

    return (
      <button
        key={item.key}
        onClick={() => {
          item.onClick?.();
          setMobileOpen(false);
        }}
        className={baseClasses}
        title={item.label}
        aria-current={item.active ? 'page' : undefined}
      >
        {/* The accent bar. Only on top-level rows: at depth 1 and 2 it would sit on
            top of the guide line and read as a rendering glitch. */}
        {item.active && depth === 0 && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-primary" />
        )}
        <Icon className={`${iconSize} shrink-0 ${item.active ? '' : 'opacity-70'}`} />
        <span className="truncate">{item.label}</span>
        <span className="flex-1" />
        {item.badge}
      </button>
    );
  };

  // Sidebar contents (logo, role label, nav lists); reused in both the desktop sidebar and the mobile drawer.
  const sidebarBody = (
    <>
      {/* Logo — same mark used on the public landing page, for one consistent brand image everywhere. */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-border shrink-0">
        <FoxMark className="w-9 h-9 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-base font-bold gradient-text leading-tight truncate">ConceptIntel</h1>
          <p className="text-[11px] text-text-muted truncate">{roleLabel}</p>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden ml-auto p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-background"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nav: page's own role-specific sections, then app-wide destinations.
          Sidebar is nav-only now - account/notification controls live in the
          top bar instead (see topBar below), not mixed into the nav list. */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {expandedNavItems.map(renderNavItem)}
        <div className="pt-3 mt-3 border-t border-border space-y-1">
          {globalNavItems.map(renderNavItem)}
        </div>
      </nav>
    </>
  );

  // Top bar: page title + account/notification controls. Lives above the
  // scrollable content, not inside the sidebar - a persistent top navbar
  // (not just a mobile fallback), sticky within the main column so it stays
  // visible on every page regardless of scroll position.
  // Sticky top bar with the mobile menu button, role title, theme toggle, notifications and the profile dropdown.
  const topBar = (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-3 bg-surface border-b border-border shadow-soft">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden p-1.5 -ml-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-background shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>
        <p className="text-sm font-bold text-text-primary truncate">{roleLabel}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <ThemeToggle />
        <NotificationBell open={notifOpen} onOpenChange={setNotifOpen} />

        {/* Profile toggle — clicking the avatar/name opens a dropdown menu
            (rather than navigating straight to /profile) so account actions,
            including a Notifications entry, live in one place. */}
        <div className="relative pl-2 ml-1 border-l border-border" ref={profileMenuRef}>
          <button
            onClick={() => setProfileMenuOpen(v => !v)}
            className="flex items-center gap-2 group"
            title="Account menu"
          >
            <Avatar userId={user?.id} hasAvatar={!!user?.avatar_url} version={user?.avatar_url} fullName={user?.full_name} size="sm" />
            <span className="hidden md:block text-sm font-semibold text-text-primary group-hover:text-primary dark:group-hover:text-primary-light transition-colors truncate max-w-[140px]">
              {user?.full_name}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {profileMenuOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-surface rounded-2xl shadow-hover border border-border overflow-hidden z-50 animate-fade-in">
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-background">
                <Avatar userId={user?.id} hasAvatar={!!user?.avatar_url} version={user?.avatar_url} fullName={user?.full_name} size="md" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text-primary truncate">{user?.full_name}</p>
                  <p className="text-xs text-text-muted truncate">{roleLabel}</p>
                </div>
              </div>
              <div className="py-1.5">
                <button
                  onClick={() => { setProfileMenuOpen(false); navigate('/profile'); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-text-secondary hover:text-primary hover:bg-primary-muted transition-all"
                >
                  <User className="w-4 h-4" /> View Profile
                </button>
                <button
                  onClick={() => { setProfileMenuOpen(false); setNotifOpen(true); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-text-secondary hover:text-primary hover:bg-primary-muted transition-all"
                >
                  <Bell className="w-4 h-4" /> Notifications
                </button>
                <button
                  onClick={() => { setProfileMenuOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-text-secondary hover:text-primary hover:bg-primary-muted transition-all"
                >
                  <Settings className="w-4 h-4" /> Settings
                </button>
                <button
                  onClick={() => { setProfileMenuOpen(false); setShowChangePassword(true); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-text-secondary hover:text-primary hover:bg-primary-muted transition-all"
                >
                  <KeyRound className="w-4 h-4" /> Change Password
                </button>
                <div className="my-1.5 border-t border-border" />
                <button
                  onClick={() => { setProfileMenuOpen(false); logout(); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all"
                >
                  <LogOut className="w-4 h-4" /> Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-[248px] shrink-0 h-screen sticky top-0 bg-surface border-r border-border">
        {sidebarBody}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[248px] bg-surface border-r border-border flex flex-col animate-slide-in">
            {sidebarBody}
          </div>
        </div>
      )}

      {/* Main column: persistent top bar (title + account/notification
          controls), then scrollable content below it. */}
      <div className="flex-1 min-h-screen flex flex-col">
        {topBar}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {headerActions && (
              <div className="flex items-center justify-end gap-3 mb-6">
                {headerActions}
              </div>
            )}
            {children}
          </div>
        </main>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
};

export default AppShell;
