import { Link, useLocation } from 'react-router';
import { Brain, ChevronLeft, ChevronRight, Moon, Sun, LogOut } from 'lucide-react';
import { cn } from '../ui/utils';
import { Button } from '../ui/button';
import { useTheme } from '../../context/ThemeContext';
import type { NavItem, UserRole } from '../../config/navigation';
import { roleLabels } from '../../config/navigation';

interface AppSidebarProps {
  role: UserRole;
  items: NavItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function AppSidebar({
  role,
  items,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileClose,
}: AppSidebarProps) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const isActive = (href: string) => {
    if (href.includes('/latest/')) return location.pathname.includes(href.split('/latest')[1]);
    return location.pathname === href || location.pathname.startsWith(href + '/');
  };

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn('flex items-center gap-3 px-4 py-5 border-b border-sidebar-border', collapsed && 'justify-center px-2')}>
        <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
          <Brain className="w-6 h-6 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-bold text-lg leading-tight truncate">ConceptIntel</p>
            <p className="text-xs text-muted-foreground">{roleLabels[role]} Portal</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href + item.title}
              to={item.href}
              onClick={onMobileClose}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                active
                  ? 'bg-primary/15 text-primary border border-primary/20 shadow-sm'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
                collapsed && 'justify-center px-2'
              )}
              title={collapsed ? item.title : undefined}
            >
              <item.icon className={cn('w-5 h-5 shrink-0', active && 'text-primary')} />
              {!collapsed && <span className="truncate">{item.title}</span>}
              {!collapsed && item.badge && (
                <span className="ml-auto text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3 space-y-1">
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'default'}
          className={cn('w-full', !collapsed && 'justify-start')}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          {!collapsed && <span className="ml-2">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
        </Button>
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'default'}
          className={cn('w-full text-muted-foreground', !collapsed && 'justify-start')}
          asChild
        >
          <Link to="/login" onClick={onMobileClose}>
            <LogOut className="w-5 h-5" />
            {!collapsed && <span className="ml-2">Sign Out</span>}
          </Link>
        </Button>
        {!collapsed && (
          <div className="flex items-center gap-3 px-3 py-2 mt-2 rounded-xl bg-sidebar-accent">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-sm font-medium shrink-0">
              DS
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">Dr. Smith</p>
              <p className="text-xs text-muted-foreground truncate">{roleLabels[role]}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-sidebar-border transform transition-transform lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col shrink-0 bg-sidebar border-r border-sidebar-border transition-all duration-300 relative',
          collapsed ? 'w-[72px]' : 'w-64'
        )}
      >
        {sidebarContent}
        <button
          onClick={onToggleCollapse}
          className="absolute -right-3 top-20 z-10 hidden lg:flex w-6 h-6 items-center justify-center rounded-full bg-card border border-border shadow-sm hover:bg-muted transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>
    </>
  );
}
