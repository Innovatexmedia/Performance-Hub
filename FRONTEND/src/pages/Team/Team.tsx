import { useState, useEffect } from 'react';
import { Plus, UserCog, Shield } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useTeam } from '@/hooks/useTeam';
import { teamApi } from '@/lib/teamApi';
import { teamPermissions } from '@/lib/permissions';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { PageHeader, Card, CardHeader, Button, Badge, Table, Th, Td, Tr, Modal, Field, Input, Select, Avatar, EmptyState } from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { timeAgo } from '@/utils/formatters';
import { ROLE_LABELS } from '@/types/auth';
import type { AuthRole } from '@/types/auth';
import type { TeamMember, AssignableRole, PermissionCatalogGroup } from '@/types/team';

/**
 * Team -- confirmed spec-aligned (FRONTEND_SPEC §17, MASTER_SPEC B16):
 * KPI row + members table, add user modal, inline role change,
 * activate/deactivate, assigned-lead counts, last-active. Roles: Owner /
 * Admin / Sales / Read-Only (Super Admin protected -- excluded from the
 * addable/assignable set, per team.validator.js's own comment).
 *
 * Every action button below mirrors team.service.js's REAL business
 * rules exactly (see permissions.ts's teamPermissions), not just a role
 * floor -- otherwise a button would render clickable and always 403:
 * can't touch your own row, can't touch tenant_owner unless you're
 * super_admin yourself, and role options never include your own rank or
 * above (no privilege escalation).
 */
