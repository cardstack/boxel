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

// ---------------------------------------------------------------------------
// Realm-api tools (read/write/delete/search/sync/push/pull/etc.) are NOT
// registered here. They live in boxel-cli's `getToolDefinitions(...)` and
// are spread directly into the agent's FactoryTool[] in factory-tool-builder,
// wrapped with `enforceRealmSafety` at adoption time. The registry only owns
// subprocess-dispatched script tools — those go through ToolExecutor.execute
// for spawn / stdout capture / timeout.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private manifestsByName: Map<string, ToolManifest>;

  constructor(manifests?: ToolManifest[]) {
    // The default registry includes only the factory-defined script
    // manifests. Realm-api tools come from boxel-cli's getToolDefinitions
    // and are spread directly into the agent's tool list via
    // factory-tool-builder, not registered here.
    let allManifests = manifests ?? [...SCRIPT_TOOLS];
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
export { SCRIPT_TOOLS, type ToolArg, type ToolManifest };
