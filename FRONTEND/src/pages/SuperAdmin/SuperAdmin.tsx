import { useState, useEffect } from 'react';
import { Plus, ShieldCheck, Building2, Users, Server } from 'lucide-react';
import { superAdminApi } from '@/lib/superAdminApi';
import { plansApi } from '@/lib/plansApi';
import { PageHeader, Card, CardHeader, Button, Badge, Tabs, Table, Th, Td, Tr, Modal, Field, Input, Select } from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { formatCurrency, timeAgo } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import type {
  PlatformDashboard, PlatformTenant, PlatformUser, IntegrationHealthRow,
  ActivityLogEntry, GlobalTemplate, CreateTenantInput,
} from '@/types/superAdmin';
import type { Plan, CreatePlanInput } from '@/types/plan';

const TABS = [
  { id: 'tenants', label: 'Tenants' }, { id: 'users', label: 'All Users' },
  { id: 'plans', label: 'Plans' },
  { id: 'health', label: 'Integration Health' }, { id: 'activity', label: 'Global Activity' },
  { id: 'templates', label: 'Global Templates' },
];

/**
 * SuperAdmin -- confirmed spec-aligned (MASTER_SPEC B19, FRONTEND_SPEC §20):
 * platform KPI row + 5 tabs. Real backend built from scratch this session
 * (src/modules/superAdmin/*) -- previously this page read entirely from
 * the old mock store. Every number, every row, every action below is
 * real.
 */
export function SuperAdmin() {
  const [tab, setTab] = useState('tenants');
  const [dashboard, setDashboard] = useState<PlatformDashboard | null>(null);

  useEffect(() => {
    superAdminApi.getDashboard().then(setDashboard).catch(() => toast.error('Could not load platform dashboard'));
  }, []);

  return (
    <div>
      <PageHeader title="Super Admin Panel" description="Platform-level control across all tenants." breadcrumb={['Admin', 'Super Admin']} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Tenants" value={dashboard?.totalTenants ?? '—'} icon={<Building2 size={18} />} accent="#6366f1" />
        <KpiCard label="Total users" value={dashboard?.totalUsers ?? '—'} icon={<Users size={18} />} accent="#8b5cf6" />
        <KpiCard label="Platform MRR" value={dashboard ? formatCurrency(dashboard.mrr, 'INR') : '—'} icon={<Server size={18} />} accent="#10b981" />
        <KpiCard label="Active tenants" value={dashboard?.activeTenants ?? '—'} icon={<ShieldCheck size={18} />} accent="#f59e0b" />
      </div>

      <div className="mb-4"><Tabs tabs={TABS} active={tab} onChange={setTab} /></div>

      {tab === 'tenants' && <TenantsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'health' && <HealthTab />}
      {tab === 'activity' && <ActivityTab />}
      {tab === 'templates' && <TemplatesTab />}
    </div>
  );
}

