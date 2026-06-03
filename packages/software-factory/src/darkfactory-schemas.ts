/**
 * Runtime JSON schema fetching for card types via GetCardTypeSchemaCommand.
 *
 * Schemas are fetched through the realm server's `/_run-command` endpoint,
 * which enqueues a job that runs in the prerenderer's browser context where
 * CardAPI, Loader, and field mappings are available. This ensures schemas
 * are always derived from the actual card definitions.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type {
  ResolvedCodeRef,
  LooseSingleCardDocument,
  Relationship,
} from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common/realm-identifiers';

import { logger } from './logger';

// ---------------------------------------------------------------------------
// Runtime schema fetching
// ---------------------------------------------------------------------------

let log = logger('darkfactory-schemas');

const GET_CARD_TYPE_SCHEMA_COMMAND =
  '@cardstack/boxel-host/commands/get-card-type-schema/default';

/** Per-session cache so we never fetch the same schema twice. */
const schemaCache = new Map<
  string,
  {
    attributes: Record<string, unknown>;
    relationships?: Record<string, unknown>;
  }
>();

/**
 * Fetch the JSON schema for a single card type via the realm server's
 * prerenderer. Results are cached per `module#name` for the lifetime
 * of the process (one factory session). Returns the schema
 * (attributes + relationships) or undefined on failure.
 */
export async function fetchCardTypeSchema(
  client: BoxelCLIClient,
  realmServerUrl: string,
  realmUrl: string,
  codeRef: ResolvedCodeRef,
): Promise<
  | {
      attributes: Record<string, unknown>;
      relationships?: Record<string, unknown>;
    }
  | undefined
> {
  let cacheKey = `${codeRef.module}#${codeRef.name}`;
  let cached = schemaCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let response = await client.runCommand(
    realmServerUrl,
    realmUrl,
    GET_CARD_TYPE_SCHEMA_COMMAND,
    { codeRef },
  );

  if (response.status !== 'ready' || !response.result) {
    log.warn(
      `[darkfactory-schemas] Failed to fetch schema for ${cacheKey}: ${response.error ?? response.status}`,
    );
    return undefined;
  }

  try {
    let parsed = JSON.parse(response.result);
    // The result is a serialized JsonCard; the schema is in the json field
    let schema = parsed?.data?.attributes?.json ?? parsed;
    let result = schema as {
      attributes: Record<string, unknown>;
      relationships?: Record<string, unknown>;
    };
    schemaCache.set(cacheKey, result);
    return result;
  } catch {
    log.warn(`Failed to parse schema for ${cacheKey}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Document builder
// ---------------------------------------------------------------------------

/**
 * Assemble a JSON:API card document from structured attributes and
 * relationships, with the correct `adoptsFrom` pointing to the
 * darkfactory module (which lives in the software-factory realm,
 * NOT the target realm).
 */
export function buildCardDocument(
  cardName: string,
  darkfactoryModuleUrl: string,
  attributes: Record<string, unknown>,
  relationships?: Record<string, unknown>,
): LooseSingleCardDocument {
  let moduleUrl = darkfactoryModuleUrl;
  let doc: LooseSingleCardDocument = {
    data: {
      type: 'card',
      attributes,
      meta: {
        adoptsFrom: {
          module: rri(moduleUrl),
          name: cardName,
        },
      },
    },
  };
  if (relationships && Object.keys(relationships).length > 0) {
    doc.data.relationships = relationships as {
      [fieldName: string]: Relationship | Relationship[];
    };
  }
  return doc;
}
