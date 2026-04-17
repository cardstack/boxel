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

import { test } from './fixtures';
import { expect } from '@playwright/test';

import { fetchCardTypeSchema } from '../src/darkfactory-schemas';
import { sourceRealmURLFor } from '../src/harness/shared';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { buildTestClient } from './helpers/test-client';

const GET_CARD_TYPE_SCHEMA_COMMAND =
  '@cardstack/boxel-host/commands/get-card-type-schema/default';

test('fetches Project schema via GetCardTypeSchemaCommand', async ({
  realm,
}) => {
  let realmServerUrl = realm.realmServerURL.href;
  // The darkfactory module lives in the source realm, not the test realm
  let sourceRealmUrl = ensureTrailingSlash(
    sourceRealmURLFor(realm.realmServerURL).href,
  );

  let { client, cleanup } = buildTestClient({
    realmUrl: sourceRealmUrl,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let response = await client.runCommand(
      realmServerUrl,
      sourceRealmUrl,
      GET_CARD_TYPE_SCHEMA_COMMAND,
      {
        codeRef: {
          module: `${sourceRealmUrl}darkfactory`,
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
  let sourceRealmUrl = ensureTrailingSlash(
    sourceRealmURLFor(realm.realmServerURL).href,
  );

  let { client, cleanup } = buildTestClient({
    realmUrl: sourceRealmUrl,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let schema = await fetchCardTypeSchema(
      client,
      realmServerUrl,
      sourceRealmUrl,
      { module: `${sourceRealmUrl}darkfactory`, name: 'Issue' },
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

test('fetches KnowledgeArticle schema', async ({ realm }) => {
  let realmServerUrl = realm.realmServerURL.href;
  let sourceRealmUrl = ensureTrailingSlash(
    sourceRealmURLFor(realm.realmServerURL).href,
  );

  let { client, cleanup } = buildTestClient({
    realmUrl: sourceRealmUrl,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let schema = await fetchCardTypeSchema(
      client,
      realmServerUrl,
      sourceRealmUrl,
      { module: `${sourceRealmUrl}darkfactory`, name: 'KnowledgeArticle' },
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
