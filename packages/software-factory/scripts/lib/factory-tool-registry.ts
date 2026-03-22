import type { ToolArg, ToolManifest } from './factory-agent';

// ---------------------------------------------------------------------------
// Built-in tool manifests
// ---------------------------------------------------------------------------

const SCRIPT_TOOLS: ToolManifest[] = [
  {
    name: 'search-realm',
    description:
      'Search for cards in a realm by type, field values, and sort criteria.',
    category: 'script',
    outputFormat: 'json',
    args: [
      {
        name: 'realm',
        type: 'string',
        required: true,
        description: 'Target realm URL',
      },
      {
        name: 'type-name',
        type: 'string',
        required: false,
        description: 'Filter by card type name',
      },
      {
        name: 'type-module',
        type: 'string',
        required: false,
        description: 'Filter by card type module',
      },
      {
        name: 'eq',
        type: 'string',
        required: false,
        description: 'Equality filter as "field=value" (repeatable)',
      },
      {
        name: 'contains',
        type: 'string',
        required: false,
        description: 'Contains filter as "field=value" (repeatable)',
      },
      {
        name: 'sort',
        type: 'string',
        required: false,
        description: 'Sort as "field:direction" (repeatable)',
      },
      {
        name: 'size',
        type: 'number',
        required: false,
        description: 'Page size',
      },
      {
        name: 'page',
        type: 'number',
        required: false,
        description: 'Page number',
      },
    ],
  },
  {
    name: 'pick-ticket',
    description: 'Find tickets by status, priority, project, or agent.',
    category: 'script',
    outputFormat: 'json',
    args: [
      {
        name: 'realm',
        type: 'string',
        required: true,
        description: 'Target realm URL',
      },
      {
        name: 'status',
        type: 'string',
        required: false,
        description:
          'Comma-separated status filter (default: backlog,in_progress,review)',
      },
      {
        name: 'project',
        type: 'string',
        required: false,
        description: 'Filter by project ID',
      },
      {
        name: 'agent',
        type: 'string',
        required: false,
        description: 'Filter by assigned agent ID',
      },
      {
        name: 'module',
        type: 'string',
        required: false,
        description: 'Ticket schema module URL',
      },
    ],
  },
  {
    name: 'get-session',
    description:
      'Generate authenticated browser session tokens for realm access.',
    category: 'script',
    outputFormat: 'json',
    args: [
      {
        name: 'realm',
        type: 'string',
        required: false,
        description: 'Specific realm URL to include (repeatable)',
      },
    ],
  },
  {
    name: 'run-realm-tests',
    description:
      'Execute Playwright tests in an isolated scratch realm with fixture setup and teardown.',
    category: 'script',
    outputFormat: 'json',
    args: [
      {
        name: 'realm-path',
        type: 'string',
        required: false,
        description: 'Source realm directory',
      },
      {
        name: 'realm-url',
        type: 'string',
        required: false,
        description: 'Source realm URL',
      },
      {
        name: 'spec-dir',
        type: 'string',
        required: false,
        description: 'Test directory (default: tests)',
      },
      {
        name: 'fixtures-dir',
        type: 'string',
        required: false,
        description: 'Fixtures directory (default: tests/fixtures)',
      },
      {
        name: 'endpoint',
        type: 'string',
        required: false,
        description: 'Realm endpoint name',
      },
      {
        name: 'scratch-root',
        type: 'string',
        required: false,
        description: 'Base dir for test realms',
      },
    ],
  },
];

