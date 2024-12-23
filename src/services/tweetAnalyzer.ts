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
    topicRelevance: 0.35,    // Cross-referenced chatter & timing
    engagement: 0.25,        // Weighted towards early engagement patterns
    communitySignals: 0.25,  // Community validation & cross-references
    contentPatterns: 0.15,   // Typical alpha-leak patterns
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
      Analyze this crypto/memecoin related tweet: "${tweet.text}"
      Provide a JSON response with:
      - sentiment (positive/negative/neutral)
      - score (0-1, where 1 indicates high potential alpha/opportunity and 0 indicates scam/negative)
      - topics (array of relevant topics: e.g., presale, launch, airdrop, token, blockchain name, etc.)
      - summary (brief summary focusing on key trading signals and timeline)

      Example:
      Tweet: "🚀 $WIF just launched stealth on SOL! LP locked for 1 year, ownership renounced, 1000x potential! CA: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"
      Response:
      {
        "sentiment": "positive",
        "score": 0.8,
        "topics": ["stealth launch", "ETH", "PEPE", "memecoin", "liquidity locked", "ownership renounced"],
        "summary": "New memecoin PEPE launched on Ethereum with security features in place. Stealth launch with locked liquidity suggests potential early opportunity."
      }
    `;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a tweet analyzer with a focus on crypto/memecoin related tweets. Your objective is to analyze the tweet and provide a detailed analysis of the sentiment, score, topics, and summary. You are also responsible for calculating the credibility score of the tweet based on the engagement metrics. Respond only with valid JSON." },
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
    // Calculate individual component scores
    const engagementScore = this.calculateEngagementScore(tweet);
    const contentQualityScore = this.calculateContentQualityScore(tweet);
    const userBehaviorScore = this.calculateUserBehaviorScore(tweet);
    const mediaRichnessScore = this.calculateMediaRichnessScore(tweet);
   
    return Math.min(
      engagementScore * this.credibilityWeights.engagement +
      contentQualityScore * this.credibilityWeights.contentPatterns +
      userBehaviorScore * this.credibilityWeights.communitySignals +
      mediaRichnessScore * this.credibilityWeights.topicRelevance,
      1
    );
  }

  private calculateEngagementScore(tweet: Tweet): number {
    const {
      likes = 0,
      retweets = 0,
      replies = 0,
      bookmarkCount = 0,
      views = 0
    } = tweet;

    // Normalize metrics using log scale
    const normalizedLikes = Math.log10(likes + 1) / Math.log10(100000);
    const normalizedRetweets = Math.log10(retweets + 1) / Math.log10(100000);
    const normalizedReplies = Math.log10(replies + 1) / Math.log10(10000);
    const normalizedBookmarks = Math.log10(bookmarkCount + 1) / Math.log10(10000);
    
    // Calculate engagement rate if views are available
    const engagementRate = views > 0 
      ? Math.min((likes + retweets + replies) / views, 1)
      : 0;

    return (
      normalizedLikes * 0.3 +
      normalizedRetweets * 0.3 +
      normalizedReplies * 0.2 +
      normalizedBookmarks * 0.1 +
      engagementRate * 0.1
    );
  }

  private calculateContentQualityScore(tweet: Tweet): number {
    const {
      text = '',
      hashtags = [],
      urls = [],
      mentions = [],
      sensitiveContent = false,
      poll
    } = tweet;

    let score = 0;

    // Text length and quality
    const wordCount = text.split(/\s+/).length;
    score += Math.min(wordCount / 50, 0.3); // Reward longer, thoughtful content

    // Hashtag usage (penalize excessive hashtags)
    const hashtagRatio = hashtags.length / wordCount;
    score += hashtagRatio <= 0.2 ? 0.15 : -0.1;

    // URL presence (indicates source linking)
    score += urls.length > 0 ? 0.15 : 0;

    // Mention usage (penalize excessive mentions)
    const mentionRatio = mentions.length / wordCount;
    score += mentionRatio <= 0.1 ? 0.1 : -0.1;

    // Poll presence (indicates user engagement)
    score += poll ? 0.15 : 0;

    // Penalize sensitive content
    score -= sensitiveContent ? 0.2 : 0;

    return Math.max(0, Math.min(score, 1));
  }

  private calculateUserBehaviorScore(tweet: Tweet): number {
    const {
      isRetweet = false,
      isQuoted = false,
      isReply = false,
      isSelfThread = false,
      isPin = false,
      thread = [],
    } = tweet;

    let score = 0.5; // Start with neutral score

    // Original content vs. retweet
    score += isRetweet ? -0.1 : 0.2;

    // Quoted tweets (shows engagement)
    score += isQuoted ? 0.1 : 0;

    // Thread participation
    if (isSelfThread) {
      score += 0.15; // Reward thread creation
      score += Math.min(thread.length * 0.05, 0.15); // Reward thread depth
    }

    // Pinned tweet (important content)
    score += isPin ? 0.1 : 0;

    // Conversation participation
    score += isReply ? 0.1 : 0;

    return Math.max(0, Math.min(score, 1));
  }

  private calculateMediaRichnessScore(tweet: Tweet): number {
    const {
      photos = [],
      videos = [],
      poll,
      urls = [],
    } = tweet;

    let score = 0;

    // Media presence
    score += photos.length > 0 ? 0.3 : 0;
    score += videos.length > 0 ? 0.4 : 0;

    // Avoid penalizing text-only educational/news content
    if (photos.length === 0 && videos.length === 0) {
      if (urls.length > 0 || poll) {
        score += 0.2;
      }
    }

    // Penalize excessive media
    const totalMedia = photos.length + videos.length;
    if (totalMedia > 4) {
      score -= 0.2;
    }

    return Math.max(0, Math.min(score, 1));
  }
}

// Export singleton instance method
export const analyzeTweets = (tweets: Tweet[]) => 
  TweetAnalyzer.getInstance().analyzeTweets(tweets);