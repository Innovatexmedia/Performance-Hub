import { useState } from 'react';
import { useSearchParams, useParams, Link } from 'react-router-dom';
import { Zap, CheckCircle2, ArrowRight, AlertCircle } from 'lucide-react';
import { publicCaptureApi } from '@/lib/publicCaptureApi';
import { ApiError, apiErrorMessage } from '@/lib/apiClient';
import { Button, Input, Field, Select, Badge } from '@/components/ui';

/**
 * Public lead-capture form -- the real landing page every ad campaign's
 * tracking link (campaigns/campaign.service.js's generateUtmLink) points
 * to. Captures UTM params from the URL query string and creates a REAL
 * Lead in this real tenant's own database via the public capture API.
 *
 * REAL FIX (confirmed by direct audit): this page previously called
 * useStore((s) => s.createLead) -- src/store/store.ts, a browser-only
 * localStorage mock left over from this app's original frontend-only
 * prototype phase. It never reached the real backend, meaning NO
 * ad-driven lead (Google Ads, Meta Ads, or otherwise) ever became a
 * real Lead, ever appeared on the Attribution dashboard, or could ever
 * be auto-enrolled by a Nurture sequence's conditions -- regardless of
 * how correctly everything downstream of lead-creation was built. Now
 * calls the real, tenant-scoped, public backend endpoint (see
 * publicCapture.service.js) instead.
 *
 * Real, tenant-scoped URL: /capture/:tenantId?source=&utm_source=&...
 * (previously /capture had no tenant identifier at all -- a genuine gap
 * this fix also closes, since a real multi-tenant capture page needs to
 * know whose lead a submission belongs to).
 */
export function CaptureForm() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [params] = useSearchParams();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', segment: 'Coaches', problem: '' });

  const utm = {
    source: params.get('source') || params.get('utm_source') || 'Direct',
    medium: params.get('utm_medium') || params.get('medium') || 'organic',
    campaign: params.get('utm_campaign') || params.get('campaign') || '',
    utm_source: params.get('utm_source') || '',
    utm_medium: params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || '',
    utm_content: params.get('utm_content') || '',
    utm_term: params.get('utm_term') || '',
    // Real ad-group/ad-set, ad, and click identifiers -- automatically
    // filled in by Google Ads ValueTrack / Meta's dynamic URL macros
    // (see campaign.service.js's getAdPlatformTrackingSetup), not typed
    // by anyone. click_id covers either Google's {gclid} or Meta's
    // fbclid (Meta auto-tagging appends fbclid to the URL itself when
    // enabled, separately from url_tags), whichever is actually present.
    ad_group_id: params.get('ad_group_id') || '',
    ad_id: params.get('ad_id') || '',
    click_id: params.get('click_id') || params.get('gclid') || params.get('fbclid') || '',
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) {
      setSubmitError('This form link is missing a workspace ID and cannot be submitted.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await publicCaptureApi.submit(tenantId, {
        name: form.name, email: form.email, phone: form.phone,
        company: form.company, segment: form.segment, notes: form.problem ? `Problem: ${form.problem}` : '',
        source: utm.source, medium: utm.medium, campaign: utm.campaign,
        utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign,
        utm_content: utm.utm_content, utm_term: utm.utm_term,
        ad_group_id: utm.ad_group_id, ad_id: utm.ad_id, click_id: utm.click_id,
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ink-50 to-brand-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white">
            <Zap size={20} fill="white" />
          </div>
          <div>
            <p className="font-bold text-ink-900">InnovateX Revenue OS</p>
            <p className="text-xs text-ink-500">Book your free strategy session</p>
          </div>
        </div>

        <div className="card p-6">
          {submitted ? (
            <div className="py-6 text-center">
              <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
              <h2 className="mt-4 text-xl font-bold text-ink-900">You're in! 🎉</h2>
              <p className="mt-2 text-sm text-ink-500">Your details were captured with full source attribution. Someone from the team will reach out shortly.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                <Badge tone="blue">source: {utm.source}</Badge>
                {utm.campaign && <Badge tone="violet">campaign: {utm.campaign}</Badge>}
                {utm.utm_medium && <Badge tone="teal">medium: {utm.utm_medium}</Badge>}
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-ink-900">Tell us about your business</h2>
              <p className="mt-1 text-sm text-ink-500">We'll match you with the right revenue plan.</p>
              {utm.source !== 'Direct' && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="blue">source: {utm.source}</Badge>
                  {utm.campaign && <Badge tone="violet">{utm.campaign}</Badge>}
                </div>
              )}
              {submitError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}
              <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3.5">
                <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
                <Field label="Work email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
                <Field label="WhatsApp number"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 415 555 0100" required /></Field>
                <Field label="Company"><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
                <Field label="I am a…">
                  <Select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
                    {['Coaches', 'EdTech', 'SaaS Founders', 'Ecommerce', 'Agencies', 'Consultants'].map((s) => <option key={s}>{s}</option>)}
                  </Select>
                </Field>
                <Field label="What's your biggest revenue challenge?">
                  <Input value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })} placeholder="e.g. slow lead follow-up" />
                </Field>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Submitting…' : <>Get my free session <ArrowRight size={16} /></>}
                </Button>
              </form>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-ink-400">
          <Link to="/login" className="font-medium text-brand-600 hover:underline">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
