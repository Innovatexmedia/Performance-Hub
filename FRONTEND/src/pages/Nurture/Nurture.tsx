import { useState, useRef, useEffect } from 'react';
import { Plus, Play, Pause, Archive, Trash2, MessageCircle, Mail, Smartphone, CheckSquare, UserPlus, History, Sparkles, Calendar, CreditCard, ShoppingBag, Globe, Link as LinkIcon, Copy, RefreshCw } from 'lucide-react';
import { useNurtureSequences, useNurtureEnrollments } from '@/hooks/useNurture';
import { nurtureApi } from '@/lib/nurtureApi';
import { useLeads } from '@/hooks/useLeads';
import { PageHeader, Card, CardHeader, Button, Badge, Modal, Field, Input, Select, Textarea, EmptyState } from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { InsertVariablePicker } from '@/components/nurture/InsertVariablePicker';
import { toast } from '@/store/toastStore';
import { ApiError, apiErrorMessage } from '@/lib/apiClient';
import type { NurtureChannel, NurtureSequence, NurtureStep } from '@/types/nurture';

const channelIcon: Record<NurtureChannel, typeof Mail> = {
  WHATSAPP: MessageCircle,
  EMAIL: Mail,
  SMS: Smartphone,
  MANUAL_TASK: CheckSquare,
  AI: Sparkles,
  BOOKING: Calendar,
  PAYMENT: CreditCard,
  SHOPIFY: ShoppingBag,
  API_REQUEST: Globe,
};
const channelLabel: Record<NurtureChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  SMS: 'SMS',
  MANUAL_TASK: 'Manual task',
  AI: 'AI Message',
  BOOKING: 'Booking',
  PAYMENT: 'Payment',
  SHOPIFY: 'Shopify',
  API_REQUEST: 'API Request',
};

const emptyStep = (stepNumber: number): NurtureStep => ({
  stepNumber,
  delayValue: stepNumber === 1 ? 0 : 2,
  delayUnit: 'DAYS',
  channel: 'WHATSAPP',
  templateId: '',
  emailSubject: '',
  emailBody: '',
  taskDescription: '',
  isActive: true,
});

/**
 * sanitizeStepForSubmit -- only a real WHATSAPP step ever needs a real
 * templateId. emptyStep() defaults every step to templateId: '' regardless
 * of channel, so a Manual Task/Email/AI/etc. step reached the backend as a
 * real, present empty-string value -- which triggered a real
 * WhatsAppTemplate lookup for a step that will never send via a WhatsApp
 * template at all (that lookup then crashed with a real Mongoose CastError
 * on the empty string). Send templateId as genuinely absent (omitted) for
 * every non-WhatsApp step, and only when a real value was actually typed
 * in for a WhatsApp step -- never as "".
 */
const sanitizeStepForSubmit = (step: NurtureStep): NurtureStep => {
  if (step.channel === 'WHATSAPP' && step.templateId) return step;
  const { templateId: _templateId, ...rest } = step;
  return rest;
};

