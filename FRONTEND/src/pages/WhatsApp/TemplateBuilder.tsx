import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Smartphone, Upload, Image as ImageIcon, FileText, Video, AlertTriangle, Wand2, CheckCircle2, ZoomIn } from 'lucide-react';
import { Modal, Button, Input, Field, Select, Textarea, Badge, cn } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { whatsappInboxApi } from '@/lib/whatsappInboxApi';
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

/** Same alias keys BACKEND templateParams.js's LEAD_FIELD_ALIASES
 * resolves at send time -- kept in sync manually since this is a small,
 * stable list, not a live-fetched schema. A positional {{1}} placeholder
 * maps to one of these; picking here guarantees it actually resolves to
 * something real at send time instead of the old silent-empty-string
 * failure mode. */
const LEAD_FIELD_OPTIONS = [
  { value: 'name', label: 'Full name' },
  { value: 'firstname', label: 'First name' },
  { value: 'lastname', label: 'Last name' },
  { value: 'company', label: 'Company' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'segment', label: 'Segment' },
  { value: 'source', label: 'Source' },
  { value: 'medium', label: 'Medium' },
  { value: 'campaign', label: 'Campaign' },
  { value: 'status', label: 'Status' },
  { value: 'value', label: 'Deal value' },
  { value: 'score', label: 'Qualification score' },
  { value: 'temperature', label: 'Lead temperature' },
];

/** Meta's TEMPLATE header media requirements are much stricter than
 * regular chat message attachments (which accept a broad range via the
 * "send by link" API already fixed for Composer.tsx) -- confirmed live:
 * uploading a broader-format file here got Meta's template CREATION
 * call rejected with "The type of file is not supported", even though
 * the Resumable Upload itself succeeded. Per Meta's docs, template
 * headers accept ONLY: JPEG/PNG for images, MP4/3GPP (H.264+AAC) for
 * video, and PDF for documents -- not the wider range Composer's own
 * attach picker allows. */
const HEADER_MEDIA_ACCEPT: Record<string, string> = {
  IMAGE: 'image/jpeg,image/png',
  VIDEO: 'video/mp4,video/3gpp',
  DOCUMENT: '.pdf,application/pdf',
};
const HEADER_MEDIA_HINT: Record<string, string> = {
  IMAGE: 'JPEG or PNG only',
  VIDEO: 'MP4 or 3GPP only',
  DOCUMENT: 'PDF only',
};
/** Actual enforcement -- the `accept` attribute above is only a UI hint
 * for the OS file picker (some browsers/flows let a user bypass it,
 * e.g. "All Files"), so this is checked in code too before ever
 * uploading, rather than relying on the picker alone to prevent another
 * "Meta rejected this template -- The type of file is not supported"
 * round-trip. */
const ALLOWED_HEADER_MIME: Record<string, string[]> = {
  IMAGE: ['image/jpeg', 'image/png'],
  VIDEO: ['video/mp4', 'video/3gpp'],
  DOCUMENT: ['application/pdf'],
};

// Every limit here mirrors BACKEND templates.constants.js EXACTLY -- the
// point of live-validating client-side is to catch a problem before the
// network round-trip, not to invent a second, possibly-drifting set of
// rules. Server-side validation (templates.service.js's validateContent)
// remains authoritative and re-checks all of this regardless -- this is
// UX, not the real security boundary.
const MAX_NAME_LENGTH = 512;
const MAX_BODY_LENGTH = 1024;
const MAX_FOOTER_LENGTH = 60;
const MAX_HEADER_TEXT_LENGTH = 60;
const MAX_BUTTON_TEXT_LENGTH = 25;
const MAX_BUTTONS = 10;
const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]+$/;
const URL_BUTTON_PATTERN = /^https?:\/\/.+/i;
const PHONE_BUTTON_PATTERN = /^\+?[0-9]{7,15}$/;

/** Ordered, de-duplicated {{n}} tokens -- mirrors BACKEND
 * templateParams.js's extractPlaceholders() closely enough for preview
 * purposes (real extraction/validation is server-side, authoritative). */
function extractPlaceholders(body: string): { names: string[]; positional: boolean } {
  const seen = Array.from(new Set((body.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || []).map((v) => v.replace(/[{}]/g, ''))));
  const numeric = seen.filter((n) => /^\d+$/.test(n));
  const positional = numeric.length > 0 && numeric.length === seen.length;
  return { names: positional ? [...numeric].sort((a, b) => Number(a) - Number(b)) : seen, positional };
}

