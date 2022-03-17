import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

// TODO:
// - different content length
// - router
// - rename things
export default class Accordion extends Component {
  items = [
    {
      id: 'pi',
      title: 'Personal Information',
    },
    {
      id: 'mi',
      title: 'More Information',
    },
    {
      id: 'emi',
      title: 'Even More Information',
    },
    {
      id: 'dsti',
      title: "Don't Stop The Information",
    },
  ];

  @tracked isFocused = false;
  @tracked currentItem = '';

  @action
  handleFocusin(e: Event) {
    if (e.target instanceof HTMLElement) {
      if (e.target.dataset.isAccordionTrigger) {
        this.isFocused = true;
      }
    }
  }

  @action
  handleFocusout(e: Event) {
    if (e.target instanceof HTMLElement) {
      if (e.target.dataset.isAccordionTrigger) {
        this.isFocused = false;
      }
    }
  }

  @action
  handleTrigger(target: string) {
    this.currentItem = target;
  }
}