export function Team() {
  const user = useAuthStore((s) => s.user);
  const { members, kpis, loading, error, addMember, updateRole, setStatus, updatePermissions } = useTeam();

  const [show, setShow] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', role: 'sales_user' as AssignableRole });
  const [saving, setSaving] = useState(false);

  // ── Permissions modal state ────────────────────────────────────────────────
  const [catalog, setCatalog] = useState<PermissionCatalogGroup[]>([]);
  const [permTarget, setPermTarget] = useState<TeamMember | null>(null);
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  const [savingPerms, setSavingPerms] = useState(false);
  const [resettingPerms, setResettingPerms] = useState(false);

  useEffect(() => {
    teamApi.getPermissionCatalog().then(setCatalog).catch(() => {
      // Non-fatal -- the modal just shows nothing to check if this fails;
      // the rest of the Team page still works normally.
    });
  }, []);

  const openPermissions = (member: TeamMember) => {
    setPermTarget(member);
    setSelectedPerms(new Set(member.permissions || []));
  };

  const togglePermission = (value: string) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const resetToRoleDefault = async () => {
    if (!permTarget) return;
    setResettingPerms(true);
    try {
      const defaults = await teamApi.getRoleDefaultPermissions(permTarget.role);
      setSelectedPerms(new Set(defaults));
      toast.success('Reset to role default — click Save to apply');
    } catch (err) {
      toast.error('Could not load role defaults', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setResettingPerms(false);
    }
  };

  const savePermissions = async () => {
    if (!permTarget) return;
    setSavingPerms(true);
    try {
      await updatePermissions(permTarget.id, Array.from(selectedPerms));
      toast.success('Permissions updated', `${permTarget.fullName}'s access has changed — they may need to log in again for it to fully take effect.`);
      setPermTarget(null);
    } catch (err) {
      toast.error('Could not update permissions', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSavingPerms(false);
    }
  };

  if (!user) return null;

  const assignableForAdd = teamPermissions.assignableRoles(user.role).filter((r) => r !== 'tenant_owner' || user.role === 'super_admin') as AssignableRole[];

  const handleAdd = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      return toast.error('First name, last name, and email are required');
    }
    setSaving(true);
    try {
      await addMember(form);
      toast.success('Team member added', 'An invite email has been sent');
      setShow(false);
      setForm({ firstName: '', lastName: '', email: '', role: 'sales_user' });
    } catch (err) {
      toast.error('Could not add team member', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (member: TeamMember, role: string) => {
    setBusyId(member.id);
    try {
      await updateRole(member.id, role);
      toast.success('Role updated');
    } catch (err) {
      toast.error('Could not update role', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleStatus = async (member: TeamMember) => {
    setBusyId(member.id);
    try {
      await setStatus(member.id, member.status === 'active' ? 'inactive' : 'active');
      toast.success(member.status === 'active' ? 'Member deactivated' : 'Member activated');
    } catch (err) {
      toast.error('Could not update status', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Team" description="Manage users, roles & lead assignments." breadcrumb={['Admin', 'Team']}
        actions={teamPermissions.canAdd(user.role) ? <Button onClick={() => setShow(true)}><Plus size={16} /> Add User</Button> : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Team members" value={kpis?.totalMembers ?? '—'} icon={<UserCog size={18} />} accent="#6366f1" />
        <KpiCard label="Active" value={kpis?.active ?? '—'} icon={<UserCog size={18} />} accent="#10b981" />
        <KpiCard label="Sales users" value={kpis?.salesUsers ?? '—'} icon={<UserCog size={18} />} accent="#8b5cf6" />
        <KpiCard label="Admins" value={kpis?.admins ?? '—'} icon={<UserCog size={18} />} accent="#f59e0b" />
      </div>

      {error && <Card className="mb-4 p-4 text-sm text-red-600">{error}</Card>}

      <Card>
        <CardHeader title="Team Members" />
        {loading && members.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">Loading team…</p>
        ) : members.length === 0 ? (
          <EmptyState title="No team members yet" />
        ) : (
          <Table>
            <thead><tr><Th>User</Th><Th>Role</Th><Th>Status</Th><Th>Assigned leads</Th><Th>Last active</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {members.map((m) => {
                const canChangeRole = teamPermissions.canChangeRole(user.role, user.id, m);
                const canChangeStatus = teamPermissions.canChangeStatus(user.role, user.id, m);
                const roleOptions = teamPermissions.assignableRoles(user.role).filter((r) => r !== 'tenant_owner' || user.role === 'super_admin');
                // Always include the member's CURRENT role in the dropdown even if it wouldn't otherwise be assignable -- otherwise the <select> would silently jump to a different value on render.
                const optionsWithCurrent = roleOptions.includes(m.role) ? roleOptions : [m.role, ...roleOptions];

                return (
                  <Tr key={m.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.fullName} size={34} />
                        <div><p className="font-semibold text-ink-900">{m.fullName}</p><p className="text-xs text-ink-500">{m.email}</p></div>
                      </div>
                    </Td>
                    <Td>
                      {canChangeRole ? (
                        <Select value={m.role} disabled={busyId === m.id} onChange={(e) => void handleRoleChange(m, e.target.value)} className="w-auto py-1 text-xs">
                          {optionsWithCurrent.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </Select>
                      ) : (
                        <Badge tone="gray">{ROLE_LABELS[m.role]}</Badge>
                      )}
                    </Td>
                    <Td><Badge tone={m.status === 'active' ? 'green' : 'gray'}>{m.status}</Badge></Td>
                    <Td>{m.assignedLeads}</Td>
                    <Td className="text-ink-500">{m.lastLogin ? timeAgo(m.lastLogin) : 'Never'}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        {canChangeStatus ? (
                          <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={busyId === m.id} onClick={() => void handleToggleStatus(m)}>
                            {busyId === m.id ? '…' : m.status === 'active' ? 'Deactivate' : 'Activate'}
                          </Button>
                        ) : (
                          <span className="text-xs text-ink-300">—</span>
                        )}
                        {teamPermissions.canChangePermissions(user.role, user.id, m) && (
                          <button
                            className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                            title="Manage permissions"
                            onClick={() => openPermissions(m)}
                          >
                            <Shield size={14} />
                          </button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {show && (
        <Modal
          open onClose={() => setShow(false)} title="Add Team Member"
          footer={<><Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button><Button onClick={() => void handleAdd()} disabled={saving}>{saving ? 'Adding…' : 'Add user'}</Button></>}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
              <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
            </div>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AssignableRole })}>
                {assignableForAdd.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
            </Field>
            <p className="text-xs text-ink-400">A temporary password will be generated and emailed to them, along with a login link.</p>
          </div>
        </Modal>
      )}
      {permTarget && (
        <Modal
          open onClose={() => setPermTarget(null)} title={`Permissions — ${permTarget.fullName}`} size="lg"
          footer={<>
            <Button variant="secondary" onClick={resetToRoleDefault} disabled={resettingPerms || savingPerms}>
              {resettingPerms ? 'Loading…' : 'Reset to role default'}
            </Button>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => setPermTarget(null)} disabled={savingPerms}>Cancel</Button>
              <Button onClick={() => void savePermissions()} disabled={savingPerms}>{savingPerms ? 'Saving…' : 'Save'}</Button>
            </div>
          </>}
        >
          <div className="space-y-4">
            <p className="text-xs text-ink-500">
              {permTarget.fullName} is a <strong>{ROLE_LABELS[permTarget.role]}</strong> by default. Toggle any
              extra permissions below to grant them individually — e.g. letting one specific Sales User approve
              and send campaigns/templates directly, without waiting for owner approval, while everyone else with
              that role keeps the normal default.
            </p>
            {catalog.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-400">Loading permissions…</p>
            ) : (
              <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
                {catalog.map((g) => (
                  <div key={g.group}>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">{g.group}</p>
                    <div className="space-y-1 rounded-xl border border-ink-100 p-2">
                      {g.items.map((item) => (
                        <label key={item.value} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-50">
                          <input
                            type="checkbox"
                            checked={selectedPerms.has(item.value)}
                            onChange={() => togglePermission(item.value)}
                            className="h-4 w-4 rounded border-ink-300 text-brand-600"
                          />
                          <span className="text-sm text-ink-700">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}