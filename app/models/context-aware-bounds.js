export default class ContextAwareBounds {
  constructor({ element, contextElement }) {
    this.element = element;
    this.parent = contextElement;
  }

  get relativeToContext() {
    return {
      left: this.element.left - this.parent.left,
      top: this.element.top - this.parent.top,
    };
  }

  isEqualTo(other) {
    let parentLeftChange = other.parent.left - this.parent.left;
    let parentTopChange = other.parent.top - this.parent.top;

    return (
      other.element.left - this.element.left - parentLeftChange === 0 &&
      other.element.top - this.element.top - parentTopChange === 0
    );
  }
}
