import { Connection, PublicKey } from '@solana/web3.js';
import { balanceCheckQueue, redis } from '../redis/redis';
import User from '../models/User';

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const TOKEN_MINT = process.env.TOKEN_MINT!; // Your SPL token mint address
const MIN_BALANCE = process.env.MIN_BALANCE || '1'; // Minimum tokens required

// New function for checking single wallet balance
export async function checkSingleWalletBalance(walletAddress: string) {
  const connection = new Connection(SOLANA_RPC);
  const mintPubkey = new PublicKey(TOKEN_MINT);
  const walletPubkey = new PublicKey(walletAddress);
  
  try {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
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

async function checkWalletBalances() {
  console.log('Starting wallet balance check...');
  const connection = new Connection(SOLANA_RPC);
  const mintPubkey = new PublicKey(TOKEN_MINT);
  const users = await User.find({ walletAddress: { $exists: true } });
  console.log(`Found ${users.length} users with wallet addresses to check`);

  const batch = [];

  for (const user of users) {
    try {
      console.log(`Checking balance for wallet: ${user.walletAddress}`);
      const walletPubkey = new PublicKey(user.walletAddress);
      
      // Find token account for this wallet
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
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

// Process balance checks
balanceCheckQueue.process(async (job) => {
  await checkWalletBalances();
});

// Run an immediate check on startup
balanceCheckQueue.add({});

// Schedule checks every 5 minutes
balanceCheckQueue.add(
  {},
  { 
    repeat: { 
      every: 5 * 60 * 1000 
    }
  }
);
