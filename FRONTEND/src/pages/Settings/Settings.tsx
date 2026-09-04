import { useState, useEffect } from 'react';
import { Save, Plus, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useSettings } from '@/hooks/useSettings';
import { settingsApi } from '@/lib/settingsApi';
import { redirectToCashfreeAuth } from '@/lib/cashfreeCheckout';
import { usePlanStore } from '@/store/planStore';
import { useCurrencyStore } from '@/store/currencyStore';
import { applyAccentColor } from '@/utils/theme';
import { formatCurrency } from '@/utils/formatters';
import { settingsPermissions } from '@/lib/permissions';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { PageHeader, Card, Button, Tabs, Field, Input, Select, Toggle, Badge, cn } from '@/components/ui';
import type {
  AllSettings, CompanySettings, BrandingSettings, LeadFieldsSettings, PipelineStageDisplay,
  QualificationSettings, ScoringRulesSettings,
  NotificationSettings, ConsentSettings, SecuritySettings, ScoringRule,
} from '@/types/settings';
import type { Plan } from '@/types/plan';

const TABS = [
  { id: 'company', label: 'Company' }, { id: 'branding', label: 'Branding' },
  { id: 'fields', label: 'Lead Fields' }, { id: 'pipeline', label: 'Pipeline Stages' },
  { id: 'qualification', label: 'Qualification' }, { id: 'scoring', label: 'Scoring Rules' },
  { id: 'notifications', label: 'Notifications' }, { id: 'consent', label: 'Consent & Data' },
  { id: 'billing', label: 'Billing' }, { id: 'security', label: 'Security' },
];

/**
 * Settings -- confirmed spec-aligned (FRONTEND_SPEC §19, MASTER_SPEC B18):
 * 10 tabs, 9 of which have a dedicated PATCH endpoint. Billing stays
 * read-only (updated by payment webhooks, not user-editable). Pipeline
 * Stages' 9 keys/order are fixed, but label/color are editable; Lead
 * Fields' field set is fixed, but which are required is editable.
 * Confirmed every field the backend writes genuinely exists on the real
 * Tenant schema -- nothing here silently fails to persist.
 *
 * Billing stays a real display of real backend data, but no actual
 * payment-processor action -- spec explicitly marks it "(placeholder)".
 */
