import { useState } from 'react';
import { Plus, Play, Pause, Archive, MessageCircle, Mail, Smartphone, CheckSquare, UserPlus, History } from 'lucide-react';
import { useNurtureSequences, useNurtureEnrollments } from '@/hooks/useNurture';
import { useLeads } from '@/hooks/useLeads';
import { PageHeader, Card, CardHeader, Button, Badge, Modal, Field, Input, Select, Textarea, EmptyState } from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import type { NurtureChannel, NurtureSequence, NurtureStep } from '@/types/nurture';

const channelIcon: Record<NurtureChannel, typeof Mail> = {
  WHATSAPP: MessageCircle,
  EMAIL: Mail,
  SMS: Smartphone,
  MANUAL_TASK: CheckSquare,
};
const channelLabel: Record<NurtureChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  SMS: 'SMS',
  MANUAL_TASK: 'Manual task',
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

export function Nurture() {
  const { sequences, loading, error, activate, pause, archive, create, enroll } = useNurtureSequences();
  const { enrollments } = useNurtureEnrollments();
  const { leads } = useLeads({ page: 1, limit: 100 });

  const [showCreate, setShowCreate] = useState(false);
  const [assignTo, setAssignTo] = useState<NurtureSequence | null>(null);
  const [historyFor, setHistoryFor] = useState<NurtureSequence | null>(null);
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
        steps: form.steps,
      });
      toast.success('Sequence created');
      setShowCreate(false);
      resetForm();
    } catch (err) {
      toast.error('Could not create sequence', err instanceof ApiError ? err.message : 'Please try again.');
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

  const handleAssign = async () => {
    if (!assignTo || !selLead) return;
    try {
      await enroll(assignTo.id, selLead);
      toast.success('Lead enrolled', 'Their first step will send on the next scheduler run.');
      setAssignTo(null);
    } catch (err) {
      toast.error('Could not enroll lead', err instanceof ApiError ? err.message : 'This lead may already be enrolled in this sequence.');
    }
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
                  {(seq.status === 'DRAFT' || seq.status === 'PAUSED' || seq.status === 'ACTIVE') && (
                    <Button variant="secondary" disabled={busyId === seq.id} className="px-2.5 py-1.5 text-xs" onClick={() => void handleToggle(seq)}>
                      {seq.status === 'ACTIVE' ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Activate</>}
                    </Button>
                  )}
                  {seq.status === 'PAUSED' && (
                    <Button variant="ghost" disabled={busyId === seq.id} className="px-2.5 py-1.5 text-xs text-red-600" onClick={() => void handleArchive(seq)}><Archive size={13} /> Archive</Button>
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

            <div className="space-y-3 rounded-lg border border-ink-100 p-3">
              <p className="text-xs font-medium text-ink-600">Steps</p>
              {form.steps.map((step) => (
                <div key={step.stepNumber} className="space-y-2 rounded-lg bg-ink-50 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-ink-500">Step {step.stepNumber}</p>
                    {form.steps.length > 1 && (
                      <button className="text-xs text-red-600" onClick={() => removeStep(step.stepNumber)}>Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Select value={step.channel} onChange={(e) => updateStep(step.stepNumber, { channel: e.target.value as NurtureChannel })}>
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="EMAIL">Email</option>
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
                      <Input value={step.emailSubject || ''} onChange={(e) => updateStep(step.stepNumber, { emailSubject: e.target.value })} placeholder="Email subject" />
                      <Textarea value={step.emailBody || ''} onChange={(e) => updateStep(step.stepNumber, { emailBody: e.target.value })} placeholder="Email body (HTML)" />
                    </>
                  )}
                  {step.channel === 'MANUAL_TASK' && (
                    <Input value={step.taskDescription || ''} onChange={(e) => updateStep(step.stepNumber, { taskDescription: e.target.value })} placeholder="What should the assigned person do?" />
                  )}
                  {step.channel === 'SMS' && (
                    <p className="text-xs text-amber-700">SMS steps are saved for real, but cannot send yet — no SMS provider is configured in this application.</p>
                  )}
                </div>
              ))}
              <Button variant="secondary" onClick={addStep} className="w-full text-xs"><Plus size={13} /> Add step</Button>
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
    </div>
  );
}
