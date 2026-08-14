/**
 * =============================================================================
 * InnovateX Revenue OS — WhatsApp Template Parameter Resolution
 * =============================================================================
 *
 * FILE: src/modules/whatsapp/templateParams.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * Meta validates the number of `components[body].parameters` we send against
 * the number of {{n}} placeholders in the APPROVED BODY TEXT. Sending the
 * wrong count is a hard rejection: error 132000, every recipient, always.
 *
 * The old send path used `template.variables` directly as the parameter list.
 * That field is populated two different ways depending on how the template
 * reached the DB:
 *
 *   • created locally  → variablesFromTemplateData() collects placeholder
 *                        NAMES from header + body + footer + BUTTONS
 *   • synced from Meta → mapMetaComponents() lifts example VALUES from the
 *                        BODY component only
 *
 * So it was neither reliably the right count (header/button placeholders
 * inflate it) nor the right content (names, or Meta's example text, sent
 * verbatim to real contacts).
 *
 * THE FIX
 * ───────
 * `template.body` is the single source of truth -- it is the exact string
 * Meta approved and the exact string Meta counts placeholders in. We parse
 * the body at send time and resolve one value per placeholder, per lead.
 * That makes the count correct by construction, for both template origins,
 * with no data migration.
 *
 * `template.variables` is retained but demoted to a NAME MAP, used only to
 * give positional {{1}}/{{2}} placeholders something to resolve against.
 *
 * SCOPE
 * ─────
 * BODY parameters only -- matching MetaProvider.sendTemplate()'s own scope.
 * Header and button dynamic parameters need separate `header`/`button`
 * components that the provider does not build yet; see extractPlaceholders
 * usage in validateTemplateParams() for how those are surfaced as a config
 * error rather than silently mis-sent.
 * =============================================================================
 */

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
export function buildBodyParams(template, lead) {
  const { names, positional } = extractPlaceholders(template?.body);
  const nameMap = Array.isArray(template?.variables) ? template.variables : [];

  return names.map((placeholder, index) => {
    if (positional) {
      // {{1}} carries no field name of its own -- variables[0] supplies it.
      return resolveLeadValue(lead, nameMap[index], null);
    }
    return resolveLeadValue(lead, placeholder, nameMap[index]);
  });
}

/**
 * renderBody — fills the body text for display (inbox preview, delivery log).
 * Uses the SAME resolution as buildBodyParams so the preview cannot drift
 * from what was actually transmitted.
 */
export function renderBody(template, lead) {
  const { names, positional } = extractPlaceholders(template?.body);
  const params = buildBodyParams(template, lead);

  let text = String(template?.body || '');
  names.forEach((placeholder, index) => {
    const value = params[index] ?? '';
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