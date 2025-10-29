import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import OpenInInteractModeCommand from '@cardstack/boxel-host/commands/open-in-interact-mode';
import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  field,
  contains,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { ProductCatalog } from '../product-rotater/components/product-catalog';
import { ProductRotationImage } from '../product-rotater/components/product-rotation-image';

class ExportProductCatalogInput extends CardDef {
  @field rotationImages = linksToMany(ProductRotationImage);
  @field realmHref = contains(StringField);
  @field catalogTitle = contains(StringField);
  @field catalogDescription = contains(StringField);
}

export class ExportProductCatalogCommand extends Command<
  typeof ExportProductCatalogInput,
  undefined
> {
  static actionVerb = 'Export';

  async getInputType() {
    return ExportProductCatalogInput;
  }

  protected async run(input: ExportProductCatalogInput): Promise<undefined> {
    let { rotationImages, realmHref, catalogTitle, catalogDescription } = input;

    if (!realmHref) {
      throw new Error('realmHref is required to export a product catalog');
    }

    if (!Array.isArray(rotationImages) || rotationImages.length === 0) {
      throw new Error(
        'At least one generated rotation image is required to export a catalog',
      );
    }

    let safeTitle = (catalogTitle ?? '').trim();
    let safeDescription = (catalogDescription ?? '').trim();

    if (!safeTitle) {
      safeTitle = 'Generated Product Catalog';
    }

    let catalog = new ProductCatalog({
      title: safeTitle,
      description: safeDescription || undefined,
      rotationImages,
    });

    await new SaveCardCommand(this.commandContext).execute({
      card: catalog,
      realm: realmHref,
    });

    if (catalog.id) {
      await new OpenInInteractModeCommand(this.commandContext).execute({
        cardId: catalog.id,
      });
    }

    return undefined;
  }
}
