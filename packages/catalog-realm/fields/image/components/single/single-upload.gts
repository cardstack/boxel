import GlimmerComponent from '@glimmer/component';
import { eq } from '@cardstack/boxel-ui/helpers';
import ImageBrowseUpload from './image-browse-upload';
import ImageAvatarUpload from './image-avatar-upload';
import ImageDropzoneUpload from './image-dropzone-upload';

type ImageInputVariant = 'browse' | 'dropzone' | 'avatar';

interface SingleUploadArgs {
  Args: {
    variant: ImageInputVariant;
    onFileSelect: (event: Event) => void;
    onDragOver?: (event: DragEvent) => void;
    onDrop?: (event: DragEvent) => void;
  };
}

export default class SingleUpload extends GlimmerComponent<SingleUploadArgs> {
  <template>
    {{#if (eq @variant 'avatar')}}
      <ImageAvatarUpload @onFileSelect={{@onFileSelect}} />
    {{else if (eq @variant 'dropzone')}}
      <ImageDropzoneUpload
        @onFileSelect={{@onFileSelect}}
        @onDragOver={{@onDragOver}}
        @onDrop={{@onDrop}}
      />
    {{else}}
      <ImageBrowseUpload @onFileSelect={{@onFileSelect}} />
    {{/if}}
  </template>
}

