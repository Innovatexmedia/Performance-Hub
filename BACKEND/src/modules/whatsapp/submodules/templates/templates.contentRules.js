
import { extractPlaceholders } from '../../templateParams.js';
import {
  HEADER_TYPE,
  BUTTON_TYPE_VALUES,
  BUTTON_TYPES_REQUIRING_VALUE,
  HEADER_TYPE_VALUES,
  MAX_BUTTONS,
  MAX_BODY_LENGTH,
  MAX_FOOTER_LENGTH,
  MAX_HEADER_TEXT_LENGTH,
  MAX_BUTTON_TEXT_LENGTH,
  MAX_NAME_LENGTH,
  TEMPLATE_NAME_PATTERN,
  HEADER_MEDIA_MIME_TYPES,
  URL_BUTTON_PATTERN,
  PHONE_BUTTON_PATTERN,
} from './templates.constants.js';

export function validateContent(data = {}) {
  const errors = [];

  // Name format -- Meta requires lowercase letters/digits/underscores
  // only. Catching this HERE (before save, before it ever reaches Meta)
  // is the real fix -- previously a bad name only surfaced as a cryptic
  // Meta rejection at submit-to-provider time, after internal approval
  // had already happened, wasting a whole review cycle.
  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) {
      errors.push({ field: 'name', message: 'Template name is required' });
    } else if (name.length > MAX_NAME_LENGTH) {
      errors.push({ field: 'name', message: `Template name exceeds ${MAX_NAME_LENGTH} characters` });
    } else if (!TEMPLATE_NAME_PATTERN.test(name)) {
      errors.push({ field: 'name', message: 'Template name may only contain lowercase letters, numbers, and underscores (no spaces, capitals, or hyphens) -- Meta will reject anything else' });
    }
  }

  if (data.body !== undefined) {
    const body = String(data.body);
    if (!body.trim()) {
      errors.push({ field: 'body', message: 'Body message is required' });
    } else if (body.length > MAX_BODY_LENGTH) {
      errors.push({ field: 'body', message: `Body exceeds ${MAX_BODY_LENGTH} characters (currently ${body.length})` });
    }

    // Positional {{n}} placeholders must be sequential starting at {{1}}
    // with no gaps (Meta rejects {{1}} + {{3}} with no {{2}}) -- and if
    // positional, a field mapping is REQUIRED (see resolveVariables() in
    // templates.service.js): {{1}}-style templates have no way to
    // self-describe what they mean, unlike {{customer_name}}.
    const { names, positional } = extractPlaceholders(body);
    if (positional && names.length > 0) {
      const expected = names.map((_, i) => String(i + 1));
      const isSequential = JSON.stringify(names) === JSON.stringify(expected);
      if (!isSequential) {
        errors.push({ field: 'body', message: `Positional placeholders must be sequential starting at {{1}} with no gaps -- found {{${names.join('}}, {{')}}}, expected {{${expected.join('}}, {{')}}}` });
      }
      const nameMap = Array.isArray(data.variables) ? data.variables.filter(Boolean) : [];
      if (nameMap.length < names.length) {
        errors.push({ field: 'variables', message: `${names.length} placeholder(s) need a field mapping, but only ${nameMap.length} ${nameMap.length === 1 ? 'is' : 'are'} set -- map every {{n}} to a lead field before saving` });
      }
    }
  }

  if (data.footer && String(data.footer).length > MAX_FOOTER_LENGTH) {
    errors.push({ field: 'footer', message: `Footer exceeds ${MAX_FOOTER_LENGTH} characters (currently ${String(data.footer).length})` });
  }

  if (data.header) {
    const { type, text, mediaUrl, mediaMimeType } = data.header;
    if (type !== undefined && !HEADER_TYPE_VALUES.includes(type)) {
      errors.push({ field: 'header.type', message: 'Invalid header type' });
    }
    if (type === HEADER_TYPE.TEXT) {
      if (!text) errors.push({ field: 'header.text', message: 'Header text is required for a TEXT header' });
      else if (String(text).length > MAX_HEADER_TEXT_LENGTH) {
        errors.push({ field: 'header.text', message: `Header text exceeds ${MAX_HEADER_TEXT_LENGTH} characters (currently ${String(text).length})` });
      }
    }
    if ([HEADER_TYPE.IMAGE, HEADER_TYPE.VIDEO, HEADER_TYPE.DOCUMENT].includes(type)) {
      if (!mediaUrl) {
        errors.push({ field: 'header.mediaUrl', message: `A ${type.toLowerCase()} file is required for a ${type} header` });
      } else {
        // Real Meta template-header format restriction, confirmed live:
        // a wider format got accepted by our own upload but rejected by
        // Meta's template-creation call with "The type of file is not
        // supported" -- checking it HERE, at save time, catches a wrong
        // format immediately instead of only at submit-to-provider,
        // potentially after internal approval.
        const allowed = HEADER_MEDIA_MIME_TYPES[type] || [];
        if (mediaMimeType && allowed.length && !allowed.includes(mediaMimeType)) {
          errors.push({ field: 'header.mediaUrl', message: `Meta only accepts ${allowed.map((m) => m.split('/')[1].toUpperCase()).join(' or ')} for a ${type} header -- this file is ${mediaMimeType}` });
        }
      }
    }
  }

  if (data.buttons !== undefined) {
    if (!Array.isArray(data.buttons)) {
      errors.push({ field: 'buttons', message: 'buttons must be an array' });
    } else {
      if (data.buttons.length > MAX_BUTTONS) {
        errors.push({ field: 'buttons', message: `A template may have at most ${MAX_BUTTONS} buttons (currently ${data.buttons.length})` });
      }
      const seenText = new Map();
      data.buttons.forEach((btn, i) => {
        if (!btn || !BUTTON_TYPE_VALUES.includes(btn.type)) {
          errors.push({ field: `buttons[${i}].type`, message: 'Invalid button type' });
        }
        if (!btn || !btn.text || !String(btn.text).trim()) {
          errors.push({ field: `buttons[${i}].text`, message: 'Button text is required' });
        } else {
          const text = String(btn.text).trim();
          if (text.length > MAX_BUTTON_TEXT_LENGTH) {
            errors.push({ field: `buttons[${i}].text`, message: `Button text exceeds ${MAX_BUTTON_TEXT_LENGTH} characters (currently ${text.length})` });
          }
          const dupeIndex = seenText.get(text.toLowerCase());
          if (dupeIndex !== undefined) {
            errors.push({ field: `buttons[${i}].text`, message: `Duplicate button text "${text}" (also used by button ${dupeIndex + 1}) -- Meta requires unique button labels` });
          } else {
            seenText.set(text.toLowerCase(), i);
          }
        }
        if (btn && BUTTON_TYPES_REQUIRING_VALUE.includes(btn.type)) {
          if (!btn.value || !String(btn.value).trim()) {
            errors.push({ field: `buttons[${i}].value`, message: `value is required for ${btn.type} button` });
          } else if (btn.type === 'URL' && !URL_BUTTON_PATTERN.test(String(btn.value).trim())) {
            errors.push({ field: `buttons[${i}].value`, message: 'URL must start with http:// or https://' });
          } else if (btn.type === 'PHONE_NUMBER' && !PHONE_BUTTON_PATTERN.test(String(btn.value).trim())) {
            errors.push({ field: `buttons[${i}].value`, message: 'Phone number must be 7-15 digits, optionally starting with +' });
          }
        }
      });
    }
  }

  return errors;
}