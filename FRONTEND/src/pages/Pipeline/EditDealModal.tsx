import { useState } from 'react';
import { Modal, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { STAGE_ORDER } from '@/types/deal';
import { usePipelineStageLabels } from '@/hooks/usePipelineStageLabels';
import type { Deal, DealInput, DealStage } from '@/types/deal';

/**
 * EditDealModal -- unlike AddDealModal, lead_id is NOT editable here
 * (deal.validator.js explicitly rejects lead_id on PATCH: "lead_id cannot
 * be changed"). Every other ALLOWED_FIELD is editable.
 */
export function EditDealModal({ deal, onClose, onSave }: {
  deal: Deal;
  onClose: () => void;
  onSave: (id: string, patch: DealInput) => Promise<Deal>;
}) {
  const [title, setTitle] = useState(deal.title);
  const [description, setDescription] = useState(deal.description);
  const [value, setValue] = useState(deal.value);
  const [probability, setProbability] = useState(deal.probability);
  const [stage, setStage] = useState<DealStage>(deal.stage);
  const [source, setSource] = useState(deal.source);
  const [saving, setSaving] = useState(false);
  const { stageLabel } = usePipelineStageLabels();

  const submit = async () => {
    if (!title.trim()) return toast.error('Title is required');
    setSaving(true);
    try {
      await onSave(deal.id, { title, description, value: Number(value), probability: Number(probability), stage, source });
      toast.success('Deal updated', title);
      onClose();
    } catch (err) {
      toast.error('Could not update deal', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Deal"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Source"><Input value={source} onChange={(e) => setSource(e.target.value)} /></Field>
        <Field label="Deal value (USD)"><Input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} /></Field>
        <Field label="Probability (%)"><Input type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(Number(e.target.value))} /></Field>
        <Field label="Stage">
          <Select value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
            {STAGE_ORDER.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}