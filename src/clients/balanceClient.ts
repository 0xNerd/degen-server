import Queue from 'bull';
import { BalanceChecker } from '../services/balanceChecker';

export class BalanceClient {
  private static instance: BalanceClient;
  private balanceQueue: Queue.Queue;
  private isRunning: boolean = false;

  private constructor() {
    this.balanceQueue = new Queue('batch-balance-check', process.env.REDIS_URL);
  }

  public static getInstance(): BalanceClient {
    if (!BalanceClient.instance) {
      BalanceClient.instance = new BalanceClient();
    }
    return BalanceClient.instance;
  }

  public async initialize(): Promise<void> {
    console.log('Initializing balance client...');
    await this.setupQueue();
    console.log('Queue initialized');
    
    // Add immediate first check
    await this.runBalanceCheck();
    console.log('Initial balance check completed');
  }

  private async setupQueue(): Promise<void> {
    // Clear existing jobs
    await this.balanceQueue.empty();

    // Setup job processor
    this.balanceQueue.process(async (job) => {
      if (this.isRunning) {
        console.log('Previous balance check still running, skipping...');
        return;
      }

      try {
        this.isRunning = true;
        await this.runBalanceCheck();
      } catch (error) {
        console.error('Error in balance check:', error);
        throw error; // Bull will handle retry
      } finally {
        this.isRunning = false;
      }
    });

    // Add recurring job
    await this.balanceQueue.add(
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
    this.balanceQueue.on('completed', (job) => {
      console.log(`Balance check job ${job.id} completed`);
    });

    this.balanceQueue.on('failed', (job, err) => {
      console.error(`Balance check job ${job?.id} failed:`, err);
    });
  }

  private async runBalanceCheck(): Promise<void> {
    const instance = BalanceChecker.getInstance();
    await instance.checkWalletBalances();
  }

  public async shutdown(): Promise<void> {
    console.log('Shutting down balance client...');
    if (this.balanceQueue) {
      await this.balanceQueue.close();
      console.log('Balance queue closed');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

if (require.main === module) {
  const client = BalanceClient.getInstance();
  
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
    console.error('Failed to initialize balance client:', error);
    process.exit(1);
  });
}

export default BalanceClient;
