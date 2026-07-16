import {
  Command,
  PlanBuilder,
  planModuleInstall,
  planInstanceInstall,
  logger,
} from '@cardstack/runtime-common';
import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import ExecuteAtomicOperationsCommand from '@cardstack/boxel-host/tools/execute-atomic-operations';

// 🧩 PATTERN: Transactional realm install via atomic operations.

const log = logger('catalog:install');

// === Input / Output card types ========================================

class InstallInput extends CardDef {
  @field listingId = contains(StringField);
  @field targetRealm = contains(StringField);
  @field modulePaths = contains(StringField); // JSON array string, simplified
  @field instancePaths = contains(StringField);
}

class InstallResult extends CardDef {
  @field installedModules = contains(StringField);
  @field installedInstances = contains(StringField);
}

// === The Command ======================================================

export default class InstallListingCommand extends Command<
  typeof InstallInput,
  typeof InstallResult
> {
  static actionVerb = 'Install';

  inputType = InstallInput;

  protected async run(input: InstallInput): Promise<InstallResult> {
    log.info(`Installing listing ${input.listingId} to ${input.targetRealm}`);

    const plan = new PlanBuilder();

    // (1) Plan each module copy.
    const modulePaths = JSON.parse(input.modulePaths ?? '[]') as string[];
    for (const path of modulePaths) {
      plan.add(
        planModuleInstall({
          from: input.listingId, // source realm root URL
          to: input.targetRealm,
          path: path, // relative module path
        }),
      );
    }

    // (2) Plan each instance copy.
    const instancePaths = JSON.parse(input.instancePaths ?? '[]') as string[];
    for (const path of instancePaths) {
      plan.add(
        planInstanceInstall({
          from: input.listingId,
          to: input.targetRealm,
          path: path,
        }),
      );
    }

    // (3) Execute atomically.
    log.info(`Plan has ${plan.size} operations`);
    const result = await new ExecuteAtomicOperationsCommand(
      this.commandContext,
    ).execute(plan.build());

    log.info(`Install complete: ${result.applied?.length ?? 0} ops applied`);

    return new InstallResult({
      installedModules: JSON.stringify(modulePaths),
      installedInstances: JSON.stringify(instancePaths),
    });
  }
}
