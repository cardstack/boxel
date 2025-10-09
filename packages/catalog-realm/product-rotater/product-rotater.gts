import {
  CardDef,
  Component,
  field,
  contains,
  linksToMany,
  type CardContext,
} from 'https://cardstack.com/base/card-api';
import PackageIcon from '@cardstack/boxel-icons/package';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import Base64ImageField from 'https://cardstack.com/base/base64-image';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';

import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { GenerateImagesRotation } from '../commands/generate-images-rotation';
import { ExportProductCatalogCommand } from '../commands/export-product-catalog';
import { ProductRotatorForm } from './components/product-rotator-form';
import {
  RotationPreview,
  type RotationFrame,
} from './components/rotation-preview';
import { ProductRotationImage } from './components/product-rotation-image';

const DEFAULT_IMAGE_COUNT = 4;

type CommandContextForGenerate = ConstructorParameters<
  typeof GenerateImagesRotation
>[0];

interface FileSelection {
  file: File;
  url: string;
}

export class ProductRotatorIsolated extends Component<typeof ProductRotator> {
  @tracked selections: FileSelection[] = [];
  @tracked productDescription =
    this.args.model?.productDescription?.trim() ?? '';
  @tracked imageCount = this.args.model?.imageCount ?? DEFAULT_IMAGE_COUNT;
  @tracked generatedCards: ProductRotationImage[] =
    this.args.model?.generatedImages ?? [];
  @tracked rotationFrames: RotationFrame[] = rotationFramesFromCards(
    this.generatedCards,
  );
  @tracked currentRotationIndex = 0;
  @tracked lastProcessedDeltaX = 0;
  @tracked isGenerating = false;
  @tracked isExporting = false;
  @tracked error = '';

  constructor(owner: unknown, args: any) {
    super(owner, args);
    // Initialize imageCount before any getters might access it
    let initialCount = this.args.model?.imageCount ?? DEFAULT_IMAGE_COUNT;
    this.imageCount = this.normalizeImageCount(initialCount);
  }

  get previews() {
    return this.selections.map((selection, index) => ({
      url: selection.url,
      label: `Reference ${index + 1}`,
    }));
  }

  get rotationAngles() {
    let count = this.imageCount;
    const angles: number[] = [];
    if (count < 2) {
      return [0];
    }
    const step = 360 / count;
    for (let i = 0; i < count; i++) {
      angles.push(Math.round(i * step));
    }
    return angles;
  }

  get hasGeneratedFrames() {
    return this.rotationFrames.length > 0;
  }

  get canGenerate() {
    return (
      this.selections.length > 0 &&
      this.productDescription.trim().length > 0 &&
      !this.isGenerating
    );
  }

  get canExportCatalog() {
    return (
      this.hasGeneratedFrames &&
      !this.isExporting &&
      Array.isArray(this.args.model?.generatedImages) &&
      this.args.model.generatedImages.some((image) =>
        Boolean(image?.data?.base64),
      )
    );
  }

  get exportDescription() {
    return this.productDescription.trim();
  }

  get exportTitle() {
    if (this.productDescription.trim().length > 0) {
      const titleCaseDescription = this.toTitleCase(
        this.productDescription.trim(),
      );
      return `Product Catalog – ${titleCaseDescription}`;
    }
    return 'Generated Product Catalog';
  }

