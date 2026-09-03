import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { Sparkles, MessageCircle, CalendarPlus, CreditCard, Plus } from 'lucide-react';
import { useStore } from '@/store/store';
import { useAuthStore } from '@/store/authStore';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { usePermissions } from '@/hooks/usePermissions';
import { leadsApi } from '@/lib/leadsApi';
import { bookingsApi } from '@/lib/bookingsApi';
import { whatsappInboxApi } from '@/lib/whatsappInboxApi';
import { Drawer, Badge, StatusBadge, Button, Avatar, Field, Textarea, Modal, Input, Select } from '@/components/ui';
import { MEETING_TYPE_VALUES } from '@/types/booking';
import type { MeetingType } from '@/types/booking';
import { formatCurrency, formatDateTime, timeAgo } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import type { LeadDetails } from '@/types/lead';

/** Best-effort icon for a real ACTIVITY_TYPE string, e.g. "Lead Assigned" -> user-plus. */
function iconForActivityType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('created') || t.includes('assigned')) return 'UserPlus';
  if (t.includes('note')) return 'MessageCircle';
  if (t.includes('qualified')) return 'Sparkles';
  if (t.includes('whatsapp')) return 'MessageCircle';
  if (t.includes('archived')) return 'Archive';
  if (t.includes('status')) return 'GitBranch';
  return 'Activity';
}

function TIcon({ type }: { type: string }) {
  const C = (Icons as unknown as Record<string, React.FC<{ size?: number }>>)[iconForActivityType(type)];
  return C ? <C size={13} /> : <Icons.Activity size={13} />;
}

