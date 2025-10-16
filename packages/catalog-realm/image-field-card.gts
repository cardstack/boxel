import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import { ImageField } from './image-field';

export class ImageFieldCard extends CardDef {
  static displayName = 'Image Field Card';

  @field image = contains(ImageField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='image-card-container'>
        <h2>Image Field Test</h2>
        <div class='image-field-wrapper'>
          <@fields.image />
        </div>
      </div>

      <style scoped>
        .image-card-container {
          max-width: 600px;
          margin: 0 auto;
          padding: 2rem;
        }
        h2 {
          margin: 0 0 1.5rem 0;
          color: #374151;
          font-size: 1.5rem;
        }
        .image-field-wrapper {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 1.5rem;
        }
      </style>
    </template>
  };
}
