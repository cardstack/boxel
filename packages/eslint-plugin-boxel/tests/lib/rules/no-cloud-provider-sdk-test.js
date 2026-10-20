'use strict';

const rule = require('../../../lib/rules/no-cloud-provider-sdk');
const RuleTester = require('eslint').RuleTester;

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

const options = [{ patterns: ['@aws-sdk/*', 'aws-sdk', '@azure/*'] }];
const error = (source) => ({
  messageId: 'noCloudProviderSdk',
  data: { source },
});

ruleTester.run('no-cloud-provider-sdk', rule, {
  valid: [
    { code: `import { Pool } from 'pg';`, options },
    { code: `import x from 'aws-sdk-mock';`, options },
    { code: `import x from '@aws-sdkx/client';`, options },
    { code: `const m = await import('./local.js');`, options },
    { code: `const m = await import(moduleName);`, options },
    { code: `const m = require('pg');`, options },
    { code: `export { x } from './x';`, options },
    { code: `export const y = 1;`, options },
  ],

  invalid: [
    {
      code: `import { S3Client } from '@aws-sdk/client-s3';`,
      options,
      errors: [error('@aws-sdk/client-s3')],
    },
    {
      code: `import type { S3Client } from '@aws-sdk/client-s3';`,
      options,
      errors: [error('@aws-sdk/client-s3')],
    },
    {
      code: `export * from '@azure/storage-blob';`,
      options,
      errors: [error('@azure/storage-blob')],
    },
    {
      code: `export { BlobClient } from '@azure/storage-blob';`,
      options,
      errors: [error('@azure/storage-blob')],
    },
    {
      code: `const m = await import('@aws-sdk/client-sqs');`,
      options,
      errors: [error('@aws-sdk/client-sqs')],
    },
    {
      code: 'const m = await import(`@aws-sdk/client-sqs`);',
      options,
      errors: [error('@aws-sdk/client-sqs')],
    },
    {
      code: `const AWS = require('aws-sdk');`,
      options,
      errors: [error('aws-sdk')],
    },
    {
      code: `const path = require.resolve('@aws-sdk/client-kms');`,
      options,
      errors: [error('@aws-sdk/client-kms')],
    },
    {
      code: `import AWS = require('aws-sdk');`,
      options,
      errors: [error('aws-sdk')],
    },
  ],
});
