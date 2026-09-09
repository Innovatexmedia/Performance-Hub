import { LegalLayout, LegalSection } from './LegalLayout';

export function RefundPolicy() {
  return (
    <LegalLayout title="Refund & Cancellation Policy" updated="September 2026">
      <p>
        This policy covers your InnovateX Revenue OS subscription only. It does not cover any
        WhatsApp messaging charges billed to you directly by Meta — those are governed entirely
        by Meta's own billing and are outside our control.
      </p>

      <LegalSection title="1. Cancelling your subscription">
        <p>
          You can cancel your subscription at any time from Settings → Billing. Cancellation
          stops the next billing cycle — you keep access to your current plan until the end of
          the period you've already paid for.
        </p>
      </LegalSection>

      <LegalSection title="2. Refund eligibility">
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <span className="font-medium text-ink-800">First-time subscribers:</span> if you're
            charged for a paid plan for the first time and are not satisfied, you may request a
            full refund within 7 days of that charge.
          </li>
          <li>
            <span className="font-medium text-ink-800">Duplicate or failed charges:</span> if you
            were charged more than once for the same billing cycle due to a payment gateway or
            technical error, the duplicate charge is refunded in full once verified.
          </li>
          <li>
            <span className="font-medium text-ink-800">Renewal charges:</span> subscription
            renewals are non-refundable once the billing cycle has started, except where required
            by law. We recommend cancelling before your renewal date if you don't intend to
            continue.
          </li>
          <li>
            <span className="font-medium text-ink-800">Plan downgrades:</span> downgrading mid-cycle
            takes effect at the start of your next billing cycle; we do not prorate refunds for the
            remainder of the current cycle.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. How to request a refund">
        <p>
          Email{' '}
          <a href="mailto:Innovatexmedia@gmail.com" className="text-brand-600 hover:underline">
            Innovatexmedia@gmail.com
          </a>{' '}
          with your registered email address, workspace name, and the transaction date. We
          respond within 48 hours.
        </p>
      </LegalSection>

      <LegalSection title="4. Refund processing time">
        <p>
          Approved refunds are issued to the original payment method via our payment processor
          (Razorpay or Cashfree) and typically reflect within 5–7 business days, depending on your
          bank or card network.
        </p>
      </LegalSection>

      <LegalSection title="5. WhatsApp / Meta charges">
        <p>
          Because we operate on a bring-your-own-WhatsApp-Business-Account model, any messaging
          conversation charges are billed by Meta directly to your connected payment method with
          Meta, not by us. Disputes or refunds for those charges must be raised directly with
          Meta Business Support.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}