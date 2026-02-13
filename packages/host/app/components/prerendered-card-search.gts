import { setComponentTemplate } from '@ember/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { isDestroyed, isDestroying } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { precompileTemplate } from '@ember/template-compilation';
import Component from '@glimmer/component';

import TriangleAlert from '@cardstack/boxel-icons/triangle-alert';

import { consume } from 'ember-provide-consume-context';

import { CardContainer } from '@cardstack/boxel-ui/components';

import {
  RealmPaths,
  type PrerenderedCardLike,
  type PrerenderedCardData,
  type PrerenderedCardComponentSignature,
  CardContextName,
} from '@cardstack/runtime-common';

import type { CardContext } from 'https://cardstack.com/base/card-api';

import { type HTMLComponent, htmlComponent } from '../lib/html-component';
import { getPrerenderedSearch } from '../resources/prerendered-search';

const OWNER_DESTROYED_ERROR =
  "Cannot call `.lookup('renderer:-dom')` after the owner has been destroyed";

export class PrerenderedCard implements PrerenderedCardLike {
  component: HTMLComponent;
  constructor(
    public data: PrerenderedCardData,
    cardComponentModifier?: CardContext['cardComponentModifier'],
  ) {
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

  private searchResource = getPrerenderedSearch(this, getOwner(this)!, () => ({
    query: this.args.query,
    format: this.args.format,
    realms: this.args.realms,
    cardUrls: this.args.cardUrls,
    isLive: this.args.isLive ?? false,
    cardComponentModifier: this.cardComponentModifier,
  }));

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
