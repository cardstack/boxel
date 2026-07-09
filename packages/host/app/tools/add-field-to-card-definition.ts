import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import HostBaseTool from '../lib/host-base-tool';

import WriteTextFileTool from './write-text-file';

import type CardService from '../services/card-service';
import type NetworkService from '../services/network';
import type { FieldType } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

export default class AddFieldToCardDefinitionTool extends HostBaseTool<
  typeof BaseToolModule.AddFieldToCardDefinitionInput
> {
  @service declare private cardService: CardService;
  @service declare private network: NetworkService;

  static actionVerb = 'Add';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { AddFieldToCardDefinitionInput } = commandModule;
    return AddFieldToCardDefinitionInput;
  }

  requireInputFields = [
    'computedFieldFunctionSourceCode',
    'fieldName',
    'fieldRef',
    'fieldType',
  ];

  protected async run(
    input: BaseToolModule.AddFieldToCardDefinitionInput,
  ): Promise<undefined> {
    let moduleSource = (
      await this.cardService.getSource(input.cardDefinitionToModify.module)
    ).content;

    let moduleSyntax = new ModuleSyntax(
      moduleSource,
      input.cardDefinitionToModify.module,
      this.network.virtualNetwork,
    );

    moduleSyntax.addField({
      cardBeingModified: input.cardDefinitionToModify,
      fieldName: input.fieldName,
      fieldRef: input.fieldRef,
      fieldType: input.fieldType as FieldType,
      fieldDefinitionType: input.fieldDefinitionType as 'field' | 'card',
      incomingRelativeTo: input.incomingRelativeTo
        ? rri(input.incomingRelativeTo)
        : undefined,
      outgoingRelativeTo: input.outgoingRelativeTo
        ? new URL(input.outgoingRelativeTo)
        : undefined,
      outgoingRealmURL: input.outgoingRealmURL
        ? new URL(input.outgoingRealmURL)
        : undefined,
      addFieldAtIndex: input.addFieldAtIndex,
      computedFieldFunctionSourceCode: input.computedFieldFunctionSourceCode,
    });

    let writeTextFileCommand = new WriteTextFileTool(this.commandContext);
    await writeTextFileCommand.execute({
      content: moduleSyntax.code(),
      realm: input.realm,
      path: input.cardDefinitionToModify.module + '.gts',
      overwrite: true,
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { AddFieldToCardDefinitionTool as AddFieldToCardDefinitionCommand };
