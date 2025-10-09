import {
  CardDef,
  field,
  contains,
  linksToMany,
  type CardContext,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import Base64ImageField from 'https://cardstack.com/base/base64-image';
import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';

import { PolaroidImage } from './polaroid-image';
import { GenerateImageCommand } from '../commands/generate-image-command';
import { ImageUploadSection } from './image-upload-section';
import { PolaroidScatter } from './polaroid-scatter';
import {
  LightboxCarousel,
  type LightboxItem,
} from '../components/lightbox-carousel';

import { ExportAlbumCommand } from '../commands/export-album-command';
import { YearRangeField } from './year-range-field';

type CommandContextForGenerateImage = ConstructorParameters<
  typeof GenerateImageCommand
>[0];

function normalizeCaption(value?: string) {
  return value?.trim().toLowerCase() ?? '';
}

function buildPrompt({
  timePeriod,
  creativeNote,
}: {
  timePeriod: string;
  creativeNote?: string;
}): string {
  let prompt = `Create a new photograph of the subject in the provided image as if it existed in the ${timePeriod}. The subject can be a person, animal, or object. The new photograph should be a realistic depiction, capturing the distinct style, context, and atmosphere of that time period. Make the final image a clear photograph that looks authentic to the era.`;

  if (creativeNote && creativeNote.trim()) {
    prompt += ` Additional creative direction: ${creativeNote.trim()}`;
  }

  return prompt;
}

// SaveCardCommand detaches the instance from the store after persisting, so we
// immediately fetch a fresh copy to maintain reactivity in the UI.
async function persistAndHydrate<T extends CardDef>(
  card: T,
  commandContext: CommandContextForGenerateImage,
  realmHref: string,
  context?: CardContext,
): Promise<T> {
  await new SaveCardCommand(commandContext).execute({
    card,
    realm: realmHref,
  });

  if (context?.store && card.id) {
    let rehydrated = (await context.store.get(card.id)) as T | undefined;
    if (rehydrated) {
      return rehydrated;
    }
  }

  return card;
}

async function generateImage({
  polaroid,
  timePeriod,
  creativeNote,
  sourceImageUrl,
  uploadedImageData,
  commandContext,
  context,
  realmHref,
}: {
  polaroid?: PolaroidImage;
  timePeriod: string;
  creativeNote?: string;
  sourceImageUrl: string;
  uploadedImageData?: string;
  commandContext: CommandContextForGenerateImage;
  context?: CardContext;
  realmHref: string;
}): Promise<PolaroidImage | undefined> {
  let normalizedPeriod = timePeriod.trim();
  let prompt = buildPrompt({ timePeriod: normalizedPeriod, creativeNote });
  let generateCommand = new GenerateImageCommand(commandContext);

  let uploadedImageField = uploadedImageData
    ? new Base64ImageField({
        base64: uploadedImageData,
      })
    : undefined;

  let result = await generateCommand.execute({
    prompt,
    uploadedImage: uploadedImageField,
    sourceImageUrl,
  });

  if (!result?.imageBase64) {
    return polaroid;
  }

  let imageData = new Base64ImageField({
    base64: result.imageBase64,
    altText: `Generated portrait for the ${normalizedPeriod}`,
    size: 'contain',
    height: 512,
    width: 512,
  });

  if (polaroid) {
    polaroid.data = imageData;
    polaroid.caption = normalizedPeriod;

    return persistAndHydrate(polaroid, commandContext, realmHref, context);
  }

  let newPolaroid = new PolaroidImage({
    caption: normalizedPeriod,
    data: imageData,
  });

  return persistAndHydrate(newPolaroid, commandContext, realmHref, context);
}

export class TimeMachineImageGeneratorIsolated extends Component<
  typeof TimeMachineImageGenerator
> {
  @tracked uploadedImageData = '';
  @tracked isGenerating = false;
  @tracked isExporting = false;
  @tracked loadingPeriods: string[] = [];
  @tracked isLightboxOpen = false;
  @tracked lightboxIndex = 0;

  get startYear() {
    return (this.args.model?.yearRange as any)?.startValue ?? 1950;
  }

  get endYear() {
    return (this.args.model?.yearRange as any)?.endValue ?? 2000;
  }

  get timePeriods() {
    // Generate decade labels from startYear to endYear, e.g. '1950s', '1960s', ...
    let periods = [];
    let start = Math.floor(this.startYear / 10) * 10;
    let end = Math.floor(this.endYear / 10) * 10;
    for (let year = start; year <= end; year += 10) {
      periods.push(`${year}s`);
    }
    return periods;
  }

  get sourceImageUrl() {
    return this.args.model?.sourceImageUrl ?? '';
  }

  get creativeNote() {
    return this.args.model?.creativeNote ?? '';
  }

  private placeholderImages() {
    return this.timePeriods.map(
      (period) => new PolaroidImage({ caption: period }),
    );
  }

  get polaroidImages(): PolaroidImage[] {
    const model = this.args.model;

    if (!model) {
      return this.placeholderImages();
    }

    // Start with the persisted images and then add placeholder shells for any
    // time periods that have not been generated yet so the gallery layout stays
    // stable before results arrive.
    const actual = [...(model.generatedImages ?? [])];
    const seen = new Set(
      actual.map((image) => image.caption?.trim()).filter(Boolean) as string[],
    );

    const placeholders = this.timePeriods
      .filter((period) => !seen.has(period))
      .map((period) => new PolaroidImage({ caption: period }));

    return [...actual, ...placeholders];
  }

  get lightboxItems(): LightboxItem[] {
    return this.polaroidImages
      .filter((image) => Boolean(image?.data?.base64))
      .map((image) => ({
        card: image,
        component: image.constructor.getComponent(image),
      }));
  }

  @action
  handleFileSelected(file: File) {
    // TODO(feature-plan): extract to shared helper so uploads can be reused across cards.
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      this.uploadedImageData = typeof result === 'string' ? result : '';
      if (this.args.model) {
        // Clear any existing URL when we move to base64 data.
        this.args.model.sourceImageUrl = '';
      }
    };
    reader.onerror = () => {
      this.uploadedImageData = '';
    };
    reader.readAsDataURL(file);
  }

  @action
  handleUrlChange(url: string) {
    if (this.args.model) {
      this.args.model.sourceImageUrl = url;
    }
    if (url) {
      this.uploadedImageData = '';
    }
  }

  @action
  handleCreativeNoteChange(note: string) {
    if (this.args.model) {
      this.args.model.creativeNote = note;
    }
  }

  @action
  handleClearSource() {
    this.uploadedImageData = '';
    if (this.args.model) {
      this.args.model.sourceImageUrl = '';
    }
  }

  @action
  async handleGenerate() {
    if (this.isGenerating) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    let model = this.args.model;

    if (!commandContext || !model) {
      throw new Error(
        'A command context and model are required to generate images.',
      );
    }

    let normalizedSourceUrl = this.sourceImageUrl.trim();
    let trimmedUpload = this.uploadedImageData?.trim() ?? '';
    let hasUploadedData = Boolean(trimmedUpload);
    let hasSourceUrl = Boolean(normalizedSourceUrl);

    if (!hasUploadedData && !hasSourceUrl) {
      throw new Error(
        'Please upload an image or provide an image URL before generating.',
      );
    }

    let realmHref = model[realmURLSymbol]?.href;

    if (!realmHref) {
      throw new Error('Cannot determine realm to persist generated images.');
    }

    let existingByCaption = new Map(
      (model.generatedImages ?? []).map((image) => [
        normalizeCaption(image.caption),
        image,
      ]),
    );

    this.isGenerating = true;
    this.loadingPeriods = [];
    try {
      let tasks = this.timePeriods.map((period) => {
        let key = normalizeCaption(period);
        let existing = existingByCaption.get(key);
        this.setPeriodLoading(key, true);

        return generateImage({
          polaroid: existing,
          timePeriod: period,
          creativeNote: this.creativeNote,
          sourceImageUrl: normalizedSourceUrl,
          uploadedImageData: trimmedUpload,
          commandContext,
          context: this.args.context,
          realmHref,
        })
          .then((generated) => ({
            key,
            card: generated ?? existing,
          }))
          .catch((_error) => ({
            key,
            card: existing,
          }))
          .finally(() => {
            this.setPeriodLoading(key, false);
          });
      });

      let results = await Promise.all(tasks);
      let updatedPolaroids = results
        .map(({ card }) => card)
        .filter((card): card is PolaroidImage => Boolean(card));

      if (updatedPolaroids.length === 0) {
        return;
      }

      model.generatedImages = updatedPolaroids;

      await new SaveCardCommand(commandContext).execute({
        card: model as any,
        realm: realmHref,
      });
    } finally {
      this.loadingPeriods = [];
      this.isGenerating = false;
    }
  }

  @action
  handlePolaroidSelect(image: PolaroidImage) {
    if (!image?.data?.base64) {
      return;
    }
    let items = this.lightboxItems;
    let index = items.findIndex((item) => item.card === image);
    if (index === -1) {
      return;
    }
    this.lightboxIndex = index;
    this.isLightboxOpen = true;
  }

  @action
  closeLightbox() {
    this.isLightboxOpen = false;
  }

  @action
  handleLightboxIndexChange(index: number) {
    this.lightboxIndex = index;
  }

  private setPeriodLoading(periodKey: string, isLoading: boolean) {
    if (isLoading) {
      if (!this.loadingPeriods.includes(periodKey)) {
        this.loadingPeriods = [...this.loadingPeriods, periodKey];
      }
    } else {
      if (this.loadingPeriods.includes(periodKey)) {
        this.loadingPeriods = this.loadingPeriods.filter(
          (key) => key !== periodKey,
        );
      }
    }
  }

  get canExportAlbum() {
    // Only allow export if there are actual generated images
    return (
      Array.isArray(this.args.model?.generatedImages) &&
      this.args.model.generatedImages.length > 0 &&
      this.args.model.generatedImages.some((img) => img?.data?.base64)
    );
  }

  @action
  async handleExportAlbum() {
    if (this.isExporting) {
      return;
    }

    let model = this.args.model;
    let commandContext = this.args.context?.commandContext;
    let realmHref = model?.[realmURLSymbol]?.href;
    if (!model || !commandContext || !realmHref) {
      throw new Error(
        'Missing model, command context, or realm URL for export.',
      );
    }
    let polaroids = (model.generatedImages ?? []).filter(
      (img) => img?.data?.base64,
    );

    this.isExporting = true;
    try {
      let exportCommand = new ExportAlbumCommand(commandContext);
      await exportCommand.execute({ polaroids, realmHref });
    } finally {
      this.isExporting = false;
    }
  }

  <template>
    <div class='time-machine-image-generator'>
      <aside class='sidebar'>
        <ImageUploadSection
          @uploadedImageData={{this.uploadedImageData}}
          @imageUrl={{this.sourceImageUrl}}
          @creativeNote={{this.creativeNote}}
          @isGenerating={{this.isGenerating}}
          @isExporting={{this.isExporting}}
          @canExportAlbum={{this.canExportAlbum}}
          @onFileSelected={{this.handleFileSelected}}
          @onUrlChange={{this.handleUrlChange}}
          @onCreativeNoteChange={{this.handleCreativeNoteChange}}
          @onGenerate={{this.handleGenerate}}
          @onClear={{this.handleClearSource}}
          @onExportAlbum={{this.handleExportAlbum}}
        />
      </aside>

      <main class='gallery'>
        <PolaroidScatter
          @images={{this.polaroidImages}}
          @loadingPeriods={{this.loadingPeriods}}
          @onSelect={{this.handlePolaroidSelect}}
        />
        <LightboxCarousel
          @isOpen={{this.isLightboxOpen}}
          @items={{this.lightboxItems}}
          @startIndex={{this.lightboxIndex}}
          @onClose={{this.closeLightbox}}
          @onIndexChange={{this.handleLightboxIndexChange}}
          as |item|
        >
          <item.component @format='isolated' />
        </LightboxCarousel>
      </main>
    </div>

    <style scoped>
      .time-machine-image-generator {
        display: grid;
        grid-template-columns: minmax(260px, 320px) 1fr;
        gap: 1.5rem;
        width: 100%;
      }

      .sidebar {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .gallery {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      @media (max-width: 900px) {
        .time-machine-image-generator {
          grid-template-columns: 1fr;
        }

        .sidebar {
          order: 1;
        }

        .gallery {
          order: 2;
        }
      }
    </style>
  </template>
}

export class TimeMachineImageGenerator extends CardDef {
  static displayName = 'Time Machine Image Generator';
  static prefersWideFormat = true;

  @field sourceImageUrl = contains(UrlField);
  @field generatedImages = linksToMany(() => PolaroidImage);
  @field creativeNote = contains(StringField);
  @field yearRange = contains(YearRangeField);

  static isolated = TimeMachineImageGeneratorIsolated;
}
