import type { ToolArg, ToolManifest } from './factory-agent';

// ---------------------------------------------------------------------------
// Built-in tool manifests
// ---------------------------------------------------------------------------
//
// Historical context: this registry used to expose three categories of
// agent-facing tools:
//
//   - `script` (search-realm, run-realm-tests) — kebab-case duplicates of
//     factory-builder tools (`search_realm`, `run_tests`); deleted as
//     redundant on both backends.
//   - `boxel-cli` (boxel-sync / boxel-push / boxel-pull / boxel-status /
//     boxel-create / boxel-history) — wrappers around the boxel CLI; the
//     orchestrator owns sync, the agent never legitimately needed these,
//     and they were never registered in the production wiring anyway.
//   - `realm-api` (realm-read / realm-write / realm-delete / realm-search
//     / realm-create) — HTTP-direct realm access; CS-10883 retires the
//     read/write/delete/search variants because the factory loop only
//     operates on the target realm via the workspace, and the agent now
//     uses native fs / `read_file` / `write_file` / `search_realm` for
//     that. Only `realm-create` survives — the entrypoint creates the
//     target realm via the registry executor before the agent runs.

const REALM_API_TOOLS: ToolManifest[] = [
  {
    name: 'realm-create',
    description:
      'Create a new realm on the realm server. Auth: realm server token.',
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
];

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private manifestsByName: Map<string, ToolManifest>;

  constructor(manifests?: ToolManifest[]) {
    let allManifests = manifests ?? [...REALM_API_TOOLS];
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

// Re-export the manifest array + types for testing.
export { REALM_API_TOOLS, type ToolArg, type ToolManifest };
