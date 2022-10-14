import Component from '@glimmer/component';
import { Rule } from 'animations-experiment/models/sprite-tree';
import Sprite, { SpriteType } from 'animations-experiment/models/sprite';
import { AnimationDefinition } from 'animations-experiment/models/transition-runner';
import { createRole, dataFromRole, GROUP_TYPES } from './constants';
import LinearBehavior from 'animations-experiment/behaviors/linear';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import SpringBehavior from 'animations-experiment/behaviors/spring';

const DURATIONS = {
  BLIP: 16,
  LARGE: 500,
};

export default class RulesComponent extends Component {
  @tracked showLevelOne = false;
  @tracked editingLevelOne = false;
  levelOneId = crypto.randomUUID();

  @tracked showLevelTwo = false;
  levelTwoId = crypto.randomUUID();

  @tracked showSmall = false;
  smallId = crypto.randomUUID();

  @tracked showCard = false;
  @tracked showLevelTwoCard = false;

  get states() {
    let small = this.showSmall ? 'infront' : 'none';
    if (this.showLevelOne && !this.showLevelTwo) {
      return {
        levelOne: 'infront',
        levelTwo: 'none',
        small,
      };
    } else if (this.showLevelOne && this.showLevelTwo) {
      return {
        levelOne: 'behind',
        levelTwo: 'infront',
        small,
      };
    } else {
      return {
        levelOne: 'none',
        levelTwo: 'none',
        small,
      };
    }
  }