/** Small color-coded "45/60" counter -- green well under the limit, amber
 * approaching it, red over (over is also what blocks save, via
 * collectIssues() below). Purely visual feedback as you type, the actual
 * enforcement happens in collectIssues(). */
function CharCounter({ current, max }: { current: number; max: number }) {
  const ratio = current / max;
  const color = ratio > 1 ? 'text-red-600' : ratio >= 0.8 ? 'text-amber-600' : 'text-ink-400';
  return <span className={cn('text-[11px] tabular-nums', color)}>{current}/{max}</span>;
}

/**
 * TemplatePreview -- the WhatsApp-bubble-style live preview, extracted
 * into its own component so it can be reused both inside the builder
 * (live, as you type) AND as a standalone read-only "Preview" action on
 * an already-saved template card (see WhatsAppPanel.tsx's TemplatesTab)
 * without needing to open the full edit form just to see what a
 * template looks like.
 */
/**
 * ImageCropModal -- WhatsApp template header images must be a fixed
 * 1.91:1 aspect ratio (the same ratio Facebook/WhatsApp link previews
 * use) to display correctly and not get cropped unpredictably by Meta's
 * own rendering. Rather than a freeform crop (which could easily produce
 * an off-ratio image that looks fine here but gets mangled on a real
 * device), this locks the crop frame to exactly that ratio -- the person
 * can drag to reposition and zoom in, but can't produce a non-compliant
 * output.
 *
 * No new npm dependency -- plain canvas + pointer events, matching how
 * light this one interaction needs to be.
 */
const HEADER_ASPECT_RATIO = 1200 / 628; // WhatsApp/Meta's standard media-header ratio
const CROP_OUTPUT_WIDTH = 1200;
const CROP_OUTPUT_HEIGHT = 628;
const CROP_FRAME_WIDTH = 480;
const CROP_FRAME_HEIGHT = Math.round(CROP_FRAME_WIDTH / HEADER_ASPECT_RATIO);

function ImageCropModal({ file, onConfirm, onCancel }: {
  file: File;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const img = new Image();
    img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!imgUrl || !naturalSize) {
    return (
      <Modal open onClose={onCancel} title="Position your image" size="sm" footer={<Button variant="secondary" onClick={onCancel}>Cancel</Button>}>
        <p className="py-8 text-center text-sm text-ink-500">Loading image…</p>
      </Modal>
    );
  }

  // baseScale: the zoom level at which the image just fully covers the
  // crop frame (same idea as CSS object-fit: cover) -- the floor for
  // the zoom slider, since zooming OUT further would leave gaps.
  const baseScale = Math.max(CROP_FRAME_WIDTH / naturalSize.w, CROP_FRAME_HEIGHT / naturalSize.h);
  const effectiveScale = baseScale * zoom;
  const dispW = naturalSize.w * effectiveScale;
  const dispH = naturalSize.h * effectiveScale;
  const maxOffsetX = Math.max(0, (dispW - CROP_FRAME_WIDTH) / 2);
  const maxOffsetY = Math.max(0, (dispH - CROP_FRAME_HEIGHT) / 2);

  const clampedOffset = {
    x: Math.max(-maxOffsetX, Math.min(maxOffsetX, offset.x)),
    y: Math.max(-maxOffsetY, Math.min(maxOffsetY, offset.y)),
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffsetX: clampedOffset.x, startOffsetY: clampedOffset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({ x: dragRef.current.startOffsetX + dx, y: dragRef.current.startOffsetY + dy });
  };
  const onPointerUp = () => { dragRef.current = null; };

  const handleConfirm = () => {
    const img = new Image();
    img.onload = () => {
      // Map the visible crop-frame area back to natural image pixel
      // coordinates, then draw exactly that region at the real output
      // resolution -- see this component's doc comment for why the
      // ratio is fixed rather than freeform.
      const srcX = ((dispW - CROP_FRAME_WIDTH) / 2 - clampedOffset.x) / effectiveScale;
      const srcY = ((dispH - CROP_FRAME_HEIGHT) / 2 - clampedOffset.y) / effectiveScale;
      const srcW = CROP_FRAME_WIDTH / effectiveScale;
      const srcH = CROP_FRAME_HEIGHT / effectiveScale;

      const canvas = document.createElement('canvas');
      canvas.width = CROP_OUTPUT_WIDTH;
      canvas.height = CROP_OUTPUT_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) { toast.error('Crop failed', 'Could not create canvas context.'); return; }
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, CROP_OUTPUT_WIDTH, CROP_OUTPUT_HEIGHT);
      canvas.toBlob((blob) => {
        if (!blob) { toast.error('Crop failed', 'Could not export the cropped image.'); return; }
        onConfirm(blob);
      }, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92);
    };
    img.src = imgUrl;
  };

  return (
    <Modal open onClose={onCancel} title="Position your image" size="sm" footer={
      <>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleConfirm}>Use this crop</Button>
      </>
    }>
      <p className="mb-3 text-xs text-ink-500">WhatsApp headers use a fixed 1.91:1 shape -- drag to reposition, zoom to fill the frame.</p>
      <div
        className="relative mx-auto touch-none overflow-hidden rounded-lg bg-ink-900"
        style={{ width: CROP_FRAME_WIDTH, height: CROP_FRAME_HEIGHT, cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img
          src={imgUrl}
          alt=""
          draggable={false}
          className="absolute select-none"
          style={{
            width: dispW,
            height: dispH,
            left: (CROP_FRAME_WIDTH - dispW) / 2 + clampedOffset.x,
            top: (CROP_FRAME_HEIGHT - dispH) / 2 + clampedOffset.y,
          }}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <ZoomIn size={14} className="shrink-0 text-ink-400" />
        <input
          type="range" min={1} max={3} step={0.01} value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="flex-1"
        />
      </div>
    </Modal>
  );
}

