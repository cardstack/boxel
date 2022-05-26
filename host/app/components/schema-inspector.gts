import Component from '@glimmer/component';
import { Card, serializeCard } from '../lib/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq } from '../helpers/truth-helpers';
import isObject from 'lodash/isObject';
import { tracked } from '@glimmer/tracking';
import { moduleURL } from 'runtime-spike/resources/import';
import { renderCard, RenderedCard } from 'runtime-spike/resources/rendered-card';
import LocalRealm from '../services/local-realm';
import { service } from '@ember/service';


export default class SchemaInspector extends Component<{ Args: { module: Record<string, any> } }> {
  <template>
    <p class="card-chooser">
      Cards:
      {{#each-in this.cards as |name card|}}
        <button {{on "click" (fn this.select name card)}}
          class="card-button {{if (eq this.selected.name name) 'selected'}}"
          data-test-card-name={{name}}
          disabled={{if (eq this.selected.name name) true false}}>
          {{name}}
        </button>
      {{/each-in}}
    </p>
    <h2 class="selected-card">Selected: {{this.selected.name}}</h2>
    {{! TODO Render the card schema of the selected card }}
    {{#if this.selected}}
      <button {{on "click" this.create}}>Create New {{this.selected.name}}</button>

      {{#if this.rendered.component}}
        <this.rendered.component />
        <button {{on "click" this.save}}>Save</button>
      {{/if}}

    {{/if}}
  </template>

  @tracked
  selected: { name: string; card: typeof Card; } | undefined;

  @service declare localRealm: LocalRealm;

  get cards() {
    let cards = {} as { [exportName: string]: typeof Card };
    for (let [ exportName, value ] of Object.entries(this.args.module)) {
      let maybeCard = value as typeof Card;
      if (!isObject(maybeCard)) {
        continue;
      }
      if ('baseCard' in maybeCard) {
        cards[exportName] = maybeCard;
      }
    }
    return cards;
  }

  @action
  select(name: string, card: typeof Card) {
    this.selected = { name, card };
  }

  private newInstance: Card | undefined;

  @tracked
  private rendered: RenderedCard | undefined;

  @action
  create() {
    if (!this.selected) {
      return;
    }
    let instance = this.newInstance = new (this.selected.card)();
    this.rendered = renderCard(this, () => instance, () => 'edit')
  }

  @action
  async save() {
    if (!this.newInstance || !this.selected) {
      return;
    }

    let mod = moduleURL(this.args.module);
    if (!mod) {
      throw new Error(`can't save card in unknown module.`);
    }


    let json = { data: serializeCard(this.newInstance, { adoptsFrom: { module: mod, name: this.selected.name} }) };

    // TODO: auto-pick a filename
    let handle = await this.localRealm.fsHandle.getFileHandle('x.json', { create: true });

    // TypeScript seems to lack types for the writable stream features
    let stream = await (handle as any).createWritable();

    await stream.write(JSON.stringify(json, null, 2));
    await stream.close();

    // TODO: navigate to the newly saved card (this probably means we should switch to an ember-concurrency task)
  }
}
