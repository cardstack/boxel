import { primitive, Component, CardBase, useIndexBasedKey } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export default class MarkdownCard extends CardBase {
  static [primitive]: string;
  static [useIndexBasedKey]: never;

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      {{{this.html}}}
    </template>

    get html() {
      //if card is rendered on server-side (using fastboot)
      //then jsdom is used to instatiate DOMPurify
      let jsdom = (globalThis as any).jsdom;
      let purify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
      return this.args.model ? purify.sanitize(marked(this.args.model)) : '';
    }
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{{this.html}}}
    </template>

    get html() {
      //if card is rendered on server-side (using fastboot)
      //then jsdom is used to instatiate DOMPurify
      let jsdom = (globalThis as any).jsdom;
      let purify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
      return this.args.model ? purify.sanitize(marked(this.args.model)) : '';
    }
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput @value={{@model}} @onInput={{@set}} />
    </template>
  };
}
