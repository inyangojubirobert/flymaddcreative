// Runs scripts/test-dream-coins.mjs against the full migration stack
// (Dream Coins + earnings & payouts + gift revenue sharing + affiliate).
//   node --test scripts/test-dream-coins-full.mjs
process.env.DREAM_COINS_STACK = 'full';
await import('./test-dream-coins.mjs');
