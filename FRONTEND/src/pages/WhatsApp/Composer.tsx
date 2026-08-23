import { useRef, useState } from 'react';
import { Send, Sparkles, FileText, Wand2, Clock, ChevronDown, Bookmark, Plus, Pencil, Trash2, Paperclip, Image as ImageIcon, Mic, Square, X, Smile } from 'lucide-react';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { cn, Modal, Button, Field, Input, Textarea } from '@/components/ui';
import { aiReplyAssistantApi } from '@/lib/aiReplyAssistantApi';
import { whatsappInboxApi } from '@/lib/whatsappInboxApi';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { useSavedReplies } from '@/hooks/useSavedReplies';
import type { SavedReply } from '@/types/savedReply';
import type { MessageType, Message, LeadContext, UploadedMedia } from '@/types/whatsapp';
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

/** Small status line under a staged attachment -- spinner while
 * uploading, a real "Ready to send" once done, or a plain failure
 * message. Shared across all three attachment types instead of
 * repeating the same three-way ternary at each call site. */
function UploadStatusLine({ uploading, uploaded }: { uploading: boolean; uploaded: boolean }) {
  if (uploading) {
    return (
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-400">
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-ink-300 border-t-brand-500" />
        Uploading…
      </p>
    );
  }
  return <p className={cn('mt-0.5 text-xs', uploaded ? 'text-emerald-600' : 'text-red-500')}>{uploaded ? 'Ready to send' : 'Upload failed'}</p>;
}

