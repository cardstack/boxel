import { setComponentTemplate } from '@ember/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { isDestroyed, isDestroying } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { precompileTemplate } from '@ember/template-compilation';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';

import TriangleAlert from '@cardstack/boxel-icons/triangle-alert';

import { consume } from 'ember-provide-consume-context';

import { CardContainer } from '@cardstack/boxel-ui/components';

import {
  RealmPaths,
  CardContextName,
  type PrerenderedCardLike,
  type PrerenderedCardData,
  type PrerenderedCardComponentSignature,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import type { CardContext, CardDef } from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import { type HTMLComponent, htmlComponent } from '../lib/html-component';
// `knownFileMetaUrls` lives in `lib/` so non-component code (e.g.
// `lib/stack-item.ts`) can read it without importing a component file. We
// re-export here for back-compat with existing call sites that imported it
// from this module.
import {
  knownFileMetaUrls,
  clearKnownFileMetaUrls,
} from '../lib/known-file-meta-urls';
import { getLivePrerenderedSearch } from '../resources/live-prerendered-search';
import { getPrerenderedSearch } from '../resources/prerendered-search';
import { getSearch } from '../resources/search';

export { knownFileMetaUrls, clearKnownFileMetaUrls };

const OWNER_DESTROYED_ERROR =
  "Cannot call `.lookup('renderer:-dom')` after the owner has been destroyed";

export class PrerenderedCard implements PrerenderedCardLike {
  component: HTMLComponent;
  constructor(
    public data: PrerenderedCardData,
    cardComponentModifier?: CardContext['cardComponentModifier'],
  ) {
    if (data.isFileMeta) {
      knownFileMetaUrls.add(data.url);
    }
    if (data.isError && !data.html) {
      this.component = wrapWithModifier(
        getErrorComponent(data.realmUrl, data.url),
        cardComponentModifier,
        data.url,
      );
    } else {
      let extraAttributes: Record<string, string> = {};
      if (data.isError) {
        extraAttributes['data-is-error'] = 'true';
      }
      if (data.cardType) {
        // Expose the prerendered card's type display name so consumers (e.g.
        // OperatorModeOverlays) can label the card before its CardDef is
        // loaded into the store.
        extraAttributes['data-card-type-display-name'] = data.cardType;
      }
      this.component = wrapWithModifier(
        htmlComponent(data.html, extraAttributes),
        cardComponentModifier,
        data.url,
      );
    }
  }
  get url() {
    return this.data.url;
  }
  get isError() {
    return this.data.isError;
  }
  get realmUrl(): string {
    return this.data.realmUrl;
  }
  get cardType(): string | undefined {
    return this.data.cardType;
  }
  get iconHtml(): string | undefined {
    return this.data.iconHtml;
  }
  get usedRenderType(): ResolvedCodeRef | undefined {
    return this.data.usedRenderType;
  }
  // True iff the prerender pipeline produced HTML for this row. Currently
  // false for executable-module FileDef rows (`.gts`/`.ts`) because the
  // fused visit skips the FileRender pass when `isModule` is true — see
  // CS-11171. CardList consults this to render a filename fallback so the
  // user can still see and click the row through to interact-mode.
  get hasHtml(): boolean {
    return typeof this.data.html === 'string' && this.data.html.length > 0;
  }
}
function getErrorComponent(realmURL: string, url: string) {
  let name = new RealmPaths(new URL(realmURL)).local(new URL(url));
  const DefaultErrorResultComponent: TemplateOnlyComponent<{
    Element: HTMLDivElement;
  }> = <template>
    <CardContainer
      class='card instance-error'
      @displayBoundaries={{true}}
      data-test-instance-error={{true}}
      data-test-card={{url}}
      ...attributes
    >
      <div class='error'>
        <div class='thumbnail'>
          <TriangleAlert />
        </div>
        <div class='name' data-test-instance-error-name>{{name}}</div>
      </div>
    </CardContainer>
    <style scoped>
      .error {
        display: flex;
        align-content: flex-start;
        justify-content: center;
        padding: var(--boxel-sp-xs);
        flex-wrap: wrap;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .thumbnail {
        display: flex;
        justify-content: center;
        align-items: center;
        height: calc(100% - 64.35px);
      }
      .name {
        width: 100%;
        text-align: center;
        font: 500 var(--boxel-font-sm);
        line-height: 1.23;
        letter-spacing: 0.13px;
        text-overflow: ellipsis;
      }
      svg {
        width: 50px;
        height: 50px;
      }
    </style>
  </template>;
  return DefaultErrorResultComponent as unknown as HTMLComponent;
}

function wrapWithModifier(
  innerComponent: HTMLComponent,
  modifier: CardContext['cardComponentModifier'] | undefined,
  cardId: string,
): HTMLComponent {
  if (!modifier) {
    return innerComponent;
  }

  let cardIdForModifier = cardId;

  class DecoratedPrerenderedCard extends Component {
    component = innerComponent;
    cardModifier = modifier!;
    cardId = cardIdForModifier;
  }

  setComponentTemplate(
    precompileTemplate(
      `<this.component
        {{this.cardModifier
          cardId=this.cardId
          format='data'
          fieldType=undefined
          fieldName=undefined
        }}
        ...attributes
      />`,
      { strictMode: true, scope: () => ({}) },
    ),
    DecoratedPrerenderedCard,
  );

  return DecoratedPrerenderedCard as unknown as HTMLComponent;
}

export default class PrerenderedCardSearch extends Component<PrerenderedCardComponentSignature> {
  @consume(CardContextName) declare private cardContext?: CardContext;

  private get cardComponentModifier() {
    if (isDestroying(this) || isDestroyed(this)) {
      return undefined;
    }
    try {
      return this.cardContext?.cardComponentModifier;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(OWNER_DESTROYED_ERROR)
      ) {
        // Realm refreshes can finish after the component tree has torn down.
        return undefined;
      }
      throw error;
    }
  }

  private prerenderedSearchResource = getPrerenderedSearch(
    this,
    getOwner(this)!,
    () => ({
      query: this.shouldUseRenderContextSearch ? undefined : this.args.query,
      format: this.shouldUseRenderContextSearch ? undefined : this.args.format,
      realms: this.args.realms,
      cardUrls: this.args.cardUrls,
      isLive: this.args.isLive ?? false,
      cardComponentModifier: this.cardComponentModifier,
    }),
  );

  private renderContextSearchResource = getSearch<CardDef | FileDef>(
    this,
    getOwner(this)!,
    () => (this.shouldUseRenderContextSearch ? this.args.query : undefined),
    () => this.args.realms,
    {
      isLive: false,
      storeService: getOwner(this)!.lookup('service:render-store') as any,
    },
  );

  private renderContextPrerenderedSearchResource = getLivePrerenderedSearch(
    this,
    getOwner(this)!,
    () => ({
      instances: this.renderContextSearchResource.instances,
      isLoading: this.renderContextSearchResource.isLoading,
      meta: this.renderContextSearchResource.meta,
      format: this.shouldUseRenderContextSearch ? this.args.format : undefined,
      realms: this.args.realms,
      cardComponentModifier: this.cardComponentModifier,
    }),
  );

  private get shouldUseRenderContextSearch() {
    return Boolean((globalThis as any).__boxelRenderContext) && !isTesting();
  }

  private get searchResource() {
    return this.shouldUseRenderContextSearch
      ? this.renderContextPrerenderedSearchResource
      : this.prerenderedSearchResource;
  }

  private get searchResults() {
    return {
      instances: this.searchResource.instances,
      isLoading: this.searchResource.isLoading,
      meta: this.searchResource.meta,
    };
  }

  <template>
    {{#if this.searchResults.isLoading}}
      {{yield to='loading'}}
    {{else}}
      {{yield this.searchResults.instances to='response'}}
      {{#if this.searchResults.meta}}
        {{yield this.searchResults.meta to='meta'}}
      {{/if}}
    {{/if}}
  </template>
}
