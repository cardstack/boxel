interface SandboxModuleShimTarget {
  shimModule(moduleIdentifier: string, module: Record<string, unknown>): void;
}

export interface SandboxToolCapabilities {
  /**
   * Persist the one Boxel instance represented by this Sandbox process.
   * The parent still validates the serialized resource identity and owns the
   * canonical Store write; this callback carries no Store or loader authority.
   */
  saveCard(card: unknown, realm?: string): Promise<unknown>;
}

export interface SandboxToolCompatibility {
  /**
   * An opaque, child-local token. Authored code can pass it back to trusted
   * compatibility tools, but it contains no ambient Host authority itself.
   */
  toolContext: object;
}

/**
 * Creates the authority-free identity token synchronously, before the child
 * runtime handshake begins. The CardContext provider can therefore publish a
 * stable value from its first render instead of briefly exposing no command
 * context and depending on consumer recreation to observe the later token.
 */
export function createSandboxToolContext(): object {
  return Object.freeze({});
}

const hostToolModulePrefixes = [
  '@cardstack/boxel-host/commands/',
  '@cardstack/boxel-host/tools/',
  'https://packages/@cardstack/boxel-host/commands/',
  'https://packages/@cardstack/boxel-host/tools/',
] as const;

/**
 * Installs compatibility facades for trusted Boxel Host tools used by
 * deployed card code inside an origin-isolated Sandbox.
 *
 * The real Host tool classes are intentionally not loaded here: their
 * ToolContext leads to Ember services, Store, and authenticated networking.
 * Instead, the facade accepts only the opaque token returned from this
 * function and delegates to narrow capabilities whose parent-side receivers
 * perform their own authorization and identity checks.
 */
export function installSandboxToolCompatibilityModules(
  target: SandboxModuleShimTarget | readonly SandboxModuleShimTarget[],
  capabilities: SandboxToolCapabilities,
  toolContext = createSandboxToolContext(),
): SandboxToolCompatibility {
  let targets = Array.isArray(target) ? target : [target];

  class SaveCardTool {
    static actionVerb = 'Save';

    ignoreInputFields = ['cardInfo'];
    requireInputFields = ['card'];
    name = 'SaveCardTool';
    description = '';

    constructor(private readonly context: object) {}

    async execute(input: unknown): Promise<unknown> {
      if (this.context !== toolContext) {
        throw new Error(
          'Sandbox SaveCardTool requires the projected Boxel tool context',
        );
      }
      if (typeof input !== 'object' || input === null || !('card' in input)) {
        throw new Error('Sandbox SaveCardTool requires a card');
      }
      let realm =
        'realm' in input && typeof input.realm === 'string'
          ? input.realm
          : undefined;
      return capabilities.saveCard(input.card, realm);
    }
  }

  let saveCardModule = Object.freeze({
    default: SaveCardTool,
    SaveCardTool,
    // Deployed realm code still uses the pre-rename spelling.
    SaveCardCommand: SaveCardTool,
  });
  for (let prefix of hostToolModulePrefixes) {
    for (let target of targets) {
      target.shimModule(`${prefix}save-card`, saveCardModule);
    }
  }

  return { toolContext };
}
