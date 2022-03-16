import Component from '@glimmer/component';
import { action } from '@ember/object';
import magicMove from 'animations/transitions/magic-move';
import Changeset from 'animations/models/changeset';

export default class extends Component {
  @action resizePanels(changeset: Changeset) {
    return magicMove(changeset);
  }
}
