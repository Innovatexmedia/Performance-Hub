import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { Menu, Search, Bell, ChevronDown, LogOut, RefreshCw, Check, Plus } from 'lucide-react';
import { useStore } from '@/store/store';
import { useAuthStore } from '@/store/authStore';
import { Avatar, cn, Modal, Button, Field, Input } from '@/components/ui';
import { timeAgo } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { ApiError, apiErrorMessage } from '@/lib/apiClient';
import { notificationsApi, type NotificationItem } from '@/lib/notificationsApi';
import { ROLE_LABELS } from '@/types/auth';

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  return ref;
}

function NotifIcon({ name }: { name: string }) {
  const map: Record<string, string> = {
    flame: 'Flame', sparkles: 'Sparkles', 'message-circle': 'MessageCircle', 'check-circle': 'CheckCircle2',
    'x-circle': 'XCircle', megaphone: 'Megaphone', calendar: 'Calendar', phone: 'Phone',
    'dollar-sign': 'DollarSign', 'alert-triangle': 'AlertTriangle', clock: 'Clock', 'bar-chart': 'BarChart3',
  };
  const C = (Icons as unknown as Record<string, React.FC<{ size?: number }>>)[map[name] || 'Bell'];
  return C ? <C size={15} /> : <Bell size={15} />;
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const authLogout = useAuthStore((s) => s.logout);
  const workspaces = useAuthStore((s) => s.workspaces);
  const workspacesLoading = useAuthStore((s) => s.workspacesLoading);
  const loadWorkspaces = useAuthStore((s) => s.loadWorkspaces);
  const switchWorkspace = useAuthStore((s) => s.switchWorkspace);
  const createWorkspace = useAuthStore((s) => s.createWorkspace);
  // Real, backend-backed notifications -- previously this whole panel
  // read from a local, client-only mock store (db.notifications) that
  // had zero connection to the real Notification collection, so nothing
  // that ever actually wrote a real notification (qualification,
  // payments, Automation Rules' Notify User action, etc.) could ever be
  // seen here. Polled every 20s rather than real-time-pushed -- good
  // enough for a notification bell, and far simpler than wiring a new
  // socket event for this one panel.
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  const fetchNotifications = useCallback(async () => {
    try {
      const result = await notificationsApi.list({ limit: 12 });
      setNotifications(result.notifications);
      setUnread(result.unreadCount);
    } catch {
      // Non-critical -- the bell just shows stale/empty data if this fails, no need for a toast.
    }
  }, []);

  useEffect(() => {
    void fetchNotifications();
    const interval = setInterval(fetchNotifications, 20_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const markNotificationRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)));
    setUnread((prev) => Math.max(0, prev - 1));
    try {
      await notificationsApi.markRead(id);
    } catch {
      void fetchNotifications(); // resync on failure rather than leave optimistic state wrong
    }
  };

  const markAllNotificationsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    try {
      await notificationsApi.markAllRead();
    } catch {
      void fetchNotifications();
    }
  };

  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showCreateWs, setShowCreateWs] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [creatingWs, setCreatingWs] = useState(false);
  const [search, setSearch] = useState('');

  const notifRef = useClickOutside(() => setNotifOpen(false));
  const profileRef = useClickOutside(() => setProfileOpen(false));
  const wsRef = useClickOutside(() => setWsOpen(false));

  // Load once on mount -- super_admin has no tenantId/workspace at all, so
  // this is skipped for that role (nothing to load, nothing to switch).
  useEffect(() => {
    if (user && user.role !== 'super_admin') void loadWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const activeWorkspace = workspaces.find((w) => w.tenantId === user?.tenantId);
  if (!user) return null;

  const handleSwitchWorkspace = async (tenantId: string) => {
    if (tenantId === user.tenantId) { setWsOpen(false); return; }
    setSwitching(true);
    try {
      await switchWorkspace(tenantId);
      setWsOpen(false);
      toast.success('Workspace switched');
      navigate('/dashboard');
    } catch (err) {
      toast.error('Could not switch workspace', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSwitching(false);
    }
  };

  // Agencies managing multiple client companies: a fresh, completely
  // isolated workspace (own leads/deals/campaigns/everything -- nothing
  // carries over) that this user becomes tenant_owner of immediately.
  // Backend gates this to tenant_owner/tenant_admin and caps the count by
  // plan (see auth.service.js's createWorkspace) -- can_create_workspace
  // below is just the matching UI-side gate so the option isn't shown to
  // roles who'd just get a 403.
  const canCreateWorkspace = user.role === 'tenant_owner' || user.role === 'tenant_admin';

  const handleCreateWorkspace = async () => {
    if (!newWsName.trim()) return;
    setCreatingWs(true);
    try {
      await createWorkspace(newWsName.trim());
      setShowCreateWs(false);
      setWsOpen(false);
      setNewWsName('');
      toast.success('Workspace created', `Welcome to ${newWsName.trim()}`);
      navigate('/dashboard');
    } catch (err) {
      toast.error('Could not create workspace', apiErrorMessage(err));
    } finally {
      setCreatingWs(false);
    }
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) navigate(`/leads?q=${encodeURIComponent(search.trim())}`);
  };

  return (
    <>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur lg:px-6">
      <button onClick={onMenu} className="rounded-lg p-2 text-ink-600 hover:bg-ink-100">
        <Menu size={20} />
      </button>

      {/* Workspace switcher -- super_admin has no tenant/workspace at all */}
      {user.role !== 'super_admin' && (
        <div className="relative" ref={wsRef}>
          <button onClick={() => setWsOpen((o) => !o)} className="flex items-center gap-2 rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm font-semibold text-ink-800 hover:bg-ink-50">
            {activeWorkspace?.logoUrl ? (
              <img src={activeWorkspace.logoUrl} alt="" className="h-6 w-6 rounded-md object-cover" />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">
                {(activeWorkspace?.tenantName || '?')[0]}
              </span>
            )}
            <span className="hidden max-w-[140px] truncate sm:inline">{activeWorkspace?.tenantName || 'Workspace'}</span>
            <ChevronDown size={14} className="text-ink-400" />
          </button>
          {wsOpen && (
            <div className="absolute left-0 top-12 z-30 w-64 rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft animate-slide-up">
              <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-400">Workspaces</p>
              {workspacesLoading && <p className="px-2.5 py-2 text-sm text-ink-400">Loading…</p>}
              {!workspacesLoading && workspaces.length === 0 && <p className="px-2.5 py-2 text-sm text-ink-400">No workspaces found</p>}
              {workspaces.map((w) => (
                <button
                  key={w.tenantId}
                  disabled={switching}
                  onClick={() => void handleSwitchWorkspace(w.tenantId)}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-ink-50 disabled:opacity-50', w.tenantId === user.tenantId && 'bg-brand-50')}
                >
                  {w.logoUrl ? (
                    <img src={w.logoUrl} alt="" className="h-7 w-7 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">{w.tenantName[0]}</span>
                  )}
                  <span className="flex-1">
                    <span className="block font-medium text-ink-800">{w.tenantName}</span>
                    <span className="block text-xs text-ink-400">{ROLE_LABELS[w.role]}</span>
                  </span>
                  {w.tenantId === user.tenantId && <Check size={15} className="text-brand-600" />}
                </button>
              ))}
              {canCreateWorkspace && (
                <>
                  <div className="my-1 border-t border-ink-100" />
                  <button
                    onClick={() => { setWsOpen(false); setShowCreateWs(true); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-brand-600 hover:bg-brand-50"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-md border border-dashed border-brand-300 text-brand-500"><Plus size={14} /></span>
                    Add company
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <form onSubmit={submitSearch} className="relative hidden flex-1 md:block">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search leads, deals, conversations…"
          className="w-full max-w-md rounded-lg border border-ink-200 bg-ink-50 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
        />
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button onClick={() => setNotifOpen((o) => !o)} className="relative rounded-lg p-2 text-ink-600 hover:bg-ink-100">
            <Bell size={19} />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread}</span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-12 z-30 w-[360px] rounded-xl border border-ink-200 bg-white shadow-soft animate-slide-up">
              <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
                <p className="text-sm font-semibold text-ink-900">Notifications</p>
                <button onClick={markAllNotificationsRead} className="text-xs font-semibold text-brand-600 hover:text-brand-700">Mark all read</button>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                {notifications.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-400">No notifications</p>}
                {notifications.slice(0, 12).map((n) => (
                  <button
                    key={n._id}
                    onClick={() => { void markNotificationRead(n._id); setNotifOpen(false); }}
                    className={cn('flex w-full gap-3 border-b border-ink-50 px-4 py-3 text-left hover:bg-ink-50', !n.isRead && 'bg-brand-50/40')}
                  >
                    <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', n.isRead ? 'bg-ink-100 text-ink-500' : 'bg-brand-100 text-brand-600')}>
                      <NotifIcon name="bell" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-ink-800">{n.title}</span>
                      <span className="block text-xs text-ink-500">{n.body}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-400">{timeAgo(n.created_at)}</span>
                    </span>
                    {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="relative" ref={profileRef}>
          <button onClick={() => setProfileOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-ink-100">
            <Avatar name={`${user.firstName} ${user.lastName}`} size={32} />
            <span className="hidden text-left sm:block">
              <span className="block text-sm font-semibold leading-tight text-ink-800">{user.firstName} {user.lastName}</span>
              <span className="block text-[11px] leading-tight text-ink-400">{ROLE_LABELS[user.role]}</span>
            </span>
            <ChevronDown size={14} className="hidden text-ink-400 sm:block" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-12 z-30 w-60 rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft animate-slide-up">
              <div className="border-b border-ink-100 px-3 py-2.5">
                <p className="text-sm font-semibold text-ink-900">{user.firstName} {user.lastName}</p>
                <p className="text-xs text-ink-500">{user.email}</p>
                <p className="mt-1 text-xs font-medium text-brand-600">{ROLE_LABELS[user.role]}</p>
              </div>
              <button onClick={() => { setProfileOpen(false); navigate('/profile'); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                <Icons.User size={16} /> My Profile
              </button>
              <button onClick={() => { setProfileOpen(false); navigate('/settings'); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                <Icons.Settings size={16} /> Settings
              </button>
              <button onClick={() => { setProfileOpen(false); useStore.getState().resetDemo(); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                <RefreshCw size={16} /> Reset demo data
              </button>
              <button onClick={() => { setProfileOpen(false); void authLogout().then(() => navigate('/login')); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                <LogOut size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
      </header>

      {showCreateWs && (
        <Modal
          open
          onClose={() => { if (!creatingWs) { setShowCreateWs(false); setNewWsName(''); } }}
          title="Add a company"
          footer={
            <>
              <Button variant="secondary" onClick={() => { setShowCreateWs(false); setNewWsName(''); }} disabled={creatingWs}>Cancel</Button>
              <Button onClick={() => void handleCreateWorkspace()} disabled={creatingWs || !newWsName.trim()}>{creatingWs ? 'Creating…' : 'Create workspace'}</Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-ink-500">Creates a brand-new, completely separate workspace — its own leads, deals, campaigns, everything. Nothing from your current workspace carries over.</p>
          <Field label="Company name">
            <Input
              autoFocus
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newWsName.trim()) void handleCreateWorkspace(); }}
              placeholder="e.g. Acme Corp"
            />
          </Field>
        </Modal>
      )}
    </>
  );
}