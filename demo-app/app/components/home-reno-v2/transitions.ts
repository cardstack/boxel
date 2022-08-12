import runAnimations from 'animations-experiment/utils/run-animations';
import Sprite from 'animations-experiment/models/sprite';
import { IContext } from 'animations-experiment/models/sprite-tree';
import magicMove from 'animations-experiment/transitions/magic-move';
import { Changeset } from 'animations-experiment/models/changeset';
import { Card, CardState } from './data/card';
import LinearBehavior from 'animations-experiment/behaviors/linear';

const DEFAULT_DURATION = 500;

interface SpriteGroup {
  // HMM: these states are not reliably identified once interruptions happen
  state:
    | 'STATIC' // INCLUDES MIN -> EXPANDED, EXPANDED -> MIN
    | 'MAX -> EXPANDED'
    | 'EXPANDED -> MAX'
    | 'MAX -> MIN'
    | 'REMOVED'
    | 'INSERTED';
  model: Card;
  placeholder: Sprite | null;
  mainCardContent: Sprite | null;
  keptContent: Set<Sprite>;
  insertedContent: Set<Sprite>;
  removedContent: Set<Sprite>;
  title: Sprite | null;
  card: Sprite | null;
}

export async function maxToExpanded(
  context: IContext,
  spriteGroup: SpriteGroup
) {
  let duration = DEFAULT_DURATION;
  let behavior = new LinearBehavior();
  let fadeOutSprites: Sprite[] = [];
  // Lock placeholder if needed (if this is a shrink)
  let placeholder = spriteGroup.placeholder;
  if (placeholder) {
    placeholder.lockStyles();
    placeholder.element.style.zIndex = '0';
    context.appendOrphan(placeholder);
    placeholder.setupAnimation('position', {
      duration,
      behavior,
      startY: 0,
      endY:
        -placeholder.initialBounds!.relativeToContext.y +
        spriteGroup.card!.finalBounds!.relativeToContext.y,
    });
    fadeOutSprites.push(placeholder);
  }

  // Hide the card proper
  spriteGroup.card!.element.style.opacity = '0';

  // Lock counterpart of card
  let counterpartCard = spriteGroup.card!.counterpart!;
  counterpartCard.lockStyles();
  context.appendOrphan(counterpartCard!);

  // Content fades out
  let mainCardContent = spriteGroup.mainCardContent!;
  {
    let counterpart = mainCardContent.counterpart;
    if (counterpart) {
      // Hide all content of card sprite proper besides title
      mainCardContent.element.style.opacity = '0';
      counterpart.lockStyles();
      counterpart.element.style.zIndex =
        getComputedStyle(counterpartCard.element).zIndex + 1;
      context.appendOrphan(counterpart);
      counterpart.setupAnimation('opacity', {
        from: 1,
        to: 0,
        duration: duration,
      });
      fadeOutSprites.push(mainCardContent.counterpart!);
    }
  }

  // Run these first
  await runAnimations(fadeOutSprites);

  // Hide counterpart
  if (mainCardContent.counterpart) {
    context.removeOrphan(mainCardContent.counterpart);
  }
  spriteGroup.card!.element.style.opacity = '1';
  context.removeOrphan(counterpartCard);

  // Card sprite proper resizes and moves together with title
  magicMove(
    {
      keptSprites: new Set([spriteGroup.card!]),
    } as Changeset,
    {
      duration,
    }
  );
  spriteGroup.card!.element.style.zIndex = '2';
  if (placeholder) {
    placeholder.element.style.zIndex = '0';
  }
  await runAnimations([spriteGroup.card!]);
  if (placeholder) context.removeOrphan(placeholder!);

  let fadeInSprites: Sprite[] = [];

  // Card sprite proper content fades in
  mainCardContent.element.style.opacity = '1';
  mainCardContent.setupAnimation('opacity', {
    from: 0,
    to: 1,
    duration: duration,
  });
  fadeInSprites.push(mainCardContent);

  await runAnimations(fadeInSprites);

  spriteGroup.model._state.transitionCompleted();
}

