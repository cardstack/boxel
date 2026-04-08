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

import {
  runRealmCommand,
  ensureTrailingSlash,
} from '../scripts/lib/realm-operations';
import { fetchCardTypeSchema } from '../scripts/lib/darkfactory-schemas';
import { sourceRealmURLFor } from '../src/harness/shared';

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

  let response = await runRealmCommand(
    realmServerUrl,
    sourceRealmUrl,
    GET_CARD_TYPE_SCHEMA_COMMAND,
    {
      codeRef: {
        module: `${sourceRealmUrl}darkfactory`,
        name: 'Project',
      },
    },
    { authorization: `Bearer ${realm.ownerBearerToken}` },
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
});

test('fetches Ticket schema with enum fields', async ({ realm }) => {
  let realmServerUrl = realm.realmServerURL.href;
  let sourceRealmUrl = ensureTrailingSlash(
    sourceRealmURLFor(realm.realmServerURL).href,
  );

  let schema = await fetchCardTypeSchema(
    realmServerUrl,
    sourceRealmUrl,
    { module: `${sourceRealmUrl}darkfactory`, name: 'Ticket' },
    { authorization: `Bearer ${realm.ownerBearerToken}` },
  );

  expect(schema).toBeDefined();
  expect(schema!.attributes).toBeDefined();

  let attrs = schema!.attributes as {
    properties: Record<string, Record<string, unknown>>;
  };
  expect(attrs.properties).toHaveProperty('ticketId');
  expect(attrs.properties).toHaveProperty('summary');
  expect(attrs.properties).toHaveProperty('status');
  expect(attrs.properties).toHaveProperty('priority');
});

test('fetches KnowledgeArticle schema', async ({ realm }) => {
  let realmServerUrl = realm.realmServerURL.href;
  let sourceRealmUrl = ensureTrailingSlash(
    sourceRealmURLFor(realm.realmServerURL).href,
  );

  let schema = await fetchCardTypeSchema(
    realmServerUrl,
    sourceRealmUrl,
    { module: `${sourceRealmUrl}darkfactory`, name: 'KnowledgeArticle' },
    { authorization: `Bearer ${realm.ownerBearerToken}` },
  );

  expect(schema).toBeDefined();
  let attrs = schema!.attributes as {
    properties: Record<string, Record<string, unknown>>;
  };
  expect(attrs.properties).toHaveProperty('articleTitle');
  expect(attrs.properties).toHaveProperty('content');
  expect(attrs.properties).toHaveProperty('tags');
});
