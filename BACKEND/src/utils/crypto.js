/**
 * =============================================================================
 * InnovateX Revenue OS — Crypto Utilities
 * =============================================================================
 *
 * FILE: src/utils/crypto.js
 *
 * PURPOSE
 * ───────
 * AES-256-GCM symmetric encryption for storing sensitive credentials at rest.
 * Used to encrypt: WhatsApp API keys, access tokens, AI API keys, Cashfree keys
 * before saving them to MongoDB.
 *
 * HOW IT FITS
 * ───────────
 * crypto.js → Tenant.js (encrypt whatsAppSettings.accessToken, aiConfig.aiApiKey)
 *           → Integration model (encrypt per-integration credentials)
 *           → token.service.js (hash tokens for storage)
 *
 * ALGORITHM: AES-256-GCM
 * ─────────────────────
 * - 256-bit key (32 bytes)
 * - 96-bit IV (12 bytes) — randomly generated per encryption
 * - 128-bit authentication tag — prevents tampering (AEAD)
 * - IV and authTag are stored alongside the ciphertext in the DB
 *
 * STORAGE FORMAT (stored in MongoDB as a single string)
 * ──────────────────────────────────────────────────────
 * "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 *
 * ENVIRONMENT VARIABLES REQUIRED
 * ───────────────────────────────
 * ENCRYPTION_KEY — 64 hex chars (32 bytes) — generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * ⚠️ SECURITY RULES
 * ──────────────────
 * - Never log encrypted values or the ENCRYPTION_KEY
 * - Never return encrypted values in API responses
 * - Rotate ENCRYPTION_KEY only with a full re-encryption of all stored values
 * - Never hardcode ENCRYPTION_KEY in source code
 *
 * PACKAGES REQUIRED
 * ─────────────────
 * Node.js built-in: crypto (no install needed)
 * =============================================================================
 */

import crypto from 'crypto';

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 12;  // 96-bit IV for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

/**
 * getEncryptionKey — derives a 32-byte Buffer from ENCRYPTION_KEY env var.
 * Throws clearly if the key is missing or malformed.
 * @returns {Buffer}
 */
const getEncryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }
  return Buffer.from(key, 'hex');
};

/**
 * encrypt — encrypts a plain-text string using AES-256-GCM.
 * Returns a colon-delimited string: "<iv>:<authTag>:<ciphertext>" (all hex).
 * @param {string} plaintext
 * @returns {string} encrypted string for storage
 */
export const encrypt = (plaintext) => {
  if (!plaintext) return null;

  const key    = getEncryptionKey();
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * decrypt — decrypts a string previously encrypted with encrypt().
 * @param {string} encryptedString — "<iv>:<authTag>:<ciphertext>"
 * @returns {string} original plain-text value
 * @throws {Error} if decryption fails (wrong key, tampered data)
 */
export const decrypt = (encryptedString) => {
  if (!encryptedString) return null;

  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted string format. Expected "<iv>:<authTag>:<ciphertext>"');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;

  const key       = getEncryptionKey();
  const iv        = Buffer.from(ivHex, 'hex');
  const authTag   = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Decryption failed — data may be tampered or the encryption key is incorrect');
  }
};

/**
 * hashToken — creates a SHA-256 hash of a token for safe DB storage.
 * Used for: refresh tokens, password reset tokens, email verification tokens.
 * The plain token is sent to the user; only the hash is stored in MongoDB.
 * @param {string} token
 * @returns {string} hex hash
 */
export const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

/**
 * generateSecureToken — generates a cryptographically secure random hex token.
 * @param {number} bytes — token size in bytes (default 32 = 256-bit)
 * @returns {string} hex token
 */
export const generateSecureToken = (bytes = 32) =>
  crypto.randomBytes(bytes).toString('hex');

/**
 * generateOTP — generates a numeric OTP of specified length.
 * @param {number} digits — OTP length (default 6)
 * @returns {string}
 */
export const generateOTP = (digits = 6) => {
  const max = Math.pow(10, digits);
  const otp = crypto.randomInt(0, max);
  return String(otp).padStart(digits, '0');
};