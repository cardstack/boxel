import Component from '@glimmer/component';
import { service } from '@ember/service';
import { readFileAsText as _readFileAsText } from "@cardstack/runtime-common/stream";
import { task } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { schedule } from '@ember/runloop';
import { render } from '../lib/isolated-render';
import { getOwner } from '@ember/application';
//@ts-expect-error the typing for cached seems out of date--TS says it's not exported from @glimmer/tracking
import { tracked, cached } from '@glimmer/tracking';
import config from '@cardstack/host/config/environment';
import { type SimpleDocument, type SimpleElement } from '@simple-dom/interface';
import type Owner from '@ember/owner';
import type { Card, Format } from 'https://cardstack.com/base/card-api';


interface Signature {
  Args: {
    card: Card;
    format: Format;
  }
}

const ELEMENT_NODE_TYPE = 1;
const { environment } = config;
let nonce = 0;

function getChildElementById(id: string, parent: SimpleElement): SimpleElement | undefined {
  let child = parent.firstChild;
  while (child && (child.nodeType !== ELEMENT_NODE_TYPE || child.getAttribute('id') !== id)) {
    child = child.nextSibling;
  }
  if (child == null) {
    return undefined;
  }
  return child;
}

function getElementFromIdPath(path: string[], parent: SimpleElement): SimpleElement | undefined {
  if (path.length === 0) {
    throw new Error(`cannot get element from id path with empty path array`);
  }
  let child = getChildElementById(path.shift()!, parent);
  if (!child) {
    return undefined;
  }
  if (path.length === 0) {
    return child;
  }
  return getElementFromIdPath(path, child);
}

export function getIsolatedRenderElement(document: SimpleDocument): SimpleElement {
  let element: SimpleElement | undefined;
  if (environment === 'test') {
    element = getElementFromIdPath(['qunit-fixture', 'ember-testing-container', 'ember-testing','isolated-render'], document.body);
  } else {
    element = getElementFromIdPath(['isolated-render'], document.body);
  }
  if (!element) {
    throw new Error(`Could not find element to perform isolated render within`);
  }
  return element;
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

function removeChildren(element: SimpleElement) {
  let child = element.firstChild;
  while (child) {
    element.removeChild(child);
    child = element.firstChild;
  }
}

export default class Render extends Component<Signature> {
  <template>
    <div id="isolated-render" data-test-render={{this.doRender}}></div>
  </template>

  // @ts-expect-error the types for this invocation of @service() don't work
  @service('-document') document!: SimpleDocument;
  @tracked renderElement: SimpleElement | undefined;
  owner: Owner = getOwner(this)!;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    taskFor(this.afterRender).perform();
  }

  @task
  private async afterRender(): Promise<void> {
    await afterRender();
    this.renderElement = getIsolatedRenderElement(this.document);
  }

  // we do the render as a side effect of the glimmer consumption of this property
  @cached
  get doRender() {
    if (this.renderElement) {
      // clear previous render work
      removeChildren(this.renderElement);
      render(
        componentForCard(this.args.card, this.args.format),
        this.renderElement,
        this.owner
      );
    }
    return nonce++;
  }
}

function componentForCard(card: Card, format: Format) {
  return card.constructor.getComponent(card, format, { disableShadowDOM: true });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Render: typeof Render;
   }
}
