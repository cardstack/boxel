import { service } from '@ember/service';

import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import type { FieldType } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import WriteTextFileCommand from './write-text-file';

import type CardService from '../services/card-service';

export default class AddFieldToCardDefinitionCommand extends HostBaseCommand<
  typeof BaseCommandModule.AddFieldToCardDefinitionInput
> {
  @service declare private cardService: CardService;

  static actionVerb = 'Add';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
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
    input: BaseCommandModule.AddFieldToCardDefinitionInput,
  ): Promise<undefined> {
    let moduleSource = (
      await this.cardService.getSource(
        new URL(input.cardDefinitionToModify.module),
      )
    ).content;

    let moduleSyntax = new ModuleSyntax(
      moduleSource,
      new URL(input.cardDefinitionToModify.module),
    );

    moduleSyntax.addField({
      cardBeingModified: input.cardDefinitionToModify,
      fieldName: input.fieldName,
      fieldRef: input.fieldRef,
      fieldType: input.fieldType as FieldType,
      fieldDefinitionType: input.fieldDefinitionType as 'field' | 'card',
      incomingRelativeTo: input.incomingRelativeTo
        ? new URL(input.incomingRelativeTo)
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

    let writeTextFileCommand = new WriteTextFileCommand(this.commandContext);
    await writeTextFileCommand.execute({
      content: moduleSyntax.code(),
      realm: input.realm,
      path: input.cardDefinitionToModify.module + '.gts',
      overwrite: true,
    });
  }
}
