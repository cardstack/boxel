import Component from '@glimmer/component';
import { ExportedCardRef } from '@cardstack/runtime-common';
import { getCardType } from '../resources/card-type';
import { getSearchResults } from '../resources/search';
import { action } from '@ember/object';
import { service } from '@ember/service';
import LocalRealm from '../services/local-realm';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { Loader } from '@cardstack/runtime-common/loader';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import CardEditor from './card-editor';
import ImportModule from './import-module';
import type RouterService from '@ember/routing/router-service';

interface Signature {
  Args: {
    ref: ExportedCardRef;
  }
}

export default class Schema extends Component<Signature> {
  <template>
    {{#if this.cardType.type}}
      <p>
        <div data-test-card-id>Card ID: {{this.cardType.type.id}}</div>
        <div data-test-adopts-from>Adopts From: {{this.cardType.type.super.id}}</div>
        <div>Fields:</div>
        <ul>
          {{#each this.cardType.type.fields as |field|}}
            <li data-test-field={{field.name}}>{{field.name}} - {{field.type}} - field card ID:
              {{#if (this.inRealm field.card.exportedCardContext.module)}}
                <LinkTo
                  @route="application"
                  @query={{hash path=(this.modulePath field.card.exportedCardContext.module)}}
                >
                  {{field.card.id}}
                </LinkTo>
              {{else}}
                {{field.card.id}}
              {{/if}}
            </li>
          {{/each}}
        </ul>

        {{#each this.catalogEntry.instances as |entry|}}
          <fieldset data-test-catalog-entry-id>
            <legend>Catalog Entry</legend>
            <LinkTo @route="application" @query={{hash path=(this.modulePath (ensureJsonExtension entry.id))}}>
              {{entry.id}}
            </LinkTo>
            <ImportModule @url={{entry.meta.adoptsFrom.module}}>
              <:ready as |module|>
                <CardEditor
                  @card={{hash type="existing" url=entry.id format="edit"}}
                  @module={{module}}
                  @onSave={{this.onSave}}
                  @onCancel={{this.onCancel}}
                />
              </:ready>
              <:error as |error|>
                <h2>Encountered {{error.type}} error</h2>
                <pre>{{error.message}}</pre>
              </:error>
            </ImportModule>
          </fieldset>
        {{/each}}

        {{#unless this.catalogEntry.instances.length}}
          {{#if this.showEditor}}
            <fieldset>
              <legend>Create Catalog Entry</legend>
              <ImportModule @url={{this.catalogEntryRef.module}}>
                <:ready as |module|>
                  <CardEditor
                    @card={{hash type="new" realmURL=this.localRealm.url.href cardSource=this.catalogEntryRef initialAttributes=this.catalogEntryAttributes}}
                    @module={{module}}
                    @onSave={{this.onSave}}
                    @onCancel={{this.onCancel}}
                  />
                </:ready>
                <:error as |error|>
                  <h2>Encountered {{error.type}} error</h2>
                  <pre>{{error.message}}</pre>
                </:error>
              </ImportModule>
            </fieldset>
          {{else}}
            <button {{on "click" this.displayEditor}} type="button">
              Publish Card Type
            </button>
          {{/if}}
        {{/unless}}
      </p>
    {{/if}}
  </template>

  @service declare localRealm: LocalRealm;
  @service declare router: RouterService;
  catalogEntryRef = {
    module: 'https://cardstack.com/base/catalog-entry',
    name: 'CatalogEntry',
  };
  catalogEntryAttributes = {
    title: this.args.ref.name,
    description: `Catalog entry for ${this.args.ref.name} type`,
    ref: this.args.ref,
  }
  cardType = getCardType(this, () => this.args.ref);
  catalogEntry = getSearchResults(this, () => ({
    filter: {
      on: this.catalogEntryRef,
      eq: { ref: this.args.ref },
    },
  }));
  @tracked showEditor = false;

  @cached
  get realmPath() {
    if (!this.localRealm.isAvailable) {
      throw new Error('Local realm is not available');
    }
    return new RealmPaths(Loader.reverseResolution(this.localRealm.url.href));
  }

  @action
  inRealm(url: string): boolean {
    return this.realmPath.inRealm(new URL(url));
  }

  @action
  modulePath(url: string): string {
    return this.realmPath.local(new URL(url));
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
  onSave(url: string) {
    let path = this.realmPath.local(new URL(url));
    this.router.transitionTo({ queryParams: { path } });
  }
}

function ensureJsonExtension(url: string) {
  if (!url.endsWith('.json')) {
    return `${url}.json`;
  }
  return url;
}