function TenantsTab() {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<PlatformTenant | null>(null);
  const [editPlanId, setEditPlanId] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CreateTenantInput>({ workspaceName: '', ownerFirstName: '', ownerLastName: '', ownerEmail: '', ownerPassword: '', planId: '' });

  const load = () => {
    setLoading(true);
    Promise.all([
      superAdminApi.listTenants({ limit: 100 }),
      plansApi.list(true), // includeInactive -- a tenant already on a since-deactivated plan should still show its real name, not blank
    ])
      .then(([tenantsRes, plansRes]) => { setTenants(tenantsRes.tenants); setPlans(plansRes); })
      .catch(() => toast.error('Could not load tenants'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const planName = (t: PlatformTenant) => plans.find((p) => p.id === t.planId)?.name || t.plan;

  const handleCreate = async () => {
    setSaving(true);
    try {
      await superAdminApi.createTenant(form);
      toast.success('Tenant created');
      setShow(false);
      setForm({ workspaceName: '', ownerFirstName: '', ownerLastName: '', ownerEmail: '', ownerPassword: '', planId: '' });
      load();
    } catch (err) {
      toast.error('Could not create tenant', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (t: PlatformTenant) => {
    setEdit(t);
    setEditPlanId(t.planId || '');
  };

  const handleSaveEdit = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      const patch: Parameters<typeof superAdminApi.updateTenant>[1] = { name: edit.name, mrr: edit.mrr, maxUsers: edit.maxUsers };
      if (editPlanId && editPlanId !== edit.planId) patch.planId = editPlanId;
      await superAdminApi.updateTenant(edit.id, patch);
      toast.success('Tenant updated');
      setEdit(null);
      load();
    } catch (err) {
      toast.error('Could not update tenant', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSuspend = async (t: PlatformTenant) => {
    setBusyId(t.id);
    try {
      if (t.subscriptionStatus === 'suspended') {
        await superAdminApi.reactivateTenant(t.id);
        toast.success('Tenant reactivated');
      } else {
        await superAdminApi.suspendTenant(t.id);
        toast.success('Tenant suspended');
      }
      load();
    } catch (err) {
      toast.error('Could not update tenant', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader title="All Tenants" action={<Button onClick={() => setShow(true)}><Plus size={16} /> New Tenant</Button>} />
        {loading ? (
          <p className="p-8 text-center text-sm text-ink-400">Loading tenants…</p>
        ) : (
          <Table>
            <thead><tr><Th>Tenant</Th><Th>Plan</Th><Th>Status</Th><Th>Users</Th><Th>MRR</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {tenants.map((t) => (
                <Tr key={t.id}>
                  <Td><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">{t.name[0]}</span><div><p className="font-medium">{t.name}</p><p className="text-xs text-ink-400">{t.ownerEmail}</p></div></div></Td>
                  <Td><Badge tone="violet">{planName(t)}</Badge></Td>
                  <Td><Badge tone={t.subscriptionStatus === 'active' ? 'green' : t.subscriptionStatus === 'suspended' ? 'red' : 'gray'}>{t.subscriptionStatus}</Badge></Td>
                  <Td>{t.currentUserCount} / {t.maxUsers}</Td>
                  <Td className="font-medium">{formatCurrency(t.mrr, 'INR')}</Td>
                  <Td>
                    <div className="flex gap-1.5">
                      <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => openEdit(t)}>Edit</Button>
                      <Button variant="ghost" className="px-2.5 py-1 text-xs text-amber-600" disabled={busyId === t.id} onClick={() => void handleToggleSuspend(t)}>
                        {busyId === t.id ? '…' : t.subscriptionStatus === 'suspended' ? 'Reactivate' : 'Suspend'}
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {show && (
        <Modal open onClose={() => setShow(false)} title="Create Tenant"
          footer={<><Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button><Button onClick={() => void handleCreate()} disabled={saving}>{saving ? 'Creating…' : 'Create tenant'}</Button></>}>
          <div className="space-y-4">
            <Field label="Workspace name"><Input value={form.workspaceName} onChange={(e) => setForm({ ...form, workspaceName: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner first name"><Input value={form.ownerFirstName} onChange={(e) => setForm({ ...form, ownerFirstName: e.target.value })} /></Field>
              <Field label="Owner last name"><Input value={form.ownerLastName} onChange={(e) => setForm({ ...form, ownerLastName: e.target.value })} /></Field>
            </div>
            <Field label="Owner email"><Input type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} /></Field>
            <Field label="Owner password" hint="At least 8 characters, with an uppercase letter, lowercase letter, and a number.">
              <Input type="password" value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} />
            </Field>
            <Field label="Plan"><Select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}><option value="">Platform default</option>{plans.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.track === 'whatsapp_only' ? 'WhatsApp Panel only' : 'Full'})</option>)}</Select></Field>
          </div>
        </Modal>
      )}

      {edit && (
        <Modal open onClose={() => setEdit(null)} title={`Edit ${edit.name}`}
          footer={<><Button variant="secondary" onClick={() => setEdit(null)} disabled={saving}>Cancel</Button><Button onClick={() => void handleSaveEdit()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}>
          <div className="space-y-4">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plan"><Select value={editPlanId} onChange={(e) => setEditPlanId(e.target.value)}>{plans.filter((p) => p.isActive || p.id === edit.planId).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.track === 'whatsapp_only' ? 'WhatsApp Panel only' : 'Full'}){!p.isActive ? ' — inactive' : ''}</option>)}</Select></Field>
              <Field label="Max users"><Input type="number" value={edit.maxUsers} onChange={(e) => setEdit({ ...edit, maxUsers: Number(e.target.value) })} /></Field>
            </div>
            <Field label="MRR (INR)"><Input type="number" value={edit.mrr} onChange={(e) => setEdit({ ...edit, mrr: Number(e.target.value) })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * PlansTab -- lets Super Admin edit price/limits on the 6 default plans,
 * toggle active/default, and create new ones. Backend (plan.service.js)
 * deliberately does NOT allow editing track/tier/key after creation --
 * a plan silently switching track out from under tenants already on it
 * would change their module access with zero warning -- so those three
 * fields are read-only here once a plan exists, matching the API.
 */
function PlansTab() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Plan | null>(null);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CreatePlanInput>({
    key: '', name: '', track: 'full', tier: 'starter', price: 0,
    limits: { maxUsers: 5, maxLeads: 1000, maxCampaigns: 10, maxWorkspaces: 1 },
  });

  const load = () => {
    setLoading(true);
    plansApi.list(true)
      .then(setPlans)
      .catch(() => toast.error('Could not load plans'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await plansApi.create(form);
      toast.success('Plan created');
      setShow(false);
      setForm({ key: '', name: '', track: 'full', tier: 'starter', price: 0, limits: { maxUsers: 5, maxLeads: 1000, maxCampaigns: 10, maxWorkspaces: 1 } });
      load();
    } catch (err) {
      toast.error('Could not create plan', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      await plansApi.update(edit.id, {
        name: edit.name, price: edit.price, limits: edit.limits,
        isActive: edit.isActive, isDefault: edit.isDefault,
      });
      toast.success('Plan updated');
      setEdit(null);
      load();
    } catch (err) {
      toast.error('Could not update plan', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Card>
        <CardHeader
          title="Billing Plans"
          subtitle="Price and limits apply immediately to every tenant on the plan — existing subscriptions aren't affected until their next billing cycle re-syncs."
          action={<Button onClick={() => setShow(true)}><Plus size={16} /> New plan</Button>}
        />
        {loading ? (
          <p className="p-6 text-sm text-ink-400">Loading…</p>
        ) : (
          <Table>
            <thead><Tr><Th>Name</Th><Th>Track</Th><Th>Price</Th><Th>Limits</Th><Th>Status</Th><Th /></Tr></thead>
            <tbody>
              {plans.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium">{p.name}{p.isDefault && <Badge tone="blue" className="ml-2">Default</Badge>}</Td>
                  <Td>{p.track === 'whatsapp_only' ? 'WhatsApp Panel only' : 'Full'}</Td>
                  <Td>{formatCurrency(p.price, p.currency)}/mo</Td>
                  <Td className="text-xs text-ink-500">{p.limits.maxUsers} users · {p.limits.maxLeads} leads · {p.limits.maxCampaigns} campaigns · {p.limits.maxWorkspaces} workspaces</Td>
                  <Td><Badge tone={p.isActive ? 'green' : 'gray'}>{p.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                  <Td><Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setEdit(p)}>Edit</Button></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {show && (
        <Modal open onClose={() => setShow(false)} title="New plan" footer={<><Button variant="secondary" onClick={() => setShow(false)}>Cancel</Button><Button onClick={() => void handleCreate()} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button></>}>
          <div className="space-y-4">
            <Field label="Key (unique, lowercase, no spaces)"><Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="e.g. premium_full_v2" /></Field>
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Track">
                <Select value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value as CreatePlanInput['track'] })}>
                  <option value="full">Full access</option>
                  <option value="whatsapp_only">WhatsApp Panel only</option>
                </Select>
              </Field>
              <Field label="Tier">
                <Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as CreatePlanInput['tier'] })}>
                  <option value="starter">Starter</option>
                  <option value="mid">Mid</option>
                  <option value="premium">Premium</option>
                </Select>
              </Field>
            </div>
            <Field label="Price (₹/mo)"><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max users"><Input type="number" value={form.limits.maxUsers} onChange={(e) => setForm({ ...form, limits: { ...form.limits, maxUsers: Number(e.target.value) } })} /></Field>
              <Field label="Max leads"><Input type="number" value={form.limits.maxLeads} onChange={(e) => setForm({ ...form, limits: { ...form.limits, maxLeads: Number(e.target.value) } })} /></Field>
              <Field label="Max campaigns"><Input type="number" value={form.limits.maxCampaigns} onChange={(e) => setForm({ ...form, limits: { ...form.limits, maxCampaigns: Number(e.target.value) } })} /></Field>
              <Field label="Max workspaces"><Input type="number" value={form.limits.maxWorkspaces} onChange={(e) => setForm({ ...form, limits: { ...form.limits, maxWorkspaces: Number(e.target.value) } })} /></Field>
            </div>
          </div>
        </Modal>
      )}

      {edit && (
        <Modal open onClose={() => setEdit(null)} title={`Edit ${edit.name}`} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => void handleSaveEdit()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}>
          <div className="space-y-4">
            <p className="text-xs text-ink-400">Track ({edit.track === 'whatsapp_only' ? 'WhatsApp Panel only' : 'Full access'}) and tier ({edit.tier}) can't be changed after creation — create a new plan instead if a tenant needs to move between tracks.</p>
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Price (₹/mo)"><Input type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max users"><Input type="number" value={edit.limits.maxUsers} onChange={(e) => setEdit({ ...edit, limits: { ...edit.limits, maxUsers: Number(e.target.value) } })} /></Field>
              <Field label="Max leads"><Input type="number" value={edit.limits.maxLeads} onChange={(e) => setEdit({ ...edit, limits: { ...edit.limits, maxLeads: Number(e.target.value) } })} /></Field>
              <Field label="Max campaigns"><Input type="number" value={edit.limits.maxCampaigns} onChange={(e) => setEdit({ ...edit, limits: { ...edit.limits, maxCampaigns: Number(e.target.value) } })} /></Field>
              <Field label="Max workspaces"><Input type="number" value={edit.limits.maxWorkspaces} onChange={(e) => setEdit({ ...edit, limits: { ...edit.limits, maxWorkspaces: Number(e.target.value) } })} /></Field>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} className="rounded border-ink-300" /> Active</label>
              <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={edit.isDefault} onChange={(e) => setEdit({ ...edit, isDefault: e.target.checked })} className="rounded border-ink-300" /> Default plan for new tenants</label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    superAdminApi.listUsers({ limit: 100 })
      .then((r) => setUsers(r.users))
      .catch(() => toast.error('Could not load users'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader title="All Platform Users" />
      {loading ? (
        <p className="p-8 text-center text-sm text-ink-400">Loading users…</p>
      ) : (
        <Table>
          <thead><tr><Th>User</Th><Th>Email</Th><Th>Role</Th><Th>Tenant</Th><Th>Status</Th></tr></thead>
          <tbody>
            {users.map((u) => (
              <Tr key={u.id}>
                <Td className="font-medium">{u.firstName} {u.lastName}</Td>
                <Td>{u.email}</Td>
                <Td><Badge tone="blue">{u.role}</Badge></Td>
                <Td>{u.tenantName ?? '—'}</Td>
                <Td><Badge tone={u.status === 'active' ? 'green' : 'gray'}>{u.status}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function HealthTab() {
  const [rows, setRows] = useState<IntegrationHealthRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    superAdminApi.getIntegrationHealth()
      .then(setRows)
      .catch(() => toast.error('Could not load integration health'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="p-8 text-center text-sm text-ink-400">Loading…</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => (
        <Card key={r._id} className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">{r.name[0]}</span><span className="text-sm font-semibold">{r.name}</span></div>
            <Badge tone={r.connected > 0 ? 'green' : 'gray'}>{r.connected}/{r.total} connected</Badge>
          </div>
          <p className="mt-2 text-xs text-ink-400">{r.category} · {r.simulation} in simulation · {r.disconnected} disconnected</p>
        </Card>
      ))}
    </div>
  );
}

function ActivityTab() {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    superAdminApi.getActivityLog({ limit: 100 })
      .then((r) => setLogs(r.logs))
      .catch(() => toast.error('Could not load activity log'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader title="Global Activity Log" />
      {loading ? (
        <p className="p-8 text-center text-sm text-ink-400">Loading…</p>
      ) : (
        <Table>
          <thead><tr><Th>Email</Th><Th>Event</Th><Th>Result</Th><Th>Time</Th></tr></thead>
          <tbody>
            {logs.map((a) => (
              <Tr key={a.id}>
                <Td className="font-medium">{a.email}</Td>
                <Td><Badge tone="gray">{a.event.replace(/_/g, ' ')}</Badge></Td>
                <Td><Badge tone={a.success ? 'green' : 'red'}>{a.success ? 'Success' : 'Failed'}</Badge></Td>
                <Td className="text-ink-500">{timeAgo(a.createdAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState<GlobalTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    superAdminApi.listGlobalTemplates()
      .then(setTemplates)
      .catch(() => toast.error('Could not load global templates'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader title="Global Templates" subtitle="Available across all tenants" />
      {loading ? (
        <p className="p-8 text-center text-sm text-ink-400">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="p-8 text-center text-sm text-ink-400">No global templates yet</p>
      ) : (
        <Table>
          <thead><tr><Th>Name</Th><Th>Type</Th><Th>Scope</Th><Th>Version</Th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <Tr key={t.id}><Td className="font-medium">{t.name}</Td><Td>{t.type}</Td><Td><Badge tone="violet">global</Badge></Td><Td>v{t.version}</Td></Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}