/**
 * Tenant Business Profile — service.
 *
 * Small, focused module: lets a tenant describe their own business
 * (name/description/type/industry) via a real self-service endpoint.
 * These fields already existed on the Tenant model (description,
 * businessType, industry) but had no self-service way for a tenant to
 * edit them themselves -- only a platform Super Admin could.
 *
 * The immediate real consumer: aiReplyAssistant.service.js reads this
 * so generated WhatsApp replies reference the TENANT's actual business
 * ("EY Crops", "we sell fresh produce...") instead of a hardcoded
 * "InnovateX Revenue OS" (the platform's own name, not the customer's).
 */
import Tenant from '../auth/models/Tenant.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';
import { BUSINESS_TYPE_VALUES } from './tenantProfile.constants.js';

function toProfileDTO(tenant) {
  return {
    name: tenant.name,
    description: tenant.description || '',
    businessType: tenant.businessType,
    industry: tenant.industry || '',
  };
}

export const tenantProfileService = {
  async getProfile(ctx) {
    const tenant = await Tenant.findById(ctx.tenantId);
    if (!tenant) throw AppError.notFound('Tenant not found');
    return toProfileDTO(tenant);
  },

  async updateProfile(ctx, patch) {
    const tenant = await Tenant.findById(ctx.tenantId);
    if (!tenant) throw AppError.notFound('Tenant not found');

    if (patch.description !== undefined) {
      if (typeof patch.description !== 'string' || patch.description.length > 500) {
        throw AppError.badRequest('description must be a string up to 500 characters');
      }
      tenant.description = patch.description;
    }
    if (patch.businessType !== undefined) {
      if (!BUSINESS_TYPE_VALUES.includes(patch.businessType)) {
        throw AppError.badRequest(`businessType must be one of: ${BUSINESS_TYPE_VALUES.join(', ')}`);
      }
      tenant.businessType = patch.businessType;
    }
    if (patch.industry !== undefined) {
      if (typeof patch.industry !== 'string' || patch.industry.length > 100) {
        throw AppError.badRequest('industry must be a string up to 100 characters');
      }
      tenant.industry = patch.industry;
    }

    tenant.updatedBy = ctx.userId;
    await tenant.save();
    return toProfileDTO(tenant);
  },

  /**
   * Internal helper (not exposed over HTTP) -- used by anything that wants
   * to feed real business context into an AI prompt. Never throws; returns
   * a safe empty-ish shape if the tenant lookup fails, so an AI generation
   * request never breaks just because this lookup had a hiccup.
   */
  async getContextForAI(tenantId) {
    try {
      const tenant = await Tenant.findById(tenantId).select('name description businessType industry');
      if (!tenant) return null;
      return toProfileDTO(tenant);
    } catch {
      return null;
    }
  },
};