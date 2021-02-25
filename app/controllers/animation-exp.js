import Controller from '@ember/controller';
import { action } from '@ember/object';

export default class AnimationExpController extends Controller {
  @action animate() {
    let el = document.querySelector('#ball');

    let animation = el.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: `translate(960px,960px)` }
      ],
      {
        duration: 5000
      }
    );

    setTimeout(() => {
      console.log(el.getBoundingClientRect());
    }, 2500);
  }
}
