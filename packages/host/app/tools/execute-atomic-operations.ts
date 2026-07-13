import { service } from '@ember/service';

import type { AtomicOperation } from '@cardstack/runtime-common/atomic-document';

import HostBaseTool from '../lib/host-base-tool';

import type CardService from '../services/card-service';
import type * as BaseToolModule from '@cardstack/base/command';

export default class ExecuteAtomicOperationsTool extends HostBaseTool<
  typeof BaseToolModule.ExecuteAtomicOperationsInput,
  typeof BaseToolModule.ExecuteAtomicOperationsResult
> {
  @service declare private cardService: CardService;

  description = 'Execute atomic operations against a realm';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ExecuteAtomicOperationsInput } = commandModule;
    return ExecuteAtomicOperationsInput;
  }

  requireInputFields = ['realmIdentifier', 'operations'];

  protected async run(
    input: BaseToolModule.ExecuteAtomicOperationsInput,
  ): Promise<BaseToolModule.ExecuteAtomicOperationsResult> {
    let commandModule = await this.loadToolModule();
    const { ExecuteAtomicOperationsResult } = commandModule;
    const results = await this.cardService.executeAtomicOperations(
      input.operations as AtomicOperation[],
      new URL(input.realmIdentifier),
    );
    const atomicResults = results['atomic:results'];
    if (!Array.isArray(atomicResults)) {
      const detail = (results as { errors?: Array<{ detail?: string }> })
        .errors?.[0]?.detail;
      throw new Error(detail ?? 'Atomic operations failed');
    }
    return new ExecuteAtomicOperationsResult({ results: atomicResults });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { ExecuteAtomicOperationsTool as ExecuteAtomicOperationsCommand };
