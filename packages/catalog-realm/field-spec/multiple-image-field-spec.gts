import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import MultipleImageField from '../fields/multiple-image';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class MultipleImageFieldSpec extends Spec {
  static displayName = 'Multiple Image Field Spec';

  // List variant - standard list view with grid display
  @field list = contains(MultipleImageField, {
    configuration: {
      variant: 'list',
      presentation: 'grid',
    },
  });

  // Gallery variant - grid edit with carousel display and reordering
  @field gallery = contains(MultipleImageField, {
    configuration: {
      variant: 'gallery',
      presentation: 'carousel',
      options: {
        allowBatchSelect: true,
        allowReorder: true,
        maxFiles: 4,
        showProgress: true,
      },
    },
  });

  // Dropzone variant - drag and drop multiple images with carousel
  @field dropzone = contains(MultipleImageField, {
    configuration: {
      variant: 'dropzone',
      presentation: 'carousel',
      options: {
        allowBatchSelect: true,
        showProgress: true,
        maxFiles: 10,
      },
    },
  });

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}
