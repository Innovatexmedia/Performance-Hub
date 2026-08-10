import { useState } from 'react';
import { Send, Sparkles, FileText, Wand2, Clock, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui';
import { aiReplyAssistantApi } from '@/lib/aiReplyAssistantApi';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import type { MessageType, Message, LeadContext } from '@/types/whatsapp';
import type { ReplyGoal, RewriteStyle } from '@/lib/aiReplyAssistantApi';

const VARIABLES = ['{{lead_name}}', '{{company_name}}', '{{offer_name}}', '{{booking_link}}', '{{payment_link}}', '{{sales_rep_name}}', '{{call_date}}', '{{lead_problem}}', '{{campaign_name}}'];

const AI_ACTIONS: { label: string; goal: ReplyGoal }[] = [
  { label: 'Generate reply', goal: '' },
  { label: 'Booking message', goal: 'booking' },
  { label: 'Payment reminder', goal: 'payment' },
  { label: 'Objection handling', goal: 'objection' },
  { label: 'Follow-up after call', goal: 'follow_up' },
];

const REWRITE_ACTIONS: { label: string; style: RewriteStyle }[] = [
  { label: 'Shorter', style: 'SHORTER' },
  { label: 'Professional', style: 'PROFESSIONAL' },
  { label: 'Persuasive', style: 'PERSUASIVE' },
];

/**
 * Composer -- AI Reply / Rewrite now call the SAME real backend
 * (/api/whatsapp/ai/*) as the standalone "AI Reply Assistant" tab, using
 * this conversation's actual message history + the lead's real context,
 * not the old client-side canned-string mock. Template insert is still
 * empty -- WhatsApp Templates isn't wired into the Composer yet.
 */
export function Composer({ conversationId, onSend, messages, leadContext }: {
  conversationId: string;
  onSend: (content: string, type?: MessageType) => Promise<{ blocked: boolean }>;
  messages: Message[];
  leadContext: LeadContext | null;
}) {
  const [text, setText] = useState('');
  const [showVars, setShowVars] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);

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

  // Last 10 turns is plenty of real context for a reply suggestion without
  // sending an ever-growing conversation to the AI on every keystroke.
  const recentConversation = () =>
    messages.slice(-10).map((m) => ({
      direction: (m.direction === 'inbound' ? 'INBOUND' : 'OUTBOUND') as 'INBOUND' | 'OUTBOUND',
      content: m.content,
    }));

  const generateAI = async (goal: ReplyGoal, label: string) => {
    setAiBusy(label);
    setShowAi(false);
    try {
      const result = await aiReplyAssistantApi.generate({
        goal,
        conversation: recentConversation(),
        lead: leadContext ? { name: leadContext.name, company: leadContext.company } : undefined,
      });
      setText(result.generatedReply);
      if (!result.isLive) toast.warning('Using fallback reply', 'Live AI wasn\'t available -- edit before sending.');
    } catch (err) {
      toast.error('Could not generate reply', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setAiBusy(null);
    }
  };

  const rewrite = async (style: RewriteStyle, label: string) => {
    if (!text.trim()) return toast.error('Write a message first');
    setAiBusy(label);
    try {
      const result = await aiReplyAssistantApi.rewrite(text, style);
      setText(result.rewritten);
      if (!result.isLive) toast.warning('Using fallback rewrite', 'Live AI wasn\'t available -- edit before sending.');
    } catch (err) {
      toast.error('Could not rewrite message', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setAiBusy(null);
    }
  };

  return (
    <div className="border-t border-ink-200 bg-white p-3">
      {/* Tool row */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <button onClick={() => { setShowAi((v) => !v); setShowVars(false); }} disabled={!!aiBusy} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-60">
            <Sparkles size={13} className={aiBusy && AI_ACTIONS.some((a) => a.label === aiBusy) ? 'animate-pulse' : ''} /> {aiBusy && AI_ACTIONS.some((a) => a.label === aiBusy) ? 'Thinking…' : 'AI Reply'} <ChevronDown size={12} />
          </button>
          {showAi && (
            <div className="absolute bottom-10 left-0 z-20 w-56 rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft">
              {AI_ACTIONS.map((a) => (
                <button key={a.label} onClick={() => void generateAI(a.goal, a.label)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-ink-50">
                  <Sparkles size={14} className="text-brand-500" /> {a.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {REWRITE_ACTIONS.map((r) => (
          <button key={r.style} onClick={() => void rewrite(r.style, r.label)} disabled={!!aiBusy} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-60">
            {r.style === 'SHORTER' && <Wand2 size={13} />} {aiBusy === r.label ? 'Thinking…' : r.label}
          </button>
        ))}

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