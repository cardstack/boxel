import { service } from '@ember/service';
import Component from '@glimmer/component';

import { provide, consume } from 'ember-provide-consume-context';

import { eq } from '@cardstack/boxel-ui/helpers';

import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import {
  CardContextName,
  CardCrudFunctionsContextName,
  DefaultFormatsContextName,
  CardURLContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  type getCard,
  type getCards,
  type getCardCollection,
} from '@cardstack/runtime-common';

import HeadFormatPreview from '@cardstack/host/components/head-format-preview';
import RealmSandboxCard from '@cardstack/host/components/realm-sandbox-card';
import RealmSandboxIframe from '@cardstack/host/components/realm-sandbox-iframe';
import RealmSandboxRender from '@cardstack/host/components/realm-sandbox-render';
import { CodePreviewSandboxContextName } from '@cardstack/host/lib/code-preview-sandbox';
import type CodePreviewSandbox from '@cardstack/host/lib/code-preview-sandbox';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type {
  BaseDef,
  CardCrudFunctions,
  Format,
  Field,
  CardContext,
} from '@cardstack/base/card-api';

interface Signature {
  Element: any;
  Args: {
    card: BaseDef;
    format?: Format;
    field?: Field;
    codeRef?: ResolvedCodeRef;
    displayContainer?: boolean;
  };
}

export default class CardRenderer extends Component<Signature> {
  @service declare private realmSandbox: RealmSandboxService;
  @consume(GetCardContextName) declare private getCard: getCard;
  @consume(GetCardsContextName) declare private getCards: getCards;
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;
  @consume(CardContextName) declare private cardContext: CardContext;
  @consume(CardCrudFunctionsContextName)
  declare private cardCrudFunctions: CardCrudFunctions | undefined;
  @consume(CodePreviewSandboxContextName)
  declare private codePreviewSandbox: CodePreviewSandbox | undefined;

  @provide(DefaultFormatsContextName)
  // @ts-ignore "defaultFormat is declared but not used"
  get defaultFormat() {
    let { format } = this.args;
    format = format ?? 'isolated';
    return { cardDef: format, fieldDef: format };
  }

  @provide(CardURLContextName)
  // @ts-ignore "cardURL is declared but not used"
  private get cardURL() {
    return 'id' in this.args.card
      ? (this.args.card?.id as string | undefined)
      : undefined;
  }

  <template>
    {{#if this.useSecurityProbeSandbox}}
      <RealmSandboxCard @card={{@card}} ...attributes />
    {{else if (eq @format 'head')}}
      <HeadFormatPreview
        @renderedCard={{this.renderedCard}}
        @cardURL={{this.cardURL}}
      />
    {{else if this.iframeSandboxRender}}
      <RealmSandboxIframe
        @format={{@format}}
        @sandbox={{this.iframeSandboxRender}}
        @displayContainer={{@displayContainer}}
        ...attributes
      />
    {{else if this.sandboxRender}}
      <RealmSandboxRender
        @card={{@card}}
        @format={{@format}}
        @sandbox={{this.sandboxRender}}
        @displayContainer={{@displayContainer}}
        @field={{@field}}
        @viewCard={{this.viewCard}}
        ...attributes
      />
    {{else}}
      <this.renderedCard
        @displayContainer={{@displayContainer}}
        ...attributes
      />
    {{/if}}
    {{#if this.usesRealmSandbox}}
      <span
        hidden
        data-card-sandbox-diagnostics
        data-card-sandbox-tier={{this.sandboxMetrics.executionTier}}
        data-card-sandbox-render-requests={{this.sandboxMetrics.renderRequests}}
        data-card-sandboxed={{this.sandboxMetrics.sandboxedCards}}
        data-card-sandbox-fallbacks={{this.sandboxMetrics.fallbackCards}}
        data-card-sandbox-principals={{this.sandboxMetrics.activePrincipals}}
        data-card-sandbox-template-hits={{this.sandboxMetrics.templateCacheHits}}
        data-card-sandbox-template-misses={{this.sandboxMetrics.templateCacheMisses}}
        data-card-sandbox-template-ms={{this.sandboxMetrics.templateCloneTimeMs}}
        data-card-sandbox-snapshot-ms={{this.sandboxMetrics.snapshotTimeMs}}
        data-card-sandbox-fallback-reasons={{this.sandboxFallbackReasons}}
        data-card-sandbox-omitted-fields={{this.sandboxOmittedFields}}
        data-card-sandbox-compartments={{this.sandboxMetrics.activeCompartments}}
        data-card-sandbox-code-preview-loaders={{this.sandboxMetrics.activeCodePreviewLoaders}}
        data-card-sandbox-code-preview-id={{this.codePreviewSandbox.id}}
        data-card-sandbox-code-preview-revision={{this.codePreviewSandbox.revision}}
        data-card-sandbox-worker-compartments={{this.sandboxMetrics.activeWorkerCompartments}}
        data-card-sandbox-compartment-rendered={{this.sandboxMetrics.compartmentRenderedCards}}
        data-card-sandbox-compartment-hits={{this.sandboxMetrics.compartmentTemplateCacheHits}}
        data-card-sandbox-compartment-misses={{this.sandboxMetrics.compartmentTemplateCacheMisses}}
        data-card-sandbox-compartment-ms={{this.sandboxMetrics.compartmentEvaluationTimeMs}}
        data-card-sandbox-compartment-errors={{this.sandboxCompartmentErrors}}
      ></span>
    {{/if}}
  </template>

  get renderedCard() {
    return this.args.card.constructor.getComponent(
      this.args.card,
      this.args.field,
      this.args.codeRef ? { componentCodeRef: this.args.codeRef } : undefined,
    );
  }

  get sandboxRender() {
    return this.realmSandbox.renderFor(this.args.card, this.args.format, {
      useBaseTemplate: this.useTrustedBaseTemplate,
      codePreviewSandbox: this.codePreviewSandbox,
    });
  }

  get iframeSandboxRender() {
    return this.realmSandbox.iframeRenderFor(this.args.card, this.args.format, {
      field: this.args.field,
      codeRef: this.args.codeRef,
      displayContainer: this.args.displayContainer,
      codePreviewSandbox: this.codePreviewSandbox,
    });
  }

  get viewCard() {
    return this.cardCrudFunctions?.viewCard;
  }

  get useTrustedBaseTemplate() {
    return Boolean(
      this.args.codeRef &&
      !this.realmSandbox.shouldUseOpaqueCard(this.args.codeRef),
    );
  }

  get sandboxMetrics() {
    this.realmSandbox.isTransparentSandboxEnabled();
    return this.realmSandbox.metricsSnapshot();
  }

  get usesRealmSandbox() {
    return this.realmSandbox.isOpaqueCard(this.args.card);
  }

  get sandboxFallbackReasons() {
    return JSON.stringify(this.sandboxMetrics.fallbackReasons);
  }

  get sandboxOmittedFields() {
    return JSON.stringify(this.sandboxMetrics.omittedFields);
  }

  get sandboxCompartmentErrors() {
    return JSON.stringify(this.sandboxMetrics.compartmentErrors);
  }

  get useSecurityProbeSandbox() {
    return this.realmSandbox.isSecurityProbe(this.args.card, this.args.format);
  }
}
