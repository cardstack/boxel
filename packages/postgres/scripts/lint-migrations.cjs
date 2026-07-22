#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';

const fs = require('fs');
const path = require('path');

// Both phases: additive migrations in migrations/ and destructive ones in
// migrations-removal/ (applied post-deploy).
const migrationDirs = [
  path.join(__dirname, '..', 'migrations'),
  path.join(__dirname, '..', 'migrations-removal'),
];
const files = migrationDirs.flatMap((dir) =>
  fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.js'))
    .sort(),
);

const suspicious = [];

for (const file of files) {
  const match = file.match(/^(\d+)_/);
  if (!match) {
    continue;
  }

  if (/0{6}/.test(match[1])) {
    suspicious.push(file);
  }
}

if (suspicious.length) {
  for (const file of suspicious) {
    console.error(
      `suspicious migration file ${file}. please use 'pnpm migrate create <migration_name>' to create a db migration file`,
    );
  }
  process.exitCode = 1;
}
