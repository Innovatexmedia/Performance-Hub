import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Send, Sparkles, Copy, CheckCircle2, XCircle, MessageSquare, Server, RefreshCw,
  ChevronLeft, ChevronRight, Trash2, Inbox as InboxIcon, Users, Layers, FileText,
  ShieldCheck, Megaphone, Repeat, Radio, Zap, ScrollText, BarChart3, Settings as SettingsIcon,
  Phone, Hash, Building2, KeyRound, Link2, Fingerprint, Search, ChevronDown, X, Eye,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { atLeast, hasRoleOrPermission } from '@/lib/permissions';
import { aiReplyAssistantApi } from '@/lib/aiReplyAssistantApi';
import type { ReplyGoal, RewriteStyle } from '@/lib/aiReplyAssistantApi';
import { useTenantProfile } from '@/hooks/useTenantProfile';
import type { UseTenantProfileResult } from '@/hooks/useTenantProfile';
import { BUSINESS_TYPE_OPTIONS } from '@/lib/tenantProfileApi';
import type { BusinessType } from '@/lib/tenantProfileApi';
import { isTemplateStatusSeen, markTemplateStatusSeen } from '@/lib/templateSeenTracker';
import {
  Card, CardHeader, Table, Th, Td, Tr, Badge, StatusBadge, Button, statusTone,
  Avatar, EmptyState, Toggle, Field, Input, Select, Modal, cn,
  IconInput, SecretField, StatusStrip,
} from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { BarChartCard, LineChartCard, DonutChartCard } from '@/components/charts';
import { Inbox } from './Inbox';
import { TemplateBuilder, TemplatePreview } from './TemplateBuilder';
import { syncFromProvider } from '@/services/whatsappService';
import { formatDateTime, timeAgo, percent } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { useLeads } from '@/hooks/useLeads';
import type { LeadListItem } from '@/types/lead';
import { useGroups } from '@/hooks/useGroups';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useAutomationRules } from '@/hooks/useAutomationRules';
import { useNurtureSequences, useNurtureEnrollments } from '@/hooks/useNurture';
import { useWhatsAppAnalytics } from '@/hooks/useWhatsAppAnalytics';
import { useTenantCurrency } from '@/hooks/useTenantCurrency';
import { automationRulesApi } from '@/lib/automationRulesApi';
import type { RunRuleResult } from '@/lib/automationRulesApi';
import type {
  AutomationRule, AutomationRuleInput, RuleCondition, RuleAction,
  RuleStatus, TriggerType, ActionType, ConditionOperator, ConditionLogic, DelayUnit,
} from '@/types/automationRule';
import { TRIGGER_TYPE_VALUES, ACTION_TYPE_VALUES, CONDITION_OPERATOR_VALUES } from '@/types/automationRule';
import type { Group } from '@/types/group';
import { useWhatsAppSettings } from '@/hooks/useWhatsAppSettings';
import { whatsappSettingsApi } from '@/lib/whatsappSettingsApi';
import { useWhatsAppTemplates } from '@/hooks/useWhatsAppTemplates';
import type { WhatsAppTemplate as WhatsAppTemplateReal } from '@/types/whatsappTemplate';
import { USABLE_APPROVAL_STATUS } from '@/types/whatsappTemplate';
import { useWhatsAppCampaigns } from '@/hooks/useWhatsAppCampaigns';
import type { CreateCampaignInput, WhatsAppCampaign as WhatsAppCampaignReal, AudiencePreviewContact } from '@/types/whatsappCampaign';
import { PROVIDER_LABELS, NATIVE_PROVIDER, THIRD_PARTY_PROVIDER_VALUES, IMPLEMENTED_THIRD_PARTY_PROVIDERS } from '@/types/whatsappSettings';
import type { WhatsAppProvider as WhatsAppProviderReal, PanelMode, WhatsAppSettingsSync } from '@/types/whatsappSettings';
import { ApiError } from '@/lib/apiClient';
import type { WhatsAppTemplate, WhatsAppProvider } from '@/types';
import { useTemplateApproval } from '@/hooks/useTemplateApproval';
import { useDeliveryLogs, useDeliveryLogsStats } from '@/hooks/useDeliveryLogs';
import type { DeliveryLog, DeliveryStatus, DeliveryProvider } from '@/types/whatsappDeliveryLog';
import { DELIVERY_PROVIDER_VALUES } from '@/types/whatsappDeliveryLog';
import { useWhatsAppRealtime } from '@/hooks/useWhatsAppRealtime';
import { usePermissions } from '@/hooks/usePermissions';
import { useConsent, useConsentStats } from '@/hooks/useConsent';
import type { Consent, ConsentStatus, ConsentSource, CreateConsentInput } from '@/types/whatsappConsent';
import { CONSENT_STATUS_VALUES, CONSENT_SOURCE_VALUES } from '@/types/whatsappConsent';

export const TABS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'contacts', label: 'Contacts / Leads' },
  { id: 'groups', label: 'Groups' },
  { id: 'templates', label: 'Templates' },
  { id: 'approval', label: 'Template Approval' },
  { id: 'campaigns', label: 'Campaigns' },
  // 'nurture' tab hidden for v1 launch -- feature stays in the codebase
  // (Automation Rules' Start/Stop Nurture actions and Booking/Lead
  // auto-enroll all still work), just not exposed in this plan's UI yet.
  { id: 'ai', label: 'AI Reply Assistant' },
  // 'broadcasts' tab hidden -- merged into Campaigns (Type: Broadcast),
  // matching AiSensy's own model (one Campaigns feature, "Broadcast" is
  // a Type within it, not a separate feature/page). The standalone
  // Broadcasts backend module is untouched for existing data; new
  // Broadcast-type sends now go through Campaigns end-to-end.
  { id: 'rules', label: 'Automation Rules' },
  { id: 'consent', label: 'Opt-Out / Consent' },
  { id: 'logs', label: 'Delivery Logs' },
  { id: 'analytics', label: 'WhatsApp Analytics' },
  { id: 'settings', label: 'WhatsApp Settings' },
];

// Mirrors the fixed source list Leads.tsx offers, so campaign audience
// filters always match what a lead can actually be created with.
const LEAD_SOURCES = ['Meta Ads', 'Google Ads', 'LinkedIn', 'Webinar', 'Referral', 'Organic', 'Cold Outreach', 'YouTube', 'Direct'];

const PROVIDERS: WhatsAppProvider[] = ['Native Meta Cloud API', 'WATI', 'Interakt', 'AiSensy', 'Gallabox', 'Twilio WhatsApp', '360dialog', 'Custom Webhook Provider', 'Simulation Mode'];

// Consistent icon language for each tab's section header (image-2 style: a
// tinted circle icon to the left of the title). Sizes match CardHeader's 16px.
export const TAB_ICONS: Record<string, React.ReactNode> = {
  inbox: <InboxIcon size={16} />,
  contacts: <Users size={16} />,
  groups: <Layers size={16} />,
  templates: <FileText size={16} />,
  approval: <ShieldCheck size={16} />,
  campaigns: <Megaphone size={16} />,
  nurture: <Repeat size={16} />,
  ai: <Sparkles size={16} />,
  broadcasts: <Radio size={16} />,
  rules: <Zap size={16} />,
  consent: <ShieldCheck size={16} />,
  logs: <ScrollText size={16} />,
  analytics: <BarChart3 size={16} />,
  settings: <SettingsIcon size={16} />,
};

/**
 * Pure content renderer for the WhatsApp module -- the workspace shell
 * (header, vertical nav, exit flow) lives in ./workspace/WhatsAppWorkspace,
 * which owns the active tab and passes it down here. This component still
 * owns every tab's actual logic/data/handlers; only the outer chrome
 * (the old PageHeader + horizontal Tabs bar) moved out, in favor of the
 * workspace's vertical navigation using the same TABS/TAB_ICONS above.
 */
export function WhatsAppPanel({ tab, onApprovalBadgeChange }: { tab: string; onApprovalBadgeChange?: (count: number) => void }) {
  const currentUser = useAuthStore((s) => s.user);
  const canApproveTemplates = hasRoleOrPermission(currentUser?.role, currentUser?.permissions, 'tenant_admin', 'approve_templates');

  // Lightweight instance just for the badge/toast logic below -- each tab
  // component already fetches its own copy when open, this is a small
  // extra read so notifications work even while looking at a different tab.
  const { templates, refetch: refetchTemplatesForBadge } = useWhatsAppTemplates();

  // Red = something needs THIS user's action right now:
  //  - an approver sees how many submissions are waiting on them
  //  - a regular creator sees how many of their OWN templates got sent
  //    back (rejected, or changes requested) and need fixing/resubmitting
  const approvalBadgeCount = canApproveTemplates
    ? templates.filter((t) => t.approvalStatus === 'SUBMITTED_FOR_INTERNAL_REVIEW').length
    : templates.filter((t) => t.createdBy === currentUser?.id && (
        t.approvalStatus === 'REJECTED'
        || (t.approvalStatus === 'DRAFT' && t.transitionHistory?.some((h) => h.action === 'REQUEST_CHANGES'))
      ) && !isTemplateStatusSeen(currentUser?.id, t.id, t.approvalStatus)).length;

  // Real-time toast, independent of the badge -- fires the instant the
  // socket event lands, regardless of which tab is open. Uses the LAST
  // transitionHistory entry's `action` (not just the current status) to
  // know exactly what just happened, since e.g. REJECTED and "sent back
  // to DRAFT via request changes" need different messages but can share
  // similar resulting statuses.
  useWhatsAppRealtime({
    onTemplate: (payload) => {
      refetchTemplatesForBadge();
      const t = payload.template;
      const lastAction = t.transitionHistory?.[t.transitionHistory.length - 1]?.action;
      const isMine = t.createdBy === currentUser?.id;

      if (isMine && lastAction === 'REQUEST_CHANGES') {
        toast.error(`Changes requested on "${t.name}"`, 'Open Template Approval to see what\'s needed and resubmit.');
      } else if (isMine && lastAction === 'REJECT') {
        toast.error(`"${t.name}" was rejected`, 'Open Template Approval to see why.');
      } else if (isMine && (lastAction === 'APPROVE' || lastAction === 'PROVIDER_APPROVED' || t.approvalStatus === 'PROVIDER_APPROVED')) {
        toast.success(`"${t.name}" was approved!`, t.approvalStatus === 'PROVIDER_APPROVED' ? 'Approved by Meta — ready to activate.' : 'Approved internally.');
      } else if (canApproveTemplates && !isMine && lastAction === 'SUBMIT_FOR_REVIEW') {
        toast.info(`New template awaiting your approval`, `"${t.name}" was just submitted for internal review.`);
      }
    },
  });

  // Reports the badge count up to the workspace's vertical nav (which
  // renders the same red badge the old horizontal Tabs bar used to show
  // on "Template Approval") instead of computing it a second time there.
  useEffect(() => {
    onApprovalBadgeChange?.(approvalBadgeCount);
  }, [approvalBadgeCount, onApprovalBadgeChange]);

  // Inbox owns its own full-height three-pane layout and internal
  // scrolling (see Inbox.tsx), so it renders edge-to-edge with no extra
  // padding/scroll container. Every other tab keeps the padded, natively
  // page-scrolling layout it already had.
  if (tab === 'inbox') return <Inbox />;

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6">
      {tab === 'contacts' && <ContactsTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'approval' && <ApprovalTab />}
      {tab === 'campaigns' && <CampaignsTab broadcast={false} />}
      {tab === 'nurture' && <NurtureMessagesTab />}
      {tab === 'ai' && <AIAssistantTab />}
      {tab === 'broadcasts' && <CampaignsTab broadcast />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'consent' && <ConsentTab />}
      {tab === 'logs' && <LogsTab />}
      {tab === 'analytics' && <AnalyticsTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

// ---- ConfirmDialog: replaces window.confirm/prompt with real app UI -------
// requireTypedText: if set, the confirm button stays disabled until the
// user types this exact string -- used for destructive group deletion.
function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', destructive = false,
  requireTypedText, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  requireTypedText?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) setTyped(''); }, [open]);
  if (!open) return null;
  const locked = !!requireTypedText && typed !== requireTypedText;

  return (
    <Modal open onClose={onClose} title={title} size="sm" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          className={destructive ? 'bg-red-600 hover:bg-red-700' : ''}
          disabled={locked}
          onClick={() => { onConfirm(); onClose(); }}
        >
          {confirmLabel}
        </Button>
      </>
    }>
      <div className="space-y-3 text-sm text-ink-600">
        {message}
        {requireTypedText && (
          <div>
            <p className="mb-1 text-xs font-medium text-ink-500">Type <span className="font-mono font-semibold text-ink-800">{requireTypedText}</span> to confirm</p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---- PromptDialog: replaces window.prompt with real app UI -----------------
// For a required free-text reason/comment (e.g. "why are changes needed").
// requireNonEmpty defaults to true since every current use of this needs a
// real comment before the action can go through.
function PromptDialog({
  open, title, label, placeholder, confirmLabel = 'Submit', destructive = false,
  requireNonEmpty = true, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  destructive?: boolean;
  requireNonEmpty?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  useEffect(() => { if (open) setValue(''); }, [open]);
  if (!open) return null;
  const locked = requireNonEmpty && !value.trim();

  return (
    <Modal open onClose={onClose} title={title} size="sm" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          className={destructive ? 'bg-red-600 hover:bg-red-700' : ''}
          disabled={locked}
          onClick={() => { onConfirm(value.trim()); onClose(); }}
        >
          {confirmLabel}
        </Button>
      </>
    }>
      <Field label={label}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && !locked) { onConfirm(value.trim()); onClose(); } }}
        />
      </Field>
    </Modal>
  );
}


