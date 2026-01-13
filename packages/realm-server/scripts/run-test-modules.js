#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');

function buildModuleFilter(modulesToMatch) {
  const escaped = modulesToMatch
    .map((moduleName) => escapeRegex(moduleName))
    .join('|');
  const pattern = `^(?:${escaped})(?:\\s>\\s|:)`;
  return `/${pattern}/`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
}

const rawModules = process.env.TEST_MODULES ?? '';
const cleanedRaw = rawModules.trim();

if (!cleanedRaw) {
  console.error('TEST_MODULES must be set.');
  process.exit(1);
}

const modules = cleanedRaw
  .split(/[|,]/)
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => value.replace(/^['"]+|['"]+$/g, ''));

if (modules.length === 0) {
  console.error('No module names found in TEST_MODULES.');
  process.exit(1);
}

const args = ['--require', 'ts-node/register/transpile-only'];

args.push('--filter', buildModuleFilter(modules));

args.push('tests/index.ts');

const qunitBin = require.resolve('qunit/bin/qunit.js');
const result = spawnSync(process.execPath, [qunitBin, ...args], {
  stdio: 'inherit',
  env: process.env,
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

if (result.error) {
  console.error(result.error);
}

process.exit(1);
