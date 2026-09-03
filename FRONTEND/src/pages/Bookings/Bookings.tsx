import { useEffect, useMemo, useState } from 'react';
import { Plus, CalendarDays, Clock, Check, X, RotateCcw, Pencil, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, Badge, Table, Th, Td, Tr, Modal, Field,
  Input, Select, Avatar, EmptyState,
} from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { formatDate } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { useBookings } from '@/hooks/useBookings';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { usePermissions } from '@/hooks/usePermissions';
import { leadsApi } from '@/lib/leadsApi';
import { ApiError } from '@/lib/apiClient';
import { SELECTABLE_STATUS_VALUES, MEETING_TYPE_VALUES } from '@/types/booking';
import type { BookingStatus, Booking } from '@/types/booking';
import type { LeadListItem } from '@/types/lead';

export function Bookings() {
  const permissions = usePermissions();
  const { members, nameById } = useTeamMembers();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const query = useMemo(() => ({
    status: statusFilter === 'all' ? undefined : (statusFilter as BookingStatus),
    page,
    limit: 20,
  }), [statusFilter, page]);

  const { bookings, pagination, kpis, loading, error, refetch, createBooking, updateBooking, updateStatus, reschedule } = useBookings(query);

  useEffect(() => setPage(1), [statusFilter]);

  const [showAdd, setShowAdd] = useState(false);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleStatusChange = async (id: string, status: BookingStatus) => {
    try {
      await updateStatus(id, status);
      toast.success('Status updated');
    } catch (err) {
      toast.error('Could not update status', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Calendar / Bookings"
        description="Scheduled calls auto-update the lead status, pipeline & timeline."
        breadcrumb={['Revenue', 'Bookings']}
        actions={
          <>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
              <option value="all">All statuses</option>
              {(['Scheduled', 'Completed', 'No Show', 'Cancelled', 'Rescheduled'] as BookingStatus[]).map((s) => <option key={s}>{s}</option>)}
            </Select>
            {permissions.bookings.canCreate && (
              <Button onClick={() => setShowAdd(true)}><Plus size={16} /> New Booking</Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total bookings" value={kpis?.total ?? '—'} icon={<CalendarDays size={18} />} accent="#6366f1" />
        <KpiCard label="Upcoming" value={kpis?.upcoming ?? '—'} icon={<Clock size={18} />} accent="#8b5cf6" />
        <KpiCard label="Completed" value={kpis?.completed ?? '—'} icon={<Check size={18} />} accent="#10b981" />
        <KpiCard label="No-shows" value={kpis?.noShows ?? '—'} icon={<X size={18} />} accent="#ef4444" />
      </div>

      <Card>
        <CardHeader title="All Bookings" subtitle="Change status to reflect call outcomes" />
        {error ? (
          <EmptyState title="Couldn't load bookings" description={error} />
        ) : loading && bookings.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">Loading bookings…</p>
        ) : bookings.length === 0 ? (
          <EmptyState title="No bookings yet" description="Create a booking to get started." />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>Lead</Th><Th>Type</Th><Th>Date</Th><Th>Time</Th><Th>Owner</Th><Th>Source</Th><Th>Status</Th><Th></Th></tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <Tr key={b._id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Avatar name={b.lead_id?.name ?? '?'} size={28} color="#8b5cf6" />
                        <span className="font-medium">{b.lead_id?.name ?? 'Unknown lead'}</span>
                      </div>
                    </Td>
                    <Td>{b.meeting_type}</Td>
                    <Td>{formatDate(b.meeting_date)}</Td>
                    <Td>{b.meeting_time}</Td>
                    <Td>{nameById(b.assigned_user_id)}</Td>
                    <Td><Badge tone="blue">{b.source ?? '—'}</Badge></Td>
                    <Td>
                      {b.status === 'Rescheduled' ? (
                        <Badge tone="gray">Rescheduled</Badge>
                      ) : permissions.bookings.canUpdateStatus ? (
                        <Select
                          value={b.status}
                          onChange={(e) => void handleStatusChange(b._id, e.target.value as BookingStatus)}
                          className="w-auto py-1 text-xs"
                        >
                          {SELECTABLE_STATUS_VALUES.map((s) => <option key={s}>{s}</option>)}
                        </Select>
                      ) : (
                        <Badge tone={b.status === 'Completed' ? 'green' : b.status === 'Cancelled' || b.status === 'No Show' ? 'red' : 'blue'}>{b.status}</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        {permissions.bookings.canUpdate && b.status !== 'Completed' && b.status !== 'Cancelled' && (
                          <button
                            onClick={() => setEditingId(b._id)}
                            className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-brand-600"
                            title="Edit details"
                          >
                            <Pencil size={15} />
                          </button>
                        )}
                        {permissions.bookings.canReschedule && b.status === 'Scheduled' && (
                          <button
                            onClick={() => setReschedulingId(b._id)}
                            className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-brand-600"
                            title="Reschedule"
                          >
                            <RotateCcw size={15} />
                          </button>
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

      {showAdd && (
        <AddBookingModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { refetch(); setShowAdd(false); }}
          createBooking={createBooking}
        />
      )}
      {reschedulingId && (
        <RescheduleModal
          bookingId={reschedulingId}
          onClose={() => setReschedulingId(null)}
          onDone={() => { refetch(); setReschedulingId(null); }}
          reschedule={reschedule}
        />
      )}
      {editingId && (
        <EditBookingModal
          booking={bookings.find((b) => b._id === editingId)!}
          onClose={() => setEditingId(null)}
          onDone={() => { refetch(); setEditingId(null); }}
          updateBooking={updateBooking}
        />
      )}
    </div>
  );
}

function AddBookingModal({ onClose, onCreated, createBooking }: {
  onClose: () => void;
  onCreated: () => void;
  createBooking: ReturnType<typeof useBookings>['createBooking'];
}) {
  const { members } = useTeamMembers();
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [leadId, setLeadId] = useState('');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [meetingDate, setMeetingDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [meetingTime, setMeetingTime] = useState('14:00');
  const [meetingType, setMeetingType] = useState('Discovery Call');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    leadsApi.list({ limit: 100 }).then((r) => {
      if (cancelled) return;
      setLeads(r.data);
      if (r.data[0]) setLeadId(r.data[0].id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (members[0] && !assignedUserId) setAssignedUserId(members[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  const submit = async () => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return toast.error('Select a lead');
    if (!assignedUserId) return toast.error('Select an owner');
    setSaving(true);
    try {
      await createBooking({
        lead_id: lead.id,
        assigned_user_id: assignedUserId,
        meeting_date: meetingDate,
        meeting_time: meetingTime,
        meeting_type: meetingType as never,
        source: lead.source,
      });
      toast.success('Booking created', lead.name);
      onCreated();
    } catch (err) {
      toast.error('Could not create booking', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New Booking"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !leadId}>{saving ? 'Creating…' : 'Create booking'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Lead">
          <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.company}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} /></Field>
          <Field label="Time"><Input type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} /></Field>
        </div>
        <Field label="Meeting type">
          <Select value={meetingType} onChange={(e) => setMeetingType(e.target.value)}>
            {MEETING_TYPE_VALUES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Assigned to">
          <Select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
            {members.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
        </Field>
        <p className="text-xs text-ink-400">Creating a booking moves the lead to <strong>Booked</strong> and updates the pipeline automatically.</p>
      </div>
    </Modal>
  );
}

/**
 * EditBookingModal -- calls the generic PATCH /:id endpoint (meeting_type,
 * owner, meeting_link, notes). Deliberately does NOT touch meeting_date/
 * meeting_time/status -- those have their own dedicated flows
 * (RescheduleModal / the inline status dropdown) with their own real
 * side effects, which a generic edit must not duplicate or bypass.
 */
function EditBookingModal({ booking, onClose, onDone, updateBooking }: {
  booking: Booking;
  onClose: () => void;
  onDone: () => void;
  updateBooking: ReturnType<typeof useBookings>['updateBooking'];
}) {
  const { members } = useTeamMembers();
  const [meetingType, setMeetingType] = useState(booking.meeting_type);
  const [assignedUserId, setAssignedUserId] = useState(booking.assigned_user_id ?? '');
  const [meetingLink, setMeetingLink] = useState(booking.meeting_link ?? '');
  const [notes, setNotes] = useState(booking.notes ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await updateBooking(booking._id, {
        meeting_type: meetingType,
        assigned_user_id: assignedUserId || undefined,
        meeting_link: meetingLink || undefined,
        notes,
      });
      toast.success('Booking updated');
      onDone();
    } catch (err) {
      toast.error('Could not update booking', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Booking"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Meeting type">
          <Select value={meetingType} onChange={(e) => setMeetingType(e.target.value as never)}>
            {MEETING_TYPE_VALUES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Assigned to">
          <Select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
            {members.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
        </Field>
        <Field label="Meeting link (optional)">
          <Input value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://..." />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes about this booking" />
        </Field>
        <p className="text-xs text-ink-400">To change the date/time, use Reschedule instead — it preserves a real history of the change.</p>
      </div>
    </Modal>
  );
}

/**
 * RescheduleModal -- calls the dedicated POST /:id/reschedule endpoint,
 * which creates a NEW booking and marks this one 'Rescheduled'. Not the
 * same as just editing the date on the existing record.
 */
function RescheduleModal({ bookingId, onClose, onDone, reschedule }: {
  bookingId: string;
  onClose: () => void;
  onDone: () => void;
  reschedule: ReturnType<typeof useBookings>['reschedule'];
}) {
  const [meetingDate, setMeetingDate] = useState(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  const [meetingTime, setMeetingTime] = useState('14:00');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await reschedule(bookingId, { meeting_date: meetingDate, meeting_time: meetingTime, notes });
      toast.success('Booking rescheduled');
      onDone();
    } catch (err) {
      toast.error('Could not reschedule', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Reschedule Booking"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? 'Rescheduling…' : 'Reschedule'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="New date"><Input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} /></Field>
          <Field label="New time"><Input type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} /></Field>
        </div>
        <Field label="Reason (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Client requested a later slot" /></Field>
        <p className="text-xs text-ink-400">This creates a new booking and marks the original as Rescheduled.</p>
      </div>
    </Modal>
  );
}
