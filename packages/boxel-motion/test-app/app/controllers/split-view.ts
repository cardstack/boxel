import {
  type Changeset,
  SpriteType,
  SpringBehavior,
  AnimationDefinition,
  type IContext,
} from '@cardstack/boxel-motion';
import Controller from '@ember/controller';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

export default class SplitView extends Controller {
  @tracked isViewSplit = false;

  @action
  toggle() {
    this.isViewSplit = !this.isViewSplit;
  }

  transition(changeset: Changeset): AnimationDefinition {
    let animationDefinition: AnimationDefinition = {
      timeline: {
        type: 'parallel',
        animations: [],
      },
    };
    addButtonAnimation.call(
      this,
      changeset,
      animationDefinition,
      changeset.context,
    );
    addPanelAnimation.call(
      this,
      changeset,
      animationDefinition,
      changeset.context,
    );
    return animationDefinition;
  }
}

function addButtonAnimation(
  changeset: Changeset,
  animationDefinition: AnimationDefinition,
  context: IContext,
) {
  let buttonSprite = changeset.spriteFor({
    id: 'button',
  });
  if (
    buttonSprite &&
    (buttonSprite.type === SpriteType.Inserted ||
      buttonSprite.type === SpriteType.Removed ||
      (buttonSprite.boundsDelta?.x || 0) !== 0)
  ) {
    if (buttonSprite.type === SpriteType.Removed) {
      buttonSprite.element.style.zIndex = '100';
    }
    let from =
      buttonSprite.initial?.left || `${context.element.clientWidth + 10}px`;
    let to =
      buttonSprite.final?.left || `${context.element.clientWidth + 10}px`;
    animationDefinition.timeline.animations.push({
      sprites: new Set([buttonSprite]),
      properties: {
        left: {
          from,
          to,
        },
      },
      timing: {
        behavior: new SpringBehavior(),
      },
    });
  }
}

function addPanelAnimation(
  changeset: Changeset,
  animationDefinition: AnimationDefinition,
  context: IContext,
) {
  let containerSprite = changeset.spriteFor({
    id: 'sidebar-container',
  });
  if (!containerSprite) {
    return;
  }
  let behavior = new SpringBehavior({ overshootClamping: true });
  let isEntering =
    containerSprite.boundsDelta && containerSprite.boundsDelta?.width > 0;
  let isExiting =
    containerSprite.boundsDelta && containerSprite.boundsDelta?.width < 0;
  if (isEntering || isExiting) {
    animationDefinition.timeline.animations.push({
      sprites: new Set([containerSprite]),
      properties: {
        width: {
          from: containerSprite.initial?.width,
          to: containerSprite.final?.width,
        },
      },
      timing: {
        behavior,
      },
    });
  }
  let contentSprite = changeset.spriteFor({
    id: 'sidebar-content',
  });
  if (contentSprite && contentSprite.type === SpriteType.Inserted) {
    contentSprite.element.style.width = contentSprite.final.width.toString();
    animationDefinition.timeline.animations.push({
      sprites: new Set([contentSprite]),
      properties: {
        left: {
          from: contentSprite.final.width,
          to: '0px',
        },
      },
      timing: {
        behavior,
      },
    });
  }
  if (contentSprite && contentSprite.type === SpriteType.Removed) {
    animationDefinition.timeline.animations.push({
      sprites: new Set([contentSprite]),
      properties: {
        left: {
          from: containerSprite.initial.left,
          to: containerSprite.initial.right,
        },
      },
      timing: {
        behavior,
      },
    });
  }
  if (
    contentSprite &&
    contentSprite.type === SpriteType.Kept &&
    (isEntering || isExiting)
  ) {
    if (isEntering) {
      contentSprite.element.style.width = contentSprite.final.width.toString();
    }
    animationDefinition.timeline.animations.push({
      sprites: new Set([contentSprite]),
      properties: {
        left: {
          from: containerSprite.initial.left,
          to: containerSprite.initial.right,
        },
      },
      timing: {
        behavior,
      },
    });
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your controllers.
declare module '@ember/controller' {
  interface Registry {
    'split-view': SplitView;
  }
}
