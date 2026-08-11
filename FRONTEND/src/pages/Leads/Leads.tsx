import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Download, Upload, Pencil, Archive, ArchiveRestore, ExternalLink, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  PageHeader, Button, Card, Table, Th, Td, Tr, Badge, StatusBadge, Avatar,
  SearchInput, Select, EmptyState, cn,
} from '@/components/ui';
import { LeadFormModal } from './LeadFormModal';
import { LeadDrawer } from './LeadDrawer';
import { ImportModal } from './ImportModal';
import { formatCurrency, timeAgo } from '@/utils/formatters';
import { useLeads } from '@/hooks/useLeads';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { usePermissions } from '@/hooks/usePermissions.ts';
import { leadsApi } from '@/lib/leadsApi';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import type { Lead, LeadStatus, LeadTemperature } from '@/types/lead';

// No backend endpoint returns "distinct sources in use" -- reusing the same
// fixed list LeadFormModal offers when creating a lead, so filter options
// always match what a lead can actually be created with.
const SOURCES = ['Meta Ads', 'Google Ads', 'LinkedIn', 'Webinar', 'Referral', 'Organic', 'Cold Outreach', 'YouTube', 'Direct'];
const STATUSES: LeadStatus[] = ['New', 'Contacted', 'Qualified', 'Booked', 'Call Completed', 'Proposal Sent', 'Won', 'Lost', 'Nurture', 'Ghosted'];

