import { useEffect, useRef, useState } from 'react';
import { Variable } from 'lucide-react';
import { nurtureApi } from '@/lib/nurtureApi';
import type { VariableGroup } from '@/types/nurture';

/**
 * InsertVariablePicker -- reads the real variable list from the backend
 * (GET /whatsapp/nurtures/variables), the same registry the execution
 * engine's interpolation actually uses -- not a separately hardcoded
 * frontend copy that could drift out of sync.
 *
 * Inserts {{path}} at the target textarea/input's current cursor
 * position via a real ref, not just appended to the end.
 */
export function InsertVariablePicker({ targetRef, onInsert }: {
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  onInsert: (newValue: string) => void;
}) {
  const [groups, setGroups] = useState<VariableGroup[]>([]);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    nurtureApi.getVariables().then(setGroups).catch(() => setGroups([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const insertVariable = (path: string) => {
    const el = targetRef.current;
    const token = `{{${path}}}`;
    if (!el) {
      onInsert(token);
      setOpen(false);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newValue = el.value.slice(0, start) + token + el.value.slice(end);
    onInsert(newValue);
    setOpen(false);
    // Restore focus and real cursor position after the inserted token.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-600 hover:bg-ink-50"
      >
        <Variable size={12} /> Insert Variable
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-ink-200 bg-white p-2 shadow-lg">
          {groups.length === 0 ? (
            <p className="p-2 text-xs text-ink-400">Loading variables…</p>
          ) : (
            groups.map((g) => (
              <div key={g.group} className="mb-2">
                <p className="px-1.5 py-1 text-xs font-semibold text-ink-500">{g.group}</p>
                {g.variables.map((v) => (
                  <button
                    key={v.path}
                    type="button"
                    onClick={() => insertVariable(v.path)}
                    className="flex w-full flex-col items-start rounded-md px-1.5 py-1.5 text-left hover:bg-ink-50"
                  >
                    <span className="text-xs font-medium text-ink-800">{v.label}</span>
                    <span className="text-[11px] text-ink-400">{`{{${v.path}}}`} — e.g. {v.example}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
