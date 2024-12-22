import Redis from 'ioredis';
import Bull from 'bull';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create Redis client
export const redis = new Redis(REDIS_URL);

// Create Bull queue for balance checks
export const balanceCheckQueue = new Bull('balance-checks', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
  }
});

// Error handling
redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

redis.on('connect', () => {
  console.log('Redis connected successfully');
});

// Optional: graceful shutdown
process.on('SIGTERM', async () => {
  await redis.quit();
  await balanceCheckQueue.close();
});