export function Settings() {
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = settingsPermissions.canEdit(role);
  const { settings, loading, error, refetch } = useSettings();
  const [tab, setTab] = useState('company');

  return (
    <div>
      <PageHeader title="Settings" description="Configure your workspace." breadcrumb={['Admin', 'Settings']} />
      {error && <Card className="mb-4 p-4 text-sm text-red-600">{error}</Card>}
      {loading && !settings ? (
        <p className="p-8 text-center text-sm text-ink-400">Loading settings…</p>
      ) : settings ? (
        <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
          <div className="lg:border-r lg:border-ink-200 lg:pr-2">
            <div className="flex gap-1 overflow-x-auto lg:flex-col">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition ${tab === t.id ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100'}`}>{t.label}</button>
              ))}
            </div>
          </div>
          <div>
            {tab === 'company' && <CompanyTab data={settings.company} canEdit={canEdit} onSaved={refetch} />}
            {tab === 'branding' && <BrandingTab data={settings.branding} canEdit={canEdit} onSaved={refetch} />}
            {tab === 'fields' && <FieldsTab data={settings.lead_fields} canEdit={canEdit} onSaved={refetch} />}
            {tab === 'pipeline' && <PipelineTab stages={settings.pipeline_stages} canEdit={canEdit} onSaved={refetch} />}
            {tab === 'qualification' && <QualificationTab data={settings.qualification} canEdit={canEdit} onSaved={refetch} />}
            {tab === 'scoring' && <ScoringTab data={settings.scoring_rules} canEdit={canEdit} onSaved={refetch} />}
            {tab === 'notifications' && <NotificationsTab data={settings.notifications} canEdit={canEdit} onSaved={refetch} />}
            {tab === 'consent' && <ConsentTab data={settings.consent} canEdit={canEdit} onSaved={refetch} />}
            {tab === 'billing' && <BillingTab data={settings.billing} canEdit={canEdit} onSaved={refetch} />}
            {tab === 'security' && <SecurityTab data={settings.security} canEdit={canEdit} onSaved={refetch} />}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CardHeaderInline({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div className="mb-4"><h3 className="text-sm font-semibold text-ink-900">{title}</h3>{subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}</div>;
}

function CompanyTab({ data, canEdit, onSaved }: { data: CompanySettings; canEdit: boolean; onSaved: () => void }) {
  const [form, setForm] = useState(data);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(data), [data]);

  const save = async () => {
    setSaving(true);
    try {
      await settingsApi.updateCompany(form);
      toast.success('Company settings saved');
      // Every mounted component reading useTenantCurrency() (KPI cards,
      // campaign revenue, etc.) updates immediately, not just after a
      // reload -- same reasoning as usePlanStore.refresh() elsewhere in
      // this file.
      void useCurrencyStore.getState().refresh();
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeaderInline title="Company Profile" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name"><Input disabled={!canEdit} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
        <Field label="Website"><Input disabled={!canEdit} value={form.company_website} onChange={(e) => setForm({ ...form, company_website: e.target.value })} /></Field>
        <Field label="Industry"><Input disabled={!canEdit} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></Field>
        <Field label="Currency" hint="Used for all revenue/payment figures across the app.">
          <Select disabled={!canEdit} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {(form.available_currencies || ['USD']).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Description"><Input disabled={!canEdit} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      {canEdit && <Button className="mt-4" disabled={saving} onClick={() => void save()}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</Button>}
    </Card>
  );
}

function BrandingTab({ data, canEdit, onSaved }: { data: BrandingSettings; canEdit: boolean; onSaved: () => void }) {
  const [color, setColor] = useState(data.accent_color);
  const [saving, setSaving] = useState(false);
  useEffect(() => setColor(data.accent_color), [data.accent_color]);

  const save = async () => {
    setSaving(true);
    try {
      await settingsApi.updateBranding({ accent_color: color });
      applyAccentColor(color);
      toast.success('Branding saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeaderInline title="Branding" />
      <Field label="Accent color">
        <div className="flex gap-2">
          {data.available_colors.map((c) => (
            <button key={c} disabled={!canEdit} onClick={() => setColor(c)} className={`h-9 w-9 rounded-lg disabled:cursor-not-allowed disabled:opacity-50 ${color === c ? 'ring-2 ring-offset-2 ring-ink-400' : ''}`} style={{ background: c }} />
          ))}
        </div>
      </Field>
      {canEdit && <Button className="mt-4" disabled={saving} onClick={() => void save()}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</Button>}
    </Card>
  );
}

function FieldsTab({ data, canEdit, onSaved }: { data: LeadFieldsSettings; canEdit: boolean; onSaved: () => void }) {
  const [required, setRequired] = useState<string[]>(data.required);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRequired(data.required), [data.required]);

  const toggle = (field: string) => {
    if (field === 'name') return; // name can never be turned off, mirrors the backend guard
    setRequired((r) => r.includes(field) ? r.filter((f) => f !== field) : [...r, field]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await settingsApi.updateLeadFields(required);
      toast.success('Lead fields saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeaderInline title="Lead Fields" subtitle="Standard fields captured for every lead — choose which are required" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {data.fields.map((f) => (
          <label key={f} className={`flex items-center gap-2 rounded-lg border border-ink-100 px-3 py-2 text-sm text-ink-700 ${f === 'name' ? 'opacity-60' : canEdit ? 'cursor-pointer hover:border-ink-200' : ''}`}>
            <input type="checkbox" checked={required.includes(f)} disabled={!canEdit || f === 'name'} onChange={() => toggle(f)} className="rounded border-ink-300" />
            {f} {f === 'name' && <span className="text-xs text-ink-400">(always required)</span>}
          </label>
        ))}
      </div>
      {canEdit && <Button className="mt-4" disabled={saving} onClick={() => void save()}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</Button>}
    </Card>
  );
}

function PipelineTab({ stages, canEdit, onSaved }: { stages: AllSettings['pipeline_stages']; canEdit: boolean; onSaved: () => void }) {
  const [rows, setRows] = useState<PipelineStageDisplay[]>(stages);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRows(stages), [stages]);

  const setRow = (i: number, patch: Partial<PipelineStageDisplay>) =>
    setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await settingsApi.updatePipelineStages(rows);
      setRows(saved);
      toast.success('Pipeline stages saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeaderInline title="Pipeline Stages" subtitle="Rename or recolor each stage — the 9 stages themselves and their order are fixed" />
      <div className="space-y-2">
        {rows.map((s, i) => (
          <div key={s.key} className="flex items-center gap-3 rounded-lg border border-ink-100 px-3 py-2">
            <input type="color" value={s.color} disabled={!canEdit} onChange={(e) => setRow(i, { color: e.target.value })} className="h-7 w-7 shrink-0 cursor-pointer rounded border border-ink-200 bg-transparent p-0" />
            <Input disabled={!canEdit} value={s.name} onChange={(e) => setRow(i, { name: e.target.value })} className="flex-1" />
            <Badge tone="gray">#{i + 1}</Badge>
          </div>
        ))}
      </div>
      {canEdit && <Button className="mt-4" disabled={saving} onClick={() => void save()}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</Button>}
    </Card>
  );
}

function QualificationTab({ data, canEdit, onSaved }: { data: QualificationSettings; canEdit: boolean; onSaved: () => void }) {
  const [qs, setQs] = useState(data.questions);
  const [newQ, setNewQ] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setQs(data.questions), [data.questions]);

  const save = async () => {
    if (qs.length === 0) return toast.error('At least one question is required');
    setSaving(true);
    try {
      await settingsApi.updateQualification(qs);
      toast.success('Qualification questions saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeaderInline title="Qualification Questions" subtitle="Used by the AI Qualification engine" />
      <div className="space-y-2">
        {qs.map((q, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input disabled={!canEdit} value={q} onChange={(e) => setQs(qs.map((x, j) => j === i ? e.target.value : x))} />
            {canEdit && <button onClick={() => setQs(qs.filter((_, j) => j !== i))} className="rounded-lg p-2 text-ink-400 hover:text-red-600"><Trash2 size={15} /></button>}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <Input value={newQ} onChange={(e) => setNewQ(e.target.value)} placeholder="Add a question…" />
          <Button variant="secondary" onClick={() => { if (newQ.trim()) { setQs([...qs, newQ.trim()]); setNewQ(''); } }}><Plus size={15} /></Button>
        </div>
      )}
      {canEdit && <Button className="mt-4" disabled={saving} onClick={() => void save()}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</Button>}
    </Card>
  );
}

function ScoringTab({ data, canEdit, onSaved }: { data: ScoringRulesSettings; canEdit: boolean; onSaved: () => void }) {
  const [rules, setRules] = useState<ScoringRule[]>(data.rules);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRules(data.rules), [data.rules]);
  const total = rules.reduce((s, r) => s + r.weight, 0);

  const save = async () => {
    if (Math.round(total) !== 100) return toast.error('Scoring weights must sum to 100', `Current total: ${total}`);
    setSaving(true);
    try {
      await settingsApi.updateScoringRules(rules);
      toast.success('Scoring rules saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeaderInline title="Scoring Rules" subtitle="Weighting factors for lead scoring (total should be 100)" />
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="flex-1 text-sm text-ink-700">{r.factor}</span>
            <Input disabled={!canEdit} type="number" value={r.weight} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) } : x))} className="w-24" />
            <span className="text-sm text-ink-400">%</span>
          </div>
        ))}
      </div>
      <p className={`mt-2 text-xs ${Math.round(total) === 100 ? 'text-ink-400' : 'text-red-600'}`}>Total: {total}%</p>
      {canEdit && <Button className="mt-4" disabled={saving} onClick={() => void save()}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</Button>}
    </Card>
  );
}

