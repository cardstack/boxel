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
import { on } from '@ember/modifier';
import StringField from 'https://cardstack.com/base/string';
import BaseImageCard from 'https://cardstack.com/base/image';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';
import { or, not } from '@cardstack/boxel-ui/helpers';

import { PolaroidImage } from './polaroid-image';
import ImageField from '../fields/image';
import { GenerateImageCommand } from '../commands/generate-image-command';
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

async function generateImage({
  polaroid,
  timePeriod,
  creativeNote,
  sourceImageUrl,
  commandContext,
  context,
  realmHref,
}: {
  polaroid?: PolaroidImage;
  timePeriod: string;
  creativeNote?: string;
  sourceImageUrl: string;
  commandContext: CommandContextForGenerateImage;
  context?: CardContext;
  realmHref: string;
}): Promise<PolaroidImage | undefined> {
  let normalizedPeriod = timePeriod.trim();
  let prompt = buildPrompt({ timePeriod: normalizedPeriod, creativeNote });
  let generateCommand = new GenerateImageCommand(commandContext);

  let result = await generateCommand.execute({
    prompt,
    sourceImageUrl,
    targetRealmUrl: realmHref,
  });

  let generatedUrl = result?.url;
  let hydratedImageCard: BaseImageCard | undefined;

  if (!generatedUrl) {
    return polaroid;
  }

  let imageDataUrl = generatedUrl.startsWith('data:image/')
    ? generatedUrl
    : generatedUrl.startsWith('http')
    ? generatedUrl
    : `data:image/png;base64,${generatedUrl}`;

  if (result?.cardId && context?.store?.get) {
    try {
      hydratedImageCard = (await context.store.get(
        result.cardId,
      )) as BaseImageCard;
    } catch (error) {
      // ignore hydrate failures, we'll fall back to data URL
    }
  }

  if (!hydratedImageCard) {
    hydratedImageCard = new BaseImageCard({ url: imageDataUrl });
  }

  let imageField = new ImageField({
    imageCard: hydratedImageCard,
  });

  if (polaroid) {
    polaroid.image = imageField;
    polaroid.caption = normalizedPeriod;

    return polaroid;
  }

  let newPolaroid = new PolaroidImage({
    caption: normalizedPeriod,
    image: imageField,
  });

  return newPolaroid;
}

export class TimeMachineImageGeneratorIsolated extends Component<
  typeof TimeMachineImageGenerator
> {
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
    return this.args.model?.sourceImageUrl?.url ?? '';
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
      .filter((image) => Boolean(image?.image?.url))
      .map((image) => ({
        card: image,
        component: image.constructor.getComponent(image),
      }));
  }

  @action
  handleCreativeNoteChange(event: Event) {
    if (!this.args.model) {
      return;
    }
    let value = (event.target as HTMLTextAreaElement | null)?.value ?? '';
    this.args.model.creativeNote = value;
  }

  @action
  handleClearSource() {
    if (this.args.model) {
      this.args.model.sourceImageUrl = undefined;
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
    if (!normalizedSourceUrl) {
      throw new Error('Please provide an image before generating.');
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
    if (!image?.image?.url) {
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
      this.args.model.generatedImages.some((img) => img?.image?.url)
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
      (img) => img?.image?.url,
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
        <div class='input-card'>
          <h3>Source Image</h3>
          <@fields.sourceImageUrl @format='edit' />

          <div class='field-block'>
            <label for='creative-note-input'>Creative note</label>
            <textarea
              id='creative-note-input'
              value={{this.creativeNote}}
              {{on 'input' this.handleCreativeNoteChange}}
              placeholder='Add optional creative direction'
            ></textarea>
          </div>

          <div class='actions'>
            <button
              class='primary'
              type='button'
              {{on 'click' this.handleGenerate}}
              disabled={{this.isGenerating}}
            >
              {{if this.isGenerating 'Generating…' 'Generate'}}
            </button>
            <button
              class='secondary'
              type='button'
              {{on 'click' this.handleExportAlbum}}
              disabled={{or this.isExporting (not this.canExportAlbum)}}
            >
              {{if this.isExporting 'Exporting…' 'Export Album'}}
            </button>
          </div>
        </div>
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

      .input-card {
        background: var(--card, #fffdf8);
        border: 1px solid rgba(0, 0, 0, 0.05);
        border-radius: 12px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        box-shadow:
          0 12px 24px rgba(0, 0, 0, 0.08),
          0 0 0 1px rgba(0, 0, 0, 0.04);
      }

      .input-card h3 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 700;
      }

      .field-block {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .field-block label {
        font-weight: 600;
        font-size: 0.95rem;
      }

      .field-block textarea {
        min-height: 80px;
        padding: 0.65rem;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        font: inherit;
        resize: vertical;
        background: #fff;
      }

      .actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .actions button {
        border: none;
        border-radius: 8px;
        padding: 0.7rem 1rem;
        font-weight: 700;
        cursor: pointer;
      }

      .actions .primary {
        background: #111827;
        color: #f9fafb;
      }

      .actions .secondary {
        background: #e5e7eb;
        color: #111827;
      }

      .actions button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
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

  @field sourceImageUrl = contains(ImageField);
  @field generatedImages = linksToMany(() => PolaroidImage);
  @field creativeNote = contains(StringField);
  @field yearRange = contains(YearRangeField);

  static isolated = TimeMachineImageGeneratorIsolated;
}
