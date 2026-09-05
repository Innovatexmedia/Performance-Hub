import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  MessageSquarePlus, Tag, UserPlus, StickyNote, Search, PanelRightClose, PanelRightOpen,
  Megaphone, Link2, KanbanSquare, CreditCard, UserCog, Clock, Wallet, Phone,
  FileText, Download, Play, Pause, Check, CheckCheck, Clock3, Mic, Image as ImageIcon,
} from 'lucide-react';
import { Avatar, Badge, StatusBadge, Button, Select, cn } from '@/components/ui';
import { Composer } from './Composer';
import { formatCurrency, timeAgo } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { useConversations } from '@/hooks/useConversations';
import { useConversationDetails } from '@/hooks/useConversationDetails';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useWhatsAppRealtime } from '@/hooks/useWhatsAppRealtime';
import { useAuthStore } from '@/store/authStore';
import { hasRoleOrPermission } from '@/lib/permissions';
import { ApiError } from '@/lib/apiClient';
import { useWhatsAppSettings } from '@/hooks/useWhatsAppSettings';
import { CONVERSATION_STATUS_VALUES } from '@/types/whatsapp';
import type { ConversationStatus, Message, MessageStatus } from '@/types/whatsapp';

// Canned replies for the "Simulate inbound" dev tool -- rotates instead of
// repeating one fixed string, so clicking it more than once produces a
// realistic-looking back-and-forth instead of the same bubble stacked
// several times in a row.
const SIMULATED_INBOUND_REPLIES = [
  'Thanks for reaching out! Tell me more.',
  'Sounds good, what are the next steps?',
  'Can you share more details on pricing?',
  'Got it, let me check and get back to you.',
  'That works for me — can we schedule a call?',
  "Thanks, I'll review this and reply soon.",
];

