export default class Sprite {
  element;
  id;
  initialBounds = null;
  finalBounds = null;

  constructor(element) {
    this.element = element;
  }
}