const BOXEL_CLI_TOOLS: ToolManifest[] = [
  {
    name: 'boxel-sync',
    description: 'Bidirectional sync between local workspace and realm server.',
    category: 'boxel-cli',
    outputFormat: 'text',
    args: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Local workspace path',
      },
      {
        name: 'prefer',
        type: 'string',
        required: false,
        description: 'Conflict strategy: "local", "remote", or "newest"',
      },
      {
        name: 'dry-run',
        type: 'boolean',
        required: false,
        description: 'Preview only, no changes',
      },
    ],
  },
  {
    name: 'boxel-push',
    description: 'One-way upload from local directory to realm.',
    category: 'boxel-cli',
    outputFormat: 'text',
    args: [
      {
        name: 'local-dir',
        type: 'string',
        required: true,
        description: 'Local directory path',
      },
      {
        name: 'realm-url',
        type: 'string',
        required: true,
        description: 'Target realm URL',
      },
      {
        name: 'delete',
        type: 'boolean',
        required: false,
        description: 'Remove orphaned remote files',
      },
      {
        name: 'dry-run',
        type: 'boolean',
        required: false,
        description: 'Preview only, no changes',
      },
    ],
  },
  {
    name: 'boxel-pull',
    description: 'One-way download from realm to local directory.',
    category: 'boxel-cli',
    outputFormat: 'text',
    args: [
      {
        name: 'realm-url',
        type: 'string',
        required: true,
        description: 'Source realm URL',
      },
      {
        name: 'local-dir',
        type: 'string',
        required: true,
        description: 'Local directory path',
      },
      {
        name: 'delete',
        type: 'boolean',
        required: false,
        description: 'Delete local files not on remote',
      },
      {
        name: 'dry-run',
        type: 'boolean',
        required: false,
        description: 'Preview only, no changes',
      },
    ],
  },
  {
    name: 'boxel-status',
    description: 'Check sync status of a workspace.',
    category: 'boxel-cli',
    outputFormat: 'text',
    args: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Local workspace path',
      },
      {
        name: 'all',
        type: 'boolean',
        required: false,
        description: 'Check all workspaces',
      },
      {
        name: 'pull',
        type: 'boolean',
        required: false,
        description: 'Auto-pull remote changes',
      },
    ],
  },
  {
    name: 'boxel-create',
    description: 'Create a new workspace/realm endpoint.',
    category: 'boxel-cli',
    outputFormat: 'text',
    args: [
      {
        name: 'endpoint',
        type: 'string',
        required: true,
        description: 'Endpoint type',
      },
      {
        name: 'name',
        type: 'string',
        required: true,
        description: 'Workspace name',
      },
    ],
  },
  {
    name: 'boxel-history',
    description: 'View or create checkpoints for a workspace.',
    category: 'boxel-cli',
    outputFormat: 'text',
    args: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Local workspace path',
      },
      {
        name: 'message',
        type: 'string',
        required: false,
        description: 'Checkpoint message',
      },
    ],
  },
];

