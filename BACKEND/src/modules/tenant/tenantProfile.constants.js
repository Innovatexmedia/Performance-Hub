/** Mirrors the businessType enum on the Tenant model exactly -- see models/Tenant.js. */
export const BUSINESS_TYPE = Object.freeze({
  AGENCY:      'agency',
  EDTECH:      'edtech',
  COACHING:    'coaching',
  HEALTHCARE:  'healthcare',
  ECOMMERCE:   'ecommerce',
  REAL_ESTATE: 'real_estate',
  FITNESS:     'fitness',
  FINANCE:     'finance',
  SAAS:        'saas',
  OTHER:       'other',
});
export const BUSINESS_TYPE_VALUES = Object.freeze(Object.values(BUSINESS_TYPE));