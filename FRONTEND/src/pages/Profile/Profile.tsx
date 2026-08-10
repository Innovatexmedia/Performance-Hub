import { useState, useEffect } from 'react';
import { User, Save, KeyRound, Monitor, LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/authApi';
import { PageHeader, Card, Button, Field, Input, Avatar, Badge } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { ROLE_LABELS } from '@/types/auth';
import type { Session } from '@/types/auth';

/**
 * Profile -- real profile management. SOURCE: auth.service.js
 * getCurrentUser/updateProfile/changePassword, auth.routes.js's
 * GET /auth/me, PATCH /auth/profile, PATCH /auth/change-password.
 *
 * Only the fields genuinely editable on the User schema are here
 * (firstName, lastName, phoneNumber, profileImage) -- no timezone or
 * per-user notification preferences, since neither exists on the User
 * model (notification prefs are a tenant-wide Settings concept, already
 * built separately). profileImage is a real URL field, not a file
 * upload -- there's no real persistent file storage anywhere in this
 * codebase to upload TO, so this accepts a URL rather than faking one.
 */
export function Profile() {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    phoneNumber: user?.phoneNumber ?? '',
    profileImage: user?.profileImage ?? '',
  });
  const [saving, setSaving] = useState(false);

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [changingPw, setChangingPw] = useState(false);

  if (!user) return null;

  const saveProfile = async () => {
    setSaving(true);
    try {
      const updated = await authApi.updateProfile(form);
      updateUser(updated);
      toast.success('Profile updated');
    } catch (err) {
      toast.error('Could not update profile', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (pwForm.newPassword !== pwForm.confirmPassword) return toast.error('New passwords don\u2019t match');
    setChangingPw(true);
    try {
      await authApi.changePassword(pwForm.currentPassword, pwForm.newPassword);
      toast.success('Password changed', 'You\u2019ve been logged out of all other devices for security.');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast.error('Could not change password', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setChangingPw(false);
    }
  };

  return (
    <div>
      <PageHeader title="My Profile" description="Manage your account details and password." breadcrumb={['Account', 'Profile']} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-5 flex items-center gap-3">
            <Avatar name={`${user.firstName} ${user.lastName}`} size={48} />
            <div>
              <p className="font-semibold text-ink-900">{user.firstName} {user.lastName}</p>
              <Badge tone="violet">{ROLE_LABELS[user.role]}</Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
            <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          </div>
          <Field label="Email" hint="Contact support to change your email"><Input value={user.email} disabled /></Field>
          <Field label="Phone number"><Input value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+1 555 000 0000" /></Field>
          <Field label="Profile image URL" hint="Paste a link to an image"><Input value={form.profileImage} onChange={(e) => setForm({ ...form, profileImage: e.target.value })} placeholder="https://…" /></Field>

          <Button className="mt-4" disabled={saving} onClick={() => void saveProfile()}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><KeyRound size={16} /></span>
            <div>
              <h3 className="text-sm font-semibold text-ink-900">Change Password</h3>
              <p className="text-xs text-ink-500">Changing your password logs you out of all other devices.</p>
            </div>
          </div>

          <Field label="Current password"><Input type="password" value={pwForm.currentPassword} onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })} autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 8 characters, with an uppercase letter, lowercase letter, and a number.">
            <Input type="password" value={pwForm.newPassword} onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password"><Input type="password" value={pwForm.confirmPassword} onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })} autoComplete="new-password" /></Field>

          <Button variant="secondary" className="mt-4" disabled={changingPw} onClick={() => void changePassword()}>
            <User size={15} /> {changingPw ? 'Changing…' : 'Change password'}
          </Button>
        </Card>
      </div>

      <ActiveSessionsCard />
    </div>
  );
}

/**
 * ActiveSessionsCard -- real session management. SOURCE: auth.service.js
 * listSessions()/revokeUserSession()/logoutAll(), auth.routes.js's
 * GET /auth/sessions, DELETE /auth/sessions/:sessionId, POST /auth/logout-all.
 *
 * MOVED HERE FROM Settings.tsx: it used to live inside Settings' Security
 * tab, which is fine on its own -- but Settings itself is now gated to
 * tenant_admin+ (real RBAC lockdown fix), which meant sales_user and
 * read_only_user could no longer reach their OWN session list at all.
 * Session management is a personal-account feature, not a workspace
 * admin one -- it belongs on Profile, reachable by every role, same as
 * the rest of this page.
 */
function ActiveSessionsCard() {
  const logoutAll = useAuthStore((s) => s.logoutAll);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  const load = () => {
    setLoading(true);
    authApi.listSessions()
      .then(setSessions)
      .catch(() => toast.error('Could not load active sessions'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleRevoke = async (session: Session) => {
    setBusyId(session.sessionId);
    try {
      await authApi.revokeSession(session.sessionId);
      toast.success('Session logged out');
      setSessions((prev) => prev.filter((s) => s.sessionId !== session.sessionId));
    } catch (err) {
      toast.error('Could not log out session', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleLogoutAll = async () => {
    setLoggingOutAll(true);
    try {
      await logoutAll();
      // logoutAll() already clears local auth state and disconnects the
      // socket -- the app's own route guard will redirect to /login.
    } catch {
      toast.error('Could not log out all devices');
      setLoggingOutAll(false);
    }
  };

  return (
    <Card className="mt-4 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">Active Sessions</h3>
          <p className="mt-0.5 text-xs text-ink-500">Devices currently signed in to your account</p>
        </div>
        {sessions.length > 1 && (
          <Button variant="secondary" disabled={loggingOutAll} onClick={() => void handleLogoutAll()} className="text-xs">
            <LogOut size={13} /> {loggingOutAll ? 'Logging out…' : 'Log out all devices'}
          </Button>
        )}
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-ink-400">Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-400">No active sessions found</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.sessionId} className="flex items-center gap-3 rounded-lg border border-ink-100 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-500"><Monitor size={15} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-ink-800">{s.deviceInfo.userAgent || 'Unknown device'}</p>
                  {s.isCurrent && <Badge tone="green">This device</Badge>}
                </div>
                <p className="text-xs text-ink-400">{s.deviceInfo.ip || 'Unknown IP'} · Signed in {new Date(s.createdAt).toLocaleString()}</p>
              </div>
              {!s.isCurrent && (
                <Button variant="ghost" className="shrink-0 px-2.5 py-1.5 text-xs text-red-600" disabled={busyId === s.sessionId} onClick={() => void handleRevoke(s)}>
                  {busyId === s.sessionId ? '…' : 'Log out'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
