
import { v2 as cloudinary } from 'cloudinary';
import config from '../../config/config.js';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
    throw new Error(
      'Cloudinary is not configured -- set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to send or receive media messages.',
    );
  }
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

/** Cloudinary's resource_type must be one of these three -- picked from
 * the actual mime type rather than trusting a client-supplied "kind",
 * since sending the wrong resource_type to Cloudinary causes the upload
 * to fail outright for non-image/video files. */
function resourceTypeFor(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'video'; // Cloudinary stores audio under the 'video' resource type
  return 'raw'; // documents (PDF, docx, etc.)
}

/**
 * Uploads a Buffer (already in memory -- see shared/middlewares/upload.middleware.js
 * for the multer config that produces this) to Cloudinary.
 *
 * @param {Buffer} buffer
 * @param {{ mimeType: string, folder?: string, filename?: string }} opts
 * @returns {Promise<{ url: string, publicId: string, bytes: number, format: string, resourceType: string }>}
 */
/** Maps a mime type to Cloudinary's `format` upload param, forcing the
 * delivery URL to always serve exactly that format regardless of any
 * account-level "auto format" optimization Cloudinary might otherwise
 * apply (e.g. silently serving WebP instead of the JPEG that was
 * actually uploaded, to save bandwidth for regular web use). Matters a
 * lot for WhatsApp template headers specifically -- Meta requires JPEG/
 * PNG exactly and rejects anything else at template-creation time (see
 * templateApproval.service.js), so an unpredictable auto-converted
 * delivery format would cause exactly that kind of silent, hard-to-
 * diagnose rejection even when the user picked a genuinely correct file. */
const MIME_TO_FORMAT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
};

export function uploadBuffer(buffer, { mimeType, folder = 'whatsapp-media', filename } = {}) {
  ensureConfigured();
  const resourceType = resourceTypeFor(mimeType || '');
  const format = MIME_TO_FORMAT[mimeType];

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        // Forces the delivery URL to this exact format -- see
        // MIME_TO_FORMAT's comment above for why this isn't left to
        // Cloudinary's default/automatic behavior.
        ...(format ? { format } : {}),
        // Keeps the original filename recognizable in the Cloudinary
        // dashboard and in the URL, purely for human debugging -- not
        // relied on for anything functional.
        ...(filename ? { public_id: filename.replace(/\.[^/.]+$/, '').slice(0, 100) } : {}),
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          bytes: result.bytes,
          format: result.format,
          resourceType: result.resource_type,
        });
      },
    );
    uploadStream.end(buffer);
  });
}

/**
 * Downloads a file from an already-authenticated URL (used for pulling
 * media off Meta's temporary media URL, which requires the tenant's
 * access token as a Bearer header) and re-uploads it to Cloudinary in
 * one step. See metaWebhook.service.js's inbound media handling.
 */
export async function fetchAndUploadToCloudinary(sourceUrl, { headers = {}, mimeType, filename } = {}) {
  const response = await fetch(sourceUrl, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download media from source (status ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const resolvedMimeType = mimeType || response.headers.get('content-type') || 'application/octet-stream';
  return uploadBuffer(buffer, { mimeType: resolvedMimeType, filename });
}