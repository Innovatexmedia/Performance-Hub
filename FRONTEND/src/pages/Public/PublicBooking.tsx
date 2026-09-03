import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarDays, Clock, CheckCircle2, ChevronLeft, Building2, Check } from 'lucide-react';
import { Button, Input, Field } from '@/components/ui';
import { ApiError, apiErrorMessage } from '@/lib/apiClient';
import { publicCalcomApi } from '@/lib/publicCalcomApi';
import { applyAccentColor } from '@/utils/theme';
import type { PublicWorkspaceInfo, PublicEventType, PublicBookingResult } from '@/types/publicBooking';

/**
 * Public, unauthenticated booking page. Route: /book/:tenantId (App.tsx).
 *
 * Branded as the WORKSPACE's own booking page -- name/logo/brand color
 * come from the real tenant record (getWorkspace), and nothing in this
 * component's copy ever says "Cal.com", exposes an API key, or shows any
 * setup/testing instruction. Cal.com is purely the backend engine; the
 * customer only ever sees "InnovateX-branded" scheduling, real
 * availability, and a plain-language flow: meeting type -> date & time
 * -> your details -> confirmation. No mock/hardcoded slots anywhere --
 * every list here comes from a real backend call.
 */

type Step = 'type' | 'time' | 'details' | 'done';

const STEP_ORDER: { key: Step; label: string }[] = [
  { key: 'type', label: 'Meeting type' },
  { key: 'time', label: 'Date & time' },
  { key: 'details', label: 'Your details' },
  { key: 'done', label: 'Confirmed' },
];

