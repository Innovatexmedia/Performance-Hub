/**
 * Maps Mongoose lead documents to plain API DTOs.
 * Keeps `_id` → `id` consistent and isolates the wire shape from the schema.
 */

function plain(doc) {
  if (!doc) return null;
  return typeof doc.toObject === 'function' ? doc.toObject() : doc;
}

export function toLeadDTO(doc) {
  const l = plain(doc);
  if (!l) return null;
  const { _id, ...rest } = l;
  return { id: String(_id ?? l.id), ...rest };
}

export function toLeadListDTO(doc) {
  const l = plain(doc);
  if (!l) return null;
  return {
    id: String(l._id ?? l.id),
    name: l.name,
    email: l.email,
    phone: l.phone,
    whatsapp_number: l.whatsapp_number,
    company: l.company,
    status: l.status,
    lead_temperature: l.lead_temperature,
    qualification_score: l.qualification_score,
    source: l.source,
    assigned_user_id: l.assigned_user_id,
    value: l.value,
    consent_status: l.consent_status,
    opt_out_status: l.opt_out_status,
    created_at: l.created_at,
    last_contacted_at: l.last_contacted_at,
  };
}

export function toLeadListDTOs(docs = []) {
  return docs.map(toLeadListDTO);
}