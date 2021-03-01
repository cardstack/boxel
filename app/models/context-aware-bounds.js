export default class ContextAwareBounds {
  constructor({ element, contextElement }) {
    this.element = element;
    this.parent = contextElement;
  }

  get relativeToContext() {
    let { element, parent } = this;
    return {
      left: element.left - parent.left,
      top: element.top - parent.top,
      width: element.width,
      height: element.height,
    };
  }

  relativeToPosition({ left, top }) {
    let { element } = this;
    return {
      left: this.element.left - left,
      top: this.element.top - top,
      width: element.width,
      height: element.height,
    };
  }

  isEqualTo(other) {
    let parentLeftChange = other.parent.left - this.parent.left;
    let parentTopChange = other.parent.top - this.parent.top;

    return (
      other.element.left - this.element.left - parentLeftChange === 0 &&
      other.element.top - this.element.top - parentTopChange === 0 &&
      other.element.width - this.element.width === 0 &&
      other.element.height - this.element.height === 0
    );
  }
}
