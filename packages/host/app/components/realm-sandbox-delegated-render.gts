import { service } from '@ember/service';
import Component from '@glimmer/component';

import { consume } from 'ember-provide-consume-context';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import {
  CardCrudFunctionsContextName,
  DefaultFormatsContextName,
} from '@cardstack/runtime-common';

import type { CodeRef } from '@cardstack/runtime-common';

import RealmSandboxIframe from '@cardstack/host/components/realm-sandbox-iframe';
import RealmSandboxRender from '@cardstack/host/components/realm-sandbox-render';
import { CodePreviewSandboxContextName } from '@cardstack/host/lib/code-preview-sandbox';
import type CodePreviewSandbox from '@cardstack/host/lib/code-preview-sandbox';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type {
  BaseDef,
  CardCrudFunctions,
  FieldFormats,
  Format,
} from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    card?: BaseDef;
    model?: BaseDef;
    codeRef?: CodeRef;
    format?: Format;
    displayContainer?: boolean;
  };
}

// This is the trusted implementation behind delegatedCardRenderComponent.
// Base components can invoke the supplied component, but neither Base nor the
// authored card receives the RealmSandboxService or any host authority.
export default class RealmSandboxDelegatedRender extends Component<Signature> {
  @service declare private realmSandbox: RealmSandboxService;
  @consume(CardCrudFunctionsContextName)
  declare private cardCrudFunctions: CardCrudFunctions | undefined;
  @consume(DefaultFormatsContextName)
  declare private defaultFormats: FieldFormats | undefined;
  @consume(CodePreviewSandboxContextName)
  declare private codePreviewSandbox: CodePreviewSandbox | undefined;

  get effectiveFormat(): Format {
    return this.args.format ?? this.defaultFormats?.cardDef ?? 'isolated';
  }

  private get card(): BaseDef {
    let card = this.args.card ?? this.args.model;
    if (!card) {
      throw new Error('Delegated sandbox render requires a card or field');
    }
    return card;
  }

  get sandboxRender() {
    return this.realmSandbox.renderFor(this.card, this.effectiveFormat, {
      codePreviewSandbox: this.codePreviewSandbox,
      codeRef: this.args.codeRef,
    });
  }

  get sandboxRenderLoading() {
    return this.realmSandbox.isRenderLoading(this.card, this.effectiveFormat);
  }

  get iframeSandboxRender() {
    return this.realmSandbox.iframeRenderFor(this.card, this.effectiveFormat, {
      displayContainer: this.args.displayContainer,
      codeRef: this.args.codeRef,
      codePreviewSandbox: this.codePreviewSandbox,
    });
  }

  get viewCard() {
    return this.cardCrudFunctions?.viewCard;
  }

  <template>
    {{#if this.iframeSandboxRender}}
      <RealmSandboxIframe
        @format={{this.effectiveFormat}}
        @sandbox={{this.iframeSandboxRender}}
        @displayContainer={{@displayContainer}}
        ...attributes
      />
    {{else if this.sandboxRender}}
      <RealmSandboxRender
        @card={{this.card}}
        @format={{this.effectiveFormat}}
        @sandbox={{this.sandboxRender}}
        @model={{this.sandboxRender.model}}
        @displayContainer={{@displayContainer}}
        @viewCard={{this.viewCard}}
        ...attributes
      />
    {{else if this.sandboxRenderLoading}}
      <div
        class='realm-sandbox-loading'
        data-card-sandbox-loading
        ...attributes
      >
        <LoadingIndicator />
      </div>
    {{/if}}

    <style scoped>
      .realm-sandbox-loading {
        display: grid;
        place-items: center;
        width: 100%;
        min-height: 2.5rem;
      }
    </style>
  </template>
}
