import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, Trash2, Info, CheckCircle2, AlertTriangle, XCircle,
} from 'lucide-react';
import { notificationService } from '../services/api';
import type { NotificationItem } from '../services/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { timeAgo } from '../lib/time';
import { EmptyStateIllustration } from './illustrations';

const PRIORITY_STYLES: Record<string, { icon: React.ElementType; className: string }> = {
  info: { icon: Info, className: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/10' },
  success: { icon: CheckCircle2, className: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10' },
  warning: { icon: AlertTriangle, className: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/10' },
  error: { icon: XCircle, className: 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/10' },
};

interface NotificationBellProps {
  /** Controlled open state (e.g. driven by the profile dropdown's "Notifications"
   *  entry). When omitted, the bell manages its own open/close state as before. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ open: controlledOpen, onOpenChange }) => {
  const navigate = useNavigate();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof value === 'function' ? (value as (prev: boolean) => boolean)(open) : value;
    onOpenChange?.(resolved);
    setUncontrolledOpen(resolved);
  };
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Highest notification id already surfaced as a desktop popup (or seen at initial
  // load) - only ids above this trigger a new popup, so a page refresh doesn't
  // re-fire desktop notifications for everything already unread.
  const lastSeenIdRef = useRef<number | null>(null);

  const fireDesktopNotification = (item: NotificationItem) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const popup = new Notification(item.title, {
      body: item.message,
      tag: `conceptintel-notif-${item.id}`,
    });
    popup.onclick = () => {
      window.focus();
      if (item.link) navigate(item.link);
      popup.close();
    };
  };

  const fetchList = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await notificationService.list({ limit: 20 });
      setItems(data.items);
      setUnreadCount(data.unread_count);
    } catch {
      // Silent - dropdown keeps showing the last successfully fetched list.
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Polls the small unread-only list (not just the count) so newly-arrived items
  // can be diffed against lastSeenIdRef and popped as native desktop notifications
  // even while the dropdown is closed - a plain count can't tell us what's new.
  const pollForNew = async () => {
    try {
      const data = await notificationService.list({ unread_only: true, limit: 10 });
      setUnreadCount(data.unread_count);

      if (lastSeenIdRef.current === null) {
        // First poll after mount - just establish the baseline, don't notify for
        // items that were already unread before this tab was opened.
        lastSeenIdRef.current = data.items.reduce((max, n) => Math.max(max, n.id), 0);
      } else {
        const freshItems = data.items.filter((n) => n.id > lastSeenIdRef.current!);
        freshItems.forEach(fireDesktopNotification);
        if (freshItems.length) {
          lastSeenIdRef.current = Math.max(lastSeenIdRef.current, ...freshItems.map((n) => n.id));
        }
      }
    } catch {
      // Silent - the badge/popups just won't update this cycle.
    }
    if (open) fetchList(true);
  };

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    pollForNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useAutoRefresh(() => pollForNew(), 15000);

  useEffect(() => {
    if (open) fetchList();
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.is_read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await notificationService.markRead(item.id);
      } catch {
        // Best-effort - the item stays visually read on this device regardless.
      }
    }
    setOpen(false);
    if (item.link) navigate(item.link);
  };

  const handleMarkAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try {
      await notificationService.markAllRead();
    } catch {
      fetchList(true);
    }
  };

  const handleClearRead = async () => {
    setItems((prev) => prev.filter((n) => !n.is_read));
    try {
      await notificationService.clearRead();
    } catch {
      fetchList(true);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    const removed = items.find((n) => n.id === id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (removed && !removed.is_read) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await notificationService.remove(id);
    } catch {
      fetchList(true);
    }
  };

  const hasReadItems = items.some((n) => n.is_read);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        className="relative p-2 text-text-muted hover:text-primary rounded-lg hover:bg-primary-muted border border-transparent hover:border-primary/20 transition-all"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[11px] font-bold text-white bg-rose-500 rounded-full shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[90vw] bg-surface rounded-2xl shadow-hover border border-border overflow-hidden z-50 animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
            <h3 className="text-sm font-bold text-text-primary">Notifications</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  title="Mark all as read"
                  className="flex items-center gap-1 text-[12px] font-semibold text-primary hover:bg-primary-muted px-2 py-1 rounded-lg transition-all"
                >
                  <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                </button>
              )}
              {hasReadItems && (
                <button
                  onClick={handleClearRead}
                  title="Clear read notifications"
                  className="flex items-center gap-1 text-[12px] font-semibold text-text-muted hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 px-2 py-1 rounded-lg transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-text-muted">Loading...</div>
            ) : items.length === 0 ? (
              <div className="p-8 flex flex-col items-center gap-2 text-center text-sm text-text-muted">
                <EmptyStateIllustration className="w-16 h-16" />
                No notifications yet.
              </div>
            ) : (
              items.map((item) => {
                const style = PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.info;
                const Icon = style.icon;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`group flex items-start gap-3 px-4 py-3 border-b border-border last:border-b-0 cursor-pointer transition-all hover:bg-background ${
                      !item.is_read ? 'bg-primary-muted/40' : ''
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${style.className}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className={`text-sm ${!item.is_read ? 'font-bold text-text-primary' : 'font-medium text-text-secondary'}`}>
                          {item.title}
                        </p>
                        {!item.is_read && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{item.message}</p>
                      <p className="text-[11px] text-text-muted/70 mt-1">{timeAgo(item.created_at)}</p>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, item.id)}
                      title="Delete"
                      className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-rose-500 rounded transition-all shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
