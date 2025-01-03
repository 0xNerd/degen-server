import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose'; 
import User from './models/User'; 
import cors from 'cors';
import { web3Auth, authorizedPk } from './middleware/web3Auth';
import { RedisClient } from './redis/config';
import { BalanceChecker } from './services/balanceChecker';
import { SentimentClient } from './clients/sentimentClient';
import { BalanceClient } from './clients/balanceClient';

dotenv.config();

const MIN_BALANCE = process.env.MIN_BALANCE || '1';
const mongoURI = process.env.MONGODB_URI
const port = process.env.PORT || 3000;

// Initialize singletons at startup
class AppServer {
  private static instance: AppServer;
  private app: express.Application;

  private constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  public static getInstance(): AppServer {
    if (!AppServer.instance) {
      AppServer.instance = new AppServer();
    }
    return AppServer.instance;
  }

  private setupMiddleware() {
    this.app.use(cors({
      origin: [
        'https://www.backdoor.wtf',
        'https://backdoor.wtf',
        'https://bigbawls.lol',
        'https://www.bigbawls.lol',
        'http://localhost:8080',
      ],
      methods: ['GET', 'POST', 'PUT'],
    }));
    this.app.use(express.json());
  }

  private setupRoutes() {
    this.app.post('/api/connect-wallet', 
      web3Auth({ action: 'telegram:connect-wallet', allowSkipCheck: true }),
      async (req, res) => {
        try {
          const { sessionId, signature } = req.body;
          const userPubKeyString = authorizedPk(res);
          if (!userPubKeyString) {
            return res.status(400).json({ error: 'No public key found' });
          }

          const user = await User.findOneAndUpdate(
            { sessionId: sessionId },
            { walletAddress: userPubKeyString, signature: signature },
            { upsert: true, new: true }
          );

          const { balance, hasMinBalance } = await BalanceChecker.getInstance()
            .checkSingleWalletBalance(userPubKeyString);

          user.tokenBalance = balance.toString();
          user.hasRequiredBalance = hasMinBalance;
          user.lastChecked = new Date();
          await user.save();

          await RedisClient.getInstance().hset(
            'telegram:permission-updates',
            user.telegramUserId,
            JSON.stringify({
              hasRequiredBalance: hasMinBalance,
              timestamp: Date.now()
            })
          );

          if (!hasMinBalance) {
            return res.status(403).json({
              error: 'Insufficient token balance',
              balance,
              required: MIN_BALANCE
            });
          }

          res.status(200).json({ 
            message: 'Wallet connected successfully', 
            user,
            balance,
            hasRequiredBalance: true,
            inviteUrl: user.inviteUrl
          });

        } catch (error) {
          console.error("Error handling wallet connection:", error);
          res.status(500).send("Internal Server Error");
        }
      }
    );

    this.app.post('/api/start-check', async (req, res) => {
      try {
        const { sessionId, inviteUrl, telegramId } = req.body;
        console.log('start check', req.body);
        if (!sessionId || !inviteUrl || !telegramId) { 
          return res.status(400).json({ error: 'Invalid request' }); 
        }

        // First try to find by telegramUserId
        let user = await User.findOne({ telegramUserId: telegramId });
        
        if (user) {
          // Update existing user
          user.sessionId = sessionId;
          user.inviteUrl = inviteUrl;
          await user.save();
        } else {
          // Create new user if none exists
          user = await User.findOneAndUpdate(
            { sessionId: sessionId },
            { 
              telegramUserId: telegramId, 
              inviteUrl: inviteUrl 
            },
            { upsert: true, new: true }
          );
        }

        res.status(200).json({ message: 'Check started successfully', user });

      } catch (error) {
        console.error("Error handling check start:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // Basic route
    this.app.get('/', (req, res) => {
      res.send('Hello world!');
    });
  }

  public async start() {
    try {
      // First connect MongoDB
      await mongoose.connect(mongoURI!);
      console.log('MongoDB connected');
      // Initialize BalanceClient
      await BalanceClient.getInstance().initialize();
      console.log('BalanceClient initialized');

      // Initialize SentimentClient
      await SentimentClient.getInstance().initialize();
      console.log('SentimentClient initialized');

      // Finally start the server
      this.app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
      });
    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  }
}

// Start the server
AppServer.getInstance().start();