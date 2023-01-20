import Component from '@glimmer/component';
import { service } from '@ember/service';
import { readFileAsText as _readFileAsText } from "@cardstack/runtime-common/stream";
import { task } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { schedule } from '@ember/runloop';
import { render } from '../lib/isolated-render';
import { getOwner } from '@ember/application';
import { tracked } from '@glimmer/tracking';
import { type SimpleDocument, type SimpleElement } from '@simple-dom/interface';
import type { Card, Format } from 'https://cardstack.com/base/card-api';
import type { ComponentOptions } from 'https://cardstack.com/base/field-component';

interface Signature {
  Args: {
    card: Card;
    format: Format;
    opts?: ComponentOptions
  }
}
const ELEMENT_NODE_TYPE = 1;
let nonce = 0;

export default class Render extends Component<Signature> {
  <template>
    <div id="isolated-render" data-test-render={{this.doRender}}></div>
  </template>

  // @ts-expect-error the types for this invocation of @service() don't work
  @service('-document') document!: SimpleDocument;
  @tracked renderElement: SimpleElement | undefined;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    taskFor(this.afterRender).perform();
  }

  @task
  private async afterRender(): Promise<void> {
    await afterRender();
    this.renderElement = getIsolatedRenderElement(this.document);
  }

  get renderedCard() {
    return this.args.card.constructor.getComponent(this.args.card, this.args.format, this.args.opts);
  }

  // we do the render as a side effect of the glimmer consumption of this property
  get doRender() {
    if (this.renderElement) {
      render(this.renderedCard, this.renderElement, getOwner(this)!);
    }
    return nonce++;
  }
}

export function getIsolatedRenderElement(document: SimpleDocument): SimpleElement {
  let child = document.body.lastChild;
  while (child && (child.nodeType !== ELEMENT_NODE_TYPE || child.getAttribute('id') !== 'isolated-render')) {
    child = child.previousSibling;
  }
  if (child == null) {
    throw new Error(`Could not find element to perform isolated render within`);
  }
  return child as SimpleElement
}

export async function afterRender() {
  await new Promise<void>((res) => {
    schedule('afterRender', function () {
      res();
    });
  });
  // the latest render will be available 1 micro task after the render
  await Promise.resolve();
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Render: typeof Render;
   }
}
