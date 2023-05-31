import { primitive, Component, CardBase, useIndexBasedKey } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

let domPurify: DOMPurify.DOMPurifyI;

function toHtml(model: string | null) {
  if (!domPurify) {
    let jsdom = (globalThis as any).jsdom;
    domPurify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
  }

  return model ? domPurify.sanitize(marked(model)) : '';
}

export default class MarkdownCard extends CardBase {
  static [primitive]: string;
  static [useIndexBasedKey]: never;

  toHtml(markdown: string) {
    //if card is rendered on server-side (using fastboot)
    //then jsdom is used to instatiate DOMPurify
    let jsdom = (globalThis as any).jsdom;
    let purify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
    return String(markdown) ? purify.sanitize(marked(markdown)) : '';
  }

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div>
        {{{toHtml @model}}}
      </div>
    </template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div>
        {{{toHtml @model}}}
      </div>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput 
        class='boxel-text-area' 
        @multiline={{true}} 
        @value={{@model}} 
        @onInput={{@set}} />
    </template>
  };
}
