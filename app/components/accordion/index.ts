import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import Changeset from 'animations/models/changeset';
import Sprite, { SpriteType } from 'animations/models/sprite';
import LinearBehavior from 'animations/behaviors/linear';

// TODO:
// - different content length
// - router
// - rename things
export default class Accordion extends Component {
  items = [
    {
      id: 'pi',
      title: 'Personal Information',
    },
    {
      id: 'mi',
      title: 'More Information',
    },
    {
      id: 'emi',
      title: 'Even More Information',
    },
    {
      id: 'dsti',
      title: "Don't Stop The Information",
    },
  ];

  @tracked isFocused = false;
  @tracked currentItem = '';

  @action
  handleFocusin(e: Event) {
    if (e.target instanceof HTMLElement) {
      if (e.target.dataset.isAccordionTrigger) {
        this.isFocused = true;
      }
    }
  }

  @action
  handleFocusout(e: Event) {
    if (e.target instanceof HTMLElement) {
      if (e.target.dataset.isAccordionTrigger) {
        this.isFocused = false;
      }
    }
  }

  @action
  handleTrigger(target: string) {
    this.currentItem = target;
  }

  @action async resizePanels(changeset: Changeset) {
    let duration = 750;
    let { context } = changeset;
    let bodies = changeset.spritesFor({
      type: SpriteType.Kept,
      role: 'accordion-panel-body',
    });
    let revealedPanel: Sprite | undefined, hiddenPanel: Sprite | undefined;

    let revealedPanelContentGroup = changeset.spritesFor({
      type: SpriteType.Inserted,
      role: 'accordion-panel-content',
    });
    if (revealedPanelContentGroup.size) {
      revealedPanel = [...revealedPanelContentGroup][0];
    }
    let hiddenPanelContentGroup = changeset.spritesFor({
      type: SpriteType.Removed,
      role: 'accordion-panel-content',
    });
    if (hiddenPanelContentGroup.size) {
      hiddenPanel = [...hiddenPanelContentGroup][0];
    }

    let spritesToAnimate = [];

    if (revealedPanel) {
      revealedPanel.setupAnimation('size', {
        startWidth: revealedPanel.element.clientWidth,
        startHeight: 0,
        duration,
        behavior: new LinearBehavior(),
      });
      spritesToAnimate.push(revealedPanel);
    }

    if (hiddenPanel) {
      context.appendOrphan(hiddenPanel);
      hiddenPanel.lockStyles();
      hiddenPanel.setupAnimation('size', {
        startWidth: hiddenPanel.element.clientWidth,
        startHeight: hiddenPanel.element.clientHeight,
        endWidth: hiddenPanel.element.clientWidth,
        duration,
        behavior: new LinearBehavior(),
      });

      let revealedPanelBounds = revealedPanel!.finalBounds!.relativeToContext;
      let hiddenPanelBounds = hiddenPanel!.initialBounds!.relativeToContext;
      hiddenPanel.setupAnimation('position', {
        startY:
          revealedPanelBounds.top > hiddenPanelBounds.top
            ? hiddenPanelBounds.top
            : 0,
        endY:
          revealedPanelBounds.top > hiddenPanelBounds.top
            ? hiddenPanelBounds.top
            : revealedPanelBounds.height,
        duration,
        behavior: new LinearBehavior(),
      });
      spritesToAnimate.push(hiddenPanel);
    }

    if (bodies.size) {
      for (let sprite of [...bodies]) {
        sprite.setupAnimation('size', {
          startHeight: sprite.initialBounds?.element.height,
          endHeight: sprite.finalBounds?.element.height,
          duration,
          behavior: new LinearBehavior(),
        });
        spritesToAnimate.push(sprite);
      }
    }

    await Promise.all(
      spritesToAnimate.map((sprite) => sprite.startAnimation().finished)
    );
  }
}
