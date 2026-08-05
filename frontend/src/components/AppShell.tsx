import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';
import { ChangePasswordModal } from './ChangePasswordModal';
import { useNavigate, useLocation } from 'react-router-dom';
import { KeyRound, LogOut, Menu, X, CalendarDays, Sparkles, Settings, Bell, User, ChevronDown, BarChart3, type LucideIcon } from 'lucide-react';
import { Avatar } from './Avatar';
import logo from '../assets/logo.png';

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
}

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
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

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
  const globalNavItems: NavItem[] = [
    { key: 'calendar', label: 'Calendar', icon: CalendarDays, active: location.pathname === '/calendar', onClick: () => navigate('/calendar') },
    { key: 'analytics', label: 'Analytics', icon: BarChart3, active: location.pathname === '/analytics', onClick: () => navigate('/analytics') },
    { key: 'assistant', label: 'AI Assistant', icon: Sparkles, active: location.pathname === '/assistant', onClick: () => navigate('/assistant') },
    { key: 'settings', label: 'Settings', icon: Settings, active: location.pathname === '/settings', onClick: () => navigate('/settings') },
  ];

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    // Every item sits in one flat list (no indented sub-list, no colored side
    // bar) - the active tab is marked by a short underline directly beneath
    // its own label text (not a line spanning the full row width).
    const baseClasses = `w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all text-left ${
      item.active ? 'text-primary font-bold' : 'text-text-secondary hover:text-text-primary'
    }`;

    const content = (
      <>
        <Icon className="w-4.5 h-4.5 shrink-0" />
        <span className={`truncate ${item.active ? 'underline decoration-2 decoration-primary underline-offset-4' : ''}`}>
          {item.label}
        </span>
        <span className="flex-1" />
        {item.badge}
      </>
    );

    return (
      <button
        key={item.key}
        onClick={() => {
          item.onClick?.();
          setMobileOpen(false);
        }}
        className={baseClasses}
        title={item.label}
      >
        {content}
      </button>
    );
  };

  const sidebarBody = (
    <>
      {/* Logo — same mark used on the public landing page, for one consistent brand image everywhere. */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-border shrink-0">
        <img src={logo} alt="ConceptIntel" width={36} height={36} className="w-9 h-9 object-contain shrink-0" />
        <div className="min-w-0">
          <h1 className="text-base font-bold gradient-text leading-tight truncate">ConceptIntel</h1>
          <p className="text-[10px] text-text-muted truncate">{roleLabel}</p>
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
        {navItems.map(renderNavItem)}
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