/** Debounce a fast-changing value (search input) so we don't refetch on every keystroke. */
function useDebounced<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function Leads() {
  const [params] = useSearchParams();
  const { nameById } = useTeamMembers();
  const permissions = usePermissions();

  const [q, setQ] = useState(params.get('q') ?? '');
  const debouncedQ = useDebounced(q);
  const [statusFilter, setStatusFilter] = useState('all');
  const [tempFilter, setTempFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [page, setPage] = useState(1);

  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);

  // Reset to page 1 whenever a filter changes (a stale page number past the
  // new result set would otherwise silently show an empty table).
  useEffect(() => setPage(1), [debouncedQ, statusFilter, tempFilter, sourceFilter, view]);

  const query = useMemo(() => ({
    search: debouncedQ || undefined,
    status: statusFilter === 'all' ? undefined : (statusFilter as LeadStatus),
    lead_temperature: tempFilter === 'all' ? undefined : (tempFilter as LeadTemperature),
    source: sourceFilter === 'all' ? undefined : sourceFilter,
    archivedOnly: view === 'archived' ? true : undefined,
    page,
    limit: 20,
  }), [debouncedQ, statusFilter, tempFilter, sourceFilter, view, page]);

  const { leads, pagination, loading, error, refetch, createLead, updateLead, archiveLead, restoreLead } = useLeads(query);

  const exportCsv = async () => {
    try {
      // Exports ALL leads matching the current filters (server-side), not
      // just the currently-loaded page -- see leadsApi.exportCsv.
      await leadsApi.exportCsv({
        search: query.search,
        status: query.status,
        lead_temperature: query.lead_temperature,
        source: query.source,
        archivedOnly: query.archivedOnly,
      });
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const handleArchive = async (id: string, name: string) => {
    try {
      await archiveLead(id);
      toast.success('Lead archived', name);
    } catch (err) {
      toast.error('Could not archive lead', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const handleRestore = async (id: string, name: string) => {
    try {
      await restoreLead(id);
      toast.success('Lead restored', name);
    } catch (err) {
      toast.error('Could not restore lead', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const openEdit = async (id: string) => {
    setEditLoadingId(id);
    try {
      const full = await leadsApi.get(id);
      setEditLead(full);
    } catch (err) {
      toast.error('Could not load lead', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setEditLoadingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description={pagination ? `${pagination.total} ${view === 'archived' ? 'archived ' : ''}leads` : 'Loading…'}
        breadcrumb={['Revenue', 'Leads']}
        actions={
          <>
            {permissions.leads.canImport && (
              <Button variant="secondary" onClick={() => setShowImport(true)}><Upload size={16} /> Import CSV</Button>
            )}
            <Button variant="secondary" onClick={exportCsv}><Download size={16} /> Export CSV</Button>
            {permissions.leads.canCreate && (
              <Button onClick={() => setShowAdd(true)}><Plus size={16} /> Add Lead</Button>
            )}
          </>
        }
      />

      {permissions.leads.canDelete && (
        <div className="mb-4 flex gap-1.5 rounded-lg bg-ink-100 p-1 text-sm w-fit">
          <button onClick={() => setView('active')} className={cn('rounded-md px-4 py-1.5 font-medium transition', view === 'active' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500')}>Active</button>
          <button onClick={() => setView('archived')} className={cn('rounded-md px-4 py-1.5 font-medium transition', view === 'archived' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500')}>Archived</button>
        </div>
      )}

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[220px] flex-1"><SearchInput value={q} onChange={setQ} placeholder="Search name, email, company…" /></div>
          <Filter size={15} className="text-ink-400" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
            <option value="all">All statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Select value={tempFilter} onChange={(e) => setTempFilter(e.target.value)} className="w-auto">
            <option value="all">All temps</option>
            <option>Hot</option><option>Warm</option><option>Cold</option>
          </Select>
          <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="w-auto">
            <option value="all">All sources</option>
            {SOURCES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </div>
      </Card>

      <Card>
        {error ? (
          <EmptyState title="Couldn't load leads" description={error} />
        ) : loading ? (
          <p className="p-8 text-center text-sm text-ink-400">Loading leads…</p>
        ) : leads.length === 0 ? (
          view === 'archived'
            ? <EmptyState title="No archived leads" description="Leads you archive will show up here, and can be restored any time." />
            : <EmptyState title="No leads match your filters" description="Try adjusting the search or filters, or add a new lead." action={permissions.leads.canCreate ? <Button onClick={() => setShowAdd(true)}><Plus size={16} /> Add Lead</Button> : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Lead</Th><Th>Status</Th><Th>Temp</Th><Th>Score</Th><Th>Source</Th>
                  <Th>Owner</Th><Th>Value</Th><Th>Last contact</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <Tr key={l.id} onClick={() => setDetailLeadId(l.id)}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={l.name} color="#6366f1" size={32} />
                        <div>
                          <p className="font-semibold text-ink-900">{l.name}</p>
                          <p className="text-xs text-ink-500">{l.company || l.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td><StatusBadge status={l.status} /></Td>
                    <Td><Badge tone={l.lead_temperature === 'Hot' ? 'red' : l.lead_temperature === 'Warm' ? 'amber' : 'gray'}>{l.lead_temperature}</Badge></Td>
                    <Td><span className="font-semibold">{l.qualification_score}</span><span className="text-ink-400">/10</span></Td>
                    <Td>{l.source}</Td>
                    <Td>{nameById(l.assigned_user_id)}</Td>
                    <Td className="font-medium">{formatCurrency(l.value)}</Td>
                    <Td className="text-ink-500">{timeAgo(l.last_contacted_at)}</Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setDetailLeadId(l.id)} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-brand-600" title="Open"><ExternalLink size={15} /></button>
                        {permissions.leads.canUpdate && (
                          <button onClick={() => void openEdit(l.id)} disabled={editLoadingId === l.id} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-brand-600 disabled:opacity-40" title="Edit"><Pencil size={15} /></button>
                        )}
                        {permissions.leads.canDelete && (
                          view === 'archived' ? (
                            <button onClick={() => void handleRestore(l.id, l.name)} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-emerald-600" title="Restore"><ArchiveRestore size={15} /></button>
                          ) : (
                            <button onClick={() => void handleArchive(l.id, l.name)} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-red-600" title="Archive"><Archive size={15} /></button>
                          )
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
                  <Button variant="secondary" disabled={!pagination.hasPrev} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft size={15} /> Prev
                  </Button>
                  <Button variant="secondary" disabled={!pagination.hasNext} onClick={() => setPage((p) => p + 1)}>
                    Next <ChevronRight size={15} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {showAdd && (
        <LeadFormModal
          onClose={() => setShowAdd(false)}
          onSubmit={async (data) => { await createLead(data); }}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setPage(1); refetch(); }}
        />
      )}
      {editLead && (
        <LeadFormModal
          lead={editLead}
          onClose={() => setEditLead(null)}
          onSubmit={async (data) => { await updateLead(editLead.id, data); }}
        />
      )}
      {detailLeadId && <LeadDrawer leadId={detailLeadId} onClose={() => setDetailLeadId(null)} />}
    </div>
  );
}