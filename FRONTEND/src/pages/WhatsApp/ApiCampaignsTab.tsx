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

import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import {
  Plus, Copy, Check, Terminal, KeyRound, Trash2, RefreshCw,
  AlertTriangle, ChevronRight, ChevronLeft, Pause as PauseIcon, Play as PlayIcon, Link2 as LinkIcon,
} from 'lucide-react';
import {
  Card, CardHeader, Button, Badge, Modal, Field, Input, Select,
  EmptyState, Table, Th, Td, Tr, cn,
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
 * apiBaseFromEnv — the fallback origin, used only until the backend answers.
 *
 * Strips the trailing /api because VITE_API_URL points at the API root
 * (".../api") while the documentation shows full paths that begin with
 * /api/v1 — concatenating both would produce ".../api/api/v1".
 *
 * This is a fallback, NOT the source of truth. A build that never set
 * VITE_API_URL used to show customers `http://localhost:4001` in production
 * documentation, confidently and with nothing anywhere to flag it. The
 * backend reports its own public origin instead (see useApiBase); this only
 * fills the gap for the first render.
 */
function apiBaseFromEnv(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/api\/?$/, '');
  // Same-origin guess beats a hardcoded localhost in a deployed build.
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:4001';
}

/**
 * useApiBase — asks the backend what its public origin is.
 *
 * The backend derives it from the request it receives, so it is right by
 * construction on every environment, including ones nobody remembered to
 * configure.
 */
function useApiBase(): string {
  const [base, setBase] = useState(apiBaseFromEnv);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { baseUrl } = await apiCampaignsApi.getApiBase();
        if (!cancelled && baseUrl) setBase(baseUrl.replace(/\/$/, ''));
      } catch {
        // Keep the fallback. Documentation with a best-guess URL is better
        // than documentation that fails to render.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return base;
}

/** Sample values used in the docs, so the variable table and the request
 *  example always show the SAME value for a given position -- a reader
 *  comparing the two should not have to wonder whether they differ for a
 *  reason. */
const SAMPLE_VALUES = ['Ram Kshatriya', 'ORD-4821', '2 Oct, 4:30 PM', '₹1,499', 'Mumbai'];

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
  ['429', 'Daily or monthly send limit reached (code SEND_QUOTA_EXCEEDED)', 'Wait for the reset, or raise the limit in WhatsApp Settings'],
];

/**
 * API_SURFACE — the warm dark shell the whole API Campaigns section sits on.
 *
 * WHY SCOPED OVERRIDES INSTEAD OF DARK COMPONENTS
 * ───────────────────────────────────────────────
 * Card, Table, Th/Td, EmptyState and Badge are shared with every other page
 * in the app and are styled for a light surface. Restyling them would restyle
 * those pages too; forking dark copies would leave two components to keep in
 * step. The arbitrary-variant selectors below re-skin them for this subtree
 * only, so the shared components stay exactly as they are everywhere else.
 *
 * The tint is warm (a brown-black rather than a blue-black) so it reads as a
 * deliberate surface rather than as the light UI with the lights switched
 * off, and it stays distinct from the app's own blue-grey ink palette.
 */
/**
 * API_DIALOG — the dark panel for dialogs opened from this section.
 *
 * Dialogs portal to document.body, so they sit outside the section's own
 * surface and can't inherit it: every one of them opened as a white card on
 * top of a dark page. Passed via Modal's surfaceClassName, which leaves every
 * other dialog in the app exactly as it was.
 */
const API_DIALOG = cn(
  'bg-[#16100d] text-ink-300 ring-1 ring-white/10',
  '[&_h2]:text-white [&_strong]:text-ink-100',
  '[&_.label]:text-ink-300',
  '[&_.input]:border-white/15 [&_.input]:bg-white/[0.04] [&_.input]:text-ink-100 [&_.input]:placeholder-ink-500',
  '[&_.btn-secondary]:border-white/15 [&_.btn-secondary]:bg-white/[0.06] [&_.btn-secondary]:text-ink-100',
  '[&_.btn-secondary:hover]:bg-white/[0.12] [&_.btn-secondary:hover]:text-white',
  // The dialog's own header divider and close button.
  '[&>div]:border-white/10',
  '[&_.modal-close:hover]:bg-white/10 [&_.modal-close:hover]:text-white',
);

const API_SURFACE = cn(
  // Negative margins cancel the panel's own padding so the tint runs edge to
  // edge. Inset, it read as a dark card dropped onto a light page -- the light
  // border around it was the thing that looked wrong, not the tint.
  // -mr matches the extra right padding WhatsAppPanel reserves for the
  // floating Exit control.
  '-m-4 -mr-12 min-h-full p-5 lg:-m-6 lg:-mr-14 lg:p-6',
  'bg-[#16100d] text-ink-300',
  // Cards become translucent panels on the tint instead of solid white.
  '[&_.card]:border-white/10 [&_.card]:bg-white/[0.03] [&_.card]:shadow-none',
  // Tables: header band, hairline rows, readable body text.
  '[&_thead_th]:border-white/10 [&_thead_th]:bg-white/[0.04] [&_thead_th]:text-ink-400',
  '[&_td]:border-white/5 [&_td]:text-ink-200',
  '[&_tbody_tr:hover]:bg-white/[0.03]',
  // Headings and strong text.
  '[&_h2]:text-white [&_h3]:text-white [&_strong]:text-ink-100',
  // The dashed empty-state box.
  '[&_.border-dashed]:border-white/15',
  // Buttons. btn-secondary is a white pill by design, which is right on a
  // light page and a hole punched in a dark one; btn-primary keeps the brand
  // fill, since that is the one thing that should still shout.
  '[&_.btn-secondary]:border-white/15 [&_.btn-secondary]:bg-white/[0.06] [&_.btn-secondary]:text-ink-100',
  '[&_.btn-secondary:hover]:bg-white/[0.12] [&_.btn-secondary:hover]:text-white',
  '[&_.btn-ghost]:text-ink-300 [&_.btn-ghost:hover]:bg-white/10 [&_.btn-ghost:hover]:text-white',
  // Inputs and selects inside the surface's dialogs-in-place.
  '[&_.input]:border-white/15 [&_.input]:bg-white/[0.04] [&_.input]:text-ink-100',
  '[&_.label]:text-ink-300',
);

