import { Component, primitive, serialize, queryableValue, Card, CardInstanceType, CardConstructor } from './card-api';
import { ComponentLike } from '@glint/template';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import { render } from "./render-card";
import { Loader } from "@cardstack/runtime-common";
import type { ExportedCardRef } from "@cardstack/runtime-common";
import { taskFor } from 'ember-concurrency-ts';

class BaseView extends Component<typeof CardRefCard> {
  <template>
    <div data-test-ref>
      Module: {{@model.module}} Name: {{@model.name}}
    </div>
    {{#if this.rendered.component}}
      <this.rendered.component/>
    {{/if}}
  </template>

  @tracked component: ComponentLike<{ Args: {}; Blocks: {} }> | undefined;
  @tracked card: Card | undefined;
  rendered = render(this, () => this.card, () => 'embedded');

  constructor(owner: unknown, args: any) {
    super(owner, args);
    taskFor(this.loadCard).perform();
  }

  @task private async loadCard(this: BaseView) {
    if (!this.args.model) {
      return;
    }
    let module: Record<string, any> = await Loader.import(this.args.model.module);
    let Clazz: typeof Card = module[this.args.model.name];
    this.card = Clazz.fromSerialized({...(Clazz as any).demo ?? {}});
  }
}

export default class CardRefCard extends Card {
  static [primitive]: ExportedCardRef;
  
  static [serialize](cardRef: ExportedCardRef) {
    return {...cardRef}; // return a new object so that the model cannot be mutated from the outside
  }
  static fromSerialized<T extends CardConstructor>(this: T, cardRef: ExportedCardRef): CardInstanceType<T> {
    return {...cardRef} as CardInstanceType<T>;// return a new object so that the model cannot be mutated from the outside
  }
  static [queryableValue](cardRef: ExportedCardRef) {
    return `${cardRef.module}/${cardRef.name}`; // this assumes the module is an absolute reference
  }

  static embedded = class Embedded extends BaseView {}
  static isolated = class Isolated extends BaseView {}
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends BaseView {}
}
