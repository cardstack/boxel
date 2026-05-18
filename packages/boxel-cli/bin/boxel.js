#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

// Use the built dist version if available, otherwise fall back to ts-node
const distEntry = path.resolve(__dirname, '..', 'dist', 'index.js');

if (fs.existsSync(distEntry)) {
  require(distEntry);
} else {
  // Development fallback: run from TypeScript source via ts-node.
  // Point ts-node at boxel-cli's own tsconfig.json explicitly so it
  // works regardless of the caller's cwd. Without `project`, ts-node
  // discovers tsconfig from cwd — fine when invoked from inside the
  // monorepo, broken when invoked from /tmp/... or any other tree.
  require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.json'),
  });
  require('../src/index.ts');
}
