import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { provide, consume } from 'ember-provide-consume-context';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';
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
import RealmSandboxIframe from '@cardstack/host/components/realm-sandbox-iframe';
import RealmSandboxRender from '@cardstack/host/components/realm-sandbox-render';
import { CodePreviewSandboxContextName } from '@cardstack/host/lib/code-preview-sandbox';
import type CodePreviewSandbox from '@cardstack/host/lib/code-preview-sandbox';
import interactiveCodePreview from '@cardstack/host/resources/interactive-code-preview';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';
import type { RealmSandboxRender as RealmSandboxRenderEnvelope } from '@cardstack/host/services/realm-sandbox';

import type {
  BaseDef,
  CardCrudFunctions,
  Format,
  Field,
  CardContext,
  ViewCardFn,
} from '@cardstack/base/card-api';

interface Signature {
  Element: any;
  Args: {
    card: BaseDef;
    format?: Format;
    field?: Field;
    codeRef?: ResolvedCodeRef;
    displayContainer?: boolean;
    viewCard?: ViewCardFn;
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
  private interactivePreview = interactiveCodePreview(this, () => ({
    card: this.args.card,
    enabled: this.codePreviewSandbox == null,
  }));
  private sandboxRenderIDs = new WeakMap<object, number>();
  private nextSandboxRenderID = 0;
  private recentSandboxRenders: Array<{
    sandbox: RealmSandboxRenderEnvelope;
    format: Format;
  }> = [];
  private recentSandboxCard?: BaseDef;

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
    {{#if (eq @format 'head')}}
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
    {{else if this.hasSandboxRenderSlots}}
      {{#each this.sandboxRenderSlots key='key' as |slot|}}
        <div
          class='realm-sandbox-render-slot'
          data-realm-sandbox-render-slot={{slot.key}}
          data-realm-sandbox-render-slot-active={{if
            slot.active
            'true'
            'false'
          }}
          hidden={{if slot.active false true}}
          inert={{if slot.active false true}}
        >
          <RealmSandboxRender
            @card={{@card}}
            @format={{slot.format}}
            @sandbox={{slot.sandbox}}
            @displayContainer={{@displayContainer}}
            @field={{@field}}
            @viewCard={{this.viewCard}}
            ...attributes
          />
        </div>
      {{/each}}
    {{else if this.sandboxRenderLoading}}
      <div
        class='realm-sandbox-loading'
        data-card-sandbox-loading
        ...attributes
      >
        <LoadingIndicator />
      </div>
    {{else}}
      <this.renderedCard
        @displayContainer={{@displayContainer}}
        ...attributes
      />
    {{/if}}
    {{#if this.showSandboxDiagnostics}}
      <span
        hidden
        data-card-sandbox-diagnostics
        data-card-sandbox-tier={{this.sandboxMetrics.executionTier}}
        data-card-sandbox-reason={{this.sandboxMetrics.executionReason}}
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
        data-card-sandbox-code-preview-id={{this.effectiveCodePreviewSandbox.id}}
        data-card-sandbox-code-preview-revision={{this.effectiveCodePreviewSandbox.revision}}
        data-card-sandbox-compartment-rendered={{this.sandboxMetrics.compartmentRenderedCards}}
        data-card-sandbox-compartment-hits={{this.sandboxMetrics.compartmentTemplateCacheHits}}
        data-card-sandbox-compartment-misses={{this.sandboxMetrics.compartmentTemplateCacheMisses}}
        data-card-sandbox-compartment-ms={{this.sandboxMetrics.compartmentEvaluationTimeMs}}
        data-card-sandbox-compartment-errors={{this.sandboxCompartmentErrors}}
      ></span>
    {{/if}}

    <style scoped>
      .realm-sandbox-loading {
        display: grid;
        place-items: center;
        width: 100%;
        min-height: 10rem;
      }
      .realm-sandbox-render-slot:not([hidden]) {
        display: contents;
      }
    </style>
  </template>

  @cached get renderedCard() {
    return this.realmSandbox.componentFor(
      this.args.card,
      this.args.field,
      this.args.codeRef ? { componentCodeRef: this.args.codeRef } : undefined,
    );
  }

  @cached get sandboxRender() {
    return this.realmSandbox.renderFor(this.args.card, this.args.format, {
      useBaseTemplate: this.useTrustedBaseTemplate,
      codePreviewSandbox: this.effectiveCodePreviewSandbox,
      codeRef: this.args.codeRef,
    });
  }

  get sandboxRenderSlots() {
    if (this.recentSandboxCard !== this.args.card) {
      // The two-slot cache accelerates format switches for one card program.
      // A type-changing adoptsFrom edit replaces the opaque Store record; an
      // island belonging to that previous record is neither a reusable format
      // nor valid preview DOM, so evict it synchronously with the identity
      // change.
      // eslint-disable-next-line ember/no-side-effects
      this.recentSandboxCard = this.args.card;
      // eslint-disable-next-line ember/no-side-effects
      this.recentSandboxRenders = [];
    }
    let active = this.sandboxRender;
    if (!active) {
      return this.codePreviewSandbox
        ? this.recentSandboxRenders.map((entry, index) =>
            this.sandboxRenderSlot(entry.sandbox, entry.format, index === 0),
          )
        : [];
    }

    // Interact can render the same Store card in several places at once, so
    // its renderer stays single-slot. One mounted Code preview owns its
    // private sandbox and can safely retain two format islands locally.
    if (!this.codePreviewSandbox) {
      return [this.sandboxRenderSlot(active, this.args.format ?? 'isolated')];
    }

    // This is a non-reactive, component-local LRU. The reactive format/render
    // args are what invalidate this getter; updating the plain cache cannot
    // schedule another render or create a feedback loop.
    // eslint-disable-next-line ember/no-side-effects
    this.recentSandboxRenders = [
      { sandbox: active, format: this.args.format ?? 'isolated' },
      ...this.recentSandboxRenders.filter((entry) => entry.sandbox !== active),
    ].slice(0, 2);
    return this.recentSandboxRenders.map((entry) =>
      this.sandboxRenderSlot(
        entry.sandbox,
        entry.format,
        entry.sandbox === active,
      ),
    );
  }

  get hasSandboxRenderSlots() {
    return (
      this.sandboxRender != null ||
      (this.codePreviewSandbox != null && this.recentSandboxRenders.length > 0)
    );
  }

  private sandboxRenderSlot(
    sandbox: RealmSandboxRenderEnvelope,
    format: Format,
    active = true,
  ) {
    let key = this.sandboxRenderIDs.get(sandbox);
    if (key == null) {
      key = ++this.nextSandboxRenderID;
      this.sandboxRenderIDs.set(sandbox, key);
    }
    return { active, format, key: `ses-${key}`, sandbox };
  }

  get sandboxRenderLoading() {
    return this.realmSandbox.isRenderLoading(this.args.card, this.args.format);
  }

  @cached get iframeSandboxRender() {
    return this.realmSandbox.iframeRenderFor(this.args.card, this.args.format, {
      field: this.args.field,
      codeRef: this.args.codeRef,
      displayContainer: this.args.displayContainer,
      codePreviewSandbox: this.effectiveCodePreviewSandbox,
    });
  }

  private get effectiveCodePreviewSandbox() {
    return this.codePreviewSandbox ?? this.interactivePreview.preview;
  }

  get viewCard() {
    return this.args.viewCard ?? this.cardCrudFunctions?.viewCard;
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

  get showSandboxDiagnostics() {
    return isTesting() && this.usesRealmSandbox;
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
}
