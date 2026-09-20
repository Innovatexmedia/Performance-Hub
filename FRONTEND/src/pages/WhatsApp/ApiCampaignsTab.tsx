/**
 * API Campaigns — the dashboard surface for campaigns triggered over HTTP.
 *
 * WHAT THIS IS NOT
 * ────────────────
 * Not a second campaign system. An API campaign is an ordinary
 * WhatsAppCampaign with type: 'API', created through the SAME endpoint as
 * every other campaign, sent by the SAME queue and worker. This file only
 * adds what an API-triggered campaign needs and a dashboard-triggered one
 * doesn't: credentials, a request contract to copy, and a history of runs.
 *
 * WHY NO AUDIENCE PICKER
 * ──────────────────────
 * A dashboard campaign owns its audience; an API campaign is handed its
 * recipients on every call. Showing an audience builder here would imply a
 * saved list the API silently ignores, so the create form deliberately stops
 * at template + variables.
 */

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import {
  Plus, Copy, Check, Terminal, KeyRound, Trash2, RefreshCw,
  AlertTriangle, ChevronRight, ChevronLeft, Pause as PauseIcon, Play as PlayIcon,
} from 'lucide-react';
import {
  Card, CardHeader, Button, Badge, Modal, Field, Input, Select,
  EmptyState, Table, Th, Td, Tr, Tabs, cn,
} from '@/components/ui';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { apiCampaignsApi, apiKeysApi } from '@/lib/apiCampaignsApi';

/** An API campaign only ever sits in one of three states. Anything else would
 *  be a dashboard-campaign status on a record that shouldn't have one. */
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Live',
  PAUSED: 'Paused',
  CANCELLED: 'Archived',
};
import { whatsappCampaignsApi } from '@/lib/whatsappCampaignsApi';
import { useWhatsAppTemplates } from '@/hooks/useWhatsAppTemplates';
import { timeAgo } from '@/utils/formatters';
import type { WhatsAppCampaign } from '@/types/whatsappCampaign';
import type { CampaignRun, ApiKey, CreatedApiKey } from '@/types/apiCampaign';
import { runProgress } from '@/types/apiCampaign';

/**
 * API_BASE — the URL a customer will paste into their own code.
 *
 * Derived from the same env var apiClient uses, so the docs shown here can
 * never drift from the deployment they were read on: a staging dashboard
 * shows the staging URL without anyone maintaining a second constant.
 */
const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api').replace(/\/api\/?$/, '');

/** Sample values used in the docs, so the variable table and the request
 *  example always show the SAME value for a given position -- a reader
 *  comparing the two should not have to wonder whether they differ for a
 *  reason. */
const SAMPLE_VALUES = ['Ravi', 'ORD-123', '2 Oct, 4:30 PM', '₹1,499', 'Mumbai'];

/** Error contract, kept as data so the table stays readable and the list is
 *  edited in one place when the API adds a case. */
const ERROR_ROWS: [string, string, string][] = [
  ['400', 'recipients missing or empty', 'Send at least one recipient'],
  ['401', 'Key missing, revoked or expired', 'Check the key, or create a new one'],
  ['403', 'Key lacks the campaigns:send scope', 'Create a key with that scope'],
  ['404', 'No campaign with that id', 'Check the id in the endpoint above'],
  ['409', 'Campaign paused, or template not approved by Meta', 'Fix it in the dashboard, then retry'],
  ['413', 'More than 1000 recipients in one call', 'Split the batch'],
  ['422', 'Idempotency-Key reused with a different body', 'Use a fresh key per distinct request'],
  ['429', 'Rate limit — 120 requests per minute per key', 'Back off and retry'],
];

/** Extracts {{1}}/{{name}} placeholders from a template body — the same shape
 *  the backend's extractPlaceholders finds, so the docs list exactly the
 *  variables the API will demand. */
function placeholdersOf(body: string): string[] {
  const found = String(body || '').match(/\{\{\s*([^}]+?)\s*\}\}/g) || [];
  return found.map((raw) => raw.replace(/[{}]/g, '').trim());
}