export function LeadDrawer({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { nameById, members } = useTeamMembers();
  const permissions = usePermissions();
  const currentUserId = useAuthStore((s) => s.user?.id);
  // Payment quick-action still creates a MOCK payment -- the Payments
  // module hasn't been migrated to the real API yet, known follow-up.
  // Booking now goes through the real API via BookCallModal below.
  const { createPayment } = useStore();

  const [waLoading, setWaLoading] = useState(false);
  const [showBookCall, setShowBookCall] = useState(false);

  const [details, setDetails] = useState<LeadDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    leadsApi
      .getDetails(leadId)
      .then(setDetails)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Failed to load lead'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [leadId]);

  const addNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      await leadsApi.addNote(leadId, note.trim());
      setNote('');
      load(); // refetch so the new note + updated activity timeline both show
    } catch (err) {
      toast.error('Could not add note', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <Drawer open onClose={onClose} title="Lead Details" width="max-w-2xl">
      {loading && <p className="p-6 text-center text-sm text-ink-400">Loading…</p>}
      {error && <p className="p-6 text-center text-sm text-red-600">{error}</p>}

      {details && (() => {
        const { lead, notes, timeline, recommendation, counts } = details;
        const tempTone = lead.lead_temperature === 'Hot' ? 'red' : lead.lead_temperature === 'Warm' ? 'amber' : 'gray';

        const handleOpenWhatsApp = async () => {
          setWaLoading(true);
          try {
            const conversation = await whatsappInboxApi.findOrCreateForLead(lead.id);
            navigate('/whatsapp', { state: { tab: 'inbox', conversationId: conversation.id } });
          } catch (err) {
            toast.error('Could not open WhatsApp conversation', err instanceof ApiError ? err.message : 'Please try again.');
          } finally {
            setWaLoading(false);
          }
        };

        return (
          <>
            {/* Header */}
            <div className="flex items-start gap-3">
              <Avatar name={lead.name} color="#6366f1" size={48} />
              <div className="flex-1">
                <h3 className="text-lg font-bold text-ink-900">{lead.name}</h3>
                <p className="text-sm text-ink-500">{lead.company || '—'} · {lead.email}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusBadge status={lead.status} />
                  <Badge tone={tempTone}>{lead.lead_temperature}</Badge>
                  <Badge tone="blue">Score {lead.qualification_score}/10</Badge>
                  {lead.opt_out_status && <Badge tone="red">Opted out</Badge>}
                  <Badge tone="gray">{lead.segment}</Badge>
                </div>
              </div>
            </div>

            {/* Recommended next action -- from the backend's rules-based
                "Mock AI" (see next-action.service.js), not a real model call */}
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3.5">
              <Sparkles size={18} className="mt-0.5 shrink-0 text-brand-600" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Recommended Next Action</p>
                <p className="text-sm font-medium text-ink-800">{recommendation.nextAction}</p>
                <p className="mt-0.5 text-xs text-ink-500">{recommendation.reason}</p>
                {recommendation.suggestions.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {recommendation.suggestions.map((s, i) => (
                      <li key={i} className="text-xs text-brand-700">• {s}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Quick actions */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button
                variant="secondary" className="flex-col !py-3 text-xs"
                disabled={(!lead.phone && !lead.whatsapp_number) || waLoading}
                title={!lead.phone && !lead.whatsapp_number ? 'This lead has no phone number on file' : undefined}
                onClick={() => void handleOpenWhatsApp()}
              >
                <MessageCircle size={18} /> {waLoading ? 'Opening…' : 'WhatsApp'}
              </Button>
              <Button variant="secondary" className="flex-col !py-3 text-xs" onClick={() => navigate('/qualification')}>
                <Sparkles size={18} /> Qualify
              </Button>
              <Button variant="secondary" className="flex-col !py-3 text-xs" onClick={() => setShowBookCall(true)}>
                <CalendarPlus size={18} /> Book Call
              </Button>
              <Button variant="secondary" className="flex-col !py-3 text-xs" onClick={() => { createPayment({ lead_id: lead.id, amount: lead.value || 5000, source: lead.source, campaign: lead.campaign }); }}>
                <CreditCard size={18} /> Payment
              </Button>
            </div>

            {/* Source / UTM */}
            <Section title="Source & Attribution">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <Info label="Source" value={lead.source} />
                <Info label="Medium" value={lead.medium} />
                <Info label="Campaign" value={lead.campaign || '—'} />
                <Info label="UTM Source" value={lead.utm_source || '—'} />
                <Info label="UTM Medium" value={lead.utm_medium || '—'} />
                <Info label="UTM Campaign" value={lead.utm_campaign || '—'} />
                <Info label="UTM Content" value={lead.utm_content || '—'} />
                <Info label="UTM Term" value={lead.utm_term || '—'} />
                <Info label="Owner" value={nameById(lead.assigned_user_id)} />
              </div>
            </Section>

            {/* Linked records -- deals/calls are backend stubs (always 0) until
                the Pipeline and Calls modules are cross-wired into this
                endpoint server-side; bookings/payments/qualifications are real. */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Deals" value={counts.deals} stub />
              <Stat label="Bookings" value={counts.bookings} />
              <Stat label="Calls" value={counts.calls} stub />
              <Stat label="Qualifications" value={counts.qualifications} />
              <Stat label="Payments" value={counts.payments} />
            </div>

            {/* Notes -- real, timestamped, authored notes (LeadNote collection) */}
            <Section title={`Notes (${notes.length})`}>
              <div className="mb-3 space-y-2">
                {notes.length === 0 && <p className="text-sm text-ink-400">No notes yet.</p>}
                {notes.map((n) => (
                  <div key={n._id} className="rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
                    <p className="whitespace-pre-line">{n.text}</p>
                    <p className="mt-1 text-[11px] text-ink-400">{n.author || 'Unknown'} · {timeAgo(n.created_at)}</p>
                  </div>
                ))}
              </div>
              <Field label="Add a note">
                {permissions.leads.canUpdate ? (
                  <div className="flex gap-2">
                    <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type a note…" disabled={savingNote} />
                    <Button onClick={() => void addNote()} className="self-end" disabled={savingNote}><Plus size={16} /></Button>
                  </div>
                ) : (
                  <p className="text-xs text-ink-400">Your role does not have permission to add notes.</p>
                )}
              </Field>
            </Section>

            {/* Timeline -- real activity log from the backend */}
            <Section title="Activity Timeline">
              <div className="relative space-y-3 pl-6">
                <span className="absolute left-2 top-1 h-[calc(100%-1rem)] w-px bg-ink-200" />
                {timeline.map((t) => (
                  <div key={t._id} className="relative">
                    <span className="absolute -left-[1.4rem] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-600 ring-2 ring-white">
                      <TIcon type={t.type} />
                    </span>
                    <p className="text-sm font-medium text-ink-800">{t.type}</p>
                    <p className="text-xs text-ink-500">{t.message}</p>
                    <p className="text-[11px] text-ink-400">{formatDateTime(t.created_at)} · {timeAgo(t.created_at)}</p>
                  </div>
                ))}
                {!timeline.length && <p className="text-sm text-ink-400">No activity yet.</p>}
              </div>
            </Section>

            <div className="mt-6 flex items-center justify-between text-xs text-ink-400">
              <span>Value: {formatCurrency(lead.value)}</span>
              <span>Last contacted: {timeAgo(lead.last_contacted_at)}</span>
            </div>

            {showBookCall && (
              <BookCallModal
                leadId={lead.id}
                leadName={lead.name}
                defaultAssignedUserId={currentUserId}
                members={members}
                onClose={() => setShowBookCall(false)}
                onBooked={() => { setShowBookCall(false); load(); }}
              />
            )}
          </>
        );
      })()}
    </Drawer>
  );
}

/**
 * BookCallModal -- real POST /api/bookings via bookingsApi.create(), same
 * endpoint and side-effect chain (lead->Booked, deal create/advance,
 * timeline, notification, tracking event, email) as the Bookings page's
 * own AddBookingModal. Replaces the previous mock-store quick action.
 * Owner defaults to the current logged-in user (self-assign) since this
 * is a one-click action, but stays editable.
 */
function BookCallModal({ leadId, leadName, defaultAssignedUserId, members, onClose, onBooked }: {
  leadId: string;
  leadName: string;
  defaultAssignedUserId?: string;
  members: { id: string; fullName: string }[];
  onClose: () => void;
  onBooked: () => void;
}) {
  const [meetingDate, setMeetingDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [meetingTime, setMeetingTime] = useState('14:00');
  const [meetingType, setMeetingType] = useState<MeetingType>('Discovery Call');
  const [assignedUserId, setAssignedUserId] = useState(defaultAssignedUserId ?? members[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!assignedUserId) return toast.error('Select an owner');
    setSaving(true);
    try {
      await bookingsApi.create({
        lead_id: leadId,
        assigned_user_id: assignedUserId,
        meeting_date: meetingDate,
        meeting_time: meetingTime,
        meeting_type: meetingType,
      });
      toast.success('Call booked', leadName);
      onBooked();
    } catch (err) {
      toast.error('Could not book call', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Book Call — ${leadName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? 'Booking…' : 'Book call'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} /></Field>
          <Field label="Time"><Input type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} /></Field>
        </div>
        <Field label="Meeting type">
          <Select value={meetingType} onChange={(e) => setMeetingType(e.target.value as MeetingType)}>
            {MEETING_TYPE_VALUES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Assigned to">
          <Select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
            {members.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
        </Field>
        <p className="text-xs text-ink-400">This moves the lead to <strong>Booked</strong> and updates the pipeline automatically.</p>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">{title}</h4>
      {children}
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-ink-400">{label}</p>
      <p className="font-medium text-ink-800">{value}</p>
    </div>
  );
}
function Stat({ label, value, stub }: { label: string; value: number; stub?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-100 p-2.5 text-center" title={stub ? 'Not yet tracked on the backend for this view' : undefined}>
      <p className="text-lg font-bold text-ink-900">{stub ? '—' : value}</p>
      <p className="text-xs text-ink-500">{label}</p>
    </div>
  );
}