import {
  type Changeset,
  StaticBehavior,
  SpringBehavior,
  AnimationDefinition,
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
    addPanelAnimation.call(this, changeset, animationDefinition);
    return animationDefinition;
  }
}

function addPanelAnimation(
  changeset: Changeset,
  animationDefinition: AnimationDefinition,
) {
  let containerSprite = changeset.spriteFor({
    id: 'sidebar-container',
  });
  if (!containerSprite) {
    return;
  }
  let behavior = new SpringBehavior({ overshootClamping: true });
  animationDefinition.timeline.animations.push({
    sprites: new Set([containerSprite]),
    properties: {
      width: {},
    },
    timing: {
      behavior,
    },
  });
  let contentSprite = changeset.spriteFor({
    id: 'sidebar-content',
  });
  if (contentSprite) {
    animationDefinition.timeline.animations.push({
      sprites: new Set([contentSprite]),
      properties: {
        left: {
          from: contentSprite.initial?.left || containerSprite.initial.width,
          to: contentSprite.final?.left || containerSprite.initial.right,
        },
      },
      timing: {
        behavior,
      },
    });
    let fixedContentWidth = Math.max(
      contentSprite.initialBounds?.element?.width || 0,
      contentSprite.finalBounds?.element?.width || 0,
    );
    animationDefinition.timeline.animations.push({
      sprites: new Set([contentSprite]),
      properties: {
        width: `${fixedContentWidth}px`,
      },
      timing: {
        behavior: new StaticBehavior({ fill: true }),
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
