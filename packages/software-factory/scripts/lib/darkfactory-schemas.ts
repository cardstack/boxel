/**
 * JSON Schemas for DarkFactory card types (Project, Ticket, KnowledgeArticle).
 *
 * Provides two schema sources:
 *   1. Runtime — fetched via GetCardTypeSchemaCommand through the realm
 *      server's /run-command endpoint (authoritative, derived from card defs)
 *   2. Static fallbacks — hand-crafted from realm/darkfactory.gts, used when
 *      the realm server is unavailable or the command fails
 *
 * If the card definitions in darkfactory.gts change, update the static
 * fallbacks to match.
 */

import type {
  ResolvedCodeRef,
  LooseSingleCardDocument,
  Relationship,
} from '@cardstack/runtime-common';

import {
  runRealmCommand,
  ensureTrailingSlash,
  type RunCommandOptions,
} from './realm-operations';

// ---------------------------------------------------------------------------
// Runtime schema fetching
// ---------------------------------------------------------------------------

const GET_CARD_TYPE_SCHEMA_COMMAND =
  '@cardstack/boxel-host/commands/get-card-type-schema/default';

/**
 * Fetch the JSON schema for a single card type via the realm server's
 * prerenderer. Returns the schema (attributes + relationships) or
 * undefined on failure.
 */
export async function fetchCardTypeSchema(
  realmServerUrl: string,
  realmUrl: string,
  codeRef: ResolvedCodeRef,
  options: RunCommandOptions,
): Promise<
  | {
      attributes: Record<string, unknown>;
      relationships?: Record<string, unknown>;
    }
  | undefined
> {
  let response = await runRealmCommand(
    realmServerUrl,
    realmUrl,
    GET_CARD_TYPE_SCHEMA_COMMAND,
    { codeRef },
    options,
  );

  if (response.status !== 'ready' || !response.result) {
    console.warn(
      `[darkfactory-schemas] Failed to fetch schema for ${codeRef.module}#${codeRef.name}: ${response.error ?? response.status}`,
    );
    return undefined;
  }

  try {
    let parsed = JSON.parse(response.result);
    // The result is a serialized JsonCard; the schema is in the json field
    let schema = parsed?.data?.attributes?.json ?? parsed;
    return schema as {
      attributes: Record<string, unknown>;
      relationships?: Record<string, unknown>;
    };
  } catch {
    console.warn(
      `[darkfactory-schemas] Failed to parse schema for ${codeRef.module}#${codeRef.name}`,
    );
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Document builder
// ---------------------------------------------------------------------------

/**
 * Assemble a JSON:API card document from structured attributes and
 * relationships, with the correct `adoptsFrom` pointing to darkfactory
 * in the given realm.
 */
export function buildCardDocument(
  cardName: string,
  realmUrl: string,
  attributes: Record<string, unknown>,
  relationships?: Record<string, unknown>,
): LooseSingleCardDocument {
  let moduleUrl = `${ensureTrailingSlash(realmUrl)}darkfactory`;
  let doc: LooseSingleCardDocument = {
    data: {
      type: 'card',
      attributes,
      meta: {
        adoptsFrom: {
          module: moduleUrl,
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
