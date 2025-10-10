import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import OpenInInteractModeCommand from '@cardstack/boxel-host/commands/open-in-interact-mode';
import { Album } from '../time-machine/album';
import { PolaroidImage } from '../time-machine/polaroid-image';
import {
  CardDef,
  field,
  contains,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Command } from '@cardstack/runtime-common';

class ExportAlbumInput extends CardDef {
  @field polaroids = linksToMany(PolaroidImage); // all cards provided will be linked
  @field realmHref = contains(StringField);
}

export class ExportAlbumCommand extends Command<
  typeof ExportAlbumInput,
  undefined
> {
  static actionVerb = 'Export';

  async getInputType() {
    return ExportAlbumInput;
  }

  protected async run(input: ExportAlbumInput): Promise<undefined> {
    let { polaroids, realmHref } = input;
    if (!realmHref) {
      throw new Error('realmHref is required to export an album');
    }
    if (!Array.isArray(polaroids) || polaroids.length === 0) {
      throw new Error(
        'At least one polaroid image is required to export an album',
      );
    }

    let album = new Album({
      images: polaroids,
    });

    // Persist album
    await new SaveCardCommand(this.commandContext).execute({
      card: album,
      realm: realmHref,
    });

    // Navigate to the new album using open-in-interact-mode
    if (album.id) {
      await new OpenInInteractModeCommand(this.commandContext).execute({
        cardId: album.id,
      });
    }

    return undefined;
  }
}
