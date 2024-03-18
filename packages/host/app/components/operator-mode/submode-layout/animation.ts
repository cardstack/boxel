import {
  type Changeset,
  type IContext,
  SpriteType,
  SpringBehavior,
  AnimationDefinition,
} from '@cardstack/boxel-motion';

type AiAssistantPanelState = 'open' | 'opening' | 'closed' | 'closing';

function addButtonAnimation(
  changeset: Changeset,
  animationDefinition: AnimationDefinition,
  context: IContext,
) {
  let buttonSprite = changeset.spriteFor({
    id: 'ai-assistant-button',
  });
  if (
    buttonSprite &&
    (buttonSprite.type === SpriteType.Inserted ||
      buttonSprite.type === SpriteType.Removed ||
      (buttonSprite.boundsDelta?.x || 0) !== 0)
  ) {
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
        behavior: new SpringBehavior({ overshootClamping: true }),
      },
    });
  }
}

function addPanelAnimation(
  changeset: Changeset,
  animationDefinition: AnimationDefinition,
) {
  let containerSprite = changeset.spriteFor({
    id: 'ai-assistant-resizable-panel',
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
        minWidth: {
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
    id: 'ai-assistant-panel',
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

export default function animate(
  this: { aiAssistantPanelState: AiAssistantPanelState },
  changeset: Changeset,
) {
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
  addPanelAnimation.call(this, changeset, animationDefinition);
  return animationDefinition;
}