/**
 * SubTabs — a quieter tab strip than the shared `Tabs` component.
 *
 * Local rather than a change to components/ui: that one is used across the
 * whole app, and restyling it to suit this page would silently restyle every
 * other page that relies on its current weight. Here the tabs sit directly
 * under a page title and should read as secondary navigation, not as a second
 * headline — so: no filled pills, a thin underline on the active item, and
 * colour doing the work instead of weight.
 */
function SubTabs({
  tabs, active, onChange,
}: { tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex items-center gap-5 border-b border-white/10">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative -mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-1 pb-2.5 pt-1 text-sm',
              'transition-colors duration-150 ease-out motion-reduce:transition-none',
              // outline-none + an explicit focus-visible ring: the browser's
              // default outline drew a hard black box around the active tab,
              // which read as a rendering bug rather than focus. Removing it
              // without replacing it would break keyboard navigation, so the
              // ring is the replacement, not the removal.
              'outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              isActive
                ? 'border-brand-600 font-semibold text-white'
                : 'border-transparent font-medium text-ink-500 hover:text-ink-100',
            )}
          >
            {tab.label}
            {tab.count != null && (
              <span className={cn('text-xs tabular-nums', isActive ? 'text-brand-400' : 'text-ink-500')}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * formatDuration — how long a run took, or has been running.
 *
 * Returns null rather than "0s" when there is nothing to measure: a run that
 * never started has no duration, and printing a zero would suggest it finished
 * instantly.
 */
function formatDuration(run: CampaignRun): string | null {
  const start = run.startedAt ? new Date(run.startedAt).getTime() : null;
  if (!start) return null;

  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  const seconds = Math.max(Math.round((end - start) / 1000), 0);

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Short, readable run handle. The full id stays available to copy. */
const shortRunId = (id: string) => id.slice(-8).toUpperCase();

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
    <div className="overflow-hidden rounded-lg border border-ink-800 bg-black/40">
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
    <div className="overflow-hidden rounded-lg border border-ink-800 bg-black/40">
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

/**
 * Section — a labelled band, addressable by id.
 *
 * The id is what makes the side nav and the anchor link work: a developer
 * should be able to send a colleague straight to "Idempotency" rather than
 * "scroll down about two thirds".
 */
function Section({
  id, label, title, description, children,
}: { id?: string; label: string; title?: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="group/section scroll-mt-4 border-t border-ink-200 pt-4">
      <div className="flex items-center gap-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">{label}</p>
        {id && (
          <a
            href={`#${id}`}
            aria-label={`Link to ${label}`}
            className="text-ink-300 opacity-0 transition-opacity duration-150 hover:text-brand-600 group-hover/section:opacity-100 motion-reduce:transition-none"
          >
            <LinkIcon size={12} />
          </a>
        )}
      </div>
      {title && <h3 className="mt-1 text-sm font-semibold text-ink-900">{title}</h3>}
      {description && <p className="mt-0.5 max-w-2xl text-sm text-ink-500">{description}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/** The reference's sections, in page order. Drives both the nav and the ids. */
const DOC_SECTIONS = [
  { id: 'endpoint', label: 'Endpoint' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'request-body', label: 'Request body' },
  { id: 'examples', label: 'Code examples' },
  { id: 'response', label: 'Response' },
  { id: 'idempotency', label: 'Idempotency' },
  { id: 'rate-limits', label: 'Rate limits' },
  { id: 'errors', label: 'Errors' },
];

/**
 * DocNav — sticky section list.
 *
 * Scroll position is tracked with IntersectionObserver rooted on the actual
 * scrolling element, which is a panel div here, not the window. Rooting on the
 * viewport (the default) would simply never fire, because the page itself
 * never scrolls.
 */
function DocNav({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const [active, setActive] = useState(DOC_SECTIONS[0].id);

  useEffect(() => {
    const root = (() => {
      let node: HTMLElement | null = containerRef.current;
      while (node) {
        const overflow = getComputedStyle(node).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return node;
        node = node.parentElement;
      }
      return null;
    })();

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      // Top-weighted margin: a section counts as "current" once its heading
      // reaches the upper part of the viewport, which is where a reader's eye
      // actually is -- not when it merely appears at the bottom.
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );

    for (const section of DOC_SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [containerRef]);

  return (
    <nav className="sticky top-0 hidden w-44 shrink-0 self-start py-1 lg:block">
      <ul className="space-y-0.5 border-l border-ink-200">
        {DOC_SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={cn(
                '-ml-px block border-l-2 py-1 pl-3 text-sm transition-colors duration-150 motion-reduce:transition-none',
                active === section.id
                  ? 'border-brand-600 font-medium text-ink-900'
                  : 'border-transparent text-ink-500 hover:text-ink-800',
              )}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
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
              <Th>Name</Th><Th>Key</Th><Th>Created</Th><Th>Last used</Th><Th>Status</Th><Th />
            </Tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <Tr key={k.id} className={cn(!k.isActive && 'opacity-60')}>
                <Td className="font-medium text-white">{k.name}</Td>

                {/* Prefix only, always. The rest of the key exists nowhere --
                    only a hash is stored -- so there is nothing to reveal even
                    if the UI offered to. */}
                <Td>
                  <code className="font-mono text-xs text-ink-600">{k.prefix}</code>
                  <span className="text-ink-600">••••••••</span>
                </Td>

                <Td className="whitespace-nowrap text-ink-500">{timeAgo(k.createdAt)}</Td>

                <Td className="whitespace-nowrap text-ink-500">
                  {k.lastUsedAt ? timeAgo(k.lastUsedAt) : <span className="text-ink-500">Never used</span>}
                </Td>

                <Td>
                  <Badge tone={k.isActive ? 'green' : 'gray'}>{k.isActive ? 'Active' : 'Revoked'}</Badge>
                </Td>

                <Td className="text-right">
                  {k.isActive ? (
                    <button
                      onClick={() => setConfirmRevoke(k)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-ink-500 transition-colors duration-150 hover:bg-red-500/15 hover:text-red-400 motion-reduce:transition-none"
                    >
                      Revoke
                    </button>
                  ) : (
                    <span className="px-2 text-xs text-ink-500">{k.revokedAt ? timeAgo(k.revokedAt) : ''}</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal surfaceClassName={API_DIALOG} open={showCreate} onClose={() => setShowCreate(false)} title="New API key">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production backend"
            autoFocus
          />
        </Field>
        <p className="mt-2 text-xs text-ink-400">
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
      <Modal surfaceClassName={API_DIALOG} open={!!justCreated} onClose={() => { /* intentionally inert */ }} title="Copy your API key now">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-sm text-amber-200">
              This is the only time this key will be shown. We store a hash of it, not the key itself, so it
              cannot be recovered. If you lose it, revoke it and create a new one.
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-emerald-300">
            {justCreated?.key}
          </code>
          <CopyButton value={justCreated?.key ?? ''} />
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={() => setJustCreated(null)}>I've saved it</Button>
        </div>
      </Modal>

      <Modal surfaceClassName={API_DIALOG} open={!!confirmRevoke} onClose={() => setConfirmRevoke(null)} title="Revoke this API key?">
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

  // Every example below -- endpoint, cURL, JavaScript, Node.js, Python --
  // interpolates this one value, so they cannot disagree with each other or
  // with the environment the page is being read on.
  const apiBase = useApiBase();
  const endpoint = `${apiBase}/api/v1/campaigns/${campaign.id}/trigger`;

  // Handed to DocNav so it can find the real scrolling ancestor at runtime.
  const docsRef = useRef<HTMLDivElement>(null);

  // Built from this campaign's REAL template placeholders, so what gets copied
  // already matches this campaign instead of a generic sample the reader has
  // to translate.
  const sampleVariables = placeholders.reduce<Record<string, string>>((acc, ph, i) => {
    acc[/^\d+$/.test(ph) ? String(i + 1) : ph] = SAMPLE_VALUES[i % SAMPLE_VALUES.length];
    return acc;
  }, {});

  const requestBody = {
    recipients: [
      {
        phone: '919876543210',
        name: 'Ram Kshatriya',
        ...(placeholders.length ? { variables: sampleVariables } : {}),
      },
    ],
  };

  const bodyJson = JSON.stringify(requestBody, null, 2);
  const inlineBody = JSON.stringify(requestBody);

  const curl = `curl -X POST '${endpoint}' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-4821' \
  -d '${inlineBody}'`;

  const browserJs = `const res = await fetch('${endpoint}', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + API_KEY,
    'Content-Type': 'application/json',
    'Idempotency-Key': orderId,
  },
  body: JSON.stringify(${inlineBody}),
});

const result = await res.json();

if (res.status === 202) {
  // Accepted and queued -- NOT yet delivered.
  console.log(result.runId, result.queuedCount);
} else {
  console.error(result.message);
}`;

  const nodeJs = `import fetch from 'node-fetch';

const res = await fetch('${endpoint}', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.INNOVATEX_API_KEY}\`,
    'Content-Type': 'application/json',
    // Same key on a retry of the same send, so a dropped
    // connection can't deliver the message twice.
    'Idempotency-Key': order.id,
  },
  body: JSON.stringify({
    recipients: order.customers.map((c) => ({
      phone: c.whatsapp,
      name: c.name,
    })),
  }),
});

const { runId, queuedCount, rejected } = await res.json();
if (rejected.length) console.warn('Not sent:', rejected);`;

  const python = `import os, requests

res = requests.post(
    "${endpoint}",
    headers={
        "Authorization": f"Bearer {os.environ['INNOVATEX_API_KEY']}",
        "Content-Type": "application/json",
        "Idempotency-Key": order_id,
    },
    json=${inlineBody},
    timeout=30,
)

res.raise_for_status()
print(res.json()["runId"])`;

  const responseSample = JSON.stringify(
    {
      success: true,
      runId: '66f0c2a1e4b0a1d2c3e4f5a6',
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: 'queued',
      requestedCount: 2,
      queuedCount: 1,
      rejectedCount: 1,
      rejected: [
        { phone: '9876543210', reason: 'Phone number is missing its country code', code: 'INVALID_PHONE' },
      ],
    },
    null,
    2
  );

  return (
    // Two columns on wide screens: a narrow index that stays put, and content
    // capped at a readable measure. Full-width documentation lines run to 160
    // characters on a desktop, which is roughly twice what anyone reads
    // comfortably.
    <div ref={docsRef} className="flex gap-8">
      <DocNav containerRef={docsRef} />

      <div className="min-w-0 max-w-3xl flex-1 space-y-4">
          <Section id="endpoint" label="Endpoint">
          {/* The method is a quiet label, not a filled block. A solid brand-
              coloured POST chip made the endpoint the loudest thing on a page
              of documentation, competing with the content it introduces --
              reference docs read better when the URL is just legible. */}
          <div className="flex items-center gap-2 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
            <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink-200">
              POST
            </span>
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-ink-100">
              {endpoint}
            </code>
            <CopyButton value={endpoint} label="" subtle />
          </div>

          {/* Immediately under the endpoint on purpose: async behaviour is the
              single thing a developer most often gets wrong about this API, and
              it should be answered before they read anything else. */}
          <div className="mt-2 flex gap-2 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2">
            <span className="shrink-0 rounded bg-brand-600 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
              202
            </span>
            <p className="text-sm text-ink-200">
              <strong>Accepted</strong> means the recipients were validated and queued — not that WhatsApp has
              delivered anything. Sending happens asynchronously; follow it with the returned{' '}
              <code className="font-mono text-xs">runId</code> on <strong>Runs &amp; Logs</strong>.
            </p>
          </div>
        </Section>

        <Section
          id="authentication"
          label="Authentication"
          description="Every request carries your API key. Either header works — use whichever your tool makes easier."
        >
          <CodeTabs
            items={[
              {
                id: 'http',
                label: 'HTTP',
                code: `Authorization: Bearer YOUR_API_KEY

  # or, if your tool makes a custom header easier:
  X-API-Key: YOUR_API_KEY`,
              },
              { id: 'curl', label: 'cURL', code: `-H 'Authorization: Bearer YOUR_API_KEY'` },
              {
                id: 'js',
                label: 'JavaScript',
                code: `headers: {
    'Authorization': 'Bearer ' + API_KEY,
  }`,
              },
              {
                id: 'node',
                label: 'Node.js',
                code: `headers: {
    Authorization: \`Bearer \${process.env.INNOVATEX_API_KEY}\`,
  }`,
              },
              {
                id: 'py',
                label: 'Python',
                code: `headers={
      "Authorization": f"Bearer {os.environ['INNOVATEX_API_KEY']}",
  }`,
              },
            ]}
          />
          <p className="mt-2 text-sm text-ink-400">
            Keys are created on the <strong>API keys</strong> tab and shown once. Keep them on your server —
            anything shipped to a browser or mobile app can be read by whoever is using it.
          </p>
        </Section>

        <Section
          id="request-body"
          label="Request body"
          description="One to 1000 recipients per request. Phone numbers must include the country code and no +."
        >
          <Code label="json" code={bodyJson} maxHeight="max-h-60" />

          <div className="mt-3 overflow-hidden rounded-lg border border-ink-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-ink-900">
                  <th className="border-b border-ink-800 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">Field</th>
                  <th className="border-b border-ink-800 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">Required</th>
                  <th className="border-b border-ink-800 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border-b border-ink-800 px-3 py-2 font-mono text-xs text-ink-200">recipients[].phone</td>
                  <td className="border-b border-ink-800 px-3 py-2 text-ink-600">Yes</td>
                  <td className="border-b border-ink-800 px-3 py-2 text-ink-400">
                    International format, digits only — <code className="font-mono text-xs">919876543210</code>. A
                    10-digit number is rejected rather than guessed at.
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-ink-800 px-3 py-2 font-mono text-xs text-ink-200">recipients[].name</td>
                  <td className="border-b border-ink-800 px-3 py-2 text-ink-600">No</td>
                  <td className="border-b border-ink-800 px-3 py-2 text-ink-400">
                    Used only when creating a new contact. An existing contact's name is never overwritten.
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-mono text-xs text-ink-200">recipients[].variables</td>
                  <td className="px-3 py-2 text-ink-600">{placeholders.length ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2 text-ink-400">
                    {placeholders.length
                      ? 'Every template variable must be supplied. A recipient missing one is rejected; the rest of the batch still sends.'
                      : 'This template has no variables, so it can be omitted.'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {placeholders.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-lg border border-ink-800">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-ink-900">
                    <th className="border-b border-ink-800 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">Variable</th>
                    <th className="border-b border-ink-800 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">Send as</th>
                    <th className="border-b border-ink-800 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">Example</th>
                  </tr>
                </thead>
                <tbody>
                  {placeholders.map((ph, i) => (
                    <tr key={`${ph}-${i}`}>
                      <td className="border-b border-ink-800 px-3 py-2 font-mono text-xs text-ink-200">{`{{${ph}}}`}</td>
                      <td className="border-b border-ink-800 px-3 py-2 font-mono text-xs text-ink-200">
                        {/^\d+$/.test(ph) ? `"${i + 1}"` : `"${ph}"`}
                      </td>
                      <td className="border-b border-ink-800 px-3 py-2 font-mono text-xs text-ink-400">
                        {SAMPLE_VALUES[i % SAMPLE_VALUES.length]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section id="examples" label="Code examples" description="The same request in whichever form suits your stack.">
          <CodeTabs
            items={[
              { id: 'curl', label: 'cURL', code: curl },
              { id: 'js', label: 'JavaScript', code: browserJs },
              { id: 'node', label: 'Node.js', code: nodeJs },
              { id: 'py', label: 'Python', code: python },
            ]}
          />
        </Section>

        <Section id="response" label="Response" description="202 Accepted. The 202 callout under the endpoint explains what that does and doesn't mean.">
          <Code label="json" code={responseSample} maxHeight="max-h-72" />
          <p className="mt-2 text-sm text-ink-400">
            <code className="font-mono text-xs">requestedCount</code> is what you sent,{' '}
            <code className="font-mono text-xs">queuedCount</code> what was accepted, and{' '}
            <code className="font-mono text-xs">rejected</code> says which ones were dropped and why. One bad
            number never rejects the batch.
          </p>
        </Section>

        <Section
          id="idempotency"
          label="Idempotency"
          description="Optional, and strongly recommended for anything triggered by your own retries."
        >
          <Code
            label="http"
            maxHeight="max-h-24"
            code={`Idempotency-Key: order-4821`}
          />
          <p className="mt-2 text-sm text-ink-400">
            Reuse the same key when retrying the <em>same</em> send — a connection that drops after we accepted
            the request is the case this exists for, and without it the retry sends everything twice. Keys are
            remembered for 24 hours. The same key with a different body returns{' '}
            <code className="font-mono text-xs">422</code>, and a retry arriving while the first is still
            processing returns <code className="font-mono text-xs">409</code>.
          </p>
        </Section>

        <Section id="rate-limits" label="Rate limits">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-ink-800 px-3 py-2.5">
              <dt className="font-mono text-[11px] uppercase tracking-wide text-ink-400">Requests</dt>
              <dd className="mt-0.5 text-sm text-ink-100">120 per minute, per API key</dd>
            </div>
            <div className="rounded-lg border border-ink-800 px-3 py-2.5">
              <dt className="font-mono text-[11px] uppercase tracking-wide text-ink-400">Recipients</dt>
              <dd className="mt-0.5 text-sm text-ink-100">1000 per request</dd>
            </div>
            <div className="rounded-lg border border-ink-800 px-3 py-2.5">
              <dt className="font-mono text-[11px] uppercase tracking-wide text-ink-400">Send volume</dt>
              <dd className="mt-0.5 text-sm text-ink-100">Daily and monthly caps, set in WhatsApp Settings</dd>
            </div>
          </dl>
          <p className="mt-2 text-sm text-ink-400">
            Both return <code className="font-mono text-xs">429</code>, but for different reasons: the per-minute
            limit should be retried after a short back-off, while a send-volume refusal carries{' '}
            <code className="font-mono text-xs">SEND_QUOTA_EXCEEDED</code> and will keep refusing until the cap
            resets or is raised.
          </p>
        </Section>

        <Section id="errors" label="Errors" description="Every failure returns a status and a message you can branch on.">
          <div className="overflow-hidden rounded-lg border border-ink-800">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {ERROR_ROWS.map(([code, when, action], i) => (
                  <tr key={`${code}-${i}`}>
                    <td className="w-16 border-b border-ink-800 px-3 py-2 font-mono text-xs font-semibold text-white">{code}</td>
                    <td className="border-b border-ink-800 px-3 py-2 text-ink-200">{when}</td>
                    <td className="border-b border-ink-800 px-3 py-2 text-ink-400">{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
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
              <Th>Run ID</Th><Th>Status</Th><Th>Recipients</Th><Th>Created</Th><Th>Duration</Th><Th>Key</Th><Th />
            </Tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              // queuedCount 0 means nothing was ever queued, so there is no
              // progress to report -- showing 100% there read as "finished
              // successfully" for a run that did nothing at all.
              const pct = run.queuedCount > 0 ? Math.round(runProgress(run) * 100) : null;
              const duration = formatDuration(run);
              const isOpen = expanded === run.id;

              return (
                <Fragment key={run.id}>
                  <Tr>
                    <Td>
                      <span className="font-mono text-xs font-semibold text-ink-100">{shortRunId(run.id)}</span>
                    </Td>

                    <Td>
                      <div className="flex items-center gap-2">
                        <Badge tone={RUN_STATUS_TONE[run.status] ?? 'gray'}>{run.status}</Badge>
                        {pct !== null && (run.status === 'RUNNING' || run.status === 'QUEUED') && (
                          <span className="text-xs tabular-nums text-ink-500">{pct}%</span>
                        )}
                      </div>
                    </Td>

                    {/* One column instead of four. Queued/sent/failed/rejected
                        as separate columns made every row mostly zeros and
                        pushed the useful ones off screen; the breakdown that
                        matters is in the expanded view. */}
                    <Td>
                      <span className="tabular-nums text-ink-100">{run.queuedCount}</span>
                      {run.sentCount > 0 && (
                        <span className="ml-2 text-xs text-emerald-400">{run.sentCount} sent</span>
                      )}
                      {run.failedCount > 0 && (
                        <span className="ml-2 text-xs text-red-400">{run.failedCount} failed</span>
                      )}
                      {run.rejectedCount > 0 && (
                        <span className="ml-2 text-xs text-amber-400">{run.rejectedCount} rejected</span>
                      )}
                    </Td>

                    {/* title sits on the span, not the Td: the shared Td
                        takes className and colSpan only, and widening it for
                        one tooltip would change a component every table in
                        the app renders through. */}
                    <Td className="whitespace-nowrap text-ink-500">
                      <span title={new Date(run.createdAt).toLocaleString()}>{timeAgo(run.createdAt)}</span>
                    </Td>

                    {/* Em dash, not 0s: a run that never started has no
                        duration, and a zero would read as "finished
                        instantly". */}
                    <Td className="tabular-nums text-ink-500">{duration ?? '—'}</Td>

                    <Td><code className="font-mono text-xs text-ink-500">{run.apiKeyPrefix || '—'}</code></Td>

                    <Td>
                      {/* Every row expands, not only failed ones: the most
                          confusing run is the one that looks fine and isn't --
                          queued, no worker, nothing in any error column. The
                          lifecycle inside is what reveals it. */}
                      <button
                        onClick={() => setExpanded(isOpen ? null : run.id)}
                        className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-white/10 hover:text-ink-200"
                        title={isOpen ? 'Hide details' : 'Show details'}
                      >
                        <ChevronRight size={14} className={cn('transition-transform duration-150', isOpen && 'rotate-90')} />
                      </button>
                    </Td>
                  </Tr>

                  {isOpen && (
                    <Tr>
                      <Td colSpan={7}>
                        <div className="space-y-4 rounded-lg bg-white/[0.04] p-4">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink-500">
                            <span className="flex items-center gap-1">
                              run {run.id}
                              <CopyButton value={run.id} label="" subtle />
                            </span>
                            {run.idempotencyKey && <span>idempotency-key {run.idempotencyKey}</span>}
                            <span>key {run.apiKeyPrefix || '—'}</span>
                          </div>

                          <RunLifecycle run={run} />

                          {run.failureReason && (
                            <p className="text-sm text-red-300">{run.failureReason}</p>
                          )}

                          {run.rejectedRecipients.length > 0 && (
                            <div>
                              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                                Rejected before sending
                              </p>
                              <ul className="space-y-1">
                                {run.rejectedRecipients.map((r, i) => (
                                  <li key={`${r.phone}-${i}`} className="text-sm text-ink-200">
                                    <code className="font-mono text-xs">{r.phone || '(no phone)'}</code>
                                    <span className="text-ink-500"> — </span>
                                    {r.reason}
                                  </li>
                                ))}
                              </ul>
                            </div>
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

/**
 * RunLifecycle — where a run actually got to.
 *
 * Built ONLY from timestamps the run really carries (created_at, startedAt,
 * completedAt) plus its counters. Stages the data can't prove -- "delivered to
 * the handset", which lives in DeliveryLog and arrives by webhook -- are
 * deliberately absent rather than shown as a guess: a timeline that invents
 * steps is worse than a short honest one, because it gets trusted during an
 * incident.
 */
function RunLifecycle({ run }: { run: CampaignRun }) {
  const processed = run.sentCount + run.failedCount + run.skippedCount;

  // A run that has sat QUEUED without a worker ever touching it is the exact
  // failure that is invisible everywhere else: the API returned 202, the
  // record looks fine, and nothing is wrong except that no worker is
  // consuming. Two minutes is well past normal pickup time.
  const isStalled =
    run.status === 'QUEUED' &&
    !run.startedAt &&
    Date.now() - new Date(run.createdAt).getTime() > 2 * 60 * 1000;

  const stages = [
    {
      label: 'Request accepted',
      at: run.createdAt,
      done: true,
      detail: `${run.requestedCount} recipient${run.requestedCount === 1 ? '' : 's'} received`,
    },
    {
      label: 'Recipients validated',
      at: run.createdAt,
      done: true,
      detail: run.rejectedCount > 0
        ? `${run.queuedCount} accepted, ${run.rejectedCount} rejected`
        : `${run.queuedCount} accepted`,
    },
    {
      label: 'Queued for sending',
      at: run.createdAt,
      done: run.queuedCount > 0,
      detail: run.queuedCount > 0 ? 'Handed to the send queue' : 'Nothing queued',
    },
    {
      label: 'Worker processing',
      at: run.startedAt,
      done: !!run.startedAt,
      detail: run.startedAt ? `${processed} of ${run.queuedCount} processed` : 'Not picked up yet',
    },
    {
      label: 'Sent to WhatsApp',
      at: run.startedAt,
      done: run.sentCount + run.failedCount > 0,
      detail:
        run.sentCount + run.failedCount > 0
          ? `${run.sentCount} accepted by WhatsApp, ${run.failedCount} rejected`
          : 'No send attempted yet',
    },
    {
      label: run.status === 'FAILED' ? 'Finished with failures' : 'Finished',
      at: run.completedAt,
      done: !!run.completedAt,
      detail: run.completedAt ? `${run.sentCount} sent, ${run.failedCount} failed` : 'Still running',
    },
  ];

  return (
    <div className="space-y-3">
      {isStalled && (
        <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="text-sm text-amber-200">
            <p className="font-medium">Queued, but no worker has picked it up</p>
            <p className="mt-0.5">
              The messages were accepted and queued, but nothing has processed them. This usually means the
              worker process isn't running, or is connected to a different Redis than the API server.
            </p>
          </div>
        </div>
      )}

      <ol className="space-y-0">
        {stages.map((stage, i) => {
          const isLast = i === stages.length - 1;
          return (
            <li key={stage.label} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                    stage.done ? 'border-emerald-500 bg-emerald-500' : 'border-white/20 bg-white/[0.03]'
                  )}
                >
                  {stage.done && <Check size={9} className="text-white" strokeWidth={4} />}
                </span>
                {!isLast && (
                  <span className={cn('w-0.5 flex-1', stage.done ? 'bg-emerald-200' : 'bg-ink-200')} />
                )}
              </div>

              <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-4')}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cn('text-sm font-medium', stage.done ? 'text-white' : 'text-ink-500')}>
                    {stage.label}
                  </span>
                  {stage.at && (
                    <span className="font-mono text-[11px] text-ink-500">
                      {new Date(stage.at).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-500">{stage.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Delivery deliberately is NOT a stage above.
          "Accepted by WhatsApp" is the last thing a run knows: delivery and
          read receipts arrive later by webhook and live on DeliveryLog, per
          message, not on the run. Drawing a Delivered tick here would mean
          inventing a status the run cannot confirm -- and a timeline that
          invents steps is exactly what stops being trusted during an
          incident. */}
      <p className="mt-3 border-t border-white/10 pt-3 text-xs text-ink-500">
        Delivery and read receipts arrive separately from WhatsApp, per message — see <strong>Delivery Logs</strong>.
      </p>
    </div>
  );
}

/** A single headline number. */
function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-xl font-semibold leading-tight tabular-nums',
          tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-white'
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * OverviewPanel — what the campaign has actually done, and what to do next.
 *
 * Counts come from the runs this page already loads rather than a new
 * endpoint: "requests" is a number only the run history knows, and deriving it
 * here keeps it consistent with the Logs tab instead of drifting from it.
 */
function OverviewPanel({
  campaign, templateBody, onGoToReference,
}: { campaign: WhatsAppCampaign; templateBody: string; onGoToReference: () => void }) {
  const [runs, setRuns] = useState<CampaignRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await apiCampaignsApi.listRuns({ campaignId: campaign.id, limit: 100 });
        if (!cancelled) setRuns(result.runs);
      } catch {
        // The stats are a convenience; the tab still works without them and
        // the Logs tab will surface the same failure with a toast.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaign.id]);

  const totals = useMemo(() => runs.reduce(
    (acc, r) => ({
      requests: acc.requests + 1,
      messages: acc.messages + r.queuedCount,
      sent: acc.sent + r.sentCount,
      failed: acc.failed + r.failedCount,
      rejected: acc.rejected + r.rejectedCount,
    }),
    { requests: 0, messages: 0, sent: 0, failed: 0, rejected: 0 }
  ), [runs]);

  const placeholders = useMemo(() => placeholdersOf(templateBody), [templateBody]);
  const lastRun = runs[0];

  return (
    <div className="space-y-4">
      <section>
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-400">
          Activity
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="API requests" value={loading ? '—' : totals.requests} />
          <Stat label="Messages queued" value={loading ? '—' : totals.messages} />
          <Stat label="Sent" value={loading ? '—' : totals.sent} tone={totals.sent > 0 ? 'good' : undefined} />
          <Stat
            label="Failed"
            value={loading ? '—' : totals.failed + totals.rejected}
            tone={totals.failed + totals.rejected > 0 ? 'bad' : undefined}
          />
        </div>
      </section>

      <Section label="Configuration">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Template</dt>
            <dd className="mt-1 font-mono text-sm text-ink-100">{campaign.templateName || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Variables required</dt>
            <dd className="mt-1 text-sm text-ink-100">
              {placeholders.length === 0
                ? 'None — send just a phone number'
                : placeholders.map((ph) => `{{${ph}}}`).join(', ')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Audience</dt>
            <dd className="mt-1 text-sm text-ink-100">
              Supplied per request — this campaign has no saved audience
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Campaign ID</dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="font-mono text-xs text-ink-200">{campaign.id}</code>
              <CopyButton value={campaign.id} label="" subtle />
            </dd>
          </div>
        </dl>
      </Section>

      {lastRun && (
        <Section label="Most recent run">
          {/* Boxed, with its own header row. Unboxed, the timeline ran
              straight off the bottom of the page and looked like content that
              had been cut off rather than a finished block. */}
          <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/[0.04] px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-ink-100">{shortRunId(lastRun.id)}</span>
                <Badge tone={RUN_STATUS_TONE[lastRun.status] ?? 'gray'}>{lastRun.status}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                <span>{timeAgo(lastRun.createdAt)}</span>
                {formatDuration(lastRun) && (
                  <>
                    <span className="text-ink-600">·</span>
                    <span>took {formatDuration(lastRun)}</span>
                  </>
                )}
                <span className="text-ink-600">·</span>
                <code className="font-mono">{lastRun.apiKeyPrefix || '—'}</code>
              </div>
            </div>

            <div className="px-4 py-3">
              <RunLifecycle run={lastRun} />
            </div>
          </div>
        </Section>
      )}

      {!loading && runs.length === 0 && (
        <Section label="Next step">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-ink-200">
              This campaign hasn't been triggered yet. The API Reference tab has the endpoint, your headers and
              a ready-to-paste cURL command.
            </p>
            <Button className="mt-3" onClick={onGoToReference}>
              <Terminal size={15} /> Open API Reference
            </Button>
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Main tab ────────────────────────────────────────────────────────────────

export function ApiCampaignsTab({ onBack }: { onBack?: () => void }) {
  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WhatsAppCampaign | null>(null);
  const [view, setView] = useState<'list' | 'keys'>('list');
  const [detailTab, setDetailTab] = useState('overview');

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

  // Last activity comes from the newest run, not from the campaign record --
  // the campaign has no "last triggered" field, and inventing one would mean a
  // second write on every send for something the runs already know.
  const [lastActivityAt, setLastActivityAt] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) { setLastActivityAt(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const result = await apiCampaignsApi.listRuns({ campaignId: selected.id, limit: 1 });
        if (!cancelled) setLastActivityAt(result.runs[0]?.createdAt ?? null);
      } catch {
        // Header detail only -- its absence must not break the page.
      }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  const selectedTemplateBody = useMemo(() => {
    if (!selected) return '';
    const tpl = templates.find((t) => t.id === String(selected.templateId));
    return tpl?.body ?? '';
  }, [selected, templates]);

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selected) {
    const isLive = selected.status === 'ACTIVE';

    return (
      <div className={cn(API_SURFACE, 'space-y-4')}>
        {/* Compact header. Everything a glance should answer -- is it live,
            which template, how much has it sent, when was it last used -- on
            one line under the title, instead of spread down the page in its
            own card. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="-ml-1 mb-0.5 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-ink-500 transition-colors hover:bg-white/10 hover:text-ink-100"
            >
              <ChevronLeft size={13} /> API Campaigns
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-white">{selected.name}</h2>
              <Badge tone={selected.status === 'ACTIVE' ? 'green' : selected.status === 'PAUSED' ? 'amber' : 'gray'}>
                {STATUS_LABEL[selected.status] ?? selected.status}
              </Badge>
            </div>

            {/* Separated by dots rather than boxed into stat cards: these are
                four small facts, and four cards would take a third of the
                viewport to say what one line says. */}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
              <span className="font-mono text-xs text-ink-200">{selected.templateName || 'no template'}</span>
              <span className="text-ink-600">·</span>
              <span>{selected.metrics?.sentCount ?? 0} sent</span>
              <span className="text-ink-600">·</span>
              <span className={cn((selected.metrics?.failedCount ?? 0) > 0 && 'text-red-400')}>
                {selected.metrics?.failedCount ?? 0} failed
              </span>
              {lastActivityAt && (
                <>
                  <span className="text-ink-600">·</span>
                  <span>last triggered {timeAgo(lastActivityAt)}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {selected.status === 'ACTIVE' ? (
              <Button variant="secondary" onClick={() => void setLive(selected, false)}>
                <PauseIcon size={14} /> Pause
              </Button>
            ) : selected.status === 'PAUSED' ? (
              <Button onClick={() => void setLive(selected, true)}><PlayIcon size={14} /> Resume</Button>
            ) : (
              <Button onClick={() => void setLive(selected, true)}>Activate</Button>
            )}
            <Button variant="secondary" onClick={() => setConfirmDelete(selected)} title="Delete campaign">
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        {!isLive && (
          <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-sm text-amber-200">
              {selected.status === 'PAUSED'
                ? <>This campaign is paused, so the endpoint below returns <strong>409</strong>. Resume it to start accepting requests again. Runs already queued are still sending.</>
                : <>Activate this API campaign to start accepting API requests. Until then the endpoint below returns <strong>409</strong> — useful for testing your error handling first.</>}
            </p>
          </div>
        )}

        <SubTabs
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'reference', label: 'API Reference' },
            { id: 'logs', label: 'Runs & Logs' },
          ]}
          active={detailTab}
          onChange={setDetailTab}
        />

        {detailTab === 'overview' && (
          <OverviewPanel
            campaign={selected}
            templateBody={selectedTemplateBody}
            onGoToReference={() => setDetailTab('reference')}
          />
        )}
        {detailTab === 'reference' && <IntegrationDocs campaign={selected} templateBody={selectedTemplateBody} />}
        {detailTab === 'logs' && <RunsPanel campaignId={selected.id} />}

        <Modal surfaceClassName={API_DIALOG} open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete this API campaign?">
          <p className="text-sm text-ink-300">
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
    <div className={cn(API_SURFACE, 'space-y-4')}>
      {/* Header is plain markup, not a Card: three buttons crammed into a
          CardHeader's action slot were wrapping onto two lines, and the middle
          one ("API keys") was a toggle that swapped the page under you with no
          indication of where you were. Navigation belongs in tabs; the header
          keeps only the title and the one primary action. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="-ml-1 mb-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-ink-500 transition-colors hover:bg-white/10 hover:text-ink-100"
            >
              <ChevronLeft size={13} /> All campaign types
            </button>
          )}
          <h2 className="text-xl font-bold text-white">API Campaigns</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-500">
            Campaigns your own systems trigger over HTTP. Each call supplies its own recipients and variables.
          </p>
        </div>

        <Button className="shrink-0 whitespace-nowrap" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Create API campaign
        </Button>
      </div>

      <SubTabs
        tabs={[
          { id: 'list', label: 'Campaigns', count: campaigns.length },
          { id: 'keys', label: 'API keys' },
        ]}
        active={view}
        onChange={(id) => setView(id as 'list' | 'keys')}
      />

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
                  <Td className={cn((c.metrics?.failedCount ?? 0) > 0 && 'text-red-400')}>{c.metrics?.failedCount ?? 0}</Td>
                  <Td>
                    <Button variant="secondary" onClick={() => { setSelected(c); setDetailTab('overview'); }}>
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

      <Modal surfaceClassName={API_DIALOG} open={showCreate} onClose={() => setShowCreate(false)} title="Create API campaign">
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
          <p className="mt-2 text-xs text-amber-300">
            No Meta-approved templates yet. Submit one for approval first — only approved templates can be sent.
          </p>
        )}

        <p className="mt-3 text-xs text-ink-400">
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