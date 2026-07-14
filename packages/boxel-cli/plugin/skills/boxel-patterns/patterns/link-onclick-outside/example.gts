import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';

// 🧩 PATTERN: onClickOutside modifier.
//
// Promote this to a realm-shared utility — the catalog ships the same
// implementation in two files, so it's worth one canonical copy.

const onClickOutside = modifier(
  (element: HTMLElement, positional: unknown[]) => {
    const callback = positional[0] as () => void;
    const handler = (event: MouseEvent) => {
      if (!element.contains(event.target as Node)) {
        callback();
      }
    };
    // 🎯 The 50ms delay is the critical bit — without it, the mousedown
    //     that opened the popover also closes it.
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  },
);

// === Usage in a popover ===============================================

interface Sig {
  Element: HTMLDivElement;
  Blocks: { trigger: []; content: [] };
}

export class Popover extends Component<Sig> {
  @tracked isOpen = false;
  @action toggle() { this.isOpen = !this.isOpen; }
  @action close()  { this.isOpen = false; }

  <template>
    <div class='popover-host'>
      <button type='button' {{on 'click' this.toggle}}>{{yield to='trigger'}}</button>

      {{#if this.isOpen}}
        <div class='popover' {{onClickOutside (fn this.close)}}>
          {{yield to='content'}}
        </div>
      {{/if}}
    </div>
  </template>
}
