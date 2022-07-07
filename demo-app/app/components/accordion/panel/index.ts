import Component from '@glimmer/component';
import { action } from '@ember/object';
import Changeset from 'animations-experiment/models/changeset';
import Sprite, { SpriteType } from 'animations-experiment/models/sprite';
import runAnimations from 'animations-experiment/utils/run-animations';

//import LinearBehavior from 'animations-experiment/behaviors/linear';
import SpringBehavior from 'animations-experiment/behaviors/spring';

// hasOrphan does not work. We cannot compare orphan parents properly
// We probably need to mark orphan elements with data attributes
// one from the sprite identifier
// one as a custom identifier, this is more for the cloning side of things
// And check for matching based on that
// We also should probably have a good way to clean up orphans that no longer belong to a context
// If a changeset passed to a context does not have a sprite matching an orphan, should we remove it?
//   - probably not. removed sprites will not appear again in the changeset
// If the same changeset has a non-removed sprite that matches the orphan, should we remove it?
//   - yes, unless the user is doing cloning things.
// If another changeset has a non-removed sprite that matches the orphan, should we remove it?
//   - unsure
// Should we differentiate opt-in non-removed orphans from removed sprite orphans?
//   - at first glance, yes.
// Who should be responsible for this cleanup?
//   - user first. then when we're clearer about what needs to happen, library
// Is that a user concern or a library concern?
// An orphan should be removed if any context has a matching non-removed sprite
// It's up to the context of that changeset to decide whether or not a replacement orphan is set up

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
      console.log('kept panel', nonOrphanPanel);
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
