import { LegalLayout, LegalSection } from './LegalLayout';

export function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" updated="September 2026">
      <p>
        This Privacy Policy explains what information InnovateX Revenue OS ("the Platform")
        collects, how it's used, and how it's protected.
      </p>

      <LegalSection title="1. Information we collect">
        <ul className="ml-4 list-disc space-y-1">
          <li><span className="font-medium text-ink-800">Account information:</span> name, email, password (stored hashed), and workspace details you provide at signup.</li>
          <li><span className="font-medium text-ink-800">Customer/lead data:</span> the contacts, conversations, and pipeline data you and your team add to the Platform to run your business.</li>
          <li><span className="font-medium text-ink-800">Connected account credentials:</span> access tokens for services you choose to connect (WhatsApp/Meta, Cal.com, Shopify, Google Ads, SendGrid), stored encrypted at rest.</li>
          <li><span className="font-medium text-ink-800">Billing information:</span> processed directly by our payment partners (Razorpay, Cashfree) — we do not store your full card or bank details on our servers.</li>
          <li><span className="font-medium text-ink-800">Usage data:</span> log-in activity, feature usage, and error logs used to keep the Platform reliable.</li>
        </ul>
      </LegalSection>

      <LegalSection title="2. How we use this information">
        <ul className="ml-4 list-disc space-y-1">
          <li>To provide, maintain, and secure the Platform's core features;</li>
          <li>To send WhatsApp messages, emails, and notifications you or your automations trigger;</li>
          <li>To process subscription billing and send related receipts;</li>
          <li>To respond to support requests;</li>
          <li>To detect and prevent fraud, abuse, and security incidents.</li>
        </ul>
        <p>We do not sell your data or your customers' data to third parties.</p>
      </LegalSection>

      <LegalSection title="3. Data isolation between businesses">
        <p>
          The Platform is multi-tenant: your workspace's data is logically isolated from every
          other business using the Platform. Team members only see data within their own
          workspace, scoped by their assigned role.
        </p>
      </LegalSection>

      <LegalSection title="4. Third-party sharing">
        <p>
          We share information only with the third-party services you choose to connect (e.g.
          Meta/WhatsApp to deliver your messages, Cal.com to run your bookings, Razorpay/Cashfree
          to process payments) and with infrastructure providers that host the Platform
          (including our cloud hosting, database, and email-delivery providers), solely to
          operate the service.
        </p>
      </LegalSection>

      <LegalSection title="5. Data security">
        <p>
          Sensitive credentials (WhatsApp, ad platform, and other connected-account tokens) are
          encrypted at rest. Access to production data is restricted to authorised personnel.
          No method of transmission or storage is 100% secure, but we take reasonable technical
          and organisational measures to protect your information.
        </p>
      </LegalSection>

      <LegalSection title="6. Data retention">
        <p>
          We retain your account and workspace data for as long as your workspace remains active.
          If you close your account, we delete or anonymise your data within a reasonable period,
          except where retention is required for legal, tax, or fraud-prevention purposes.
        </p>
      </LegalSection>

      <LegalSection title="7. Your rights">
        <p>
          You can access, correct, export, or request deletion of your account data by contacting
          us. Team members can be removed from a workspace by their workspace admin at any time.
        </p>
      </LegalSection>

      <LegalSection title="8. Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. Material changes will be
          communicated via email or an in-app notice.
        </p>
      </LegalSection>

      <LegalSection title="9. Contact">
        <p>
          For any privacy-related question, email{' '}
          <a href="mailto:Innovatexmedia@gmail.com" className="text-brand-600 hover:underline">
            Innovatexmedia@gmail.com
          </a>.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}