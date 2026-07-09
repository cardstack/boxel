import {
  baseRealm,
  getClass,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  basicMappings,
  generateJsonSchemaForCardType,
} from '@cardstack/runtime-common/helpers/ai';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

export default class GetCardTypeSchemaTool extends HostBaseTool<
  typeof BaseToolModule.CardTypeSchemaInput,
  typeof BaseToolModule.JsonCard
> {
  static actionVerb = 'Generate';
  description = 'Generate JSON schema for a card type definition';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.CardTypeSchemaInput;
  }

  requireInputFields = ['codeRef'];

  protected async run(
    input: BaseToolModule.CardTypeSchemaInput,
  ): Promise<BaseToolModule.JsonCard> {
    let codeRef = input.codeRef as unknown as ResolvedCodeRef;
    if (!codeRef?.module || !codeRef?.name) {
      throw new Error('codeRef must be a ResolvedCodeRef with module and name');
    }

    let loader = this.loaderService.loader;
    let CardClass = await getClass(codeRef, loader);
    if (!CardClass) {
      throw new Error(
        `Export "${codeRef.name}" not found in module "${codeRef.module}"`,
      );
    }

    let cardApi = await loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`,
    );
    let mappings = await basicMappings(loader);
    let schema = generateJsonSchemaForCardType(
      CardClass as typeof CardAPI.CardDef,
      cardApi,
      mappings,
    );

    let commandModule = await this.loadToolModule();
    return new commandModule.JsonCard({ json: schema });
  }
}