const REALM_API_TOOLS: ToolManifest[] = [
  {
    name: 'realm-read',
    description: 'Fetch a card or file from a realm.',
    category: 'realm-api',
    outputFormat: 'json',
    args: [
      {
        name: 'realm-url',
        type: 'string',
        required: true,
        description: 'Realm base URL',
      },
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Card or file path within the realm',
      },
      {
        name: 'accept',
        type: 'string',
        required: false,
        description:
          'Accept header. Default: application/vnd.card+source (raw source — path MUST include file extension, e.g. CardDef/my-card.gts). ' +
          'Use application/vnd.card+json for computed card instances with resolved fields (path must NOT include extension, e.g. Card/instance).',
      },
    ],
  },
  {
    name: 'realm-write',
    description: 'Create or update a card or file in a realm.',
    category: 'realm-api',
    outputFormat: 'json',
    args: [
      {
        name: 'realm-url',
        type: 'string',
        required: true,
        description: 'Realm base URL',
      },
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Card or file path within the realm',
      },
      {
        name: 'content',
        type: 'string',
        required: true,
        description: 'File content to write',
      },
      {
        name: 'content-type',
        type: 'string',
        required: false,
        description:
          'Content-Type header (default: application/vnd.card+source)',
      },
    ],
  },
  {
    name: 'realm-delete',
    description: 'Delete a card or file from a realm.',
    category: 'realm-api',
    outputFormat: 'json',
    args: [
      {
        name: 'realm-url',
        type: 'string',
        required: true,
        description: 'Realm base URL',
      },
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Card or file path to delete',
      },
    ],
  },
  {
    name: 'realm-atomic',
    description: 'Batch operations that succeed or fail atomically.',
    category: 'realm-api',
    outputFormat: 'json',
    args: [
      {
        name: 'realm-url',
        type: 'string',
        required: true,
        description: 'Realm base URL',
      },
      {
        name: 'operations',
        type: 'string',
        required: true,
        description:
          'JSON array of operations: [{"op":"add|update|remove","href":"...","data":{...}}]',
      },
    ],
  },
  {
    name: 'realm-search',
    description: 'Search for cards using structured queries.',
    category: 'realm-api',
    outputFormat: 'json',
    args: [
      {
        name: 'realm-url',
        type: 'string',
        required: true,
        description: 'Realm base URL',
      },
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'JSON search query object',
      },
    ],
  },
  {
    name: 'realm-create',
    description: 'Create a new realm on the realm server.',
    category: 'realm-api',
    outputFormat: 'json',
    args: [
      {
        name: 'realm-server-url',
        type: 'string',
        required: true,
        description: 'Realm server base URL',
      },
      {
        name: 'name',
        type: 'string',
        required: true,
        description: 'Display name for the new realm',
      },
      {
        name: 'endpoint',
        type: 'string',
        required: true,
        description:
          'URL path segment for the new realm (e.g. "user/my-realm")',
      },
      {
        name: 'iconURL',
        type: 'string',
        required: false,
        description:
          'Icon URL for the realm. Defaults to a letter-based icon derived from the realm name.',
      },
      {
        name: 'backgroundURL',
        type: 'string',
        required: false,
        description:
          'Background image URL for the realm. Defaults to a random background image.',
      },
    ],
  },
  {
    name: 'realm-server-session',
    description:
      'Obtain a realm server JWT for management operations. Returns the JWT in the output.',
    category: 'realm-api',
    outputFormat: 'json',
    args: [
      {
        name: 'realm-server-url',
        type: 'string',
        required: true,
        description: 'Realm server base URL',
      },
      {
        name: 'openid-token',
        type: 'string',
        required: true,
        description:
          'OpenID access_token obtained from the Matrix server via /openid/request_token',
      },
    ],
  },
  {
    name: 'realm-auth',
    description:
      'Get per-realm JWTs for all realms accessible to the authenticated user.',
    category: 'realm-api',
    outputFormat: 'json',
    args: [
      {
        name: 'realm-server-url',
        type: 'string',
        required: true,
        description: 'Realm server base URL',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private manifestsByName: Map<string, ToolManifest>;

  constructor(manifests?: ToolManifest[]) {
    let allManifests = manifests ?? [
      ...SCRIPT_TOOLS,
      ...BOXEL_CLI_TOOLS,
      ...REALM_API_TOOLS,
    ];
    let map = new Map<string, ToolManifest>();
    for (let manifest of allManifests) {
      if (map.has(manifest.name)) {
        throw new Error(
          `Duplicate tool manifest name "${manifest.name}" detected in ToolRegistry`,
        );
      }
      map.set(manifest.name, manifest);
    }
    this.manifestsByName = map;
  }

  /** Return all registered tool manifests. */
  getManifests(): ToolManifest[] {
    return [...this.manifestsByName.values()];
  }

  /** Look up a single manifest by tool name. Returns undefined if not found. */
  getManifest(name: string): ToolManifest | undefined {
    return this.manifestsByName.get(name);
  }

  /** Check if a tool name is registered. */
  has(name: string): boolean {
    return this.manifestsByName.has(name);
  }

  /** Number of registered tools. */
  get size(): number {
    return this.manifestsByName.size;
  }

  /**
   * Validate that a tool invocation's arguments satisfy the manifest.
   * Returns an array of error messages (empty if valid).
   */
  validateArgs(
    toolName: string,
    toolArgs: Record<string, unknown> | undefined,
  ): string[] {
    let manifest = this.manifestsByName.get(toolName);
    if (!manifest) {
      return [`Unknown tool: "${toolName}"`];
    }

    let errors: string[] = [];
    let requiredArgs = manifest.args.filter((a) => a.required);

    for (let arg of requiredArgs) {
      let value = toolArgs?.[arg.name];
      let isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '');
      if (isEmpty) {
        errors.push(
          `Missing required argument "${arg.name}" for tool "${toolName}"`,
        );
      }
    }

    return errors;
  }
}

// ---------------------------------------------------------------------------
// Convenience: default registry singleton
// ---------------------------------------------------------------------------

let _defaultRegistry: ToolRegistry | undefined;

export function getDefaultToolRegistry(): ToolRegistry {
  if (!_defaultRegistry) {
    _defaultRegistry = new ToolRegistry();
  }
  return _defaultRegistry;
}

// Re-export the built-in manifest arrays for testing
export {
  SCRIPT_TOOLS,
  BOXEL_CLI_TOOLS,
  REALM_API_TOOLS,
  type ToolArg,
  type ToolManifest,
};
