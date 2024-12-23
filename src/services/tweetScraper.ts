import { Scraper, Tweet } from 'agent-twitter-client';
import { redis } from '../redis';

export class TweetScraper {
  private scraper: Scraper;
  private readonly CACHE_EXPIRY = 600; // 10 minutes in seconds
  private static instance: TweetScraper;
  
  private constructor() {
    this.scraper = new Scraper();
  }

  public static getInstance(): TweetScraper {
    if (!TweetScraper.instance) {
      TweetScraper.instance = new TweetScraper();
    }
    return TweetScraper.instance;
  }

  async initialize(): Promise<void> {
    const {
      TWITTER_USERNAME,
      TWITTER_PASSWORD,
      TWITTER_EMAIL,
      TWITTER_APP_KEY,
      TWITTER_APP_SECRET,
      TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_SECRET,
    } = process.env;

    if (!TWITTER_USERNAME || !TWITTER_PASSWORD) {
      throw new Error('Twitter credentials not found in environment variables');
    }

    if (TWITTER_EMAIL && TWITTER_APP_KEY && TWITTER_APP_SECRET && 
        TWITTER_ACCESS_TOKEN && TWITTER_ACCESS_SECRET) {
      await this.scraper.login(
        TWITTER_USERNAME,
        TWITTER_PASSWORD,
        TWITTER_EMAIL,
        TWITTER_APP_KEY,
        TWITTER_APP_SECRET,
        TWITTER_ACCESS_TOKEN,
        TWITTER_ACCESS_SECRET,
      );
    } else {
      await this.scraper.login(TWITTER_USERNAME, TWITTER_PASSWORD);
    }
  }

  async getTweets(username: string, count: number): Promise<Tweet[]> {
    const cacheKey = `tweets:${username}:${count}`;
    
    // Try to get from cache first
    const cachedTweets = await redis.get(cacheKey);
    if (cachedTweets) {
      return JSON.parse(cachedTweets);
    }

    // If not in cache, fetch from Twitter
    const tweets = [];
    for await (const tweet of this.scraper.getTweets(username, count)) {
      tweets.push(tweet);
    }

    // Cache the results
    await redis.setex(cacheKey, this.CACHE_EXPIRY, JSON.stringify(tweets));
    return tweets;
  }

  async getTweetsAndReplies(username: string): Promise<Tweet[]> {
    const cacheKey = `tweets_replies:${username}`;
    
    // Try to get from cache first
    const cachedTweets = await redis.get(cacheKey);
    if (cachedTweets) {
      return JSON.parse(cachedTweets);
    }

    // If not in cache, fetch from Twitter
    const tweets = [];
    for await (const tweet of this.scraper.getTweetsAndReplies(username)) {
      tweets.push(tweet);
    }

    // Cache the results
    await redis.setex(cacheKey, this.CACHE_EXPIRY, JSON.stringify(tweets));
    return tweets;
  }

  async searchTweets(query: string, count: number = 100): Promise<Tweet[]> {
    const cacheKey = `search:${query}:${count}`;
    
    const cachedTweets = await redis.get(cacheKey);
    if (cachedTweets) {
      return JSON.parse(cachedTweets);
    }

    const tweets = [];
    for await (const tweet of this.scraper.searchTweets(query, count)) {
      tweets.push(tweet);
    }

    await redis.setex(cacheKey, this.CACHE_EXPIRY, JSON.stringify(tweets));
    return tweets;
  }

  async getTrends(): Promise<string[]> {
    const cacheKey = 'trends';
    
    const cachedTrends = await redis.get(cacheKey);
    if (cachedTrends) {
      return JSON.parse(cachedTrends);
    }

    const trends = await this.scraper.getTrends();
    await redis.setex(cacheKey, this.CACHE_EXPIRY, JSON.stringify(trends));
    return trends;
  }
}