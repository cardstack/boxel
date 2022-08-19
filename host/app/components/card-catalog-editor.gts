import Component from '@glimmer/component';
import { getSearchResults } from '../resources/search';
import { type ExportedCardRef, catalogEntryRef } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import CardEditor from './card-editor';
import ImportModule from './import-module';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
import LocalRealm from '../services/local-realm';
import type RouterService from '@ember/routing/router-service';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { Loader } from '@cardstack/runtime-common/loader';
//@ts-ignore cached not available yet in definitely typed
import { tracked, cached } from '@glimmer/tracking';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';

interface Signature {
  Args: {
    ref: ExportedCardRef;
  }
}

export default class CardCatalogEditor extends Component<Signature> {
  <template>
    <ul>
      {{#each this.catalogEntry.instances as |entry|}}
        <li>
          <LinkTo @route="application" @query={{hash path=(this.modulePath (ensureJsonExtension entry.id))}}>
            {{entry.id}}
          </LinkTo>
          <fieldset>
            <legend>Catalog Entry Editor</legend>
            <ImportModule @url={{entry.meta.adoptsFrom.module}}>
              <:ready as |module|>
                <CardEditor
                  @card={{hash type="existing" url=entry.id json=(hash data=entry) format="edit"}}
                  @module={{module}}
                  @onSave={{this.onSave}}
                />
              </:ready>
              <:error as |error|>
                <h2>Encountered {{error.type}} error</h2>
                <pre>{{error.message}}</pre>
              </:error>
            </ImportModule>
          </fieldset>
          {{!-- TODO: Catalog Entry Preview --}}
        </li>
      {{else}}
        {{#if this.showEditor}}
          <fieldset>
            <legend>Publish New Card Type</legend>
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
      {{/each}}
    </ul>
  </template>

  @service declare localRealm: LocalRealm;
  @service declare router: RouterService;
  catalogEntryRef = catalogEntryRef;
  catalogEntryAttributes = {
    title: this.args.ref.name,
    description: `Catalog entry for ${this.args.ref.name} type`,
    ref: this.args.ref,
  }
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