  private toTitleCase(str: string): string {
    return str
      .toLowerCase()
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  get generateButtonLabel() {
    return this.isGenerating
      ? `Generating ${this.imageCount} Views…`
      : `Generate ${this.imageCount} Views`;
  }

  get isGenerateDisabled() {
    return !this.canGenerate;
  }

  get isExportDisabled() {
    return !this.canExportCatalog;
  }

  @action
  updateDescription(value: string) {
    this.productDescription = value;
  }

  @action
  updateImageCount(value: string) {
    let parsed = parseInt(value, 10);
    this.imageCount = this.normalizeImageCount(parsed);
  }

  private normalizeImageCount(count?: number) {
    if (!Number.isFinite(count)) {
      return DEFAULT_IMAGE_COUNT;
    }
    let clamped = Math.max(2, Math.min(16, Number(count)));
    return Math.round(clamped);
  }

  @action
  handleFilesSelected(files: File[]) {
    if (!Array.isArray(files) || files.length === 0) {
      return;
    }

    let nextSelections = [...this.selections];
    for (let file of files) {
      if (!file.type.startsWith('image/')) {
        this.error = `Unsupported file type: ${file.name}`;
        continue;
      }
      let url = URL.createObjectURL(file);
      nextSelections.push({ file, url });
    }

    if (nextSelections.length === this.selections.length) {
      return;
    }

    this.error = '';
    this.selections = nextSelections;
  }

  @action
  removeSelection(index: number) {
    let target = this.selections[index];
    if (target) {
      URL.revokeObjectURL(target.url);
    }

    this.selections = this.selections.filter((_, i) => i !== index);
  }

  @action
  async handleRotationSelect(index: number) {
    this.currentRotationIndex = index;
  }

  @action
  handleRotationDragStart() {
    this.lastProcessedDeltaX = 0;
  }

  @action
  handleRotationDrag(cumulativeDeltaX: number) {
    if (!this.hasGeneratedFrames) {
      return;
    }

    const sensitivity = 30;
    const totalSteps = Math.floor(Math.abs(cumulativeDeltaX) / sensitivity);
    const processedSteps = Math.floor(
      Math.abs(this.lastProcessedDeltaX || 0) / sensitivity,
    );
    const newSteps = totalSteps - processedSteps;

    if (newSteps > 0) {
      const direction = cumulativeDeltaX > 0 ? 1 : -1;
      let newIndex =
        (this.currentRotationIndex + direction * newSteps) %
        this.rotationFrames.length;
      if (newIndex < 0) {
        newIndex = this.rotationFrames.length + newIndex;
      }
      this.currentRotationIndex = newIndex;
    }

    this.lastProcessedDeltaX = cumulativeDeltaX;
  }

  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (event) => reject(event);
      reader.readAsDataURL(file);
    });
  }

  private existingRotationsByAngle() {
    let rotations = this.args.model?.generatedImages ?? [];
    let map = new Map<number, ProductRotationImage>();
    for (let rotation of rotations) {
      let angle = angleFromCard(rotation);
      if (typeof angle !== 'undefined') {
        map.set(angle, rotation);
      }
    }
    return map;
  }

  private rotationsToFrames(rotations: ProductRotationImage[]) {
    this.generatedCards = rotations;
    this.rotationFrames = rotationFramesFromCards(rotations);
    if (this.rotationFrames.length === 0) {
      this.currentRotationIndex = 0;
    } else if (this.currentRotationIndex >= this.rotationFrames.length) {
      this.currentRotationIndex = 0;
    }
  }

  private async persistRotations({
    base64Images,
    angles,
    commandContext,
    realmHref,
  }: {
    base64Images: string[];
    angles: number[];
    commandContext: CommandContextForGenerate;
    realmHref: string;
  }): Promise<ProductRotationImage[]> {
    let tasks: Promise<ProductRotationImage | undefined>[] = [];
    let existingByAngle = this.existingRotationsByAngle();

    base64Images.forEach((base64, index) => {
      let angle = angles[index];
      if (typeof angle === 'undefined') {
        return;
      }

      let existing = existingByAngle.get(Math.round(angle));

      tasks.push(
        persistRotationImage({
          base64,
          angle,
          existing,
          commandContext,
          realmHref,
          context: this.args.context,
          productDescription: this.productDescription,
        }).catch((error) => {
          console.error(`Failed to persist rotation ${angle}°`, error);
          return existing;
        }),
      );
    });

    let results = await Promise.all(tasks);
    return results.filter(
      (card: ProductRotationImage | undefined): card is ProductRotationImage =>
        Boolean(card),
    );
  }

  @action
  async generateRotationViews() {
    if (!this.canGenerate) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    let model = this.args.model;
    if (!commandContext || !model) {
      this.error = 'Unable to access command context or model.';
      return;
    }

    let realmHref = model[realmURLSymbol]?.href;
    if (!realmHref) {
      this.error = 'Unable to determine realm for persistence.';
      return;
    }

    this.isGenerating = true;
    this.error = '';

    try {
      const base64Images = await Promise.all(
        this.selections.map((selection) => this.fileToBase64(selection.file)),
      );

      const angles = this.rotationAngles;
      const description = this.productDescription.trim();
      const prompts = angles.map((angle) =>
        buildRotationPrompt(angle, description),
      );

      const generateRotationsCommand = new GenerateImagesRotation(
        commandContext,
      );
      const result = await generateRotationsCommand.execute({
        productImages: base64Images,
        prompts,
        rotationAngles: angles.map((angle) => angle.toString()),
      });

      if (!result.generatedImages?.length) {
        throw new Error('No rotation images were returned.');
      }

      const persistedRotations = await this.persistRotations({
        base64Images: result.generatedImages,
        angles,
        commandContext,
        realmHref,
      });

      if (persistedRotations.length === 0) {
        throw new Error('Unable to persist generated rotations.');
      }

      model.generatedImages = persistedRotations;
      model.productDescription = this.productDescription;
      model.imageCount = this.imageCount;

      await new SaveCardCommand(commandContext).execute({
        card: model as any,
        realm: realmHref,
      });

      this.rotationsToFrames(persistedRotations);
      this.currentRotationIndex = 0;
    } catch (error) {
      console.error('Rotation generation failed:', error);
      this.error =
        error instanceof Error
          ? error.message
          : 'Failed to generate rotation views';
    } finally {
      this.isGenerating = false;
    }
  }

  @action
  async handleExportCatalog() {
    if (!this.canExportCatalog) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    let model = this.args.model;
    let realmHref = model?.[realmURLSymbol]?.href;

    if (!commandContext || !model || !realmHref) {
      this.error =
        'Unable to export catalog without command context and realm.';
      return;
    }

    let rotationCards = (model.generatedImages ?? []).filter((image) =>
      Boolean(image?.data?.base64),
    );

    if (rotationCards.length === 0) {
      return;
    }

    this.isExporting = true;
    try {
      let exportCommand = new ExportProductCatalogCommand(commandContext);
      await exportCommand.execute({
        rotationImages: rotationCards,
        realmHref,
        catalogTitle: this.exportTitle,
        catalogDescription: this.exportDescription,
      });
    } catch (error) {
      console.error('Failed to export product catalog:', error);
      this.error =
        error instanceof Error
          ? error.message
          : 'Failed to export product catalog';
    } finally {
      this.isExporting = false;
    }
  }

  willDestroy(): void {
    this.selections.forEach((selection) => URL.revokeObjectURL(selection.url));
    super.willDestroy();
  }

  <template>
    <main class='rotator-app'>
      <header class='rotator-app__header'>
        <h1>🔄 3D Product Rotator</h1>
        <p>
          Upload product reference shots and describe the item to generate a
          full 360° rotation sequence.
        </p>
      </header>

      <div class='rotator-app__layout'>
        <aside class='rotator-app__sidebar'>
          <ProductRotatorForm
            @previews={{this.previews}}
            @onFilesSelected={{this.handleFilesSelected}}
            @onRemove={{this.removeSelection}}
            @productDescription={{this.productDescription}}
            @onDescriptionChange={{this.updateDescription}}
            @imageCount={{this.imageCount}}
            @onImageCountChange={{this.updateImageCount}}
            @generateLabel={{this.generateButtonLabel}}
            @onGenerate={{this.generateRotationViews}}
            @generateDisabled={{this.isGenerateDisabled}}
            @isGenerating={{this.isGenerating}}
            @onExport={{this.handleExportCatalog}}
            @exportDisabled={{this.isExportDisabled}}
            @isExporting={{this.isExporting}}
            @errorMessage={{this.error}}
          />
        </aside>

        <section class='rotator-app__preview'>
          <RotationPreview
            @frames={{this.rotationFrames}}
            @currentIndex={{this.currentRotationIndex}}
            @onSelect={{this.handleRotationSelect}}
            @onDrag={{this.handleRotationDrag}}
            @onDragStart={{this.handleRotationDragStart}}
          />
        </section>
      </div>
    </main>

    <style scoped>
      .rotator-app {
        container-type: inline-size;
        display: flex;
        flex-direction: column;
        gap: 2rem;
        padding: 2rem;
        max-width: 1100px;
        margin: 0 auto;
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
      }

      .rotator-app__header {
        text-align: center;
      }

      .rotator-app__header h1 {
        margin: 0;
        font-size: 2rem;
        color: #111827;
      }

      .rotator-app__header p {
        margin: 0.5rem 0 0;
        color: #4b5563;
      }

      .rotator-app__layout {
        display: grid;
        grid-template-columns: 2fr 3fr;
        gap: 2rem;
        align-items: start;
        width: 100%;
        overflow: hidden;
      }

      .rotator-app__sidebar {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        min-width: 0;
      }

      .rotator-app__preview {
        min-width: 0;
        overflow: hidden;
      }

      @container (width <= 600px) {
        .rotator-app__layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

export class ProductRotator extends CardDef {
  static displayName = '3D Product Rotator';
  static icon = PackageIcon;

  @field title = contains(StringField, {
    computeVia: function (this: ProductRotator) {
      return '3D Product Rotator';
    },
  });

  @field productDescription = contains(StringField);
  @field imageCount = contains(NumberField);
  @field generatedImages = linksToMany(() => ProductRotationImage);

  static isolated = ProductRotatorIsolated;
}

async function persistAndHydrate<T extends CardDef>(
  card: T,
  commandContext: CommandContextForGenerate,
  realmHref: string,
  context?: CardContext,
): Promise<T> {
  await new SaveCardCommand(commandContext).execute({
    card,
    realm: realmHref,
  });

  if (context?.store && card.id) {
    let hydrated = (await context.store.get(card.id)) as T | undefined;
    if (hydrated) {
      return hydrated;
    }
  }

  return card;
}

function buildAngleLabel(angle: number): string {
  return `${angle}° view`;
}

async function persistRotationImage({
  base64,
  angle,
  commandContext,
  realmHref,
  context,
  existing,
  productDescription,
}: {
  base64: string;
  angle: number;
  commandContext: CommandContextForGenerate;
  realmHref: string;
  context?: CardContext;
  existing?: ProductRotationImage;
  productDescription?: string;
}): Promise<ProductRotationImage> {
  let safeAngle = Math.round(angle);
  let label = buildAngleLabel(safeAngle);
  let altText = productDescription
    ? `${productDescription} rotated ${safeAngle} degrees`
    : `Product rotated ${safeAngle} degrees`;

  let imageField = new Base64ImageField({
    base64,
    altText,
    size: 'contain',
    width: 1024,
    height: 1024,
  });

  if (existing) {
    existing.data = imageField;
    existing.angleLabel = label;
    existing.angleDegrees = safeAngle;
    return persistAndHydrate(existing, commandContext, realmHref, context);
  }

  let rotationCard = new ProductRotationImage({
    angleLabel: label,
    angleDegrees: safeAngle,
    data: imageField,
  });

  return persistAndHydrate(rotationCard, commandContext, realmHref, context);
}

function angleFromCard(card: ProductRotationImage): number | undefined {
  let angle = Number(card.angleDegrees ?? NaN);
  if (Number.isFinite(angle)) {
    return Math.round(angle);
  }

  let label = card.angleLabel ?? '';
  let parsed = parseFloat(label.replace(/[^\d.-]/g, ''));
  if (Number.isFinite(parsed)) {
    return Math.round(parsed);
  }

  return undefined;
}

function rotationFramesFromCards(
  cards: ProductRotationImage[],
): RotationFrame[] {
  return cards
    .map((card) => {
      let base64 = card?.data?.base64;
      if (!base64) {
        return undefined;
      }
      let angle = angleFromCard(card);
      if (typeof angle === 'undefined') {
        return undefined;
      }

      return {
        angle,
        label: card.angleLabel ?? buildAngleLabel(angle),
        base64,
      };
    })
    .filter((frame): frame is RotationFrame => Boolean(frame));
}

function buildRotationPrompt(
  angle: number,
  productDescription: string,
): string {
  return `
      Generate a high-quality product image of the following item rotated ${angle} degrees around its vertical axis: ${productDescription}.

      - Use the provided reference images to understand the product's shape, materials, colors, and details.
      - All generated images must match the style of the reference images: if the references are 2D, generate 2D-style images; if they are 3D, generate 3D-style images. The style (2D or 3D) must be consistent across all generated views.
      - Keep the lighting, style, and proportions consistent with the reference images.
      - Show the product from the ${angle}° viewpoint while maintaining photorealistic quality.
      - The background should be the same color and consistent across all generated images.
      - The product should look like the same object, just rotated to show different sides.
      - Make sure the generated view is consistent with the original product's materials, colors, and details from the reference images.
      `.trim();
}
