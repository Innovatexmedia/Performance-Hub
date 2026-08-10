import { useState } from 'react';
import { RefreshCw, Settings as SettingsIcon, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useIntegrations } from '@/hooks/useIntegrations';
import { integrationPermissions } from '@/lib/permissions';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { PageHeader, Card, Button, Badge, Tabs, Modal, Field, Input } from '@/components/ui';
import { timeAgo } from '@/utils/formatters';
import { INTEGRATION_CATEGORY_VALUES } from '@/types/integration';
import type { Integration } from '@/types/integration';

/**
 * Integrations -- confirmed spec-aligned (MASTER_SPEC B17, DEVELOPER_HANDOFF
 * entity/action list). All 3 named actions real (toggle/sync/updateConfig),
 * 22-item catalog auto-seeded per tenant on first load, matching spec's
 * count exactly. MASTER_SPEC explicitly marks this "🟡 simulated" -- the
 * connection state is genuinely real and persisted, but no live external
 * API calls are made to Stripe/Twilio/etc. Not fixed/changed from that
 * design, per instruction.
 */
export function Integrations() {
  const role = useAuthStore((s) => s.user?.role);
  const canManage = integrationPermissions.canManage(role);
  const [category, setCategory] = useState('all');
  const { integrations, counts, loading, error, toggle, sync, updateConfig } =
    useIntegrations(category === 'all' ? {} : { category: category as never });

  const [config, setConfig] = useState<Integration | null>(null);
  const [configForm, setConfigForm] = useState({ api_key: '', webhook_url: '' });
  const [waForm, setWaForm] = useState({ phoneNumberId: '', businessAccountId: '', accessToken: '', appSecret: '' });
  const [dialog360Form, setDialog360Form] = useState({ apiKey: '' });
  const [twilioForm, setTwilioForm] = useState({ accountSid: '', authToken: '', whatsappNumber: '' });
  const [interaktForm, setInteraktForm] = useState({ apiKey: '' });
  const [logsFor, setLogsFor] = useState<Integration | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tabs = [
    { id: 'all', label: `All (${counts?.total ?? 0})` },
    ...INTEGRATION_CATEGORY_VALUES.map((c) => ({ id: c, label: `${c} (${counts?.byCategory[c]?.count ?? 0})` })),
  ];

  const handleToggle = async (i: Integration) => {
    if ((i.key === 'meta_cloud' || i.key === '360dialog' || i.key === 'twilio_wa' || i.key === 'interakt') && i.status === 'disconnected') {
      openConfig(i);
      return;
    }
    setBusyId(i.id);
    try {
      await toggle(i.id);
      toast.success(i.status === 'disconnected' ? 'Integration connected' : 'Integration disconnected');
    } catch (err) {
      toast.error('Could not update integration', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSync = async (i: Integration) => {
    setBusyId(i.id);
    try {
      await sync(i.id);
      toast.success('Synced', 'Last sync time updated');
    } catch (err) {
      toast.error('Could not sync', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const openConfig = (i: Integration) => {
    setConfig(i);
    if (i.key === 'meta_cloud') {
      setWaForm({
        phoneNumberId: typeof i.config.phoneNumberId === 'string' ? i.config.phoneNumberId : '',
        businessAccountId: typeof i.config.businessAccountId === 'string' ? i.config.businessAccountId : '',
        accessToken: '',
        appSecret: '',
      });
      return;
    }
    if (i.key === '360dialog') {
      setDialog360Form({ apiKey: '' });
      return;
    }
    if (i.key === 'twilio_wa') {
      setTwilioForm({
        accountSid: '',
        authToken: '',
        whatsappNumber: typeof i.config.whatsappNumber === 'string' ? i.config.whatsappNumber : '',
      });
      return;
    }
    if (i.key === 'interakt') {
      setInteraktForm({ apiKey: '' });
      return;
    }
    setConfigForm({
      api_key: typeof i.config.api_key === 'string' ? i.config.api_key : '',
      webhook_url: typeof i.config.webhook_url === 'string' ? i.config.webhook_url : '',
    });
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      if (config.key === 'meta_cloud') {
        await updateConfig(config.id, {
          phoneNumberId: waForm.phoneNumberId,
          businessAccountId: waForm.businessAccountId,
          ...(waForm.accessToken ? { accessToken: waForm.accessToken } : {}),
          ...(waForm.appSecret ? { appSecret: waForm.appSecret } : {}),
        });
        toast.success('Connected', 'Credentials verified against Meta\u2019s real Graph API.');
      } else if (config.key === '360dialog') {
        await updateConfig(config.id, {
          ...(dialog360Form.apiKey ? { apiKey: dialog360Form.apiKey } : {}),
        });
        toast.success('Connected', 'API key verified against 360Dialog\u2019s real Messaging API.');
      } else if (config.key === 'twilio_wa') {
        await updateConfig(config.id, {
          accountSid: twilioForm.accountSid,
          whatsappNumber: twilioForm.whatsappNumber,
          ...(twilioForm.authToken ? { authToken: twilioForm.authToken } : {}),
        });
        toast.success('Connected', 'Credentials verified against Twilio\u2019s real Account API.');
      } else if (config.key === 'interakt') {
        await updateConfig(config.id, {
          ...(interaktForm.apiKey ? { apiKey: interaktForm.apiKey } : {}),
        });
        toast.success('Connected', 'API key verified. Note: Interakt only supports pre-approved templates, not free text.');
      } else {
        await updateConfig(config.id, { api_key: configForm.api_key, webhook_url: configForm.webhook_url });
        toast.success('Settings saved');
      }
      setConfig(null);
    } catch (err) {
      // For meta_cloud, this is a REAL rejection from Meta's API (invalid
      // token, wrong phone number ID, etc.) -- not a generic failure.
      toast.error('Could not verify connection', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Integrations" description="Connect WhatsApp providers, payments, AI, calendars & more to power every part of your workspace."
        breadcrumb={['Admin', 'Integrations']}
        actions={<Badge tone="violet">{counts?.totalConnected ?? 0} connected</Badge>}
      />

      <div className="mb-4"><Tabs tabs={tabs} active={category} onChange={setCategory} /></div>

      {error && <Card className="mb-4 p-4 text-sm text-red-600">{error}</Card>}
      {loading && integrations.length === 0 && <p className="p-8 text-center text-sm text-ink-400">Loading integrations…</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {integrations.map((i) => (
          <Card key={i.id} className="flex flex-col p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl font-bold text-white" style={{ background: i.logo_color }}>{i.name[0]}</span>
                <div><p className="font-semibold text-ink-900">{i.name}</p><p className="text-xs text-ink-500">{i.category}</p></div>
              </div>
              {!i.available ? (
                <Badge tone="gray">Coming soon</Badge>
              ) : (
                <Badge tone={i.status === 'connected' ? 'green' : i.status === 'simulation' ? 'amber' : 'gray'}>
                  {i.status === 'connected' && <CheckCircle2 size={11} />} {i.status}
                </Badge>
              )}
            </div>
            <p className="mt-3 flex-1 text-sm text-ink-500">{i.description}</p>
            {i.last_sync && <p className="mt-2 text-xs text-ink-400">Last sync: {timeAgo(i.last_sync)}</p>}
            {canManage && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button
                  variant={i.status === 'disconnected' ? 'primary' : 'secondary'} className="px-3 py-1.5 text-xs"
                  disabled={busyId === i.id || (!i.available && i.status === 'disconnected')}
                  onClick={() => void handleToggle(i)}
                >
                  {i.status === 'disconnected' ? 'Connect' : 'Disconnect'}
                </Button>
                {i.status !== 'disconnected' && (
                  <Button variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={busyId === i.id} onClick={() => void handleSync(i)}><RefreshCw size={13} /> Sync</Button>
                )}
                <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => openConfig(i)}><SettingsIcon size={13} /></Button>
                {i.error_logs.length > 0 && <Button variant="ghost" className="px-2.5 py-1.5 text-xs text-amber-600" onClick={() => setLogsFor(i)}><AlertCircle size={13} /></Button>}
              </div>
            )}
          </Card>
        ))}
      </div>

      {config && (
        <Modal
          open onClose={() => setConfig(null)} title={`${config.name} Settings`}
          footer={<><Button variant="secondary" onClick={() => setConfig(null)} disabled={saving}>Cancel</Button><Button onClick={() => void handleSaveConfig()} disabled={saving}>{saving ? 'Verifying…' : 'Save & Connect'}</Button></>}
        >
          {config.key === 'meta_cloud' ? (
            <div className="space-y-4">
              <p className="text-xs text-ink-500">This is your real Meta WhatsApp Cloud API connection — the same one used by the WhatsApp Panel. Saving here will make a real, live call to Meta's Graph API to verify these credentials.</p>
              <Field label="Phone Number ID"><Input value={waForm.phoneNumberId} onChange={(e) => setWaForm({ ...waForm, phoneNumberId: e.target.value })} placeholder="e.g. 1191287804063107" /></Field>
              <Field label="Business Account ID"><Input value={waForm.businessAccountId} onChange={(e) => setWaForm({ ...waForm, businessAccountId: e.target.value })} /></Field>
              <Field label="Access Token"><Input type="password" value={waForm.accessToken} onChange={(e) => setWaForm({ ...waForm, accessToken: e.target.value })} placeholder={config.config.hasAccessToken ? 'Already set — leave blank to keep' : 'Paste your Meta access token'} /></Field>
              <Field label="App Secret"><Input type="password" value={waForm.appSecret} onChange={(e) => setWaForm({ ...waForm, appSecret: e.target.value })} placeholder={config.config.hasAppSecret ? 'Already set — leave blank to keep' : 'Required for webhook verification'} /></Field>
            </div>
          ) : config.key === '360dialog' ? (
            <div className="space-y-4">
              <p className="text-xs text-ink-500">This makes a real, live call to 360Dialog's Messaging API to verify your key. 360Dialog only needs one credential — the key is already scoped to your specific WhatsApp number on their side.</p>
              <Field label="D360 API Key"><Input type="password" value={dialog360Form.apiKey} onChange={(e) => setDialog360Form({ apiKey: e.target.value })} placeholder={config.config.hasApiKey ? 'Already set — leave blank to keep' : 'Paste your 360Dialog API key'} /></Field>
            </div>
          ) : config.key === 'twilio_wa' ? (
            <div className="space-y-4">
              <p className="text-xs text-ink-500">This makes a real, live call to Twilio's Account API to verify these credentials. Twilio uses Basic Auth (Account SID + Auth Token), unlike Meta or 360Dialog.</p>
              <Field label="Account SID"><Input value={twilioForm.accountSid} onChange={(e) => setTwilioForm({ ...twilioForm, accountSid: e.target.value })} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" /></Field>
              <Field label="Auth Token"><Input type="password" value={twilioForm.authToken} onChange={(e) => setTwilioForm({ ...twilioForm, authToken: e.target.value })} placeholder={config.config.hasAuthToken ? 'Already set — leave blank to keep' : 'Paste your Twilio Auth Token'} /></Field>
              <Field label="WhatsApp-enabled number" hint="Your Twilio number with WhatsApp enabled, e.g. +14155238886"><Input value={twilioForm.whatsappNumber} onChange={(e) => setTwilioForm({ ...twilioForm, whatsappNumber: e.target.value })} placeholder="+14155238886" /></Field>
            </div>
          ) : config.key === 'interakt' ? (
            <div className="space-y-4">
              <p className="text-xs text-ink-500">This makes a real, live call to Interakt's API to verify your key.</p>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <strong>Real limitation, not a bug:</strong> Interakt's public API only supports pre-approved WhatsApp templates — it does not support plain free-text messages. Connecting here verifies your credentials for real, but sending through the normal Inbox composer will fail until template sending is added.
              </div>
              <Field label="API Key"><Input type="password" value={interaktForm.apiKey} onChange={(e) => setInteraktForm({ apiKey: e.target.value })} placeholder={config.config.hasApiKey ? 'Already set — leave blank to keep' : 'Paste your Interakt API key'} /></Field>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="API Key / Token"><Input type="password" value={configForm.api_key} onChange={(e) => setConfigForm({ ...configForm, api_key: e.target.value })} placeholder="Enter API key…" /></Field>
              <Field label="Webhook URL"><Input value={configForm.webhook_url} onChange={(e) => setConfigForm({ ...configForm, webhook_url: e.target.value })} placeholder="https://…" /></Field>
              <p className="text-xs text-ink-400">This runs in simulation mode — credentials are saved but no live connection is made to {config.name}.</p>
            </div>
          )}
        </Modal>
      )}

      {logsFor && (
        <Modal open onClose={() => setLogsFor(null)} title={`${logsFor.name} — Error Logs`}>
          <div className="space-y-2">
            {logsFor.error_logs.map((l, i) => (
              <div key={i} className={`flex items-start gap-2 rounded-lg p-3 text-sm ${l.severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <div className="flex-1"><p>{l.message}</p><p className="mt-0.5 text-xs opacity-70">{timeAgo(l.occurred_at)}</p></div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
