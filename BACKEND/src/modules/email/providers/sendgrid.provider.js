/**
 * =============================================================================
 * InnovateX Revenue OS — SendGrid Provider
 * =============================================================================
 *
 * FILE: src/modules/email/providers/sendgrid.provider.js
 *
 * PURPOSE
 * ───────
 * The one real, low-level SendGrid HTTP client for this app. Both the
 * platform-level transactional sender (auth/services/email.service.js,
 * unchanged) and the new tenant-scoped nurture email path go through this
 * -- neither duplicates SendGrid API-call logic on its own.
 *
 * SOURCE: real SendGrid v3 API docs (docs.sendgrid.com/api-reference).
 *   - POST https://api.sendgrid.com/v3/mail/send
 *   - Authorization: Bearer <key>, `from` is {email, name}, not a string
 *   - A genuine success returns 202 with an empty body -- checked
 *     explicitly, never assumed from a 200
 *   - Dynamic templates: template_id + personalizations[].dynamic_template_data
 *   - GET https://api.sendgrid.com/v3/user/account -- used by
 *     verifyApiKey() to test a key/sender without actually sending mail
 *
 * RELIABILITY
 * ───────────
 * - Real timeout via AbortController (SENDGRID_TIMEOUT_MS)
 * - Real bounded exponential backoff retry, only for genuinely retryable
 *   failures (network error, 429, 5xx) -- never retries a 4xx validation/
 *   auth failure, since retrying a permanently-invalid request just wastes
 *   time and could duplicate side effects for no benefit
 * - No silent failures: every failure path throws a real, specific Error
 *   with SendGrid's own error detail when available
 * =============================================================================
 */

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';
const SENDGRID_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (status, networkError) => {
  if (networkError) return true;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
};

/**
 * postToSendGrid -- one real HTTP attempt, with a real timeout. Does NOT
 * retry on its own -- sendMail() below owns the retry loop so it can
 * distinguish retryable vs. permanent failures cleanly in one place.
 */
const postToSendGrid = async (apiKey, payload) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SENDGRID_TIMEOUT_MS);
  try {
    const response = await fetch(SENDGRID_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { response, networkError: null };
  } catch (err) {
    const networkError = err.name === 'AbortError'
      ? new Error(`SendGrid request timed out after ${SENDGRID_TIMEOUT_MS}ms`)
      : new Error(`Could not reach SendGrid's API — ${err.message}`);
    return { response: null, networkError };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * sendMail -- real SendGrid send, with real bounded exponential backoff.
 * Never throws for a permanent (4xx, non-429) failure without first
 * surfacing SendGrid's own real error detail -- never a silent failure.
 *
 * @param {object} opts
 * @param {string} opts.apiKey -- real, plain (already-decrypted) SendGrid API key
 * @param {{email: string, name?: string}} opts.from
 * @param {string} opts.to
 * @param {string} [opts.subject] -- required unless templateId is set (SendGrid dynamic templates carry their own subject)
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 * @param {string} [opts.replyTo]
 * @param {string} [opts.templateId] -- SendGrid dynamic template ID (d-xxxxxxxx)
 * @param {Record<string,string>} [opts.dynamicTemplateData] -- variables for the dynamic template
 * @param {string} [opts.customArgs] -- object of string values echoed back on webhook events, used here to carry our own correlation ids (tenantId, nurture enrollment/step) without SendGrid needing to know anything about our schema
 * @returns {Promise<{ sgMessageId: string|null }>}
 */
export const sendMail = async ({
  apiKey, from, to, subject, html, text, replyTo, templateId, dynamicTemplateData, customArgs,
}) => {
  if (!apiKey) throw new Error('No SendGrid API key provided');
  if (!to) throw new Error('No recipient address provided');
  if (!templateId && !html && !text) throw new Error('An email needs html, text, or a templateId');

  const personalization = { to: [{ email: to }] };
  if (dynamicTemplateData) personalization.dynamic_template_data = dynamicTemplateData;

  const payload = {
    personalizations: [personalization],
    from,
    ...(replyTo ? { reply_to: { email: replyTo } } : {}),
    ...(templateId ? { template_id: templateId } : {}),
    ...(subject ? { subject } : {}),
    ...(customArgs ? { custom_args: customArgs } : {}),
  };
  if (!templateId) {
    payload.content = [
      ...(text ? [{ type: 'text/plain', value: text }] : []),
      ...(html ? [{ type: 'text/html', value: html }] : []),
    ];
  }

  let lastErrorMessage = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const { response, networkError } = await postToSendGrid(apiKey, payload);

    if (!networkError && response.status === 202) {
      // Real success. SendGrid returns the message id in the
      // X-Message-Id response header, not the (empty) body.
      const sgMessageId = response.headers.get('x-message-id') || null;
      return { sgMessageId };
    }

    const status = response?.status ?? null;
    let sgErrorMessage = networkError?.message || `HTTP ${status}`;
    if (response) {
      const errJson = await response.json().catch(() => ({}));
      sgErrorMessage = errJson?.errors?.map((e) => e.message).join('; ') || sgErrorMessage;
    }
    lastErrorMessage = sgErrorMessage;

    if (!isRetryable(status, networkError) || attempt === MAX_RETRIES) {
      if (status === 403) {
        throw new Error(`SendGrid rejected this email (403) — ${sgErrorMessage}. This usually means the from/sender address is not verified in this SendGrid account.`);
      }
      throw new Error(`SendGrid send failed${status ? ` (HTTP ${status})` : ''} — ${sgErrorMessage}`);
    }

    // Real bounded exponential backoff -- 500ms, 1000ms, 2000ms (capped by
    // MAX_RETRIES), only ever reached for a genuinely retryable failure
    // (network error, 429 rate limit, 5xx). A permanent 4xx never reaches
    // here at all (returned/thrown above on the very first attempt).
    await sleep(BASE_BACKOFF_MS * 2 ** attempt);
  }

  // Unreachable in practice (the loop always returns or throws above),
  // but keeps this function's real contract honest rather than silently
  // resolving with nothing if the loop logic ever changes.
  throw new Error(`SendGrid send failed after ${MAX_RETRIES + 1} attempts — ${lastErrorMessage}`);
};

/**
 * verifyApiKey -- real, side-effect-free check that a key is genuinely
 * valid and can authenticate against SendGrid, without sending any mail.
 * Used by sendgridSettings.service.js's testConnection() before ever
 * marking a tenant's integration as connected.
 */
export const verifyApiKey = async (apiKey) => {
  if (!apiKey) throw new Error('No SendGrid API key provided');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SENDGRID_TIMEOUT_MS);
  let response;
  try {
    response = await fetch('https://api.sendgrid.com/v3/user/account', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError'
      ? `SendGrid verification timed out after ${SENDGRID_TIMEOUT_MS}ms`
      : `Could not reach SendGrid's API — ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    throw new Error('SendGrid rejected this API key — it is invalid or has been revoked.');
  }
  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    throw new Error(`SendGrid key verification failed — ${errJson?.errors?.[0]?.message || `HTTP ${response.status}`}`);
  }
  const data = await response.json().catch(() => ({}));
  return { type: data.type || null };
};