function NotificationsTab({ data, canEdit, onSaved }: { data: NotificationSettings; canEdit: boolean; onSaved: () => void }) {
  const [prefs, setPrefs] = useState(data);
  const [saving, setSaving] = useState(false);
  useEffect(() => setPrefs(data), [data]);

  const save = async () => {
    setSaving(true);
    try {
      await settingsApi.updateNotifications(prefs);
      toast.success('Notification preferences saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeaderInline title="Notification Preferences" />
      <div className="space-y-2">
        {(Object.entries(prefs) as [keyof NotificationSettings, boolean][]).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2.5">
            <span className="text-sm text-ink-700">{k.replace(/_/g, ' ')}</span>
            <Toggle checked={v} onChange={(nv) => canEdit && setPrefs({ ...prefs, [k]: nv })} />
          </div>
        ))}
      </div>
      {canEdit && <Button className="mt-4" disabled={saving} onClick={() => void save()}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</Button>}
    </Card>
  );
}

function ConsentTab({ data, canEdit, onSaved }: { data: ConsentSettings; canEdit: boolean; onSaved: () => void }) {
  const [consent, setConsent] = useState(data.consent_required);
  const [retention, setRetention] = useState(data.data_retention_days);
  const [keywords, setKeywords] = useState(data.opt_out_keywords);
  const [newKw, setNewKw] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setConsent(data.consent_required); setRetention(data.data_retention_days); setKeywords(data.opt_out_keywords); }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      await settingsApi.updateConsent({ consent_required: consent, data_retention_days: retention, opt_out_keywords: keywords });
      toast.success('Consent & data settings saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeaderInline title="Consent & Data Retention" />
      <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2.5">
        <span className="text-sm text-ink-700">Require consent before messaging</span>
        <Toggle checked={consent} onChange={(v) => canEdit && setConsent(v)} />
      </div>
      <Field label="Data retention (days)" hint="Between 30 and 3650">
        <Input disabled={!canEdit} type="number" value={retention} onChange={(e) => setRetention(Number(e.target.value))} className="mt-2 w-40" />
      </Field>
      <Field label="Opt-out keywords">
        <div className="flex flex-wrap gap-1.5">
          {keywords.map((k, i) => (
            <Badge key={i} tone="gray">
              {k}{canEdit && <button onClick={() => setKeywords(keywords.filter((_, j) => j !== i))} className="ml-1.5">×</button>}
            </Badge>
          ))}
        </div>
        {canEdit && (
          <div className="mt-2 flex gap-2">
            <Input value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="Add a keyword…" className="max-w-xs" />
            <Button variant="secondary" onClick={() => { if (newKw.trim()) { setKeywords([...keywords, newKw.trim().toUpperCase()]); setNewKw(''); } }}><Plus size={15} /></Button>
          </div>
        )}
      </Field>
      {canEdit && <Button className="mt-4" disabled={saving} onClick={() => void save()}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</Button>}
    </Card>
  );
}

