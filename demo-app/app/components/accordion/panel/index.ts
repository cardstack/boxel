import Component from '@glimmer/component';
import { action } from '@ember/object';
import Changeset from 'animations-experiment/models/changeset';
import Sprite, { SpriteType } from 'animations-experiment/models/sprite';
import runAnimations from 'animations-experiment/utils/run-animations';

//import LinearBehavior from 'animations-experiment/behaviors/linear';
import SpringBehavior from 'animations-experiment/behaviors/spring';

export default class AccordionPanel extends Component {
  @action async resizePanels(changeset: Changeset) {
    let behavior = new SpringBehavior({ overshootClamping: true });
    let duration = behavior instanceof SpringBehavior ? undefined : 320;
    let { context } = changeset;
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

    let spritesToAnimate = [];

    if (hiddenPanel) {
      // TODO: might be nice to detect this automatically in the appendOrphan function
      if (!context.hasOrphan(hiddenPanel)) {
        context.appendOrphan(hiddenPanel);

        // TODO: something is weird here when interrupting an interruped animation
        hiddenPanel.lockStyles();
      }
    }

    let nonOrphanPanel: Sprite | undefined;
    let keptPanelContentGroup = changeset.spritesFor({
      type: SpriteType.Kept,
      role: 'accordion-panel-content',
    });
    let insertedPanelContentGroup = changeset.spritesFor({
      type: SpriteType.Inserted,
      role: 'accordion-panel-content',
    });
    if (keptPanelContentGroup.size) {
      nonOrphanPanel = [...keptPanelContentGroup][0];
    } else if (insertedPanelContentGroup.size) {
      nonOrphanPanel = [...insertedPanelContentGroup][0];
    }

    if (nonOrphanPanel) {
      if (context.hasOrphan(nonOrphanPanel)) {
        context.removeOrphan(nonOrphanPanel);
      }
    }

    if (containers.size) {
      for (let sprite of [...containers]) {
        sprite.setupAnimation('size', {
          startHeight: sprite.initialBounds?.element.height,
          endHeight: sprite.finalBounds?.element.height,
          duration,
          behavior,
        });
        spritesToAnimate.push(sprite);
      }
    }

    await runAnimations(spritesToAnimate);
  }
}
