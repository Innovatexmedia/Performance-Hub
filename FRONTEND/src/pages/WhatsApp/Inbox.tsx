import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquarePlus, Tag, UserPlus, StickyNote, Search } from 'lucide-react';
import { Avatar, Badge, StatusBadge, Button, Select, cn } from '@/components/ui';
import { Composer } from './Composer';
import { formatCurrency, timeAgo } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { useConversations } from '@/hooks/useConversations';
import { useConversationDetails } from '@/hooks/useConversationDetails';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useWhatsAppRealtime } from '@/hooks/useWhatsAppRealtime';
import { ApiError } from '@/lib/apiClient';
import { CONVERSATION_STATUS_VALUES } from '@/types/whatsapp';
import type { ConversationStatus } from '@/types/whatsapp';

export function Inbox() {
  const { members, nameById } = useTeamMembers();

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState('');

  const listQuery = useMemo(() => ({
    search: q || undefined,
    status: statusFilter === 'all' ? undefined : (statusFilter as ConversationStatus),
    limit: 50,
  }), [q, statusFilter]);

  const { conversations, loading: listLoading, error: listError, refetch: refetchList } = useConversations(listQuery);
  const {
    details, notes, loading: detailLoading, refetch: refetchDetails,
    sendMessage, simulateInbound, assign, changeStatus, addNote, addTag, removeTag,
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

  const handleSimulateInbound = async () => {
    try {
      await simulateInbound('Thanks for reaching out! Tell me more.');
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
    <div className="grid grid-cols-12 overflow-hidden rounded-xl border border-ink-200 bg-white">
      {/* Conversation list */}
      <div className="col-span-12 flex flex-col border-r border-ink-200 md:col-span-4 lg:col-span-3">
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
        <div className="max-h-[50vh] overflow-y-auto">
          {listError && <p className="p-4 text-center text-xs text-red-600">{listError}</p>}
          {listLoading && conversations.length === 0 && <p className="p-4 text-center text-xs text-ink-400">Loading…</p>}
          {!listLoading && conversations.length === 0 && !listError && <p className="p-4 text-center text-xs text-ink-400">No conversations found.</p>}
          {conversations.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)} className={cn('flex w-full gap-2.5 border-b border-ink-50 px-3 py-3 text-left hover:bg-ink-50', c.id === activeId && 'bg-brand-50/50')}>
              <Avatar name={c.contact_name || c.phone} color="#22c55e" size={38} />
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
      <div className="col-span-12 flex flex-col md:col-span-8 lg:col-span-6">
        {detailLoading && !active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-400">Loading conversation…</div>
        ) : active ? (
          <>
            <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={active.contact_name || active.phone} color="#22c55e" size={36} />
                <div>
                  <p className="text-sm font-semibold text-ink-900">{active.contact_name || 'Unknown contact'}</p>
                  <p className="text-xs text-ink-500">{active.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Select value={active.status} onChange={(e) => void changeStatus(e.target.value)} className="w-auto py-1 text-xs">
                  {CONVERSATION_STATUS_VALUES.map((s) => <option key={s}>{s}</option>)}
                </Select>
                <Select value={active.assigned_user_id ?? ''} onChange={(e) => void assign(e.target.value)} className="w-auto py-1 text-xs" title="Assign">
                  <option value="">Unassigned</option>
                  {members.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                </Select>
              </div>
            </div>

            <div className="max-h-[50vh] space-y-2 overflow-y-auto bg-ink-50/60 p-4" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #e2e8f0 1px, transparent 0)', backgroundSize: '24px 24px' }}>
              {messages.map((m) => (
                <div key={m.id} className={cn('flex', m.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
                    m.status === 'Blocked by Opt-Out' ? 'rounded-br-sm bg-red-50 text-red-700 ring-1 ring-red-200' :
                    m.direction === 'outbound' ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-white text-ink-800',
                  )}>
                    <p>{m.content}</p>
                    <p className={cn('mt-0.5 text-[10px]', m.status === 'Blocked by Opt-Out' ? 'text-red-500' : m.direction === 'outbound' ? 'text-brand-200' : 'text-ink-400')}>
                      {timeAgo(m.created_at)} · {m.status}
                    </p>
                  </div>
                </div>
              ))}
              {messages.length === 0 && <p className="py-8 text-center text-sm text-ink-400">No messages yet — send the first one below.</p>}
            </div>

            <div className="flex items-center gap-2 border-t border-ink-100 px-3 py-2">
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void handleSimulateInbound()}><MessageSquarePlus size={14} /> Simulate inbound</Button>
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
            <Composer conversationId={active.id} onSend={sendMessage} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-400">Select a conversation</div>
        )}
      </div>

      {/* Lead context panel */}
      <div className="hidden max-h-[75vh] flex-col gap-3 overflow-y-auto border-l border-ink-200 p-4 lg:col-span-3 lg:flex">
        {active && leadContext ? (
          <>
            <div className="text-center">
              <Avatar name={leadContext.name} color="#6366f1" size={56} />
              <p className="mt-2 font-semibold text-ink-900">{leadContext.name}</p>
              <p className="text-xs text-ink-500">{leadContext.company}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              <Badge tone={leadContext.lead_temperature === 'Hot' ? 'red' : leadContext.lead_temperature === 'Warm' ? 'amber' : 'gray'}>{leadContext.lead_temperature}</Badge>
              <Badge tone="blue">Score {leadContext.qualification_score}</Badge>
            </div>
            <Detail label="Source" value={leadContext.source} />
            <Detail label="UTM" value={`${leadContext.utm_source || '—'} / ${leadContext.utm_medium || '—'}`} />
            <Detail label="Pipeline stage" value={leadContext.pipeline_stage?.replace(/_/g, ' ') || 'No deal'} />
            <Detail label="Payment" value={leadContext.payment_status || 'None'} />
            <Detail label="Owner" value={nameById(active.assigned_user_id)} />
            <Detail label="Last contacted" value={timeAgo(leadContext.last_contacted_at)} />
            <Detail label="Deal value" value={formatCurrency(leadContext.value)} />
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-400">Response timer</p>
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">⏱ {active.unread_count > 0 ? 'Reply pending' : 'Up to date'}</div>
            </div>
            {active.tags.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-400">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {active.tags.map((t, i) => (
                    <button key={i} onClick={() => void removeTag(t)} title="Remove tag">
                      <Badge tone="teal">{t} ×</Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {notes.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-400">Internal notes</p>
                {notes.map((n) => <p key={n.id} className="rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs text-ink-600">{n.body}</p>)}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-ink-400"><UserPlus size={20} /></div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-50 pb-1.5 text-sm">
      <span className="text-ink-400">{label}</span>
      <span className="font-medium text-ink-800">{value}</span>
    </div>
  );
}