export async function expandedToMax(
  context: IContext,
  spriteGroup: SpriteGroup
) {
  let duration = DEFAULT_DURATION;
  let fadeOutSprites: Sprite[] = [];

  // Hide the card proper
  spriteGroup.card!.element.style.opacity = '0';

  // Lock counterpart of card
  let counterpartCard = spriteGroup.card!.counterpart!;
  if (!context.hasOrphan(counterpartCard)) {
    counterpartCard.lockStyles();
    context.appendOrphan(counterpartCard!);
  }

  // Content fades out
  let mainCardContent = spriteGroup.mainCardContent!;
  {
    let counterpart = mainCardContent.counterpart;
    if (counterpart) {
      // Hide all content of card sprite proper besides title
      mainCardContent.element.style.opacity = '0';
      counterpart.element.style.zIndex =
        getComputedStyle(counterpartCard.element).zIndex + 1;
      counterpart.lockStyles();
      context.appendOrphan(counterpart);
      counterpart.setupAnimation('opacity', { to: 0, duration: duration });
      fadeOutSprites.push(mainCardContent.counterpart!);
    }
  }

  // Run these first
  await runAnimations(fadeOutSprites);

  // Hide counterpart
  if (mainCardContent.counterpart) {
    context.removeOrphan(mainCardContent.counterpart);
  }
  spriteGroup.card!.element.style.opacity = '1';
  context.removeOrphan(counterpartCard);

  // Card sprite proper resizes and moves together with title
  magicMove(
    {
      keptSprites: new Set([spriteGroup.card!]),
    } as Changeset,
    {
      duration,
    }
  );
  spriteGroup.card!.element.style.zIndex = '2';
  await runAnimations([spriteGroup.card!]);

  let fadeInSprites: Sprite[] = [];
  // Card sprite proper content fades in
  mainCardContent.element.style.opacity = '1';
  mainCardContent.setupAnimation('opacity', {
    from: 0,
    to: 1,
    duration: duration,
  });
  fadeInSprites.push(mainCardContent);

  await runAnimations(fadeInSprites);

  spriteGroup.model._state.transitionCompleted();
}

export async function expandedToMaxImages(
  context: IContext,
  spriteGroup: SpriteGroup,
  otherCards: SpriteGroup[]
) {
  // Put images in old positions
  // Move the card
  // Put images in new positions

  let duration = DEFAULT_DURATION;
  let images: Sprite[] = [];

  let fadeInSprites = otherCards
    .filter((group) => {
      return (
        spriteGroup.card!.element !== group.card!.element &&
        spriteGroup.card!.element.contains(group.card!.element)
      );
    })
    .map((v) => v.card!);
  fadeInSprites.forEach((card) => (card.element.style.opacity = '0'));

  spriteGroup.keptContent.forEach((s) => {
    s.setupAnimation('position', {
      duration,
      behavior: new LinearBehavior(),
      startX: -s.boundsDelta!.x + spriteGroup.card!.boundsDelta!.x,
      startY: -s.boundsDelta!.y + spriteGroup.card!.boundsDelta!.y,
      endX: -s.boundsDelta!.x + spriteGroup.card!.boundsDelta!.x + 5,
      endY: -s.boundsDelta!.y + spriteGroup.card!.boundsDelta!.y + 5,
    });
    images.push(s);
  });

  // Card sprite proper resizes and moves together with title
  magicMove(
    {
      keptSprites: new Set([spriteGroup.card!]),
    } as Changeset,
    {
      duration,
    }
  );
  spriteGroup.card!.element.style.zIndex = '2';

  await runAnimations([...images, spriteGroup.card!]);

  images.forEach((image) => {
    image.setupAnimation('position', {
      duration,
      behavior: new LinearBehavior(),
      startX: -image.boundsDelta!.x + spriteGroup.card!.boundsDelta!.x + 5,
      startY: -image.boundsDelta!.y + spriteGroup.card!.boundsDelta!.y + 5,
    });
  });

  await runAnimations(images);

  fadeInSprites.forEach((card) => (card.element.style.opacity = '1'));

  fadeInSprites.forEach((sprite) => {
    sprite.setupAnimation('opacity', {
      duration,
      from: 0,
      to: 1,
    });
  });

  await runAnimations(fadeInSprites);

  spriteGroup.model._state.transitionCompleted();
}