function ContactsTab() {
  const [page, setPage] = useState(1);
  const { leads, pagination, loading, error, updateLead } = useLeads({ page, limit: 20 });
  const { groups } = useGroups();
  const [assigningId, setAssigningId] = useState<string | null>(null);
  // Which lead's Group cell has its multi-select popover open -- a plain
  // <Select> can only represent one value, but a lead can now belong to
  // several groups at once (AiSensy-style), so this needs real multi-select.
  const [openGroupPickerId, setOpenGroupPickerId] = useState<string | null>(null);
  // Same idea for Tags, but freeform (type + Enter) instead of a fixed
  // checklist -- there's no predefined tag list the way there is for
  // Groups, matching AiSensy's lightweight tagging model.
  const [openTagsPickerId, setOpenTagsPickerId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');

  const toggleContactGroup = async (lead: LeadListItem, groupId: string) => {
    setAssigningId(lead.id);
    const current = lead.group_ids || [];
    const next = current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId];
    try {
      await updateLead(lead.id, { group_ids: next });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update groups');
    } finally {
      setAssigningId(null);
    }
  };

  const addContactTag = async (lead: LeadListItem, rawTag: string) => {
    const tag = rawTag.trim();
    if (!tag || lead.tags.includes(tag)) return;
    setAssigningId(lead.id);
    try {
      await updateLead(lead.id, { tags: [...lead.tags, tag] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add tag');
    } finally {
      setAssigningId(null);
    }
  };

  const removeContactTag = async (lead: LeadListItem, tag: string) => {
    setAssigningId(lead.id);
    try {
      await updateLead(lead.id, { tags: lead.tags.filter((t) => t !== tag) });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove tag');
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={TAB_ICONS.contacts} title="WhatsApp Contacts" subtitle={pagination ? `${pagination.total} contacts synced` : 'Loading…'} />
        {error ? (
          <EmptyState title="Couldn't load contacts" description={error} />
        ) : loading && leads.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">Loading contacts…</p>
        ) : leads.length === 0 ? (
          <EmptyState title="No contacts yet" description="Leads with a WhatsApp number will appear here." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Contact</Th><Th>WhatsApp</Th><Th>Group</Th><Th>Tags</Th><Th>Consent</Th><Th>Opt-out</Th><Th>Last contacted</Th><Th>Score</Th></tr></thead>
              <tbody>
                {leads.map((l) => (
                  <Tr key={l.id}>
                    <Td><div className="flex items-center gap-2"><Avatar name={l.name} color="#22c55e" size={30} /><span className="font-medium">{l.name}</span></div></Td>
                    <Td className="font-mono text-xs">{l.whatsapp_number || l.phone}</Td>
                    <Td>
                      <div className="relative inline-block">
                        <button
                          onClick={() => setOpenGroupPickerId((id) => (id === l.id ? null : l.id))}
                          disabled={assigningId === l.id}
                          className="flex max-w-[180px] flex-wrap items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-left hover:bg-ink-50 disabled:opacity-60"
                        >
                          {l.group_ids.length === 0 ? (
                            <span className="text-xs text-ink-400">No group</span>
                          ) : (
                            l.group_ids.map((gid) => {
                              const g = groups.find((gr) => gr.id === gid);
                              return g ? <Badge key={gid} tone="teal">{g.name}</Badge> : null;
                            })
                          )}
                          <ChevronDown size={12} className="ml-auto shrink-0 text-ink-400" />
                        </button>
                        {openGroupPickerId === l.id && (
                          <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft">
                            {groups.length === 0 ? (
                              <p className="px-2 py-2 text-xs text-ink-400">No groups yet.</p>
                            ) : (
                              groups.map((g) => (
                                <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50">
                                  <input
                                    type="checkbox"
                                    checked={l.group_ids.includes(g.id)}
                                    onChange={() => void toggleContactGroup(l, g.id)}
                                    className="h-4 w-4 rounded border-ink-300 accent-brand-600"
                                  />
                                  {g.name}
                                </label>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <div className="relative inline-block">
                        <button
                          onClick={() => { setOpenTagsPickerId((id) => (id === l.id ? null : l.id)); setTagDraft(''); }}
                          disabled={assigningId === l.id}
                          className="flex max-w-[180px] flex-wrap items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-left hover:bg-ink-50 disabled:opacity-60"
                        >
                          {l.tags.length === 0 ? (
                            <span className="text-xs text-ink-400">No tags</span>
                          ) : (
                            l.tags.map((t) => <Badge key={t} tone="violet">{t}</Badge>)
                          )}
                          <ChevronDown size={12} className="ml-auto shrink-0 text-ink-400" />
                        </button>
                        {openTagsPickerId === l.id && (
                          <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-xl border border-ink-200 bg-white p-2 shadow-soft">
                            {l.tags.length > 0 && (
                              <div className="mb-2 flex flex-wrap gap-1">
                                {l.tags.map((t) => (
                                  <button
                                    key={t}
                                    onClick={() => void removeContactTag(l, t)}
                                    title="Remove tag"
                                    className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-100"
                                  >
                                    {t} <X size={10} />
                                  </button>
                                ))}
                              </div>
                            )}
                            <input
                              autoFocus
                              value={tagDraft}
                              onChange={(e) => setTagDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); void addContactTag(l, tagDraft); setTagDraft(''); }
                              }}
                              placeholder="Type a tag, press Enter…"
                              className="input py-1 text-xs"
                            />
                          </div>
                        )}
                      </div>
                    </Td>
                    <Td><Badge tone={l.consent_status === 'granted' ? 'green' : 'amber'}>{l.consent_status}</Badge></Td>
                    <Td>{l.opt_out_status ? <Badge tone="red">Opted out</Badge> : <Badge tone="gray">No</Badge>}</Td>
                    <Td className="text-ink-500">{timeAgo(l.last_contacted_at)}</Td>
                    <Td className="font-semibold">{l.qualification_score}/10</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3">
                <p className="text-xs text-ink-500">Page {pagination.page} of {pagination.totalPages} · {pagination.total} total</p>
                <div className="flex gap-1.5">
                  <Button variant="secondary" disabled={!pagination.hasPrev} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15} /> Prev</Button>
                  <Button variant="secondary" disabled={!pagination.hasNext} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight size={15} /></Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// Deterministic per-contact avatar color for the member-management modal
// -- same technique as Inbox.tsx's avatarColor, kept local here since
// these are two separate page files and this one has no shared import
// path to that one without adding cross-page coupling for a 20-line util.
const MEMBER_AVATAR_PALETTE = ['#6366f1', '#22c55e', '#f97316', '#ec4899', '#0ea5e9', '#a855f7', '#14b8a6', '#eab308'];
function memberAvatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return MEMBER_AVATAR_PALETTE[hash % MEMBER_AVATAR_PALETTE.length];
}

// ---- Groups: own tab, professional CRUD + bulk member management ----------
function GroupsTab() {
  const { groups, loading, error, createGroup, updateGroup, deleteGroup, refetch: refetchGroups } = useGroups();
  // Large limit -- member-management checklist needs the full contact list,
  // not a paginated slice. Fine at current scale; would need a real search-
  // as-you-type server query if the contact base grows much larger.
  // Member management deliberately does NOT load the full contact list
  // into the browser -- at 10k+ contacts that would be slow, wasteful,
  // and (worse) silently incomplete if capped at some arbitrary limit.
  // Instead: current members are fetched server-side scoped to just this
  // group (naturally small regardless of total contact count), and the
  // "add members" list is a real debounced server-side search bounded to
  // a handful of results at a time -- the same pattern as any real
  // contact-picker at scale.
  const [managingGroup, setManagingGroup] = useState<Group | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [debouncedMemberSearch, setDebouncedMemberSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedMemberSearch(memberSearch), 300);
    return () => clearTimeout(t);
  }, [memberSearch]);

  // Current-members side gets its own independent search + page, so you
  // can search WITHIN a group's existing members (not just the add-side
  // contact search) -- separate state because the two lists are backed by
  // two entirely separate server queries.
  const [currentSearch, setCurrentSearch] = useState('');
  const [debouncedCurrentSearch, setDebouncedCurrentSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCurrentSearch(currentSearch), 300);
    return () => clearTimeout(t);
  }, [currentSearch]);

  const MEMBERS_PAGE_SIZE = 8;
  const [currentPage, setCurrentPage] = useState(1);
  const [addPage, setAddPage] = useState(1);
  // Typing a new search mid-pagination should always snap back to page 1
  // -- otherwise "page 3 of a filtered-down result set" can silently show
  // zero rows with no obvious explanation.
  useEffect(() => setCurrentPage(1), [debouncedCurrentSearch]);
  useEffect(() => setAddPage(1), [debouncedMemberSearch]);

  const { leads: currentMembers, pagination: currentPagination, loading: membersLoading, updateLead } = useLeads(
    managingGroup
      ? { group_id: managingGroup.id, search: debouncedCurrentSearch.trim() || undefined, page: currentPage, limit: MEMBERS_PAGE_SIZE }
      : { group_id: '__none__', limit: 1 },
  );
  const { leads: searchResults, pagination: addPagination, loading: searchLoading, refetch: refetchSearch } = useLeads(
    managingGroup
      ? { search: debouncedMemberSearch.trim() || undefined, page: addPage, limit: MEMBERS_PAGE_SIZE }
      : { group_id: '__none__', limit: 1 },
  );
  const leadsLoading = membersLoading || searchLoading;

  // Checkbox multi-select for bulk add/remove -- persists across page
  // navigation within the same modal session (so picking people across
  // two pages of search results, then bulk-adding once, works the way
  // it would in any real contact picker), and resets whenever the modal
  // is opened fresh (see openManageMembers below).
  const [selectedRemove, setSelectedRemove] = useState<Set<string>>(new Set());
  const [selectedAdd, setSelectedAdd] = useState<Set<string>>(new Set());
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);

  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);

  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<{ id: string; name: string } | null>(null);

  const openCreate = () => { setCreateForm({ name: '', description: '' }); setShowCreate(true); };

  const submitCreate = async () => {
    if (!createForm.name.trim()) return toast.error('Group name required');
    setCreating(true);
    try {
      await createGroup({ name: createForm.name.trim(), description: createForm.description.trim() });
      toast.success('Group created');
      setShowCreate(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (g: Group) => { setEditingGroup(g); setEditForm({ name: g.name, description: g.description }); };

  const submitEdit = async () => {
    if (!editingGroup) return;
    if (!editForm.name.trim()) return toast.error('Group name required');
    setSavingEdit(true);
    try {
      await updateGroup(editingGroup.id, { name: editForm.name.trim(), description: editForm.description.trim() });
      toast.success('Group updated');
      setEditingGroup(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update group');
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingGroup) return;
    try {
      await deleteGroup(deletingGroup.id);
      toast.success('Group deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete group');
    }
  };

  const openManageMembers = (g: Group) => {
    setManagingGroup(g);
    setMemberSearch('');
    setCurrentSearch('');
    setCurrentPage(1);
    setAddPage(1);
    setSelectedRemove(new Set());
    setSelectedAdd(new Set());
  };

  // Additive action -- no confirmation needed, matches standard UX
  // convention (only the destructive removal below asks "are you sure").
  // Multi-membership (AiSensy-style): adding to THIS group never touches
  // any other group the lead already belongs to -- we send the FULL
  // desired group_ids array (current ones + this one), since the PATCH
  // endpoint does a plain $set on whatever fields are given, not a
  // server-side array-append.
  const addMember = async (lead: LeadListItem) => {
    if (!managingGroup) return;
    setBusyLeadId(lead.id);
    try {
      const nextGroupIds = lead.group_ids.includes(managingGroup.id) ? lead.group_ids : [...lead.group_ids, managingGroup.id];
      await updateLead(lead.id, { group_ids: nextGroupIds });
      toast.success(`${lead.name} added to ${managingGroup.name}`);
      // updateLead only auto-refetches the "current members" hook it came
      // from -- the separate search-results hook has no way to know
      // anything changed, so without this it keeps showing this exact
      // person as still addable even though they're now already a member.
      refetchSearch();
      // The group CARD's "N members" badge comes from a totally separate
      // useGroups() list query (computed server-side, not live) -- without
      // this it stays stale showing the old count until the tab remounts.
      refetchGroups();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not add member');
    } finally {
      setBusyLeadId(null);
    }
  };

  const confirmRemoveMember = async () => {
    if (!removingMember || !managingGroup) return;
    setBusyLeadId(removingMember.id);
    try {
      // Removes ONLY this group from the lead's membership -- any other
      // group they're in stays untouched. currentMembers already carries
      // each lead's full group_ids (it's the same LeadListItem shape as
      // everywhere else), so no extra fetch is needed to know the rest.
      const current = currentMembers.find((l) => l.id === removingMember.id);
      const nextGroupIds = (current?.group_ids ?? [managingGroup.id]).filter((id) => id !== managingGroup.id);
      await updateLead(removingMember.id, { group_ids: nextGroupIds });
      toast.success(`${removingMember.name} removed from ${managingGroup.name}`);
      refetchSearch();
      refetchGroups(); // keep the group card's member-count badge in sync
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not remove member');
    } finally {
      setBusyLeadId(null);
      setRemovingMember(null);
    }
  };

  const toggleSelect = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const toggleSelectAll = (pageItems: { id: string }[], set: Set<string>, setter: (s: Set<string>) => void) => {
    const allSelected = pageItems.length > 0 && pageItems.every((i) => set.has(i.id));
    const next = new Set(set);
    if (allSelected) pageItems.forEach((i) => next.delete(i.id));
    else pageItems.forEach((i) => next.add(i.id));
    setter(next);
  };

  const bulkAdd = async () => {
    if (!managingGroup || selectedAdd.size === 0) return;
    setBulkBusy(true);
    const targets = filteredLeads.filter((l) => selectedAdd.has(l.id));
    const results = await Promise.allSettled(
      targets.map((l) => updateLead(l.id, { group_ids: l.group_ids.includes(managingGroup.id) ? l.group_ids : [...l.group_ids, managingGroup.id] })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    setBulkBusy(false);
    setSelectedAdd(new Set());
    refetchSearch();
    refetchGroups(); // keep the group card's member-count badge in sync
    if (failed === 0) toast.success(`${targets.length} member${targets.length === 1 ? '' : 's'} added to ${managingGroup.name}`);
    else toast.error(`Added ${targets.length - failed} of ${targets.length} — ${failed} failed`);
  };

  const bulkRemove = async () => {
    if (!managingGroup || selectedRemove.size === 0) return;
    setBulkBusy(true);
    const targets = currentMembers.filter((l) => selectedRemove.has(l.id));
    const results = await Promise.allSettled(
      targets.map((l) => updateLead(l.id, { group_ids: l.group_ids.filter((id) => id !== managingGroup.id) })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    setBulkBusy(false);
    setSelectedRemove(new Set());
    refetchSearch();
    refetchGroups(); // keep the group card's member-count badge in sync
    if (failed === 0) toast.success(`${targets.length} member${targets.length === 1 ? '' : 's'} removed from ${managingGroup.name}`);
    else toast.error(`Removed ${targets.length - failed} of ${targets.length} — ${failed} failed`);
  };

  // currentMembers is already server-scoped to this exact group (see the
  // useLeads call above) -- no client-side filtering needed. filteredLeads
  // only needs a cheap exclude-current-members pass, since searchResults
  // is already bounded to a small server-side page, never the full
  // contact base.
  const filteredLeads = managingGroup
    ? searchResults.filter((l) => !l.group_ids.includes(managingGroup.id))
    : [];

  if (loading) return <div className="py-12 text-center text-sm text-ink-500">Loading groups…</div>;
  if (error) return <div className="py-12 text-center text-sm text-red-600">{error}</div>;

  return (
    <div>
      <Card className="mb-4">
        <CardHeader
          icon={TAB_ICONS.groups}
          title="Groups"
          subtitle="Used to target campaigns and broadcasts at a whole audience, never at individually-picked contacts."
          action={<Button onClick={openCreate}><Plus size={16} /> New Group</Button>}
        />
      </Card>

      {groups.length === 0 ? (
        <EmptyState title="No groups yet" description="Create a group, then add members to it." action={<Button onClick={openCreate}><Plus size={16} /> Create group</Button>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-ink-900">{g.name}</p>
                  {g.description && <p className="mt-0.5 text-xs text-ink-500">{g.description}</p>}
                </div>
                <Badge tone="gray">{g.memberCount} member{g.memberCount === 1 ? '' : 's'}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => openManageMembers(g)}>Manage members</Button>
                <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => openEdit(g)}>Edit</Button>
                <button
                  className="ml-auto rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                  title="Delete"
                  onClick={() => setDeletingGroup(g)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create */}
      {showCreate && (
        <Modal open onClose={() => setShowCreate(false)} title="New Group"
          footer={<><Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={submitCreate} disabled={creating}>Create</Button></>}>
          <div className="space-y-4">
            <Field label="Name"><Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g. Hot leads" autoFocus /></Field>
            <Field label="Description (optional)"><Input value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {/* Edit */}
      {editingGroup && (
        <Modal open onClose={() => setEditingGroup(null)} title="Edit Group"
          footer={<><Button variant="secondary" onClick={() => setEditingGroup(null)}>Cancel</Button><Button onClick={submitEdit} disabled={savingEdit}>Save changes</Button></>}>
          <div className="space-y-4">
            <Field label="Name"><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} autoFocus /></Field>
            <Field label="Description (optional)"><Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {/* Delete -- double-verified: destructive + must type the group's exact name */}
      <ConfirmDialog
        open={!!deletingGroup}
        onClose={() => setDeletingGroup(null)}
        title="Delete group"
        destructive
        confirmLabel="Delete group"
        requireTypedText={deletingGroup?.name}
        onConfirm={confirmDelete}
        message={
          <p>
            This permanently deletes <strong>{deletingGroup?.name}</strong>.
            {deletingGroup && deletingGroup.memberCount > 0 && (
              <> Its {deletingGroup.memberCount} member{deletingGroup.memberCount === 1 ? '' : 's'} will be unassigned (set to "No group") — they are not deleted.</>
            )}
          </p>
        }
      />

      {/* Manage members -- search + real server-side pagination on BOTH
          the current-members list and the add-contacts search, plus
          checkbox multi-select for bulk add/remove. Single-row Remove/Add
          buttons still work too (kept for the common one-off case), but
          for anything more than a couple of people the bulk bar is what
          makes this usable at real scale instead of one click per person. */}
      {managingGroup && (
        <Modal open onClose={() => setManagingGroup(null)} title={`Manage members — ${managingGroup.name}`} size="lg"
          footer={<Button onClick={() => setManagingGroup(null)}>Done</Button>}>
          <div className="space-y-4">
            {/* Each section is its own bordered sub-card -- previously
                "Current members" and "Add members" just sat one above the
                other separated by spacing alone, which read as one long
                blurred list rather than two distinct actions. */}
            <div className="rounded-2xl border border-ink-100 bg-ink-50/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={currentMembers.length > 0 && currentMembers.every((l) => selectedRemove.has(l.id))}
                    onChange={() => toggleSelectAll(currentMembers, selectedRemove, setSelectedRemove)}
                    disabled={currentMembers.length === 0}
                    className="h-4 w-4 rounded border-ink-300 accent-brand-600 disabled:opacity-30"
                    title="Select all on this page"
                  />
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-500">
                    Current members {currentPagination ? `(${currentPagination.total})` : ''}
                  </p>
                </div>
                {selectedRemove.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-ink-500">{selectedRemove.size} selected</span>
                    <button onClick={() => setSelectedRemove(new Set())} className="text-xs font-medium text-ink-400 hover:text-ink-600">Clear</button>
                    <Button
                      variant="secondary"
                      className="border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                      disabled={bulkBusy}
                      onClick={() => setBulkRemoveOpen(true)}
                    >
                      Remove selected
                    </Button>
                  </div>
                )}
              </div>
              <IconInput icon={<Search size={14} />} value={currentSearch} onChange={(e) => setCurrentSearch(e.target.value)} placeholder="Search current members…" className="mb-3 bg-white" />
              {membersLoading ? (
                <p className="py-4 text-center text-sm text-ink-400">Loading…</p>
              ) : currentMembers.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ink-200 bg-white py-4 text-center text-sm text-ink-400">
                  {currentSearch.trim() ? 'No current members match.' : 'No members yet — add some below.'}
                </p>
              ) : (
                <>
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-ink-100 bg-white">
                    {currentMembers.map((l) => {
                      const checked = selectedRemove.has(l.id);
                      return (
                        <div key={l.id} className={cn('flex items-center gap-3 border-b border-ink-50 px-3 py-2 last:border-0', checked ? 'bg-brand-50' : 'hover:bg-ink-50')}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelect(selectedRemove, setSelectedRemove, l.id)}
                            className="h-4 w-4 shrink-0 rounded border-ink-300 accent-brand-600"
                          />
                          <Avatar name={l.name} color={memberAvatarColor(l.id)} size={26} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink-900">{l.name}</p>
                            <p className="truncate text-xs text-ink-500">{l.whatsapp_number || l.phone}</p>
                          </div>
                          <Button
                            variant="secondary"
                            className="whitespace-nowrap border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                            disabled={busyLeadId === l.id}
                            onClick={() => setRemovingMember({ id: l.id, name: l.name })}
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  {currentPagination && currentPagination.totalPages > 1 && (
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-ink-400">Page {currentPagination.page} of {currentPagination.totalPages}</span>
                      <div className="flex gap-1.5">
                        <Button variant="secondary" className="px-2 py-1 text-xs" disabled={!currentPagination.hasPrev} onClick={() => setCurrentPage((p) => p - 1)}><ChevronLeft size={13} /> Prev</Button>
                        <Button variant="secondary" className="px-2 py-1 text-xs" disabled={!currentPagination.hasNext} onClick={() => setCurrentPage((p) => p + 1)}>Next <ChevronRight size={13} /></Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="rounded-2xl border border-ink-100 bg-ink-50/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filteredLeads.length > 0 && filteredLeads.every((l) => selectedAdd.has(l.id))}
                    onChange={() => toggleSelectAll(filteredLeads, selectedAdd, setSelectedAdd)}
                    disabled={filteredLeads.length === 0}
                    className="h-4 w-4 rounded border-ink-300 accent-brand-600 disabled:opacity-30"
                    title="Select all on this page"
                  />
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Add members</p>
                </div>
                {selectedAdd.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-ink-500">{selectedAdd.size} selected</span>
                    <button onClick={() => setSelectedAdd(new Set())} className="text-xs font-medium text-ink-400 hover:text-ink-600">Clear</button>
                    <Button className="px-2.5 py-1 text-xs" disabled={bulkBusy} onClick={() => void bulkAdd()}>
                      Add selected
                    </Button>
                  </div>
                )}
              </div>
              <IconInput icon={<Search size={14} />} value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Search by name or number…" className="mb-3 bg-white" />
              {searchLoading ? (
                <p className="py-4 text-center text-sm text-ink-400">Loading contacts…</p>
              ) : filteredLeads.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ink-200 bg-white py-4 text-center text-sm text-ink-400">{memberSearch.trim() ? 'No contacts match.' : 'Search by name or number to find someone to add.'}</p>
              ) : (
                <>
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-ink-100 bg-white">
                    {filteredLeads.map((l) => {
                      // Multi-membership: being in other groups is now just
                      // informational context (shown as small chips), not
                      // a warning that adding here will move/remove them
                      // from anywhere -- "Add" always simply adds this one
                      // group on top of whatever else they're already in.
                      const otherGroupNames = l.group_ids
                        .map((gid) => groups.find((g) => g.id === gid)?.name)
                        .filter((n): n is string => !!n);
                      const checked = selectedAdd.has(l.id);
                      return (
                        <div key={l.id} className={cn('flex items-center gap-3 border-b border-ink-50 px-3 py-2 last:border-0', checked ? 'bg-brand-50' : 'hover:bg-ink-50')}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelect(selectedAdd, setSelectedAdd, l.id)}
                            className="h-4 w-4 shrink-0 rounded border-ink-300 accent-brand-600"
                          />
                          <Avatar name={l.name} color={memberAvatarColor(l.id)} size={26} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink-900">{l.name}</p>
                            <p className="truncate text-xs text-ink-500">{l.whatsapp_number || l.phone}</p>
                            {otherGroupNames.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {otherGroupNames.map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="secondary"
                            className="whitespace-nowrap px-2.5 py-1 text-xs"
                            disabled={busyLeadId === l.id}
                            onClick={() => void addMember(l)}
                          >
                            Add
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  {addPagination && addPagination.totalPages > 1 && (
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-ink-400">Page {addPagination.page} of {addPagination.totalPages}</span>
                      <div className="flex gap-1.5">
                        <Button variant="secondary" className="px-2 py-1 text-xs" disabled={!addPagination.hasPrev} onClick={() => setAddPage((p) => p - 1)}><ChevronLeft size={13} /> Prev</Button>
                        <Button variant="secondary" className="px-2 py-1 text-xs" disabled={!addPagination.hasNext} onClick={() => setAddPage((p) => p + 1)}>Next <ChevronRight size={13} /></Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!removingMember}
        title="Remove member"
        message={<>Remove <strong>{removingMember?.name}</strong> from <strong>{managingGroup?.name}</strong>? They can be added back at any time.</>}
        confirmLabel="Remove"
        destructive
        onConfirm={() => void confirmRemoveMember()}
        onClose={() => setRemovingMember(null)}
      />

      <ConfirmDialog
        open={bulkRemoveOpen}
        title="Remove selected members"
        message={<>Remove <strong>{selectedRemove.size} member{selectedRemove.size === 1 ? '' : 's'}</strong> from <strong>{managingGroup?.name}</strong>? They can be added back at any time.</>}
        confirmLabel="Remove selected"
        destructive
        onConfirm={() => void bulkRemove()}
        onClose={() => setBulkRemoveOpen(false)}
      />
    </div>
  );
}
/**
 * parseTemplateSubmissionError -- turns Meta's raw "submit to provider"
 * rejection text into a specific, actionable title + explanation instead
 * of showing the raw sentence verbatim. Every pattern here is one we
 * personally hit and root-caused debugging this feature (file format,
 * missing body example, missing App ID) -- not guessed, confirmed live.
 * Anything unrecognized still shows Meta's own message, just under a
 * clearer "Meta rejected this template" heading instead of a flat error.
 */
function parseTemplateSubmissionError(raw: string): { title: string; description: string } {
  const msg = raw || '';
  if (/type of file is not supported/i.test(msg)) {
    return {
      title: 'Header file format not accepted',
      description: "Meta only accepts JPEG/PNG for image headers, MP4/3GPP for video, and PDF for documents. Edit the template and re-upload the header using exactly one of those formats.",
    };
  }
  if (/BODY.*missing expected field.*example/i.test(msg) || /missing expected field.*example/i.test(msg)) {
    return {
      title: 'Missing example value',
      description: 'Meta requires a sample value for every {{n}} placeholder before it will review the template. Edit the template, make sure every placeholder has a field mapped, and save again.',
    };
  }
  if (/App ID is not configured/i.test(msg)) {
    return {
      title: 'Meta App ID missing',
      description: "This template has a media header, which needs your Facebook Developer App ID to upload the example file. Add it in WhatsApp Settings, then try submitting again.",
    };
  }
  if (/IMAGE header type need.*example/i.test(msg) || /sample.*header/i.test(msg)) {
    return {
      title: 'Header example missing',
      description: 'This template\u2019s header type needs a sample file attached before Meta will review it. Edit the template and upload one.',
    };
  }
  if (/not connected to meta/i.test(msg) || /whatsapp is not connected/i.test(msg)) {
    return {
      title: 'WhatsApp not connected',
      description: 'Connect a real Meta Cloud API account in WhatsApp Settings before submitting templates for approval.',
    };
  }
  if (/rate limit|too many requests/i.test(msg)) {
    return {
      title: 'Meta rate limit reached',
      description: 'Too many requests were sent to Meta in a short time. Wait a few minutes and try submitting again.',
    };
  }
  // Unrecognized -- still show Meta's own message, just framed clearly
  // rather than as an unexplained flat error.
  return { title: 'Meta rejected this template', description: msg.replace(/^Meta rejected this template\s*--\s*/i, '') };
}

function TemplatesTab() {
  const { templates, loading, error, refetch, deleteTemplate, duplicateTemplate, activateTemplate, pauseTemplate, archiveTemplate } = useWhatsAppTemplates();
  const { submitForReview, submitToProvider } = useTemplateApproval(refetch);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editTpl, setEditTpl] = useState<WhatsAppTemplateReal | null>(null);
  const [previewTpl, setPreviewTpl] = useState<WhatsAppTemplateReal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const currentUser = useAuthStore((s) => s.user);

  // Same real sync as WhatsApp Settings' "Sync now" -- duplicated here
  // because a stale/incomplete template list is discovered ON this page,
  // not in Settings, so the fix belongs where the person notices the
  // problem. Settings keeps the auto-sync toggle (a background-behavior
  // setting); this is the same one-off action, just reachable from
  // where it's actually needed.
  const handleSyncTemplates = async () => {
    setSyncing(true);
    try {
      const { result } = await whatsappSettingsApi.syncTemplates();
      if (!result) {
        toast.error('Sync failed', 'No result returned from server.');
      } else if (result.errors.length > 0) {
        toast.warning(
          `Synced with ${result.errors.length} error(s)`,
          `${result.created} created, ${result.updated} updated. First error: ${result.errors[0].message}`,
        );
      } else {
        toast.success('Templates synced from Meta', `${result.created} created, ${result.updated} updated, ${result.total} total.`);
      }
      refetch();
    } catch (err) {
      toast.error('Sync failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  // Mirrors templates.service.js's activateTemplate guard exactly: the
  // owner can only bypass real approval for templates they PERSONALLY
  // created -- for anyone else's template (even as owner), Activate only
  // shows once it's actually been submitted/approved, so a Sales User's
  // untouched draft can't be activated straight from this tab, skipping
  // their own "submit for review" step.
  const canActivateDirectly = (t: WhatsAppTemplateReal) => {
    const APPROVED_ENOUGH = ['INTERNALLY_APPROVED', 'SUBMITTED_TO_PROVIDER', 'PROVIDER_APPROVED', 'PAUSED'];
    if (APPROVED_ENOUGH.includes(t.approvalStatus)) return true;
    return atLeast(currentUser?.role, 'tenant_owner') && t.createdBy === currentUser?.id;
  };

  // Mirrors requireRoleOrPermission(ROLE_MIN.SUBMIT_TO_PROVIDER, PERMISSIONS.APPROVE_TEMPLATES)
  // on the real templateApproval route.
  const canSubmitToProvider = hasRoleOrPermission(currentUser?.role, currentUser?.permissions, 'tenant_admin', 'approve_templates');

  const runAction = async (id: string, action: () => Promise<unknown>, successMsg: string, failMsg: string, parseError?: (raw: string) => { title: string; description: string }) => {
    setBusyId(id);
    try {
      await action();
      toast.success(successMsg);
    } catch (err) {
      const raw = err instanceof ApiError ? err.message : 'Please try again.';
      if (parseError && err instanceof ApiError) {
        const parsed = parseError(raw);
        toast.error(parsed.title, parsed.description);
      } else {
        toast.error(failMsg, raw);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (t: WhatsAppTemplateReal) => {
    if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    await runAction(t.id, () => deleteTemplate(t.id), 'Template deleted', 'Could not delete template');
  };

  if (loading && templates.length === 0) return <p className="p-8 text-center text-sm text-ink-400">Loading templates…</p>;
  if (error) return <Card className="p-4 text-sm text-red-600">{error}</Card>;

  // Same rule as the Template Approval tab: an untouched DRAFT (never
  // submitted) is only relevant to its own creator -- everyone else,
  // owner included, sees it once it's actually been submitted.
  const visibleTemplates = templates.filter((t) => t.approvalStatus !== 'DRAFT' || t.createdBy === currentUser?.id);

  return (
    <div>
      <Card className="mb-4">
        <CardHeader
          icon={TAB_ICONS.templates}
          title="Templates"
          subtitle="Create, edit and duplicate WhatsApp templates before they go into internal review."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void handleSyncTemplates()} disabled={syncing}>
                <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync from Meta'}
              </Button>
              <Button onClick={() => setShowBuilder(true)}><Plus size={16} /> New Template</Button>
            </div>
          }
        />
      </Card>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleTemplates.map((t) => (
          <Card key={t.id} className={cn('flex flex-col p-4', t.approvalStatus === 'REJECTED' && 'opacity-70')}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-ink-900">{t.name}</p>
                <div className="mt-1 flex gap-1.5"><Badge tone="violet">{t.category}</Badge><Badge tone="gray">{t.languageCode}</Badge></div>
              </div>
              <div className="flex items-center gap-1.5">
                <button className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" onClick={() => setPreviewTpl(t)} title="Preview"><Eye size={14} /></button>
                <StatusBadge status={t.status} />
              </div>
            </div>
            <p className="mt-3 line-clamp-3 flex-1 rounded-lg bg-ink-50 p-2.5 text-sm text-ink-600">{t.body}</p>
            {t.approvalStatus === 'REJECTED' && (
              <p className="mt-2 text-xs font-medium text-red-600">Rejected — read-only. Duplicate to start a fresh, editable copy.</p>
            )}
            {t.variables.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{t.variables.map((v) => <span key={v} className="font-mono text-[11px] text-brand-600">{`{{${v}}}`}</span>)}</div>}
            <div className="mt-3 flex items-start justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {t.approvalStatus === 'DRAFT' && (
                  <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setEditTpl(t)}>Edit</Button>
                )}
                <button
                  className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-50" disabled={busyId === t.id} title="Duplicate"
                  onClick={() => void runAction(t.id, () => duplicateTemplate(t.id), 'Template duplicated', 'Could not duplicate template')}
                ><Copy size={14} /></button>
                {t.approvalStatus === 'DRAFT' && t.createdBy === currentUser?.id && !canActivateDirectly(t) && (
                  <Button className="px-2.5 py-1 text-xs" disabled={busyId === t.id} onClick={() => void runAction(t.id, () => submitForReview(t.id), 'Submitted for internal review', 'Could not submit for review')}>
                    <Send size={12} /> Submit for Internal Review
                  </Button>
                )}
                {(t.status === 'DRAFT' || t.status === 'PAUSED') && canActivateDirectly(t) && (
                  <Button className="px-2.5 py-1 text-xs" disabled={busyId === t.id} onClick={() => void runAction(t.id, () => activateTemplate(t.id), 'Template activated', 'Could not activate template')}>
                    {t.status === 'PAUSED' ? 'Resume' : 'Activate'}
                  </Button>
                )}
                {t.approvalStatus === 'DRAFT' && t.createdBy !== currentUser?.id && !canActivateDirectly(t) && (
                  <span className="px-2.5 py-1 text-xs text-ink-400">Awaiting submission by its creator</span>
                )}
                {t.approvalStatus === 'INTERNALLY_APPROVED' && (
                  canSubmitToProvider ? (
                    <Button className="px-2.5 py-1 text-xs" disabled={busyId === t.id} onClick={() => void runAction(t.id, () => submitToProvider(t.id), 'Submitted to provider', 'Could not submit to provider', parseTemplateSubmissionError)}>
                      <Send size={12} /> Submit to provider
                    </Button>
                  ) : (
                    <span className="px-2.5 py-1 text-xs text-ink-400">Approved internally — awaiting submission by someone with approval rights</span>
                  )
                )}
                {t.status === 'ACTIVE' && (
                  <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={busyId === t.id} onClick={() => void runAction(t.id, () => pauseTemplate(t.id), 'Template paused', 'Could not pause template')}>
                    Pause
                  </Button>
                )}
                {t.status !== 'ARCHIVED' && (
                  <Button variant="ghost" className="px-2.5 py-1 text-xs text-ink-500" disabled={busyId === t.id} onClick={() => void runAction(t.id, () => archiveTemplate(t.id), 'Template archived', 'Could not archive template')}>
                    Archive
                  </Button>
                )}
              </div>
              <button onClick={() => void handleDelete(t)} disabled={busyId === t.id} className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          </Card>
        ))}
        <button onClick={() => setShowBuilder(true)} className="flex min-h-[180px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-200 text-ink-400 transition hover:border-brand-300 hover:text-brand-600">
          <Plus size={24} /><span className="mt-2 text-sm font-medium">New template</span>
        </button>
      </div>

      {showBuilder && <TemplateBuilder onClose={() => setShowBuilder(false)} onSaved={refetch} />}
      {editTpl && <TemplateBuilder template={editTpl} onClose={() => setEditTpl(null)} onSaved={refetch} />}
      {previewTpl && (
        <Modal open onClose={() => setPreviewTpl(null)} title={`Preview — ${previewTpl.name}`} size="sm" footer={<Button onClick={() => setPreviewTpl(null)}>Close</Button>}>
          <TemplatePreview
            headerType={previewTpl.header?.type ?? 'NONE'}
            headerText={previewTpl.header?.text}
            headerMediaUrl={previewTpl.header?.mediaUrl}
            body={previewTpl.body}
            footer={previewTpl.footer}
            buttons={previewTpl.buttons}
            category={previewTpl.category}
          />
        </Modal>
      )}
    </div>
  );
}

// ---- Approval workflow -----------------------------------------------------
const APPROVAL_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED_FOR_INTERNAL_REVIEW: 'Submitted for Internal Review',
  INTERNALLY_APPROVED: 'Internally Approved',
  SUBMITTED_TO_PROVIDER: 'Submitted to Provider',
  PROVIDER_APPROVED: 'Provider Approved',
  PROVIDER_REJECTED: 'Provider Rejected',
  REJECTED: 'Rejected',
  PAUSED: 'Paused',
  DISABLED: 'Disabled',
};

const APPROVAL_STATUS_TONE: Record<string, 'gray' | 'violet' | 'green' | 'red' | 'amber' | 'blue'> = {
  DRAFT: 'gray',
  SUBMITTED_FOR_INTERNAL_REVIEW: 'blue',
  INTERNALLY_APPROVED: 'violet',
  SUBMITTED_TO_PROVIDER: 'amber',
  PROVIDER_APPROVED: 'green',
  PROVIDER_REJECTED: 'red',
  REJECTED: 'red',
  PAUSED: 'amber',
  DISABLED: 'gray',
};

function ApprovalTab() {
  const { templates, loading, error, refetch } = useWhatsAppTemplates();
  const { submitForReview, requestChanges, approve, reject, submitToProvider } = useTemplateApproval(refetch);
  useWhatsAppRealtime({ onTemplate: refetch });
  const [busyId, setBusyId] = useState<string | null>(null);

  const currentUser = useAuthStore((s) => s.user);
  // Mirrors requireRoleOrPermission(ROLE_MIN.APPROVE, PERMISSIONS.APPROVE_TEMPLATES)
  // on the real route -- if this is false, the button shouldn't render at
  // all, not just fail with a 403 after being clicked.
  const canApprove = hasRoleOrPermission(currentUser?.role, currentUser?.permissions, 'tenant_admin', 'approve_templates');
  // Request changes / Reject stayed pure role-gated on the backend (no
  // permission override was added for those two specifically), so this
  // check intentionally does NOT accept the permission -- matches
  // templateApproval.routes.js exactly.
  const canRequestChangesOrReject = atLeast(currentUser?.role, 'tenant_admin');

  // Mirrors validateApprover() in templateApproval.service.js exactly:
  // approving your OWN submission is blocked below Tenant Admin rank --
  // Admin and Owner are both exempt (matches how "Admin" works in most
  // real SaaS products: a fully trusted operator, not blocked by
  // internal-only red tape). Sales User/Read-only (or anyone with a
  // custom permission that doesn't reach Admin rank) still need someone
  // else to approve their own submissions.
  const isSelfSubmission = (t: WhatsAppTemplateReal) =>
    !!t.submittedBy && t.submittedBy === currentUser?.id && !atLeast(currentUser?.role, 'tenant_admin');

  const runAction = async (id: string, action: () => Promise<unknown>, successMsg: string, failMsg: string, parseError?: (raw: string) => { title: string; description: string }) => {
    setBusyId(id);
    try {
      await action();
      toast.success(successMsg);
    } catch (err) {
      const raw = err instanceof ApiError ? err.message : 'Please try again.';
      if (parseError && err instanceof ApiError) {
        const parsed = parseError(raw);
        toast.error(parsed.title, parsed.description);
      } else {
        toast.error(failMsg, raw);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmitForReview = (t: WhatsAppTemplateReal) =>
    runAction(t.id, () => submitForReview(t.id), 'Submitted for internal review', 'Could not submit for review');

  const handleApprove = (t: WhatsAppTemplateReal) =>
    runAction(t.id, () => approve(t.id), 'Template internally approved', 'Could not approve template');

  // Both "Request changes" and "Reject" need a required text comment --
  // promptTarget drives a single shared PromptDialog instead of a native
  // window.prompt(), so the required-field validation and styling match
  // the rest of the app instead of looking like a raw browser popup.
  const [promptTarget, setPromptTarget] = useState<{ template: WhatsAppTemplateReal; kind: 'requestChanges' | 'reject' } | null>(null);

  const submitPrompt = (comment: string) => {
    if (!promptTarget) return;
    const { template: t, kind } = promptTarget;
    if (kind === 'requestChanges') {
      void runAction(t.id, () => requestChanges(t.id, comment), 'Changes requested', 'Could not request changes');
    } else {
      void runAction(t.id, () => reject(t.id, comment), 'Template rejected', 'Could not reject template');
    }
  };

  const handleSubmitToProvider = (t: WhatsAppTemplateReal) =>
    runAction(t.id, () => submitToProvider(t.id), 'Submitted to provider', 'Could not submit to provider', parseTemplateSubmissionError);

  // A DRAFT template hasn't entered the approval pipeline yet -- there's
  // nothing here for anyone but its own creator to act on (they need to
  // submit it). Showing it to everyone else (including the owner) just
  // clutters the approval queue with things that were never actually
  // submitted, which is exactly what looked like "why is this here?".
  //
  // NOTE: this (and the useEffect right below it) must stay BEFORE the
  // loading/error early returns -- React requires every hook to run in
  // the same order on every render. Having the useEffect after a
  // conditional `return` meant it simply didn't run at all while
  // `loading` was true, then started running once data arrived -- a real
  // "rendered more hooks than the previous render" crash, not a fluke.
  const visibleTemplates = templates.filter((t) => t.approvalStatus !== 'DRAFT' || t.createdBy === currentUser?.id);

  // The user is now actually looking at these -- mark their own
  // rejected/sent-back-for-changes templates as seen, so the tab badge
  // (computed in the parent WhatsAppPanel) clears. Only fires for items
  // that genuinely belong to this user and are in one of those two
  // "needs your attention" states -- everything else is left alone.
  useEffect(() => {
    for (const t of visibleTemplates) {
      if (t.createdBy !== currentUser?.id) continue;
      const needsAttention = t.approvalStatus === 'REJECTED'
        || (t.approvalStatus === 'DRAFT' && t.transitionHistory?.some((h) => h.action === 'REQUEST_CHANGES'));
      if (needsAttention) markTemplateStatusSeen(currentUser?.id, t.id, t.approvalStatus);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTemplates, currentUser?.id]);

  if (loading && templates.length === 0) return <p className="p-8 text-center text-sm text-ink-400">Loading templates…</p>;
  if (error) return <Card className="p-4 text-sm text-red-600">{error}</Card>;

  return (
    <div>
      <Card>
        <CardHeader icon={TAB_ICONS.approval} title="Template Approval Workflow" subtitle="Internal review → Provider submission → Meta" />
      </Card>

      {visibleTemplates.length === 0 ? (
        <div className="mt-4">
          <EmptyState icon={<ShieldCheck size={22} />} title="Nothing here right now" description="Templates appear once someone submits them for review." />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleTemplates.map((t) => (
            <Card key={t.id} className="flex h-full flex-col p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink-900">{t.name} <span className="ml-1 text-xs font-normal text-ink-400">v{t.version}</span></p>
                  <p className="mt-0.5 text-sm text-ink-500">{t.category} · {t.languageCode}</p>
                </div>
                <Badge tone={APPROVAL_STATUS_TONE[t.approvalStatus] ?? 'gray'}>
                  {APPROVAL_STATUS_LABEL[t.approvalStatus] ?? t.approvalStatus}
                </Badge>
              </div>

              {t.approvalStatus === 'PROVIDER_REJECTED' && (t.providerRejectionReason || t.providerRejectionMessage) && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
                  Meta rejection{t.providerRejectionReason ? ` (${t.providerRejectionReason})` : ''}: {t.providerRejectionMessage || 'No message provided'}
                </p>
              )}
              {t.approvalComments && (() => {
                const lastAction = t.transitionHistory?.[t.transitionHistory.length - 1]?.action;
                const isRejection = lastAction === 'REJECT';
                const isChangesRequested = lastAction === 'REQUEST_CHANGES' || t.approvalStatus === 'DRAFT';
                const label = isRejection ? 'Rejection reason' : isChangesRequested ? 'Changes requested' : 'Comment';
                return (
                  <div className={cn(
                    'mt-3 rounded-xl border-l-4 px-3.5 py-2.5',
                    isRejection ? 'border-red-500 bg-red-50' : isChangesRequested ? 'border-amber-500 bg-amber-50' : 'border-ink-300 bg-ink-50',
                  )}>
                    <p className={cn(
                      'text-xs font-semibold uppercase tracking-wide',
                      isRejection ? 'text-red-700' : isChangesRequested ? 'text-amber-700' : 'text-ink-500',
                    )}>{label}</p>
                    <p className={cn('mt-0.5 text-sm', isRejection ? 'text-red-800' : isChangesRequested ? 'text-amber-900' : 'text-ink-700')}>{t.approvalComments}</p>
                  </div>
                );
              })()}

              {t.transitionHistory.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400">
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 font-medium text-ink-600">{t.transitionHistory[0].fromStatus ?? 'DRAFT'}</span>
                  {t.transitionHistory.map((h, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      <span>→</span>
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 font-medium text-ink-600" title={h.action}>{h.toStatus}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-ink-400">No transitions yet — still in Draft.</p>
              )}

              <div className="mt-auto flex flex-wrap gap-2 border-t border-ink-100 pt-4">
                {t.approvalStatus === 'DRAFT' && (
                  <Button className="px-3 py-1.5 text-xs" disabled={busyId === t.id} onClick={() => void handleSubmitForReview(t)}>
                    <Send size={13} /> Submit for Internal Review
                  </Button>
                )}
                {t.approvalStatus === 'SUBMITTED_FOR_INTERNAL_REVIEW' && (
                  <>
                    {canApprove && !isSelfSubmission(t) && (
                      <Button className="px-3 py-1.5 text-xs" disabled={busyId === t.id} onClick={() => void handleApprove(t)}>
                        <CheckCircle2 size={13} /> Approve internally
                      </Button>
                    )}
                    {canRequestChangesOrReject && (
                      <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={busyId === t.id} onClick={() => setPromptTarget({ template: t, kind: 'requestChanges' })}>
                        Request changes
                      </Button>
                    )}
                    {canRequestChangesOrReject && (
                      <Button variant="secondary" className="border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50" disabled={busyId === t.id} onClick={() => setPromptTarget({ template: t, kind: 'reject' })}>
                        <XCircle size={13} /> Reject
                      </Button>
                    )}
                    {canApprove && isSelfSubmission(t) && (
                      <p className="text-xs text-amber-600">You submitted this yourself — someone else needs to approve it (you can still request changes or reject).</p>
                    )}
                    {!canApprove && !canRequestChangesOrReject && (
                      <p className="text-xs text-ink-400">Awaiting approval from someone with template-approval rights.</p>
                    )}
                  </>
                )}
                {t.approvalStatus === 'INTERNALLY_APPROVED' && (
                  canApprove ? (
                    <Button className="px-3 py-1.5 text-xs" disabled={busyId === t.id} onClick={() => void handleSubmitToProvider(t)}>
                      <Send size={13} /> Submit to provider
                    </Button>
                  ) : (
                    <p className="text-xs text-ink-400">Approved internally — awaiting submission by someone with approval rights.</p>
                  )
                )}
                {t.approvalStatus === 'SUBMITTED_TO_PROVIDER' && (
                  <p className="text-xs text-ink-400">Awaiting Meta's review — this updates automatically via webhook.</p>
                )}
                {t.approvalStatus === 'PROVIDER_APPROVED' && (
                  <p className="text-xs text-emerald-600">Approved by Meta — usable for sending once activated in the Templates tab.</p>
                )}
                {(t.approvalStatus === 'REJECTED' || t.approvalStatus === 'DISABLED') && (
                  <p className="text-xs text-ink-400">This is a terminal state — duplicate the template to start over.</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <PromptDialog
        open={!!promptTarget}
        onClose={() => setPromptTarget(null)}
        title={promptTarget?.kind === 'reject' ? 'Reject template' : 'Request changes'}
        label={promptTarget?.kind === 'reject' ? 'Reason for rejection' : 'What changes are needed?'}
        placeholder={promptTarget?.kind === 'reject' ? 'e.g. Wording doesn\'t match brand voice' : 'e.g. Please shorten the body text'}
        confirmLabel={promptTarget?.kind === 'reject' ? 'Reject' : 'Request changes'}
        destructive={promptTarget?.kind === 'reject'}
        onConfirm={submitPrompt}
      />
    </div>
  );
}

// ---- Campaigns / Broadcasts (REAL: backed by /whatsapp/campaigns and
// /whatsapp/broadcasts -- two separate real backend resources with an
// identical lifecycle. See types/whatsappCampaign.ts for source notes.) -----
const CAMPAIGN_TYPE_OPTIONS = ['MARKETING', 'PROMOTIONAL', 'BOOKING', 'FOLLOW_UP', 'PAYMENT', 'REMINDER', 'NURTURE', 'BROADCAST', 'CUSTOM'];
const BROADCAST_TYPE_OPTIONS = ['MARKETING', 'PROMOTIONAL', 'ANNOUNCEMENT', 'OFFER', 'REMINDER', 'FESTIVAL', 'PRODUCT_UPDATE', 'CUSTOM'];

function CampaignsTab({ broadcast }: { broadcast: boolean }) {
  const resource: 'campaigns' | 'broadcasts' = broadcast ? 'broadcasts' : 'campaigns';
  const {
    campaigns, loading, error, refetch,
    createCampaign, updateCampaign, deleteCampaign,
    approveCampaign, scheduleCampaign, startCampaign,
    completeCampaign, cancelCampaign, failCampaign, previewAudience,
    applyRealtimeUpdate, resendFailed,
  } = useWhatsAppCampaigns(resource);
  const { templates } = useWhatsAppTemplates();
  const { format: formatMoney } = useTenantCurrency();
  const usableTemplates = templates.filter((t) => t.approvalStatus === USABLE_APPROVAL_STATUS);
  const { groups } = useGroups();

  const currentUser = useAuthStore((s) => s.user);
  // Mirrors requireRoleOrPermission(ROLE_MIN.APPROVE/START, PERMISSIONS.APPROVE_CAMPAIGNS)
  // on the real campaigns/broadcasts routes -- if false, Approve/Start
  // shouldn't render at all, not just 403 after being clicked.
  const canApproveOrSend = hasRoleOrPermission(currentUser?.role, currentUser?.permissions, 'tenant_admin', 'approve_campaigns');
  // Cancel stayed pure role-gated on the backend (no permission override
  // was added for it), so this intentionally does NOT accept the permission.
  const canCancel = atLeast(currentUser?.role, 'tenant_admin');

  // Live updates while a campaign/broadcast is actually sending -- fires on
  // every per-recipient send AND the final auto COMPLETED/FAILED
  // transition (see campaignSender.service.js). Merges the pushed
  // campaign/broadcast into local state directly rather than refetching
  // the whole list, so numbers tick up silently with no loading flash.
  useWhatsAppRealtime(
    broadcast
      ? { onBroadcast: (payload) => {
          // Detects a RUNNING -> FAILED flip that happens shortly after
          // Start (e.g. template/audience issue caught by campaignSender.service.js's
          // pre-flight check) -- previously this only showed up as a
          // silent status change in the list, easy to miss right after
          // the "Started" success toast.
          const prev = campaigns.find((c) => c.id === payload.broadcast.id);
          if (prev?.status === 'RUNNING' && payload.broadcast.status === 'FAILED') {
            toast.error(`"${payload.broadcast.name}" failed to send`, payload.broadcast.failureReason || 'Check the campaign for details.');
          }
          applyRealtimeUpdate(payload.broadcast);
        } }
      : { onCampaign: (payload) => {
          const prev = campaigns.find((c) => c.id === payload.campaign.id);
          if (prev?.status === 'RUNNING' && payload.campaign.status === 'FAILED') {
            toast.error(`"${payload.campaign.name}" failed to send`, payload.campaign.failureReason || 'Check the campaign for details.');
          }
          applyRealtimeUpdate(payload.campaign);
        } },
  );

  const [show, setShow] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Real "review before you send" step -- previously "Start now" fired
  // immediately with zero confirmation, the only bulk-send action in the
  // whole tab that had none (Delete and Disconnect both confirm).
  // Combined with a template preview here rather than two separate
  // features, since seeing exactly what's about to go out to N real
  // people IS the confirmation that actually matters.
  const [startTarget, setStartTarget] = useState<WhatsAppCampaignReal | null>(null);
  const [starting, setStarting] = useState(false);
  const [resendTarget, setResendTarget] = useState<WhatsAppCampaignReal | null>(null);
  const [resending, setResending] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'broadcast' | 'scheduled'>('all');
  const typeOptions = broadcast ? BROADCAST_TYPE_OPTIONS : CAMPAIGN_TYPE_OPTIONS;
  const { members } = useTeamMembers();

  type AudienceMode = 'group' | 'filters';
  const emptyFilters = {
    tags: [] as string[], source: '', minimumScore: '', maximumScore: '',
    consentStatus: '', optOutStatus: '', assignedUserId: '',
    createdAfter: '', createdBefore: '', lastContactedAfter: '', lastContactedBefore: '',
  };
  const [form, setForm] = useState({
    name: '', type: typeOptions[0], templateId: '', groupId: '',
    audienceMode: 'group' as AudienceMode,
    filters: emptyFilters,
  });
  const [tagInput, setTagInput] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewSample, setPreviewSample] = useState<AudiencePreviewContact[]>([]);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Mirrors LOCKED_STATUSES / READ_ONLY_STATUSES in campaigns.constants.js /
  // broadcasts.constants.js exactly -- the backend rejects update/delete
  // outside these, so the UI only offers the buttons when they'd succeed.
  const EDIT_LOCKED = ['SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED'];
  const DELETE_LOCKED = ['COMPLETED', 'CANCELLED', 'RUNNING', 'SCHEDULED'];

  // Audience is either a whole named Group, OR a set of raw contact filters
  // (tags, source, score range, consent, owner, date ranges) -- the backend's
  // buildAudienceQuery already supports all of these; this just exposes it.
  const buildAudience = () => {
    if (form.audienceMode === 'group') return { filters: { groupId: form.groupId } };
    const f = form.filters;
    const filters: Record<string, unknown> = {};
    if (f.tags.length) filters.tags = f.tags;
    if (f.source) filters.source = f.source;
    if (f.minimumScore !== '') filters.minimumScore = Number(f.minimumScore);
    if (f.maximumScore !== '') filters.maximumScore = Number(f.maximumScore);
    if (f.consentStatus) filters.consentStatus = f.consentStatus;
    if (f.optOutStatus) filters.optOutStatus = f.optOutStatus;
    if (f.assignedUserId) filters.assignedUserId = f.assignedUserId;
    if (f.createdAfter) filters.createdAfter = f.createdAfter;
    if (f.createdBefore) filters.createdBefore = f.createdBefore;
    if (f.lastContactedAfter) filters.lastContactedAfter = f.lastContactedAfter;
    if (f.lastContactedBefore) filters.lastContactedBefore = f.lastContactedBefore;
    return { filters };
  };
  const audienceIsEmpty = form.audienceMode === 'group'
    ? !form.groupId
    : Object.keys(buildAudience().filters).length === 0;

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const result = await previewAudience(buildAudience());
      setPreviewCount(result.recipientCount);
      setPreviewSample(result.sample);
      setPreviewTruncated(result.sampleTruncated);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to preview audience');
    } finally {
      setPreviewing(false);
    }
  };

  const resetForm = () => {
    setForm({ name: '', type: typeOptions[0], templateId: '', groupId: '', audienceMode: 'group', filters: emptyFilters });
    setTagInput('');
    setPreviewCount(null);
    setPreviewSample([]);
    setPreviewTruncated(false);
    setEditingId(null);
  };

  const startEdit = (c: WhatsAppCampaignReal) => {
    setEditingId(c.id);
    const f = (c.audience?.filters || {}) as Record<string, unknown>;
    const hasGroupId = typeof f.groupId === 'string' && f.groupId;
    setForm({
      name: c.name,
      type: c.type,
      templateId: c.templateId || '',
      groupId: hasGroupId ? (f.groupId as string) : '',
      audienceMode: hasGroupId ? 'group' : 'filters',
      filters: {
        tags: Array.isArray(f.tags) ? (f.tags as string[]) : [],
        source: typeof f.source === 'string' ? f.source : '',
        minimumScore: f.minimumScore !== undefined ? String(f.minimumScore) : '',
        maximumScore: f.maximumScore !== undefined ? String(f.maximumScore) : '',
        consentStatus: typeof f.consentStatus === 'string' ? f.consentStatus : '',
        optOutStatus: typeof f.optOutStatus === 'string' ? f.optOutStatus : '',
        assignedUserId: typeof f.assignedUserId === 'string' ? f.assignedUserId : '',
        createdAfter: typeof f.createdAfter === 'string' ? f.createdAfter : '',
        createdBefore: typeof f.createdBefore === 'string' ? f.createdBefore : '',
        lastContactedAfter: typeof f.lastContactedAfter === 'string' ? f.lastContactedAfter : '',
        lastContactedBefore: typeof f.lastContactedBefore === 'string' ? f.lastContactedBefore : '',
      },
    });
    setTagInput('');
    setPreviewCount(null);
    setPreviewSample([]);
    setPreviewTruncated(false);
    setShow(true);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || form.filters.tags.includes(t)) return;
    setForm({ ...form, filters: { ...form.filters, tags: [...form.filters.tags, t] } });
    setTagInput('');
  };
  const removeTag = (t: string) => setForm({ ...form, filters: { ...form.filters, tags: form.filters.tags.filter((x) => x !== t) } });

  const create = async () => {
    if (submitting) return; // guards against a double-click firing two creates
    if (!form.name.trim()) return toast.error('Name required');
    if (!form.templateId) return toast.error('An approved template is required');
    if (form.audienceMode === 'group' && !form.groupId) return toast.error('A target group is required, or switch to Custom filters');
    if (form.audienceMode === 'filters' && audienceIsEmpty) return toast.error('Add at least one filter, or switch to Target group');
    setSubmitting(true);
    try {
      if (editingId) {
        await updateCampaign(editingId, {
          name: form.name,
          type: form.type as CreateCampaignInput['type'],
          templateId: form.templateId,
          audience: buildAudience(),
        });
        toast.success(`${broadcast ? 'Broadcast' : 'Campaign'} updated`);
      } else {
        await createCampaign({
          name: form.name,
          type: form.type as CreateCampaignInput['type'],
          templateId: form.templateId,
          audience: buildAudience(),
        });
        toast.success(`${broadcast ? 'Broadcast' : 'Campaign'} created`);
      }
      setShow(false);
      resetForm();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${editingId ? 'update' : 'create'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (c: WhatsAppCampaignReal) => {
    if (!window.confirm(`Delete "${c.name}"? This cannot be undone.`)) return;
    setBusyId(c.id);
    try {
      await deleteCampaign(c.id);
      toast.success('Deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete');
    } finally {
      setBusyId(null);
    }
  };

  const runAction = async (id: string, action: () => Promise<unknown>, label: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(label);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${label.toLowerCase()}`);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="py-12 text-center text-sm text-ink-500">Loading {resource}…</div>;
  if (error) return <div className="py-12 text-center text-sm text-red-600">{error} <button className="underline" onClick={refetch}>Retry</button></div>;

  return (
    <div>
      <Card className="mb-4">
        <CardHeader
          icon={broadcast ? TAB_ICONS.broadcasts : TAB_ICONS.campaigns}
          title={broadcast ? 'Broadcasts' : 'Campaigns'}
          subtitle={broadcast ? 'Broadcast-flagged campaigns — opted-out contacts are always excluded.' : 'Audience filter + approved template, with approve/schedule/send.'}
          action={<Button onClick={() => { resetForm(); setShow(true); }}><Plus size={16} /> New {broadcast ? 'Broadcast' : 'Campaign'}</Button>}
        />
      </Card>
      {(() => {
        const filteredCampaigns = campaigns.filter((c) => {
          if (filterTab === 'broadcast') return c.type === 'BROADCAST';
          if (filterTab === 'scheduled') return c.status === 'SCHEDULED';
          return true;
        });
        const TAB_DEFS: { id: typeof filterTab; label: string; count: number }[] = [
          { id: 'all', label: 'All', count: campaigns.length },
          { id: 'broadcast', label: 'Broadcast', count: campaigns.filter((c) => c.type === 'BROADCAST').length },
          { id: 'scheduled', label: 'Scheduled', count: campaigns.filter((c) => c.status === 'SCHEDULED').length },
        ];
        return (
          <>
            <div className="mb-3 flex gap-1 border-b border-ink-100">
              {TAB_DEFS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setFilterTab(t.id)}
                  className={cn(
                    'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    filterTab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-700',
                  )}
                >
                  {t.label} <span className="ml-1 text-xs text-ink-400">{t.count}</span>
                </button>
              ))}
            </div>
            {filteredCampaigns.length === 0 ? (
              <EmptyState title={`No ${filterTab === 'all' ? (broadcast ? 'broadcasts' : 'campaigns') : filterTab} yet`} action={<Button onClick={() => { resetForm(); setShow(true); }}><Plus size={16} /> Create</Button>} />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {filteredCampaigns.map((c) => {
            const m = c.metrics;
            const isBusy = busyId === c.id;
            // Left accent color follows the same status→tone mapping
            // StatusBadge already uses, so a card's accent and its badge
            // never disagree about what a status "means" visually.
            const ACCENT_BY_STATUS: Record<string, string> = {
              COMPLETED: 'border-l-emerald-500', RUNNING: 'border-l-blue-500',
              SCHEDULED: 'border-l-amber-500', FAILED: 'border-l-red-500', CANCELLED: 'border-l-red-500',
              APPROVED: 'border-l-blue-400', DRAFT: 'border-l-ink-200',
            };
            const accent = ACCENT_BY_STATUS[c.status] || 'border-l-ink-200';
            const deliveryPct = c.recipientCount > 0 ? Math.round((m.deliveredCount / c.recipientCount) * 100) : 0;
            return (
              <Card key={c.id} className={cn('border-l-4 p-4', accent)}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink-900">{c.name}</p>
                      {c.type === 'BROADCAST' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                          <Radio size={11} /> Broadcast
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-500">{c.type !== 'BROADCAST' && `${c.type} · `}{c.recipientCount} recipients · {c.templateName || 'no template'}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                {c.recipientCount > 0 && (
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${deliveryPct}%` }} />
                  </div>
                )}
                {(() => {
                  const funnelSteps: [string, number, React.ComponentType<{ size?: number; className?: string }>, string][] = [
                    ['Sent', m.sentCount, Send, 'bg-ink-300'],
                    ['Delivered', m.deliveredCount, CheckCircle2, 'bg-ink-400'],
                    ['Read', m.readCount, Eye, 'bg-brand-400'],
                    ['Replied', m.repliedCount, MessageSquare, 'bg-emerald-500'],
                  ];
                  const maxVal = Math.max(1, ...funnelSteps.map(([, v]) => v as number));
                  return (
                    <div className="mt-3 flex items-end gap-3">
                      {funnelSteps.map(([label, value, Icon, barColor]) => (
                        <div key={label as string} className="flex-1 text-center">
                          <p className="text-lg font-bold text-ink-900">{value as number}</p>
                          <div className="mx-auto mt-1 h-10 w-full max-w-[36px] overflow-hidden rounded-t bg-ink-50">
                            <div
                              className={cn('w-full rounded-t transition-all', barColor as string)}
                              style={{ height: `${Math.max(6, ((value as number) / maxVal) * 100)}%`, marginTop: `${100 - Math.max(6, ((value as number) / maxVal) * 100)}%` }}
                            />
                          </div>
                          <p className="mt-1 flex items-center justify-center gap-1 text-[10px] text-ink-500">
                            {(() => { const IconComp = Icon; return <IconComp size={10} />; })()} {label as string}
                          </p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {/* Bookings/Payments/Revenue removed -- these fields exist on
                    the Campaign schema but nothing in the backend ever
                    increments them from a real booking or payment, so they
                    would always silently read 0. Real per-campaign revenue
                    attribution is a genuine feature to build (likely via
                    the existing Attribution module) -- showing a fake
                    always-zero number was worse than showing nothing. */}
                {c.status === 'RUNNING' && (() => {
                  // Real live progress -- reads the exact same metrics
                  // the BullMQ worker updates atomically per-recipient
                  // and pushes via socket (already wired end-to-end via
                  // useWhatsAppRealtime/applyRealtimeUpdate above), not
                  // a client-side estimate or polling loop.
                  const processed = m.sentCount + m.failedCount + (m.skippedCount || 0);
                  const total = c.recipientCount || m.recipientCount || 0;
                  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
                  return (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-ink-500">
                        <span className="flex items-center gap-1.5">
                          <RefreshCw size={11} className="animate-spin text-brand-500" />
                          Sending… {processed.toLocaleString()} / {total.toLocaleString()}
                        </span>
                        <span className="font-semibold text-ink-700">{pct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })()}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.status === 'DRAFT' && canApproveOrSend && <Button disabled={isBusy} className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => approveCampaign(c.id), 'Approved')}>Approve</Button>}
                  {c.status === 'DRAFT' && canCancel && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => cancelCampaign(c.id), 'Cancelled')}>Cancel</Button>}
                  {c.status === 'DRAFT' && !canApproveOrSend && <p className="text-xs text-ink-400">Awaiting approval from someone with campaign-sending rights.</p>}
                  {c.status === 'APPROVED' && canApproveOrSend && <Button disabled={isBusy} className="px-3 py-1 text-xs" onClick={() => setStartTarget(c)}><Send size={12} /> Start now</Button>}
                  {c.status === 'APPROVED' && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => {
                    const dt = window.prompt('Schedule for (ISO date/time, e.g. 2026-08-05T10:00:00)');
                    if (dt) runAction(c.id, () => scheduleCampaign(c.id, new Date(dt).toISOString()), 'Scheduled');
                  }}>Schedule</Button>}
                  {c.status === 'SCHEDULED' && canApproveOrSend && <Button disabled={isBusy} className="px-3 py-1 text-xs" onClick={() => setStartTarget(c)}><Send size={12} /> Start now</Button>}
                  {c.status === 'SCHEDULED' && canCancel && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => cancelCampaign(c.id), 'Cancelled')}>Cancel</Button>}
                  {c.status === 'RUNNING' && canApproveOrSend && <Button disabled={isBusy} className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => completeCampaign(c.id), 'Completed')}>Mark completed</Button>}
                  {c.status === 'RUNNING' && canApproveOrSend && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => failCampaign(c.id, 'Manually marked as failed'), 'Marked failed')}>Mark failed</Button>}
                  {c.status === 'RUNNING' && canCancel && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => cancelCampaign(c.id), 'Cancelled')}>Cancel</Button>}
                  {c.status === 'FAILED' && canCancel && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => cancelCampaign(c.id), 'Cancelled')}>Cancel</Button>}
                  {/* AiSensy's "Failed Retries" manual mode -- only shown
                      once there's actually something to retry. */}
                  {['COMPLETED', 'FAILED'].includes(c.status) && m.failedCount > 0 && canApproveOrSend && (
                    <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => setResendTarget(c)}>
                      <RefreshCw size={12} /> Resend failed ({m.failedCount})
                    </Button>
                  )}
                  {!EDIT_LOCKED.includes(c.status) && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => startEdit(c)}>Edit</Button>}
                  {!DELETE_LOCKED.includes(c.status) && (
                    <button
                      disabled={isBusy}
                      className="ml-auto rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="Delete"
                      onClick={() => remove(c)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </Card>
            );
                })}
              </div>
            )}
          </>
        );
      })()}
      {/* Start confirmation + template preview -- the actual "review
          before you send" step. Previously "Start now" fired immediately
          with zero confirmation, the only bulk-send action in this tab
          that had none. */}
      {startTarget && (() => {
        const tpl = templates.find((t) => t.id === startTarget.templateId);
        return (
          <Modal
            open onClose={() => setStartTarget(null)} title={`Send "${startTarget.name}"?`} size="md"
            footer={<>
              <Button variant="secondary" onClick={() => setStartTarget(null)} disabled={starting}>Cancel</Button>
              <Button
                disabled={starting}
                onClick={async () => {
                  setStarting(true);
                  try {
                    await startCampaign(startTarget.id);
                    toast.success('Started');
                    setStartTarget(null);
                  } catch (err) {
                    toast.error('Could not start', err instanceof ApiError ? err.message : 'Please try again.');
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                {starting ? 'Starting…' : `Send to ${startTarget.recipientCount} recipient${startTarget.recipientCount === 1 ? '' : 's'}`}
              </Button>
            </>}
          >
            <div className="space-y-4">
              <div className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
                This will send a real WhatsApp message to <strong>{startTarget.recipientCount}</strong> {startTarget.recipientCount === 1 ? 'person' : 'people'} using the template below. This can't be undone once it starts.
              </div>
              {tpl ? (
                <TemplatePreview
                  headerType={tpl.header?.type ?? 'NONE'}
                  headerText={tpl.header?.text}
                  headerMediaUrl={tpl.header?.mediaUrl}
                  body={tpl.body}
                  footer={tpl.footer}
                  buttons={tpl.buttons}
                  category={tpl.category}
                />
              ) : (
                <p className="text-sm text-ink-400">Template preview unavailable.</p>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* Resend-failed confirmation -- creates a NEW campaign for just
          the failed leads (see BACKEND campaigns.service.js's
          resendFailed), still needs its own separate Start afterward. */}
      {resendTarget && (
        <Modal
          open onClose={() => setResendTarget(null)} title="Create retry campaign?" size="sm"
          footer={<>
            <Button variant="secondary" onClick={() => setResendTarget(null)} disabled={resending}>Cancel</Button>
            <Button
              disabled={resending}
              onClick={async () => {
                setResending(true);
                try {
                  await resendFailed(resendTarget.id);
                  toast.success('Retry campaign created', 'Review it in the list, then Start it when ready -- it does not send automatically.');
                  setResendTarget(null);
                } catch (err) {
                  toast.error('Could not create retry campaign', err instanceof ApiError ? err.message : 'Please try again.');
                } finally {
                  setResending(false);
                }
              }}
            >
              {resending ? 'Creating…' : `Create for ${resendTarget.metrics.failedCount} failed recipient${resendTarget.metrics.failedCount === 1 ? '' : 's'}`}
            </Button>
          </>}
        >
          <p className="text-sm text-ink-600">
            This creates a new campaign, <strong>"{resendTarget.name} (Retry)"</strong>, targeting only the {resendTarget.metrics.failedCount} recipient{resendTarget.metrics.failedCount === 1 ? '' : 's'} whose message failed last time, using the same template. The original campaign's numbers stay unchanged. The new campaign won't send automatically -- you'll still need to Start it, same as any other campaign.
          </p>
        </Modal>
      )}

      {show && (
        <Modal open onClose={() => { setShow(false); resetForm(); }} title={editingId ? `Edit ${broadcast ? 'Broadcast' : 'Campaign'}` : `New WhatsApp ${broadcast ? 'Broadcast' : 'Campaign'}`}
          footer={<><Button variant="secondary" onClick={() => { setShow(false); resetForm(); }} disabled={submitting}>Cancel</Button><Button onClick={create} disabled={submitting}>{submitting ? (editingId ? 'Saving…' : 'Creating…') : (editingId ? 'Save changes' : 'Create')}</Button></>}>
          <div className="space-y-4">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
            <Field label="Approved template" hint={usableTemplates.length === 0 ? 'No provider-approved templates yet — approve one first.' : undefined}>
              <Select value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
                <option value="">Select a template…</option>
                {usableTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            {/* Live preview of the selected template -- previously this
                dropdown showed only a name, no way to confirm what
                message an audience is actually about to receive before
                creating the campaign. */}
            {form.templateId && (() => {
              const tpl = usableTemplates.find((t) => t.id === form.templateId);
              return tpl ? (
                <TemplatePreview
                  headerType={tpl.header?.type ?? 'NONE'}
                  headerText={tpl.header?.text}
                  headerMediaUrl={tpl.header?.mediaUrl}
                  body={tpl.body}
                  footer={tpl.footer}
                  buttons={tpl.buttons}
                  category={tpl.category}
                />
              ) : null;
            })()}
            <Field label="Audience">
              <div className="mb-2 flex gap-1.5 rounded-lg bg-ink-100 p-1 text-xs">
                <button type="button" onClick={() => setForm({ ...form, audienceMode: 'group' })} className={cn('flex-1 rounded-md py-1.5 font-medium transition', form.audienceMode === 'group' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500')}>Target group</button>
                <button type="button" onClick={() => setForm({ ...form, audienceMode: 'filters' })} className={cn('flex-1 rounded-md py-1.5 font-medium transition', form.audienceMode === 'filters' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500')}>Custom filters</button>
              </div>

              {form.audienceMode === 'group' ? (
                <>
                  <Select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                    <option value="">Select a group…</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.memberCount})</option>)}
                  </Select>
                  {groups.length === 0 && <p className="mt-1 text-xs text-ink-400">No groups yet — create one in Contacts / Leads first.</p>}
                </>
              ) : (
                <div className="space-y-3 rounded-xl border border-ink-100 p-3">
                  <div>
                    <p className="mb-1 text-xs font-medium text-ink-600">Tags</p>
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {form.filters.tags.map((t) => (
                        <button key={t} type="button" onClick={() => removeTag(t)} title="Remove tag"><Badge tone="teal">{t} ×</Badge></button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} placeholder="Add a tag and press Enter…" className="input flex-1 py-1.5 text-xs" />
                      <button type="button" onClick={addTag} disabled={!tagInput.trim()} className="rounded-lg border border-ink-200 p-2 text-ink-500 hover:bg-ink-50 disabled:opacity-40"><Plus size={14} /></button>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-400">Only contacts with ALL of these tags will match.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-600">Source</p>
                      <Select value={form.filters.source} onChange={(e) => setForm({ ...form, filters: { ...form.filters, source: e.target.value } })} className="py-1.5 text-xs">
                        <option value="">Any source</option>
                        {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
                      </Select>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-600">Owner</p>
                      <Select value={form.filters.assignedUserId} onChange={(e) => setForm({ ...form, filters: { ...form.filters, assignedUserId: e.target.value } })} className="py-1.5 text-xs">
                        <option value="">Any owner</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                      </Select>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-600">Consent status</p>
                      <Select value={form.filters.consentStatus} onChange={(e) => setForm({ ...form, filters: { ...form.filters, consentStatus: e.target.value } })} className="py-1.5 text-xs">
                        <option value="">Any</option>
                        {CONSENT_STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-600">Opt-out status</p>
                      <Select value={form.filters.optOutStatus} onChange={(e) => setForm({ ...form, filters: { ...form.filters, optOutStatus: e.target.value } })} className="py-1.5 text-xs">
                        <option value="">Any</option>
                        <option value="OPTED_IN">Reachable (not opted out)</option>
                        <option value="OPTED_OUT">Opted out</option>
                      </Select>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-600">Min. score</p>
                      <Input type="number" min={0} max={100} value={form.filters.minimumScore} onChange={(e) => setForm({ ...form, filters: { ...form.filters, minimumScore: e.target.value } })} className="py-1.5 text-xs" />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-600">Max. score</p>
                      <Input type="number" min={0} max={100} value={form.filters.maximumScore} onChange={(e) => setForm({ ...form, filters: { ...form.filters, maximumScore: e.target.value } })} className="py-1.5 text-xs" />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-600">Created after</p>
                      <Input type="date" value={form.filters.createdAfter} onChange={(e) => setForm({ ...form, filters: { ...form.filters, createdAfter: e.target.value } })} className="py-1.5 text-xs" />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-600">Created before</p>
                      <Input type="date" value={form.filters.createdBefore} onChange={(e) => setForm({ ...form, filters: { ...form.filters, createdBefore: e.target.value } })} className="py-1.5 text-xs" />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-600">Last contacted after</p>
                      <Input type="date" value={form.filters.lastContactedAfter} onChange={(e) => setForm({ ...form, filters: { ...form.filters, lastContactedAfter: e.target.value } })} className="py-1.5 text-xs" />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-600">Last contacted before</p>
                      <Input type="date" value={form.filters.lastContactedBefore} onChange={(e) => setForm({ ...form, filters: { ...form.filters, lastContactedBefore: e.target.value } })} className="py-1.5 text-xs" />
                    </div>
                  </div>
                  <p className="text-[11px] text-ink-400">Opted-out contacts are always excluded, on top of these filters.</p>
                </div>
              )}
            </Field>
            <div className="flex items-center gap-3">
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={runPreview} disabled={previewing || audienceIsEmpty}>{previewing ? 'Checking…' : 'Preview audience'}</Button>
              {previewCount !== null && <p className="text-xs text-ink-600">{previewCount} matching contact{previewCount === 1 ? '' : 's'} (opted-out contacts already excluded)</p>}
            </div>
            {previewCount !== null && (
              previewSample.length === 0 ? (
                <p className="text-xs text-ink-400">No contacts match these filters yet.</p>
              ) : (
                <div className="max-h-52 overflow-y-auto rounded-lg border border-ink-100">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-ink-50 text-ink-500">
                      <tr>
                        <th className="px-2.5 py-1.5 text-left font-medium">Name</th>
                        <th className="px-2.5 py-1.5 text-left font-medium">Phone</th>
                        <th className="px-2.5 py-1.5 text-left font-medium">Source</th>
                        <th className="px-2.5 py-1.5 text-right font-medium">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-50">
                      {previewSample.map((c) => (
                        <tr key={c.id}>
                          <td className="px-2.5 py-1.5 font-medium text-ink-800">{c.name || '—'}</td>
                          <td className="px-2.5 py-1.5 text-ink-600">{c.phone || '—'}</td>
                          <td className="px-2.5 py-1.5 text-ink-600">{c.source || '—'}</td>
                          <td className="px-2.5 py-1.5 text-right text-ink-600">{c.qualificationScore ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {previewTruncated && (
                    <p className="border-t border-ink-100 px-2.5 py-1.5 text-[11px] text-ink-400">
                      Showing first {previewSample.length} of {previewCount} — the rest will still receive the message.
                    </p>
                  )}
                </div>
              )
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---- Nurture messages ------------------------------------------------------
/**
 * NurtureMessagesTab -- real, backend-connected. Replaces a mock version
 * that read fake `db.nurtureSequences` from the in-memory dev store.
 *
 * Deliberately READ-ONLY here (view sequences' WhatsApp steps + active
 * enrollment counts, with a link to the full editor) rather than a second
 * full create/edit UI -- the real CRUD for sequences already lives on the
 * separate /nurture page (useNurtureSequences/useNurtureEnrollments,
 * genuinely wired). Building a second, separate editor for the exact same
 * backend data here would create two out-of-sync places to manage the
 * same sequences, which is worse than just linking to the one that exists.
 */
function NurtureMessagesTab() {
  const navigate = useNavigate();
  const { sequences, loading, error } = useNurtureSequences();
  const { enrollments, loading: enrollLoading } = useNurtureEnrollments({ status: 'ACTIVE' });

  const waSteps = sequences.flatMap((s) =>
    s.steps
      .filter((st) => st.channel === 'WHATSAPP')
      .map((st) => ({ seqId: s.id, seqName: s.name, seqStatus: s.status, ...st })),
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={TAB_ICONS.nurture} title="WhatsApp Nurture Messages" subtitle="WhatsApp steps across all sequences." />
        <div className="flex flex-wrap items-center gap-4 px-5 pb-4 text-sm">
          <span className="text-ink-500">
            {enrollLoading ? 'Loading…' : <><span className="font-semibold text-ink-800">{enrollments.length}</span> active enrollment{enrollments.length === 1 ? '' : 's'} right now</>}
          </span>
          <Button variant="secondary" className="ml-auto px-3 py-1.5 text-xs" onClick={() => navigate('/nurture')}>
            Manage sequences <ChevronRight size={13} />
          </Button>
        </div>
      </Card>

      {error ? (
        <EmptyState title="Couldn't load nurture sequences" description={error} />
      ) : loading ? (
        <p className="p-8 text-center text-sm text-ink-400">Loading…</p>
      ) : waSteps.length === 0 ? (
        <EmptyState icon={TAB_ICONS.nurture} title="No WhatsApp nurture steps yet" description="Create a sequence with a WhatsApp step from the full Nurture page." />
      ) : (
        <Card>
          <Table>
            <thead><tr><Th>Sequence</Th><Th>Status</Th><Th>Step</Th><Th>Delay</Th><Th>Template</Th></tr></thead>
            <tbody>
              {waSteps.map((s, i) => (
                <Tr key={i}>
                  <Td className="font-medium">{s.seqName}</Td>
                  <Td><Badge tone={statusTone(s.seqStatus)}>{s.seqStatus}</Badge></Td>
                  <Td>Step {s.stepNumber}</Td>
                  <Td>{s.delayValue} {s.delayUnit.toLowerCase()}</Td>
                  <Td className="max-w-md truncate text-ink-600">{s.templateName || <span className="text-ink-400">No template selected</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ---- AI assistant ----------------------------------------------------------
// ---- Business Profile: real "memory" the AI reads before every generation --
function BusinessProfileCard({ profile, loading, updateProfile }: Pick<UseTenantProfileResult, 'profile' | 'loading' | 'updateProfile'>) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ description: '', businessType: 'other' as BusinessType, industry: '' });
  const [saving, setSaving] = useState(false);

  const openEdit = () => {
    if (profile) setForm({ description: profile.description, businessType: profile.businessType, industry: profile.industry });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success('Business profile saved', 'AI replies will now use this context.');
      setEditing(false);
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;
  const hasContext = !!profile?.description;

  return (
    <>
      <div className={cn(
        'mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5',
        hasContext ? 'border-ink-200 bg-white' : 'border-amber-200 bg-amber-50',
      )}>
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles size={14} className={hasContext ? 'shrink-0 text-brand-600' : 'shrink-0 text-amber-600'} />
          {hasContext ? (
            <p className="truncate text-xs text-ink-600"><span className="font-medium text-ink-900">AI memory set</span> — {profile?.description}</p>
          ) : (
            <p className="truncate text-xs text-amber-800">
              <span className="font-medium">No business context yet</span> — without it, the AI may guess or invent details about {profile?.name || 'your business'}.
            </p>
          )}
        </div>
        <Button variant="secondary" className="shrink-0 px-3 py-1 text-xs" onClick={openEdit}>{hasContext ? 'Edit' : 'Add business info'}</Button>
      </div>

      {editing && (
        <Modal
          open onClose={() => setEditing(false)} title="Business context (AI memory)" size="sm"
          footer={<><Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
        >
          <div className="space-y-3">
            <p className="text-xs text-ink-500">
              Tell the AI about {profile?.name || 'your business'} once — every generated reply uses this instead of generic or guessed wording.
            </p>
            <Field label="What does your business do?" hint="e.g. 'We sell fresh, farm-direct produce to households and restaurants.' Up to 500 characters.">
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                maxLength={500}
                className="input"
                placeholder="Describe your business in a sentence or two…"
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Business type">
                <Select value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value as BusinessType })}>
                  {BUSINESS_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label="Industry (optional)"><Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="e.g. Agriculture" /></Field>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function AIAssistantTab() {
  const [input, setInput] = useState('Hi, I saw your webinar and I\'m interested but pricing is a concern.');
  const [output, setOutput] = useState('');
  const [isLive, setIsLive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<{ type: 'generate'; goal: ReplyGoal } | { type: 'rewrite'; style: RewriteStyle } | null>(null);
  const tenantProfile = useTenantProfile();
  const { profile } = tenantProfile;
  const actions = [
    { label: 'Generate reply', goal: '' as const },
    { label: 'Booking message', goal: 'booking' as const },
    { label: 'Payment reminder', goal: 'payment' as const },
    { label: 'Objection handling', goal: 'objection' as const },
    { label: 'Follow-up after call', goal: 'follow_up' as const },
  ];

  const generate = async (goal: ReplyGoal, label: string) => {
    setBusy(label);
    try {
      const result = await aiReplyAssistantApi.generate({
        goal,
        conversation: input.trim() ? [{ direction: 'INBOUND', content: input.trim() }] : [],
      });
      setOutput(result.generatedReply);
      setIsLive(result.isLive);
      setLastAction({ type: 'generate', goal });
    } catch (err) {
      toast.error('Could not generate reply', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const rewrite = async (style: RewriteStyle, label: string) => {
    if (!output) return;
    setBusy(label);
    try {
      const result = await aiReplyAssistantApi.rewrite(output, style);
      setOutput(result.rewritten);
      setIsLive(result.isLive);
      setLastAction({ type: 'rewrite', style });
    } catch (err) {
      toast.error('Could not rewrite reply', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const regenerate = () => {
    if (!lastAction) return;
    if (lastAction.type === 'generate') void generate(lastAction.goal, 'regenerate');
    else void rewrite(lastAction.style, 'regenerate');
  };

  const wordCount = output.trim() ? output.trim().split(/\s+/).length : 0;
  const isGenerating = busy === 'Generate reply' || busy === 'regenerate' || actions.some((a) => a.label === busy);

  return (
    <div>
      <BusinessProfileCard profile={tenantProfile.profile} loading={tenantProfile.loading} updateProfile={tenantProfile.updateProfile} />
      <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900"><Sparkles size={16} className="text-brand-600" /> AI Reply Assistant</h3>
        <p className="mt-1 text-xs text-ink-500">Paste an inbound message and generate context-aware replies.</p>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={4} className="input mt-3" />
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a.label} variant="secondary" className="px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => void generate(a.goal, a.label)}>
              {busy === a.label ? 'Thinking…' : a.label}
            </Button>
          ))}
        </div>
        {output && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
            <span className="text-xs font-medium text-ink-400">Rewrite:</span>
            <Button variant="ghost" className="px-2.5 py-1 text-xs" disabled={!!busy} onClick={() => void rewrite('SHORTER', 'shorter')}>Make shorter</Button>
            <Button variant="ghost" className="px-2.5 py-1 text-xs" disabled={!!busy} onClick={() => void rewrite('PROFESSIONAL', 'professional')}>Professional</Button>
            <Button variant="ghost" className="px-2.5 py-1 text-xs" disabled={!!busy} onClick={() => void rewrite('PERSUASIVE', 'persuasive')}>Persuasive</Button>
          </div>
        )}
      </Card>
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-900">Generated reply</h3>
          <div className="flex items-center gap-1.5">
            {output && profile?.description && (
              <span title={`Used your saved business context: "${profile.description}"`}>
                <Sparkles size={13} className="text-brand-500" />
              </span>
            )}
            {output && isLive !== null && (
              <Badge tone={isLive ? 'green' : 'amber'}>{isLive ? 'Live AI' : 'Fallback (no AI key / call failed)'}</Badge>
            )}
          </div>
        </div>
        {busy && !output.trim() ? (
          <div className="mt-3 flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-200 text-ink-400">
            <Sparkles size={20} className="animate-pulse text-brand-500" />
            <p className="text-xs">Writing a reply…</p>
          </div>
        ) : output ? (
          <>
            <div className={cn('mt-3 rounded-xl rounded-tl-sm bg-brand-50 p-4 text-sm leading-relaxed text-ink-800 whitespace-pre-line transition-opacity', isGenerating || busy ? 'opacity-50' : 'opacity-100')}>{output}</div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-ink-400">{wordCount} word{wordCount === 1 ? '' : 's'}</span>
              <div className="flex gap-2">
                <Button variant="secondary" className="text-xs" disabled={!!busy} onClick={regenerate}>
                  <RefreshCw size={13} className={busy === 'regenerate' ? 'animate-spin' : ''} /> Regenerate
                </Button>
                <Button className="text-xs" onClick={() => { navigator.clipboard?.writeText(output); toast.success('Copied to clipboard'); }}><Copy size={13} /> Copy reply</Button>
              </div>
            </div>
          </>
        ) : <EmptyState title="No reply generated yet" description="Choose an action on the left to generate an AI reply." icon={<Sparkles size={20} />} />}
      </Card>
    </div>
    </div>
  );
}

// ---- Rules -----------------------------------------------------------------
// ---- Automation Rules -------------------------------------------------------
/**
 * RulesTab -- real, backend-connected. Replaces a mock version that read
 * fake `db.automations` from the in-memory dev store (toggling did nothing
 * real, nothing persisted). The actual backend (automationRules.service.js)
 * is a genuine trigger -> conditions -> ordered-actions rule engine with
 * execution history -- this UI is a 1:1 surface for it, not a simplification:
 * conditions really are a flat AND/OR list (no nested groups in the schema),
 * and actions really are an ordered list (no branching), so this is not a
 * simplified stand-in for a graph/canvas flow builder -- it faithfully
 * represents what the engine supports today.
 */
const TRIGGER_LABELS: Record<TriggerType, string> = {
  LEAD_CREATED: 'Lead created', LEAD_UPDATED: 'Lead updated', LEAD_QUALIFIED: 'Lead qualified',
  PIPELINE_STAGE_CHANGED: 'Pipeline stage changed', MESSAGE_RECEIVED: 'Message received',
  MESSAGE_SENT: 'Message sent', BOOKING_CREATED: 'Booking created', BOOKING_CONFIRMED: 'Booking confirmed',
  PAYMENT_PENDING: 'Payment pending', PAYMENT_RECEIVED: 'Payment received',
  CAMPAIGN_COMPLETED: 'Campaign completed', CAMPAIGN_FAILED: 'Campaign failed', NO_REPLY: 'No reply',
  TAG_ADDED: 'Tag added', TAG_REMOVED: 'Tag removed', CONTACT_CREATED: 'Contact created',
  CONTACT_UPDATED: 'Contact updated', CUSTOM_EVENT: 'Custom event',
};
const ACTION_LABELS: Record<ActionType, string> = {
  SEND_TEMPLATE: 'Send template', START_NURTURE: 'Start nurture', STOP_NURTURE: 'Stop nurture',
  SEND_BROADCAST: 'Send broadcast', GENERATE_AI_REPLY: 'Generate AI reply', ASSIGN_USER: 'Assign user',
  CHANGE_PIPELINE_STAGE: 'Change pipeline stage', ADD_TAG: 'Add tag', REMOVE_TAG: 'Remove tag',
  CREATE_TASK: 'Create task', CREATE_NOTE: 'Create note', NOTIFY_USER: 'Notify user',
  SEND_EMAIL: 'Send email', CALL_WEBHOOK: 'Call webhook', WAIT: 'Wait', END_WORKFLOW: 'End workflow',
};
const RULE_STATUS_TONE: Record<RuleStatus, 'gray' | 'green' | 'amber' | 'red'> = {
  DRAFT: 'gray', ACTIVE: 'green', PAUSED: 'amber', DISABLED: 'gray', ARCHIVED: 'red',
};

function RulesTab() {
  const [statusFilter, setStatusFilter] = useState<RuleStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { rules, loading, error, createRule, updateRule, deleteRule, duplicateRule, toggleRule, refetch } = useAutomationRules({
    status: statusFilter === 'all' ? undefined : statusFilter,
    search: debouncedSearch.trim() || undefined,
    active: true,
    limit: 50,
  });

  const [formOpen, setFormOpen] = useState<{ mode: 'create' | 'edit'; rule?: AutomationRule } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ rule: AutomationRule; result: RunRuleResult } | null>(null);

  const handleToggle = async (rule: AutomationRule) => {
    setBusyId(rule.id);
    try {
      await toggleRule(rule.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not toggle rule');
    } finally {
      setBusyId(null);
    }
  };

  const handleDuplicate = async (rule: AutomationRule) => {
    setBusyId(rule.id);
    try {
      await duplicateRule(rule.id);
      toast.success(`Duplicated "${rule.name}"`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not duplicate rule');
    } finally {
      setBusyId(null);
    }
  };

  const handleRun = async (rule: AutomationRule) => {
    setBusyId(rule.id);
    try {
      const result = await automationRulesApi.run(rule.id, {});
      setRunResult({ rule, result });
      refetch(); // executionCount/lastExecutedAt changed server-side
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not run rule');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { id, name } = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteRule(id);
      toast.success(`"${name}" deleted`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete rule');
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={TAB_ICONS.rules} title="WhatsApp Automation Rules" subtitle="Trigger-based actions -- runs automatically, or manually with 'Run now'." />
        <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
          <IconInput icon={<Search size={14} />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules…" className="max-w-xs" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as RuleStatus | 'all')} className="w-40">
            <option value="all">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="DISABLED">Disabled</option>
          </Select>
          <Button className="ml-auto px-3 py-1.5 text-xs" onClick={() => setFormOpen({ mode: 'create' })}>
            <Plus size={14} /> New rule
          </Button>
        </div>
      </Card>

      {error ? (
        <EmptyState title="Couldn't load automation rules" description={error} />
      ) : loading && rules.length === 0 ? (
        <p className="p-8 text-center text-sm text-ink-400">Loading rules…</p>
      ) : rules.length === 0 ? (
        <EmptyState icon={TAB_ICONS.rules} title="No automation rules yet" description="Create a rule to trigger actions automatically on events like a new lead or a received message." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rules.map((r) => (
            <Card key={r.id} className="flex h-full flex-col p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-900">{r.name}</p>
                  {r.description && <p className="mt-0.5 text-sm text-ink-500">{r.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={RULE_STATUS_TONE[r.status]}>{r.status}</Badge>
                  <Toggle checked={r.status === 'ACTIVE'} onChange={() => { if (busyId !== r.id && r.status !== 'ARCHIVED') void handleToggle(r); }} />
                </div>
              </div>

              <p className="mt-3 text-sm text-ink-600">
                When <span className="font-medium text-ink-800">{TRIGGER_LABELS[r.trigger.type]}</span>
                {r.conditions.length > 0 && (
                  <> and <span className="font-medium text-ink-800">{r.conditions.length} condition{r.conditions.length === 1 ? '' : 's'}</span> ({r.conditionLogic}) match</>
                )}
                {' '}→ {r.actions.length === 0 ? <span className="text-ink-400">no actions configured</span> : r.actions.map((a) => ACTION_LABELS[a.type]).join(', then ')}
              </p>

              <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-400">
                <span>Priority {r.priority}</span>
                <span>Ran {r.executionCount}x</span>
                {r.lastExecutedAt && <span>Last run {timeAgo(r.lastExecutedAt)}</span>}
              </div>

              <div className="mt-auto flex flex-wrap gap-2 border-t border-ink-100 pt-4">
                <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setFormOpen({ mode: 'edit', rule: r })}>Edit</Button>
                <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={busyId === r.id} onClick={() => void handleRun(r)}>Run now</Button>
                <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={busyId === r.id} onClick={() => void handleDuplicate(r)}>Duplicate</Button>
                <Button variant="secondary" className="ml-auto border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => setDeleteTarget(r)}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <RuleFormModal
          key={formOpen.rule?.id ?? 'create'}
          mode={formOpen.mode}
          initial={formOpen.rule}
          onClose={() => setFormOpen(null)}
          onCreate={createRule}
          onUpdate={updateRule}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete automation rule"
        message={<>Delete <strong>{deleteTarget?.name}</strong>? This can't be undone.</>}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />

      {runResult && (
        <Modal open onClose={() => setRunResult(null)} title={`Run result — ${runResult.rule.name}`} size="md"
          footer={<Button onClick={() => setRunResult(null)}>Close</Button>}>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={runResult.result.status === 'SUCCESS' ? 'green' : runResult.result.status === 'PARTIAL' ? 'amber' : 'red'}>{runResult.result.status}</Badge>
              <span className="text-sm text-ink-500">{runResult.result.actionsExecuted} action{runResult.result.actionsExecuted === 1 ? '' : 's'} executed in {runResult.result.executionTime}ms</span>
            </div>
            {runResult.result.failureReason && <p className="text-sm text-red-600">{runResult.result.failureReason}</p>}
            <div className="max-h-64 overflow-y-auto rounded-lg bg-ink-900 p-3 font-mono text-xs text-ink-200">
              {runResult.result.logs.map((l, i) => <p key={i}>{l}</p>)}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const EMPTY_CONDITION: RuleCondition = { field: '', operator: 'EQUALS', value: '' };
const EMPTY_ACTION: RuleAction = { order: 1, type: 'ADD_TAG', params: {} };

function RuleFormModal({
  mode, initial, onClose, onCreate, onUpdate,
}: {
  mode: 'create' | 'edit';
  initial?: AutomationRule;
  onClose: () => void;
  onCreate: (input: AutomationRuleInput) => Promise<AutomationRule>;
  onUpdate: (id: string, patch: Partial<AutomationRuleInput>) => Promise<AutomationRule>;
}) {
  const { members } = useTeamMembers();
  const { templates } = useWhatsAppTemplates();

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [triggerType, setTriggerType] = useState<TriggerType>(initial?.trigger.type ?? 'LEAD_CREATED');
  const [priority, setPriority] = useState(initial?.priority ?? 50);
  const [conditionLogic, setConditionLogic] = useState<ConditionLogic>(initial?.conditionLogic ?? 'AND');
  const [conditions, setConditions] = useState<RuleCondition[]>(initial?.conditions?.length ? initial.conditions : []);
  const [actions, setActions] = useState<RuleAction[]>(initial?.actions?.length ? initial.actions : [{ ...EMPTY_ACTION }]);
  const [status, setStatus] = useState<RuleStatus>(initial?.status ?? 'DRAFT');
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && actions.length > 0;

  const updateAction = (i: number, patch: Partial<RuleAction>) => {
    setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };
  const updateCondition = (i: number, patch: Partial<RuleCondition>) => {
    setConditions((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const payload: AutomationRuleInput = {
      name: name.trim(),
      description: description.trim(),
      trigger: { type: triggerType },
      conditions,
      conditionLogic,
      actions: actions.map((a, i) => ({ ...a, order: i + 1 })),
      status,
      priority,
    };
    try {
      if (mode === 'edit' && initial) {
        await onUpdate(initial.id, payload);
        toast.success('Rule updated');
      } else {
        await onCreate(payload);
        toast.success('Rule created');
      }
      onClose();
    } catch (err) {
      toast.error(mode === 'edit' ? 'Could not update rule' : 'Could not create rule', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Adaptive param field(s) per action type -- covers the common,
  // meaningful params for each real ACTION_TYPE the backend engine
  // supports, rather than one generic JSON textarea.
  const renderActionParams = (a: RuleAction, i: number) => {
    const setParam = (key: string, value: unknown) => updateAction(i, { params: { ...a.params, [key]: value } });
    switch (a.type) {
      case 'SEND_TEMPLATE':
        return (
          <Select value={(a.params?.templateId as string) || ''} onChange={(e) => setParam('templateId', e.target.value)} className="text-sm">
            <option value="">Select template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        );
      case 'START_NURTURE':
        return <Input value={(a.params?.sequenceId as string) || ''} onChange={(e) => setParam('sequenceId', e.target.value)} placeholder="Nurture sequence ID" className="text-sm" />;
      case 'STOP_NURTURE':
        return <Input value={(a.params?.enrollmentId as string) || ''} onChange={(e) => setParam('enrollmentId', e.target.value)} placeholder="Enrollment ID" className="text-sm" />;
      case 'SEND_BROADCAST':
        return <Input value={(a.params?.broadcastId as string) || ''} onChange={(e) => setParam('broadcastId', e.target.value)} placeholder="Broadcast ID" className="text-sm" />;
      case 'GENERATE_AI_REPLY':
        return <Input value={(a.params?.goal as string) || ''} onChange={(e) => setParam('goal', e.target.value)} placeholder="Goal (e.g. booking, objection)" className="text-sm" />;
      case 'ASSIGN_USER':
        return (
          <Select value={(a.params?.userId as string) || ''} onChange={(e) => setParam('userId', e.target.value)} className="text-sm">
            <option value="">Select user…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
          </Select>
        );
      case 'CHANGE_PIPELINE_STAGE':
        return <Input value={(a.params?.stage as string) || ''} onChange={(e) => setParam('stage', e.target.value)} placeholder="Stage name" className="text-sm" />;
      case 'ADD_TAG':
      case 'REMOVE_TAG':
        return <Input value={(a.params?.tag as string) || ''} onChange={(e) => setParam('tag', e.target.value)} placeholder="Tag" className="text-sm" />;
      case 'CREATE_TASK':
        return <Input value={(a.params?.title as string) || ''} onChange={(e) => setParam('title', e.target.value)} placeholder="Task title" className="text-sm" />;
      case 'CREATE_NOTE':
        return <Input value={(a.params?.text as string) || ''} onChange={(e) => setParam('text', e.target.value)} placeholder="Note text" className="text-sm" />;
      case 'NOTIFY_USER':
        return (
          <div className="flex gap-2">
            <Select value={(a.params?.userId as string) || ''} onChange={(e) => setParam('userId', e.target.value)} className="flex-1 text-sm">
              <option value="">Select user…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
            </Select>
            <Input value={(a.params?.message as string) || ''} onChange={(e) => setParam('message', e.target.value)} placeholder="Message" className="flex-1 text-sm" />
          </div>
        );
      case 'SEND_EMAIL':
        return (
          <div className="flex gap-2">
            <Input value={(a.params?.to as string) || ''} onChange={(e) => setParam('to', e.target.value)} placeholder="To" className="flex-1 text-sm" />
            <Input value={(a.params?.subject as string) || ''} onChange={(e) => setParam('subject', e.target.value)} placeholder="Subject" className="flex-1 text-sm" />
          </div>
        );
      case 'CALL_WEBHOOK':
        return <Input value={(a.params?.url as string) || ''} onChange={(e) => setParam('url', e.target.value)} placeholder="https://…" className="text-sm" />;
      case 'WAIT':
        return (
          <div className="flex gap-2">
            <Input type="number" min={0} value={a.delayValue ?? 0} onChange={(e) => updateAction(i, { delayValue: Number(e.target.value) })} className="w-24 text-sm" />
            <Select value={a.delayUnit ?? 'minutes'} onChange={(e) => updateAction(i, { delayUnit: e.target.value as DelayUnit })} className="text-sm">
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </Select>
          </div>
        );
      case 'END_WORKFLOW':
        return <p className="text-xs text-ink-400">No parameters -- stops the rule here.</p>;
      default:
        return null;
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'edit' ? 'Edit automation rule' : 'New automation rule'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSave()} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Save rule'}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Welcome new leads" autoFocus /></Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as RuleStatus)}>
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
            </Select>
          </Field>
        </div>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Trigger">
            <Select value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)}>
              {TRIGGER_TYPE_VALUES.map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
            </Select>
          </Field>
          <Field label="Priority (1-100, higher runs first)">
            <Input type="number" min={1} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
          </Field>
        </div>

        {/* Conditions -- flat list, AND/OR toggle, matching the real
            schema (no nested groups exist in the backend). */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-400">Conditions (optional)</p>
            {conditions.length > 1 && (
              <div className="flex items-center gap-1 rounded-lg bg-ink-100 p-0.5 text-xs font-medium">
                <button onClick={() => setConditionLogic('AND')} className={cn('rounded-md px-2 py-1', conditionLogic === 'AND' ? 'bg-white shadow-sm' : 'text-ink-500')}>AND</button>
                <button onClick={() => setConditionLogic('OR')} className={cn('rounded-md px-2 py-1', conditionLogic === 'OR' ? 'bg-white shadow-sm' : 'text-ink-500')}>OR</button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value })} placeholder="Field (e.g. lead.score)" className="flex-1 text-sm" />
                <Select value={c.operator} onChange={(e) => updateCondition(i, { operator: e.target.value as ConditionOperator })} className="w-40 text-sm">
                  {CONDITION_OPERATOR_VALUES.map((op) => <option key={op} value={op}>{op.replace(/_/g, ' ')}</option>)}
                </Select>
                <Input value={String(c.value ?? '')} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="Value" className="flex-1 text-sm" />
                <button onClick={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))} className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <button onClick={() => setConditions((prev) => [...prev, { ...EMPTY_CONDITION }])} className="mt-2 text-xs font-semibold text-brand-700 hover:underline">+ Add condition</button>
        </div>

        {/* Actions -- ordered list, executed top to bottom. */}
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">Actions</p>
          <div className="space-y-2">
            {actions.map((a, i) => (
              <div key={i} className="rounded-xl border border-ink-100 bg-ink-50/50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[11px] font-bold text-ink-600">{i + 1}</span>
                  <Select value={a.type} onChange={(e) => updateAction(i, { type: e.target.value as ActionType, params: {} })} className="flex-1 text-sm">
                    {ACTION_TYPE_VALUES.map((t) => <option key={t} value={t}>{ACTION_LABELS[t]}</option>)}
                  </Select>
                  <button onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))} disabled={actions.length === 1} className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 size={14} /></button>
                </div>
                {renderActionParams(a, i)}
              </div>
            ))}
          </div>
          <button onClick={() => setActions((prev) => [...prev, { ...EMPTY_ACTION, order: prev.length + 1 }])} className="mt-2 text-xs font-semibold text-brand-700 hover:underline">+ Add action</button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Consent ---------------------------------------------------------------
/**
 * ConsentTab -- real, backend-connected. Replaces the mock version that
 * read/wrote Lead.consent_status / Lead.opt_out_status directly.
 *
 * IMPORTANT: the real backend models consent as its OWN collection
 * (WhatsAppConsent), keyed by phoneNumber, decoupled from Lead. Two known
 * gaps as of this build:
 *   1. message.service.js's opt-out send guard still reads
 *      Lead.opt_out_status directly, not this module's verifyConsent().
 *   2. Nothing auto-creates a Consent record when a lead/conversation is
 *      created -- this tab includes a "New consent record" action so it's
 *      still usable standalone.
 *
 * No dedicated /consent/stats endpoint exists -- see useConsentStats for
 * how the KPI cards are computed (one limit=1 list call per status).
 */
const CONSENT_STATUS_TONE: Record<ConsentStatus, 'gray' | 'green' | 'amber' | 'red'> = {
  OPTED_IN: 'green',
  PENDING: 'amber',
  OPTED_OUT: 'red',
  EXPIRED: 'gray',
  BLOCKED: 'red',
};

function ConsentTab() {
  const permissions = usePermissions();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<ConsentStatus | ''>('');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const listQuery = {
    page,
    limit: 20,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(search ? { search } : {}),
  };

  const { records, pagination, loading, error, upsert, create, optIn, optOut, block, unblock } = useConsent(listQuery);
  const { stats, refetch: refetchStats } = useConsentStats();

  // consent.service.js broadcasts to the whole tenant room (including our
  // own socket), so our own action's echo arrives here too -- harmless
  // now: upsert() with the same real record is idempotent, and
  // refetchStats() always returns the true current value, so a redundant
  // call from the echo just re-fetches the same correct number. No
  // self-echo tracking needed.
  useWhatsAppRealtime({
    onConsent: (payload) => {
      upsert(payload.consent);
      refetchStats();
    },
  });

  const runAction = async (id: string, action: () => Promise<Consent>, successMsg: string, failMsg: string) => {
    setBusyId(id);
    try {
      await action(); // already upserts the real returned record internally (see useConsent)
      refetchStats();
      toast.success(successMsg);
    } catch (err) {
      toast.error(failMsg, err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleOptIn = (c: Consent) =>
    runAction(c.id, () => optIn(c.id, { optInMethod: 'MANUAL', consentSource: c.consentSource || 'CRM' }), 'Contact opted in', 'Could not opt in');

  const handleOptOut = (c: Consent) => {
    const reason = window.prompt('Reason for opt-out (optional)') || undefined;
    return runAction(c.id, () => optOut(c.id, { optOutMethod: 'MANUAL', reason }), 'Contact opted out', 'Could not opt out');
  };

  const handleBlock = (c: Consent) => {
    if (!window.confirm(`Block ${c.phoneNumber}? They will be excluded from all sending until unblocked.`)) return;
    const reason = window.prompt('Reason for blocking (optional)') || undefined;
    return runAction(c.id, () => block(c.id, reason), 'Contact blocked', 'Could not block contact');
  };

  const handleUnblock = (c: Consent) =>
    runAction(c.id, () => unblock(c.id), 'Contact unblocked', 'Could not unblock contact');

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Opted-in" value={stats.counts.OPTED_IN} icon={<CheckCircle2 size={18} />} accent="#10b981" />
          <KpiCard label="Pending" value={stats.counts.PENDING} icon={<MessageSquare size={18} />} accent="#f59e0b" />
          <KpiCard label="Opted-out" value={stats.counts.OPTED_OUT} icon={<XCircle size={18} />} accent="#ef4444" />
          <KpiCard label="Blocked" value={stats.counts.BLOCKED} icon={<XCircle size={18} />} accent="#ef4444" />
        </div>
      )}

      <Card>
        <CardHeader
          icon={TAB_ICONS.consent}
          title="Consent & Suppression List"
          subtitle="Opt-out keywords: STOP · UNSUBSCRIBE · CANCEL · NO · REMOVE"
          action={
            <div className="flex flex-wrap gap-2">
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search phone, name…"
                className="w-52 py-1.5 text-sm"
              />
              <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as ConsentStatus | ''); setPage(1); }} className="w-auto py-1.5 text-sm">
                <option value="">All statuses</option>
                {CONSENT_STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              {permissions.consent.canCreate && (
                <Button className="px-3 py-1.5 text-xs" onClick={() => setShowCreate(true)}><Plus size={14} /> New consent record</Button>
              )}
            </div>
          }
        />

        {error ? (
          <EmptyState title="Couldn't load consent records" description={error} />
        ) : loading && records.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">Loading consent records…</p>
        ) : records.length === 0 ? (
          <EmptyState title="No consent records yet" description="Create one manually, or connect a source that syncs contacts automatically." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Contact</Th><Th>Phone</Th><Th>Status</Th><Th>Source</Th><Th>Last verified</Th><Th>Actions</Th></tr></thead>
              <tbody>
                {records.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-medium">{c.contactName || c.leadName || '—'}</Td>
                    <Td className="font-mono text-xs">{c.phoneNumber}</Td>
                    <Td>
                      <Badge tone={CONSENT_STATUS_TONE[c.status]}>{c.status}</Badge>
                      {c.status === 'BLOCKED' && c.blockedReason && (
                        <span className="ml-1.5 text-[11px] text-red-500">{c.blockedReason}</span>
                      )}
                    </Td>
                    <Td>{c.consentSource || '—'}</Td>
                    <Td className="text-ink-500">{c.lastVerifiedAt ? timeAgo(c.lastVerifiedAt) : 'Never'}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        {permissions.consent.canOptIn && (c.status === 'PENDING' || c.status === 'OPTED_OUT' || c.status === 'EXPIRED') && (
                          <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={busyId === c.id} onClick={() => void handleOptIn(c)}>
                            Opt in
                          </Button>
                        )}
                        {permissions.consent.canOptOut && (c.status === 'PENDING' || c.status === 'OPTED_IN') && (
                          <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={busyId === c.id} onClick={() => void handleOptOut(c)}>
                            Opt out
                          </Button>
                        )}
                        {permissions.consent.canBlock && c.status !== 'BLOCKED' && (
                          <Button variant="secondary" className="border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50" disabled={busyId === c.id} onClick={() => void handleBlock(c)}>
                            Block
                          </Button>
                        )}
                        {permissions.consent.canUnblock && c.status === 'BLOCKED' && (
                          <Button className="px-2.5 py-1 text-xs" disabled={busyId === c.id} onClick={() => void handleUnblock(c)}>
                            Unblock
                          </Button>
                        )}
                        {!permissions.consent.canOptIn && !permissions.consent.canBlock && (
                          <span className="text-xs text-ink-400">View only</span>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3">
                <p className="text-xs text-ink-500">Page {pagination.page} of {pagination.totalPages} · {pagination.total} total</p>
                <div className="flex gap-1.5">
                  <Button variant="secondary" disabled={!pagination.hasPrev} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15} /> Prev</Button>
                  <Button variant="secondary" disabled={!pagination.hasNext} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight size={15} /></Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {showCreate && (
        <CreateConsentModal
          onClose={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
          create={async (input: CreateConsentInput) => {
            const record = await create(input); // already upserts internally
            refetchStats();
            return record;
          }}
        />
      )}
    </div>
  );
}

function CreateConsentModal({ onClose, onCreated, create }: {
  onClose: () => void;
  onCreated: () => void;
  create: (input: CreateConsentInput) => Promise<Consent>;
}) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [status, setStatus] = useState<ConsentStatus>('PENDING');
  const [consentSource, setConsentSource] = useState<ConsentSource>('CRM');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!phoneNumber.trim()) return toast.error('Phone number is required');
    setSaving(true);
    try {
      await create({ phoneNumber: phoneNumber.trim(), status, consentSource });
      toast.success('Consent record created');
      onCreated();
    } catch (err) {
      toast.error('Could not create record', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open onClose={onClose} title="New Consent Record"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button></>}
    >
      <div className="space-y-4">
        <Field label="Phone number" hint="International format, e.g. +14155550142">
          <IconInput icon={<Phone size={14} />} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+14155550142" />
        </Field>
        <Field label="Initial status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as ConsentStatus)}>
            {CONSENT_STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Source">
          <Select value={consentSource} onChange={(e) => setConsentSource(e.target.value as ConsentSource)}>
            {CONSENT_SOURCE_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

// ---- Delivery logs ---------------------------------------------------------
const DELIVERY_STATUS_TONE: Record<string, 'gray' | 'violet' | 'green' | 'red' | 'amber' | 'blue'> = {
  QUEUED: 'gray',
  SENDING: 'blue',
  SENT: 'violet',
  DELIVERED: 'green',
  READ: 'green',
  FAILED: 'red',
  EXPIRED: 'amber',
  DELETED: 'gray',
};

const DELIVERY_STATUS_FILTER_VALUES: DeliveryStatus[] = [
  'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'EXPIRED', 'DELETED',
];

function LogsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<DeliveryStatus | ''>('');
  const [provider, setProvider] = useState<DeliveryProvider | ''>('');
  const [search, setSearch] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const listQuery = {
    page,
    limit: 20,
    ...(status ? { status } : {}),
    ...(provider ? { provider } : {}),
    ...(search ? { search } : {}),
  };

  const { logs, pagination, loading, error, retry, refetch } = useDeliveryLogs(listQuery);
  const { stats, refetch: refetchStats } = useDeliveryLogsStats(status || provider ? { status: status || undefined, provider: provider || undefined } : {});

  useWhatsAppRealtime({
    onDeliveryLog: () => {
      refetch();
      refetchStats();
    },
  });

  const handleRetry = async (log: DeliveryLog) => {
    setRetryingId(log.id);
    try {
      await retry(log.id);
      toast.success('Message queued for retry');
    } catch (err) {
      toast.error('Could not retry message', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Total messages" value={stats.totalMessages} icon={<MessageSquare size={18} />} accent="#6366f1" />
          <KpiCard label="Delivered" value={stats.delivered} icon={<CheckCircle2 size={18} />} accent="#10b981" />
          <KpiCard label="Failed" value={stats.failed} icon={<XCircle size={18} />} accent="#ef4444" />
          <KpiCard label="Delivery rate" value={percent(stats.deliveryRate)} icon={<CheckCircle2 size={18} />} accent="#3b82f6" />
        </div>
      )}

      <Card>
        <CardHeader
          icon={TAB_ICONS.logs}
          title="Delivery Logs"
          subtitle={pagination ? `${pagination.total} messages tracked` : 'Loading…'}
          action={
            <div className="flex flex-wrap gap-2">
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search phone, name, message id…"
                className="w-56 py-1.5 text-sm"
              />
              <Select value={status} onChange={(e) => { setStatus(e.target.value as DeliveryStatus | ''); setPage(1); }} className="w-auto py-1.5 text-sm">
                <option value="">All statuses</option>
                {DELIVERY_STATUS_FILTER_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select value={provider} onChange={(e) => { setProvider(e.target.value as DeliveryProvider | ''); setPage(1); }} className="w-auto py-1.5 text-sm">
                <option value="">All providers</option>
                {DELIVERY_PROVIDER_VALUES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </div>
          }
        />

        {error ? (
          <EmptyState title="Couldn't load delivery logs" description={error} />
        ) : loading && logs.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">Loading delivery logs…</p>
        ) : logs.length === 0 ? (
          <EmptyState title="No delivery logs yet" description="Sent messages will be tracked here." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Time</Th><Th>Recipient</Th><Th>Provider</Th><Th>Type</Th><Th>Status</Th><Th>Retries</Th><Th /></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <Tr key={l.id}>
                    <Td className="text-ink-500">{formatDateTime(l.sentAt ?? l.createdAt)}</Td>
                    <Td>
                      <div className="font-mono text-xs">{l.phoneNumber}</div>
                      {(l.contactName || l.leadName) && <div className="text-xs text-ink-400">{l.contactName || l.leadName}</div>}
                    </Td>
                    <Td>{l.provider}</Td>
                    <Td className="capitalize">{l.messageType.toLowerCase()}</Td>
                    <Td>
                      <Badge tone={DELIVERY_STATUS_TONE[l.status] ?? 'gray'}>{l.status}</Badge>
                      {l.status === 'FAILED' && l.failureReason && (
                        <span className="ml-1.5 text-[11px] text-red-500">{l.failureReason}</span>
                      )}
                    </Td>
                    <Td>{l.retryCount}</Td>
                    <Td>
                      {l.status === 'FAILED' && (
                        <Button
                          variant="secondary" className="px-2.5 py-1 text-xs" disabled={retryingId === l.id}
                          onClick={() => void handleRetry(l)}
                        >
                          <RefreshCw size={12} className={retryingId === l.id ? 'animate-spin' : ''} /> Retry
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3">
                <p className="text-xs text-ink-500">Page {pagination.page} of {pagination.totalPages} · {pagination.total} total</p>
                <div className="flex gap-1.5">
                  <Button variant="secondary" disabled={!pagination.hasPrev} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15} /> Prev</Button>
                  <Button variant="secondary" disabled={!pagination.hasNext} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight size={15} /></Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// ---- Analytics -------------------------------------------------------------
// ---- Analytics ---------------------------------------------------------
/**
 * AnalyticsTab -- real, backend-connected. Replaces a mock version that
 * computed every number from the in-memory dev store (useDb()) and
 * generated the "Template performance" chart's data with Math.random() on
 * every single render (a new fake number each time, not even consistent
 * fake data). See whatsappAnalyticsApi.ts's header comment for the same
 * finding, independently documented when that file was scaffolded.
 *
 * "Avg response time" is shown as "Not tracked yet" rather than a made-up
 * duration -- the backend genuinely returns null for
 * averageFirstResponseTime/averageResolutionTime (no timestamp fields
 * exist yet on the conversation model to compute it from). Showing a fake
 * "14m" would be exactly the kind of fabricated number this fix removes.
 */
function AnalyticsTab() {
  const { data, loading, error } = useWhatsAppAnalytics();
  // Aggregate campaign analytics endpoint has no per-campaign breakdown or
  // revenue total -- but individual campaigns (already real, same hook
  // CampaignsTab uses) DO carry real repliedCount/revenueGenerated, so
  // "Reply rate by campaign" and "WA Revenue" are built from that instead.
  const { campaigns } = useWhatsAppCampaigns('campaigns', { limit: 50 });
  const { format: formatMoney } = useTenantCurrency();

  if (loading) return <p className="p-8 text-center text-sm text-ink-400">Loading analytics…</p>;
  if (error || !data) return <EmptyState title="Couldn't load analytics" description={error || 'Please try again.'} />;

  const { dashboard, messages, conversations, templates, trends } = data;
  const revenue = campaigns.reduce((s, c) => s + (c.metrics?.revenueGenerated || 0), 0);
  const replyByCampaign = campaigns
    .filter((c) => (c.metrics?.repliedCount || 0) > 0)
    .slice(0, 6)
    .map((c) => ({ name: c.name.slice(0, 12), value: c.metrics.repliedCount }));
  const tplPerf = templates.top10Templates.slice(0, 6).map((t) => ({ name: t.templateName.slice(0, 12), value: t.successRate }));
  const trend = trends.conversations.map((p) => ({ name: p.period, value: p.total }));
  const funnel = [
    { name: 'Sent', value: messages.sent }, { name: 'Delivered', value: messages.delivered },
    { name: 'Read', value: messages.read },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={TAB_ICONS.analytics} title="WhatsApp Analytics" subtitle="KPIs and charts across conversations, campaigns and templates." />
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Conversations" value={dashboard.totalConversations} icon={<MessageSquare size={18} />} accent="#22c55e" />
        <KpiCard label="Messages sent" value={dashboard.outgoingMessages} icon={<Send size={18} />} accent="#6366f1" />
        <KpiCard label="Delivery rate" value={percent(messages.deliveryRate, 1)} icon={<CheckCircle2 size={18} />} accent="#3b82f6" />
        <KpiCard label="Read rate" value={percent(messages.readRate, 1)} icon={<CheckCircle2 size={18} />} accent="#06b6d4" />
        <KpiCard label="Avg response" value="Not tracked yet" icon={<RefreshCw size={18} />} accent="#14b8a6" />
        <KpiCard label="WA Revenue" value={formatMoney(revenue)} icon={<Server size={18} />} accent="#10b981" />
        <KpiCard label="Pending replies" value={conversations.unread} icon={<MessageSquare size={18} />} accent="#f97316" />
        <KpiCard label="Active conversations" value={dashboard.activeConversations} icon={<MessageSquare size={18} />} accent="#8b5cf6" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LineChartCard title="Conversations over time" data={trend} color="#22c55e" area />
        <BarChartCard title="Replies by campaign" data={replyByCampaign} color="#8b5cf6" />
        <BarChartCard title="Template performance" data={tplPerf} color="#6366f1" />
        <DonutChartCard title="Message delivery funnel" data={funnel} />
      </div>
    </div>
  );
}

// ---- Settings --------------------------------------------------------------
function SettingsTab() {
  const { settings, loading, error, updateProvider, updateSync, testConnection, disconnect, syncTemplates, refetch } = useWhatsAppSettings();

  const [provider, setProvider] = useState<WhatsAppProviderReal>(NATIVE_PROVIDER);
  const [panelMode, setPanelMode] = useState<PanelMode>('NATIVE');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [appId, setAppId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [embeddedSignupBusy, setEmbeddedSignupBusy] = useState(false);

  const [testResult, setTestResult] = useState<{ displayPhoneNumber?: string; verifiedName?: string; message: string } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setPanelMode(settings.panelMode);
    setProvider(settings.panelMode === 'NATIVE' ? NATIVE_PROVIDER : settings.provider);
    setBusinessAccountId(settings.meta.businessAccountId);
    setPhoneNumberId(settings.meta.phoneNumberId);
    setAppId(settings.meta.appId || '');
  }, [settings]);

  // FB.login's own callback gives us the `code`; the postMessage listener
  // below gives us the waba_id/phone_number_id -- they arrive as two
  // separate async events, so the code is stashed here until both exist.
  const pendingSignupCodeRef = useRef<string | null>(null);
  const embeddedSignupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Meta Embedded Signup ("Continue with Facebook") ──────────────────
  // App-level feature (see BACKEND config.js's comment) -- hidden
  // entirely until settings.embeddedSignupAvailable is true, which only
  // happens once InnovateX's own Meta Tech Provider approval is done and
  // the resulting App ID / Config ID are configured server-side. Manual
  // connect (the form below) remains the only path until then.
  //
  // NOTE: implemented against Meta's documented Embedded Signup v4 flow
  // (FB.login with config_id + the WA_EMBEDDED_SIGNUP postMessage
  // contract) but NOT exercised against a real flow -- there is no way
  // to test this without actual Tech Provider approval, which doesn't
  // exist yet. The exact postMessage event shape is Meta's documented
  // pattern; worth a close look at the real payload the first time this
  // actually runs, in case Meta's exact field names differ slightly.
  useEffect(() => {
    if (!settings?.embeddedSignupAvailable || !settings.embeddedSignupAppId) return;
    if (document.getElementById('facebook-jssdk')) return;

    (window as any).fbAsyncInit = function fbAsyncInit() {
      (window as any).FB.init({
        appId: settings.embeddedSignupAppId,
        autoLogAppEvents: true,
        xfbml: false,
        version: 'v21.0',
      });
    };

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, [settings?.embeddedSignupAvailable, settings?.embeddedSignupAppId]);

  useEffect(() => {
    function handleEmbeddedSignupMessage(event: MessageEvent) {
      // Meta's Embedded Signup popup only ever posts from facebook.com --
      // reject anything else outright rather than trusting message shape
      // alone to distinguish it from unrelated postMessage traffic.
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
      let data: any;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;

      if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
        const wabaId = data.data?.waba_id;
        const phoneNumberId2 = data.data?.phone_number_id;
        if (wabaId && phoneNumberId2 && pendingSignupCodeRef.current) {
          void completeEmbeddedSignup(pendingSignupCodeRef.current, wabaId, phoneNumberId2);
        }
      } else if (data.event === 'CANCEL' || data.event === 'ERROR') {
        if (embeddedSignupTimeoutRef.current) clearTimeout(embeddedSignupTimeoutRef.current);
        setEmbeddedSignupBusy(false);
        if (data.event === 'ERROR') {
          toast.error('Embedded Signup failed', data.data?.error_message || 'Please try again or use manual connect below.');
        }
      }
    }
    window.addEventListener('message', handleEmbeddedSignupMessage);
    return () => window.removeEventListener('message', handleEmbeddedSignupMessage);
  }, []);

  // FB.login's own callback gives us the `code`; the postMessage listener
  // above gives us the waba_id/phone_number_id -- they arrive as two
  // separate async events, so the code is stashed here until both exist.
  const completeEmbeddedSignup = async (code: string, wabaId: string, phoneNumberId2: string) => {
    if (embeddedSignupTimeoutRef.current) clearTimeout(embeddedSignupTimeoutRef.current);
    setEmbeddedSignupBusy(true);
    try {
      await whatsappSettingsApi.exchangeEmbeddedSignup({ code, wabaId, phoneNumberId: phoneNumberId2 });
      toast.success('WhatsApp connected via Facebook');
      pendingSignupCodeRef.current = null;
      refetch();
    } catch (err) {
      toast.error('Could not complete connection', err instanceof ApiError ? err.message : 'Please try again or use manual connect below.');
    } finally {
      setEmbeddedSignupBusy(false);
    }
  };

  const launchEmbeddedSignup = () => {
    const FB = (window as any).FB;
    if (!FB || !settings?.embeddedSignupConfigId) {
      toast.error('Not ready yet', 'Still loading Facebook -- try again in a moment.');
      return;
    }
    setEmbeddedSignupBusy(true);
    // Safety timeout -- without this, if Meta's popup never posts back a
    // WA_EMBEDDED_SIGNUP FINISH message (e.g. the flow can't actually
    // complete server-side, which is expected before real Tech Provider
    // approval is granted -- the popup UI can load fine while the
    // underlying WABA-sharing permission still isn't there), the button
    // would stay stuck on "Connecting..." forever with zero feedback.
    const timeoutId = setTimeout(() => {
      setEmbeddedSignupBusy(false);
      pendingSignupCodeRef.current = null;
      toast.error('Connection timed out', 'Facebook did not complete the signup. If this keeps happening, it likely means Tech Provider approval isn\u2019t finalized yet -- manual connect below still works.');
    }, 45000);
    embeddedSignupTimeoutRef.current = timeoutId;
    FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        if (code) {
          pendingSignupCodeRef.current = code;
          // Actual completion happens in the postMessage listener above,
          // once it also has the waba_id/phone_number_id -- this callback
          // alone doesn't carry those. The timeout above is cleared there
          // (or on CANCEL/ERROR) -- not here, since success isn't known yet.
        } else {
          if (embeddedSignupTimeoutRef.current) clearTimeout(embeddedSignupTimeoutRef.current);
          setEmbeddedSignupBusy(false);
          if (response?.status !== 'unknown') {
            toast.error('Facebook login was cancelled or did not complete');
          }
        }
      },
      {
        config_id: settings.embeddedSignupConfigId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3' },
      },
    );
  };

  const clearTestFeedback = () => { setTestResult(null); setTestError(null); };

  const handlePanelModeChange = (next: PanelMode) => {
    setPanelMode(next);
    if (next === 'NATIVE') setProvider(NATIVE_PROVIDER);
    clearTestFeedback();
    setAttemptedSave(false);
  };

  const hasPhoneNumberId = phoneNumberId.trim().length > 0;
  const hasBusinessAccountId = businessAccountId.trim().length > 0;
  const hasAccessToken = accessToken.trim().length > 0 || Boolean(settings?.meta.hasAccessToken);

  const nativeFieldsComplete = hasPhoneNumberId && hasBusinessAccountId && hasAccessToken;
  const canSave = panelMode !== 'NATIVE' || nativeFieldsComplete;
  const canTest = panelMode === 'NATIVE' && nativeFieldsComplete;

  const fieldError = (ok: boolean) => attemptedSave && panelMode === 'NATIVE' && !ok;

  const handleSave = async () => {
    setAttemptedSave(true);
    if (!canSave) {
      toast.error('Missing required fields', 'Enter Phone Number ID, Business Account ID, and an Access Token before saving.');
      return;
    }
    setSaving(true);
    try {
      await updateProvider({
        provider: panelMode === 'NATIVE' ? NATIVE_PROVIDER : provider,
        panelMode,
        meta: {
          businessAccountId,
          phoneNumberId,
          appId,
          ...(accessToken ? { accessToken } : {}),
          ...(appSecret ? { appSecret } : {}),
          ...(verifyToken ? { verifyToken } : {}),
        },
      });
      setAccessToken('');
      setAppSecret('');
      setVerifyToken('');
      clearTestFeedback();
      setAttemptedSave(false);
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Could not save settings', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const result = await testConnection();
      setTestResult({ displayPhoneNumber: result.displayPhoneNumber, verifiedName: result.verifiedName, message: result.message });
      toast.success('Connection verified');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Please try again.';
      setTestError(message);
      toast.error('Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect WhatsApp? Your saved credentials are kept, so reconnecting later won\u2019t require re-entering them.')) return;
    setDisconnecting(true);
    try {
      await disconnect();
      clearTestFeedback();
      toast.success('WhatsApp disconnected');
    } catch (err) {
      toast.error('Could not disconnect', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  const copyWebhookUrl = () => {
    if (!settings?.meta.webhookUrl) return;
    navigator.clipboard?.writeText(settings.meta.webhookUrl);
    toast.success('Webhook URL copied', 'Paste this into your Meta App\u2019s webhook configuration');
  };

  const handleSyncToggle = async (key: keyof WhatsAppSettingsSync, value: boolean) => {
    try {
      await updateSync({ [key]: value });
    } catch (err) {
      toast.error('Could not update sync setting', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const handleSyncTemplates = async () => {
    setSyncingTemplates(true);
    try {
      const { result } = await syncTemplates();
      if (!result) {
        toast.error('Sync failed', 'No result returned from server.');
      } else if (result.errors.length > 0) {
        toast.warning(
          `Synced with ${result.errors.length} error(s)`,
          `${result.created} created, ${result.updated} updated. First error: ${result.errors[0].message}`,
        );
      } else {
        toast.success(
          'Templates synced from Meta',
          `${result.created} created, ${result.updated} updated, ${result.total} total.`,
        );
      }
    } catch (err) {
      toast.error('Sync failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSyncingTemplates(false);
    }
  };

  if (loading && !settings) return <Card className="p-6"><p className="text-sm text-ink-400">Loading settings…</p></Card>;
  if (error) return <Card className="p-6"><p className="text-sm text-red-600">{error}</p></Card>;
  if (!settings) return null;

  return (
    <Card>
      <CardHeader
        icon={<CheckCircle2 size={16} />}
        iconTone="violet"
        title="WhatsApp Provider Settings"
        subtitle="Choose native InnovateX panel or a third-party BSP. Only Meta Cloud API is fully connected in this phase."
        action={
          <StatusStrip
            live={settings.providerMode === 'LIVE'}
            connected={settings.meta.connected}
            lastVerified={settings.meta.lastVerifiedAt ? timeAgo(settings.meta.lastVerifiedAt) : undefined}
            onDisconnect={() => void handleDisconnect()}
            disconnecting={disconnecting}
          />
        }
      />

      {/* Meta Embedded Signup -- shown ONLY once InnovateX's own Meta
          Tech Provider approval is complete (see BACKEND config.js's
          comment on why this is app-level, not per-tenant). Manual
          connect below remains fully functional and unaffected either
          way -- this is a faster alternative on top, not a replacement. */}
      {settings.embeddedSignupAvailable && !settings.meta.connected && (
        <div className="border-b border-ink-100 bg-gradient-to-b from-brand-50/60 to-transparent px-6 py-5">
          <p className="mb-1 text-sm font-semibold text-ink-800">Quickest way to connect</p>
          <p className="mb-3 text-xs text-ink-500">Sign in with Facebook to link your WhatsApp Business number in a few clicks -- no copying credentials.</p>
          <Button onClick={launchEmbeddedSignup} disabled={embeddedSignupBusy} className="bg-[#1877F2] hover:bg-[#166FE5]">
            {embeddedSignupBusy ? 'Connecting…' : 'Continue with Facebook'}
          </Button>
          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-ink-100" />
            <span className="text-xs font-medium text-ink-400">OR CONNECT MANUALLY</span>
            <div className="h-px flex-1 bg-ink-100" />
          </div>
        </div>
      )}

      <div className="p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="WhatsApp mode" info="Native uses InnovateX's own panel. Third-party routes through a BSP like WATI or Twilio.">
            <Select value={panelMode} onChange={(e) => handlePanelModeChange(e.target.value as PanelMode)}>
              <option value="NATIVE">Native InnovateX Panel</option>
              <option value="THIRD_PARTY">Third-party Provider</option>
            </Select>
          </Field>
          <Field label="Provider" info="The BSP that actually sends/receives messages on your behalf.">
            {panelMode === 'NATIVE' ? (
              <>
                <Select value={NATIVE_PROVIDER} disabled>
                  <option value={NATIVE_PROVIDER}>{PROVIDER_LABELS[NATIVE_PROVIDER]}</option>
                </Select>
                <p className="mt-1 text-[11px] text-ink-400">Locked to Native Meta Cloud API while WhatsApp mode is Native InnovateX Panel.</p>
              </>
            ) : (
              <Select value={provider} onChange={(e) => { setProvider(e.target.value as WhatsAppProviderReal); clearTestFeedback(); }}>
                {THIRD_PARTY_PROVIDER_VALUES.map((p) => (
                  <option key={p} value={p} disabled={!IMPLEMENTED_THIRD_PARTY_PROVIDERS.includes(p)}>
                    {PROVIDER_LABELS[p]}{!IMPLEMENTED_THIRD_PARTY_PROVIDERS.includes(p) ? ' (coming soon)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Default sender number">
            <IconInput
              icon={<Phone size={14} />}
              value={settings.meta.displayPhoneNumber || 'Not verified yet — run Test Connection'}
              readOnly
              className="bg-ink-50 text-ink-500"
            />
          </Field>
          <Field label="Phone number ID">
            <IconInput
              icon={<Hash size={14} />}
              value={phoneNumberId}
              onChange={(e) => { setPhoneNumberId(e.target.value); clearTestFeedback(); }}
              placeholder="e.g. 119128780406310"
              className={fieldError(hasPhoneNumberId) ? 'border-red-300 focus:border-red-400' : ''}
            />
            {fieldError(hasPhoneNumberId) && <p className="mt-1 text-[11px] text-red-600">Required</p>}
          </Field>
          <Field label="Business account ID">
            <IconInput
              icon={<Building2 size={14} />}
              value={businessAccountId}
              onChange={(e) => { setBusinessAccountId(e.target.value); clearTestFeedback(); }}
              placeholder="e.g. 951181964646443"
              className={fieldError(hasBusinessAccountId) ? 'border-red-300 focus:border-red-400' : ''}
            />
            {fieldError(hasBusinessAccountId) && <p className="mt-1 text-[11px] text-red-600">Required</p>}
          </Field>
          <Field label="Meta App ID" hint="From your Facebook Developer App -- required to submit templates with a media (image/video/document) header for approval.">
            <IconInput
              icon={<Fingerprint size={14} />}
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="e.g. 1234567890123456"
            />
          </Field>
          <Field label="Access token">
            <SecretField
              icon={<KeyRound size={14} />}
              value={accessToken}
              onChange={(e) => { setAccessToken(e.target.value); clearTestFeedback(); }}
              placeholder={settings.meta.hasAccessToken ? 'Already set — leave blank to keep' : 'Paste your Meta access token'}
              className={fieldError(hasAccessToken) ? 'border-red-300 focus:border-red-400' : ''}
            />
            {fieldError(hasAccessToken) && <p className="mt-1 text-[11px] text-red-600">Required</p>}
          </Field>
          <Field label="App secret" info="Used to verify inbound webhook signatures from Meta (X-Hub-Signature-256).">
            <SecretField
              icon={<Fingerprint size={14} />}
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={settings.meta.hasAppSecret ? 'Already set — leave blank to keep' : 'Required to verify inbound webhook signatures'}
            />
          </Field>
          <Field label="Verify token">
            <SecretField
              icon={<KeyRound size={14} />}
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              placeholder={settings.meta.hasVerifyToken ? 'Already set — leave blank to keep' : 'Choose any string, then paste it into Meta'}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Webhook URL">
              <div className="flex gap-2">
                <IconInput icon={<Link2 size={14} />} value={settings.meta.webhookUrl} readOnly className="bg-ink-50 text-ink-500" />
                <Button variant="secondary" onClick={copyWebhookUrl}><Copy size={14} /> Copy</Button>
              </div>
              <p className="mt-1 text-[11px] text-ink-400">Auto-generated for your workspace — paste this into your Meta App's webhook configuration, not the other way around.</p>
            </Field>
          </div>
        </div>

        <div className="mt-6 space-y-2 rounded-xl border border-ink-100 p-4">
          {([
            ['autoSyncTemplates', 'Sync templates'],
            ['autoSyncMessages', 'Sync messages'],
            ['autoSyncContacts', 'Sync contacts'],
          ] as const).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-sm text-ink-700">{label}</span>
              <div className="flex items-center gap-2">
                {k === 'autoSyncTemplates' && (
                  <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => void handleSyncTemplates()} disabled={syncingTemplates}>
                    <RefreshCw size={12} className={syncingTemplates ? 'animate-spin' : ''} /> {syncingTemplates ? 'Syncing…' : 'Sync now'}
                  </Button>
                )}
                <Toggle checked={settings.sync[k]} onChange={(v) => void handleSyncToggle(k, v)} />
              </div>
            </div>
          ))}
          <p className="text-[11px] text-ink-400">The toggle only controls whether templates auto-sync in the background later — click "Sync now" to pull your real current templates from Meta immediately, including any that were deleted here but still exist on Meta's side.</p>
        </div>

        <div className="mt-6 flex items-center gap-2">
          <Button onClick={() => void handleSave()} disabled={saving || (attemptedSave && !canSave)}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
          <Button variant="secondary" onClick={() => void handleTest()} disabled={testing || !canTest}>
            <RefreshCw size={15} className={testing ? 'animate-spin' : ''} /> {testing ? 'Testing…' : 'Test Connection'}
          </Button>
        </div>
        {panelMode !== 'NATIVE' && (
          <p className="mt-2 text-[11px] text-ink-400">Test Connection is only available for Native Meta Cloud API in this phase.</p>
        )}
        {panelMode === 'NATIVE' && !nativeFieldsComplete && (
          <p className="mt-2 text-[11px] text-amber-600">Enter Phone Number ID, Business Account ID, and an Access Token before saving or testing.</p>
        )}

        {testResult && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
            <div className="text-sm text-emerald-800">
              <p className="font-medium">Connected — verified against Meta's Graph API</p>
              {testResult.displayPhoneNumber && (
                <p className="mt-0.5 text-emerald-700">Sending as {testResult.displayPhoneNumber}{testResult.verifiedName ? ` (${testResult.verifiedName})` : ''}</p>
              )}
            </div>
          </div>
        )}
        {testError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <XCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <div className="text-sm text-red-800">
              <p className="font-medium">Connection test failed</p>
              <p className="mt-0.5 text-red-700">{testError}</p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}