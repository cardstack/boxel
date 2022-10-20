import Component from '@glimmer/component';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Ember from 'ember';
import { Changeset } from 'animations-experiment/models/changeset';
import Sprite from 'animations-experiment/models/sprite';
import { inject as service } from '@ember/service';
import { action } from '@ember/object';
import AnimationsService from 'animations-experiment/services/animations';
import { assert } from '@ember/debug';
import { getDocumentPosition } from 'animations-experiment/utils/measurement';
import { IContext, Rule } from 'animations-experiment/models/sprite-tree';
import { AnimationDefinition } from 'animations-experiment/models/transition-runner';

const { VOLATILE_TAG, consumeTag } =
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  Ember.__loader.require('@glimmer/validator');

interface AnimationContextArgs {
  id: string | undefined;
  use:
    | ((changeset: Changeset) => Promise<void | AnimationDefinition>)
    | undefined;
  rules: Rule[] | undefined;
}

export default class AnimationContextComponent
  extends Component<AnimationContextArgs>
  implements IContext
{
  @service declare animations: AnimationsService;

  get id(): string | undefined {
    return this.args.id;
  }

  element!: HTMLElement; //set by template
  orphansElement: HTMLElement | null = null; //set by template
  boundsBeforeRender: DOMRect | undefined;
  boundsAfterRender: DOMRect | undefined;
  isInitialRenderCompleted = false;

  orphans = new Map<string, HTMLElement>();

  get isStable() {
    return (
      this.isInitialRenderCompleted && !this.isDestroying && !this.isDestroyed
    );
  }

  willDestroy(): void {
    super.willDestroy();
    this.animations.unregisterContext(this);
  }

  get renderDetector(): undefined {
    consumeTag(VOLATILE_TAG);
    this.animations.notifyContextRendering(this);
    return undefined;
  }

  @action didInsertEl(element: HTMLElement): void {
    this.element = element;
    this.animations.registerContext(this);
    this.captureSnapshot();
  }

  @action didInsertOrphansEl(element: HTMLElement): void {
    this.orphansElement = element;
  }

  captureSnapshot(): void {
    let { element } = this;
    assert(
      'animation context must be an HTML element',
      element instanceof HTMLElement
    );
    this.boundsBeforeRender = this.boundsAfterRender;
    this.boundsAfterRender = getDocumentPosition(element);
  }

  shouldAnimate(): boolean {
    return Boolean((this.args.use || this.args.rules) && this.isStable);
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
        !sprite.element.parentElement?.dataset['animationContextOrphanElement']
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
