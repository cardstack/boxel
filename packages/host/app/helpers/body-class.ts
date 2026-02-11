import Helper from '@ember/component/helper';

export default class BodyClass extends Helper {
  compute([className]: [string]) {
    document.body.classList.add(className);
  }
}
