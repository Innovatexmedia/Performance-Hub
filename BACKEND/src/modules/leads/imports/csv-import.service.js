
const HEADER_MAP = {
  name: 'name', 'full name': 'name', 'lead name': 'name', 'contact name': 'name', 'customer name': 'name',
  email: 'email', 'email address': 'email', 'e-mail': 'email',
  phone: 'phone', 'phone number': 'phone', mobile: 'phone', 'mobile number': 'phone', 'contact number': 'phone', 'contact no': 'phone', 'phone no': 'phone',
  whatsapp: 'whatsapp_number', 'whatsapp number': 'whatsapp_number', 'whatsapp no': 'whatsapp_number',
  company: 'company', 'company name': 'company', organization: 'company', organisation: 'company', business: 'company',
  source: 'source', 'lead source': 'source',
  medium: 'medium',
  campaign: 'campaign', 'campaign name': 'campaign',
  status: 'status', 'lead status': 'status',
  temperature: 'lead_temperature', 'lead temperature': 'lead_temperature', temp: 'lead_temperature',
  segment: 'segment',
  value: 'value', 'deal value': 'value', 'lead value': 'value', amount: 'value',
};

/** Strips a leading UTF-8 BOM (\uFEFF) if present -- see file doc comment. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/**
 * Cleans a "value"/"amount" cell before Number() parsing -- a person
 * exporting from Excel very commonly has currency-formatted numbers
 * ("₹5,000", "$1,200.50", "5,000") in that column; Number("₹5,000") is
 * NaN, silently becoming 0 rather than the real value.
 */
function parseValueField(raw) {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Parse raw CSV text into an array of cell-arrays. */
export function parseCsv(text = '') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = stripBom(text);

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // ignore; handled by \n
    } else {
      field += ch;
    }
  }
  // last field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drops fully-blank rows -- a trailing blank line at the end of an
  // Excel export (extremely common) must never count as a "failed" row
  // in the import summary.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Normalizes one raw header cell to a HEADER_MAP lookup key: trims
 * whitespace, lowercases, and collapses repeated internal whitespace --
 * so "  Phone   Number " matches "phone number" the same as an exact
 * single-spaced match would.
 */
function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Convert CSV text → array of lead objects keyed by mapped header. */
export function csvToLeadRows(text = '') {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const headers = rows[0].map(normalizeHeader);
  const mapped = headers.map((h) => HEADER_MAP[h] || null);

  return rows.slice(1).map((cells) => {
    const obj = {};
    mapped.forEach((field, idx) => {
      if (!field) return;
      const val = (cells[idx] ?? '').trim();
      if (val === '') return; // a blank cell means "not provided", not an explicit empty value -- see import.service.js's stripBlankFields for why this matters
      obj[field] = field === 'value' ? parseValueField(val) : val;
    });
    return obj;
  });
}