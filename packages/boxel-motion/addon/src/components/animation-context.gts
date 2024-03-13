import { assert } from '@ember/debug';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Ember from 'ember';

import { type IContext, Changeset } from '../models/animator.ts';
import { type AnimationDefinition } from '../models/orchestration.ts';
import Sprite from '../models/sprite.ts';
import registerContext from '../modifiers/register-context.ts';
import registerContextOrphansEl from '../modifiers/register-context-orphans-el.ts';
import AnimationsService from '../services/animations.ts';

const { VOLATILE_TAG, consumeTag } =
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  Ember.__loader.require('@glimmer/validator');

interface AnimationContextArgs {
  id?: string;
  use: ((changeset: Changeset) => AnimationDefinition) | undefined;
}

interface Signature {
  Args: AnimationContextArgs;
  Blocks: {
    default: [AnimationContextComponent];
  };
  Element: HTMLDivElement;
}

export default class AnimationContextComponent
  extends Component<Signature>
  implements IContext
{
  <template>
    {{this.renderDetector}}
    <div class='animation-context' {{registerContext this}} ...attributes>
      <div
        {{registerContextOrphansEl this}}
        data-animation-context-orphan-element='true'
      ></div>
      {{! JS appends and removes here }}
      {{yield this}}
    </div>
  </template>

  @service declare animations: AnimationsService;

  get id(): string | undefined {
    return this.args.id;
  }

  element!: HTMLElement; //set by template
  orphansElement: HTMLElement | null = null; //set by template
  lastBounds: DOMRect | undefined;
  currentBounds: DOMRect | undefined;
  isInitialRenderCompleted = false;

  orphans = new Map<string, HTMLElement>();

  get isStable() {
    return (
      this.isInitialRenderCompleted && !this.isDestroying && !this.isDestroyed
    );
  }

  constructor(owner: unknown, args: AnimationContextArgs) {
    super(owner, args);
    if (!this.animations) {
      throw new Error(
        `Expected to find "animations" service in app.
         Add 'app/services/animations.ts' with
           \`export { AnimationsService as default } from '@cardstack/boxel-motion';\``,
      );
    }
  }

  willDestroy(): void {
    super.willDestroy();
    this.animations.unregisterContext(this);
  }

  get renderDetector(): undefined {
    consumeTag(VOLATILE_TAG);
    this.animations.notifyContextRendering();
    return undefined;
  }

  @action didInsertEl(element: HTMLElement): void {
    this.element = element;
    this.animations.registerContext(this);
  }

  @action didInsertOrphansEl(element: HTMLElement): void {
    this.orphansElement = element;
  }

  shouldAnimate(): boolean {
    return Boolean(this.args.use && this.isStable);
  }

  hasOrphan(sprite: Sprite): boolean {
    return this.orphans.has(sprite.identifier.toString());
  }

  appendOrphan(sprite: Sprite): void {
    let { orphansElement } = this as { orphansElement: HTMLElement };

    // TODO:
    // - add a map of orphans on a higher level than the animation context and use it for this assertion
    assert(
      'Element is appended in multiple different orphan elements',
      sprite.element.parentElement === orphansElement ||
        !sprite.element.parentElement?.dataset['animationContextOrphanElement'],
    );

    orphansElement.appendChild(sprite.element);

    this.orphans.set(sprite.identifier.toString(), sprite.element);
  }

  removeOrphan(sprite: Sprite): void {
    let identifier = sprite.identifier.toString();
    let element = this.orphans.get(identifier);
    if (element) {
      this.orphansElement!.removeChild(element);
      this.orphans.delete(identifier);
    } else {
      console.warn(`attempted to remove nonexistent orphan ${identifier}`);
    }
  }

  clearOrphans(): void {
    for (let [spriteIdentifier, orphan] of this.orphans) {
      this.orphansElement!.removeChild(orphan);
      this.orphans.delete(spriteIdentifier);
    }
  }
}
