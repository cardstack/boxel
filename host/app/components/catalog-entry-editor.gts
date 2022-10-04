import Component from '@glimmer/component';
import { catalogEntryRef, type ExportedCardRef, type NewCardArgs, type LooseCardResource } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import { getSearchResults } from '../resources/search';
import LocalRealm from '../services/local-realm';
import Preview from './preview';

interface Signature {
  Args: {
    ref: ExportedCardRef;
  }
}

const formats = ['isolated', "embedded", "edit"] as ('isolated' | 'embedded' | 'edit')[];

export default class CatalogEntryEditor extends Component<Signature> {
  <template>
    <div class="catalog-entry-editor" data-test-catalog-entry-editor>
      {{#if this.entry}}
        <fieldset>
          <legend>Edit Catalog Entry</legend>
          <LinkTo @route="application" @query={{hash path=(ensureJsonExtension this.entry.id)}} data-test-catalog-entry-id>
            {{this.entry.id}}
          </LinkTo>
          <Preview
            @formats={{formats}}
            @card={{hash type="existing" url=this.entry.id format="embedded" }}
          />
        </fieldset>
      {{else}}
        {{#if this.showEditor}}
          <fieldset>
            <legend>Publish New Card Type</legend>
            <Preview
              @card={{this.cardArgs}}
              @onSave={{this.onSave}}
              @onCancel={{this.onCancel}}
            />
          </fieldset>
        {{else}}
          <button {{on "click" this.displayEditor}} type="button" data-test-catalog-entry-publish>
            Publish Card Type
          </button>
        {{/if}}
      {{/if}}
    </div>
  </template>

  @service declare localRealm: LocalRealm;
  @service declare router: RouterService;
  catalogEntryRef = catalogEntryRef;
  catalogEntry = getSearchResults(this, () => ({
    filter: {
      on: this.catalogEntryRef,
      eq: { ref: this.args.ref },
    },
  }));
  @tracked showEditor = false;

  get entry() {
    return this.catalogEntry.instances[0];
  }

  get initialCardResource(): LooseCardResource | undefined {
    if (!this.args.ref) {
      return;
    }
    let resource = {
      attributes: {
        title: this.args.ref.name,
        description: `Catalog entry for ${this.args.ref.name} card`,
        ref: this.args.ref,
        demo: undefined
      },
      meta: {
        adoptsFrom: this.catalogEntryRef,
        fields: {
          demo: {
            adoptsFrom: this.args.ref
          }
        }
      }
    }
    return resource;
  }

  get cardArgs(): NewCardArgs {
    return {
      type: 'new',
      realmURL: this.localRealm.url.href,
      cardSource: this.catalogEntryRef,
      initialCardResource: this.initialCardResource,
    }
  }

  @action
  displayEditor() {
    this.showEditor = true;
  }

  @action
  onCancel() {
    this.showEditor = false;
  }

  @action
  onSave(path: string) {
    this.router.transitionTo({ queryParams: { path }});
  }
}

function ensureJsonExtension(url: string) {
  if (!url.endsWith('.json')) {
    return `${url}.json`;
  }
  return url;
}