export function TemplatePreview({ headerType, headerText, headerMediaUrl, body, footer, buttons, category }: {
  headerType: HeaderType;
  headerText?: string;
  headerMediaUrl?: string;
  body: string;
  footer?: string;
  buttons?: TemplateButton[];
  category?: string;
}) {
  const preview = body.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, v) => `[${v}]`);
  const HeaderIcon = headerType === 'VIDEO' ? Video : headerType === 'DOCUMENT' ? FileText : ImageIcon;

  return (
    <div className="rounded-2xl bg-gradient-to-b from-emerald-50 to-teal-50 p-4">
      <div className="mx-auto max-w-[300px] rounded-2xl bg-[#e5ddd5] p-3 shadow-inner" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)', backgroundSize: '16px 16px' }}>
        <div className="rounded-lg rounded-tl-sm bg-white p-3 shadow-sm">
          {headerType === 'TEXT' && headerText && <p className="mb-1 font-bold text-ink-900">{headerText}</p>}
          {headerType === 'IMAGE' && headerMediaUrl && <img src={headerMediaUrl} alt="" className="mb-2 h-32 w-full rounded-md object-cover" />}
          {headerType === 'VIDEO' && headerMediaUrl && <video src={headerMediaUrl} controls className="mb-2 h-32 w-full rounded-md object-cover" />}
          {headerType !== 'NONE' && headerType !== 'TEXT' && (!headerMediaUrl || headerType === 'DOCUMENT') && (
            <div className="mb-2 flex h-24 items-center justify-center gap-2 rounded-md bg-ink-100 text-xs text-ink-400">
              <HeaderIcon size={16} /> {headerMediaUrl ? 'Document attached' : `${headerType.toLowerCase()} header`}
            </div>
          )}
          <p className="whitespace-pre-line text-sm text-ink-800">{preview || 'Your message preview will appear here…'}</p>
          {footer && <p className="mt-2 text-[11px] text-ink-400">{footer}</p>}
          <p className="mt-1 text-right text-[10px] text-ink-400">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        {(buttons || []).map((b, i) => (
          <div key={i} className="mt-1.5 rounded-lg bg-white py-2 text-center text-sm font-semibold text-brand-600 shadow-sm">{b.text || b.type}</div>
        ))}
      </div>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-500"><Smartphone size={13} /> WhatsApp preview{category ? ` · ${category}` : ''}</p>
    </div>
  );
}