  rules: Rule[] = [
    {
      /* 
        match the large modal cards 
        - entering
        - exiting
        - scaling down
        - scaling up
        */
      match(sprites: Sprite[]) {
        let remaining = [];
        let modalCardSprites: Record<string, Record<string, Sprite>> = {};
        for (let sprite of sprites) {
          // this is probably easier when it's first-class rather than extracted from a string
          // also probably easier when this function is provided query/grouping utilities
          let { groupType, id, subType } = dataFromRole(sprite.role!);
          let isLargeModalCardSprite =
            groupType === GROUP_TYPES.LARGE_MODAL_CARD;
          if (isLargeModalCardSprite) {
            modalCardSprites[id] = modalCardSprites[id] ?? {};
            modalCardSprites[id]![subType] = sprite;
          } else {
            remaining.push(sprite);
          }
        }

        let entering = [];
        let exiting = [];
        for (let groupId in modalCardSprites) {
          let group = modalCardSprites[groupId]!;
          let overlaySprite = group['overlay']!;
          let cardSprite = group['card']!;

          if (cardSprite.type === SpriteType.Removed) {
            // slide down, fade out the overlay
            exiting.push({
              parallel: [
                {
                  sprites: new Set([overlaySprite]),
                  properties: {
                    opacity: {
                      to: 0,
                    },
                  },
                  timing: {
                    behavior: new LinearBehavior(),
                    duration: DURATIONS.LARGE,
                  },
                },
                {
                  sprites: new Set([cardSprite]),
                  properties: {
                    position: {
                      endY: 200,
                    },
                    opacity: {
                      to: 0,
                    },
                  },
                  timing: {
                    behavior: new LinearBehavior(),
                    duration: DURATIONS.LARGE,
                  },
                },
              ],
            });
          } else if (cardSprite.type === SpriteType.Inserted) {
            // slide up, fade in the overlay
            entering.push({
              sequence: [
                {
                  sprites: new Set([cardSprite]),
                  properties: {
                    opacity: { from: 0, to: 1 },
                  },
                  timing: {
                    behavior: new LinearBehavior(),
                    duration: DURATIONS.BLIP,
                  },
                },
                {
                  parallel: [
                    {
                      sprites: new Set([overlaySprite]),
                      properties: {
                        opacity: {
                          from: 0,
                        },
                      },
                      timing: {
                        behavior: new LinearBehavior(),
                        duration: DURATIONS.LARGE,
                      },
                    },
                    {
                      sprites: new Set([cardSprite]),
                      properties: {
                        position: {
                          startY: 200,
                        },
                      },
                      timing: {
                        behavior: new LinearBehavior(),
                        duration: DURATIONS.LARGE,
                      },
                    },
                  ],
                },
              ],
            });
          } else if (cardSprite.type === SpriteType.Kept) {
            if (
              (
                [
                  'left',
                  'right',
                  'top',
                  'bottom',
                  'x',
                  'y',
                  'width',
                  'height',
                ] as (keyof DOMRect)[]
              ).every(
                (k) =>
                  Math.abs(
                    (cardSprite.initialBounds!.relativeToContext![
                      k
                    ] as number) -
                    (cardSprite.finalBounds!.relativeToContext![k] as number)
                  ) < 0.5
              )
            ) {
              Object.values(group).forEach((sprite) => remaining.push(sprite));
              continue;
            }

            // TODO: For some reason Safari thinks some inserted sprites are kept (on 2nd run)
            let stuff = dataFromRole(cardSprite.role!);
            let state = stuff.state;
            if (state === 'behind') {
              exiting.push({
                sequence: [
                  {
                    sprites: new Set([cardSprite]),
                    properties: {
                      position: {},
                      size: {},
                    },
                    timing: {
                      behavior: new LinearBehavior(),
                      duration: DURATIONS.LARGE,
                    },
                  },
                ],
              });
            } else {
              entering.push({
                parallel: [
                  {
                    sprites: new Set([overlaySprite]),
                    properties: {
                      opacity: {},
                    },
                    timing: {
                      behavior: new LinearBehavior(),
                      duration: DURATIONS.LARGE,
                    },
                  },
                  {
                    sprites: new Set([cardSprite]),
                    properties: {
                      position: {},
                      size: {},
                    },
                    timing: {
                      behavior: new LinearBehavior(),
                      duration: DURATIONS.LARGE,
                    },
                  },
                ],
              });
            }
          }
        }

        let claimed: AnimationDefinition[] = [];
        if (!exiting.length) {
          claimed = [
            {
              timeline: {
                parallel: entering,
              },
            },
          ];
        } else {
          claimed = [
            {
              timeline: {
                sequence: [{ parallel: exiting }, { parallel: entering }],
              },
            },
          ];
        }

        return {
          remaining,
          claimed,
        };
      },
    },
    {
      /* 
        match the small modal cards 
        - entering
        - exiting
        - resizing
        */
      match(sprites: Sprite[]) {
        let remaining = [];
        let modalCardSprites: Record<string, Record<string, Sprite>> = {};
        for (let sprite of sprites) {
          // this is probably easier when it's first-class rather than extracted from a string
          // also probably easier when this function is provided query/grouping utilities
          let { groupType, id, subType } = dataFromRole(sprite.role!);
          let isLargeModalCardSprite =
            groupType === GROUP_TYPES.SMALL_MODAL_CARD;
          if (isLargeModalCardSprite) {
            modalCardSprites[id] = modalCardSprites[id] ?? {};
            modalCardSprites[id]![subType] = sprite;
          } else {
            remaining.push(sprite);
          }
        }

        let entering = [];
        let exiting = [];
        for (let groupId in modalCardSprites) {
          let group = modalCardSprites[groupId]!;
          let overlaySprite = group['overlay']!;
          let cardSprite = group['card']!;

          if (cardSprite.type === SpriteType.Removed) {
            // slide down, fade out the overlay
            exiting.push({
              parallel: [
                {
                  sprites: new Set([overlaySprite]),
                  properties: {
                    opacity: {
                      to: 0,
                    },
                  },
                  timing: {
                    behavior: new LinearBehavior(),
                    duration: DURATIONS.LARGE,
                  },
                },
                {
                  sprites: new Set([cardSprite]),
                  properties: {
                    opacity: {
                      to: 0,
                    },
                  },
                  timing: {
                    behavior: new LinearBehavior(),
                    duration: DURATIONS.LARGE,
                  },
                },
              ],
            });
          } else if (cardSprite.type === SpriteType.Inserted) {
            // slide up, fade in the overlay
            entering.push({
              sequence: [
                {
                  parallel: [
                    {
                      sprites: new Set([cardSprite]),
                      properties: {
                        opacity: { from: 0, to: 1 },
                      },
                      timing: {
                        behavior: new LinearBehavior(),
                        duration: DURATIONS.BLIP,
                      },
                    },
                  ],
                },
                {
                  parallel: [
                    {
                      sprites: new Set([overlaySprite]),
                      properties: {
                        opacity: {
                          from: 0,
                        },
                      },
                      timing: {
                        behavior: new LinearBehavior(),
                        duration: DURATIONS.LARGE,
                      },
                    },
                    {
                      sprites: new Set([cardSprite]),
                      properties: {
                        size: {
                          startWidth:
                            cardSprite.finalBounds!.element.width * 1.5,
                          startHeight:
                            cardSprite.finalBounds!.element.height * 1.5,
                        },
                      },
                      timing: {
                        behavior: new LinearBehavior(),
                        duration: DURATIONS.LARGE,
                      },
                    },
                  ],
                },
              ],
            });
          } else if (cardSprite.type === SpriteType.Kept) {
            entering.push({
              parallel: [
                {
                  sprites: new Set([overlaySprite]),
                  properties: {
                    opacity: {},
                  },
                  timing: {
                    behavior: new LinearBehavior(),
                    duration: DURATIONS.LARGE,
                  },
                },
                {
                  sprites: new Set([cardSprite]),
                  properties: {
                    size: {},
                  },
                  timing: {
                    behavior: new LinearBehavior(),
                    duration: DURATIONS.LARGE,
                  },
                },
              ],
            });
          }
        }

        let claimed: AnimationDefinition[] = [];
        if (!exiting.length) {
          claimed = [
            {
              timeline: {
                parallel: entering,
              },
            },
          ];
        } else {
          claimed = [
            {
              timeline: {
                sequence: [{ parallel: exiting }, { parallel: entering }],
              },
            },
          ];
        }

        return {
          remaining,
          claimed,
        };
      },
    },
    {
      /* 
        match fields
      */
      match(sprites: Sprite[]) {
        let remaining = [];
        let fields = [];
        for (let sprite of sprites) {
          // this is probably easier when it's first-class rather than extracted from a string
          // also probably easier when this function is provided query/grouping utilities
          let { subType } = dataFromRole(sprite.role!);
          let isField = subType === 'field';
          if (isField) {
            fields.push(sprite);
          } else {
            remaining.push(sprite);
          }
        }

        let claimed: AnimationDefinition[] = fields.map((v) => ({
          timeline: {
            parallel: [
              {
                sprites: new Set([v]),
                properties: {
                  position: {},
                },
                timing: {
                  behavior: new SpringBehavior(),
                },
              },
            ],
          },
        }));

        return {
          remaining,
          claimed,
        };
      },
    },
    {
      match(sprites: Sprite[]) {
        let remaining = [];
        let breadcrumbBars = [];
        for (let sprite of sprites) {
          // this is probably easier when it's first-class rather than extracted from a string
          // also probably easier when this function is provided query/grouping utilities
          let { groupType } = dataFromRole(sprite.role!);
          let isField = groupType === GROUP_TYPES.BREADCRUMB_BAR;
          if (isField) {
            breadcrumbBars.push(sprite);
          } else {
            remaining.push(sprite);
          }
        }
        let claimed: AnimationDefinition[] = breadcrumbBars.map((v) => {
          let position;
          if (v.type === SpriteType.Removed) {
            position = {
              endY: -200,
            };
          } else if (v.type === SpriteType.Inserted) {
            position = {
              startY: -200,
            };
          } else {
            position = {};
          }
          return {
            timeline: {
              parallel: [
                {
                  sprites: new Set([v]),
                  properties: {
                    position,
                  },
                  timing: {
                    behavior: new LinearBehavior(),
                    duration: DURATIONS.LARGE,
                    // TODO: this needs to be expressed as happening at the same time as the card coming in
                    delay: v.type === SpriteType.Removed ? 0 : DURATIONS.LARGE,
                  },
                },
              ],
            },
          };
        });

        return {
          remaining,
          claimed,
        };
      },
    },
    {
      match(sprites: Sprite[]) {
        let remaining = [];
        let breadcrumbBars = [];
        for (let sprite of sprites) {
          // this is probably easier when it's first-class rather than extracted from a string
          // also probably easier when this function is provided query/grouping utilities
          let { groupType } = dataFromRole(sprite.role!);
          let isOptionCard = groupType === GROUP_TYPES.OPTION_CARD;
          if (isOptionCard && sprite.type === SpriteType.Kept) {
            breadcrumbBars.push(sprite);
          } else {
            remaining.push(sprite);
          }
        }
        let claimed: AnimationDefinition[] = breadcrumbBars.map((v) => {
          return {
            timeline: {
              parallel: [
                {
                  sprites: new Set([v]),
                  properties: {
                    position: {},
                  },
                  timing: {
                    behavior: new LinearBehavior(),
                    duration: DURATIONS.LARGE,
                    // TODO: this needs to be expressed as happening at the same time as the card coming in
                    delay: v.type === SpriteType.Removed ? 0 : DURATIONS.LARGE,
                  },
                },
              ],
            },
          };
        });

        return {
          remaining,
          claimed,
        };
      },
    },
  ];

