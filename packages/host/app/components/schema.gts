import Component from '@glimmer/component';
import { chooseCard, catalogEntryRef } from '@cardstack/runtime-common';
import { getCardType } from '../resources/card-type';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import LocalRealm from '../services/local-realm';
import { eq } from '../helpers/truth-helpers';
import { RealmPaths } from '@cardstack/runtime-common/paths';
//@ts-ignore cached not available yet in definitely typed
import { cached, tracked } from '@glimmer/tracking';
import { LinkTo } from '@ember/routing';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import CatalogEntryEditor from './catalog-entry-editor';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import Modifier from 'ember-modifier';
import LoaderService from '../services/loader-service';
import type { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import type { FileResource } from '../resources/file';
import type { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import type { Card, FieldType } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: typeof Card;
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
              {{#if (this.inRealm field.card.module)}}
                <LinkTo
                  @route="application"
                  @query={{hash path=(this.modulePath field.card.module)}}
                >
                  {{field.card.id}}
                </LinkTo>
              {{else}}
                {{field.card.id}}
              {{/if}}
            </li>
          {{/each}}
          <p>
            {{#if this.errorMsg}}
              <div class="error" data-test-error-msg>{{this.errorMsg}}</div>
            {{/if}}
            <input
              data-test-new-field-name
              type="text"
              value={{this.newFieldName}}
              {{on "input" this.setNewFieldName}}
            />
            <label>
              contains
              <input 
                data-test-new-field-contains
                {{RadioInitializer (eq this.newFieldType "contains") true}}
                type="radio" 
                disabled={{this.isNewFieldDisabled}} 
                checked={{eq this.newFieldType "contains"}}
                {{on "change" (fn this.setNewFieldType "contains")}}
                name="field-type"
              />
            </label>
            <label>
              containsMany
              <input 
                data-test-new-field-containsMany
                {{RadioInitializer (eq this.newFieldType "containsMany") true}}
                type="radio" 
                disabled={{this.isNewFieldDisabled}} 
                checked={{eq this.newFieldType "containsMany"}}
                {{on "change" (fn this.setNewFieldType "containsMany")}}
                name="field-type"
              />
            </label>
            <button
              data-test-add-field
              type="button"
              disabled={{this.isNewFieldDisabled}}
              {{on "click" this.addField}}
            >
              Add Field
            </button>
          </p>
        </ul>
        <CatalogEntryEditor @ref={{this.ref}} />
      </div>
    {{/if}}
  </template>

  @service declare localRealm: LocalRealm;
  @service declare loaderService: LoaderService;
  @tracked newFieldName: string | undefined;
  @tracked newFieldType: FieldType = 'contains';

  @cached
  get ref() {
    let ref = this.loaderService.loader.identify(this.args.card);
    if (!ref) {
      throw new Error(`bug: unable to identify card ${this.args.card.name}`);
    }
    return ref;
  }

  @cached
  get realmPath() {
    if (!this.localRealm.isAvailable) {
      throw new Error('Local realm is not available');
    }
    return new RealmPaths(this.loaderService.loader.reverseResolution(this.localRealm.url.href));
  }

  @cached
  get cardType() {
    return getCardType(this, () => this.args.card);
  }

  @cached
  get cardFromSyntax() {
    let card = this.args.moduleSyntax.possibleCards.find(c => c.exportedAs === this.ref.name);
    if (!card) {
      throw new Error(`cannot find card in module syntax for ref ${JSON.stringify(this.ref)}`);
    }
    return card;
  }

  get isNewFieldDisabled() {
    return Boolean(this.errorMsg) || !this.newFieldName;
  }

  @cached
  get errorMsg(): string | undefined {
    if (!this.newFieldName) {
      return;
    }
    if (this.cardType.type?.fields.find(field => field.name === this.newFieldName)) {
      return `The field name "${this.newFieldName}" already exists, please choose a different name.`;
    }
    return;
  }

  @action
  isOwnField(fieldName: string): boolean {
    return Object.keys(Object.getOwnPropertyDescriptors(this.args.card.prototype)).includes(fieldName);
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
  addField() {
    taskFor(this.makeField).perform();
  }

  @action
  deleteField(fieldName: string) {
    this.args.moduleSyntax.removeField(
      { type: 'exportedName', name: this.ref.name },
      fieldName
    );
    taskFor(this.write).perform(this.args.moduleSyntax.code());
  }

  @action
  setNewFieldName(event: any) {
    this.newFieldName = event.target.value;
  }

  @action
  setNewFieldType(fieldType: FieldType) {
    this.newFieldType = fieldType;
  }

  @restartableTask private async makeField() {
    let fieldEntry: CatalogEntry | undefined = await chooseCard({
      filter: {
        on: catalogEntryRef,
        // a "contains" field cannot be the same card as it's enclosing card (but it can for a linksTo)
        not: {
          eq: { ref: this.ref }
        }
      }
    });
    if (!fieldEntry) {
      return;
    }

    if (!this.newFieldName) {
      throw new Error('bug: new field name is not specified');
    }
    this.args.moduleSyntax.addField(
      { type: 'exportedName', name: this.ref.name},
      this.newFieldName,
      fieldEntry.ref,
      this.newFieldType
    );
    await taskFor(this.write).perform(this.args.moduleSyntax.code());
  }

  @restartableTask private async write(src: string): Promise<void> {
    if (this.args.file.state !== 'ready') {
      throw new Error(`the file ${this.args.file.url} is not open`);
    }
    // note that this write will cause the component to rerender, so 
    // any code after this write will not be executed since the component will 
    // get torn down before subsequent code can execute
    await this.args.file.write(src, true);
  }
}

interface RadioInitializerSignature {
  element: HTMLInputElement;
  Args: {
    Positional: [model: boolean, inputType: boolean];
  }
}

class RadioInitializer extends Modifier<RadioInitializerSignature> {
  modify(
    element: HTMLInputElement,
    [model, inputType]: RadioInitializerSignature["Args"]["Positional"]
  ) {
    element.checked = model === inputType;
  }
}