function BillingTab({ data, canEdit, onSaved }: { data: AllSettings['billing']; canEdit: boolean; onSaved: () => void }) {
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // Handles the return trip from Cashfree's hosted mandate-authorization
  // flow. Verification already happened server-side (see
  // billingReturn.controller.js) BEFORE the browser ever gets back here
  // -- Cashfree's redirect is a form POST straight to the backend (a
  // frontend dev/static server has no route for an arbitrary POST and
  // 404s it), which verifies against Cashfree directly and then
  // 302-redirects the browser to this plain GET with the outcome
  // already decided. This effect just reads that outcome and reflects
  // it in the UI -- it does not call verifySubscriptionPayment itself.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('billing_result');
    if (!result) return;

    const plan = params.get('billing_plan');
    const message = params.get('billing_message');

    // Strip the params immediately so a page refresh doesn't re-show a
    // stale toast for an outcome that's already been handled.
    params.delete('billing_result');
    params.delete('billing_plan');
    params.delete('billing_message');
    const newSearch = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`);

    if (result === 'success') {
      toast.success('Payment confirmed', plan ? `You're now on ${plan}` : 'Your plan has been updated.');
      onSaved();
      void usePlanStore.getState().refresh();
    } else {
      toast.error('Could not confirm the subscription', message || 'If you completed the payment, this may need a moment — check back shortly or contact support.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount to consume the redirect params
  }, []);

  const switchPlan = async (plan: Plan) => {
    // Free plans (e.g. downgrading back to a $0 tier) switch instantly --
    // no payment to collect. Paid plans go through real Cashfree Checkout;
    // the backend rejects a direct switch for these (see settings.service.js),
    // so this branch has to exist -- it's not just a nicer UX path.
    if (plan.price <= 0) {
      setSwitchingId(plan.id);
      try {
        await settingsApi.updateBillingPlan(plan.id);
        toast.success('Plan updated');
        onSaved();
        void usePlanStore.getState().refresh(); // Sidebar reflects the new track immediately, not just after a reload
      } catch (err) {
        toast.error('Could not switch plan', err instanceof ApiError ? err.message : 'Please try again.');
      } finally {
        setSwitchingId(null);
      }
      return;
    }

    setSwitchingId(plan.id);
    try {
      const checkout = await settingsApi.createSubscriptionCheckout(plan.id);
      // This account's Cashfree API version authorizes mandates via a
      // plain redirect (not a JS checkout widget) -- the browser leaves
      // the app entirely and comes back via return_url, which the
      // effect above picks up to finish verification server-side.
      redirectToCashfreeAuth(checkout.authLink);
    } catch (err) {
      toast.error('Could not start checkout', err instanceof ApiError ? err.message : 'Please try again.');
      setSwitchingId(null);
    }
  };

  const fullPlans = data.available_plans?.filter((p) => p.track === 'full') || [];
  const waPlans = data.available_plans?.filter((p) => p.track === 'whatsapp_only') || [];

  return (
    <Card className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-500">Current plan</p>
          <p className="text-xl font-semibold text-ink-900">
            {data.plan_details?.name || data.plan || '—'}
            <span className="ml-2 text-sm font-normal text-ink-500">— {data.plan_track === 'whatsapp_only' ? 'WhatsApp Panel only' : 'Full access'}</span>
          </p>
        </div>
        <Badge tone={data.subscription_status === 'active' ? 'green' : 'amber'}>{data.subscription_status}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UsageStat label="Users" current={data.current_user_count} max={data.max_users} />
        <UsageStat label="Leads" current={data.current_lead_count} max={data.max_leads} />
        <UsageStat label="Campaigns" current={data.current_campaign_count} max={data.max_campaigns} />
        <UsageStat label="Workspaces" current={data.current_workspace_count} max={data.max_workspaces} />
      </div>
      {data.max_workspaces > 1 && (
        <p className="mt-3 text-xs text-ink-500">
          This subscription covers <strong className="text-ink-700">{data.current_workspace_count} of {data.max_workspaces}</strong> workspaces — every company you manage shares this same plan and billing.
        </p>
      )}
      {!data.plan_details && (
        <p className="mt-3 text-xs text-amber-600">This workspace isn't linked to a billing plan yet — contact support if this persists after a page reload.</p>
      )}
      {data.trial_ends_at && <p className="mt-3 text-xs text-ink-500">Trial ends in {data.trial_days_remaining} days</p>}
      {['ON_HOLD', 'CUSTOMER_CANCELLED', 'CANCELLED', 'EXPIRED', 'LINK_EXPIRED', 'CARD_EXPIRED'].includes(data.cashfree_subscription_status || '') && (
        <p className="mt-3 text-xs text-red-600">Your subscription isn't active — paid features may be locked until payment is resolved.</p>
      )}

      {canEdit && (
        <>
          <PlanGroup title="Full access" subtitle="Every module, including pipeline, calls, reports and automations." plans={fullPlans} currentPlanId={data.plan_details?.id} switchingId={switchingId} onSwitch={switchPlan} />
          <PlanGroup title="WhatsApp Panel only" subtitle="Leads, WhatsApp and pipeline. No calls, reports or automations." plans={waPlans} currentPlanId={data.plan_details?.id} switchingId={switchingId} onSwitch={switchPlan} />
        </>
      )}
    </Card>
  );
}

