import { useState, useEffect } from 'react';
import { Save, Plus, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useSettings } from '@/hooks/useSettings';
import { settingsApi } from '@/lib/settingsApi';
import { applyAccentColor } from '@/utils/theme';
import { settingsPermissions } from '@/lib/permissions';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { PageHeader, Card, Button, Tabs, Field, Input, Toggle, Badge } from '@/components/ui';
import type {
  AllSettings, CompanySettings, BrandingSettings, LeadFieldsSettings, PipelineStageDisplay,
  QualificationSettings, ScoringRulesSettings,
  NotificationSettings, ConsentSettings, SecuritySettings, ScoringRule,
} from '@/types/settings';

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
            {tab === 'billing' && <BillingTab data={settings.billing} />}
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

function BillingTab({ data }: { data: AllSettings['billing'] }) {
  return (
    <Card className="p-6">
      <CardHeaderInline title="Billing" subtitle="Placeholder — managed by InnovateX platform" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Plan" value={data.plan_details?.name || data.plan || '—'} />
        <Stat label="Status" value={data.subscription_status} />
        <Stat label="MRR" value={`$${data.mrr}`} />
        <Stat label="Users" value={`${data.current_user_count} / ${data.max_users}`} />
        <Stat label="Leads" value={`${data.current_lead_count} / ${data.max_leads}`} />
        <Stat label="Campaigns" value={`${data.current_campaign_count} / ${data.max_campaigns}`} />
      </div>
      {!data.plan_details && (
        <p className="mt-3 text-xs text-amber-600">This workspace isn't linked to a billing plan yet — contact support if this persists after a page reload.</p>
      )}
      {data.trial_ends_at && <p className="mt-3 text-xs text-ink-500">Trial ends in {data.trial_days_remaining} days</p>}
      <Button variant="secondary" className="mt-4" onClick={() => toast.info('Billing portal', 'This is a placeholder — no live payment processor is connected in this build.')}>Manage billing</Button>
    </Card>
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

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-ink-100 p-3"><p className="text-xs text-ink-400">{label}</p><p className="text-lg font-bold text-ink-900">{value}</p></div>;
}