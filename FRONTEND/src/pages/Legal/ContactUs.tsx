import { Mail, MapPin, Clock } from 'lucide-react';
import { LegalLayout } from './LegalLayout';

export function ContactUs() {
  return (
    <LegalLayout title="Contact Us">
      <p>
        Have a question about InnovateX Revenue OS, need help with your account, or want to talk
        before you sign up? Reach out — we read every message ourselves.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-ink-100 p-4">
          <div className="flex items-center gap-2 text-ink-900">
            <Mail size={16} className="text-brand-600" />
            <span className="text-sm font-semibold">Email</span>
          </div>
          <a
            href="mailto:Innovatexmedia@gmail.com"
            className="mt-1 block text-sm text-ink-600 hover:text-brand-600 hover:underline"
          >
            Innovatexmedia@gmail.com
          </a>
          <p className="mt-1 text-xs text-ink-400">General queries, billing, and support</p>
        </div>

        <div className="rounded-xl border border-ink-100 p-4">
          <div className="flex items-center gap-2 text-ink-900">
            <Clock size={16} className="text-brand-600" />
            <span className="text-sm font-semibold">Response time</span>
          </div>
          <p className="mt-1 text-sm text-ink-600">Within 24–48 hours, Monday–Saturday</p>
          <p className="mt-1 text-xs text-ink-400">Excluding public holidays</p>
        </div>

        <div className="rounded-xl border border-ink-100 p-4 sm:col-span-2">
          <div className="flex items-center gap-2 text-ink-900">
            <MapPin size={16} className="text-brand-600" />
            <span className="text-sm font-semibold">InnovateX Media</span>
          </div>
          <p className="mt-1 text-sm text-ink-600">India</p>
        </div>
      </div>

      <p className="text-xs text-ink-400">
        For billing or payment issues, please include your registered email address and, if
        possible, your workspace name so we can locate your account quickly.
      </p>
    </LegalLayout>
  );
}