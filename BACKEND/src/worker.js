import './config/env.js';

import config from './config/config.js';
import connectDB from './config/db.js';
import { useRedisEmitterFallback } from './realtime/socket.js';
import { startCampaignSendWorker } from './queues/campaignSend.worker.js';
import dns from 'dns';
dns.setServers(['1.1.1.1', '8.8.8.8']);

const start = async () => {
  try {
    await connectDB();
    useRedisEmitterFallback();
    const worker = startCampaignSendWorker();

    console.log(`\n⚙️  InnovateX Campaign Send Worker`);
    console.log(`   Environment : ${config.NODE_ENV}`);
    console.log(`   Redis       : ${config.REDIS_URL}`);
    console.log(`   Concurrency : ${config.CAMPAIGN_SEND_CONCURRENCY}`);
    console.log(`   Rate limit  : ${config.CAMPAIGN_SEND_RATE_MAX} / ${config.CAMPAIGN_SEND_RATE_DURATION_MS}ms\n`);

    const shutdown = async (signal) => {
      console.log(`\n${signal} received -- closing worker gracefully (letting in-flight jobs finish)...`);
      await worker.close();
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