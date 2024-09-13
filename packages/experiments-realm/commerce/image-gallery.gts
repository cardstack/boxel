import Component from '@glimmer/component';
import { BoxComponent } from 'https://cardstack.com/base/card-api';

import { cn } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Args: {
    images?: BoxComponent[]; //fitted components
  };
  Element: HTMLElement;
}

export default class ImageGallery extends Component<Signature> {
  <template>
    <div class='image-gallery'>

      {{#each @images as |image|}}
        <div class='gallery-item'>
          <image style='width:100%;height:100%' />
        </div>
      {{/each}}
    </div>

    <style>
      .image-gallery {
        display: flex;
        gap: 10px;
      }
      .gallery-item {
        width: 150px;
        height: 100px;
        background-color: #eee;
        border-radius: 5px;
      }
    </style>
  </template>
}

export class ImageLayout extends Component<{
  Args: {
    images?: BoxComponent[];
    displayFormat: 'grid' | 'list' | string;
  };
  Element: HTMLElement;
}> {
  <template>
    <div class='cards-layout'>
      <div class={{cn 'cards' this.args.displayFormat}} ...attributes>
        {{#each @images as |image|}}
          <div class='gallery-item'>
            <image style='width:100%;height:100%' />
          </div>
        {{/each}}
      </div>
    </div>
    <style>
      .cards-layout {
        position: relative;
        overflow-x: hidden;
      }
      .cards,
      .cards.grid {
        display: flex;
        flex-wrap: nowrap;
        overflow-x: auto;
        gap: var(--boxel-sp);
      }
      .cards.list {
        display: block;
      }
      .cards.list > * + * {
        margin-top: var(--boxel-sp-med);
        display: block;
      }
      .gallery-item {
        flex: 0 0 300px;
        width: 300px;
        height: 300px;
        background-color: #eee;
        border-radius: 5px;
      }
    </style>
  </template>
}
