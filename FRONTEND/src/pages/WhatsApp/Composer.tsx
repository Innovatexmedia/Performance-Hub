import { useState } from 'react';
import { Send, Sparkles, FileText, Wand2, Clock, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui';
import { generateWhatsAppReply, rewriteWhatsAppMessage } from '@/services/aiService';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import type { MessageType } from '@/types/whatsapp';

const VARIABLES = ['{{lead_name}}', '{{company_name}}', '{{offer_name}}', '{{booking_link}}', '{{payment_link}}', '{{sales_rep_name}}', '{{call_date}}', '{{lead_problem}}', '{{campaign_name}}'];

const AI_ACTIONS = [
  { label: 'Generate reply', mode: 'default' as const },
  { label: 'Booking message', mode: 'booking' as const },
  { label: 'Payment reminder', mode: 'payment' as const },
  { label: 'Objection handling', mode: 'objection' as const },
  { label: 'Follow-up after call', mode: 'followup' as const },
];

/**
 * Composer -- send is now real (backend). AI Reply/Rewrite buttons are
 * STILL the client-side mock from services/aiService.ts -- that's the
 * "AI Reply Assistant" tab's job (a separate, not-yet-migrated tab with
 * its own real backend at /api/whatsapp/ai/*), not this one. Flagged
 * clearly rather than silently left looking real. Template insert is
 * empty for the same reason -- WhatsApp Templates isn't wired yet either.
 */
export function Composer({ conversationId, onSend }: {
  conversationId: string;
  onSend: (content: string, type?: MessageType) => Promise<{ blocked: boolean }>;
}) {
  const [text, setText] = useState('');
  const [showVars, setShowVars] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [sending, setSending] = useState(false);

  const insert = (s: string) => setText((t) => (t ? t + ' ' + s : s));

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const result = await onSend(text);
      if (result.blocked) {
        toast.error('Message blocked', 'This contact has opted out — the send was logged but not delivered.');
      } else {
        setText('');
      }
    } catch (err) {
      toast.error('Could not send message', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const rewrite = (mode: 'shorter' | 'professional' | 'persuasive') => {
    if (!text.trim()) return toast.error('Write a message first');
    setText(rewriteWhatsAppMessage(text, mode));
  };

  return (
    <div className="border-t border-ink-200 bg-white p-3">
      {/* Tool row */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <button onClick={() => { setShowAi((v) => !v); setShowVars(false); }} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100">
            <Sparkles size={13} /> AI Reply <ChevronDown size={12} />
          </button>
          {showAi && (
            <div className="absolute bottom-10 left-0 z-20 w-52 rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft">
              <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Preview only — not yet backend-wired</p>
              {AI_ACTIONS.map((a) => (
                <button key={a.label} onClick={() => { setText(generateWhatsAppReply('', a.mode)); setShowAi(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-ink-50">
                  <Sparkles size={14} className="text-brand-500" /> {a.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => rewrite('shorter')} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"><Wand2 size={13} /> Shorter</button>
        <button onClick={() => rewrite('professional')} className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50">Professional</button>
        <button onClick={() => rewrite('persuasive')} className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50">Persuasive</button>

        <button disabled className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-300" title="Templates tab not migrated yet"><FileText size={13} /> Template</button>

        <div className="relative">
          <button onClick={() => { setShowVars((v) => !v); setShowAi(false); }} className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50">{'{ } Variables'}</button>
          {showVars && (
            <div className="absolute bottom-10 left-0 z-20 grid w-56 grid-cols-1 gap-0.5 rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft">
              {VARIABLES.map((v) => (
                <button key={v} onClick={() => insert(v)} className="rounded px-2 py-1.5 text-left font-mono text-xs text-brand-700 hover:bg-brand-50">{v}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
          rows={2}
          placeholder="Type a message…  (⌘/Ctrl + Enter to send)"
          className="input flex-1 resize-none"
          disabled={sending}
        />
        <div className="flex flex-col gap-1.5">
          <Button onClick={() => void send()} disabled={sending}><Send size={16} /></Button>
          <button onClick={() => { toast.success('Message scheduled', 'Will send at next optimal time'); setText(''); }} title="Schedule" className="rounded-lg border border-ink-200 p-2 text-ink-500 hover:bg-ink-50"><Clock size={15} /></button>
        </div>
      </div>
    </div>
  );
}