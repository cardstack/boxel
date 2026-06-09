/**
 * Integration test for runtime JSON schema generation via
 * GetCardTypeSchemaCommand and /_run-command.
 *
 * Exercises the full chain: factory CLI → realm server → job queue →
 * prerenderer → headless Chrome → GetCardTypeSchemaCommand →
 * generateJsonSchemaForCardType()
 *
 * Uses the darkfactory-adopter test realm which has darkfactory.gts deployed
 * in the source realm (software-factory/).
 */

import { test } from './fixtures.ts';
import { expect } from '@playwright/test';

import { rri } from '@cardstack/runtime-common/realm-identifiers';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import { fetchCardTypeSchema } from '../src/darkfactory-schemas.ts';
import { buildTestClient } from './helpers/test-client.ts';

const GET_CARD_TYPE_SCHEMA_COMMAND =
  '@cardstack/boxel-host/commands/get-card-type-schema/default';

test('fetches Project schema via GetCardTypeSchemaCommand', async ({
  realm,
}) => {
  let realmServerUrl = realm.realmServerURL.href;
  // The darkfactory module lives in the source realm, not the test realm
  let sourceRealm = ensureTrailingSlash(
    new URL('software-factory/', realm.realmServerURL).href,
  );

  let { client, cleanup } = buildTestClient({
    realmUrl: sourceRealm,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let response = await client.runCommand(
      realmServerUrl,
      sourceRealm,
      GET_CARD_TYPE_SCHEMA_COMMAND,
      {
        codeRef: {
          module: `${sourceRealm}darkfactory`,
          name: 'Project',
        },
      },
    );

    expect(response.status).toBe('ready');
    expect(response.result).toBeTruthy();

    let parsed = JSON.parse(response.result!);
    // The result is a serialized JsonCard — schema is in data.attributes.json
    let schema = parsed?.data?.attributes?.json ?? parsed;

    expect(schema.attributes).toBeDefined();
    expect(schema.attributes.properties).toHaveProperty('projectName');
    expect(schema.attributes.properties).toHaveProperty('projectStatus');
    expect(schema.attributes.properties).toHaveProperty('objective');
    expect(schema.attributes.properties).toHaveProperty('scope');
  } finally {
    cleanup();
  }
});

test('fetches Issue schema with enum fields', async ({ realm }) => {
  let realmServerUrl = realm.realmServerURL.href;
  let sourceRealm = ensureTrailingSlash(
    new URL('software-factory/', realm.realmServerURL).href,
  );

  let { client, cleanup } = buildTestClient({
    realmUrl: sourceRealm,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let schema = await fetchCardTypeSchema(
      client,
      realmServerUrl,
      sourceRealm,
      {
        module: rri(`${sourceRealm}darkfactory`),
        name: 'Issue',
      },
    );

    expect(schema).toBeDefined();
    expect(schema!.attributes).toBeDefined();

    let attrs = schema!.attributes as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(attrs.properties).toHaveProperty('issueId');
    expect(attrs.properties).toHaveProperty('summary');
    expect(attrs.properties).toHaveProperty('status');
    expect(attrs.properties).toHaveProperty('priority');
  } finally {
    cleanup();
  }
});

test('fetches IssueTracker schema', async ({ realm }) => {
  let realmServerUrl = realm.realmServerURL.href;
  let sourceRealm = ensureTrailingSlash(
    new URL('software-factory/', realm.realmServerURL).href,
  );

  let { client, cleanup } = buildTestClient({
    realmUrl: sourceRealm,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let schema = await fetchCardTypeSchema(
      client,
      realmServerUrl,
      sourceRealm,
      {
        module: rri(`${sourceRealm}issue-tracker`),
        name: 'IssueTracker',
      },
    );

    expect(schema).toBeDefined();
    let attrs = schema!.attributes as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(attrs.properties).toHaveProperty('boardKey');
    expect(attrs.properties).toHaveProperty('boardTitle');
    expect(attrs.properties).toHaveProperty('hideEmptyColumns');
    expect(attrs.properties).toHaveProperty('placements');
  } finally {
    cleanup();
  }
});

test('fetches KnowledgeArticle schema', async ({ realm }) => {
  let realmServerUrl = realm.realmServerURL.href;
  let sourceRealm = ensureTrailingSlash(
    new URL('software-factory/', realm.realmServerURL).href,
  );

  let { client, cleanup } = buildTestClient({
    realmUrl: sourceRealm,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let schema = await fetchCardTypeSchema(
      client,
      realmServerUrl,
      sourceRealm,
      {
        module: rri(`${sourceRealm}darkfactory`),
        name: 'KnowledgeArticle',
      },
    );

    expect(schema).toBeDefined();
    let attrs = schema!.attributes as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(attrs.properties).toHaveProperty('articleTitle');
    expect(attrs.properties).toHaveProperty('content');
    expect(attrs.properties).toHaveProperty('tags');
  } finally {
    cleanup();
  }
});
