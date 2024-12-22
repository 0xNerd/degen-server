import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose'; 
import User from './models/User'; 
import cors from 'cors';
import { web3Auth, authorizedPk } from './middleware/web3Auth';

dotenv.config();

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

// Placeholder for the wallet connection endpoint
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
      { sessionId: sessionId }, // Find by session ID
      { telegramUserId: telegramId, walletAddress: userPubKeyString, signature: signature }, // Update data (replace 123 with actual user ID)
      { upsert: true, new: true } // Create if not found, return updated document
    );

    res.status(200).json({ message: 'Wallet connected successfully', user });

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