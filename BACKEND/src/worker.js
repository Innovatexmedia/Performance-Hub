import './config/env.js';

import config from './config/config.js';
import connectDB from './config/db.js';
import { useRedisEmitterFallback } from './realtime/socket.js';
import { startCampaignSendWorker } from './queues/campaignSend.worker.js';
import { startLeadImportWorker } from './queues/leadImport.worker.js';
import dns from 'dns';
dns.setServers(['1.1.1.1', '8.8.8.8']);

const start = async () => {
  try {
    await connectDB();
    useRedisEmitterFallback();
    const campaignWorker = startCampaignSendWorker();
    const importWorker = startLeadImportWorker();

    console.log(`\n⚙️  InnovateX Background Workers`);
    console.log(`   Environment          : ${config.NODE_ENV}`);
    console.log(`   Redis                : ${config.REDIS_URL}`);
    console.log(`   Campaign concurrency : ${config.CAMPAIGN_SEND_CONCURRENCY}`);
    console.log(`   Campaign rate limit  : ${config.CAMPAIGN_SEND_RATE_MAX} / ${config.CAMPAIGN_SEND_RATE_DURATION_MS}ms`);
    console.log(`   Lead import concurrency : ${config.LEAD_IMPORT_CONCURRENCY}\n`);

    const shutdown = async (signal) => {
      console.log(`\n${signal} received -- closing workers gracefully (letting in-flight jobs finish)...`);
      await Promise.all([campaignWorker.close(), importWorker.close()]);
      process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    console.error('❌ Worker failed to start:', err);
    process.exit(1);
  }
};

void start();