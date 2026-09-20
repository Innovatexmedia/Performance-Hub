import { VARIABLE_PATTERN } from './submodules/templates/templates.constants.js';

/**
 * Field aliases → lead document paths. Lets a template author write
 * {{first_name}} or {{firstname}} and have it resolve sensibly.
 * Keys are compared lowercased with underscores/hyphens stripped.
 */
const LEAD_FIELD_ALIASES = Object.freeze({
  name:          (lead) => lead.name,
  fullname:      (lead) => lead.name,
  firstname:     (lead) => String(lead.name || '').trim().split(/\s+/)[0] || '',
  lastname:      (lead) => String(lead.name || '').trim().split(/\s+/).slice(1).join(' '),
  company:       (lead) => lead.company,
  companyname:   (lead) => lead.company,
  email:         (lead) => lead.email,
  phone:         (lead) => lead.phone,
  whatsappnumber:(lead) => lead.whatsapp_number || lead.phone,
  segment:       (lead) => lead.segment,
  source:        (lead) => lead.source,
  medium:        (lead) => lead.medium,
  campaign:      (lead) => lead.campaign,
  status:        (lead) => lead.status,
  value:         (lead) => lead.value,
  score:         (lead) => lead.qualification_score,
  temperature:   (lead) => lead.lead_temperature,
});

const normalizeKey = (key) => String(key || '').toLowerCase().replace(/[_\-\s]/g, '');

/**
 * extractPlaceholders — ordered, de-duplicated {{n}} tokens from one string.
 *
 * Ordering rules:
 *   • all-numeric ({{1}}, {{2}})  → sorted numerically, so {{10}} follows {{9}}
 *   • named ({{name}}, {{company}}) → order of first appearance in the text
 *
 * De-duplication matters: Meta counts DISTINCT placeholders, so a body that
 * uses {{1}} twice still takes exactly one parameter.
 *
 * @param {string} text
 * @returns {{ names: string[], positional: boolean, mixed: boolean }}
 */
export function extractPlaceholders(text) {
  const re = new RegExp(VARIABLE_PATTERN, 'g');
  const seen = [];
  let match;
  while ((match = re.exec(String(text || ''))) !== null) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }

  const numeric = seen.filter((n) => /^\d+$/.test(n));
  const named   = seen.filter((n) => !/^\d+$/.test(n));

  if (numeric.length && named.length) {
    return { names: seen, positional: false, mixed: true };
  }
  if (numeric.length) {
    return {
      names: [...numeric].sort((a, b) => Number(a) - Number(b)),
      positional: true,
      mixed: false,
    };
  }
  return { names: named, positional: false, mixed: false };
}

/**
 * resolveLeadValue — one placeholder → one string, for one lead.
 *
 * Resolution order:
 *   1. alias table above (handles first_name, company_name, ...)
 *   2. exact field on the lead document
 *   3. custom_fields map, if the lead carries one
 *   4. '' -- NEVER undefined. Meta rejects null/absent parameters, and an
 *      empty string is the documented way to send "nothing here".
 */
export function resolveLeadValue(lead, key, fallbackName) {
  const lookup = (k) => {
    if (!k) return undefined;
    const alias = LEAD_FIELD_ALIASES[normalizeKey(k)];
    if (alias) return alias(lead);
    if (lead && lead[k] !== undefined && lead[k] !== null) return lead[k];
    const custom = lead?.custom_fields;
    if (custom) {
      if (typeof custom.get === 'function' && custom.get(k) != null) return custom.get(k);
      if (custom[k] != null) return custom[k];
    }
    return undefined;
  };

  const value = lookup(key) ?? lookup(fallbackName);
  if (value === undefined || value === null) return '';
  return String(value);
}

/**
 * buildBodyParams — the ordered parameter array to hand to sendTemplate().
 *
 * Length is derived from the body text, so it matches what Meta counts by
 * construction. For positional templates the Nth placeholder resolves via
 * template.variables[N-1] treated as a field name.
 *
 * @param {Object} template — must have .body; .variables optional
 * @param {Object} lead
 * @returns {string[]}
 */
/**
 * buildBodyParams -- resolves each {{n}} or {{name}} placeholder to a
 * real value from the lead, for actual message sending.
 *
 * Returns { name, value }[] rather than a flat value[] -- Meta's SEND
 * payload needs a `parameter_name` field for each parameter when the
 * template was registered with parameter_format: "NAMED" (confirmed
 * against Meta's own docs; a plain positional-shaped send parameter for
 * a named-format template is a real, separate risk of the exact class of
 * bug found at template REGISTRATION time -- see templateApproval.service.js's
 * buildMetaComponents). `name` is null for a positional template, where
 * Meta expects no parameter_name field at all.
 */
/**
 * resolveOverride -- looks up a caller-supplied value for one placeholder.
 *
 * API campaigns carry their variables in the request body rather than on a
 * lead, because the caller's system is the source of truth for things the CRM
 * has never seen (an order id, a delivery slot). Accepts both addressing
 * styles so a customer can use whichever their template uses:
 *
 *   positional: { "1": "Ravi", "2": "ORD123" }
 *   named:      { "customer_name": "Ravi", "order_id": "ORD123" }
 *
 * Returns undefined -- not '' -- when there is no override, so the caller can
 * tell "not supplied" from "deliberately blank" and fall back to the lead.
 */
