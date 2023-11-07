import { service } from '@ember/service';

import { Resource } from 'ember-resources';

import {
  type PossibleCardOrFieldClass,
  type BaseDeclaration,
} from '@cardstack/runtime-common/module-syntax';

import { type CardType } from '@cardstack/host/resources/card-type';

import { Ready as ReadyFile } from '@cardstack/host/resources/file';
import DeclarationsService from '@cardstack/host/services/declarations-service';

import { type BaseDef } from 'https://cardstack.com/base/card-api';

// an declaration should be (an item of focus within a module)
// - exported function or class
// - exported card or field
// - unexported card or field
// This declaration (in code mode) is extended to include the cardType and cardOrField
export type ModuleDeclaration =
  | (CardOrField & Partial<PossibleCardOrFieldClass>)
  | BaseDeclaration;

export interface CardOrField {
  cardType: CardType;
  cardOrField: typeof BaseDef;
}

export function isCardOrFieldDeclaration(
  declaration: ModuleDeclaration,
): declaration is CardOrField & Partial<PossibleCardOrFieldClass> {
  return (
    (declaration as CardOrField).cardType !== undefined &&
    (declaration as CardOrField).cardOrField !== undefined
  );
}

interface Args {
  named: { executableFile: ReadyFile };
}

export class ModuleContentsResource extends Resource<Args> {
  @service declare declarationsService: DeclarationsService;

  get isLoading() {
    return this.declarationsService.load.isRunning;
  }

  modify(_positional: never[], named: Args['named']) {
    let { executableFile } = named;
    console.log('loading module contents');
    this.declarationsService.load.perform(executableFile);
  }
}

export function moduleContentsResource(
  parent: object,
  args: () => Args['named'],
): ModuleContentsResource {
  return ModuleContentsResource.from(parent, () => ({
    named: args(),
  })) as unknown as ModuleContentsResource;
}
