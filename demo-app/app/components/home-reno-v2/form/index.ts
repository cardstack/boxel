import Component from '@glimmer/component';
import { SpriteType } from 'animations-experiment/models/sprite';
import { Changeset } from 'animations-experiment/models/changeset';
import { simple } from '../transitions';

export default class Form extends Component {
  async transition(changeset: Changeset) {
    let card = changeset.spriteFor({
      role: 'card',
    });
    if (card) await simple(card);

    let placeholder = changeset.spriteFor({
      role: 'placeholder',
    });
    if (placeholder?.type === SpriteType.Removed) {
      placeholder.lockStyles();
      changeset.context.appendOrphan(placeholder);
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
}
