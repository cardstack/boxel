import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
export default class ApplicationController extends Controller {
  @tracked showContentBeforeContext = false;
  @tracked showContentBefore = false;
  @tracked showSpriteA = true;
  @tracked showSpriteB = true;
  @tracked showContentAfter = true;
  @action toggleBothSprites() {
    this.showSpriteA = !this.showSpriteA;
    this.showSpriteB = !this.showSpriteB;
  }
}
