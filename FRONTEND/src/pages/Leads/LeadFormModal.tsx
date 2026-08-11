import { useState } from 'react';
import { Modal, Button, Input, Field, Select } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { apiErrorMessage } from '@/lib/apiClient';
import type { Lead, LeadInput, LeadStatus } from '@/types/lead';

const SOURCES = ['Meta Ads', 'Google Ads', 'LinkedIn', 'Webinar', 'Referral', 'Organic', 'Cold Outreach', 'YouTube', 'Direct'];
const SEGMENTS = ['Coaches', 'EdTech', 'SaaS Founders', 'Ecommerce', 'Agencies', 'Consultants'];
const STATUSES: LeadStatus[] = ['New', 'Contacted', 'Qualified', 'Booked', 'Call Completed', 'Proposal Sent', 'Won', 'Lost', 'Nurture', 'Ghosted'];

interface LeadFormModalProps {
  /** Full lead record for edit mode -- must be fetched via leadsApi.get() first, since the list endpoint only returns a trimmed subset. */
  lead?: Lead;
  onClose: () => void;
  onSubmit: (data: LeadInput) => Promise<void>;
}

export function LeadFormModal({ lead, onClose, onSubmit }: LeadFormModalProps) {
  const { members } = useTeamMembers();
  const isEdit = Boolean(lead);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: lead?.name ?? '', email: lead?.email ?? '', phone: lead?.phone ?? '',
    whatsapp_number: lead?.whatsapp_number ?? '', company: lead?.company ?? '',
    source: lead?.source ?? 'Meta Ads', campaign: lead?.campaign ?? '',
    segment: lead?.segment ?? 'Coaches', status: lead?.status ?? 'New',
    value: lead?.value ?? 0, assigned_user_id: lead?.assigned_user_id ?? '',
    utm_source: lead?.utm_source ?? '', utm_medium: lead?.utm_medium ?? '', utm_campaign: lead?.utm_campaign ?? '',
  });

  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    // Not "if phone missing, block" -- which fields are actually required is
    // tenant-configurable now (Settings > Lead Fields). "name" is the one
    // exception: the backend never allows it to be un-required, so it's
    // safe (and saves a round-trip) to still catch it here specifically.
    if (!form.name.trim()) return toast.error('Name is required');

    setSaving(true);
    try {
      await onSubmit({
        ...form,
        status: form.status as LeadStatus,
        value: Number(form.value),
        whatsapp_number: form.whatsapp_number || form.phone,
        assigned_user_id: form.assigned_user_id || null,
      });
      toast.success(isEdit ? 'Lead updated' : 'Lead created', form.name);
      onClose();
    } catch (err) {
      toast.error(isEdit ? 'Could not update lead' : 'Could not create lead', apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit Lead' : 'Add New Lead'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create lead'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Company"><Input value={form.company} onChange={(e) => set('company', e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="WhatsApp number"><Input value={form.whatsapp_number} onChange={(e) => set('whatsapp_number', e.target.value)} placeholder="defaults to phone" /></Field>
        <Field label="Deal value (USD)"><Input type="number" value={form.value} onChange={(e) => set('value', e.target.value)} /></Field>
        <Field label="Source">
          <Select value={form.source} onChange={(e) => set('source', e.target.value)}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</Select>
        </Field>
        <Field label="Segment">
          <Select value={form.segment} onChange={(e) => set('segment', e.target.value)}>{SEGMENTS.map((s) => <option key={s}>{s}</option>)}</Select>
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
        </Field>
        <Field label="Assigned to">
          <Select value={form.assigned_user_id} onChange={(e) => set('assigned_user_id', e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
        </Field>
        <Field label="Campaign"><Input value={form.campaign} onChange={(e) => set('campaign', e.target.value)} /></Field>
        <Field label="UTM Source"><Input value={form.utm_source} onChange={(e) => set('utm_source', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}