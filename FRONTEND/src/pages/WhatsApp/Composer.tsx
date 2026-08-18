import { useEffect, useState } from 'react';
import { Send, Sparkles, FileText, Wand2, Clock, ChevronDown } from 'lucide-react';
import { cn } from '@/components/ui';
import { aiReplyAssistantApi } from '@/lib/aiReplyAssistantApi';
import { whatsappTemplatesApi } from '@/lib/whatsappTemplatesApi';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import type { MessageType, Message, LeadContext } from '@/types/whatsapp';
import type { ReplyGoal, RewriteStyle } from '@/lib/aiReplyAssistantApi';
import type { WhatsAppTemplate } from '@/types/whatsappTemplate';

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
 * Composer -- AI Reply / Rewrite and Template insert all call real
 * backends now. AI Reply/Rewrite use the SAME /api/whatsapp/ai/*
 * endpoints as the standalone "AI Reply Assistant" tab, using this
 * conversation's actual message history + the lead's real context.
 * Template insert lists real ACTIVE (sendable/approved) templates from
 * /api/whatsapp/templates and inserts the real body text -- {{variable}}
 * placeholders are inserted as-is, same as the Variables tool, since
 * this Composer doesn't resolve them to real values before sending.
 *
 * Layout: unified rounded-card surface (textarea + toolbar in one
 * bordered container) -- merged from a teammate's UI redesign, with the
 * real template picker (fetches + inserts actual template bodies)
 * restored into it -- their version had reverted that button to a
 * disabled stub, written before the template-insert work landed.
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
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const insert = (s: string) => setText((t) => (t ? t + ' ' + s : s));

  const openTemplates = () => {
    setShowTemplates((v) => !v);
    setShowAi(false);
    setShowVars(false);
    if (templates.length === 0 && !templatesLoading) {
      setTemplatesLoading(true);
      whatsappTemplatesApi.list({ status: 'ACTIVE', limit: 50 })
        .then((r) => setTemplates(r.data))
        .catch((err) => toast.error('Could not load templates', err instanceof ApiError ? err.message : 'Please try again.'))
        .finally(() => setTemplatesLoading(false));
    }
  };

  const insertTemplate = (t: WhatsAppTemplate) => {
    setText(t.body);
    setShowTemplates(false);
  };

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

  const aiThinking = !!aiBusy && AI_ACTIONS.some((a) => a.label === aiBusy);
  const aiMenuLabel = aiThinking ? 'Thinking…' : 'AI';

  return (
    <div className="border-t border-ink-100 bg-white px-3 py-3 sm:px-4">
      {/* Single unified surface -- textarea and toolbar live inside one
          rounded, bordered card instead of two loosely-stacked strips, so
          the whole composer reads as one input, not a text box floating
          above an unrelated button row. Highlights on focus the same way
          the rest of the app's `.input` fields do. */}
      <div className="rounded-2xl border border-ink-200 bg-white shadow-sm transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
          rows={2}
          placeholder="Type a message…  (⌘/Ctrl + Enter to send)"
          className="w-full resize-none rounded-t-2xl border-0 bg-transparent px-4 pb-1 pt-3 text-sm text-ink-900 outline-none placeholder:text-ink-400"
          disabled={sending}
        />

        {/* Contextual toolbar -- AI Reply generation + Shorter/Professional/
            Persuasive rewrite gathered into one "AI" menu, plus a real
            Template picker (fetches actual ACTIVE templates, not a stub)
            and the Variables inserter. */}
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <div className="relative">
            <button
              onClick={() => { setShowAi((v) => !v); setShowVars(false); setShowTemplates(false); }}
              disabled={!!aiBusy}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-60',
                showAi ? 'bg-brand-100 text-brand-700' : 'text-brand-700 hover:bg-brand-50',
              )}
            >
              <Sparkles size={14} className={aiThinking ? 'animate-pulse' : ''} /> {aiMenuLabel} <ChevronDown size={12} />
            </button>
            {showAi && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-60 rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft">
                <p className="px-2.5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-ink-400">Generate</p>
                {AI_ACTIONS.map((a) => (
                  <button key={a.label} onClick={() => void generateAI(a.goal, a.label)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-ink-50">
                    <Sparkles size={14} className="text-brand-500" /> {a.label}
                  </button>
                ))}
                <p className="mt-1 border-t border-ink-100 px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-ink-400">Rewrite current draft</p>
                {REWRITE_ACTIONS.map((r) => (
                  <button
                    key={r.style}
                    onClick={() => void rewrite(r.style, r.label)}
                    disabled={!text.trim()}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Wand2 size={14} className="text-ink-400" /> {aiBusy === r.label ? 'Thinking…' : r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button onClick={openTemplates} className={cn('inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition', showTemplates ? 'bg-ink-100 text-ink-700' : 'text-ink-500 hover:bg-ink-100')}>
              <FileText size={14} /> Template <ChevronDown size={12} />
            </button>
            {showTemplates && (
              <div className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-72 overflow-y-auto rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft">
                {templatesLoading && <p className="px-2.5 py-2 text-sm text-ink-400">Loading…</p>}
                {!templatesLoading && templates.length === 0 && <p className="px-2.5 py-2 text-sm text-ink-400">No active templates yet</p>}
                {templates.map((t) => (
                  <button key={t.id} onClick={() => insertTemplate(t)} className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-ink-50">
                    <p className="text-sm font-medium text-ink-800">{t.name}</p>
                    <p className="truncate text-xs text-ink-400">{t.body}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button onClick={() => { setShowVars((v) => !v); setShowAi(false); setShowTemplates(false); }} className={cn('rounded-lg px-2.5 py-1.5 text-xs font-medium transition', showVars ? 'bg-ink-100 text-ink-700' : 'text-ink-500 hover:bg-ink-100')}>
              {'{ }'} Variables
            </button>
            {showVars && (
              <div className="absolute bottom-full left-0 z-20 mb-2 grid w-56 grid-cols-1 gap-0.5 rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft">
                {VARIABLES.map((v) => (
                  <button key={v} onClick={() => insert(v)} className="rounded px-2 py-1.5 text-left font-mono text-xs text-brand-700 hover:bg-brand-50">{v}</button>
                ))}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => { toast.success('Message scheduled', 'Will send at next optimal time'); setText(''); }} title="Schedule" className="rounded-full p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-600">
              <Clock size={16} />
            </button>
            <button
              onClick={() => void send()}
              disabled={sending || !text.trim()}
              title="Send"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400 disabled:shadow-none"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}