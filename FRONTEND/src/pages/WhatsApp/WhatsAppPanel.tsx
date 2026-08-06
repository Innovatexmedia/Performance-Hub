import { useEffect, useState } from 'react';
import {
  Plus, Send, Sparkles, Copy, CheckCircle2, XCircle, MessageSquare, Server, RefreshCw,
  ChevronLeft, ChevronRight, Trash2, Unplug,
} from 'lucide-react';
import { useStore } from '@/store/store';
import { useAuthStore } from '@/store/authStore';
import { atLeast, hasRoleOrPermission } from '@/lib/permissions';
import { aiReplyAssistantApi } from '@/lib/aiReplyAssistantApi';
import type { ReplyGoal, RewriteStyle } from '@/lib/aiReplyAssistantApi';
import { useTenantProfile } from '@/hooks/useTenantProfile';
import type { UseTenantProfileResult } from '@/hooks/useTenantProfile';
import { BUSINESS_TYPE_OPTIONS } from '@/lib/tenantProfileApi';
import type { BusinessType } from '@/lib/tenantProfileApi';
import { isTemplateStatusSeen, markTemplateStatusSeen } from '@/lib/templateSeenTracker';
import { useDb, useSettings, userName } from '@/store/hooks';
import {
  PageHeader, Card, CardHeader, Tabs, Table, Th, Td, Tr, Badge, StatusBadge, Button,
  Avatar, EmptyState, Toggle, Field, Input, Select, Modal, cn,
} from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { BarChartCard, LineChartCard, DonutChartCard } from '@/components/charts';
import { Inbox } from './Inbox';
import { TemplateBuilder } from './TemplateBuilder';
import { conversationsTrend } from '@/utils/calculations';
import { syncFromProvider } from '@/services/whatsappService';
import { formatCurrency, formatDateTime, timeAgo, percent } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { useLeads } from '@/hooks/useLeads';
import { useGroups } from '@/hooks/useGroups';
import type { Group } from '@/types/group';
import { useWhatsAppSettings } from '@/hooks/useWhatsAppSettings';
import { useWhatsAppTemplates } from '@/hooks/useWhatsAppTemplates';
import type { WhatsAppTemplate as WhatsAppTemplateReal } from '@/types/whatsappTemplate';
import { USABLE_APPROVAL_STATUS } from '@/types/whatsappTemplate';
import { useWhatsAppCampaigns } from '@/hooks/useWhatsAppCampaigns';
import type { CreateCampaignInput, WhatsAppCampaign as WhatsAppCampaignReal } from '@/types/whatsappCampaign';
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

const TABS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'contacts', label: 'Contacts / Leads' },
  { id: 'groups', label: 'Groups' },
  { id: 'templates', label: 'Templates' },
  { id: 'approval', label: 'Template Approval' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'nurture', label: 'Nurture Messages' },
  { id: 'ai', label: 'AI Reply Assistant' },
  { id: 'broadcasts', label: 'Broadcasts' },
  { id: 'rules', label: 'Automation Rules' },
  { id: 'consent', label: 'Opt-Out / Consent' },
  { id: 'logs', label: 'Delivery Logs' },
  { id: 'analytics', label: 'WhatsApp Analytics' },
  { id: 'settings', label: 'WhatsApp Settings' },
];

const PROVIDERS: WhatsAppProvider[] = ['Native Meta Cloud API', 'WATI', 'Interakt', 'AiSensy', 'Gallabox', 'Twilio WhatsApp', '360dialog', 'Custom Webhook Provider', 'Simulation Mode'];