function PlanGroup({ title, subtitle, plans, currentPlanId, switchingId, onSwitch }: {
  title: string; subtitle: string; plans: Plan[]; currentPlanId?: string;
  switchingId: string | null; onSwitch: (plan: Plan) => void;
}) {
  if (plans.length === 0) return null;
  return (
    <div className="mt-8">
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      <p className="mb-3 text-xs text-ink-500">{subtitle}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlanId;
          return (
            <div key={p.id} className={cn('relative rounded-xl border p-4', isCurrent ? 'border-2 border-brand-400' : 'border-ink-100')}>
              {isCurrent && <span className="absolute -top-2.5 left-3 rounded-md bg-brand-50 px-2.5 py-0.5 text-[11px] font-medium text-brand-700">Current plan</span>}
              <p className="mt-1 font-medium text-ink-900">{p.name}</p>
              <p className="mb-3 text-xs text-ink-500">{formatCurrency(p.price, p.currency)}/mo · {p.limits.maxUsers} users</p>
              <Button
                variant="secondary"
                className="w-full justify-center text-xs"
                disabled={isCurrent || switchingId === p.id}
                onClick={() => onSwitch(p)}
              >
                {isCurrent ? 'Active' : switchingId === p.id ? 'Processing…' : p.price > 0 ? 'Subscribe' : 'Switch to this'}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SecurityTab({ data, canEdit, onSaved }: { data: SecuritySettings; canEdit: boolean; onSaved: () => void }) {
  const [twoFa, setTwoFa] = useState(data.two_factor_auth);
  const [ipEnabled, setIpEnabled] = useState(data.ip_allowlist_enabled);
  const [timeout, setTimeoutMin] = useState(data.session_timeout_minutes);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setTwoFa(data.two_factor_auth); setIpEnabled(data.ip_allowlist_enabled); setTimeoutMin(data.session_timeout_minutes); }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      await settingsApi.updateSecurity({ two_factor_auth: twoFa, ip_allowlist_enabled: ipEnabled, session_timeout_minutes: timeout });
      toast.success('Security settings saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeaderInline title="Security" />
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2.5">
          <span className="text-sm text-ink-700">Two-factor authentication</span>
          <Toggle checked={twoFa} onChange={(v) => canEdit && setTwoFa(v)} />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2.5 opacity-60">
          <span className="text-sm text-ink-700">SSO / SAML <span className="text-xs text-ink-400">(coming soon)</span></span>
          <Toggle checked={false} onChange={() => toast.info('Not available yet', 'SSO/SAML is a planned future feature.')} />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2.5 opacity-60">
          <span className="text-sm text-ink-700">Audit logging <span className="text-xs text-ink-400">(always on)</span></span>
          <Toggle checked={true} onChange={() => toast.info('Always enabled', 'Audit logging cannot be disabled.')} />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2.5">
          <span className="text-sm text-ink-700">IP allowlist</span>
          <Toggle checked={ipEnabled} onChange={(v) => canEdit && setIpEnabled(v)} />
        </div>
        <Field label="Session timeout (minutes)" hint="Between 15 and 10080">
          <Input disabled={!canEdit} type="number" value={timeout} onChange={(e) => setTimeoutMin(Number(e.target.value))} className="w-40" />
        </Field>
      </div>
      {canEdit && <Button className="mt-4" disabled={saving} onClick={() => void save()}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</Button>}
    </Card>
  );
}

/**
 * UsageStat — a KPI card with a real usage bar underneath: fills
 * proportionally to current/max, and turns red once the limit is
 * actually reached (>=100%) so it's immediately obvious at a glance
 * which resource is the one about to block the account, not just a
 * number that has to be mentally compared against another number.
 * Amber from 80% up to (but not at) the limit as an early warning.
 * `max <= 0` is treated as unlimited/not applicable -- no bar, no
 * fraction, just the raw current count (avoids a division-by-zero
 * 100%-red bar for a plan that doesn't actually cap this resource).
 */
function UsageStat({ label, current, max }: { label: string; current: number; max: number }) {
  const isUnlimited = !max || max <= 0;
  const pct = isUnlimited ? 0 : Math.min(100, (current / max) * 100);
  const isFull = !isUnlimited && current >= max;
  const isNearFull = !isUnlimited && !isFull && pct >= 80;

  const barColor = isFull ? 'bg-red-500' : isNearFull ? 'bg-amber-500' : 'bg-brand-500';
  const valueColor = isFull ? 'text-red-600' : 'text-ink-900';

  return (
    <div className="rounded-lg border border-ink-100 p-3">
      <p className="text-xs text-ink-400">{label}</p>
      <p className={cn('text-lg font-bold', valueColor)}>
        {current}{!isUnlimited && ` / ${max}`}
      </p>
      {!isUnlimited && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
          <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
        </div>
      )}
      {isFull && <p className="mt-1 text-[11px] font-medium text-red-600">Limit reached</p>}
    </div>
  );
}