export async function maxToExpandedImages(
  context: IContext,
  spriteGroup: SpriteGroup,
  otherCards: SpriteGroup[]
) {
  // Put images in old positions
  // Move the card
  // Put images in new positions

  let duration = DEFAULT_DURATION;
  let behavior = new LinearBehavior();
  let images: Sprite[] = [];

  // Lock placeholder
  let placeholder = spriteGroup.placeholder;
  if (placeholder) {
    placeholder.lockStyles();
    placeholder.element.style.zIndex = '0';
    context.appendOrphan(placeholder);
    // FIXME?: This is a way of handling changes in the position of the placeholder
    // Because of other cards resizing
    placeholder.setupAnimation('position', {
      duration,
      behavior,
      startY: 0,
      endY:
        -placeholder.initialBounds!.relativeToContext.y +
        spriteGroup.card!.finalBounds!.relativeToContext.y,
    });
  }

  spriteGroup.card!.element.style.opacity = '0';
  let counterpart = spriteGroup.card!.counterpart!;
  context.appendOrphan(counterpart);
  counterpart.lockStyles();

  let fadeOutSprites = otherCards
    .filter((group) => {
      return (
        counterpart!.element !== group.card!.element &&
        counterpart!.element.contains(group.card!.element)
      );
    })
    .map((v) => v.card!);

  fadeOutSprites.forEach((sprite) => {
    sprite.setupAnimation('opacity', {
      duration,
      to: 0,
    });
  });

  await runAnimations(
    fadeOutSprites
      .concat([counterpart])
      .concat(placeholder ? [placeholder] : [])
  );

  spriteGroup.card!.element.style.opacity = '1';
  context.removeOrphan(counterpart);

  spriteGroup.keptContent.forEach((s) => {
    s.setupAnimation('position', {
      duration,
      behavior: new LinearBehavior(),
      startX: -s.boundsDelta!.x + spriteGroup.card!.boundsDelta!.x,
      startY: -s.boundsDelta!.y + spriteGroup.card!.boundsDelta!.y,
      // endX: spriteGroup.card!.boundsDelta!.x,
      // endY: spriteGroup.card!.boundsDelta!.y,
    });
    images.push(s);
  });

  let positionTransform = `translate(${-spriteGroup.card!.boundsDelta!
    .x}px, ${-spriteGroup.card!.boundsDelta!.y}px)`;
  let sizeTransform = `scaleY(${
    spriteGroup.card!.initialHeight! / spriteGroup.card!.finalHeight!
  }) scaleX(${
    spriteGroup.card!.initialWidth! / spriteGroup.card!.finalWidth!
  })`;

  spriteGroup.card!.element.style.transform = `${positionTransform} ${sizeTransform}`;
  spriteGroup.card!.element.style.transformOrigin = `top left`;
  spriteGroup.card!.element.style.setProperty(
    '--animation-scale-inversion-y',
    `${1 / (spriteGroup.card!.initialHeight! / spriteGroup.card!.finalHeight!)}`
  );

  // spriteGroup.card!.setupAnimation('size', {
  //   duration,
  //   behavior: new LinearBehavior(),
  //   startWidth: -spriteGroup.card!.finalBounds!.element.width,
  //   startHeight: -spriteGroup.card!.finalBounds!.element.height,
  //   endWidth: -spriteGroup.card!.finalBounds!.element.width,
  //   endHeight: -spriteGroup.card!.finalBounds!.element.height,
  // });

  await runAnimations([...images, spriteGroup.card!]);

  spriteGroup.card!.element.style.transform = '';
  spriteGroup.card!.element.style.transformOrigin = '';
  spriteGroup.card!.element.style.setProperty(
    '--animation-scale-inversion-y',
    ''
  );

  if (placeholder) {
    placeholder.element.style.zIndex = '0';
  }

  // Card sprite proper resizes and moves together with title
  spriteGroup.card?.setupAnimation('position', {
    duration,
    behavior,
  });
  spriteGroup.card?.setupAnimation('size', {
    duration,
    behavior,
    startWidth: spriteGroup.card.counterpart!.initialWidth,
  });

  // spriteGroup.card!.element.style.zIndex = '2';
  await runAnimations([spriteGroup.card!]);

  spriteGroup.model._state.transitionCompleted();
}

export async function simple(sprite: Sprite) {
  let behavior = new LinearBehavior();
  let duration = DEFAULT_DURATION;
  // position has to come before size so that we don't mess up movement w scale
  sprite.setupAnimation('position', {
    duration,
    behavior,
  });
  sprite.setupAnimation('size', {
    duration,
    behavior,
  });
  await runAnimations([sprite!]);
}

function expandedToMin() {}
function minToExpanded() {}

function justMove() {}
function placeholderIn() {}
function placeholderOut() {}
// function imageLayoutBeforeMove(){}
// function imageMoveBeforeLayout(){}
// function textToForm(){}
// function formToText(){}

