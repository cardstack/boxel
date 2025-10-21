import BooleanField from 'https://cardstack.com/base/boolean';
import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';

export class PhotoItem extends FieldDef {
  static displayName = 'Photo';

  @field url = contains(UrlField);
  @field caption = contains(StringField);
  @field alt = contains(StringField);
}

export class PhotoCollage extends CardDef {
  static displayName = 'Photo Collage';
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field photos = containsMany(PhotoItem);
  @field darkMode = contains(BooleanField);

  static isolated = class Isolated extends Component<typeof PhotoCollage> {
    <template>
      <div class='photo-collage {{if @model.darkMode "dark-mode"}}'>
        <h1 class='title'>{{@model.title}}</h1>

        <div class='photo-grid'>
          {{#each @model.photos as |photo index|}}
            <div class='photo-item item-{{index}}'>
              <img src='{{photo.url}}' alt='{{photo.alt}}' />
              {{#if photo.caption}}
                <div class='caption'>{{photo.caption}}</div>
              {{/if}}
            </div>
          {{/each}}
        </div>
      </div>

      <style scoped>
        .photo-collage {
          width: 100%;
          padding: 24px;
          background-color: #ffffff;
          color: #000000;
          font-family:
            -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
            Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        }

        .title {
          font-size: 24px;
          font-weight: 300;
          margin-bottom: 24px;
          letter-spacing: 0.5px;
          text-align: center;
        }

        .photo-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          grid-auto-rows: 200px;
          grid-auto-flow: dense;
          gap: 12px;
        }

        .photo-item {
          overflow: hidden;
          position: relative;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          transition: transform 0.3s ease;
        }

        .photo-item:hover {
          transform: scale(1.02);
          z-index: 1;
        }

        .item-0,
        .item-7,
        .item-11 {
          grid-column: span 2;
          grid-row: span 2;
        }

        .item-3,
        .item-9,
        .item-14 {
          grid-column: span 2;
        }

        .item-5,
        .item-12 {
          grid-row: span 2;
        }

        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .caption {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(0, 0, 0, 0.7);
          color: white;
          padding: 8px 12px;
          font-size: 14px;
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .photo-item:hover .caption {
          opacity: 1;
        }

        .dark-mode {
          background-color: #121212;
          color: var(--boxel-50);
        }
      </style>
    </template>
  };
}
