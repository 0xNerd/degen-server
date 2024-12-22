import mongoose, { Schema, Document } from 'mongoose';

// Define the interface for the User document
export interface IUser extends Document {
  telegramUserId: number;
  sessionId: string;
  walletAddress?: string; // Optional, as it's set after connection
  createdAt: Date;
  nonce?: string;
  signature?: string;
  hasRequiredBalance?: boolean;
  tokenBalance?: string;
  lastChecked?: Date;
  inviteUrl?: string;
}

// Define the User schema
const UserSchema: Schema = new Schema({
  telegramUserId: {
    type: Number,
    required: true,
    unique: true, // Assuming one wallet per Telegram user for now
  },
  sessionId: {
    type: String,
    required: true,
    unique: true,
    sparse: true, // Allows multiple null values (before session is created)
  },
  walletAddress: {
    type: String,
    required: false,
    unique: true,
  },
  nonce: {
    type: String,
    required: false,
  },
  signature: {
    type: String,
    required: false,
  },
  hasRequiredBalance: { type: Boolean, default: false },
  tokenBalance: { type: String, default: '0' },
  lastChecked: { type: Date },
  inviteUrl: { type: String, required: false }
}, { timestamps: true });

// Create and export the User model
const User = mongoose.model<IUser>('User', UserSchema);

export default User;