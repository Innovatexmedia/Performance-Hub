import { useEffect, useState } from 'react';
import { Plus, Copy, Trash2, FileText, Globe, Building2, History } from 'lucide-react';
import { PageHeader, Card, Button, Badge, Tabs, Modal, Field, Input, Select, Textarea, EmptyState } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { useAuthStore } from '@/store/authStore';
import { useGenericTemplates } from '@/hooks/useGenericTemplates';
import { genericTemplatesApi } from '@/lib/genericTemplatesApi';
import { genericTemplatePermissions } from '@/lib/permissions';
import { ApiError } from '@/lib/apiClient';
import type { AuthRole } from '@/types/auth';
import { TEMPLATE_TYPE_VALUES } from '@/types/genericTemplate';
import type { GenericTemplate, TemplateType, TemplateScope, TemplateVersionsResult } from '@/types/genericTemplate';

/**
 * Templates (generic) -- confirmed fully spec-aligned across all 3 spec
 * docs, no backend trimming needed (unlike Campaigns/Automations). Real
 * edit (PATCH) genuinely creates a version_history entry server-side, so
 * this page builds a real edit form + version viewer, not just the old
 * mock's read-only "View" modal.
 *
 * Deliberately separate from the WhatsApp Panel's Templates tab -- a
 * completely different backend module (GenericTemplate vs
 * WhatsAppTemplate), left untouched per explicit instruction.
 */