export function Composer({ conversationId, onSend, messages, leadContext }: {
  conversationId: string;
  onSend: (content: string, type?: MessageType, media?: { url: string; filename?: string } | null) => Promise<{ blocked: boolean }>;
  messages: Message[];
  leadContext: LeadContext | null;
}) {
  const [text, setText] = useState('');
  const [showVars, setShowVars] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  // Attachment picked (image/document) or recorded (voice note), staged
  // here BEFORE actually sending -- the file is uploaded to Cloudinary
  // immediately on selection/recording-stop (so the send itself is fast,
  // no upload-then-send round trip visible in the composer), but the
  // user still explicitly hits Send to actually deliver it, same as text.
  const [attachment, setAttachment] = useState<{ file: File; type: MessageType; previewUrl: string; durationLabel?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedMedia | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Voice note recording -- real browser microphone capture via
  // MediaRecorder, not a placeholder. Produces a Blob on stop, which
  // flows through the exact same stageAndUpload() path as a picked file.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordSecondsRef = useRef(0); // mirrors recordSeconds state so onstop's closure (captured once at recorder creation) always reads the live value, not a stale 0

  const { savedReplies, loading: savedLoading, createSavedReply, updateSavedReply, deleteSavedReply } = useSavedReplies();
  const [replyForm, setReplyForm] = useState<{ mode: 'create' | 'edit'; reply?: SavedReply } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedReply | null>(null);

  const insert = (s: string) => setText((t) => (t ? t + ' ' + s : s));

  /** Inserts at the actual cursor position (not just appended to the
   * end) -- matters much more for emoji than for {{variables}}, since
   * you typically want an emoji exactly where you're typing, mid-sentence,
   * not always tacked on at the end. Restores focus + cursor position
   * after inserting so you can keep typing immediately. */
  const insertAtCursor = (s: string) => {
    const el = textareaRef.current;
    if (!el) return insert(s);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + s.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    insertAtCursor(emojiData.emoji);
  };

  const clearAttachment = () => {
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment(null);
    setUploaded(null);
  };

  const stageAndUpload = async (file: File, type: MessageType, durationLabel?: string) => {
    // 5MB matches the backend's multer limit (shared/middlewares/upload.middleware.js)
    // -- checked here too so the user gets an immediate, specific error
    // instead of waiting for a round trip just to find out.
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large', 'Maximum size is 5MB (WhatsApp media limit).');
      return;
    }
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
    const previewUrl = URL.createObjectURL(file);
    setAttachment({ file, type, previewUrl, durationLabel });
    setUploaded(null);
    setUploading(true);
    try {
      const result = await whatsappInboxApi.uploadMedia(file);
      setUploaded(result);
    } catch (err) {
      toast.error('Upload failed', err instanceof ApiError ? err.message : 'Please try again.');
      clearAttachment();
    } finally {
      setUploading(false);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Not supported', 'Voice recording needs microphone access, not available in this browser/context.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordedChunksRef.current = [];
      // audio/webm is broadly supported and is what MediaRecorder produces
      // by default in Chrome/Firefox/Edge; Meta's Cloud API accepts webm
      // (OPUS) audio for voice-note-style sends.
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
        void stageAndUpload(file, 'audio', formatDuration(recordSecondsRef.current));
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordSecondsRef.current = 0;
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => { recordSecondsRef.current = s + 1; return s + 1; }), 1000);
    } catch {
      toast.error('Microphone access denied', 'Allow microphone permission to record a voice note.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
  };

  const cancelRecording = () => {
    // Stop without staging/uploading -- swap the recorder's onstop handler
    // first so the normal "produce a file and upload it" flow doesn't run.
    if (mediaRecorderRef.current) mediaRecorderRef.current.onstop = () => recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
  };

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const send = async () => {
    if (sending || uploading) return;
    if (attachment) {
      if (!uploaded) return; // still uploading -- send button is disabled in this state too
      setSending(true);
      try {
        const result = await onSend(text, attachment.type, { url: uploaded.url, filename: uploaded.filename });
        if (result.blocked) {
          toast.error('Message blocked', 'This contact has opted out — the send was logged but not delivered.');
        } else {
          setText('');
          clearAttachment();
        }
      } catch (err) {
        toast.error('Could not send message', err instanceof ApiError ? err.message : 'Please try again.');
      } finally {
        setSending(false);
      }
      return;
    }

    if (!text.trim()) return;
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

  const useSavedReply = (reply: SavedReply) => {
    setText(reply.content);
    setShowSaved(false);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { id, title } = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteSavedReply(id);
      toast.success('Saved reply deleted', `"${title}" was removed.`);
    } catch (err) {
      toast.error('Could not delete saved reply', err instanceof ApiError ? err.message : 'Please try again.');
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
        {/* Hidden pickers -- triggered by the Paperclip menu below. Image
            vs document get separate inputs so `accept` can be scoped
            correctly for each (browsers ignore a combined accept list
            less usefully than two focused ones). */}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void stageAndUpload(f, 'image'); e.target.value = ''; }} />
        <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void stageAndUpload(f, 'document'); e.target.value = ''; }} />

        {/* Staged attachment preview -- shown above the textarea until
            Send is pressed or it's removed. Upload happens immediately on
            attach (spinner shown here), not deferred to Send time. Voice
            notes get a real playback preview + a human label ("Voice
            message · 0:04"), NOT the raw generated filename
            (voice-note-<timestamp>.webm) -- showing an internal filename
            for something the user just recorded is a leaky, unpolished
            detail nobody wants to see. Photos/documents still show their
            real filename, since that IS meaningful there (it's the
            user's own file). */}
        {attachment && (
          <div className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-3.5 py-2.5">
            {attachment.type === 'image' ? (
              <>
                <img src={attachment.previewUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-black/5" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-800">{attachment.file.name}</p>
                  <UploadStatusLine uploading={uploading} uploaded={!!uploaded} />
                </div>
              </>
            ) : attachment.type === 'audio' ? (
              <>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                  <Mic size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-ink-800">Voice message</p>
                    {attachment.durationLabel && <span className="text-xs text-ink-400">· {attachment.durationLabel}</span>}
                  </div>
                  {uploading || !uploaded ? (
                    <UploadStatusLine uploading={uploading} uploaded={!!uploaded} />
                  ) : (
                    <audio controls src={attachment.previewUrl} className="mt-1 h-8 w-full max-w-[280px]" />
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500"><FileText size={18} /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-800">{attachment.file.name}</p>
                  <UploadStatusLine uploading={uploading} uploaded={!!uploaded} />
                </div>
              </>
            )}
            <button onClick={clearAttachment} title="Remove attachment" className="shrink-0 self-start rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Recording indicator -- takes over in place of the textarea
            while actively recording a voice note, matching the pattern
            WhatsApp's own client uses (record OR type, not both at once).
            A few CSS-only animated bars stand in for a real waveform
            (no audio-analysis library needed) so this doesn't read as a
            static, dead state while actually recording. */}
        {recording ? (
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
            <div className="flex items-end gap-0.5">
              {[6, 12, 8, 16, 10, 14, 7].map((h, i) => (
                <span key={i} className="w-0.5 animate-pulse rounded-full bg-red-400" style={{ height: h, animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
            <span className="text-sm font-semibold tabular-nums text-ink-700">{formatDuration(recordSeconds)}</span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={cancelRecording} className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-ink-100">Cancel</button>
              <button
                onClick={stopRecording}
                title="Stop and preview"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white shadow-sm transition hover:bg-red-600"
              >
                <Square size={13} fill="currentColor" />
              </button>
            </div>
          </div>
        ) : (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
          rows={2}
          placeholder={attachment ? 'Add a caption… (optional)' : 'Type a message…  (⌘/Ctrl + Enter to send)'}
          className="w-full resize-none rounded-t-2xl border-0 bg-transparent px-4 pb-1 pt-3 text-sm text-ink-900 outline-none placeholder:text-ink-400"
          disabled={sending}
        />
        )}

        {/* Contextual toolbar -- same underlying actions as before (AI Reply
            generation + Shorter/Professional/Persuasive rewrite), just
            gathered into one "AI" menu instead of a permanent button row. */}
        {!recording && (
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <div className="relative">
            <button
              onClick={() => { setShowAttach((v) => !v); setShowAi(false); setShowVars(false); setShowSaved(false); setShowEmoji(false); }}
              disabled={uploading || !!attachment}
              title="Attach"
              className={cn('rounded-lg p-2 transition disabled:opacity-40', showAttach ? 'bg-ink-100 text-ink-700' : 'text-ink-500 hover:bg-ink-100')}
            >
              <Paperclip size={15} />
            </button>
            {showAttach && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-44 rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft">
                <button onClick={() => { fileInputRef.current?.click(); setShowAttach(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-ink-50">
                  <ImageIcon size={14} className="text-brand-500" /> Photo
                </button>
                <button onClick={() => { docInputRef.current?.click(); setShowAttach(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-ink-50">
                  <FileText size={14} className="text-ink-400" /> Document
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => { setShowEmoji((v) => !v); setShowAi(false); setShowVars(false); setShowSaved(false); setShowAttach(false); }}
              title="Emoji"
              className={cn('rounded-lg p-2 transition', showEmoji ? 'bg-ink-100 text-ink-700' : 'text-ink-500 hover:bg-ink-100')}
            >
              <Smile size={15} />
            </button>
            {showEmoji && (
              <div className="absolute bottom-full left-0 z-20 mb-2">
                <EmojiPicker onEmojiClick={onEmojiClick} theme={Theme.LIGHT} width={320} height={380} lazyLoadEmojis />
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => { setShowAi((v) => !v); setShowVars(false); setShowSaved(false); setShowAttach(false); setShowEmoji(false); }}
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

          {/* Saved replies -- persisted canned responses (create / edit /
              delete backed by /api/whatsapp/saved-replies), separate from
              the AI menu since these are the user's own fixed text, not
              generated on demand. */}
          <div className="relative">
            <button
              onClick={() => { setShowSaved((v) => !v); setShowAi(false); setShowVars(false); setShowAttach(false); setShowEmoji(false); }}
              className={cn('inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition', showSaved ? 'bg-ink-100 text-ink-700' : 'text-ink-500 hover:bg-ink-100')}
            >
              <Bookmark size={14} /> Saved
            </button>
            {showSaved && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-ink-200 bg-white p-1.5 shadow-soft">
                <div className="flex items-center justify-between px-2 pb-1 pt-1">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Saved replies</p>
                  <button
                    onClick={() => setReplyForm({ mode: 'create' })}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-50"
                  >
                    <Plus size={12} /> New
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {savedLoading && <p className="px-2.5 py-3 text-center text-xs text-ink-400">Loading…</p>}
                  {!savedLoading && savedReplies.length === 0 && (
                    <p className="px-2.5 py-3 text-center text-xs text-ink-400">No saved replies yet.</p>
                  )}
                  {savedReplies.map((r) => (
                    <div key={r.id} className="group/reply flex items-start gap-1 rounded-lg px-1 py-0.5 hover:bg-ink-50">
                      <button onClick={() => useSavedReply(r)} className="min-w-0 flex-1 rounded-lg px-1.5 py-1.5 text-left">
                        <p className="truncate text-sm font-medium text-ink-800">{r.title}</p>
                        <p className="truncate text-xs text-ink-400">{r.content}</p>
                      </button>
                      <div className="flex shrink-0 items-center gap-0.5 pt-1 opacity-0 transition group-hover/reply:opacity-100">
                        <button onClick={() => setReplyForm({ mode: 'edit', reply: r })} title="Edit" className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => setDeleteTarget(r)} title="Delete" className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button onClick={() => { setShowVars((v) => !v); setShowAi(false); setShowSaved(false); setShowAttach(false); setShowEmoji(false); }} className={cn('rounded-lg px-2.5 py-1.5 text-xs font-medium transition', showVars ? 'bg-ink-100 text-ink-700' : 'text-ink-500 hover:bg-ink-100')}>
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

          <button disabled className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-300" title="Templates tab not migrated yet">
            <FileText size={14} /> Template
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => { toast.success('Message scheduled', 'Will send at next optimal time'); setText(''); }} title="Schedule" className="rounded-full p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-600">
              <Clock size={16} />
            </button>
            {!text.trim() && !attachment && (
              <button onClick={() => void startRecording()} title="Record voice note" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-100">
                <Mic size={17} />
              </button>
            )}
            <button
              onClick={() => void send()}
              disabled={sending || uploading || (attachment ? !uploaded : !text.trim())}
              title="Send"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400 disabled:shadow-none"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
        )}
      </div>

      {replyForm && (
        <SavedReplyFormModal
          key={replyForm.reply?.id ?? 'create'}
          mode={replyForm.mode}
          initial={replyForm.reply}
          onClose={() => setReplyForm(null)}
          onCreate={createSavedReply}
          onUpdate={updateSavedReply}
        />
      )}

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete saved reply?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={() => void confirmDelete()}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          Are you sure you want to delete <span className="font-semibold text-ink-800">"{deleteTarget?.title}"</span>? This can't be undone.
        </p>
      </Modal>
    </div>
  );
}

// ---- SavedReplyFormModal: shared create/edit form ---------------------
// Keyed by the target's id (or 'create') from the parent so switching
// between two different saved replies to edit -- or between edit and
// create -- always starts with fresh field values instead of leftover
// text from whatever was open before.
function SavedReplyFormModal({
  mode, initial, onClose, onCreate, onUpdate,
}: {
  mode: 'create' | 'edit';
  initial?: SavedReply;
  onClose: () => void;
  onCreate: (input: { title: string; content: string }) => Promise<SavedReply>;
  onUpdate: (id: string, patch: { title: string; content: string }) => Promise<SavedReply>;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [saving, setSaving] = useState(false);
  const canSave = title.trim().length > 0 && content.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (mode === 'edit' && initial) {
        await onUpdate(initial.id, { title: title.trim(), content: content.trim() });
        toast.success('Saved reply updated');
      } else {
        await onCreate({ title: title.trim(), content: content.trim() });
        toast.success('Saved reply created');
      }
      onClose();
    } catch (err) {
      toast.error(mode === 'edit' ? 'Could not update saved reply' : 'Could not create saved reply', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'edit' ? 'Edit saved reply' : 'New saved reply'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSave()} disabled={!canSave || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Greeting" maxLength={80} autoFocus />
        </Field>
        <Field label="Message" hint="Supports variables like {{lead_name}} and {{company_name}}.">
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} placeholder="Type the reply text…" maxLength={4000} />
        </Field>
      </div>
    </Modal>
  );
}