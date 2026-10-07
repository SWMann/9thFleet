// Makes join codes for a test session. Run it on your own PC only:
//
//   npm run token -- Tom Alex Sam
//   npm run token -- --room gate-a --hours 6 Tom Alex Sam
//
// It reads LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET from voice/.env.
// The secret never leaves this PC: testers only ever receive a join code, which expires.
import { AccessToken } from 'livekit-server-sdk';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: the variables may already be set in the shell.
}

const args = process.argv.slice(2);
let room = 'gate-a';
let hours = 12;
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--room') room = args[++i] ?? room;
  else if (args[i] === '--hours') hours = Number(args[++i] ?? hours);
  else names.push(args[i]);
}

const url = process.env.LIVEKIT_URL;
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;

if (!url || !key || !secret) {
  console.error('Missing LIVEKIT_URL, LIVEKIT_API_KEY or LIVEKIT_API_SECRET. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (names.length === 0 || !Number.isFinite(hours) || hours <= 0) {
  console.error('Usage: npm run token -- [--room gate-a] [--hours 12] Name1 Name2 Name3');
  process.exit(1);
}

const seen = new Set();
console.log(`Room "${room}", valid for ${hours} hour(s). Send each person their own line.\n`);
for (const name of names) {
  const identity = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member';
  if (seen.has(identity)) {
    console.error(`Two people would share the name "${name}". Each name must be different.`);
    process.exit(1);
  }
  seen.add(identity);
  const token = new AccessToken(key, secret, { identity, name, ttl: Math.round(hours * 3600) });
  token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
  console.log(`${name}:\n${url}#${await token.toJwt()}\n`);
}