export function PublicBooking() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const [workspace, setWorkspace] = useState<PublicWorkspaceInfo | null>(null);
  const [eventTypes, setEventTypes] = useState<PublicEventType[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedType, setSelectedType] = useState<PublicEventType | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<PublicBookingResult | null>(null);

  const step: Step = confirmed ? 'done' : selectedSlot ? 'details' : selectedType ? 'time' : 'type';
  const stepIndex = STEP_ORDER.findIndex((s) => s.key === step);

  // Workspace identity first -- retints the page with the tenant's real
  // brand color and shows their real name/logo, so this looks like their
  // page, not a generic third-party tool.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    publicCalcomApi.getWorkspace(tenantId)
      .then((w) => {
        if (cancelled) return;
        setWorkspace(w);
        applyAccentColor(w.primaryColor);
        if (!w.bookingAvailable) {
          setLoadError('This booking page is not available right now. Please check back later or contact us directly.');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError && err.status === 404
          ? "We couldn't find this booking page."
          : apiErrorMessage(err, "We couldn't load this booking page."));
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Real event types for this workspace, once we know booking is available.
  useEffect(() => {
    if (!tenantId || !workspace?.bookingAvailable) return;
    let cancelled = false;
    publicCalcomApi.listEventTypes(tenantId)
      .then((types) => { if (!cancelled) setEventTypes(types); })
      .catch((err: unknown) => { if (!cancelled) setLoadError(apiErrorMessage(err, 'Could not load available meeting types.')); });
    return () => { cancelled = true; };
  }, [tenantId, workspace?.bookingAvailable]);

  // Real available slots for the next 14 days once a type is picked.
  useEffect(() => {
    if (!tenantId || !selectedType) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);
    setSlots(null);

    const start = new Date();
    const end = new Date(Date.now() + 14 * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    publicCalcomApi.listSlots(tenantId, {
      eventTypeId: selectedType.id, start: fmt(start), end: fmt(end), timeZone,
    })
      .then((result) => { if (!cancelled) setSlots(result); })
      .catch((err: unknown) => { if (!cancelled) setSlotsError(apiErrorMessage(err, 'Could not load available times.')); })
      .finally(() => { if (!cancelled) setSlotsLoading(false); });

    return () => { cancelled = true; };
  }, [tenantId, selectedType, timeZone]);

  const slotsByDay = useMemo(() => {
    if (!slots) return null;
    const groups: Record<string, string[]> = {};
    for (const iso of slots) {
      const day = new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      (groups[day] ??= []).push(iso);
    }
    return groups;
  }, [slots]);

  const submit = async () => {
    if (!tenantId || !selectedType || !selectedSlot) return;
    if (!name.trim()) return setBookError('Please enter your name.');
    if (!email.trim()) return setBookError('Please enter your email.');
    setBooking(true);
    setBookError(null);
    try {
      const result = await publicCalcomApi.book(tenantId, {
        eventTypeId: selectedType.id, start: selectedSlot, name: name.trim(), email: email.trim(), timeZone,
      });
      setConfirmed(result);
    } catch (err) {
      setBookError(apiErrorMessage(err, 'This slot may have just been taken. Please go back and pick another time.'));
    } finally {
      setBooking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ink-50 to-brand-50 p-4">
      <div className="w-full max-w-lg">
        {/* Workspace identity -- real name/logo, never "Cal.com" anywhere */}
        <div className="mb-6 flex items-center justify-center gap-2.5">
          {workspace?.logoUrl ? (
            <img src={workspace.logoUrl} alt={workspace.name} className="h-10 w-10 rounded-xl object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white">
              <Building2 size={20} />
            </div>
          )}
          <div>
            <p className="font-bold text-ink-900">{workspace?.name ?? 'Book a meeting'}</p>
            <p className="text-xs text-ink-500">Schedule a time that works for you</p>
          </div>
        </div>

        {/* Step indicator -- hidden once something has gone wrong before we even know the flow */}
        {!loadError && (
          <div className="mb-5 flex items-center justify-center gap-1.5">
            {STEP_ORDER.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <div
                  className={
                    'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition ' +
                    (i < stepIndex ? 'bg-brand-600 text-white' : i === stepIndex ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500' : 'bg-ink-100 text-ink-400')
                  }
                >
                  {i < stepIndex ? <Check size={13} /> : i + 1}
                </div>
                {i < STEP_ORDER.length - 1 && <div className={'h-px w-6 ' + (i < stepIndex ? 'bg-brand-400' : 'bg-ink-200')} />}
              </div>
            ))}
          </div>
        )}

        <div className="card p-6">
          {loadError && (
            <div className="py-8 text-center">
              <p className="text-sm text-ink-600">{loadError}</p>
            </div>
          )}

          {!loadError && step === 'done' && confirmed && (
            <div className="py-6 text-center">
              <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
              <h2 className="mt-4 text-xl font-bold text-ink-900">You're booked!</h2>
              <p className="mt-2 text-sm text-ink-500">{confirmed.title}</p>
              <p className="mt-1 text-sm font-medium text-ink-800">
                {new Date(confirmed.start).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
              </p>
              <p className="mt-3 text-xs text-ink-400">A calendar invite has been sent to {email}.</p>
            </div>
          )}

          {!loadError && step !== 'done' && !eventTypes && (
            <p className="py-8 text-center text-sm text-ink-400">Loading available meeting types…</p>
          )}

          {!loadError && step === 'type' && eventTypes && (
            <div className="space-y-2">
              <h2 className="mb-3 text-sm font-semibold text-ink-700">What would you like to schedule?</h2>
              {eventTypes.length === 0 && <p className="text-sm text-ink-400">No meeting types are open for booking right now.</p>}
              {eventTypes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedType(t)}
                  className="w-full rounded-xl border border-ink-100 p-3.5 text-left transition hover:border-brand-300 hover:bg-brand-50"
                >
                  <p className="font-semibold text-ink-900">{t.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500"><Clock size={12} /> {t.lengthInMinutes} min</p>
                  {t.description && <p className="mt-1 text-xs text-ink-400">{t.description}</p>}
                </button>
              ))}
            </div>
          )}

          {!loadError && step === 'time' && selectedType && (
            <div>
              <button onClick={() => setSelectedType(null)} className="mb-3 flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
                <ChevronLeft size={14} /> Choose a different meeting type
              </button>
              <h2 className="mb-1 text-sm font-semibold text-ink-700">{selectedType.title}</h2>
              <p className="mb-3 flex items-center gap-1 text-xs text-ink-500"><CalendarDays size={12} /> Pick a time · next 14 days · {timeZone}</p>

              {slotsLoading && <p className="py-6 text-center text-sm text-ink-400">Loading available times…</p>}
              {slotsError && <p className="py-6 text-center text-sm text-red-600">{slotsError}</p>}
              {!slotsLoading && !slotsError && slotsByDay && Object.keys(slotsByDay).length === 0 && (
                <p className="py-6 text-center text-sm text-ink-400">No open times in the next 14 days. Please check back soon.</p>
              )}
              {!slotsLoading && !slotsError && slotsByDay && (
                <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                  {Object.entries(slotsByDay).map(([day, times]) => (
                    <div key={day}>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">{day}</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {times.map((iso) => (
                          <button
                            key={iso}
                            onClick={() => setSelectedSlot(iso)}
                            className="rounded-lg border border-ink-100 py-1.5 text-xs font-medium text-ink-700 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
                          >
                            {new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!loadError && step === 'details' && selectedType && selectedSlot && (
            <div>
              <button onClick={() => setSelectedSlot(null)} className="mb-3 flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
                <ChevronLeft size={14} /> Choose a different time
              </button>
              <h2 className="mb-1 text-sm font-semibold text-ink-700">{selectedType.title}</h2>
              <p className="mb-4 text-sm font-medium text-ink-800">
                {new Date(selectedSlot).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
              </p>
              <div className="space-y-3">
                <Field label="Your name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" /></Field>
                <Field label="Your email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" /></Field>
                {bookError && <p className="text-xs text-red-600">{bookError}</p>}
                <Button className="w-full justify-center" onClick={() => void submit()} disabled={booking}>
                  {booking ? 'Confirming…' : 'Confirm booking'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-400">Powered by {workspace?.name ?? 'InnovateX'} scheduling</p>
      </div>
    </div>
  );
}
