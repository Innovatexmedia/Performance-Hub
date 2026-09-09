import { LegalLayout, LegalSection } from './LegalLayout';

export function TermsAndConditions() {
  return (
    <LegalLayout title="Terms & Conditions" updated="September 2026">
      <p>
        These Terms & Conditions ("Terms") govern access to and use of InnovateX Revenue OS
        ("the Platform", "we", "us"), operated by InnovateX Media. By creating a workspace or
        using the Platform, you ("Customer", "you") agree to these Terms.
      </p>

      <LegalSection title="1. The Service">
        <p>
          InnovateX Revenue OS is a subscription-based, multi-tenant business software (SaaS)
          platform providing WhatsApp-based lead messaging, pipeline management, bookings,
          nurture automation, call intelligence, and related revenue-operations tools for
          businesses.
        </p>
      </LegalSection>

      <LegalSection title="2. Bring-Your-Own WhatsApp Business Account (BYO-WABA)">
        <p>
          The Platform operates on a "bring your own WhatsApp Business Account" model. You
          connect your own Meta / WhatsApp Business Account to the Platform. Meta Platforms,
          Inc. bills you directly, at Meta's own published rates, for any WhatsApp messaging
          usage (conversations, templates, etc.) — InnovateX does not mark up, resell, or add any
          margin on top of Meta's messaging charges. Your separate InnovateX subscription fee
          covers access to the Platform's software only.
        </p>
        <p>
          You are responsible for maintaining your WhatsApp Business Account in good standing
          with Meta's own policies, including its commerce and messaging policies. InnovateX is
          not responsible for any suspension, restriction, or ban applied by Meta to your account.
        </p>
      </LegalSection>

      <LegalSection title="3. Subscriptions & Billing">
        <p>
          Paid plans are billed in advance on a recurring (typically monthly) basis via our
          third-party payment processors (Razorpay and/or Cashfree). By subscribing, you
          authorise recurring charges to your chosen payment method until you cancel.
        </p>
        <p>
          Plan limits (users, leads, modules, etc.) are described on the Plans section of our
          website at the time of purchase and may be revised for future billing cycles with
          reasonable prior notice.
        </p>
      </LegalSection>

      <LegalSection title="4. Acceptable Use">
        <p>You agree not to use the Platform to:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>Send unsolicited messages to contacts who have not opted in, or to contacts after they have opted out;</li>
          <li>Violate Meta's WhatsApp Business Messaging Policy or Commerce Policy;</li>
          <li>Transmit unlawful, fraudulent, defamatory, or infringing content;</li>
          <li>Attempt to gain unauthorised access to the Platform, other tenants' data, or our infrastructure.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Your Data">
        <p>
          You retain ownership of the lead, customer, and business data you upload to or generate
          within your workspace ("Customer Data"). We process Customer Data solely to provide the
          Platform's services to you, as described in our{' '}
          <a href="/privacy-policy" className="text-brand-600 hover:underline">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection title="6. Third-Party Integrations">
        <p>
          The Platform integrates with third-party services (including Meta/WhatsApp, Cal.com,
          Razorpay, Cashfree, SendGrid, Shopify, and Google Ads) at your direction. Your use of
          those services is governed by each provider's own terms; we are not responsible for
          their availability, accuracy, or conduct.
        </p>
      </LegalSection>

      <LegalSection title="7. Termination">
        <p>
          You may stop using the Platform and cancel your subscription at any time from your
          account settings. We may suspend or terminate access for material breach of these Terms,
          including violations of Meta's messaging policies that put your account or other
          tenants at risk.
        </p>
      </LegalSection>

      <LegalSection title="8. Limitation of Liability">
        <p>
          The Platform is provided "as is." To the maximum extent permitted by law, InnovateX
          Media is not liable for indirect, incidental, or consequential damages, including lost
          revenue or lost messaging credits, arising from your use of the Platform or of
          third-party services it integrates with.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes to These Terms">
        <p>
          We may update these Terms from time to time. Continued use of the Platform after an
          update constitutes acceptance of the revised Terms.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p>
          Questions about these Terms can be sent to{' '}
          <a href="mailto:Innovatexmedia@gmail.com" className="text-brand-600 hover:underline">
            Innovatexmedia@gmail.com
          </a>.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}