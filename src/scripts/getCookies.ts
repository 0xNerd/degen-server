import fs from 'fs';
import path from 'path';

const username = process.env.TWITTER_USERNAME || 'roninawakes';
const cookiesPath = path.join(__dirname, '../..', 'tweetcache', `${username}_cookies.json`);

if (fs.existsSync(cookiesPath)) {
  const cookies = fs.readFileSync(cookiesPath, 'utf-8');
  console.log('Add this to your .env file:');
  console.log(`TWITTER_COOKIES='${cookies}'`);
} else {
  console.error('Cookie file not found');
}