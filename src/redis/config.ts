import Redis from 'ioredis';

export class RedisClient {
  private static instance: Redis;

  private constructor() {}

  public static getInstance(): Redis {
    if (!RedisClient.instance) {
      RedisClient.instance = new Redis(process.env.REDIS_URL);
      
      RedisClient.instance.on('error', (error) => {
        console.error('Redis connection error:', error);
      });
      
      RedisClient.instance.on('connect', () => {
        console.log('Redis connected successfully');
      });
    }
    return RedisClient.instance;
  }
}

export const redis = RedisClient.getInstance();