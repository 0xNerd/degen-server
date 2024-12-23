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
      TWITTER_COOKIES,
    } = process.env;

    if (TWITTER_COOKIES) {
      await this.scraper.setCookies(JSON.parse(TWITTER_COOKIES));
    } else if (TWITTER_USERNAME && TWITTER_PASSWORD) {
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
    } else {
      throw new Error('No valid Twitter authentication method found in environment variables');
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

  async getFollowerCount(userId: string): Promise<number> {
    const cacheKey = `follower_count:${userId}`;
    
    // Try to get from cache first
    const cachedCount = await redis.get(cacheKey);
    if (cachedCount) {
      return parseInt(cachedCount);
    }

    // If not in cache, fetch from Twitter
    try {
      const followersIterator = this.scraper.getFollowers(userId, 1);
      const firstResult = await followersIterator.next();
      const followerCount = (!firstResult.done && firstResult.value) 
        ? firstResult.value.followersCount || 0 
        : 0;

      // Cache the result
      await redis.setex(cacheKey, this.CACHE_EXPIRY, followerCount.toString());
      return followerCount;
    } catch (error) {
      console.error('Error fetching follower count:', error);
      return 0;
    }
  }
}