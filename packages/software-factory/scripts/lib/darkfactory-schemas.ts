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

import type { ResolvedCodeRef } from '@cardstack/runtime-common';

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
// Relationship schema helpers (for static fallbacks)
// ---------------------------------------------------------------------------

const LINKS_TO_SCHEMA = {
  type: 'object',
  properties: {
    links: {
      type: 'object',
      properties: {
        self: {
          type: ['string', 'null'],
          description:
            'Card URL (e.g., "https://realm.example/AgentProfile/agent-1"), or null to unlink',
        },
      },
      required: ['self'],
    },
  },
  required: ['links'],
} as const;

function linksToMany(description: string) {
  return {
    type: 'array',
    description,
    items: LINKS_TO_SCHEMA,
  } as const;
}

// ---------------------------------------------------------------------------
// Static fallback schemas
// ---------------------------------------------------------------------------

export const projectAttributesSchema = {
  type: 'object',
  description: 'Project card field values (all fields optional for updates)',
  properties: {
    projectCode: {
      type: 'string',
      description: 'Short project code (e.g., "STICKY-MVP")',
    },
    projectName: {
      type: 'string',
      description: 'Human-readable project name',
    },
    projectStatus: {
      type: 'string',
      enum: ['planning', 'active', 'on_hold', 'completed', 'archived'],
      description: 'Current project status',
    },
    deadline: {
      type: 'string',
      format: 'date',
      description: 'Project deadline (ISO date, e.g., "2025-06-01")',
    },
    objective: {
      type: 'string',
      description: 'Project objective (plain text)',
    },
    scope: { type: 'string', description: 'Project scope (Markdown)' },
    technicalContext: {
      type: 'string',
      description: 'Technical context and constraints (Markdown)',
    },
    successCriteria: {
      type: 'string',
      description: 'Success criteria (Markdown)',
    },
    risks: { type: 'string', description: 'Known risks (Markdown)' },
    testArtifactsRealmUrl: {
      type: 'string',
      description: 'URL to the test artifacts realm',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'Creation timestamp (ISO 8601)',
    },
  },
} as const;

export const projectRelationshipsSchema = {
  type: 'object',
  description: 'Project card relationships',
  properties: {
    knowledgeBase: linksToMany('Links to KnowledgeArticle cards'),
    teamAgents: linksToMany('Links to AgentProfile cards'),
  },
} as const;

export const ticketAttributesSchema = {
  type: 'object',
  description: 'Ticket card field values (all fields optional for updates)',
  properties: {
    ticketId: {
      type: 'string',
      description: 'Ticket identifier (e.g., "STICKY-1")',
    },
    summary: { type: 'string', description: 'Short ticket summary' },
    description: {
      type: 'string',
      description: 'Detailed ticket description (Markdown)',
    },
    ticketType: {
      type: 'string',
      enum: ['feature', 'bug', 'task', 'research', 'infrastructure'],
      description: 'Ticket type',
    },
    status: {
      type: 'string',
      enum: ['backlog', 'in_progress', 'blocked', 'review', 'done'],
      description: 'Current ticket status',
    },
    priority: {
      type: 'string',
      enum: ['critical', 'high', 'medium', 'low'],
      description: 'Ticket priority',
    },
    acceptanceCriteria: {
      type: 'string',
      description: 'Acceptance criteria (Markdown)',
    },
    agentNotes: {
      type: 'string',
      description: 'Implementation notes from the agent (Markdown)',
    },
    estimatedHours: {
      type: 'number',
      description: 'Estimated hours to complete',
    },
    actualHours: { type: 'number', description: 'Actual hours spent' },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'Creation timestamp (ISO 8601)',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Last update timestamp (ISO 8601)',
    },
  },
} as const;

export const ticketRelationshipsSchema = {
  type: 'object',
  description: 'Ticket card relationships',
  properties: {
    project: {
      ...LINKS_TO_SCHEMA,
      description: 'Link to the parent Project card',
    },
    assignedAgent: {
      ...LINKS_TO_SCHEMA,
      description: 'Link to the assigned AgentProfile card',
    },
    relatedTickets: linksToMany('Links to related Ticket cards'),
    relatedKnowledge: linksToMany('Links to related KnowledgeArticle cards'),
  },
} as const;

export const knowledgeArticleAttributesSchema = {
  type: 'object',
  description:
    'KnowledgeArticle card field values (all fields optional for updates)',
  properties: {
    articleTitle: { type: 'string', description: 'Article title' },
    articleType: {
      type: 'string',
      enum: [
        'architecture',
        'decision',
        'runbook',
        'context',
        'api',
        'onboarding',
      ],
      description: 'Type of knowledge article',
    },
    content: { type: 'string', description: 'Article content (Markdown)' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tags for categorization',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Last update timestamp (ISO 8601)',
    },
  },
} as const;

export const knowledgeArticleRelationshipsSchema = {
  type: 'object',
  description: 'KnowledgeArticle card relationships',
  properties: {
    lastUpdatedBy: {
      ...LINKS_TO_SCHEMA,
      description: 'Link to the AgentProfile that last updated this article',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Static fallback map
// ---------------------------------------------------------------------------

export const STATIC_FALLBACK_SCHEMAS: Record<
  string,
  {
    attributes: Record<string, unknown>;
    relationships: Record<string, unknown>;
  }
> = {
  Project: {
    attributes: projectAttributesSchema,
    relationships: projectRelationshipsSchema,
  },
  Ticket: {
    attributes: ticketAttributesSchema,
    relationships: ticketRelationshipsSchema,
  },
  KnowledgeArticle: {
    attributes: knowledgeArticleAttributesSchema,
    relationships: knowledgeArticleRelationshipsSchema,
  },
};

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
): {
  data: {
    type: string;
    attributes: Record<string, unknown>;
    relationships?: Record<string, unknown>;
    meta: { adoptsFrom: { module: string; name: string } };
  };
} {
  let moduleUrl = `${ensureTrailingSlash(realmUrl)}darkfactory`;
  let doc: {
    data: {
      type: string;
      attributes: Record<string, unknown>;
      relationships?: Record<string, unknown>;
      meta: { adoptsFrom: { module: string; name: string } };
    };
  } = {
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
    doc.data.relationships = relationships;
  }
  return doc;
}
