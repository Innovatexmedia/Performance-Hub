#!/usr/bin/env node
/**
 * =============================================================================
 * InnovateX Revenue OS — Template Header Media Repair Script
 * =============================================================================
 *
 * FILE: scripts/repair-template-header-media.mjs
 * RUN:  node scripts/repair-template-header-media.mjs <templateName> <localImagePath>
 * e.g.: node scripts/repair-template-header-media.mjs purse_sale_1 ./purse-header.jpg
 *
 * WHY THIS EXISTS
 * ────────────────
 * A real bug (now fixed in templates.service.js's syncFromMeta) was
 * silently wiping header.mediaUrl to '' on every "Sync from Meta" run,
 * for ANY template with an IMAGE/VIDEO/DOCUMENT header -- Meta's
 * GET /message_templates response never includes a fetchable media URL,
 * so the sync was overwriting a real, working Cloudinary URL with
 * nothing. The code fix stops this happening going forward, but does
 * NOT restore data already lost before the fix was deployed.
 *
 * A template that's already PROVIDER_APPROVED is correctly locked from
 * normal editing (templates.service.js's EDITABLE_APPROVAL_STATUSES) --
 * that lock exists to keep the template's reviewable content matching
 * what Meta actually approved. This script does not touch that content
 * (name, body, category, buttons, approval status) at all -- it ONLY
 * repairs the internal header.mediaUrl/mediaMimeType/mediaSizeBytes
 * fields our own app needs to send the ALREADY-approved template
 * correctly. That is a data-corruption fix, not a template edit, which
 * is why it's a separate script rather than a route through the normal
 * (correctly locked) update endpoint.
 *
 * WHAT TO PASS: the exact same image already approved on Meta's side
 * for this template's header (open the template in Meta's WhatsApp
 * Manager to re-download it if you no longer have the original file
 * locally -- Meta's own preview there still shows it).
 * =============================================================================
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import dns from 'node:dns/promises';
dns.setServers(['1.1.1.1', '8.8.8.8']);

import connectDB from '../src/config/db.js';
import { WhatsAppTemplate } from '../src/modules/whatsapp/submodules/templates/templates.model.js';
import { uploadBuffer } from '../src/shared/services/cloudinary.service.js';

const [, , templateName, imagePath] = process.argv;

if (!templateName || !imagePath) {
  console.error('Usage: node scripts/repair-template-header-media.mjs <templateName> <localImagePath>');
  process.exit(1);
}

const EXT_TO_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.mp4': 'video/mp4', '.3gp': 'video/3gpp', '.pdf': 'application/pdf',
};

async function run() {
  await connectDB();
  console.log(`\n🔧 Repairing header media for template "${templateName}"\n`);

  const templates = await WhatsAppTemplate.find({ name: templateName });
  if (templates.length === 0) {
    console.error(`❌ No template named "${templateName}" found (checked across all tenants).`);
    await mongoose.connection.close();
    process.exit(1);
  }
  if (templates.length > 1) {
    console.error(`❌ Found ${templates.length} templates named "${templateName}" (different tenants). Re-run this with a more specific lookup -- editing this script's query to also filter by tenantId is the safest fix.`);
    await mongoose.connection.close();
    process.exit(1);
  }
  const template = templates[0];
  console.log(`   Found template ${template._id} (tenant ${template.tenantId}), current header.type = ${template.header?.type}`);

  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = EXT_TO_MIME[ext];
  if (!mimeType) {
    console.error(`❌ Unrecognized file extension "${ext}". Expected one of: ${Object.keys(EXT_TO_MIME).join(', ')}`);
    await mongoose.connection.close();
    process.exit(1);
  }

  const buffer = await fs.readFile(imagePath);
  console.log(`   Uploading ${imagePath} (${buffer.length} bytes, ${mimeType}) to Cloudinary...`);
  const uploaded = await uploadBuffer(buffer, { mimeType, folder: 'whatsapp-templates', filename: path.basename(imagePath) });
  console.log(`   Uploaded: ${uploaded.url}`);

  // ONLY these three fields are touched -- name/body/category/buttons/
  // approvalStatus/status are left completely untouched, so this cannot
  // accidentally drift the template away from what Meta actually approved.
  await WhatsAppTemplate.updateOne(
    { _id: template._id },
    { $set: { 'header.mediaUrl': uploaded.url, 'header.mediaMimeType': mimeType, 'header.mediaSizeBytes': buffer.length } },
  );

  console.log(`\n✅ Repaired. "${templateName}"'s header.mediaUrl now points to the re-uploaded image.`);
  console.log('   Refresh the Templates tab and re-open Preview to confirm the image now shows.');

  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('❌ Repair script crashed:', err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
