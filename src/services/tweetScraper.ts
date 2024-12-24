import { Scraper, Tweet, Profile } from 'agent-twitter-client';
import { redis } from '../redis';
import fs from 'fs';
import path from 'path';

export class TweetScraper {
  private scraper: Scraper;
  private readonly CACHE_EXPIRY = 600; // 10 minutes in seconds
  private static instance: TweetScraper;
  
  // Add constants for paths
  private static readonly CACHE_DIR = path.join(process.cwd(), 'tweetcache');
  private readonly cookiesFilePath: string;

  private constructor() {
    this.scraper = new Scraper();
    // Ensure cache directory exists
    if (!fs.existsSync(TweetScraper.CACHE_DIR)) {
      fs.mkdirSync(TweetScraper.CACHE_DIR, { recursive: true });
    }
    
    this.cookiesFilePath = path.join(
      TweetScraper.CACHE_DIR,
      `${process.env.TWITTER_USERNAME}_cookies.json`
    );
  }

  private async saveCookies(): Promise<void> {
    try {
      const cookies = await this.scraper.getCookies();
      fs.writeFileSync(this.cookiesFilePath, JSON.stringify(cookies, null, 2), 'utf-8');
      console.log('Saved cookies to:', this.cookiesFilePath);
    } catch (error) {
      console.error('Error saving cookies:', error);
      throw error;
    }
  }

  private async loadCookies(): Promise<any[] | null> {
    try {
      if (fs.existsSync(this.cookiesFilePath)) {
        const cookiesData = fs.readFileSync(this.cookiesFilePath, 'utf-8');
        return JSON.parse(cookiesData);
      }
      return null;
    } catch (error) {
      console.error('Error loading cookies:', error);
      return null;
    }
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
      TWITTER_COOKIES,
    } = process.env;

    const MAX_LOGIN_RETRIES = 3;
    let loginRetries = 0;

    try {
      // Try cookies first
      if (TWITTER_COOKIES) {
        try {
          const parsedCookies = JSON.parse(TWITTER_COOKIES);
          if (!Array.isArray(parsedCookies)) {
            throw new Error('TWITTER_COOKIES must be a valid JSON array');
          }
          await this.setCookiesFromArray(parsedCookies);
          if (await this.scraper.isLoggedIn()) {
            console.log('Successfully logged in using TWITTER_COOKIES');
            return;
          }
        } catch (cookieError) {
          console.error('Failed to use TWITTER_COOKIES:', cookieError);
        }
      }

      // Try saved cookies
      const savedCookies = await this.loadCookies();
      if (savedCookies) {
        console.log('Attempting login with saved cookies...');
        await this.setCookiesFromArray(savedCookies);
        if (await this.scraper.isLoggedIn()) {
          console.log('Successfully logged in using saved cookies');
          return;
        }
        console.log('Saved cookies failed, falling back to credentials');
      }

      // Try credentials with retries
      if (TWITTER_USERNAME && TWITTER_PASSWORD) {
        while (loginRetries < MAX_LOGIN_RETRIES) {
          try {
            await this.scraper.login(TWITTER_USERNAME, TWITTER_PASSWORD, TWITTER_EMAIL);
            if (await this.scraper.isLoggedIn()) {
              console.log('Successfully logged in with credentials');
              await this.saveCookies();
              return;
            }
          } catch (loginError) {
            loginRetries++;
            console.error(`Login attempt ${loginRetries} failed:`, loginError);
            if (loginRetries === MAX_LOGIN_RETRIES) {
              throw new Error(`Failed to login after ${MAX_LOGIN_RETRIES} attempts`);
            }
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 5000 * loginRetries));
          }
        }
      }

      throw new Error('No valid Twitter authentication method succeeded');
      
    } catch (error) {
      console.error('Twitter initialization failed:', error);
      throw error;
    }
  }

  async getProfile(username: string): Promise<Profile> {
    const cacheKey = `profile:${username}`;
    const cachedProfile = await redis.get(cacheKey);
    if (cachedProfile) {
      return JSON.parse(cachedProfile);
    }
    const profile = await this.scraper.getProfile(username);
    await redis.setex(cacheKey, this.CACHE_EXPIRY, JSON.stringify(profile));
    return profile;
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

  async searchTweets(query: string, count: number, searchMode: number = 1): Promise<Tweet[]> {
    const cacheKey = `search:${query}:${count}:${searchMode}`;
    
    const cachedTweets = await redis.get(cacheKey);
    if (cachedTweets) {
      return JSON.parse(cachedTweets);
    }

    const tweets = [];
    for await (const tweet of this.scraper.searchTweets(query, count, searchMode)) {
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

  private async setCookiesFromArray(cookiesArray: any[]): Promise<void> {
    const cookieStrings = cookiesArray.map(
      (cookie) => `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${
        cookie.secure ? "Secure" : ""
      }; ${cookie.httpOnly ? "HttpOnly" : ""}; SameSite=${
        cookie.sameSite || "Lax"
      }`
    );
    await this.scraper.setCookies(cookieStrings);
  }
}