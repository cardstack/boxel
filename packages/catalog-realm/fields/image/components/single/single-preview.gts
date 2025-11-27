import GlimmerComponent from '@glimmer/component';
import { eq } from '@cardstack/boxel-ui/helpers';
import ImageBrowsePreview from './image-browse-preview';
import ImageAvatarPreview from './image-avatar-preview';
import ImageDropzonePreview from './image-dropzone-preview';

type ImageInputVariant = 'browse' | 'dropzone' | 'avatar';

interface SinglePreviewArgs {
  Args: {
    variant: ImageInputVariant;
    imageData?: string;
    onRemove: () => void;
    onFileSelect: (event: Event) => void;
    onZoom?: () => void;
    showZoomButton?: boolean;
    hasPendingUpload?: boolean;
    isReading?: boolean;
    readProgress?: number;
  };
}

export default class SinglePreview extends GlimmerComponent<SinglePreviewArgs> {
  <template>
    {{#if (eq @variant 'avatar')}}
      <ImageAvatarPreview
        @imageData={{@imageData}}
        @onRemove={{@onRemove}}
        @onFileSelect={{@onFileSelect}}
        @hasPendingUpload={{@hasPendingUpload}}
      />
    {{else if (eq @variant 'dropzone')}}
      <ImageDropzonePreview
        @imageData={{@imageData}}
        @onRemove={{@onRemove}}
        @onZoom={{@onZoom}}
        @onFileSelect={{@onFileSelect}}
        @showZoomButton={{@showZoomButton}}
        @isReading={{@isReading}}
        @readProgress={{@readProgress}}
      />
    {{else}}
      <ImageBrowsePreview
        @imageData={{@imageData}}
        @onRemove={{@onRemove}}
        @onZoom={{@onZoom}}
        @onFileSelect={{@onFileSelect}}
        @showZoomButton={{@showZoomButton}}
        @isReading={{@isReading}}
        @readProgress={{@readProgress}}
      />
    {{/if}}
  </template>
}

