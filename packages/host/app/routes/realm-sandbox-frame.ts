import Route from '@ember/routing/route';
import { service } from '@ember/service';

import { rri, type ResolvedCodeRef } from '@cardstack/runtime-common';

import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type { Format } from '@cardstack/base/card-api';

export interface RealmSandboxFrameModel {
  cardID: string;
  format: Format;
  parentOrigin: string;
  fieldName?: string;
  codeRef?: ResolvedCodeRef;
  displayContainer: boolean;
}

export default class RealmSandboxFrameRoute extends Route<RealmSandboxFrameModel> {
  @service declare private realmSandbox: RealmSandboxService;

  queryParams = {
    cardURL: { refreshModel: true },
    format: { refreshModel: true },
    parentOrigin: { refreshModel: true },
    fieldName: { refreshModel: true },
    componentModule: { refreshModel: true },
    componentName: { refreshModel: true },
    displayContainer: { refreshModel: true },
  } as const;

  model(params: {
    cardURL?: string;
    format?: string;
    parentOrigin?: string;
    fieldName?: string;
    componentModule?: string;
    componentName?: string;
    displayContainer?: string;
  }): RealmSandboxFrameModel {
    if (!this.realmSandbox.isIframeSandboxChild()) {
      throw new Error(
        'Realm iframe renderer must run on its configured origin',
      );
    }
    let cardURL = new URL(String(params.cardURL ?? ''));
    if (!['https:', 'http:'].includes(cardURL.protocol)) {
      throw new Error('Realm iframe renderer received an invalid card URL');
    }
    let parentOrigin = new URL(String(params.parentOrigin ?? '')).origin;
    let codeRef =
      params.componentModule && params.componentName
        ? {
            module: rri(params.componentModule),
            name: params.componentName,
          }
        : undefined;
    return {
      cardID: cardURL.href,
      format: this.realmSandbox.safeIframeFormat(params.format),
      parentOrigin,
      fieldName: params.fieldName,
      codeRef,
      displayContainer: params.displayContainer !== 'false',
    };
  }
}
