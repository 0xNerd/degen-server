import { Connection, PublicKey } from '@solana/web3.js';
import { redis } from '../redis';
import User from '../models/User';

import { 
  SOLANA_RPC, 
  TOKEN_MINT, 
  MIN_BALANCE 
} from '../settings';

export class BalanceChecker {
  private static instance: BalanceChecker;
  private connection: Connection;

  private constructor() {
    if (!process.env.TOKEN_MINT) {
      throw new Error('TOKEN_MINT environment variable is required');
    }
    if (!process.env.SOLANA_RPC) {
      throw new Error('SOLANA_RPC environment variable is required');
    }
    this.connection = new Connection(SOLANA_RPC);
  }

  public static getInstance(): BalanceChecker {
    if (!BalanceChecker.instance) {
      BalanceChecker.instance = new BalanceChecker();
    }
    return BalanceChecker.instance;
  }

  async checkSingleWalletBalance(walletAddress: string) {
    const mintPubkey = new PublicKey(TOKEN_MINT);
    const walletPubkey = new PublicKey(walletAddress);
    
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { mint: mintPubkey }
      );

      const balance = tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0;
      const hasMinBalance = balance >= Number(MIN_BALANCE);

      return { balance, hasMinBalance };
    } catch (error) {
      console.error(`Error checking balance for ${walletAddress}:`, error);
      throw error;
    }
  }

  async checkWalletBalances() {
    console.log('Starting wallet balance check...');
    
    if (!process.env.TOKEN_MINT) {
      console.log('No TOKEN_MINT configured, skipping balance check');
      return;
    }

    const users = await User.find({ walletAddress: { $exists: true } });
    
    if (users.length === 0) {
      console.log('No users with wallet addresses found');
      return;
    }

    console.log(`Found ${users.length} users with wallet addresses to check`);
    const mintPubkey = new PublicKey(process.env.TOKEN_MINT);
    const batch = [];

    for (const user of users) {
      try {
        console.log(`Checking balance for wallet: ${user.walletAddress}`);
        const walletPubkey = new PublicKey(user.walletAddress);
        
        // Find token account for this wallet
        const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
          walletPubkey,
          { mint: mintPubkey }
        );

        const balance = tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount || 0;
        const hasMinBalance = balance >= Number(MIN_BALANCE);
        console.log(`Wallet ${user.walletAddress} balance: ${balance} (minimum required: ${MIN_BALANCE})`);

        // Store permission updates in Redis
        if (user.hasRequiredBalance !== hasMinBalance) {
          console.log(`Permission change for user ${user.telegramUserId}: ${hasMinBalance ? 'granted' : 'revoked'}`);
          // Change the Redis key pattern to match what the Telegram bot expects
          await redis.set(
            `user:${user.telegramUserId}:permissions`,
            JSON.stringify({
              hasRequiredBalance: hasMinBalance,
              timestamp: Date.now()
            })
          );
        }

        batch.push({
          updateOne: {
            filter: { _id: user._id },
            update: {
              $set: {
                tokenBalance: balance.toString(),
                hasRequiredBalance: hasMinBalance,
                lastChecked: new Date()
              }
            }
          }
        });
      } catch (error) {
        console.error(`Error checking balance for ${user.walletAddress}:`, error);
      }
    }

    if (batch.length > 0) {
      console.log(`Updating database with ${batch.length} balance changes`);
      await User.bulkWrite(batch);
    }
    
    console.log('Balance check completed');
  }
}
