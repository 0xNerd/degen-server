import { TweetScraper } from '../services/tweetScraper';
import { TweetAnalyzer, AnalyzedTweet } from '../services/tweetAnalyzer';
import { redis } from '../redis/config';
import Queue from 'bull';

export class SentimentClient {
  private static instance: SentimentClient;
  private tweetScraper: TweetScraper;
  private tweetAnalyzer: TweetAnalyzer;
  private analysisQueue: Queue.Queue;
  private isRunning: boolean = false;

  private constructor() {
    this.tweetScraper = TweetScraper.getInstance();
    this.tweetAnalyzer = TweetAnalyzer.getInstance();
    this.analysisQueue = new Queue('sentiment-analysis', process.env.REDIS_URL);
  }

  public static getInstance(): SentimentClient {
    if (!SentimentClient.instance) {
      SentimentClient.instance = new SentimentClient();
    }
    return SentimentClient.instance;
  }

  public async initialize(): Promise<void> {
    console.log('Initializing sentiment client...');
    await this.tweetScraper.initialize();
    console.log('Twitter scraper initialized');
    await this.setupQueue();
    console.log('Queue initialized');
  }

  private async setupQueue(): Promise<void> {
    // Clear existing jobs
    await this.analysisQueue.empty();

    // Setup job processor
    this.analysisQueue.process(async (job) => {
      if (this.isRunning) {
        console.log('Previous job still running, skipping...');
        return;
      }

      try {
        this.isRunning = true;
        await this.runMainLoop();
      } catch (error) {
        console.error('Error in main loop:', error);
      } finally {
        this.isRunning = false;
        // Schedule next job immediately after completion
        await this.analysisQueue.add({}, {
          removeOnComplete: true,
          removeOnFail: 10,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 60000,
          },
          delay: 30000 // Add a 30-second delay between jobs
        });
      }
    });

    // Add initial job to start the chain
    await this.analysisQueue.add({}, {
      removeOnComplete: true,
      removeOnFail: 10,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000,
      },
    });

    // Handle events
    this.analysisQueue.on('completed', (job) => {
      console.log(`Job ${job.id} completed`);
    });

    this.analysisQueue.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err);
    });
  }

  private async runMainLoop(): Promise<void> {
    console.log('Starting main loop...');

    try {
      const keywordGroups = {
        primary: ['new token', 'presale', 'stealth launch'],
        context: ['crypto', 'gem']
      };
      const allTweets = [];

      // Keyword-based tweet searching
      console.log('Searching tweets by keywords...');
      const searchPromises = keywordGroups.primary.flatMap(primary => 
        keywordGroups.context.map(context => 
          this.tweetScraper.searchTweets(`${primary} ${context}`, 3)
        )
      );
      console.log('Searching tweets by keywords...');
      const searchResults = await Promise.all(searchPromises);
      allTweets.push(...searchResults.flat());
      
      console.log(`Retrieved ${allTweets.length} tweets total`);

      const analyzedTweets = await this.tweetAnalyzer.analyzeTweets(allTweets);
      console.log(`Analyzed ${analyzedTweets.length} tweets`);
      console.log('Analyzed tweets:', analyzedTweets);
      const significantTweets = analyzedTweets.filter(tweet => 
        tweet.analysis.score > 0.5 && 
        tweet.analysis.credibilityScore > 0.32
      );

      console.log(`Found ${significantTweets.length} significant tweets`);

      // Store in Redis and publish update
      await redis.publish('sentiment:updates', JSON.stringify({
        timestamp: Date.now(),
        metadata: {
          totalTweetsAnalyzed: allTweets.length,
          significantTweetsCount: significantTweets.length,
          targetAccounts: keywordGroups,
          batchId: Date.now().toString(),
        },
        statistics: {
          averageScore: significantTweets.reduce((acc, t) => acc + t.analysis.score, 0) / significantTweets.length,
          averageCredibility: significantTweets.reduce((acc, t) => acc + t.analysis.credibilityScore, 0) / significantTweets.length,
          sentimentDistribution: significantTweets.reduce((acc, t) => {
            acc[t.analysis.sentiment] = (acc[t.analysis.sentiment] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
          topTopics: this.getTopTopics(significantTweets),
        },
        tweets: significantTweets.map(tweet => ({
          ...tweet,
          engagement: {
            likes: tweet.likes || 0,
            retweets: tweet.retweets || 0,
            replies: tweet.replies || 0,
            views: tweet.views || 0,
            bookmarks: tweet.bookmarkCount || 0
          }
        }))
      }));

     
    } catch (error) {
      console.error('Error in main loop:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    console.log('Shutting down sentiment client...');
    if (this.analysisQueue) {
        await this.analysisQueue.close();
        console.log('Analysis queue closed');
    }
    if (redis) {
        await redis.quit();
        console.log('Redis connection closed');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private getTopTopics(tweets: AnalyzedTweet[]): { topic: string; count: number }[] {
    const topicCounts = tweets
      .flatMap(tweet => tweet.analysis.topics)
      .reduce((acc, topic) => {
        acc[topic] = (acc[topic] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    return Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 topics
  }
}

if (require.main === module) {
  const client = SentimentClient.getInstance();
  
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM signal');
    await client.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT signal');
    await client.shutdown();
    process.exit(0);
  });

  client.initialize().catch(error => {
    console.error('Failed to initialize sentiment client:', error);
    process.exit(1);
  });
}

export default SentimentClient;