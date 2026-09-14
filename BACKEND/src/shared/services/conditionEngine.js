/**
 * =============================================================================
 * InnovateX Revenue OS — Shared Condition Engine
 * =============================================================================
 *
 * FILE: src/shared/services/conditionEngine.js
 *
 * PURPOSE
 * ───────
 * This is the EXACT same real condition-matching engine that already
 * powered Automation Rules' "IF" block (field/operator/value pairs with
 * AND/OR logic) -- extracted here, not duplicated, so Nurture's new
 * trigger-condition builder (see nurtures.constants.js/model.js/
 * service.js) and Automation Rules share one real implementation instead
 * of two independently-drifting copies. automationRules.service.js now
 * imports from here instead of keeping its own local copy -- same
 * exported function names, same behavior for every existing operator,
 * zero change to any already-configured Automation Rule.
 *
 * ONE REAL IMPROVEMENT while extracting: CONTAINS / NOT_CONTAINS now
 * correctly handle an ARRAY field (e.g. Lead.tags, Lead.group_ids) by
 * checking real array membership, instead of stringifying the whole
 * array and doing a substring match against it (which is what the
 * original code did, and would have silently misbehaved the moment
 * anyone tried to match against a tags array -- e.g.
 * `String(['hot','vip'])` becomes the string `"hot,vip"`, so `CONTAINS
 * "vip"` would happen to still work, but `CONTAINS "vi"` would ALSO
 * incorrectly match, and `EQUALS "vip"` would never match at all). Every
 * existing non-array condition's behavior is completely unchanged.
 */

/**
 * Safely read a nested path like "lead.score" or "source" from a
 * context object.
 */
export function getFieldValue(context = {}, fieldPath = '') {
  return fieldPath.split('.').reduce((obj, key) => (obj != null ? obj[key] : undefined), context);
}

/**
 * Evaluate a single condition against the execution context.
 * Returns true if the condition is satisfied.
 */
export function evaluateCondition(condition, context) {
  const actual   = getFieldValue(context, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case 'EQUALS':       return actual == expected;
    case 'NOT_EQUALS':   return actual != expected;
    case 'GREATER_THAN': return Number(actual) > Number(expected);
    case 'LESS_THAN':    return Number(actual) < Number(expected);
    case 'CONTAINS':
      // Real array-membership check (e.g. Lead.tags includes "vip") --
      // see file header for why this replaces the old stringify-the-array
      // behavior. Falls through to the original substring match for a
      // genuine string field (e.g. campaign name containing "diwali") --
      // completely unchanged for any non-array field.
      if (Array.isArray(actual)) return actual.some((v) => String(v).toLowerCase() === String(expected ?? '').toLowerCase());
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'NOT_CONTAINS':
      if (Array.isArray(actual)) return !actual.some((v) => String(v).toLowerCase() === String(expected ?? '').toLowerCase());
      return !String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'EXISTS':       return actual !== undefined && actual !== null;
    case 'NOT_EXISTS':   return actual === undefined || actual === null;
    case 'IN':           return Array.isArray(expected) && expected.includes(actual);
    case 'NOT_IN':       return !Array.isArray(expected) || !expected.includes(actual);
    case 'STARTS_WITH':  return String(actual ?? '').startsWith(String(expected ?? ''));
    case 'ENDS_WITH':    return String(actual ?? '').endsWith(String(expected ?? ''));
    default:             return false;
  }
}

/**
 * Evaluate all conditions using AND or OR logic.
 * Empty conditions array → always passes (matches Automation Rules'
 * original, real "no conditions configured means it applies to
 * everyone" behavior -- Nurture relies on this exact same rule so a
 * sequence with triggerType LEAD_CREATED and no conditions set keeps
 * enrolling every new lead, same as before this feature existed).
 */
export function evaluateConditions(conditions = [], logic = 'AND', context = {}) {
  if (!conditions.length) return { passed: true, reason: 'no conditions — always passes' };

  const results = conditions.map((c) => ({
    field:    c.field,
    operator: c.operator,
    value:    c.value,
    passed:   evaluateCondition(c, context),
  }));

  const passed = logic === 'OR'
    ? results.some((r) => r.passed)
    : results.every((r) => r.passed);

  return { passed, results };
}
