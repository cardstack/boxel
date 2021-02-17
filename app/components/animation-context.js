import Component from '@glimmer/component';

import { action } from '@ember/object';

export default class AnimationContextComponent extends Component {
  sprites = [];

  registerSprite(sprite) {
    console.log('Adding sprite:', sprite);
    this.sprites.addObject(sprite);
  }

  removeSprite(sprite) {
    console.log('Removing sprite:', sprite);
    this.sprites.removeObject(sprite);
  }

  @action
  onDomChange() {
    this.sprites.forEach(sprite => sprite.handleDomChange());
  }
}
