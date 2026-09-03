/**
 * Phone number normalization -- shared across Consent, Leads, and every
 * WhatsApp provider.
 *
 * WHY THIS EXISTS: phone numbers arrive in wildly inconsistent shapes
 * depending on entry point -- a manually-typed 10-digit number, a CSV
 * import column, Meta's inbound webhook wa_id (already digits-only WITH
 * country code), a number with a leading trunk '0', one with a '+' and
 * spaces from a business card. Treated as different strings, these
 * create duplicate Consent/Lead records for the same real person --
 * worse, an opt-out recorded against one variant does NOT protect the
 * other variant from being messaged, and a send to a bare 10-digit
 * number (missing country code) can fail outright or reach the wrong
 * recipient once combined with someone else's country code downstream.
 *
 * This replaces three previously-separate, independently-written
 * normalizers (duplicate-detection/duplicate.rules.js,
 * providers/meta.provider.js, providers/dialog360.provider.js) --
 * ALL THREE stripped non-digit characters but NONE of them added a
 * missing country code, which is the actual root cause of the
 * duplicate-contact bug this fixes.
 *
 * Canonical format: digits only, always WITH country code, no '+', no
 * leading 0 -- e.g. "918660898992". This matches exactly what Meta's
 * own webhook payloads already send (msg.from / contact.wa_id) and
 * what Meta's Cloud API's `to` field expects, so WhatsApp-inbound
 * records and outbound sends both need zero further transformation.
 *
 * DEFAULT_COUNTRY_CODE assumes India (91) when a bare 10-digit local
 * mobile number is given with no country code -- correct default for
 * this deployment's userbase. Pass { countryCode } to override for a
 * tenant with a genuinely different default market.
 */
const DEFAULT_COUNTRY_CODE = '91';

/**
 * Normalizes a phone number to the canonical digits-with-country-code
 * form used for storage and comparison EVERYWHERE (Consent.phoneNumber,
 * outbound provider `to` fields, duplicate-lead matching).
 * Never throws -- an unparseable input is returned as digits-only
 * best-effort rather than crashing the caller.
 */
export function normalizePhoneNumber(raw, { countryCode = DEFAULT_COUNTRY_CODE } = {}) {
  if (!raw) return raw;
  const digits = String(raw).replace(/[^\d]/g, ''); // strip +, spaces, dashes, parens, etc.
  if (!digits) return String(raw).trim();

  // Bare 10-digit local mobile number -- the single most common case
  // for a manually-typed or CSV-imported Indian number -- prepend the
  // assumed country code. This is the exact case that was silently
  // broken before: "8660898992" stayed "8660898992" forever.
  if (digits.length === 10) {
    return `${countryCode}${digits}`;
  }

  // Leading trunk '0' + 10-digit local number (common manual-entry format,
  // e.g. "08660898992").
  if (digits.length === 11 && digits.startsWith('0')) {
    return `${countryCode}${digits.slice(1)}`;
  }

  // Already has a country code (e.g. "918660898992") or is some other
  // length/format this function doesn't have a specific rule for --
  // used as-is rather than guessed at further.
  return digits;
}

/**
 * Every plausible RAW variant of a canonical number -- used ONLY to
 * match against legacy Lead.phone/whatsapp_number values that were
 * stored before normalization existed and haven't been migrated yet.
 * Never used for new writes (those always go through
 * normalizePhoneNumber directly and store the canonical form).
 */
export function phoneVariants(canonical, { countryCode = DEFAULT_COUNTRY_CODE } = {}) {
  if (!canonical) return [];
  const digits = String(canonical).replace(/[^\d]/g, '');
  const variants = new Set([digits, `+${digits}`]);

  if (digits.startsWith(countryCode) && digits.length > countryCode.length) {
    const local = digits.slice(countryCode.length);
    variants.add(local);
    variants.add(`0${local}`);
  }
  return [...variants];
}