export function WhatsAppPanel() {
  const [tab, setTab] = useState('inbox');
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

  const tabsWithBadges = TABS.map((t) =>
    t.id === 'approval' && approvalBadgeCount > 0
      ? { ...t, count: approvalBadgeCount, tone: 'red' as const }
      : t,
  );

  return (
    <div>
      <PageHeader
        title="WhatsApp Operating Panel"
        description="Native InnovateX panel + multi-provider simulation — inbox, templates, campaigns & analytics."
        breadcrumb={['Revenue', 'WhatsApp Panel']}
      />
      <div className="mb-4"><Tabs tabs={tabsWithBadges} active={tab} onChange={setTab} /></div>

      {tab === 'inbox' && <Inbox />}
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

  const assignGroup = async (leadId: string, groupId: string) => {
    setAssigningId(leadId);
    try {
      await updateLead(leadId, { group_id: groupId || null });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update group');
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="WhatsApp Contacts" subtitle={pagination ? `${pagination.total} contacts synced` : 'Loading…'} />
        {error ? (
          <EmptyState title="Couldn't load contacts" description={error} />
        ) : loading && leads.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">Loading contacts…</p>
        ) : leads.length === 0 ? (
          <EmptyState title="No contacts yet" description="Leads with a WhatsApp number will appear here." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Contact</Th><Th>WhatsApp</Th><Th>Group</Th><Th>Consent</Th><Th>Opt-out</Th><Th>Last contacted</Th><Th>Score</Th></tr></thead>
              <tbody>
                {leads.map((l) => (
                  <Tr key={l.id}>
                    <Td><div className="flex items-center gap-2"><Avatar name={l.name} color="#22c55e" size={30} /><span className="font-medium">{l.name}</span></div></Td>
                    <Td className="font-mono text-xs">{l.whatsapp_number || l.phone}</Td>
                    <Td>
                      <Select
                        value={l.group_id || ''}
                        disabled={assigningId === l.id}
                        onChange={(e) => assignGroup(l.id, e.target.value)}
                        className="py-1 text-xs"
                      >
                        <option value="">No group</option>
                        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </Select>
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

// ---- Groups: own tab, professional CRUD + bulk member management ----------
function GroupsTab() {
  const { groups, loading, error, createGroup, updateGroup, deleteGroup, setMembers } = useGroups();
  // Large limit -- member-management checklist needs the full contact list,
  // not a paginated slice. Fine at current scale; would need a real search-
  // as-you-type server query if the contact base grows much larger.
  const { leads, loading: leadsLoading } = useLeads({ page: 1, limit: 500 });

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);

  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);

  const [managingGroup, setManagingGroup] = useState<Group | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState('');
  const [savingMembers, setSavingMembers] = useState(false);

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
    setSelectedLeadIds(new Set(leads.filter((l) => l.group_id === g.id).map((l) => l.id)));
    setMemberSearch('');
  };

  const toggleMember = (leadId: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  };

  const filteredLeads = leads.filter((l) =>
    !memberSearch.trim() || l.name.toLowerCase().includes(memberSearch.trim().toLowerCase()) ||
    (l.whatsapp_number || l.phone || '').includes(memberSearch.trim()),
  );

  const selectAllFiltered = () => setSelectedLeadIds((prev) => {
    const next = new Set(prev);
    filteredLeads.forEach((l) => next.add(l.id));
    return next;
  });
  const clearAllFiltered = () => setSelectedLeadIds((prev) => {
    const next = new Set(prev);
    filteredLeads.forEach((l) => next.delete(l.id));
    return next;
  });

  const saveMembers = async () => {
    if (!managingGroup) return;
    setSavingMembers(true);
    try {
      await setMembers(managingGroup.id, Array.from(selectedLeadIds));
      toast.success('Members updated');
      setManagingGroup(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update members');
    } finally {
      setSavingMembers(false);
    }
  };

  if (loading) return <div className="py-12 text-center text-sm text-ink-500">Loading groups…</div>;
  if (error) return <div className="py-12 text-center text-sm text-red-600">{error}</div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-ink-500">Groups are used to target campaigns and broadcasts at a whole audience, never at individually-picked contacts.</p>
        <Button onClick={openCreate}><Plus size={16} /> New Group</Button>
      </div>

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

      {/* Manage members -- bulk selective add/remove via checklist */}
      {managingGroup && (
        <Modal open onClose={() => setManagingGroup(null)} title={`Manage members — ${managingGroup.name}`} size="lg"
          footer={<>
            <p className="mr-auto self-center text-xs text-ink-500">{selectedLeadIds.size} selected</p>
            <Button variant="secondary" onClick={() => setManagingGroup(null)}>Cancel</Button>
            <Button onClick={saveMembers} disabled={savingMembers}>Save members</Button>
          </>}>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Search by name or number…" className="flex-1" />
              <Button variant="secondary" className="whitespace-nowrap px-3 py-1.5 text-xs" onClick={selectAllFiltered}>Select all</Button>
              <Button variant="secondary" className="whitespace-nowrap px-3 py-1.5 text-xs" onClick={clearAllFiltered}>Clear all</Button>
            </div>
            {leadsLoading ? (
              <p className="py-8 text-center text-sm text-ink-400">Loading contacts…</p>
            ) : filteredLeads.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No contacts match.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-xl border border-ink-100">
                {filteredLeads.map((l) => (
                  <label key={l.id} className="flex cursor-pointer items-center gap-3 border-b border-ink-50 px-3 py-2 last:border-0 hover:bg-ink-50">
                    <input type="checkbox" checked={selectedLeadIds.has(l.id)} onChange={() => toggleMember(l.id)} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
                    <Avatar name={l.name} color="#22c55e" size={26} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{l.name}</p>
                      <p className="truncate text-xs text-ink-500">{l.whatsapp_number || l.phone}</p>
                    </div>
                    {l.group_id && l.group_id !== managingGroup.id && (
                      <span className="whitespace-nowrap text-[10px] text-amber-600">in another group</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
function TemplatesTab() {
  const { templates, loading, error, refetch, deleteTemplate, duplicateTemplate, activateTemplate, pauseTemplate, archiveTemplate } = useWhatsAppTemplates();
  const { submitForReview, submitToProvider } = useTemplateApproval(refetch);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editTpl, setEditTpl] = useState<WhatsAppTemplateReal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const currentUser = useAuthStore((s) => s.user);

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

  const runAction = async (id: string, action: () => Promise<unknown>, successMsg: string, failMsg: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(successMsg);
    } catch (err) {
      toast.error(failMsg, err instanceof ApiError ? err.message : 'Please try again.');
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
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleTemplates.map((t) => (
          <Card key={t.id} className={cn('flex flex-col p-4', t.approvalStatus === 'REJECTED' && 'opacity-70')}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-ink-900">{t.name}</p>
                <div className="mt-1 flex gap-1.5"><Badge tone="violet">{t.category}</Badge><Badge tone="gray">{t.languageCode}</Badge></div>
              </div>
              <StatusBadge status={t.status} />
            </div>
            <p className="mt-3 line-clamp-3 flex-1 rounded-lg bg-ink-50 p-2.5 text-sm text-ink-600">{t.body}</p>
            {t.approvalStatus === 'REJECTED' && (
              <p className="mt-2 text-xs font-medium text-red-600">Rejected — read-only. Duplicate to start a fresh, editable copy.</p>
            )}
            {t.variables.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{t.variables.map((v) => <span key={v} className="font-mono text-[11px] text-brand-600">{`{{${v}}}`}</span>)}</div>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {t.approvalStatus === 'DRAFT' && (
                <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setEditTpl(t)}>Edit</Button>
              )}
              <Button
                variant="ghost" className="px-2.5 py-1 text-xs" disabled={busyId === t.id}
                onClick={() => void runAction(t.id, () => duplicateTemplate(t.id), 'Template duplicated', 'Could not duplicate template')}
              ><Copy size={12} /> Duplicate</Button>
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
                  <Button className="px-2.5 py-1 text-xs" disabled={busyId === t.id} onClick={() => void runAction(t.id, () => submitToProvider(t.id), 'Submitted to provider', 'Could not submit to provider')}>
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
              <button onClick={() => void handleDelete(t)} disabled={busyId === t.id} className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600" title="Delete">
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

  const runAction = async (id: string, action: () => Promise<unknown>, successMsg: string, failMsg: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(successMsg);
    } catch (err) {
      toast.error(failMsg, err instanceof ApiError ? err.message : 'Please try again.');
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
    runAction(t.id, () => submitToProvider(t.id), 'Submitted to provider', 'Could not submit to provider');

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
    <Card>
      <CardHeader title="Template Approval Workflow" subtitle="Internal review → Provider submission → Meta" />
      <div className="divide-y divide-ink-100">
        {visibleTemplates.length === 0 && (
          <p className="p-8 text-center text-sm text-ink-400">Nothing here right now — templates appear once someone submits them for review.</p>
        )}
        {visibleTemplates.map((t) => (
          <div key={t.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-ink-900">{t.name} <span className="ml-1 text-xs font-normal text-ink-400">v{t.version}</span></p>
                <p className="mt-0.5 text-sm text-ink-500">{t.category} · {t.languageCode}</p>
              </div>
              <Badge tone={APPROVAL_STATUS_TONE[t.approvalStatus] ?? 'gray'}>
                {APPROVAL_STATUS_LABEL[t.approvalStatus] ?? t.approvalStatus}
              </Badge>
            </div>

            {t.approvalStatus === 'PROVIDER_REJECTED' && (t.providerRejectionReason || t.providerRejectionMessage) && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
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
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                <span className="rounded bg-ink-100 px-1.5 py-0.5 font-medium text-ink-600">{t.transitionHistory[0].fromStatus ?? 'DRAFT'}</span>
                {t.transitionHistory.map((h, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span>→</span>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 font-medium text-ink-600" title={h.action}>{h.toStatus}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-ink-400">No transitions yet — still in Draft.</p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
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
          </div>
        ))}
      </div>
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
    </Card>
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
    applyRealtimeUpdate,
  } = useWhatsAppCampaigns(resource);
  const { templates } = useWhatsAppTemplates();
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
      ? { onBroadcast: (payload) => applyRealtimeUpdate(payload.broadcast) }
      : { onCampaign: (payload) => applyRealtimeUpdate(payload.campaign) },
  );

  const [show, setShow] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const typeOptions = broadcast ? BROADCAST_TYPE_OPTIONS : CAMPAIGN_TYPE_OPTIONS;
  const [form, setForm] = useState({
    name: '', type: typeOptions[0], templateId: '', groupId: '',
  });
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Mirrors LOCKED_STATUSES / READ_ONLY_STATUSES in campaigns.constants.js /
  // broadcasts.constants.js exactly -- the backend rejects update/delete
  // outside these, so the UI only offers the buttons when they'd succeed.
  const EDIT_LOCKED = ['SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED'];
  const DELETE_LOCKED = ['COMPLETED', 'CANCELLED'];

  // Audience is always a Group -- not raw per-contact filters -- per product
  // decision: campaigns target a named group, never individuals directly.
  const buildAudience = () => ({
    filters: { groupId: form.groupId },
  });

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const count = await previewAudience(buildAudience());
      setPreviewCount(count);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to preview audience');
    } finally {
      setPreviewing(false);
    }
  };

  const resetForm = () => {
    setForm({ name: '', type: typeOptions[0], templateId: '', groupId: '' });
    setPreviewCount(null);
    setEditingId(null);
  };

  const startEdit = (c: WhatsAppCampaignReal) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      type: c.type,
      templateId: c.templateId || '',
      groupId: c.audience?.filters?.groupId || '',
    });
    setPreviewCount(null);
    setShow(true);
  };

  const create = async () => {
    if (submitting) return; // guards against a double-click firing two creates
    if (!form.name.trim()) return toast.error('Name required');
    if (!form.templateId) return toast.error('An approved template is required');
    if (!form.groupId) return toast.error('A target group is required — campaigns send to a group, not individual contacts');
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
      <div className="mb-4 flex justify-end"><Button onClick={() => { resetForm(); setShow(true); }}><Plus size={16} /> New {broadcast ? 'Broadcast' : 'Campaign'}</Button></div>
      {campaigns.length === 0 ? <EmptyState title={`No ${broadcast ? 'broadcasts' : 'campaigns'} yet`} action={<Button onClick={() => { resetForm(); setShow(true); }}><Plus size={16} /> Create</Button>} /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {campaigns.map((c) => {
            const m = c.metrics;
            const isBusy = busyId === c.id;
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div><p className="font-semibold text-ink-900">{c.name}</p><p className="text-xs text-ink-500">{c.type} · {c.recipientCount} recipients · {c.templateName || 'no template'}</p></div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {[['Sent', m.sentCount], ['Delivered', m.deliveredCount], ['Read', m.readCount], ['Replied', m.repliedCount]].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-ink-50 py-1.5"><p className="text-sm font-bold text-ink-900">{v}</p><p className="text-[10px] text-ink-500">{k}</p></div>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {[['Bookings', m.bookingCount], ['Payments', m.paymentCount]].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-ink-50 py-1.5"><p className="text-sm font-bold text-ink-900">{v}</p><p className="text-[10px] text-ink-500">{k}</p></div>
                  ))}
                  <div className="rounded-lg bg-emerald-50 py-1.5"><p className="text-sm font-bold text-emerald-700">{formatCurrency(m.revenueGenerated)}</p><p className="text-[10px] text-emerald-600">Revenue</p></div>
                </div>
                {c.status === 'RUNNING' && (
                  <p className="mt-2 text-[11px] text-ink-400">Sending now — counts update live as Meta reports delivery, read, and reply status.</p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.status === 'DRAFT' && canApproveOrSend && <Button disabled={isBusy} className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => approveCampaign(c.id), 'Approved')}>Approve</Button>}
                  {c.status === 'DRAFT' && canCancel && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => cancelCampaign(c.id), 'Cancelled')}>Cancel</Button>}
                  {c.status === 'DRAFT' && !canApproveOrSend && <p className="text-xs text-ink-400">Awaiting approval from someone with campaign-sending rights.</p>}
                  {c.status === 'APPROVED' && canApproveOrSend && <Button disabled={isBusy} className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => startCampaign(c.id), 'Started')}><Send size={12} /> Start now</Button>}
                  {c.status === 'APPROVED' && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => {
                    const dt = window.prompt('Schedule for (ISO date/time, e.g. 2026-08-05T10:00:00)');
                    if (dt) runAction(c.id, () => scheduleCampaign(c.id, new Date(dt).toISOString()), 'Scheduled');
                  }}>Schedule</Button>}
                  {c.status === 'SCHEDULED' && canApproveOrSend && <Button disabled={isBusy} className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => startCampaign(c.id), 'Started')}><Send size={12} /> Start now</Button>}
                  {c.status === 'SCHEDULED' && canCancel && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => cancelCampaign(c.id), 'Cancelled')}>Cancel</Button>}
                  {c.status === 'RUNNING' && canApproveOrSend && <Button disabled={isBusy} className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => completeCampaign(c.id), 'Completed')}>Mark completed</Button>}
                  {c.status === 'RUNNING' && canApproveOrSend && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => failCampaign(c.id, 'Manually marked as failed'), 'Marked failed')}>Mark failed</Button>}
                  {c.status === 'RUNNING' && canCancel && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => cancelCampaign(c.id), 'Cancelled')}>Cancel</Button>}
                  {c.status === 'FAILED' && canCancel && <Button disabled={isBusy} variant="secondary" className="px-3 py-1 text-xs" onClick={() => runAction(c.id, () => cancelCampaign(c.id), 'Cancelled')}>Cancel</Button>}
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
            <Field label="Target group" hint={groups.length === 0 ? 'No groups yet — create one in Contacts / Leads first.' : 'Campaigns send to a whole group, not individually-picked contacts.'}>
              <Select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                <option value="">Select a group…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.memberCount})</option>)}
              </Select>
            </Field>
            <div className="flex items-center gap-3">
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={runPreview} disabled={previewing || !form.groupId}>{previewing ? 'Checking…' : 'Preview audience'}</Button>
              {previewCount !== null && <p className="text-xs text-ink-600">{previewCount} matching contact{previewCount === 1 ? '' : 's'} (opted-out contacts already excluded)</p>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---- Nurture messages ------------------------------------------------------
function NurtureMessagesTab() {
  const { db, tenantId } = useDb();
  const seqs = db.nurtureSequences.filter((s) => s.tenant_id === tenantId);
  const waSteps = seqs.flatMap((s) => s.steps.filter((st) => st.channel === 'WhatsApp').map((st) => ({ seq: s.name, ...st })));
  return (
    <Card>
      <CardHeader title="WhatsApp Nurture Messages" subtitle="WhatsApp steps across all active sequences" />
      <Table>
        <thead><tr><Th>Sequence</Th><Th>Step</Th><Th>Delay</Th><Th>Message</Th></tr></thead>
        <tbody>
          {waSteps.map((s, i) => (
            <Tr key={i}><Td className="font-medium">{s.seq}</Td><Td>Step {s.order}</Td><Td>Day {s.delay_days}</Td><Td className="max-w-md truncate text-ink-600">{s.message}</Td></Tr>
          ))}
        </tbody>
      </Table>
    </Card>
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
function RulesTab() {
  const { db, tenantId } = useDb();
  const { toggleAutomation } = useStore();
  const autos = db.automations.filter((a) => a.tenant_id === tenantId);
  return (
    <Card>
      <CardHeader title="WhatsApp Automation Rules" subtitle="Trigger-based WhatsApp actions" />
      <div className="divide-y divide-ink-100">
        {autos.map((a) => (
          <div key={a.id} className="flex items-center justify-between px-5 py-3.5">
            <div>
              <p className="font-medium text-ink-900">{a.name}</p>
              <p className="text-xs text-ink-500">When <span className="font-medium text-ink-700">{a.trigger}</span> → {a.action}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={a.status === 'active' ? 'green' : 'gray'}>{a.status}</Badge>
              <Toggle checked={a.status === 'active'} onChange={() => toggleAutomation(a.id)} />
            </div>
          </div>
        ))}
      </div>
    </Card>
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
          <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+14155550142" />
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
function AnalyticsTab() {
  const { db, tenantId } = useDb();
  const convos = db.conversations.filter((c) => c.tenant_id === tenantId);
  const msgs = db.messages.filter((m) => m.tenant_id === tenantId);
  const sent = msgs.filter((m) => m.direction === 'outbound').length;
  const campaigns = db.campaigns.filter((c) => c.tenant_id === tenantId);
  const totalSent = campaigns.reduce((s, c) => s + c.metrics.sent, 0);
  const totalDelivered = campaigns.reduce((s, c) => s + c.metrics.delivered, 0);
  const totalRead = campaigns.reduce((s, c) => s + c.metrics.read, 0);
  const totalReplied = campaigns.reduce((s, c) => s + c.metrics.replied, 0);
  const revenue = campaigns.reduce((s, c) => s + c.metrics.revenue, 0);

  const trend = conversationsTrend(db, tenantId);
  const replyByCampaign = campaigns.slice(0, 6).map((c) => ({ name: c.name.slice(0, 12), value: c.metrics.replied }));
  const tplPerf = db.templates.filter((t) => t.tenant_id === tenantId).slice(0, 6).map((t) => ({ name: t.template_name.slice(0, 12), value: Math.floor(Math.random() * 80) + 20 }));
  const funnel = [
    { name: 'Sent', value: totalSent }, { name: 'Delivered', value: totalDelivered },
    { name: 'Read', value: totalRead }, { name: 'Replied', value: totalReplied },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Conversations" value={convos.length} icon={<MessageSquare size={18} />} accent="#22c55e" />
        <KpiCard label="Messages sent" value={sent} icon={<Send size={18} />} accent="#6366f1" />
        <KpiCard label="Delivery rate" value={percent(totalSent ? (totalDelivered / totalSent) * 100 : 0)} icon={<CheckCircle2 size={18} />} accent="#3b82f6" />
        <KpiCard label="Reply rate" value={percent(totalRead ? (totalReplied / totalRead) * 100 : 0)} icon={<MessageSquare size={18} />} accent="#8b5cf6" />
        <KpiCard label="Read rate" value={percent(totalDelivered ? (totalRead / totalDelivered) * 100 : 0)} icon={<CheckCircle2 size={18} />} accent="#06b6d4" />
        <KpiCard label="Avg response" value="14m" icon={<RefreshCw size={18} />} accent="#14b8a6" />
        <KpiCard label="WA Revenue" value={formatCurrency(revenue)} icon={<Server size={18} />} accent="#10b981" />
        <KpiCard label="Pending replies" value={convos.filter((c) => c.unread_count > 0).length} icon={<MessageSquare size={18} />} accent="#f97316" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LineChartCard title="Conversations over time" data={trend} color="#22c55e" area />
        <BarChartCard title="Reply rate by campaign" data={replyByCampaign} color="#8b5cf6" />
        <BarChartCard title="Template performance" data={tplPerf} color="#6366f1" />
        <DonutChartCard title="Message delivery funnel" data={funnel} />
      </div>
    </div>
  );
}

// ---- Settings --------------------------------------------------------------
function SettingsTab() {
  const { settings, loading, error, updateProvider, updateSync, testConnection, disconnect, syncTemplates } = useWhatsAppSettings();

  const [provider, setProvider] = useState<WhatsAppProviderReal>(NATIVE_PROVIDER);
  const [panelMode, setPanelMode] = useState<PanelMode>('NATIVE');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);

  const [testResult, setTestResult] = useState<{ displayPhoneNumber?: string; verifiedName?: string; message: string } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setPanelMode(settings.panelMode);
    setProvider(settings.panelMode === 'NATIVE' ? NATIVE_PROVIDER : settings.provider);
    setBusinessAccountId(settings.meta.businessAccountId);
    setPhoneNumberId(settings.meta.phoneNumberId);
  }, [settings]);

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

  if (loading && !settings) return <Card className="max-w-3xl p-6"><p className="text-sm text-ink-400">Loading settings…</p></Card>;
  if (error) return <Card className="max-w-3xl p-6"><p className="text-sm text-red-600">{error}</p></Card>;
  if (!settings) return null;

  return (
    <Card className="max-w-3xl p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">WhatsApp Provider Settings</h3>
          <p className="mt-1 text-xs text-ink-500">Choose native InnovateX panel or a third-party BSP. Only Meta Cloud API is fully connected in this phase.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Badge tone={settings.providerMode === 'LIVE' ? 'green' : 'amber'}>
              {settings.providerMode === 'LIVE' ? 'Live' : 'Not verified yet'}
            </Badge>
            <Badge tone={settings.meta.connected ? 'green' : 'gray'}>{settings.meta.connected ? 'Connected' : 'Not connected'}</Badge>
          </div>
          {settings.meta.lastVerifiedAt && (
            <p className="text-[11px] text-ink-400">Last verified {timeAgo(settings.meta.lastVerifiedAt)}</p>
          )}
          {settings.meta.connected && (
            <Button
              variant="secondary"
              className="border-red-200 px-2.5 py-1 text-xs text-red-600 hover:border-red-300 hover:bg-red-50"
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
            >
              <Unplug size={13} /> {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="WhatsApp mode">
          <Select value={panelMode} onChange={(e) => handlePanelModeChange(e.target.value as PanelMode)}>
            <option value="NATIVE">Native InnovateX Panel</option>
            <option value="THIRD_PARTY">Third-party Provider</option>
          </Select>
        </Field>
        <Field label="Provider">
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
          <Input value={settings.meta.displayPhoneNumber || 'Not verified yet — run Test Connection'} readOnly className="bg-ink-50 text-ink-500" />
        </Field>
        <Field label="Phone number ID">
          <Input
            value={phoneNumberId}
            onChange={(e) => { setPhoneNumberId(e.target.value); clearTestFeedback(); }}
            placeholder="e.g. 119128780406310"
            className={fieldError(hasPhoneNumberId) ? 'border-red-300 focus:border-red-400' : ''}
          />
          {fieldError(hasPhoneNumberId) && <p className="mt-1 text-[11px] text-red-600">Required</p>}
        </Field>
        <Field label="Business account ID">
          <Input
            value={businessAccountId}
            onChange={(e) => { setBusinessAccountId(e.target.value); clearTestFeedback(); }}
            placeholder="e.g. 951181964646443"
            className={fieldError(hasBusinessAccountId) ? 'border-red-300 focus:border-red-400' : ''}
          />
          {fieldError(hasBusinessAccountId) && <p className="mt-1 text-[11px] text-red-600">Required</p>}
        </Field>
        <Field label="Access token">
          <Input
            type="password"
            value={accessToken}
            onChange={(e) => { setAccessToken(e.target.value); clearTestFeedback(); }}
            placeholder={settings.meta.hasAccessToken ? 'Already set — leave blank to keep' : 'Paste your Meta access token'}
            className={fieldError(hasAccessToken) ? 'border-red-300 focus:border-red-400' : ''}
          />
          {fieldError(hasAccessToken) && <p className="mt-1 text-[11px] text-red-600">Required</p>}
        </Field>
        <Field label="App secret">
          <Input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder={settings.meta.hasAppSecret ? 'Already set — leave blank to keep' : 'Required to verify inbound webhook signatures'}
          />
        </Field>
        <Field label="Verify token">
          <Input
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
            placeholder={settings.meta.hasVerifyToken ? 'Already set — leave blank to keep' : 'Choose any string, then paste it into Meta'}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Webhook URL">
            <div className="flex gap-2">
              <Input value={settings.meta.webhookUrl} readOnly className="bg-ink-50 text-ink-500" />
              <Button variant="secondary" onClick={copyWebhookUrl}><Copy size={14} /> Copy</Button>
            </div>
            <p className="mt-1 text-[11px] text-ink-400">Auto-generated for your workspace — paste this into your Meta App's webhook configuration, not the other way around.</p>
          </Field>
        </div>
      </div>

      <div className="mt-4 space-y-2 rounded-lg border border-ink-100 p-3">
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
                  <RefreshCw size={12} /> {syncingTemplates ? 'Syncing…' : 'Sync now'}
                </Button>
              )}
              <Toggle checked={settings.sync[k]} onChange={(v) => void handleSyncToggle(k, v)} />
            </div>
          </div>
        ))}
        <p className="text-[11px] text-ink-400">The toggle only controls whether templates auto-sync in the background later — click "Sync now" to pull your real current templates from Meta immediately, including any that were deleted here but still exist on Meta's side.</p>
      </div>

      <div className="mt-4 flex items-center gap-2">
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
    </Card>
  );
}