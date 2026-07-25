import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';
import { ChangePasswordModal } from './ChangePasswordModal';
import { useNavigate, useLocation } from 'react-router-dom';
import { GraduationCap, KeyRound, LogOut, Menu, X, CalendarDays, Sparkles, Settings, type LucideIcon } from 'lucide-react';
import { Avatar } from './Avatar';

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
export const AppShell: React.FC<AppShellProps> = ({ roleLabel, logoIcon: LogoIcon = GraduationCap, navItems, children, headerActions }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Global nav items available to every role, appended below the page's own
  // role-specific navItems - Calendar/Assistant/Settings aren't dashboard
  // sections, they're app-wide destinations (their own routes).
  const globalNavItems: NavItem[] = [
    { key: 'calendar', label: 'Calendar', icon: CalendarDays, active: location.pathname === '/calendar', onClick: () => navigate('/calendar') },
    { key: 'assistant', label: 'AI Assistant', icon: Sparkles, active: location.pathname === '/assistant', onClick: () => navigate('/assistant') },
    { key: 'settings', label: 'Settings', icon: Settings, active: location.pathname === '/settings', onClick: () => navigate('/settings') },
  ];

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const baseClasses = `w-full flex items-center gap-3 rounded-lg text-sm font-semibold transition-all text-left ${
      item.nested ? 'pl-8 pr-3 py-2 text-[13px]' : 'px-3 py-2.5'
    } ${
      item.active
        ? 'bg-gradient-to-r from-primary/8 to-primary/0 text-primary border-l-4 border-primary font-bold'
        : 'border-l-4 border-transparent text-text-secondary hover:bg-card hover:text-text-primary'
    }`;

    const content = (
      <>
        <Icon className={item.nested ? 'w-4 h-4 shrink-0' : 'w-4.5 h-4.5 shrink-0'} />
        <span className="truncate flex-1">{item.label}</span>
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
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-border shrink-0">
        <div className="w-9 h-9 bg-gradient-to-tr from-primary to-secondary rounded-xl flex items-center justify-center shadow-glow shrink-0">
          <LogoIcon className="w-5 h-5 text-white" />
        </div>
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
        <NotificationBell />
        <button
          onClick={() => setShowChangePassword(true)}
          className="p-2 text-text-muted hover:text-primary dark:hover:text-primary-light rounded-lg hover:bg-primary-muted border border-transparent hover:border-primary/20 transition-all"
          title="Change Password"
        >
          <KeyRound className="w-4 h-4" />
        </button>
        <button
          onClick={logout}
          className="p-2 text-text-muted hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-transparent hover:border-rose-200 dark:hover:border-rose-500/30 transition-all"
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => navigate('/profile')}
          className="flex items-center gap-2 pl-2 ml-1 border-l border-border group"
          title="View Profile"
        >
          <Avatar userId={user?.id} hasAvatar={!!user?.avatar_url} fullName={user?.full_name} size="sm" />
          <span className="hidden md:block text-sm font-semibold text-text-primary group-hover:text-primary dark:group-hover:text-primary-light transition-colors truncate max-w-[140px]">
            {user?.full_name}
          </span>
        </button>
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
