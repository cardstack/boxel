import Component from '@glimmer/component';
import { chooseCard, catalogEntryRef, identifyCard } from '@cardstack/runtime-common';
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
import BoxelInput from '@cardstack/boxel-ui/components/input';
import FieldContainer from '@cardstack/boxel-ui/components/field-container';
import CardContainer from '@cardstack/boxel-ui/components/card-container';
import Label from '@cardstack/boxel-ui/components/label';
import ENV from '@cardstack/host/config/environment';

const { demoRealmURL } = ENV;

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
      <CardContainer @displayBoundaries={{true}} class="schema">
        <FieldContainer @label="Card ID:" data-test-card-id>
          {{this.cardType.type.id}}
        </FieldContainer>
        <FieldContainer @label="Adopts From:" data-test-adopts-from>
          {{this.cardType.type.super.id}}
        </FieldContainer>
        <section>
          <Label>Fields:</Label>
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
            </p>
          </ul>
        </section>
        <fieldset class="add-new-field">
          <legend>Add New Field</legend>
          <FieldContainer @label="Field Name:" @tag="label">
            <BoxelInput
              data-test-new-field-name
              type="text"
              @value={{this.newFieldName}}
              @onInput={{this.setNewFieldName}}
            />
          </FieldContainer>
          <FieldContainer @label="Field Type:">
            <div>
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
            </div>
          </FieldContainer>
          <button
            data-test-add-field
            type="button"
            disabled={{this.isNewFieldDisabled}}
            {{on "click" this.addField}}
          >
            Add Field
          </button>
        </fieldset>
      </CardContainer>
      <CatalogEntryEditor @ref={{this.ref}} />
    {{/if}}
  </template>

  @service declare localRealm: LocalRealm;
  @service declare loaderService: LoaderService;
  @tracked newFieldName: string | undefined;
  @tracked newFieldType: FieldType = 'contains';

  @cached
  get ref() {
    let ref = identifyCard(this.args.card);
    if (!ref) {
      throw new Error(`bug: unable to identify card ${this.args.card.name}`);
    }
    return ref as { module: string; name: string };
  }

  @cached
  get realmPath() {
    if (!demoRealmURL && !this.localRealm.isAvailable) {
      throw new Error('Realm is not available');
    }
    let url = demoRealmURL ?? this.localRealm.url.href;
    return new RealmPaths(this.loaderService.loader.reverseResolution(url));
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
  setNewFieldName(value: string) {
    this.newFieldName = value;
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