function getCardId(sprite: Sprite) {
  let role = sprite.role;
  let id = sprite.id;

  if (role === 'image') {
    return id?.replace(/-image-\d$/, '');
  } else {
    return id?.replace('-' + role, '');
  }
}

function getStateChange(
  cardSprite: Sprite,
  transition: [CardState, CardState] | []
): 'STATIC' | 'MAX -> EXPANDED' | 'EXPANDED -> MAX' | 'MAX -> MIN' {
  if (!transition.length) return 'STATIC';

  if (transition[0] === 'MIN' || transition[1] === 'MIN') return 'STATIC';

  if (transition[0] === 'MAX') {
    return `MAX -> EXPANDED`;
  }

  if (transition[0] === 'EXPANDED') {
    return `EXPANDED -> MAX`;
  }

  return 'STATIC';
  // let counterpart = cardSprite.counterpart;

  // if (!counterpart) {
  //   return 'STATIC';
  // }

  // let counterpartState = [
  //   CARD_STATES.EXPANDED,
  //   CARD_STATES.MAX,
  //   CARD_STATES.MIN,
  // ].find((v) => counterpart?.element.className.includes(v));
  // let spriteState = [
  //   CARD_STATES.EXPANDED,
  //   CARD_STATES.MAX,
  //   CARD_STATES.MIN,
  // ].find((v) => cardSprite.element.className.includes(v));
  // if (
  //   spriteState === counterpartState ||
  //   (spriteState !== 'MAX' && counterpartState !== 'MAX')
  // ) {
  //   return 'STATIC';
  // } else {
  //   return `${counterpartState} -> ${spriteState}` as
  //     | 'MAX -> EXPANDED'
  //     | 'EXPANDED -> MAX'
  //     | 'MAX -> MIN';
  // }
}

export function groupSprites(
  changeset: Changeset,
  transitionStateLookup: Record<string, [CardState, CardState] | []>,
  cardData: Record<string, Card>
) {
  let groupsOfSprites: Record<string, SpriteGroup> = {};

  for (let sprite of changeset.keptSprites) {
    let id = getCardId(sprite);
    groupsOfSprites[id as string] ??= {
      state: 'STATIC',
      model: cardData[id!]!,
      card: null,
      mainCardContent: null,
      title: null,
      placeholder: null,
      keptContent: new Set(),
      insertedContent: new Set(),
      removedContent: new Set(),
    };
    let group = groupsOfSprites[id as string]!;
    if (sprite.role === 'card') {
      group.card = sprite;
      group.state = getStateChange(sprite, transitionStateLookup[id!]!);
    } else if (sprite.role === 'card-content') {
      group.mainCardContent = sprite;
    } else if (sprite.role === 'title') {
      group.title = sprite;
    } else if (sprite.role === 'placeholder') {
      group.placeholder = sprite;
    } else {
      group.keptContent.add(sprite);
    }
  }
  for (let sprite of changeset.insertedSprites) {
    let id = getCardId(sprite);
    groupsOfSprites[id as string] ??= {
      state: 'INSERTED',
      model: cardData[id!]!,
      card: null,
      mainCardContent: null,
      title: null,
      placeholder: null,
      keptContent: new Set(),
      insertedContent: new Set(),
      removedContent: new Set(),
    };
    let group = groupsOfSprites[id as string]!;
    if (sprite.role === 'card') {
      group.card = sprite;
      group.state = 'INSERTED';
    } else if (sprite.role === 'card-content') {
      group.mainCardContent = sprite;
    } else if (sprite.role === 'title') {
      group.title = sprite;
    } else if (sprite.role === 'placeholder') {
      group.placeholder = sprite;
    } else {
      group.insertedContent.add(sprite);
    }
  }

  for (let sprite of changeset.removedSprites) {
    let id = getCardId(sprite);
    groupsOfSprites[id as string] ??= {
      state: 'REMOVED',
      model: cardData[id!]!,
      card: null,
      mainCardContent: null,
      title: null,
      placeholder: null,
      keptContent: new Set(),
      insertedContent: new Set(),
      removedContent: new Set(),
    };
    let group = groupsOfSprites[id as string]!;
    if (sprite.role === 'card') {
      group.card = sprite;
      group.state = 'REMOVED';
    } else if (sprite.role === 'card-content') {
      group.mainCardContent = sprite;
    } else if (sprite.role === 'title') {
      group.title = sprite;
    } else if (sprite.role === 'placeholder') {
      group.placeholder = sprite;
    } else {
      group.removedContent.add(sprite);
    }
  }

  return groupsOfSprites;
}