// Deterministic per-contact avatar color -- the same person resolves to the
// same color everywhere their avatar appears (conversation list, chat
// header, lead panel) instead of every contact defaulting to the same
// hardcoded color regardless of who they are. Keyed off phone number
// (always present, unlike contact_name) so it stays consistent even for
// leads with no name on file yet.
const AVATAR_PALETTE = ['#6366f1', '#22c55e', '#f97316', '#ec4899', '#0ea5e9', '#a855f7', '#14b8a6', '#eab308'];
function avatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function Inbox({ onGoToSettings }: { onGoToSettings?: () => void }) {
  const { members, nameById } = useTeamMembers();
  // "Simulate inbound" fakes a customer reply -- only safe to show while
  // the tenant is actually on Simulation Mode. If they've connected a
  // real provider (Meta, Twilio, etc.), this button would silently inject
  // a fake message into a real conversation with no way to tell it apart
  // from an actual reply -- hiding it once real data is flowing.
  const { settings: whatsappSettings, loading: settingsLoading, error: settingsError } = useWhatsAppSettings();
  const isSimulationMode = whatsappSettings?.provider === 'SIMULATION';
  // Genuinely "not connected yet" -- the REAL signal is providerMode, not
  // provider. These are two different fields: `provider` is WHICH
  // service is selected (META_CLOUD, TWILIO, SIMULATION, ...); `providerMode`
  // is whether that selection has actually been PROVEN working
  // ('LIVE' only after a successful Test Connection -- defaults to
  // 'SIMULATION' otherwise, confirmed in whatsappSettings.model.js).
  // A tenant can perfectly well have provider: 'META_CLOUD' set (they
  // picked Meta, entered credentials, maybe even tested webhooks
  // manually outside the app) while providerMode is STILL 'SIMULATION'
  // because they never actually ran Test Connection in the app itself --
  // checking `provider === 'SIMULATION'` alone missed this exact case
  // entirely, which is why the setup prompt never appeared despite
  // nothing being genuinely connected yet.
  const isNotConnected = !settingsLoading && (!!settingsError || !whatsappSettings || whatsappSettings.providerMode !== 'LIVE');
  const location = useLocation();
  const requestedConversationId = (location.state as { conversationId?: string } | null)?.conversationId ?? null;

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeId, setActiveId] = useState<string | null>(requestedConversationId);
  const [tagInput, setTagInput] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  // Right-hand lead/deal context panel is toggleable -- collapsing it lets
  // the conversation itself use the freed-up width, useful on smaller
  // laptop screens or when someone just wants to focus on the thread.
  const [showContext, setShowContext] = useState(true);

  const listQuery = useMemo(() => ({
    search: q || undefined,
    status: statusFilter === 'all' ? undefined : (statusFilter as ConversationStatus),
    limit: 50,
  }), [q, statusFilter]);

  const { conversations, loading: listLoading, error: listError, refetch: refetchList } = useConversations(listQuery);
  // Mirrors requireRoleOrPermission('tenant_admin', PERMISSIONS.MANAGE_CONVERSATIONS)
  // on the real /:id/assign route -- if this is false, the picker
  // shouldn't even render, not just fail with a 403 after being clicked.
  const currentUser = useAuthStore((s) => s.user);
  const canAssign = hasRoleOrPermission(currentUser?.role, currentUser?.permissions, 'tenant_admin', 'assign_conversations');
  const {
    details, notes, loading: detailLoading, refetch: refetchDetails,
    sendMessage, simulateInbound, assign, changeStatus, addNote, addTag, removeTag,
    loadOlder, loadingOlder,
  } = useConversationDetails(activeId);

  // Realtime: a message anywhere should refresh the sidebar (last_message_at,
  // preview, unread_count), and refresh the open thread specifically if the
  // message belongs to the conversation currently in view. Conversation-level
  // changes (status/assign/tags from another tab or user) do the same.
  const handleRealtimeMessage = useCallback((payload: { conversationId: string }) => {
    refetchList();
    if (payload.conversationId === activeId) refetchDetails();
  }, [refetchList, refetchDetails, activeId]);

  const handleRealtimeConversation = useCallback((payload: { conversation: { id: string } }) => {
    refetchList();
    if (payload.conversation.id === activeId) refetchDetails();
  }, [refetchList, refetchDetails, activeId]);

  useWhatsAppRealtime({ onMessage: handleRealtimeMessage, onConversation: handleRealtimeConversation });

  // Auto-select the first conversation once the list loads, matching the
  // old mock's behavior of always having something active.
  useEffect(() => {
    if (!activeId && conversations.length > 0) setActiveId(conversations[0].id);
  }, [activeId, conversations]);

  const active = details?.conversation ?? null;
  const leadContext = details?.leadContext ?? null;
  const messages = details?.messages ?? [];

  // Real WhatsApp-like scroll behavior, not just "always jump to bottom":
  //  - Switching conversations: instant snap, no animation (matches how
  //    WhatsApp opens a chat -- animating through possibly thousands of
  //    messages would look slow and janky, so it just snaps).
  //  - A new message arriving in the conversation you're already viewing:
  //    smooth scroll down, but ONLY if you were already at/near the
  //    bottom. If you've scrolled up to read older messages, nothing
  //    force-scrolls you away from what you're reading -- exactly like
  //    real WhatsApp never yanks you down mid-read.
  //  - Scrolling near the TOP loads the next batch of older messages
  //    (real infinite-scroll-up, same as WhatsApp's own chat history) --
  //    and preserves exactly where you were looking, since prepending
  //    older messages above your current view would otherwise silently
  //    shove the whole conversation down and disorient you.
  //  - useLayoutEffect (not useEffect) so the scroll position is already
  //    correct before the browser paints -- no visible flash of the top
  //    of the conversation before it snaps down.
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number | null>(null);
  // True whenever the NEXT time messages actually change should be an
  // instant snap, not a smooth scroll. Set the moment the user switches
  // conversations (activeId changes) -- but the real message data for
  // that conversation doesn't arrive until the async fetch resolves,
  // which is a LATER, separate render. Without splitting these into two
  // effects, "did we just switch conversations" was being computed at the
  // same time as "did messages change" -- which fired once prematurely
  // (while the OLD conversation's messages were still showing, comparing
  // activeId against its previous value) and then again when the new
  // messages actually arrived, by which point the switch had already been
  // marked "handled" -- so the real snap-to-bottom for the NEW
  // conversation incorrectly fell through to the smooth-scroll branch
  // instead, producing a visible flash of the top followed by a smooth
  // slide down.
  const pendingSnapRef = useRef(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 80 && !loadingOlder) {
      prevScrollHeightRef.current = el.scrollHeight;
      void loadOlder();
    }
  };

  // Fires immediately on conversation switch, independent of when the
  // actual message data shows up.
  useEffect(() => {
    pendingSnapRef.current = true;
    isNearBottomRef.current = true;
  }, [activeId]);

  // After older messages are prepended, restore the exact same visual
  // position instead of letting the browser reset scrollTop to 0 (which
  // is what happens by default when content is added above the fold).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || prevScrollHeightRef.current == null) return;
    el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    prevScrollHeightRef.current = null;
  }, [messages]);

  // Fires whenever the actual message array changes -- for a conversation
  // switch, this is the LATER render where the real data has arrived, not
  // the one where activeId first changed.
  //
  // Uses direct scrollTop assignment on the container, NOT
  // bottomRef.scrollIntoView(). scrollIntoView() walks up through every
  // scrollable ancestor to bring the target into view -- if the page
  // itself is scrollable at that moment (e.g. content above/below the
  // Inbox), it can end up scrolling the WHOLE PAGE in addition to the
  // message pane, which looks exactly like "scrolls from the top of the
  // page down to the current chat" instead of a clean, contained snap
  // inside just the chat panel. Setting scrollTop directly touches only
  // this one element, with zero chance of affecting anything outside it.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (pendingSnapRef.current) {
      el.scrollTop = el.scrollHeight;
      pendingSnapRef.current = false;
    } else if (isNearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const handleSimulateInbound = async () => {
    try {
      // Last inbound message content, so the next simulated reply avoids
      // repeating it verbatim -- picks a different canned line whenever
      // more than one option exists.
      const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound')?.content;
      const options = SIMULATED_INBOUND_REPLIES.filter((r) => r !== lastInbound);
      const pool = options.length > 0 ? options : SIMULATED_INBOUND_REPLIES;
      const text = pool[Math.floor(Math.random() * pool.length)];
      await simulateInbound(text);
    } catch (err) {
      toast.error('Could not simulate message', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const handleAddTag = async () => {
    if (!tagInput.trim()) return;
    try {
      await addTag(tagInput.trim());
      setTagInput('');
    } catch (err) {
      toast.error('Could not add tag', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      await addNote(noteText.trim());
      setNoteText('');
      setShowNote(false);
    } catch (err) {
      toast.error('Could not add note', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  return (
    <div className="grid h-full grid-cols-12 overflow-hidden bg-white">
      {/* Conversation list */}
      <div className="col-span-12 flex h-full min-h-0 flex-col border-r border-ink-200 md:col-span-4 lg:col-span-3">
        <div className="space-y-2 border-b border-ink-100 p-3">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" className="input py-1.5 pl-8 text-sm" />
          </div>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="py-1.5 text-sm">
            <option value="all">All statuses</option>
            {CONVERSATION_STATUS_VALUES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listError && <p className="p-4 text-center text-xs text-red-600">{listError}</p>}
          {listLoading && conversations.length === 0 && <p className="p-4 text-center text-xs text-ink-400">Loading…</p>}
          {!listLoading && conversations.length === 0 && !listError && (
            isNotConnected ? (
              <div className="flex flex-col items-center gap-2 p-6 text-center">
                <MessageSquarePlus size={20} className="text-ink-300" />
                <p className="text-xs font-medium text-ink-600">WhatsApp isn't connected yet</p>
                <Button variant="secondary" className="mt-1 px-2.5 py-1 text-xs" onClick={onGoToSettings}>Connect now</Button>
              </div>
            ) : (
              <p className="p-4 text-center text-xs text-ink-400">No conversations found.</p>
            )
          )}
          {conversations.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)} className={cn('flex w-full gap-2.5 border-b border-ink-50 px-3 py-3 text-left hover:bg-ink-50', c.id === activeId && 'bg-brand-50/50')}>
              <Avatar name={c.contact_name || c.phone} color={avatarColor(c.phone)} size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-sm font-semibold text-ink-900">{c.contact_name || c.phone}</p>
                  <span className="shrink-0 text-[11px] text-ink-400">{timeAgo(c.last_message_at)}</span>
                </div>
                <p className="truncate text-xs text-ink-500">{c.last_message_preview || 'No messages yet'}</p>
                <div className="mt-1 flex items-center gap-1">
                  <StatusBadge status={c.status} />
                  {c.unread_count > 0 && <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">{c.unread_count}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat thread */}
      <div className={cn('col-span-12 flex h-full min-h-0 flex-col md:col-span-8', showContext ? 'lg:col-span-6' : 'lg:col-span-9')}>
        {detailLoading && !active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-400">Loading conversation…</div>
        ) : active ? (
          <>
            <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={active.contact_name || active.phone} color={avatarColor(active.phone)} size={36} />
                <div>
                  <p className="text-sm font-semibold text-ink-900">{active.contact_name || 'Unknown contact'}</p>
                  <p className="text-xs text-ink-500">{active.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Select value={active.status} onChange={(e) => void changeStatus(e.target.value)} className="w-auto py-1 text-xs">
                  {CONVERSATION_STATUS_VALUES.map((s) => <option key={s}>{s}</option>)}
                </Select>
                {canAssign ? (
                  <Select value={active.assigned_user_id ?? ''} onChange={(e) => void assign(e.target.value)} className="w-auto py-1 text-xs" title="Assign">
                    <option value="">Unassigned</option>
                    {members.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                  </Select>
                ) : (
                  <span className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs text-ink-500" title="Only an Owner/Admin (or someone granted this right) can reassign a conversation">
                    {active.assigned_user_id ? nameById(active.assigned_user_id) : 'Unassigned'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setShowContext((v) => !v)}
                  title={showContext ? 'Hide contact details' : 'Show contact details'}
                  aria-label={showContext ? 'Hide contact details' : 'Show contact details'}
                  aria-pressed={showContext}
                  className="hidden rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50 hover:text-ink-800 lg:inline-flex"
                >
                  {showContext ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                </button>
              </div>
            </div>

            <div ref={containerRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto bg-ink-50/60 p-4" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #e2e8f0 1px, transparent 0)', backgroundSize: '24px 24px' }}>
              {loadingOlder && (
                <p className="py-2 text-center text-xs text-ink-400">Loading older messages…</p>
              )}
              {messages.map((m, i) => {
                // Groups consecutive messages from the same sender the way
                // a real chat app does: tighter spacing between them, a
                // "connected" corner where they meet instead of every
                // bubble looking like a standalone card, and the
                // timestamp only shown on the LAST message of a run
                // instead of repeated on every single bubble (which is
                // what made a run of several same-sender messages read
                // like a duplicated list rather than a conversation).
                const prev = messages[i - 1];
                const next = messages[i + 1];
                const groupedWithPrev = prev?.direction === m.direction;
                const groupedWithNext = next?.direction === m.direction;
                const isOutbound = m.direction === 'outbound';
                const isBlocked = m.status === 'Blocked by Opt-Out';

                return (
                  <div key={m.id} className={cn('flex', groupedWithPrev ? 'mt-0.5' : 'mt-3', isOutbound ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
                      isOutbound
                        ? cn(groupedWithPrev && 'rounded-tr-md', groupedWithNext ? 'rounded-br-md' : 'rounded-br-sm')
                        : cn(groupedWithPrev && 'rounded-tl-md', groupedWithNext ? 'rounded-bl-md' : 'rounded-bl-sm'),
                      isBlocked ? 'bg-red-50 text-red-700 ring-1 ring-red-200' : isOutbound ? 'bg-brand-600 text-white' : 'bg-white text-ink-800',
                    )}>
                      <MessageBody m={m} isOutbound={isOutbound} />
                      {!groupedWithNext && (
                        <p className={cn('mt-0.5 flex items-center gap-1 text-xs', isBlocked ? 'text-red-500' : isOutbound ? 'text-brand-200' : 'text-ink-400')}>
                          {timeAgo(m.created_at)}
                          {/* Status only makes sense for OUTBOUND messages
                              (whether the recipient got/read what WE sent) --
                              real WhatsApp never shows a status indicator on
                              a message the other person sent. Matches
                              official WhatsApp's tick convention: one check
                              = sent, two gray checks = delivered, two BLUE
                              checks = read. Failed/blocked stay as text --
                              too important to bury in an icon. */}
                          {isOutbound && !isBlocked && <MessageStatusIndicator status={m.status} />}
                          {isBlocked && <>· {m.status}</>}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {messages.length === 0 && <p className="py-8 text-center text-sm text-ink-400">No messages yet — send the first one below.</p>}
            </div>

            <div className="flex items-center gap-2 border-t border-ink-100 px-3 py-2">
              {isSimulationMode && (
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void handleSimulateInbound()}><MessageSquarePlus size={14} /> Simulate inbound</Button>
              )}
              <div className="ml-auto flex items-center gap-1">
                <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleAddTag()} placeholder="add tag" className="w-24 rounded-md border border-ink-200 px-2 py-1 text-xs outline-none" />
                <button onClick={() => void handleAddTag()} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100"><Tag size={14} /></button>
                <button onClick={() => setShowNote((v) => !v)} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100"><StickyNote size={14} /></button>
              </div>
            </div>
            {showNote && (
              <div className="flex gap-2 border-t border-ink-100 px-3 py-2">
                <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Internal note (not sent to lead)" className="input py-1.5 text-sm" />
                <Button onClick={() => void handleAddNote()} className="text-xs">Save note</Button>
              </div>
            )}
            <Composer conversationId={active.id} onSend={sendMessage} messages={messages} leadContext={leadContext} />
          </>
        ) : isNotConnected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
              <MessageSquarePlus size={22} className="text-brand-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">
                {settingsError ? 'Could not load WhatsApp settings' : 'Connect WhatsApp to start messaging'}
              </p>
              <p className="mt-1 max-w-xs text-xs text-ink-500">
                {settingsError ? settingsError : 'Link your WhatsApp Business number to send and receive real messages here.'}
              </p>
            </div>
            <Button onClick={onGoToSettings} className="mt-1">Go to WhatsApp Settings</Button>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-400">Select a conversation</div>
        )}
      </div>

      {/* Lead context panel */}
      {showContext && (
        <div className="hidden h-full min-h-0 flex-col overflow-y-auto border-l border-ink-100 lg:col-span-3 lg:flex">
          {active && leadContext ? (
            <>
              {/* Identity header */}
              <div className="flex flex-col items-center gap-2 border-b border-ink-100 bg-gradient-to-b from-brand-50/60 to-transparent px-5 py-6 text-center">
                <Avatar name={leadContext.name} color={avatarColor(active.phone)} size={60} />
                <div>
                  <p className="font-semibold text-ink-900">{leadContext.name}</p>
                  {leadContext.company && <p className="text-xs text-ink-500">{leadContext.company}</p>}
                  {active.phone && (
                    <p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-ink-400">
                      <Phone size={11} /> {active.phone}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  <Badge tone={leadContext.lead_temperature === 'Hot' ? 'red' : leadContext.lead_temperature === 'Warm' ? 'amber' : 'gray'}>{leadContext.lead_temperature}</Badge>
                  <Badge tone="blue">Score {leadContext.qualification_score}</Badge>
                </div>
              </div>

              <div className="flex-1 divide-y divide-ink-100 px-5">
                <Section title="Lead">
                  <Detail icon={<Megaphone size={13} />} label="Source" value={leadContext.source} />
                  <Detail icon={<Link2 size={13} />} label="UTM" value={`${leadContext.utm_source || '—'} / ${leadContext.utm_medium || '—'}`} />
                  <Detail icon={<KanbanSquare size={13} />} label="Pipeline stage" value={leadContext.pipeline_stage?.replace(/_/g, ' ') || 'No deal'} />
                  <Detail icon={<UserCog size={13} />} label="Owner" value={nameById(active.assigned_user_id)} />
                  <Detail icon={<Clock size={13} />} label="Last contacted" value={timeAgo(leadContext.last_contacted_at)} />
                </Section>

                <Section title="Deal">
                  <Detail icon={<CreditCard size={13} />} label="Payment" value={leadContext.payment_status || 'None'} />
                  <Detail icon={<Wallet size={13} />} label="Deal value" value={formatCurrency(leadContext.value)} />
                </Section>

                <Section title="Response timer">
                  <div className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                    active.unread_count > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700',
                  )}>
                    <Clock size={14} /> {active.unread_count > 0 ? 'Reply pending' : 'Up to date'}
                  </div>
                </Section>

                {active.tags.length > 0 && (
                  <Section title="Tags">
                    <div className="flex flex-wrap gap-1.5">
                      {active.tags.map((t, i) => (
                        <button key={i} onClick={() => void removeTag(t)} title="Remove tag">
                          <Badge tone="teal">{t} ×</Badge>
                        </button>
                      ))}
                    </div>
                  </Section>
                )}

                {notes.length > 0 && (
                  <Section title="Internal notes">
                    <div className="space-y-1.5">
                      {notes.map((n) => <p key={n.id} className="rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs leading-relaxed text-ink-600">{n.body}</p>)}
                    </div>
                  </Section>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-ink-400"><UserPlus size={20} /></div>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders a message's content by type -- image preview, document
 * download link, native audio player for voice notes, or plain text.
 * Caption (m.content) shows below media when present, same as WhatsApp's
 * own client. */
function MessageBody({ m, isOutbound }: { m: Message; isOutbound: boolean }) {
  // Inbound media that's still being fetched from Meta + re-uploaded to
  // Cloudinary (see BACKEND metaWebhook.service.js's _fetchAndAttachInboundMedia)
  // -- the message record already exists (type is correct) but
  // media_url isn't ready yet. Shown as a real "downloading" bubble
  // (matching what real WhatsApp does) instead of either a blank
  // paragraph or nothing at all -- a second socket push swaps this out
  // for the loaded media automatically once it's ready, no polling.
  if ((m.type === 'image' || m.type === 'document' || m.type === 'audio') && !m.media_url) {
    const label = m.type === 'image' ? 'Photo' : m.type === 'audio' ? 'Voice message' : 'Document';
    const Icon = m.type === 'image' ? ImageIcon : m.type === 'audio' ? Mic : FileText;
    return (
      <div className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2', isOutbound ? 'bg-white/10' : 'bg-ink-50')}>
        <Icon size={18} className="shrink-0 opacity-70" />
        <span className="text-sm">{label}</span>
        <span className={cn('h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70', isOutbound ? 'ml-auto' : 'ml-auto')} />
      </div>
    );
  }

  if (m.type === 'image' && m.media_url) {
    return (
      <div>
        <a href={m.media_url} target="_blank" rel="noopener noreferrer">
          <img src={m.media_url} alt={m.content || 'Image'} className="max-h-64 w-full rounded-lg object-cover" />
        </a>
        {m.content && <p className="mt-1.5">{m.content}</p>}
      </div>
    );
  }

  if (m.type === 'document' && m.media_url) {
    return (
      <div>
        <a
          href={m.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2',
            isOutbound ? 'bg-white/10 hover:bg-white/15' : 'bg-ink-50 hover:bg-ink-100',
          )}
        >
          <FileText size={20} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.media_filename || 'Document'}</span>
          <Download size={14} className="shrink-0 opacity-70" />
        </a>
        {m.content && <p className="mt-1.5">{m.content}</p>}
      </div>
    );
  }

  if (m.type === 'audio' && m.media_url) {
    return <AudioPlayer src={m.media_url} isOutbound={isOutbound} />;
  }

  return <p>{m.content}</p>;
}

/**
 * Custom audio player for voice-note/audio messages -- replaces the raw
 * browser-native <audio controls> widget (inconsistent styling across
 * browsers, looks like an unstyled HTML element, not a real product UI).
 * Play/pause + a real clickable progress bar + time display, matching
 * the message bubble's color (white icon/track on the green outbound
 * bubble, brand-colored on the white inbound bubble) -- the audio
 * element itself stays hidden, all visible UI is custom.
 */
function AudioPlayer({ src, isOutbound }: { src: string; isOutbound: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex w-56 max-w-full items-center gap-2.5">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        className="hidden"
      />
      <button
        onClick={togglePlay}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition',
          isOutbound ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-brand-100 text-brand-700 hover:bg-brand-200',
        )}
      >
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          onClick={seek}
          className={cn('h-1.5 w-full cursor-pointer rounded-full', isOutbound ? 'bg-white/25' : 'bg-ink-200')}
        >
          <div
            className={cn('h-full rounded-full', isOutbound ? 'bg-white' : 'bg-brand-600')}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className={cn('mt-1 text-[11px] tabular-nums', isOutbound ? 'text-white/80' : 'text-ink-400')}>
          {fmt(currentTime)} / {fmt(duration)}
        </p>
      </div>
    </div>
  );
}

/**
 * Real WhatsApp-style status ticks for an OUTBOUND message -- single
 * check (sent/queued), double gray check (delivered), double BLUE check
 * (read) -- matching official WhatsApp's exact convention instead of
 * spelling the status out as text. Anything that doesn't map cleanly to
 * a tick (Draft/Pending Approval/Scheduled/Replied/Cancelled -- rare
 * pre-send or edge states) falls back to showing the plain status word,
 * same as before this change.
 */
function MessageStatusIndicator({ status }: { status: MessageStatus }) {
  if (status === 'Read') return <CheckCheck size={16} strokeWidth={2.5} className="shrink-0" style={{ color: '#53bdeb' }} />;
  if (status === 'Delivered') return <CheckCheck size={16} strokeWidth={2.5} className="shrink-0 opacity-90" />;
  if (status === 'Sent' || status === 'Replied') return <Check size={16} strokeWidth={2.5} className="shrink-0 opacity-90" />;
  if (status === 'Queued' || status === 'Scheduled') return <Clock3 size={13} className="shrink-0 opacity-70" />;
  if (status === 'Failed') return <span className="text-red-300">Failed</span>;
  return <span>· {status}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-4 first:pt-4 last:pb-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-400">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Detail({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-1.5 text-ink-400">{icon}{label}</span>
      <span className="truncate font-medium text-ink-800">{value}</span>
    </div>
  );
}