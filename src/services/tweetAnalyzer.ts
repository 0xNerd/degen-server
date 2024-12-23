import { OpenAI } from 'openai';
import { Tweet } from 'agent-twitter-client';
import { TweetScraper } from './tweetScraper';
import { redis } from '../redis/config';

export interface AnalyzedTweet extends Tweet {
  analysis: {
    sentiment: 'positive' | 'negative' | 'neutral';
    score: number;
    topics: string[];
    summary: string;
    credibilityScore: number;
  };
}

export class TweetAnalyzer {
  private static instance: TweetAnalyzer;
  private openai: OpenAI;
  private readonly BATCH_SIZE = 10;
  private readonly CACHE_EXPIRY = 3600; // 1 hour
  private readonly credibilityWeights = {
    followers: 0.4,
    retweets: 0.3,
    likes: 0.2,
    replies: 0.1,
  };

  private constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required');
    }
    this.openai = new OpenAI();
  }

  public static getInstance(): TweetAnalyzer {
    if (!TweetAnalyzer.instance) {
      TweetAnalyzer.instance = new TweetAnalyzer();
    }
    return TweetAnalyzer.instance;
  }

  public async analyzeTweets(tweets: Tweet[]): Promise<AnalyzedTweet[]> {
    const results: AnalyzedTweet[] = [];
    
    // Process tweets in batches
    for (let i = 0; i < tweets.length; i += this.BATCH_SIZE) {
      const batch = tweets.slice(i, i + this.BATCH_SIZE);
      console.log(`Processing batch ${i / this.BATCH_SIZE + 1} of ${Math.ceil(tweets.length / this.BATCH_SIZE)}`);
      
      const batchPromises = batch.map(tweet => this.getCachedAnalysis(tweet));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Add delay between batches to respect rate limits
      if (i + this.BATCH_SIZE < tweets.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results.filter(tweet => tweet.analysis.score > 0.3);
  }

  private async getCachedAnalysis(tweet: Tweet): Promise<AnalyzedTweet> {
    const cacheKey = `tweet_analysis:${tweet.id}`;
    
    // Try to get from cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return { ...tweet, analysis: JSON.parse(cached) };
    }

    // If not in cache, analyze and store
    const analyzed = await this.analyzeTweet(tweet);
    await redis.setex(cacheKey, this.CACHE_EXPIRY, JSON.stringify(analyzed.analysis));
    return analyzed;
  }

  private async analyzeTweet(tweet: Tweet): Promise<AnalyzedTweet> {
    const prompt = `
      Analyze this tweet: "${tweet.text}"
      Provide a JSON response with:
      - sentiment (positive/negative/neutral)
      - score (0-1, where 0 is completely negative and 1 is completely positive)
      - topics (array of relevant topics, be as specific as possible)
      - summary (brief summary of main points, 1-2 sentences)

      Example:
      Tweet: "Just saw the new iPhone, it's amazing! The camera is incredible, and the battery life is fantastic. #Apple #iPhone"
      Response:
      {
        "sentiment": "positive",
        "score": 0.9,
        "topics": ["Apple", "iPhone", "camera", "battery life"],
        "summary": "The new iPhone is praised for its amazing camera and fantastic battery life."
      }
    `;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a tweet analyzer. Respond only with valid JSON." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    const credibilityScore = await this.calculateCredibilityScore(tweet);

    return {
      ...tweet,
      analysis: {
        ...analysis,
        credibilityScore,
      },
    };
  }

  private async calculateCredibilityScore(tweet: Tweet): Promise<number> {
    const followerCount = tweet.userId 
      ? await TweetScraper.getInstance().getFollowerCount(tweet.userId)
      : 0;

    const { retweets = 0, likes = 0, replies = 0 } = tweet;

    // Normalize metrics using log scale
    const normalizedFollowers = Math.log10(followerCount + 1) / Math.log10(1000000);
    const normalizedRetweets = Math.log10(retweets + 1) / Math.log10(100000);
    const normalizedLikes = Math.log10(likes + 1) / Math.log10(100000);
    const normalizedReplies = Math.log10(replies + 1) / Math.log10(10000);

    return Math.min(
      normalizedFollowers * this.credibilityWeights.followers +
      normalizedRetweets * this.credibilityWeights.retweets +
      normalizedLikes * this.credibilityWeights.likes +
      normalizedReplies * this.credibilityWeights.replies,
      1
    );
  }
}

// Export singleton instance method
export const analyzeTweets = (tweets: Tweet[]) => 
  TweetAnalyzer.getInstance().analyzeTweets(tweets);