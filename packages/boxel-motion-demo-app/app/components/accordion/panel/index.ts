import LinearBehavior from '@cardstack/boxel-motion/behaviors/linear';
import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import Sprite, { SpriteType } from '@cardstack/boxel-motion/models/sprite';
import { action } from '@ember/object';
import Component from '@glimmer/component';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    id: string;
    expanded: boolean;
    trigger: (id: string) => void;
    title: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fields: any[];
  };
}
export default class AccordionPanel extends Component<Signature> {
  @action resizePanels(changeset: Changeset) {
    let behavior = new LinearBehavior(); //new SpringBehavior({ overshootClamping: true });
    let duration = behavior instanceof SpringBehavior ? undefined : 3200;
    let containers = changeset.spritesFor({
      type: SpriteType.Kept,
      role: 'accordion-panel-container',
    });
    let hiddenPanel: Sprite | undefined;

    let hiddenPanelContentGroup = changeset.spritesFor({
      type: SpriteType.Removed,
      role: 'accordion-panel-content',
    });
    if (hiddenPanelContentGroup.size) {
      hiddenPanel = [...hiddenPanelContentGroup][0];
    }

    return {
      timeline: {
        type: 'parallel',
        animations: [
          ...(hiddenPanel
            ? [
                {
                  sprites: new Set([hiddenPanel]),
                  properties: {
                    wait: {},
                  },
                  timing: {
                    duration,
                  },
                },
              ]
            : []),
          {
            sprites: containers,
            properties: {
              height: {},
            },
            timing: {
              behavior,
              duration,
            },
          },
        ],
      },
    };
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Accordion::Panel': typeof AccordionPanel;
  }
}
