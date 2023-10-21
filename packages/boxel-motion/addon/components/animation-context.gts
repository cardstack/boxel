import { IContext, Changeset } from "@cardstack/boxel-motion/models/animator";
import { AnimationDefinition } from "@cardstack/boxel-motion/models/orchestration";
import Sprite from "@cardstack/boxel-motion/models/sprite";
import AnimationsService from "@cardstack/boxel-motion/services/animations";
import { assert } from "@ember/debug";
import { action } from "@ember/object";
import { inject as service } from "@ember/service";
import Component from "@glimmer/component";
import registerContext from "../modifiers/register-context";
import registerContextOrphansEl from "../modifiers/register-context-orphans-el";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Ember from "ember";

const { VOLATILE_TAG, consumeTag } =
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  Ember.__loader.require("@glimmer/validator");

interface AnimationContextArgs {
  id?: string;
  use: ((changeset: Changeset) => AnimationDefinition) | undefined;
}

interface Signature {
  Element: HTMLDivElement;
  Args: AnimationContextArgs;
  Blocks: {
    default: [AnimationContextComponent];
  };
}

export default class AnimationContextComponent
  extends Component<Signature>
  implements IContext
{
  <template>
    {{this.renderDetector}}
    <div class="animation-context" {{registerContext this}} ...attributes>
      <div
        {{registerContextOrphansEl this}}
        data-animation-context-orphan-element="true"
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
      "Element is appended in multiple different orphan elements",
      sprite.element.parentElement === orphansElement ||
        !sprite.element.parentElement?.dataset["animationContextOrphanElement"],
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