export function Templates() {
  const role = useAuthStore((s) => s.user?.role);
  const [typeFilter, setTypeFilter] = useState('all');
  const { templates, counts, loading, error, createTemplate, updateTemplate, deleteTemplate, duplicateTemplate } =
    useGenericTemplates(typeFilter === 'all' ? {} : { type: typeFilter as TemplateType });

  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<GenericTemplate | null>(null);
  const [versionsFor, setVersionsFor] = useState<GenericTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tabs = [
    { id: 'all', label: `All (${counts?.total ?? 0})` },
    ...TEMPLATE_TYPE_VALUES.map((t) => ({ id: t, label: `${t} (${counts?.byType[t] ?? 0})` })),
  ];

  const handleDuplicate = async (t: GenericTemplate) => {
    setBusyId(t.id);
    try {
      await duplicateTemplate(t.id);
      toast.success('Template duplicated');
    } catch (err) {
      toast.error('Could not duplicate template', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (t: GenericTemplate) => {
    if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    setBusyId(t.id);
    try {
      await deleteTemplate(t.id);
      toast.success('Template deleted');
    } catch (err) {
      toast.error('Could not delete template', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Templates"
        description="Reusable content for email, scripts, proposals, summaries & reports."
        breadcrumb={['Growth', 'Templates']}
        actions={<Button onClick={() => setShow(true)}><Plus size={16} /> New Template</Button>}
      />

      <div className="mb-4"><Tabs tabs={tabs} active={typeFilter} onChange={setTypeFilter} /></div>

      {error && <Card className="mb-4 p-4 text-sm text-red-600">{error}</Card>}
      {loading && templates.length === 0 && <p className="p-8 text-center text-sm text-ink-400">Loading templates…</p>}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => {
          const canEdit = genericTemplatePermissions.canEditOrDelete(role, t.scope);
          return (
            <Card key={t.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><FileText size={15} /></span><p className="font-semibold text-ink-900">{t.name}</p></div>
                <Badge tone={t.scope === 'global' ? 'violet' : 'gray'}>{t.scope === 'global' ? <Globe size={11} /> : <Building2 size={11} />} {t.scope}</Badge>
              </div>
              <div className="mt-2 flex items-center gap-1.5"><Badge tone="blue">{t.type}</Badge><Badge tone="gray">v{t.version}</Badge></div>
              <p className="mt-2 line-clamp-3 flex-1 rounded-lg bg-ink-50 p-2.5 text-sm text-ink-600">{t.content}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {canEdit && <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setEdit(t)}>Edit</Button>}
                <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => setVersionsFor(t)}><History size={12} /> Versions</Button>
                <Button variant="ghost" className="px-2.5 py-1 text-xs" disabled={busyId === t.id} onClick={() => void handleDuplicate(t)}><Copy size={12} /> Duplicate</Button>
                {canEdit && (
                  <button onClick={() => void handleDelete(t)} disabled={busyId === t.id} className="ml-auto rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </Card>
          );
        })}
        {!loading && templates.length === 0 && (
          <div className="lg:col-span-3"><EmptyState title="No templates" action={<Button onClick={() => setShow(true)}><Plus size={16} /> New Template</Button>} /></div>
        )}
      </div>

      {show && <NewTemplateModal onClose={() => setShow(false)} createTemplate={createTemplate} role={role} />}
      {edit && <EditTemplateModal template={edit} onClose={() => setEdit(null)} updateTemplate={updateTemplate} />}
      {versionsFor && <VersionsModal template={versionsFor} onClose={() => setVersionsFor(null)} />}
    </div>
  );
}

function NewTemplateModal({ onClose, createTemplate, role }: {
  onClose: () => void;
  createTemplate: ReturnType<typeof useGenericTemplates>['createTemplate'];
  role: AuthRole | undefined;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<TemplateType>('Email');
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<TemplateScope>('tenant');
  const [saving, setSaving] = useState(false);
  const canCreateGlobal = genericTemplatePermissions.canCreateGlobalScope(role);

  const submit = async () => {
    if (!name.trim()) return toast.error('Name required');
    if (!content.trim()) return toast.error('Content required');
    setSaving(true);
    try {
      await createTemplate({ name, type, content, scope });
      toast.success('Template created');
      onClose();
    } catch (err) {
      toast.error('Could not create template', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New Template" size="lg" footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button></>}>
      <div className="space-y-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as TemplateType)}>{TEMPLATE_TYPE_VALUES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Scope">
            <Select value={scope} onChange={(e) => setScope(e.target.value as TemplateScope)}>
              <option value="tenant">Tenant</option>
              {canCreateGlobal && <option value="global">Global (all tenants)</option>}
            </Select>
          </Field>
        </div>
        <Field label="Content" hint="Use {{variable}} placeholders"><Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function EditTemplateModal({ template, onClose, updateTemplate }: {
  template: GenericTemplate;
  onClose: () => void;
  updateTemplate: ReturnType<typeof useGenericTemplates>['updateTemplate'];
}) {
  const [name, setName] = useState(template.name);
  const [type, setType] = useState<TemplateType>(template.type);
  const [content, setContent] = useState(template.content);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await updateTemplate(template.id, { name, type, content });
      toast.success('Template updated', `Now at v${template.version + 1}`);
      onClose();
    } catch (err) {
      toast.error('Could not update template', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit — ${template.name}`} size="lg" footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? 'Saving…' : `Save as v${template.version + 1}`}</Button></>}>
      <div className="space-y-4">
        <p className="text-xs text-ink-400">Currently v{template.version} — saving creates a new version, the old one stays in history.</p>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as TemplateType)}>{TEMPLATE_TYPE_VALUES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Content"><Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function VersionsModal({ template, onClose }: { template: GenericTemplate; onClose: () => void }) {
  const [data, setData] = useState<TemplateVersionsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    genericTemplatesApi.getVersions(template.id)
      .then(setData)
      .catch((err: unknown) => toast.error('Could not load version history', err instanceof ApiError ? err.message : 'Please try again.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  return (
    <Modal open onClose={onClose} title={`Version history — ${template.name}`} size="lg">
      {loading ? <p className="text-sm text-ink-400">Loading…</p> : (
        <div className="space-y-3">
          {data?.versions.slice().reverse().map((v) => (
            <div key={v.version} className="rounded-lg border border-ink-100 p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Badge tone={v.current ? 'green' : 'gray'}>v{v.version}{v.current ? ' (current)' : ''}</Badge>
                <span className="text-xs text-ink-400">{v.updated_at ? new Date(v.updated_at).toLocaleString() : '—'}</span>
                <button onClick={() => { navigator.clipboard?.writeText(v.content); toast.success('Copied'); }} className="ml-auto text-xs text-brand-600 hover:underline"><Copy size={11} className="inline" /> Copy</button>
              </div>
              <p className="whitespace-pre-line rounded bg-ink-50 p-2.5 text-sm text-ink-700">{v.content}</p>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
