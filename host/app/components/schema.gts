import Component from '@glimmer/component';
import { ExportedCardRef } from '@cardstack/runtime-common';
import { getCardType } from '../resources/card-type';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import LocalRealm from '../services/local-realm';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { Loader } from '@cardstack/runtime-common/loader';
//@ts-ignore cached not available yet in definitely typed
import { cached, tracked } from '@glimmer/tracking';
import { LinkTo } from '@ember/routing';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import CatalogEntryEditor from './catalog-entry-editor';
import { restartableTask, } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import type { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import type { FileResource } from '../resources/file';

interface Signature {
  Args: {
    ref: ExportedCardRef;
    file: FileResource;
    moduleSyntax: ModuleSyntax;
  }
}

export default class Schema extends Component<Signature> {
  <template>
    {{#if this.cardType.type}}
      <div class="schema">
        <div data-test-card-id>Card ID: {{this.cardType.type.id}}</div>
        <div data-test-adopts-from>Adopts From: {{this.cardType.type.super.id}}</div>
        <div>Fields:</div>
        <ul>
          {{#each this.cardType.type.fields as |field|}}
            <li data-test-field={{field.name}}>
              {{#if (this.isOwnField field.name)}}
                <button type="button" {{on "click" (fn this.deleteField field.name)}} data-test-delete>Delete</button>
              {{/if}}
              {{field.name}} - {{field.type}} - field card ID:
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
        <CatalogEntryEditor @ref={{@ref}} />
      </div>
    {{/if}}
    {{#if this.isUpdating}}
      <div><em>Updating...</em></div>
    {{/if}}
  </template>

  @service declare localRealm: LocalRealm;
  cardType = getCardType(this, () => this.args.ref, () => this.args.moduleSyntax);
  @tracked isUpdating = false;

  @cached
  get realmPath() {
    if (!this.localRealm.isAvailable) {
      throw new Error('Local realm is not available');
    }
    return new RealmPaths(Loader.reverseResolution(this.localRealm.url.href));
  }

  get card() {
    let card = this.args.moduleSyntax.possibleCards.find(c => c.exportedAs === this.args.ref.name);
    if (!card) {
      throw new Error(`cannot find card in module syntax for ref ${JSON.stringify(this.args.ref)}`);
    }
    return card;
  }

  @action
  isOwnField(fieldName: string): boolean {
    return this.card.possibleFields.has(fieldName);
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
  deleteField(fieldName: string) {
    this.args.moduleSyntax.removeField(
      { type: 'exportedName', name: this.args.ref.name },
      fieldName
    );
    taskFor(this.write).perform(this.args.moduleSyntax.code());
  }

  @restartableTask private async write(src: string): Promise<void> {
    if (this.args.file.state !== 'ready') {
      throw new Error(`the file ${this.args.file.url} is not open`);
    }
    // this component is rerendered after the write has completed which
    // will reset the isUpdating. not super elegant, but until we get an
    // actual design, this is super simplistic approach
    this.isUpdating = true;
    await this.args.file.write(src);
  }
}
