import { useState } from 'react';
import { Plus, Trash2, Smartphone } from 'lucide-react';
import { Modal, Button, Input, Field, Select, Textarea, Badge } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { useWhatsAppTemplates } from '@/hooks/useWhatsAppTemplates';
import { TEMPLATE_CATEGORY_VALUES, HEADER_TYPE_VALUES, BUTTON_TYPE_VALUES } from '@/types/whatsappTemplate';
import type { WhatsAppTemplate, TemplateCategory, HeaderType, ButtonType, TemplateButton } from '@/types/whatsappTemplate';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'en_US', label: 'English (US)' },
  { code: 'en_GB', label: 'English (UK)' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hi_IN', label: 'Hindi (India)' },
  { code: 'es', label: 'Spanish' },
  { code: 'es_ES', label: 'Spanish (Spain)' },
  { code: 'fr', label: 'French' },
  { code: 'pt_BR', label: 'Portuguese (Brazil)' },
  { code: 'ar', label: 'Arabic' },
  { code: 'de', label: 'German' },
];

/**
 * TemplateBuilder -- keeps the original mock's design (live preview,
 * detected-variables badge list, button management), but every field is
 * real now: `name`/`languageCode`/`body` not `template_name`/`language`/
 * `body_message`, UPPERCASE category/header/button enum values matching
 * the actual backend exactly, not the spec's Title Case ones.
 *
 * Variable detection here is purely a client-side PREVIEW -- the real,
 * authoritative extraction happens server-side on save (confirmed via
 * Postman: {{Raju bhai}} with a space was correctly ignored, only
 * {{order_id}} was extracted). This regex intentionally mirrors that same
 * letters/digits/underscore-only rule so the preview doesn't mislead.
 */
export function TemplateBuilder({ template, onClose, onSaved }: {
  template?: WhatsAppTemplate;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { createTemplate, updateTemplate } = useWhatsAppTemplates();
  const isEdit = Boolean(template);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: template?.name ?? '',
    category: template?.category ?? 'MARKETING' as TemplateCategory,
    languageCode: template?.languageCode ?? 'en_US',
    headerType: template?.header?.type ?? 'NONE' as HeaderType,
    headerText: template?.header?.text ?? '',
    body: template?.body ?? '',
    footer: template?.footer ?? '',
  });
  const [buttons, setButtons] = useState<TemplateButton[]>(template?.buttons ?? []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Client-side preview only -- mirrors the real server-side rule
  // (letters/digits/underscore, no spaces) confirmed via Postman.
  const vars = Array.from(new Set((form.body.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || []).map((v) => v.replace(/[{}]/g, ''))));
  const preview = form.body.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, v) => `[${v}]`);

  const save = async () => {
    if (!form.name.trim()) return toast.error('Template name is required');
    if (!form.body.trim()) return toast.error('Body message is required');
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        category: form.category,
        languageCode: form.languageCode,
        body: form.body,
        footer: form.footer || undefined,
        header: form.headerType === 'NONE' ? undefined : { type: form.headerType, text: form.headerText },
        buttons: buttons.length > 0 ? buttons : undefined,
      };
      if (isEdit && template) {
        await updateTemplate(template.id, payload);
        toast.success('Template updated');
      } else {
        await createTemplate(payload);
        toast.success('Template created');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(isEdit ? 'Could not update template' : 'Could not create template', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open onClose={onClose} title={isEdit ? 'Edit Template' : 'WhatsApp Template Builder'} size="xl"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save template' : 'Create template'}</Button></>}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Form */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Template name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="order_confirmation" /></Field>
            <Field label="Language"><Select value={form.languageCode} onChange={(e) => set('languageCode', e.target.value)}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</Select></Field>
          </div>
          <Field label="Category"><Select value={form.category} onChange={(e) => set('category', e.target.value)}>{TEMPLATE_CATEGORY_VALUES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Header type">
              <Select value={form.headerType} onChange={(e) => set('headerType', e.target.value)}>
                {HEADER_TYPE_VALUES.map((h) => <option key={h} value={h}>{h.charAt(0) + h.slice(1).toLowerCase()}</option>)}
              </Select>
            </Field>
            {form.headerType === 'TEXT' && <Field label="Header text"><Input value={form.headerText} onChange={(e) => set('headerText', e.target.value)} /></Field>}
          </div>
          <Field label="Body message" hint="Use {{variable}} placeholders (letters/digits/underscore only, no spaces)">
            <Textarea rows={5} value={form.body} onChange={(e) => set('body', e.target.value)} placeholder="Hi {{customer_name}}! Thanks for your order…" />
          </Field>
          <Field label="Footer"><Input value={form.footer} onChange={(e) => set('footer', e.target.value)} placeholder="Reply STOP to unsubscribe" /></Field>

          {vars.length > 0 && (
            <div>
              <p className="label">Detected variables</p>
              <div className="flex flex-wrap gap-1.5">{vars.map((v) => <Badge key={v} tone="violet">{`{{${v}}}`}</Badge>)}</div>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="label !mb-0">Buttons</p>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setButtons([...buttons, { type: 'QUICK_REPLY', text: '', value: '' }])}><Plus size={13} /> Add button</Button>
            </div>
            <div className="space-y-2">
              {buttons.map((b, i) => (
                <div key={i} className="flex gap-2">
                  <Select value={b.type} onChange={(e) => setButtons(buttons.map((x, j) => j === i ? { ...x, type: e.target.value as ButtonType } : x))} className="w-40 py-1.5 text-sm">
                    {BUTTON_TYPE_VALUES.map((t) => <option key={t}>{t}</option>)}
                  </Select>
                  <Input value={b.text} onChange={(e) => setButtons(buttons.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} placeholder="Button label" className="py-1.5 text-sm" />
                  <button onClick={() => setButtons(buttons.filter((_, j) => j !== i))} className="rounded-lg p-2 text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div>
          <p className="label">Live preview</p>
          <div className="rounded-2xl bg-gradient-to-b from-emerald-50 to-teal-50 p-4">
            <div className="mx-auto max-w-[300px] rounded-2xl bg-[#e5ddd5] p-3 shadow-inner" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)', backgroundSize: '16px 16px' }}>
              <div className="rounded-lg rounded-tl-sm bg-white p-3 shadow-sm">
                {form.headerType === 'TEXT' && form.headerText && <p className="mb-1 font-bold text-ink-900">{form.headerText}</p>}
                {form.headerType !== 'NONE' && form.headerType !== 'TEXT' && <div className="mb-2 flex h-24 items-center justify-center rounded-md bg-ink-100 text-xs text-ink-400 capitalize">{form.headerType.toLowerCase()} header</div>}
                <p className="whitespace-pre-line text-sm text-ink-800">{preview || 'Your message preview will appear here…'}</p>
                {form.footer && <p className="mt-2 text-[11px] text-ink-400">{form.footer}</p>}
                <p className="mt-1 text-right text-[10px] text-ink-400">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              {buttons.map((b, i) => (
                <div key={i} className="mt-1.5 rounded-lg bg-white py-2 text-center text-sm font-semibold text-brand-600 shadow-sm">{b.text || b.type}</div>
              ))}
            </div>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-500"><Smartphone size={13} /> WhatsApp preview · {form.category}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}