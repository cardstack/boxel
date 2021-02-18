import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
export default class ApplicationController extends Controller {
  @tracked contextHasPadding = false;
  @tracked showContentBeforeContext = false;
  @tracked showContentBefore = false;
  @tracked showSpriteA = true;
  @tracked showSpriteB = true;
  @tracked spriteCPosition = 0;
  @tracked showContentAfter = true;
  @action toggleSpritesAandB() {
    this.showSpriteA = !this.showSpriteA;
    this.showSpriteB = !this.showSpriteB;
  }
  @action moveSpriteC() {
    this.spriteCPosition = (this.spriteCPosition + 1) % 2;
  }
}