function resolveOverride(overrides, placeholder, index) {
  if (!overrides || typeof overrides !== 'object') return undefined;

  // Positional first: {{1}} means overrides['1'], and a template whose
  // placeholder literally IS a number must never be matched by name.
  const byPosition = overrides[String(index + 1)];
  if (byPosition !== undefined && byPosition !== null) return String(byPosition);

  if (placeholder) {
    const byName = overrides[placeholder];
    if (byName !== undefined && byName !== null) return String(byName);
  }

  return undefined;
}

export function buildBodyParams(template, lead, overrides = null) {
  const { names, positional } = extractPlaceholders(template?.body);
  const nameMap = Array.isArray(template?.variables) ? template.variables : [];

  return names.map((placeholder, index) => {
    // `overrides` defaults to null, so every existing caller -- dashboard
    // campaigns, broadcasts, nurtures, automation rules -- takes exactly the
    // lead-resolution path it always did. This is purely additive.
    const override = resolveOverride(overrides, positional ? null : placeholder, index);

    if (positional) {
      // {{1}} carries no field name of its own -- variables[0] supplies it.
      return {
        name: null,
        value: override !== undefined ? override : resolveLeadValue(lead, nameMap[index], null),
      };
    }
    return {
      name: placeholder,
      value: override !== undefined ? override : resolveLeadValue(lead, placeholder, nameMap[index]),
    };
  });
}

/**
 * requiredPlaceholders -- the placeholder list a caller must satisfy, in
 * order. Used by the API layer to validate a request BEFORE enqueueing
 * anything: a missing variable is Meta error 132000, which fails identically
 * for every recipient, so catching it once at the edge beats discovering it
 * per message.
 */
export function requiredPlaceholders(template) {
  const { names, positional } = extractPlaceholders(template?.body);
  const nameMap = Array.isArray(template?.variables) ? template.variables : [];

  return names.map((placeholder, index) => ({
    position: index + 1,
    name: positional ? (nameMap[index] || null) : placeholder,
    positional,
  }));
}

/**
 * renderBody — fills the body text for display (inbox preview, delivery log).
 * Uses the SAME resolution as buildBodyParams so the preview cannot drift
 * from what was actually transmitted.
 */
export function renderBody(template, lead, overrides = null) {
  const { names, positional } = extractPlaceholders(template?.body);
  const params = buildBodyParams(template, lead, overrides);

  let text = String(template?.body || '');
  names.forEach((placeholder, index) => {
    const value = params[index]?.value ?? '';
    // Rebuilt per placeholder so {{ name }} with padding also matches.
    const re = new RegExp(`\\{\\{\\s*${placeholder}\\s*\\}\\}`, 'g');
    text = text.replace(re, value);
  });
  void positional;
  return text;
}

/**
 * validateTemplateParams — PRE-FLIGHT check, run once before a campaign
 * loop starts rather than discovering the same fatal misconfiguration on
 * every recipient in turn.
 *
 * Catches, before a single message is attempted:
 *   • mixed {{1}} and {{name}} styles -- Meta accepts one or the other
 *   • positional templates with fewer variable names than placeholders
 *   • header / button placeholders, which MetaProvider cannot send yet
 *
 * @returns {{ ok: boolean, reason?: string, expected: number }}
 */
export function validateTemplateParams(template) {
  const body = extractPlaceholders(template?.body);

  if (body.mixed) {
    return {
      ok: false,
      expected: body.names.length,
      reason:
        'Template body mixes numbered ({{1}}) and named ({{name}}) placeholders. ' +
        'Use one style consistently.',
    };
  }

  if (body.positional) {
    const nameMap = Array.isArray(template?.variables) ? template.variables : [];
    if (nameMap.length < body.names.length) {
      return {
        ok: false,
        expected: body.names.length,
        reason:
          `Template body has ${body.names.length} placeholder(s) but only ` +
          `${nameMap.length} variable name(s) are configured, so ` +
          `{{${body.names[nameMap.length]}}} has no field to fill it from.`,
      };
    }
  }

  // Header/button placeholders would need their own Meta components. Until
  // MetaProvider builds those, flag it here instead of sending a message
  // with a literal {{...}} visible to the contact.
  const headerText = template?.header?.type === 'TEXT' ? template?.header?.text : '';
  const buttonValues = Array.isArray(template?.buttons)
    ? template.buttons.map((b) => b?.value).filter(Boolean)
    : [];
  const outsideBody = extractPlaceholders([headerText, ...buttonValues].join(' ')).names;

  if (outsideBody.length) {
    return {
      ok: false,
      expected: body.names.length,
      reason:
        `Template uses placeholder(s) in its header or buttons (${outsideBody
          .map((n) => `{{${n}}}`)
          .join(', ')}). Dynamic header and button parameters are not supported yet — ` +
        'use static text there, or move the placeholder into the body.',
    };
  }

  return { ok: true, expected: body.names.length };
}