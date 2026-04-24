#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

// Use the built dist version if available, otherwise fall back to ts-node
const distEntry = path.resolve(__dirname, '..', 'dist', 'index.js');

if (fs.existsSync(distEntry)) {
  require(distEntry);
} else {
  // Development fallback: run from TypeScript source via ts-node
  require('ts-node').register({ transpileOnly: true });
  require('../src/index.ts');
}
