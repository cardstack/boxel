import Component from '@glimmer/component';
import { render } from '../resources/rendered-card';
//@ts-ignore cached not available yet in definitely typed
import { tracked, cached } from '@glimmer/tracking';
import { Card, CardJSON, Format, serializeCard } from '../lib/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import isEqual from 'lodash/isEqual';
import { eq } from '../helpers/truth-helpers';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
import LocalRealm from '../services/local-realm';

interface Signature {
  Args: {
    module: Record<string, typeof Card>;
    json: CardJSON;
    filename: string;
  }
}

const formats: Format[] = ['isolated', 'embedded', 'edit' ];

export default class Preview extends Component<Signature> {
  <template>
    <div>
      Format: 
      {{#each formats as |format|}}
        <button {{on "click" (fn this.setFormat format)}}
          class="format-button {{format}} {{if (eq this.format format) 'selected'}}"
          disabled={{if (eq this.format format) true false}}>
          {{format}}
        </button>
      {{/each}}
    </div>

    {{#if this.rendered.component}}
      <this.rendered.component/>
      {{#if this.isDirty}}
        <div>
          <button data-test-save-card {{on "click" this.save}}>Save</button>
          <button data-test-reset {{on "click" this.reset}}>Reset</button>
        </div>
      {{/if}}
    {{/if}}
  </template>
  
  @service declare localRealm: LocalRealm;

  @tracked
  format: Format = 'isolated';
  @tracked
  resetTime = Date.now();
  rendered = render(this, () => this.card, () => this.format)

  constructor(owner: unknown, args: Signature["Args"]) {
    super(owner, args);
  }

  @cached
  get card() {
    this.resetTime; // just consume this
    let cardClass = this.args.module[this.args.json.data.meta.adoptsFrom.name];
    return cardClass.fromSerialized(this.args.json.data.attributes ?? {});
  }

  get currentJSON() {
    return { data: serializeCard(this.card, { adoptsFrom: this.args.json.data.meta.adoptsFrom }) };
  }

  get isDirty() {
    Card.consumeAllFields(this.card);
    return !isEqual(this.currentJSON, this.args.json);
  }

  @action
  setFormat(format: Format) {
    this.format = format;
  }

  @action
  reset() {
    if (this.isDirty) {
      this.resetTime = Date.now();
    }
  }

  @action
  async save() {
    taskFor(this.write).perform();
  }
  
  @restartableTask private async write(): Promise<void> {
    let dirHandle = await this.localRealm.fsHandle.getDirectoryHandle(this.card.constructor.name, { create: true });
    let handle = await dirHandle.getFileHandle(this.args.filename, { create: true });

    // TypeScript seems to lack types for the writable stream features
    let stream = await (handle as any).createWritable();

    await stream.write(JSON.stringify(this.currentJSON, null, 2));
    await stream.close();
  }
}
