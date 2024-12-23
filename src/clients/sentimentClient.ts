import { TweetScraper } from '../services/tweetScraper';
import { TweetAnalyzer } from '../services/tweetAnalyzer';
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
        throw error; // Bull will handle retry
      } finally {
        this.isRunning = false;
      }
    });

    // Add recurring job
    await this.analysisQueue.add(
      {},
      {
        repeat: {
          every: 5 * 60 * 1000, // 5 minutes
        },
        removeOnComplete: true,
        removeOnFail: 10, // Keep last 10 failed jobs for debugging
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000, // 1 minute
        },
      }
    );

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
      const targetAccounts = ['elonmusk', 'NASA', 'vitalikbuterin'];
      const allTweets = [];

      for (const account of targetAccounts) {
        console.log(`Fetching tweets from ${account}...`);
        const tweets = await this.tweetScraper.getTweets(account, 10);
        allTweets.push(...tweets);
      }

      console.log(`Retrieved ${allTweets.length} tweets total`);

      const analyzedTweets = await this.tweetAnalyzer.analyzeTweets(allTweets);
      console.log(`Analyzed ${analyzedTweets.length} tweets`);

      const significantTweets = analyzedTweets.filter(tweet => 
        tweet.analysis.score > 0.7 && 
        tweet.analysis.credibilityScore > 0.6
      );

      console.log(`Found ${significantTweets.length} significant tweets`);

      await redis.setex(
        'latest_analysis', 
        3600,
        JSON.stringify(significantTweets)
      );

    } catch (error) {
      console.error('Error in main loop:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    console.log('Shutting down sentiment client...');
    await this.analysisQueue.close();
    await redis.quit();
    await new Promise(resolve => setTimeout(resolve, 100));
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