  get fieldRole() {
    return createRole({
      groupType: GROUP_TYPES.LARGE_MODAL_CARD,
      id: this.levelOneId,
      subType: 'field',
      state: 'N/A',
    });
  }

  get breadcrumbBarRole() {
    return createRole({
      groupType: GROUP_TYPES.BREADCRUMB_BAR,
      id: 'breadcrumb-bar-singleton',
      subType: 'breadcrumb-bar',
      state: 'N/A',
    });
  }

  get optionCardRole() {
    return createRole({
      groupType: GROUP_TYPES.OPTION_CARD,
      id: 'option-card-singleton',
      subType: 'option-card',
      state: 'N/A',
    });
  }

  @action toggleShowCard() {
    this.showCard = !this.showCard;
    this.showSmall = false;
  }

  @action toggleShowLevelTwoCard() {
    this.showLevelTwoCard = !this.showLevelTwoCard;
  }

  @action editLevelOne() {
    this.editingLevelOne = !this.editingLevelOne;
  }

  @action toggleSmall() {
    this.showSmall = !this.showSmall;
    this.showCard = false;
  }

  @action toggleLevelOne() {
    this.showLevelOne = !this.showLevelOne;
    if (!this.showLevelOne) {
      this.showSmall = false;
      this.showLevelTwo = false;
      this.editingLevelOne = false;
      this.showCard = false;
      this.showLevelTwoCard = false;
    }
  }

  @action toggleLevelTwo() {
    this.showLevelTwo = !this.showLevelTwo;
  }
}
