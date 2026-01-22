#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'migrations');
const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.js'))
  .sort();

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
      `suspicious migration file ${file}. please use 'pnpm migrate create file_name' to create a db migration file`,
    );
  }
  process.exitCode = 1;
}
