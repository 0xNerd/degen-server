import Bull from 'bull';
import { redis } from './index';

class BalanceCheckQueueManager {
  private static instance: Bull.Queue;

  private constructor() {}

  public static getInstance(): Bull.Queue {
    if (!BalanceCheckQueueManager.instance) {
      BalanceCheckQueueManager.instance = new Bull('balance-checks', process.env.REDIS_URL, {
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: true,
        }
      });
    }
    return BalanceCheckQueueManager.instance;
  }
}

export const balanceCheckQueue = BalanceCheckQueueManager.getInstance();

// Optional: graceful shutdown
process.on('SIGTERM', async () => {
  await redis.quit();
  await balanceCheckQueue.close();
});