function CopyButton({ value, label = 'Copy', subtle = false }: { value: string; label?: string; subtle?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        // Reverts on its own so the button doesn't sit on "Copied" forever and
        // leave the user unsure whether a second click registered.
        setTimeout(() => setCopied(false), 1600);
      },
      () => toast.error('Copy failed', 'Your browser blocked clipboard access — select and copy manually.')
    );
  };

  // `subtle` is for copy actions sitting INSIDE a dark code block, where a
  // full button would compete with the code for attention. Same behaviour,
  // quieter presence.
  if (subtle) {
    return (
      <button
        type="button"
        onClick={copy}
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-ink-400 transition hover:bg-ink-800 hover:text-white"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : label}
      </button>
    );
  }

  return (
    <Button variant="secondary" onClick={copy} className="shrink-0">
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : label}
    </Button>
  );
}

/**
 * Code — a compact, editor-style block.
 *
 * Deliberately not a Card: a full card per snippet is what made this page read
 * as a stack of unrelated forms rather than documentation. A thin header strip
 * with the copy action, a dark body, and a capped height keeps four snippets
 * legible in the space one card used to take.
 */
function Code({ code, label, maxHeight = 'max-h-72' }: { code: string; label?: string; maxHeight?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-ink-800 bg-ink-950">
      <div className="flex items-center justify-between gap-2 border-b border-ink-800 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-ink-400">{label}</span>
        <CopyButton value={code} subtle />
      </div>
      <pre className={cn('overflow-auto px-3 py-2.5 font-mono text-[12px] leading-[1.7] text-ink-100', maxHeight)}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * CodeTabs — several snippets sharing one block.
 *
 * cURL, JavaScript and the response answer the same question in different
 * languages, so a reader needs exactly one of them. Stacking all three made
 * the page three times longer for no gain; tabs put the choice where it
 * belongs — with the reader.
 */
function CodeTabs({ items }: { items: { id: string; label: string; code: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  const current = items.find((i) => i.id === active) ?? items[0];

  return (
    <div className="overflow-hidden rounded-lg border border-ink-800 bg-ink-950">
      <div className="flex items-center gap-1 border-b border-ink-800 px-2 py-1.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActive(item.id)}
            className={cn(
              'rounded-md px-2.5 py-1 font-mono text-[11px] transition',
              item.id === current?.id ? 'bg-ink-800 text-white' : 'text-ink-400 hover:text-ink-200'
            )}
          >
            {item.label}
          </button>
        ))}
        <span className="ml-auto">
          <CopyButton value={current?.code ?? ''} subtle />
        </span>
      </div>
      <pre className="max-h-80 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-[1.7] text-ink-100">
        <code>{current?.code}</code>
      </pre>
    </div>
  );
}

/** Section — a labelled band. One rule, one label, content. No card chrome. */
function Section({
  label, title, description, children,
}: { label: string; title?: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-ink-200 pt-5">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">{label}</p>
      {title && <h3 className="mt-1 text-sm font-semibold text-ink-900">{title}</h3>}
      {description && <p className="mt-0.5 max-w-2xl text-sm text-ink-500">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const RUN_STATUS_TONE: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'gray'> = {
  COMPLETED: 'green',
  FAILED: 'red',
  RUNNING: 'blue',
  QUEUED: 'amber',
};

// ── API keys ────────────────────────────────────────────────────────────────

function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { keys: list } = await apiKeysApi.list();
      setKeys(list);
    } catch (err) {
      toast.error('Could not load API keys', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!name.trim()) return toast.error('Name required', 'Give the key a name so you can tell your keys apart later.');
    setCreating(true);
    try {
      const created = await apiKeysApi.create({ name: name.trim() });
      // Held in state rather than toasted: this is the only moment the secret
      // exists in the UI, and a toast that auto-dismisses would destroy it.
      setJustCreated(created);
      setShowCreate(false);
      setName('');
      await load();
    } catch (err) {
      toast.error('Could not create key', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!confirmRevoke) return;
    try {
      await apiKeysApi.revoke(confirmRevoke.id);
      toast.success('Key revoked', 'Any integration using it will stop working immediately.');
      setConfirmRevoke(null);
      await load();
    } catch (err) {
      toast.error('Could not revoke key', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<KeyRound size={18} />}
        title="API keys"
        subtitle="Used to authenticate your API campaign requests. Treat them like passwords."
        action={<Button onClick={() => setShowCreate(true)}><Plus size={16} /> New key</Button>}
      />

      {loading ? (
        <p className="px-4 py-6 text-sm text-ink-500">Loading…</p>
      ) : keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound size={22} />}
          title="No API keys yet"
          description="Create a key to start triggering campaigns from your own application."
          action={<Button onClick={() => setShowCreate(true)}><Plus size={16} /> Create your first key</Button>}
        />
      ) : (
        <Table>
          <thead>
            <Tr>
              <Th>Name</Th><Th>Key</Th><Th>Last used</Th><Th>Status</Th><Th />
            </Tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <Tr key={k.id}>
                <Td className="font-medium">{k.name}</Td>
                <Td><code className="text-xs text-ink-600">{k.prefix}…</code></Td>
                <Td className="text-ink-500">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Never'}</Td>
                <Td>
                  <Badge tone={k.isActive ? 'green' : 'gray'}>{k.isActive ? 'Active' : 'Revoked'}</Badge>
                </Td>
                <Td>
                  {k.isActive && (
                    <button
                      onClick={() => setConfirmRevoke(k)}
                      className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                      title="Revoke key"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New API key">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production backend"
            autoFocus
          />
        </Field>
        <p className="mt-2 text-xs text-ink-500">
          Name it after the system that will use it. When something goes wrong, this is how you know which
          integration to look at — and which key is safe to revoke.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => void create()} disabled={creating}>{creating ? 'Creating…' : 'Create key'}</Button>
        </div>
      </Modal>

      {/* Not dismissible by clicking away: closing this dialog destroys the
          only copy of the secret, so it takes a deliberate button press. */}
      <Modal open={!!justCreated} onClose={() => { /* intentionally inert */ }} title="Copy your API key now">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-900">
              This is the only time this key will be shown. We store a hash of it, not the key itself, so it
              cannot be recovered. If you lose it, revoke it and create a new one.
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs">
            {justCreated?.key}
          </code>
          <CopyButton value={justCreated?.key ?? ''} />
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={() => setJustCreated(null)}>I've saved it</Button>
        </div>
      </Modal>

      <Modal open={!!confirmRevoke} onClose={() => setConfirmRevoke(null)} title="Revoke this API key?">
        <p className="text-sm text-ink-600">
          Any application still using <code className="text-xs">{confirmRevoke?.prefix}…</code> will start
          getting 401 errors immediately. This cannot be undone — you'd need to create a new key and update
          your integration.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmRevoke(null)}>Keep it</Button>
          <Button variant="danger" onClick={() => void revoke()}>Revoke key</Button>
        </div>
      </Modal>
    </Card>
  );
}

// ── Integration docs for one campaign ───────────────────────────────────────

function IntegrationDocs({ campaign, templateBody }: { campaign: WhatsAppCampaign; templateBody: string }) {
  const placeholders = useMemo(() => placeholdersOf(templateBody), [templateBody]);

  const path = `/api/v1/campaigns/${campaign.id}/trigger`;
  const endpoint = `${API_BASE}${path}`;

  // Built from the campaign's REAL template placeholders, so what the customer
  // copies already matches this campaign instead of a generic sample they have
  // to reverse-engineer.
  const sampleVariables = placeholders.reduce<Record<string, string>>((acc, ph, i) => {
    acc[/^\d+$/.test(ph) ? String(i + 1) : ph] = SAMPLE_VALUES[i % SAMPLE_VALUES.length];
    return acc;
  }, {});

  const requestBody = {
    recipients: [
      { phone: '919876543210', name: 'Ravi', ...(placeholders.length ? { variables: sampleVariables } : {}) },
    ],
  };

  const bodyJson = JSON.stringify(requestBody, null, 2);

  const curl = `curl -X POST '${endpoint}' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-12345' \
  -d '${JSON.stringify(requestBody)}'`;

  const js = `const res = await fetch('${endpoint}', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${process.env.INNOVATEX_API_KEY}\`,
    'Content-Type': 'application/json',
    // Reuse the same key when retrying the same send, so a network
    // failure can't deliver the message twice.
    'Idempotency-Key': orderId,
  },
  body: JSON.stringify(${JSON.stringify(requestBody)}),
});

const { runId, queuedCount, rejected } = await res.json();`;

  const python = `import requests

requests.post(
    "${endpoint}",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Idempotency-Key": order_id,
    },
    json=${JSON.stringify(requestBody)},
)`;

  const responseSample = JSON.stringify(
    {
      success: true,
      runId: '66f0c2a1e4b0a1d2c3e4f5a6',
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: 'queued',
      requestedCount: 1,
      queuedCount: 1,
      rejectedCount: 0,
      rejected: [],
    },
    null,
    2
  );

  return (
    <div className="space-y-5">
      {/* ENDPOINT -- first, because it is the one thing a developer scrolls
          looking for. Method and path are visually separated so the line reads
          as an endpoint rather than a URL in a text field. */}
      <section>
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">Endpoint</p>
        <div className="mt-2 flex items-stretch gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-0 overflow-hidden rounded-lg border border-ink-200 bg-white">
            <span className="shrink-0 self-stretch bg-brand-600 px-3 py-2.5 font-mono text-xs font-bold text-white">POST</span>
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-3 py-2.5 font-mono text-[13px] text-ink-800">
              {endpoint}
            </code>
          </div>
          <CopyButton value={endpoint} label="Copy URL" />
        </div>
        <p className="mt-2 text-sm text-ink-500">
          Returns <code className="font-mono text-xs text-ink-700">202 Accepted</code> as soon as the recipients are
          queued — it does not wait for messages to be delivered.
        </p>
      </section>

      <Section
        label="Authentication"
        description="Send your API key on every request. Either header works; use whichever your tool makes easier."
      >
        <Code label="http" maxHeight="max-h-40" code={`Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
Idempotency-Key: order-12345    # optional, strongly recommended`} />
        <p className="mt-2 text-sm text-ink-500">
          Keys live on the <strong>API keys</strong> tab. Keep them on your server — anything shipped to a browser
          or mobile app can be read by anyone using it.
        </p>
      </Section>

      <Section
        label="Template variables"
        description={
          placeholders.length
            ? 'Every recipient must supply all of these. A recipient missing one is rejected; the rest of the batch still sends.'
            : undefined
        }
      >
        {placeholders.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <Check size={15} className="shrink-0 text-emerald-600" />
            <p className="text-sm text-emerald-900">
              This template needs no variables — send just <code className="font-mono text-xs">phone</code> for each
              recipient.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-ink-200">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-ink-50">
                  <th className="border-b border-ink-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Variable</th>
                  <th className="border-b border-ink-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Send as</th>
                  <th className="border-b border-ink-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Required</th>
                  <th className="border-b border-ink-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Example</th>
                </tr>
              </thead>
              <tbody>
                {placeholders.map((ph, i) => (
                  <tr key={`${ph}-${i}`}>
                    <td className="border-b border-ink-100 px-3 py-2 font-mono text-xs text-ink-700">{`{{${ph}}}`}</td>
                    <td className="border-b border-ink-100 px-3 py-2 font-mono text-xs text-ink-700">
                      {/^\d+$/.test(ph) ? `"${i + 1}"` : `"${ph}"`}
                    </td>
                    <td className="border-b border-ink-100 px-3 py-2 text-ink-600">Yes</td>
                    <td className="border-b border-ink-100 px-3 py-2 font-mono text-xs text-ink-500">
                      {SAMPLE_VALUES[i % SAMPLE_VALUES.length]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        label="Request body"
        description="One or more recipients, up to 1000 per request. Phone numbers must include the country code."
      >
        <Code label="json" code={bodyJson} maxHeight="max-h-64" />
      </Section>

      <Section label="Examples" description="The same request, in whichever form suits your stack.">
        <CodeTabs
          items={[
            { id: 'curl', label: 'cURL', code: curl },
            { id: 'js', label: 'JavaScript', code: js },
            { id: 'py', label: 'Python', code: python },
            { id: 'res', label: '202 Response', code: responseSample },
          ]}
        />
      </Section>

      <Section label="Errors" description="Every failure returns a status and a message you can branch on.">
        <div className="overflow-hidden rounded-lg border border-ink-200">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {ERROR_ROWS.map(([code, when, action]) => (
                <tr key={code}>
                  <td className="w-16 border-b border-ink-100 px-3 py-2 font-mono text-xs font-semibold text-ink-900">{code}</td>
                  <td className="border-b border-ink-100 px-3 py-2 text-ink-700">{when}</td>
                  <td className="border-b border-ink-100 px-3 py-2 text-ink-500">{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// ── Runs ────────────────────────────────────────────────────────────────────

function RunsPanel({ campaignId }: { campaignId?: string }) {
  const [runs, setRuns] = useState<CampaignRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiCampaignsApi.listRuns({ campaignId, limit: 20 });
      setRuns(result.runs);
    } catch (err) {
      toast.error('Could not load runs', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader
        title="Recent runs"
        subtitle="One row per API call. Counts update as the queue drains."
        action={<Button variant="secondary" onClick={() => void load()}><RefreshCw size={14} /> Refresh</Button>}
      />

      {loading ? (
        <p className="px-4 py-6 text-sm text-ink-500">Loading…</p>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<Terminal size={22} />}
          title="No runs yet"
          description="Trigger the endpoint from your application or Postman — the first run will appear here."
        />
      ) : (
        <Table>
          <thead>
            <Tr>
              <Th>When</Th><Th>Status</Th><Th>Queued</Th><Th>Sent</Th><Th>Failed</Th><Th>Rejected</Th><Th>Key</Th><Th />
            </Tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const pct = Math.round(runProgress(run) * 100);
              const isOpen = expanded === run.id;
              return (
                <Fragment key={run.id}>
                  <Tr>
                    <Td className="whitespace-nowrap text-ink-500">{timeAgo(run.createdAt)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Badge tone={RUN_STATUS_TONE[run.status] ?? 'gray'}>{run.status}</Badge>
                        {(run.status === 'RUNNING' || run.status === 'QUEUED') && (
                          <span className="text-xs text-ink-500">{pct}%</span>
                        )}
                      </div>
                    </Td>
                    <Td>{run.queuedCount}</Td>
                    <Td className="text-green-700">{run.sentCount}</Td>
                    <Td className={cn(run.failedCount > 0 && 'text-red-600')}>{run.failedCount}</Td>
                    <Td className={cn(run.rejectedCount > 0 && 'text-amber-600')}>{run.rejectedCount}</Td>
                    <Td><code className="text-xs text-ink-500">{run.apiKeyPrefix || '—'}</code></Td>
                    <Td>
                      {(run.rejectedRecipients.length > 0 || run.failureReason) && (
                        <button
                          onClick={() => setExpanded(isOpen ? null : run.id)}
                          className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                          title="Show details"
                        >
                          <ChevronRight size={14} className={cn('transition', isOpen && 'rotate-90')} />
                        </button>
                      )}
                    </Td>
                  </Tr>

                  {isOpen && (
                    <Tr>
                      <Td colSpan={8}>
                        <div className="rounded-lg bg-ink-50 p-3">
                          {run.failureReason && (
                            <p className="mb-2 text-sm text-red-700">{run.failureReason}</p>
                          )}
                          {run.rejectedRecipients.length > 0 && (
                            <>
                              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                                Rejected before sending
                              </p>
                              <ul className="space-y-1">
                                {run.rejectedRecipients.map((r, i) => (
                                  <li key={`${r.phone}-${i}`} className="text-sm text-ink-700">
                                    <code className="text-xs">{r.phone || '(no phone)'}</code>
                                    <span className="text-ink-400"> — </span>
                                    {r.reason}
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ── Main tab ────────────────────────────────────────────────────────────────

export function ApiCampaignsTab({ onBack }: { onBack?: () => void }) {
  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WhatsAppCampaign | null>(null);
  const [view, setView] = useState<'list' | 'keys'>('list');
  const [detailTab, setDetailTab] = useState('integration');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', templateId: '' });
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WhatsAppCampaign | null>(null);

  const { templates } = useWhatsAppTemplates();

  // Only Meta-approved templates can be sent, so offering anything else would
  // build a campaign that is guaranteed to fail at trigger time.
  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.approvalStatus === 'PROVIDER_APPROVED'),
    [templates]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await whatsappCampaignsApi.list({ limit: 100 });
      setCampaigns(data.filter((c: WhatsAppCampaign) => c.type === 'API'));
    } catch (err) {
      toast.error('Could not load API campaigns', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!form.name.trim()) return toast.error('Name required');
    if (!form.templateId) return toast.error('Template required', 'Pick an approved template for this campaign to send.');

    setCreating(true);
    try {
      // Same endpoint every other campaign uses. `type: 'API'` is the only
      // thing that makes it triggerable over HTTP; there is no separate
      // creation path to keep in sync.
      const created = await whatsappCampaignsApi.create({
        name: form.name.trim(),
        type: 'API',
        templateId: form.templateId,
        audience: {},
      });
      toast.success('API campaign created', 'Activate it, then copy the endpoint into your application.');
      setShowCreate(false);
      setForm({ name: '', templateId: '' });
      await load();
      setSelected(created);
    } catch (err) {
      toast.error('Could not create campaign', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setCreating(false);
    }
  };

  /**
   * Lifecycle. Deliberately NOT the campaign approve endpoint: that requires a
   * saved audience before it will approve, which an API campaign has none of
   * by design -- every trigger brings its own recipients. Approving one
   * failed with "Campaign must have an audience", which was the right check
   * asked of the wrong kind of campaign.
   */
  const setLive = async (campaign: WhatsAppCampaign, live: boolean) => {
    try {
      const updated = live
        ? await apiCampaignsApi.activate(campaign.id)
        : await apiCampaignsApi.pause(campaign.id);

      toast.success(
        live ? 'Campaign is live' : 'Campaign paused',
        live
          ? 'Your endpoint now accepts requests.'
          : 'New requests will be rejected. Runs already queued will finish sending.'
      );
      setSelected(updated);
      await load();
    } catch (err) {
      toast.error(
        live ? 'Could not activate' : 'Could not pause',
        err instanceof ApiError ? err.message : 'Please try again.'
      );
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    try {
      await whatsappCampaignsApi.delete(confirmDelete.id);
      toast.success('Campaign deleted');
      setConfirmDelete(null);
      setSelected(null);
      await load();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const selectedTemplateBody = useMemo(() => {
    if (!selected) return '';
    const tpl = templates.find((t) => t.id === String(selected.templateId));
    return tpl?.body ?? '';
  }, [selected, templates]);

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selected) {
    const isLive = selected.status === 'ACTIVE';

    return (
      <div className="space-y-4">
        {/* Header is plain markup rather than a Card: on a documentation page
            the title should introduce the content below it, not sit in a
            container that competes with the sections it introduces. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
              API Campaign
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-ink-900">{selected.name}</h2>
              <Badge tone={selected.status === 'ACTIVE' ? 'green' : selected.status === 'PAUSED' ? 'amber' : 'gray'}>{isLive ? 'Live' : selected.status}</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-ink-500">
              Trigger this WhatsApp campaign programmatically from your website, app or backend.
              {selected.templateName && (
                <> Sends the <code className="font-mono text-xs text-ink-700">{selected.templateName}</code> template.</>
              )}
            </p>
            <p className="mt-1.5 text-xs text-ink-400">
              {selected.metrics?.sentCount ?? 0} sent · {selected.metrics?.failedCount ?? 0} failed, all time
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={() => setSelected(null)}>
              <ChevronLeft size={15} /> All API campaigns
            </Button>
            {selected.status === 'ACTIVE' ? (
              <Button variant="secondary" onClick={() => void setLive(selected, false)}>
                <PauseIcon size={14} /> Pause
              </Button>
            ) : selected.status === 'PAUSED' ? (
              <Button onClick={() => void setLive(selected, true)}><PlayIcon size={14} /> Resume</Button>
            ) : (
              <Button onClick={() => void setLive(selected, true)}>Activate API campaign</Button>
            )}
            <Button variant="secondary" onClick={() => setConfirmDelete(selected)} title="Delete campaign">
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        {!isLive && (
          <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-900">
              {selected.status === 'PAUSED'
                ? <>This campaign is paused, so the endpoint below returns <strong>409</strong>. Resume it to start accepting requests again. Runs already queued are still sending.</>
                : <>Activate this API campaign to start accepting API requests. Until then the endpoint below returns <strong>409</strong> — useful for testing your error handling first.</>}
            </p>
          </div>
        )}

        <Tabs
          tabs={[{ id: 'integration', label: 'Integration' }, { id: 'runs', label: 'Runs' }]}
          active={detailTab}
          onChange={setDetailTab}
        />

        {detailTab === 'integration'
          ? <IntegrationDocs campaign={selected} templateBody={selectedTemplateBody} />
          : <RunsPanel campaignId={selected.id} />}

        <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete this API campaign?">
          <p className="text-sm text-ink-600">
            Any application still calling this endpoint will start getting <strong>404</strong> errors. Past
            runs and the messages already sent are not affected.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void remove()}>Delete campaign</Button>
          </div>
        </Modal>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<Terminal size={18} />}
          title="API Campaigns"
          subtitle="Campaigns your own systems trigger over HTTP. Each call supplies its own recipients and variables."
          action={
            <>
              {/* Same affordance as the Campaigns tab: this view is reached
                  from the chooser, so it needs a way back to it. */}
              {onBack && (
                <Button variant="secondary" onClick={onBack} title="Back to campaign types">
                  <ChevronLeft size={16} /> All campaign types
                </Button>
              )}
              <Button variant={view === 'keys' ? 'primary' : 'secondary'} onClick={() => setView(view === 'keys' ? 'list' : 'keys')}>
                <KeyRound size={16} /> API keys
              </Button>
              <Button onClick={() => setShowCreate(true)}><Plus size={16} /> Create API campaign</Button>
            </>
          }
        />
      </Card>

      {view === 'keys' ? (
        <ApiKeysPanel />
      ) : loading ? (
        <Card><p className="px-4 py-6 text-sm text-ink-500">Loading…</p></Card>
      ) : campaigns.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Terminal size={22} />}
            title="No API campaigns yet"
            description="Unlike a broadcast, an API campaign has no saved audience — your application sends the recipients with every request. Useful for order updates, OTPs, delivery alerts and anything triggered by your own system."
            action={<Button onClick={() => setShowCreate(true)}><Plus size={16} /> Create your first one</Button>}
          />
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <Tr><Th>Name</Th><Th>Status</Th><Th>Template</Th><Th>Sent</Th><Th>Failed</Th><Th /></Tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>
                    <Badge tone={c.status === 'ACTIVE' ? 'green' : c.status === 'PAUSED' ? 'amber' : 'gray'}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </Badge>
                  </Td>
                  <Td className="text-ink-500">{c.templateName || '—'}</Td>
                  <Td>{c.metrics?.sentCount ?? 0}</Td>
                  <Td className={cn((c.metrics?.failedCount ?? 0) > 0 && 'text-red-600')}>{c.metrics?.failedCount ?? 0}</Td>
                  <Td>
                    <Button variant="secondary" onClick={() => { setSelected(c); setDetailTab('integration'); }}>
                      Integration <ChevronRight size={14} />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {view === 'list' && campaigns.length > 0 && <RunsPanel />}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create API campaign">
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Order confirmation"
            autoFocus
          />
        </Field>

        <div className="mt-3" />
        <Field label="Template">
          <Select value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
            <option value="">Select an approved template…</option>
            {approvedTemplates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.languageCode})</option>
            ))}
          </Select>
        </Field>

        {approvedTemplates.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">
            No Meta-approved templates yet. Submit one for approval first — only approved templates can be sent.
          </p>
        )}

        <p className="mt-3 text-xs text-ink-500">
          No audience to pick here: an API campaign receives its recipients with every request. Once saved,
          you'll get the endpoint and ready-to-paste code examples.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => void create()} disabled={creating}>{creating ? 'Creating…' : 'Create'}</Button>
        </div>
      </Modal>
    </div>
  );
}

export default ApiCampaignsTab;