/**
 * WhatsApp Settings — repository.
 *
 * The only layer that touches the WhatsAppSettings collection.
 * Every query is tenant-scoped. No business logic, no formatting,
 * no credential stripping (that happens in the service).
 */
import { WhatsAppSettings } from './whatsappSettings.model.js';

export const whatsappSettingsRepository = {
  create(data) {
    return WhatsAppSettings.create(data);
  },

  /**
   * upsertDefault -- atomic find-or-create for the auto-provision path.
   * $setOnInsert means an existing document is returned completely
   * untouched (no field gets overwritten back to a default); a genuinely
   * missing one is created exactly once even under concurrent callers,
   * since findOneAndUpdate's upsert is atomic at the database level.
   */
  upsertDefault(tenantId, defaults) {
    return WhatsAppSettings.findOneAndUpdate(
      { tenantId },
      { $setOnInsert: { ...defaults, tenantId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  },

  findByTenant(tenantId) {
    return WhatsAppSettings.findOne({ tenantId });
  },

  /**
   * Apply a partial update using dot-notation $set so nested sub-objects
   * are merged field-by-field instead of being replaced wholesale.
   */
  update(tenantId, setOps) {
    return WhatsAppSettings.findOneAndUpdate(
      { tenantId },
      { $set: setOps },
      { new: true, runValidators: true },
    );
  },

  /**
   * Upsert — create if missing, otherwise update. Used by create-settings
   * to guarantee a single document per tenant even under race conditions.
   */
  upsert(tenantId, setOnInsert, setOps = {}) {
    return WhatsAppSettings.findOneAndUpdate(
      { tenantId },
      { $setOnInsert: setOnInsert, $set: setOps },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  },

  deleteByTenant(tenantId) {
    return WhatsAppSettings.findOneAndDelete({ tenantId });
  },

  /**
   * findByPhoneNumberId -- the ONE deliberately cross-tenant query in this
   * repository. Every other method is tenant-scoped by design; this one
   * exists specifically to check whether phoneNumberId is already claimed
   * by a DIFFERENT tenant, for duplicate-connection prevention.
   * excludeTenantId lets a tenant re-save their own already-connected
   * number without it flagging itself as a duplicate.
   */
  findByPhoneNumberId(phoneNumberId, excludeTenantId) {
    return WhatsAppSettings.findOne({
      'meta.phoneNumberId': phoneNumberId,
      tenantId: { $ne: excludeTenantId },
    });
  },
};