export function Nurture() {
  const { sequences, loading, error, activate, pause, archive, remove, create, enroll } = useNurtureSequences();
  // Real refetch, not a page reload: useNurtureEnrollments already exposes
  // this via the same reload-token pattern useNurtureSequences uses -- it
  // just wasn't being called anywhere on this page. Enrolling a lead
  // creates a new enrollment doc, and opening History is exactly the
  // moment the user wants the current server-side truth, not whatever was
  // cached at page-load time.
  const { enrollments, refetch: refetchEnrollments } = useNurtureEnrollments();
  const { leads } = useLeads({ page: 1, limit: 100 });

  const [showCreate, setShowCreate] = useState(false);

  // Real refs, keyed per (step, field), so InsertVariablePicker can
  // target the exact field's cursor position rather than just appending
  // to the end.
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const fieldRef = (stepNumber: number, field: string) => {
    const key = `${stepNumber}-${field}`;
    if (!(key in fieldRefs.current)) fieldRefs.current[key] = null;
    return {
      get current() { return fieldRefs.current[key]; },
      set current(el: HTMLInputElement | HTMLTextAreaElement | null) { fieldRefs.current[key] = el; },
    } as React.RefObject<HTMLInputElement & HTMLTextAreaElement>;
  };
  const [assignTo, setAssignTo] = useState<NurtureSequence | null>(null);
  const [historyFor, setHistoryFor] = useState<NurtureSequence | null>(null);
  const [webhookUrlFor, setWebhookUrlFor] = useState<NurtureSequence | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [webhookUrlLoading, setWebhookUrlLoading] = useState(false);
  const [selLead, setSelLead] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'NURTURE',
    triggerType: 'MANUAL' as string,
    qualificationTemperature: '' as string,
    steps: [emptyStep(1)],
  });

  const activeCount = sequences.filter((s) => s.status === 'ACTIVE').length;
  const enrolledActive = enrollments.filter((e) => e.status === 'ACTIVE').length;
  const completedCount = enrollments.filter((e) => e.status === 'COMPLETED').length;

  // Real refetch on open, not stale page state: the History modal shows
  // each enrollment's current status/step/executionHistory, all of which
  // change server-side on their own schedule (the nurture scheduler
  // executing steps, or a booking/reply/opt-out pausing an enrollment) --
  // none of those are actions this page itself triggers, so the only
  // correct moment to get the current truth is the moment the user asks
  // to see it, which is exactly when this modal opens.
  useEffect(() => {
    if (historyFor) refetchEnrollments();
  }, [historyFor, refetchEnrollments]);

  const resetForm = () => setForm({ name: '', description: '', type: 'NURTURE', triggerType: 'MANUAL', qualificationTemperature: '', steps: [emptyStep(1)] });

  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, emptyStep(f.steps.length + 1)] }));
  const removeStep = (stepNumber: number) =>
    setForm((f) => ({ ...f, steps: f.steps.filter((s) => s.stepNumber !== stepNumber).map((s, i) => ({ ...s, stepNumber: i + 1 })) }));
  const updateStep = (stepNumber: number, patch: Partial<NurtureStep>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s) => (s.stepNumber === stepNumber ? { ...s, ...patch } : s)) }));

  const handleCreate = async () => {
    if (!form.name.trim()) return toast.error('Name required');
    if (form.triggerType === 'LEAD_QUALIFIED' && !form.qualificationTemperature) {
      return toast.error('Pick which lead temperature (Cold or Warm) should auto-enroll into this sequence');
    }
    setSaving(true);
    try {
      await create({
        name: form.name,
        description: form.description,
        type: form.type as NurtureSequence['type'],
        triggerType: form.triggerType as NurtureSequence['triggerType'],
        qualificationTemperature: (form.qualificationTemperature || null) as NurtureSequence['qualificationTemperature'],
        steps: form.steps.map(sanitizeStepForSubmit),
      });
      toast.success('Sequence created');
      setShowCreate(false);
      resetForm();
    } catch (err) {
      // apiErrorMessage: same existing pattern already used in
      // LeadFormModal.tsx. The backend's real 400 response already
      // carries a field-level `errors` array (e.g. "templateId must be a
      // valid id") -- err.message alone was only ever the generic
      // "Validation failed", hiding exactly which field/rule failed.
      toast.error('Could not create sequence', apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (seq: NurtureSequence) => {
    setBusyId(seq.id);
    try {
      if (seq.status === 'DRAFT' || seq.status === 'PAUSED') {
        await activate(seq.id);
        toast.success('Sequence activated — real scheduled sending is now live for enrolled leads');
      } else if (seq.status === 'ACTIVE') {
        await pause(seq.id);
        toast.success('Sequence paused');
      }
    } catch (err) {
      toast.error('Could not update sequence', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (seq: NurtureSequence) => {
    setBusyId(seq.id);
    try {
      await archive(seq.id);
      toast.success('Sequence archived');
    } catch (err) {
      toast.error('Could not archive sequence', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  // BUG FIX: real DELETE endpoint already existed backend-side with no
  // frontend control anywhere -- see useNurtureSequences' remove(). Same
  // window.confirm pattern already used for destructive deletes elsewhere
  // in this app (Team, Templates, WhatsApp Panel), for consistency.
  const handleDelete = async (seq: NurtureSequence) => {
    if (!window.confirm(`Delete "${seq.name}"? This cannot be undone -- active enrollments will stop.`)) return;
    setBusyId(seq.id);
    try {
      await remove(seq.id);
      toast.success('Sequence deleted');
    } catch (err) {
      toast.error('Could not delete sequence', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAssign = async () => {
    if (!assignTo || !selLead) return;
    try {
      await enroll(assignTo.id, selLead);
      // Real refetch: enroll() creates a new enrollment doc server-side,
      // but useNurtureSequences (where enroll lives) has no knowledge of
      // useNurtureEnrollments' separate state -- without this, "Currently
      // enrolled" and the History modal stayed stale until a full reload.
      refetchEnrollments();
      toast.success('Lead enrolled', 'Their first step will send on the next scheduler run.');
      setAssignTo(null);
    } catch (err) {
      toast.error('Could not enroll lead', err instanceof ApiError ? err.message : 'This lead may already be enrolled in this sequence.');
    }
  };

  const openWebhookUrl = async (seq: NurtureSequence) => {
    setWebhookUrlFor(seq);
    setWebhookUrl(null);
    setWebhookUrlLoading(true);
    try {
      const res = await nurtureApi.getWebhookUrl(seq.id);
      setWebhookUrl(res.url);
    } catch (err) {
      toast.error('Could not load webhook URL', err instanceof ApiError ? err.message : 'Please try again.');
      setWebhookUrlFor(null);
    } finally {
      setWebhookUrlLoading(false);
    }
  };

  const handleRegenerateWebhookUrl = async () => {
    if (!webhookUrlFor) return;
    setWebhookUrlLoading(true);
    try {
      const res = await nurtureApi.regenerateWebhookUrl(webhookUrlFor.id);
      setWebhookUrl(res.url);
      toast.success('Webhook URL regenerated', 'The previous URL no longer works — update any external tool using it.');
    } catch (err) {
      toast.error('Could not regenerate webhook URL', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setWebhookUrlLoading(false);
    }
  };

  const handleCopyWebhookUrl = async () => {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    toast.success('Copied to clipboard');
  };

  if (error) {
    return <div className="p-6"><EmptyState title="Could not load nurture sequences" description={error} /></div>;
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Nurture Engine"
        description="Real, scheduled multi-channel sequences — WhatsApp, Email, and manual tasks"
        actions={<Button onClick={() => setShowCreate(true)}><Plus size={15} /> New sequence</Button>}
      />

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Active sequences" value={String(activeCount)} icon={<Play size={16} />} />
        <KpiCard label="Total sequences" value={String(sequences.length)} icon={<History size={16} />} />
        <KpiCard label="Currently enrolled" value={String(enrolledActive)} icon={<UserPlus size={16} />} />
        <KpiCard label="Completed enrollments" value={String(completedCount)} icon={<CheckSquare size={16} />} />
      </div>

      <Card className="mt-4">
        <CardHeader title="Sequences" subtitle={loading ? 'Loading…' : `${sequences.length} sequence(s)`} />
        {sequences.length === 0 && !loading ? (
          <EmptyState title="No sequences yet" description="Create your first real nurture sequence to get started." action={<Button onClick={() => setShowCreate(true)}>New sequence</Button>} />
        ) : (
          <div className="divide-y divide-ink-100">
            {sequences.map((seq) => (
              <div key={seq.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-ink-900">{seq.name}</p>
                    <Badge tone={seq.status === 'ACTIVE' ? 'green' : seq.status === 'DRAFT' ? 'gray' : seq.status === 'ARCHIVED' ? 'gray' : 'amber'}>{seq.status}</Badge>
                    {seq.triggerType === 'LEAD_QUALIFIED' && seq.qualificationTemperature && (
                      <Badge tone="blue">Auto-enrolls {seq.qualificationTemperature} leads</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">{seq.description || 'No description'}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {seq.steps.map((step) => {
                      const Icon = channelIcon[step.channel] || MessageCircle;
                      return (
                        <span key={step.stepNumber} className="flex items-center gap-1 rounded-md border border-ink-100 px-2 py-1 text-xs text-ink-600">
                          <Icon size={12} /> Step {step.stepNumber} · {channelLabel[step.channel]} · +{step.delayValue}{step.delayUnit.toLowerCase().slice(0, 1)}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => setHistoryFor(seq)}><History size={13} /> History</Button>
                  {seq.status !== 'ARCHIVED' && seq.status !== 'COMPLETED' && (
                    <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => setAssignTo(seq)}><UserPlus size={13} /> Enroll lead</Button>
                  )}
                  {seq.triggerType === 'CUSTOM' && (
                    <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => void openWebhookUrl(seq)}><LinkIcon size={13} /> Webhook URL</Button>
                  )}
                  {(seq.status === 'DRAFT' || seq.status === 'PAUSED' || seq.status === 'ACTIVE') && (
                    <Button variant="secondary" disabled={busyId === seq.id} className="px-2.5 py-1.5 text-xs" onClick={() => void handleToggle(seq)}>
                      {seq.status === 'ACTIVE' ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Activate</>}
                    </Button>
                  )}
                  {seq.status === 'PAUSED' && (
                    <>
                    <Button variant="ghost" disabled={busyId === seq.id} className="px-2.5 py-1.5 text-xs text-red-600" onClick={() => void handleArchive(seq)}><Archive size={13} /> Archive</Button>
                    <Button variant="ghost" disabled={busyId === seq.id} className="px-2.5 py-1.5 text-xs text-red-600" onClick={() => void handleDelete(seq)}><Trash2 size={13} /> Delete</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showCreate && (
        <Modal
          open onClose={() => setShowCreate(false)} title="New Nurture Sequence"
          footer={<><Button variant="secondary" onClick={() => setShowCreate(false)} disabled={saving}>Cancel</Button><Button onClick={() => void handleCreate()} disabled={saving}>{saving ? 'Creating…' : 'Create sequence'}</Button></>}
        >
          <div className="space-y-4">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ghosted Re-Engagement" /></Field>
            <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Trigger">
              <Select value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })}>
                <option value="MANUAL">Manual enrollment only</option>
                <option value="LEAD_QUALIFIED">Auto-enroll on AI Qualification</option>
                <option value="LEAD_CREATED">Lead created</option>
                <option value="BOOKING_CREATED">Booking created</option>
                <option value="CUSTOM">Incoming webhook</option>
              </Select>
            </Field>
            {form.triggerType === 'LEAD_QUALIFIED' && (
              <Field label="Auto-enroll which temperature?" hint="A lead scored this way by AI Qualification will automatically enter this sequence.">
                <Select value={form.qualificationTemperature} onChange={(e) => setForm({ ...form, qualificationTemperature: e.target.value })}>
                  <option value="">Select…</option>
                  <option value="Cold">Cold</option>
                  <option value="Warm">Warm</option>
                </Select>
              </Field>
            )}

            <div className="space-y-0 rounded-lg border border-ink-100 p-3">
              <p className="mb-2 text-xs font-medium text-ink-600">Workflow</p>

              {/* Real visual start-of-flow node -- reflects the trigger picked above. */}
              <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">▶</span>
                <p className="text-xs font-medium text-brand-700">
                  Trigger: {form.triggerType === 'MANUAL' ? 'Manual enrollment only' : form.triggerType === 'LEAD_QUALIFIED' ? `AI Qualification (${form.qualificationTemperature || '…'})` : form.triggerType === 'LEAD_CREATED' ? 'Lead created' : form.triggerType === 'BOOKING_CREATED' ? 'Booking created' : 'Incoming webhook'}
                </p>
              </div>

              {form.steps.map((step) => {
                const Icon = channelIcon[step.channel] || MessageCircle;
                return (
                <div key={step.stepNumber}>
                  {/* Real connecting line + arrow -- every step, including the first (connects down from the Trigger node above). */}
                  <div className="flex justify-start pl-[15px]">
                    <div className="h-4 w-px bg-ink-200" />
                  </div>
                  <div className="space-y-2 rounded-lg bg-ink-50 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-ink-500 shadow-sm"><Icon size={13} /></span>
                        <p className="text-xs font-medium text-ink-500">Step {step.stepNumber} — {channelLabel[step.channel]}</p>
                      </div>
                      {form.steps.length > 1 && (
                        <button className="text-xs text-red-600" onClick={() => removeStep(step.stepNumber)}>Remove</button>
                      )}
                    </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Select value={step.channel} onChange={(e) => updateStep(step.stepNumber, { channel: e.target.value as NurtureChannel })}>
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="EMAIL">Email</option>
                      <option value="AI">AI Message</option>
                      <option value="BOOKING">Booking</option>
                      <option value="PAYMENT">Payment</option>
                      <option value="SHOPIFY">Shopify</option>
                      <option value="API_REQUEST">API Request / Webhook</option>
                      <option value="MANUAL_TASK">Manual task</option>
                      <option value="SMS">SMS (not yet sendable)</option>
                    </Select>
                    <Input type="number" min={0} value={step.delayValue} onChange={(e) => updateStep(step.stepNumber, { delayValue: Number(e.target.value) })} placeholder="Delay" />
                    <Select value={step.delayUnit} onChange={(e) => updateStep(step.stepNumber, { delayUnit: e.target.value as NurtureStep['delayUnit'] })}>
                      <option value="MINUTES">Minutes</option>
                      <option value="HOURS">Hours</option>
                      <option value="DAYS">Days</option>
                      <option value="WEEKS">Weeks</option>
                    </Select>
                  </div>

                  {step.channel === 'WHATSAPP' && (
                    <Input value={step.templateId || ''} onChange={(e) => updateStep(step.stepNumber, { templateId: e.target.value })} placeholder="WhatsApp Template ID" />
                  )}

                  {step.channel === 'EMAIL' && (
                    <>
                      <div className="flex items-center gap-2">
                        <Input ref={fieldRef(step.stepNumber, 'emailSubject')} value={step.emailSubject || ''} onChange={(e) => updateStep(step.stepNumber, { emailSubject: e.target.value })} placeholder="Email subject" />
                        <InsertVariablePicker targetRef={fieldRef(step.stepNumber, 'emailSubject')} onInsert={(v) => updateStep(step.stepNumber, { emailSubject: v })} />
                      </div>
                      <div className="flex items-start gap-2">
                        <Textarea ref={fieldRef(step.stepNumber, 'emailBody')} value={step.emailBody || ''} onChange={(e) => updateStep(step.stepNumber, { emailBody: e.target.value })} placeholder="Email body (HTML)" />
                        <InsertVariablePicker targetRef={fieldRef(step.stepNumber, 'emailBody')} onInsert={(v) => updateStep(step.stepNumber, { emailBody: v })} />
                      </div>
                    </>
                  )}

                  {step.channel === 'AI' && (
                    <>
                      <p className="text-xs text-ink-500">Generates a personalized WhatsApp message using your connected AI provider (Claude/Gemini).</p>
                      <div className="flex items-center gap-2">
                        <Input ref={fieldRef(step.stepNumber, 'aiGoal')} value={step.aiGoal || ''} onChange={(e) => updateStep(step.stepNumber, { aiGoal: e.target.value })} placeholder="Goal, e.g. remind them about their upcoming call" />
                        <InsertVariablePicker targetRef={fieldRef(step.stepNumber, 'aiGoal')} onInsert={(v) => updateStep(step.stepNumber, { aiGoal: v })} />
                      </div>
                      <Select value={step.aiTone || 'Professional'} onChange={(e) => updateStep(step.stepNumber, { aiTone: e.target.value })}>
                        <option value="Professional">Professional</option>
                        <option value="Friendly">Friendly</option>
                        <option value="Persuasive">Persuasive</option>
                        <option value="Empathetic">Empathetic</option>
                      </Select>
                    </>
                  )}

                  {step.channel === 'BOOKING' && (
                    <>
                      <Select value={step.bookingAction || 'CHECK_STATUS'} onChange={(e) => updateStep(step.stepNumber, { bookingAction: e.target.value as NurtureStep['bookingAction'] })}>
                        <option value="CHECK_STATUS">Check booking status</option>
                        <option value="SEND_LINK">Send existing booking link</option>
                        <option value="SEND_REMINDER">Send booking reminder</option>
                        <option value="CREATE">Create booking (requires a real date/time below)</option>
                      </Select>
                      {step.bookingAction === 'CREATE' && (
                        <>
                          <Input value={step.bookingMeetingType || ''} onChange={(e) => updateStep(step.stepNumber, { bookingMeetingType: e.target.value })} placeholder="Meeting type, e.g. Discovery Call" />
                          <div className="grid grid-cols-2 gap-2">
                            <Input value={step.bookingDate || ''} onChange={(e) => updateStep(step.stepNumber, { bookingDate: e.target.value })} placeholder="Date (YYYY-MM-DD)" />
                            <Input value={step.bookingTime || ''} onChange={(e) => updateStep(step.stepNumber, { bookingTime: e.target.value })} placeholder="Time (HH:MM)" />
                          </div>
                          <p className="text-xs text-amber-700">A booking is only created if both a real date and time are set — never auto-generated.</p>
                        </>
                      )}
                    </>
                  )}

                  {step.channel === 'PAYMENT' && (
                    <>
                      <Select value={step.paymentAction || 'CHECK_STATUS'} onChange={(e) => updateStep(step.stepNumber, { paymentAction: e.target.value as NurtureStep['paymentAction'] })}>
                        <option value="CHECK_STATUS">Check payment status</option>
                        <option value="CREATE_REQUEST">Create payment request</option>
                      </Select>
                      {step.paymentAction === 'CREATE_REQUEST' && (
                        <>
                          <Input type="number" min={0} value={step.paymentAmount ?? ''} onChange={(e) => updateStep(step.stepNumber, { paymentAmount: Number(e.target.value) })} placeholder="Amount" />
                          <div className="flex items-center gap-2">
                            <Input ref={fieldRef(step.stepNumber, 'paymentNote')} value={step.paymentNote || ''} onChange={(e) => updateStep(step.stepNumber, { paymentNote: e.target.value })} placeholder="Message shown with the payment link" />
                            <InsertVariablePicker targetRef={fieldRef(step.stepNumber, 'paymentNote')} onInsert={(v) => updateStep(step.stepNumber, { paymentNote: v })} />
                          </div>
                          <p className="text-xs text-ink-500">Creates a real InnovateX payment record and sends its real link — this is not a Cashfree checkout, since no lead-facing Cashfree integration exists yet.</p>
                        </>
                      )}
                    </>
                  )}

                  {step.channel === 'SHOPIFY' && (
                    <>
                      <div className="flex items-center gap-2">
                        <Input ref={fieldRef(step.stepNumber, 'shopifyOrderId')} value={step.shopifyOrderId || ''} onChange={(e) => updateStep(step.stepNumber, { shopifyOrderId: e.target.value })} placeholder="Shopify Order ID (or a variable)" />
                        <InsertVariablePicker targetRef={fieldRef(step.stepNumber, 'shopifyOrderId')} onInsert={(v) => updateStep(step.stepNumber, { shopifyOrderId: v })} />
                      </div>
                      <p className="text-xs text-ink-500">Looks up this specific order and makes its details available as variables (e.g. <code>{'{{shopify.fulfillment_status}}'}</code>) for later steps.</p>
                    </>
                  )}

                  {step.channel === 'API_REQUEST' && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <Select value={step.apiMethod || 'POST'} onChange={(e) => updateStep(step.stepNumber, { apiMethod: e.target.value as NurtureStep['apiMethod'] })}>
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="PATCH">PATCH</option>
                          <option value="DELETE">DELETE</option>
                        </Select>
                        <div className="col-span-2 flex items-center gap-2">
                          <Input ref={fieldRef(step.stepNumber, 'apiUrl')} value={step.apiUrl || ''} onChange={(e) => updateStep(step.stepNumber, { apiUrl: e.target.value })} placeholder="https://..." />
                          <InsertVariablePicker targetRef={fieldRef(step.stepNumber, 'apiUrl')} onInsert={(v) => updateStep(step.stepNumber, { apiUrl: v })} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-ink-500">Headers</p>
                        {(step.apiHeaders || []).map((h, i) => (
                          <div key={i} className="flex gap-2">
                            <Input value={h.key} onChange={(e) => {
                              const headers = [...(step.apiHeaders || [])];
                              headers[i] = { ...headers[i], key: e.target.value };
                              updateStep(step.stepNumber, { apiHeaders: headers });
                            }} placeholder="Header name" />
                            <Input value={h.value} onChange={(e) => {
                              const headers = [...(step.apiHeaders || [])];
                              headers[i] = { ...headers[i], value: e.target.value };
                              updateStep(step.stepNumber, { apiHeaders: headers });
                            }} placeholder="Value" />
                            <button className="text-xs text-red-600" onClick={() => {
                              updateStep(step.stepNumber, { apiHeaders: (step.apiHeaders || []).filter((_, hi) => hi !== i) });
                            }}>Remove</button>
                          </div>
                        ))}
                        <Button variant="secondary" className="text-xs" onClick={() => updateStep(step.stepNumber, { apiHeaders: [...(step.apiHeaders || []), { key: '', value: '' }] })}>
                          <Plus size={12} /> Add header
                        </Button>
                      </div>
                      {step.apiMethod !== 'GET' && (
                        <div className="flex items-start gap-2">
                          <Textarea ref={fieldRef(step.stepNumber, 'apiBody')} value={step.apiBody || ''} onChange={(e) => updateStep(step.stepNumber, { apiBody: e.target.value })} placeholder="Request body (JSON)" />
                          <InsertVariablePicker targetRef={fieldRef(step.stepNumber, 'apiBody')} onInsert={(v) => updateStep(step.stepNumber, { apiBody: v })} />
                        </div>
                      )}
                      <p className="text-xs text-ink-500">Requests to private/internal addresses are automatically blocked for security.</p>
                    </>
                  )}

                  {step.channel === 'MANUAL_TASK' && (
                    <div className="flex items-center gap-2">
                      <Input ref={fieldRef(step.stepNumber, 'taskDescription')} value={step.taskDescription || ''} onChange={(e) => updateStep(step.stepNumber, { taskDescription: e.target.value })} placeholder="What should the assigned person do?" />
                      <InsertVariablePicker targetRef={fieldRef(step.stepNumber, 'taskDescription')} onInsert={(v) => updateStep(step.stepNumber, { taskDescription: v })} />
                    </div>
                  )}

                  {step.channel === 'SMS' && (
                    <p className="text-xs text-amber-700">SMS steps are saved for real, but cannot send yet — no SMS provider is configured in this application.</p>
                  )}
                  </div>
                </div>
                );
              })}
              <Button variant="secondary" onClick={addStep} className="mt-3 w-full text-xs"><Plus size={13} /> Add step</Button>
            </div>
          </div>
        </Modal>
      )}

      {assignTo && (
        <Modal open onClose={() => setAssignTo(null)} title={`Enroll a lead — ${assignTo.name}`} footer={<Button onClick={() => void handleAssign()} disabled={!selLead}>Enroll</Button>}>
          <Field label="Lead">
            <Select value={selLead} onChange={(e) => setSelLead(e.target.value)}>
              <option value="">Select a lead…</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.email}</option>)}
            </Select>
          </Field>
        </Modal>
      )}

      {historyFor && (
        <Modal open onClose={() => setHistoryFor(null)} title={`Execution history — ${historyFor.name}`}>
          <div className="space-y-2">
            {enrollments.filter((e) => e.sequenceId === historyFor.id).length === 0 ? (
              <p className="text-sm text-ink-400">No enrollments yet for this sequence.</p>
            ) : (
              enrollments.filter((e) => e.sequenceId === historyFor.id).map((e) => (
                <div key={e.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge tone={e.status === 'ACTIVE' ? 'green' : e.status === 'FAILED' ? 'red' : e.status === 'COMPLETED' ? 'blue' : 'gray'}>{e.status}</Badge>
                    {e.pauseReason && <span className="text-xs text-ink-400">Paused: {e.pauseReason}</span>}
                  </div>
                  <p className="mt-1 text-xs text-ink-500">Step {e.currentStep} · {e.executionHistory.length} execution(s) recorded</p>
                  {e.lastError && <p className="mt-1 text-xs text-red-600">{e.lastError}</p>}
                </div>
              ))
            )}
          </div>
        </Modal>
      )}

      {webhookUrlFor && (
        <Modal open onClose={() => setWebhookUrlFor(null)} title={`Webhook URL — ${webhookUrlFor.name}`}>
          <div className="space-y-3">
            <p className="text-xs text-ink-500">
              A real, external system (a form builder, another CRM, Zapier/Make, or a custom script) can <code>POST</code> a JSON payload with at least an <code>email</code> or <code>phone</code> to this URL to automatically match or create a lead and enroll them here. Every field in the payload becomes a real workflow variable (<code>{'{{webhook.fieldname}}'}</code>) for later steps.
            </p>
            {webhookUrlLoading ? (
              <p className="text-sm text-ink-400">Loading…</p>
            ) : webhookUrl ? (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-ink-100 bg-ink-50 p-2.5">
                  <code className="flex-1 overflow-x-auto whitespace-nowrap text-xs text-ink-700">{webhookUrl}</code>
                  <Button variant="secondary" className="shrink-0 px-2 py-1 text-xs" onClick={() => void handleCopyWebhookUrl()}><Copy size={12} /> Copy</Button>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <strong>This URL is a real credential</strong> — anyone with it can enroll leads into this sequence. Only share it with the external system you're actually connecting.
                </div>
                <Button variant="ghost" disabled={webhookUrlLoading} className="w-full text-xs text-red-600" onClick={() => void handleRegenerateWebhookUrl()}>
                  <RefreshCw size={13} /> Regenerate URL (invalidates the current one immediately)
                </Button>
              </>
            ) : null}
          </div>
        </Modal>
      )}
    </div>
  );
}