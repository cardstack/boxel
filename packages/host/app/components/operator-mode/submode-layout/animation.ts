import {
  type Changeset,
  SpringBehavior,
  AnimationDefinition,
  StaticBehavior,
} from '@cardstack/boxel-motion';

export default function animate(changeset: Changeset) {
  let animationDefinition: AnimationDefinition = {
    timeline: {
      type: 'parallel',
      animations: [],
    },
  };
  let containerSprite = changeset.spriteFor({
    id: 'ai-assistant-resizable-panel',
  });
  if (!containerSprite) {
    return;
  }
  let spring = new SpringBehavior({ overshootClamping: true });
  animationDefinition.timeline.animations.push({
    sprites: new Set([containerSprite]),
    properties: {
      width: {},
      minWidth: {
        from: containerSprite.initial?.width || '0px',
        to: containerSprite.final?.width || '0px',
      },
    },
    timing: {
      behavior: spring,
    },
  });

  let contentSprite = changeset.spriteFor({
    id: 'ai-assistant-panel',
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
        behavior: spring,
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
  return animationDefinition;
}