/**
 * TemplateBuilder -- keeps the original mock's design (live preview,
 * detected-variables badge list, button management), but every field is
 * real now: `name`/`languageCode`/`body` not `template_name`/`language`/
 * `body_message`, UPPERCASE category/header/button enum values matching
 * the actual backend exactly, not the spec's Title Case ones.
 *
 * Media headers: uploads through the same Cloudinary pipeline already
 * built for the Composer (whatsappInboxApi.uploadMedia) -- no separate
 * upload plumbing needed, this is a generic endpoint.
 *
 * Positional {{1}}/{{2}} placeholders: a real field-mapping UI, since
 * there's no way to auto-derive "what does {{1}} mean" the way a named
 * placeholder ({{customer_name}}) self-describes. Previously there was
 * no way to configure this at all, so any {{1}}-style template silently
 * sent with an empty string where the parameter should be.
 *
 * Validation: mirrors every check BACKEND templates.service.js's
 * validateContent() runs (name format, all length limits, positional
 * sequence, header media format, button count/duplicates/URL-phone
 * format) -- collected into ONE list shown together, not one toast per
 * issue that only reveals the next problem after fixing the last one.
 */
export function TemplateBuilder({ template, onClose, onSaved }: {
  template?: WhatsAppTemplate;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { createTemplate, updateTemplate } = useWhatsAppTemplates();
  const isEdit = Boolean(template);
  const [saving, setSaving] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [cropPendingFile, setCropPendingFile] = useState<File | null>(null);
  // Issues are collected live, but only SHOWN after a first save attempt
  // -- otherwise a blank new-template form would open already covered in
  // red "required" errors before the user has typed anything.
  const [attempted, setAttempted] = useState(false);

  const [form, setForm] = useState({
    name: template?.name ?? '',
    category: template?.category ?? 'MARKETING' as TemplateCategory,
    languageCode: template?.languageCode ?? 'en_US',
    headerType: template?.header?.type ?? 'NONE' as HeaderType,
    headerText: template?.header?.text ?? '',
    headerMediaUrl: template?.header?.mediaUrl ?? '',
    headerMediaMimeType: template?.header?.mediaMimeType ?? '',
    headerMediaSizeBytes: template?.header?.mediaSizeBytes ?? 0,
    body: template?.body ?? '',
    footer: template?.footer ?? '',
  });
  const [buttons, setButtons] = useState<TemplateButton[]>(template?.buttons ?? []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { names, positional } = extractPlaceholders(form.body);

  // Field-mapping for positional placeholders -- index 0 maps {{1}}, etc.
  // Pre-filled from the template's existing `variables` on edit (already
  // a real field-name array once resolveVariables() has run server-side),
  // empty on create.
  const [positionalMap, setPositionalMap] = useState<string[]>(
    positional && template?.variables ? template.variables : names.map(() => ''),
  );
  const setPositionalField = (index: number, value: string) => {
    setPositionalMap((prev) => {
      const next = [...prev];
      while (next.length <= index) next.push('');
      next[index] = value;
      return next;
    });
  };

  const autoFixName = () => set('name', form.name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''));

  const uploadHeaderMedia = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large', 'Maximum size is 5MB (WhatsApp media limit).');
      return;
    }
    const allowed = ALLOWED_HEADER_MIME[form.headerType] || [];
    if (allowed.length && !allowed.includes(file.type)) {
      toast.error('Unsupported file type', `Meta only accepts ${HEADER_MEDIA_HINT[form.headerType]} for a template ${form.headerType.toLowerCase()} header -- you selected ${file.type || 'an unrecognized type'}.`);
      return;
    }
    setUploadingHeader(true);
    try {
      const result = await whatsappInboxApi.uploadMedia(file);
      setForm((f) => ({ ...f, headerMediaUrl: result.url, headerMediaMimeType: result.mimeType, headerMediaSizeBytes: result.sizeBytes }));
    } catch (err) {
      toast.error('Upload failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setUploadingHeader(false);
    }
  };

  /**
   * collectIssues -- runs every check BACKEND validateContent() runs,
   * client-side, all at once. Returns a flat list of { field, message }
   * so the whole set of problems is visible together (this is the
   * "AiSensy-level, not just basic" ask specifically) rather than
   * discovering them one save-click at a time.
   */
  const issues = useMemo(() => {
    const list: { field: string; message: string }[] = [];
    const name = form.name.trim();

    if (!name) list.push({ field: 'name', message: 'Template name is required.' });
    else if (name.length > MAX_NAME_LENGTH) list.push({ field: 'name', message: `Template name exceeds ${MAX_NAME_LENGTH} characters.` });
    else if (!TEMPLATE_NAME_PATTERN.test(name)) list.push({ field: 'name', message: 'Only lowercase letters, numbers, and underscores are allowed -- no spaces, capitals, or hyphens.' });

    const body = form.body;
    if (!body.trim()) list.push({ field: 'body', message: 'Body message is required.' });
    else if (body.length > MAX_BODY_LENGTH) list.push({ field: 'body', message: `Body exceeds ${MAX_BODY_LENGTH} characters (currently ${body.length}).` });

    if (positional && names.length > 0) {
      const expected = names.map((_, i) => String(i + 1));
      if (JSON.stringify(names) !== JSON.stringify(expected)) {
        list.push({ field: 'body', message: `Positional placeholders must be sequential starting at {{1}} -- found {{${names.join('}}, {{')}}}}, expected {{${expected.join('}}, {{')}}}}.` });
      }
      const unmapped = names.filter((_, i) => !positionalMap[i]);
      if (unmapped.length > 0) {
        list.push({ field: 'variables', message: `Map every {{n}} placeholder to a field -- ${unmapped.length} of ${names.length} still unmapped.` });
      }
    }

    if (form.footer && form.footer.length > MAX_FOOTER_LENGTH) {
      list.push({ field: 'footer', message: `Footer exceeds ${MAX_FOOTER_LENGTH} characters (currently ${form.footer.length}).` });
    }

    if (form.headerType === 'TEXT') {
      if (!form.headerText.trim()) list.push({ field: 'header', message: 'Header text is required for a TEXT header.' });
      else if (form.headerText.length > MAX_HEADER_TEXT_LENGTH) list.push({ field: 'header', message: `Header text exceeds ${MAX_HEADER_TEXT_LENGTH} characters (currently ${form.headerText.length}).` });
    } else if (form.headerType !== 'NONE') {
      if (!form.headerMediaUrl) list.push({ field: 'header', message: `A ${form.headerType.toLowerCase()} file is required for a ${form.headerType} header.` });
    }

    if (buttons.length > MAX_BUTTONS) list.push({ field: 'buttons', message: `A template may have at most ${MAX_BUTTONS} buttons (currently ${buttons.length}).` });
    const seenText = new Set<string>();
    buttons.forEach((b, i) => {
      const text = (b.text || '').trim();
      if (!text) list.push({ field: `button-${i}`, message: `Button ${i + 1}: text is required.` });
      else if (text.length > MAX_BUTTON_TEXT_LENGTH) list.push({ field: `button-${i}`, message: `Button ${i + 1}: text exceeds ${MAX_BUTTON_TEXT_LENGTH} characters.` });
      else if (seenText.has(text.toLowerCase())) list.push({ field: `button-${i}`, message: `Button ${i + 1}: duplicate label "${text}" -- button labels must be unique.` });
      else seenText.add(text.toLowerCase());

      if (['PHONE_NUMBER', 'URL', 'COPY_CODE', 'FLOW'].includes(b.type)) {
        const value = (b.value || '').trim();
        if (!value) list.push({ field: `button-${i}`, message: `Button ${i + 1}: a value is required for a ${b.type} button.` });
        else if (b.type === 'URL' && !URL_BUTTON_PATTERN.test(value)) list.push({ field: `button-${i}`, message: `Button ${i + 1}: URL must start with http:// or https://.` });
        else if (b.type === 'PHONE_NUMBER' && !PHONE_BUTTON_PATTERN.test(value)) list.push({ field: `button-${i}`, message: `Button ${i + 1}: phone number must be 7-15 digits, optionally starting with +.` });
      }
    });

    return list;
  }, [form, buttons, names, positional, positionalMap]);

  const save = async () => {
    setAttempted(true);
    if (issues.length > 0) {
      toast.error(`${issues.length} issue${issues.length === 1 ? '' : 's'} to fix`, 'See the list below the form for details.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        languageCode: form.languageCode,
        body: form.body,
        footer: form.footer || undefined,
        header: form.headerType === 'NONE'
          ? undefined
          : {
              type: form.headerType,
              text: form.headerType === 'TEXT' ? form.headerText : undefined,
              mediaUrl: form.headerType !== 'TEXT' ? form.headerMediaUrl : undefined,
              mediaMimeType: form.headerType !== 'TEXT' ? form.headerMediaMimeType : undefined,
              mediaSizeBytes: form.headerType !== 'TEXT' ? form.headerMediaSizeBytes : undefined,
            },
        buttons: buttons.length > 0 ? buttons : undefined,
        variables: positional ? positionalMap.slice(0, names.length) : undefined,
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

  const nameValid = form.name.trim().length > 0 && TEMPLATE_NAME_PATTERN.test(form.name.trim());

  return (
    <>
    <Modal
      open onClose={onClose} title={isEdit ? 'Edit Template' : 'WhatsApp Template Builder'} size="xl"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save template' : 'Create template'}</Button></>}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Form */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Template name">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="order_confirmation" className={attempted && !nameValid && form.name ? 'border-red-300' : ''} />
              <div className="mt-1 flex items-center justify-between">
                {form.name && !nameValid ? (
                  <button type="button" onClick={autoFixName} className="flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline">
                    <Wand2 size={11} /> Auto-fix to lowercase_underscore
                  </button>
                ) : <span />}
                <CharCounter current={form.name.length} max={MAX_NAME_LENGTH} />
              </div>
            </Field>
            <Field label="Language"><Select value={form.languageCode} onChange={(e) => set('languageCode', e.target.value)}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</Select></Field>
          </div>
          <Field label="Category"><Select value={form.category} onChange={(e) => set('category', e.target.value)}>{TEMPLATE_CATEGORY_VALUES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Header type">
              <Select value={form.headerType} onChange={(e) => setForm((f) => ({ ...f, headerType: e.target.value as HeaderType, headerMediaUrl: '', headerMediaMimeType: '', headerMediaSizeBytes: 0 }))}>
                {HEADER_TYPE_VALUES.map((h) => <option key={h} value={h}>{h.charAt(0) + h.slice(1).toLowerCase()}</option>)}
              </Select>
            </Field>
            {form.headerType === 'TEXT' && (
              <Field label="Header text">
                <Input value={form.headerText} onChange={(e) => set('headerText', e.target.value)} />
                <div className="mt-1 flex justify-end"><CharCounter current={form.headerText.length} max={MAX_HEADER_TEXT_LENGTH} /></div>
              </Field>
            )}
          </div>

          {/* Media header upload -- was entirely missing before: the type
              dropdown let you pick IMAGE/VIDEO/DOCUMENT but there was no
              way to actually attach a file, so those templates could
              never be sent (Meta requires the header media on every send
              for a template approved with a media header). */}
          {form.headerType !== 'NONE' && form.headerType !== 'TEXT' && (
            <Field label={`${form.headerType.charAt(0)}${form.headerType.slice(1).toLowerCase()} header file`} hint={`Meta requires: ${HEADER_MEDIA_HINT[form.headerType]}, max 5MB.`}>
              <input
                ref={mediaInputRef}
                type="file"
                accept={HEADER_MEDIA_ACCEPT[form.headerType]}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (form.headerType === 'IMAGE') setCropPendingFile(f);
                    else void uploadHeaderMedia(f);
                  }
                  e.target.value = '';
                }}
              />
              {form.headerMediaUrl ? (
                <div className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm">
                  <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1 truncate text-emerald-700">File attached ({form.headerMediaMimeType || 'unknown type'})</span>
                  <button type="button" onClick={() => mediaInputRef.current?.click()} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">Replace</button>
                </div>
              ) : (
                <Button type="button" variant="secondary" className="w-full justify-center text-sm" disabled={uploadingHeader} onClick={() => mediaInputRef.current?.click()}>
                  <Upload size={14} /> {uploadingHeader ? 'Uploading…' : `Upload ${form.headerType.toLowerCase()}`}
                </Button>
              )}
            </Field>
          )}

          <Field label="Body message" hint="Use {{variable_name}} for named placeholders, or {{1}}, {{2}}… for positional ones">
            <Textarea rows={5} value={form.body} onChange={(e) => set('body', e.target.value)} placeholder="Hi {{customer_name}}! Thanks for your order…" />
            <div className="mt-1 flex justify-end"><CharCounter current={form.body.length} max={MAX_BODY_LENGTH} /></div>
          </Field>
          <Field label="Footer">
            <Input value={form.footer} onChange={(e) => set('footer', e.target.value)} placeholder="Reply STOP to unsubscribe" />
            <div className="mt-1 flex justify-end"><CharCounter current={form.footer.length} max={MAX_FOOTER_LENGTH} /></div>
          </Field>

          {names.length > 0 && !positional && (
            <div>
              <p className="label">Detected variables</p>
              <p className="mb-1.5 text-xs text-ink-400">Resolved automatically from the lead's matching field at send time.</p>
              <div className="flex flex-wrap gap-1.5">{names.map((v) => <Badge key={v} tone="violet">{`{{${v}}}`}</Badge>)}</div>
            </div>
          )}

          {/* Positional placeholder field-mapping -- the actual fix for
              "{{1}}-style templates silently send with a blank
              parameter". Every {{n}} needs an explicit field picked;
              save() blocks until all are set. */}
          {positional && names.length > 0 && (
            <div>
              <p className="label">Map placeholders to fields</p>
              <p className="mb-1.5 text-xs text-ink-400">{'{{n}}'} placeholders don't carry a field name -- pick what each one should resolve to.</p>
              <div className="space-y-2">
                {names.map((n, i) => (
                  <div key={n} className="flex items-center gap-2">
                    <Badge tone="violet">{`{{${n}}}`}</Badge>
                    <Select value={positionalMap[i] || ''} onChange={(e) => setPositionalField(i, e.target.value)} className="flex-1 py-1.5 text-sm">
                      <option value="">Select field…</option>
                      {LEAD_FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="label !mb-0">Buttons</p>
              <Button variant="ghost" className="px-2 py-1 text-xs" disabled={buttons.length >= MAX_BUTTONS} onClick={() => setButtons([...buttons, { type: 'QUICK_REPLY', text: '', value: '' }])}><Plus size={13} /> Add button</Button>
            </div>
            <div className="space-y-2">
              {buttons.map((b, i) => (
                <div key={i}>
                  <div className="flex gap-2">
                    <Select value={b.type} onChange={(e) => setButtons(buttons.map((x, j) => j === i ? { ...x, type: e.target.value as ButtonType } : x))} className="w-40 py-1.5 text-sm">
                      {BUTTON_TYPE_VALUES.map((t) => <option key={t}>{t}</option>)}
                    </Select>
                    <Input value={b.text} onChange={(e) => setButtons(buttons.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} placeholder="Button label" className="py-1.5 text-sm" />
                    <button onClick={() => setButtons(buttons.filter((_, j) => j !== i))} className="rounded-lg p-2 text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                  </div>
                  {['PHONE_NUMBER', 'URL', 'COPY_CODE', 'FLOW'].includes(b.type) && (
                    <Input
                      value={b.value || ''}
                      onChange={(e) => setButtons(buttons.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                      placeholder={b.type === 'URL' ? 'https://example.com' : b.type === 'PHONE_NUMBER' ? '+15551234567' : 'Value'}
                      className="mt-1.5 py-1.5 text-sm"
                    />
                  )}
                  <div className="mt-0.5 flex justify-end"><CharCounter current={(b.text || '').length} max={MAX_BUTTON_TEXT_LENGTH} /></div>
                </div>
              ))}
            </div>
          </div>

          {/* Comprehensive validation summary -- every issue at once,
              shown together after the first save attempt, instead of one
              toast per click that only reveals the next problem after
              fixing the last one. */}
          {attempted && issues.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3.5">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-red-700">
                <AlertTriangle size={14} /> {issues.length} issue{issues.length === 1 ? '' : 's'} to fix before saving
              </p>
              <ul className="space-y-1 text-xs text-red-700">
                {issues.map((iss, i) => <li key={i} className="flex gap-1.5"><span className="opacity-50">•</span>{iss.message}</li>)}
              </ul>
            </div>
          )}
          {attempted && issues.length === 0 && (
            <div className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 size={14} /> Looks good -- ready to save.
            </div>
          )}
        </div>

        {/* Preview */}
        <div>
          <p className="label">Live preview</p>
          <TemplatePreview
            headerType={form.headerType}
            headerText={form.headerText}
            headerMediaUrl={form.headerMediaUrl}
            body={form.body}
            footer={form.footer}
            buttons={buttons}
            category={form.category}
          />
        </div>
      </div>
    </Modal>
    {cropPendingFile && (
      <ImageCropModal
        file={cropPendingFile}
        onCancel={() => setCropPendingFile(null)}
        onConfirm={(blob) => {
          const cropped = new File([blob], cropPendingFile.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/png' ? '.png' : '.jpg'), { type: blob.type });
          setCropPendingFile(null);
          void uploadHeaderMedia(cropped);
        }}
      />
    )}
    </>
  );
}