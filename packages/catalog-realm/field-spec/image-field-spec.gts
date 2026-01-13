import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import ImageField from '../fields/image';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class ImageFieldSpec extends Spec {
  static displayName = 'Image Field Spec';

  // Browse variant - default browse variant for general image uploads
  @field browse = contains(ImageField, {
    configuration: {
      variant: 'browse',
    },
  });

  // Avatar variant - circular image upload for profile pictures
  @field avatar = contains(ImageField, {
    configuration: {
      variant: 'avatar',
      presentation: 'card',
      options: {
        showProgress: true,
      },
    },
  });

  // Dropzone variant - drag and drop interface with modal preview
  @field dropzone = contains(ImageField, {
    configuration: {
      variant: 'dropzone',
      presentation: 'inline',
      options: {
        showImageModal: true,
        showProgress: true,
      },
    },
  });

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}
