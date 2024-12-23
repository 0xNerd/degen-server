import { TweetAnalyzer } from './tweetAnalyzer';
import { TweetScraper } from './tweetScraper';
import { redis } from '../redis/config';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

describe('Tweet Analysis Integration', () => {
  // Setup and teardown
  beforeAll(async () => {
    // Verify required environment variables
    const requiredEnvVars = [
      'OPENAI_API_KEY',
      'TWITTER_USERNAME',
      'TWITTER_PASSWORD',
      'TWITTER_EMAIL'
    ];

    requiredEnvVars.forEach(envVar => {
      if (!process.env[envVar]) {
        throw new Error(`${envVar} is required for tests`);
      }
    });

    // Login to Twitter
    const scraper = TweetScraper.getInstance();
    await scraper.initialize();
  }, 10000);

  afterAll(async () => {
    // Cleanup Redis connections
    await redis.quit();
    // Add a small delay to ensure Redis connection is properly closed
    await new Promise(resolve => setTimeout(resolve, 100));
  }, 10000);

  it('should analyze tweets from a user', async () => {
    console.log('\nTesting tweet analysis for user...');
    
    const scraper = TweetScraper.getInstance();
    const tweets = await scraper.getTweets('elonmusk', 5);
    console.log(`Retrieved ${tweets.length} tweets`);

    expect(tweets.length).toBeGreaterThan(0);
    expect(tweets[0].text).toBeDefined();
    console.log('Sample tweet:', tweets[0].text);

    const analyzer = TweetAnalyzer.getInstance();
    const analyzedTweets = await analyzer.analyzeTweets(tweets);
    console.log('Analysis results:', 
      analyzedTweets.map(t => ({
        text: t.text?.substring(0, 50) + '...',
        sentiment: t.analysis.sentiment,
        score: t.analysis.score,
        topics: t.analysis.topics
      }))
    );

    expect(analyzedTweets.length).toBeGreaterThan(0);
    analyzedTweets.forEach(tweet => {
      expect(tweet.analysis).toBeDefined();
      expect(tweet.analysis.sentiment).toBeDefined();
      expect(tweet.analysis.score).toBeGreaterThan(0);
      expect(tweet.analysis.topics).toBeInstanceOf(Array);
      expect(tweet.analysis.credibilityScore).toBeGreaterThan(0);
      expect(tweet.analysis.credibilityScore).toBeLessThanOrEqual(1);
    });
  }, 30000);

  it('should handle tweets with media content', async () => {
    console.log('\nTesting media content handling...');
    
    const scraper = TweetScraper.getInstance();
    const tweets = await scraper.getTweets('NASA', 5);
    console.log(`Retrieved ${tweets.length} tweets from NASA`);
    
    const analyzer = TweetAnalyzer.getInstance();
    const analyzedTweets = await analyzer.analyzeTweets(tweets);
    const tweetsWithMedia = analyzedTweets.filter(
      tweet => tweet.photos.length > 0 || tweet.videos.length > 0
    );
    console.log(`Found ${tweetsWithMedia.length} tweets with media`);

    expect(analyzedTweets.length).toBeGreaterThan(0);
    expect(tweetsWithMedia.length).toBeGreaterThan(0);
  }, 30000);

  it('should calculate credibility scores', async () => {
    console.log('\nTesting credibility scoring...');
    
    const scraper = TweetScraper.getInstance();
    const tweets = await scraper.getTweets('elonmusk', 1);
    console.log('Retrieved tweet:', tweets[0].text);
    
    const analyzer = TweetAnalyzer.getInstance();
    const analyzedTweets = await analyzer.analyzeTweets(tweets);
    console.log('Credibility score:', analyzedTweets[0].analysis.credibilityScore);

    expect(analyzedTweets[0].analysis.credibilityScore).toBeGreaterThan(0);
    expect(analyzedTweets[0].analysis.credibilityScore).toBeLessThanOrEqual(1);
  }, 30000);
}); 