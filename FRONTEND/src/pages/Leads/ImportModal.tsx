import { useEffect, useRef, useState } from 'react';
import { Upload, CheckCircle2, XCircle, SkipForward, Loader2 } from 'lucide-react';
import { Modal, Button, Field } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { leadsApi } from '@/lib/leadsApi';
import { ApiError } from '@/lib/apiClient';
import type { ImportStatus } from '@/types/lead';

const RECOGNIZED_COLUMNS = 'name, email, phone, whatsapp, company, source, medium, campaign, status, temperature, segment, value';
const POLL_INTERVAL_MS = 1200;

interface ImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

export function ImportModal({ onClose, onImported }: ImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifiedRef = useRef(false);

  // Real, queue-based import now runs in the background -- this polls
  // for live progress instead of blocking on one synchronous response,
  // same idea as how a running Campaign's progress bar is kept live.
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startPolling = (importId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const result = await leadsApi.getImportStatus(importId);
        setStatus(result);
        if (result.status === 'COMPLETED' || result.status === 'FAILED') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (!notifiedRef.current && result.createdCount > 0) {
            notifiedRef.current = true;
            onImported();
          }
        }
      } catch {
        // A transient poll failure isn't fatal -- the next tick just
        // tries again; the import itself keeps running server-side
        // regardless of whether this specific poll succeeded.
      }
    }, POLL_INTERVAL_MS);
  };

  const submit = async () => {
    if (!file) return toast.error('Choose a CSV file first');
    setStarting(true);
    try {
      const result = await leadsApi.importCsv(file, skipDuplicates);
      setStatus({
        id: result.importId, status: result.status, fileName: file.name,
        totalRows: result.totalRows, processedCount: 0, createdCount: 0, skippedCount: 0, failedCount: 0, errors: [],
      });
      startPolling(result.importId);
    } catch (err) {
      toast.error('Import failed to start', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setStarting(false);
    }
  };

  const isDone = status?.status === 'COMPLETED' || status?.status === 'FAILED';
  const pct = status && status.totalRows > 0 ? Math.round((status.processedCount / status.totalRows) * 100) : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Import Leads from CSV"
      size="lg"
      footer={
        isDone ? (
          <Button onClick={onClose}>Done</Button>
        ) : status ? (
          <Button variant="secondary" onClick={onClose}>Run in background</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={starting}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={starting || !file}>
              {starting ? 'Starting…' : 'Import'}
            </Button>
          </>
        )
      }
    >
      {!status ? (
        <div className="space-y-4">
          <Field label="CSV file">
            <label className="input flex cursor-pointer items-center gap-2 text-ink-500">
              <Upload size={16} />
              {file ? file.name : 'Choose a .csv file…'}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </Field>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
              className="h-4 w-4 rounded border-ink-300"
            />
            Skip rows that match an existing lead's email or phone
          </label>

          <div className="rounded-lg bg-ink-50 p-3 text-xs text-ink-500">
            <p className="mb-1 font-semibold text-ink-700">Recognized columns (case-insensitive):</p>
            <p className="font-mono">{RECOGNIZED_COLUMNS}</p>
            <p className="mt-2">Only <span className="font-semibold">name</span> and <span className="font-semibold">phone</span> are required per row. Max file size 5MB.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {!isDone && (
            <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
              <Loader2 size={14} className="animate-spin" />
              Importing in the background — {status.processedCount} of {status.totalRows} processed ({pct}%). You can close this and keep working; it'll keep running.
            </div>
          )}
          {!isDone && (
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded-lg border border-ink-100 p-3">
              <p className="text-lg font-bold text-ink-900">{status.totalRows}</p>
              <p className="text-xs text-ink-500">Total rows</p>
            </div>
            <div className="rounded-lg border border-green-100 bg-green-50 p-3">
              <p className="flex items-center justify-center gap-1 text-lg font-bold text-green-700"><CheckCircle2 size={16} /> {status.createdCount}</p>
              <p className="text-xs text-green-700">Created</p>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
              <p className="flex items-center justify-center gap-1 text-lg font-bold text-amber-700"><SkipForward size={16} /> {status.skippedCount}</p>
              <p className="text-xs text-amber-700">Skipped (duplicate)</p>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50 p-3">
              <p className="flex items-center justify-center gap-1 text-lg font-bold text-red-700"><XCircle size={16} /> {status.failedCount}</p>
              <p className="text-xs text-red-700">Failed</p>
            </div>
          </div>

          {status.errors.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-red-100">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-red-50 text-red-700">
                  <tr><th className="px-3 py-1.5">Line</th><th className="px-3 py-1.5">Error</th></tr>
                </thead>
                <tbody>
                  {status.errors.map((e, i) => (
                    <tr key={i} className="border-t border-red-50">
                      <td className="px-3 py-1.5 text-ink-500">{e.line}</td>
                      <td className="px-3 py-1.5 text-ink-700">{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}