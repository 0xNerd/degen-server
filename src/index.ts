import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose'; 
import User from './models/User'; 
import cors from 'cors';
import { web3Auth, authorizedPk } from './middleware/web3Auth';
import { Connection, PublicKey } from '@solana/web3.js';
import { redis } from './redis/redis';

dotenv.config();

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const TOKEN_MINT = process.env.TOKEN_MINT!;
const MIN_BALANCE = process.env.MIN_BALANCE || '1';

const app = express();
const port = process.env.PORT || 3000;

const mongoURI = process.env.MONGODB_URI
if (!mongoURI) {
  throw new Error('MONGODB_URI is not set in the environment variables');
}

// Initialize MongoDB first, then Redis and balance checker
mongoose.connect(mongoURI)
  .then(() => {
    console.log('MongoDB connected');
    // Initialize Redis and balance checker only after MongoDB is connected
    require('./redis/redis');
    require('./solana/balance');
  })
  .catch((err) => console.error('MongoDB connection error:', err));

app.use(cors({
    origin: [
      'https://www.backdoor.wtf',  // Allow requests from both versions
      'https://backdoor.wtf',
      'https://bigbawls.lol',
      'https://www.bigbawls.lol',
      'http://localhost:8080',
    ], // Allow requests from the frontend URL
    methods: ['GET', 'POST', 'PUT'],        // Allow specific methods if needed
    
}));

app.use(express.json());

// Basic route for testing
app.get('/', (req, res) => {
  res.send('Hello from your Token Gating Bot Backend!');
});

app.post('/api/connect-wallet', 
  web3Auth({ action: 'telegram:connect-wallet', allowSkipCheck: true }),
  async (req, res) => {
  try {
    const { sessionId, signature, telegramId } = req.body;
    const userPubKeyString = authorizedPk(res);
    if (!userPubKeyString) {
      return res.status(400).json({ error: 'No public key found' });
    }
    // Create or update user data
    const user = await User.findOneAndUpdate(
      { sessionId: sessionId },
      { telegramUserId: telegramId, walletAddress: userPubKeyString, signature: signature },
      { upsert: true, new: true }
    );

    // Check balance immediately
    const connection = new Connection(SOLANA_RPC);
    const mintPubkey = new PublicKey(TOKEN_MINT);
    const walletPubkey = new PublicKey(userPubKeyString);
    
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPubkey,
      { mint: mintPubkey }
    );

    const balance = tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0;
    const hasMinBalance = balance >= Number(MIN_BALANCE);

    // Update user with balance info
    user.tokenBalance = balance.toString();
    user.hasRequiredBalance = hasMinBalance;
    user.lastChecked = new Date();
    await user.save();

    // Store permission update in Redis
    await redis.hset(
      'telegram:permission-updates',
      telegramId,
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
});

app.post('/api/start-check', 
  
  async (req, res) => {
  try {
    const { sessionId, inviteUrl, telegramId } = req.body;
    console.log('start check', req.body);

    // Find user by telegramId
    let user = await User.findOne({ telegramUserId: telegramId });
    // add inviteUrl to user if not already present
    user.inviteUrl = inviteUrl;
    await user.save();
    if (!user) {
      // Create or update user data
      user = await User.findOneAndUpdate(
        { sessionId: sessionId }, // Find by session ID
        { telegramUserId: telegramId, inviteUrl: inviteUrl }, // Update data (replace 123 with actual user ID)
        { upsert: true, new: true } // Create if not found, return updated document
      );
    } 
    res.status(200).json({ message: 'Check started successfully', user });

  } catch (error) {
    console.error("Error handling check start:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});