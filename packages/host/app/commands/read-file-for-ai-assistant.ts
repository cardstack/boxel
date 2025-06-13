import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class ReadFileForAssistantCommand extends HostBaseCommand<
  typeof BaseCommandModule.FileUrlCard,
  typeof BaseCommandModule.FileForAttachmentCard
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Send';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { FileUrlCard } = commandModule;
    return FileUrlCard;
  }

  protected async run(
    input: BaseCommandModule.FileUrlCard,
  ): Promise<BaseCommandModule.FileForAttachmentCard> {
    let { matrixService } = this;

    let fileUrl = input.fileUrl;

    await matrixService.ready;
    let file: FileDef | undefined = matrixService.fileAPI.createFileDef({
      sourceUrl: fileUrl,
      name: fileUrl.split('/').pop(),
      contentType: 'text/plain',
    });
    if (file) {
      file = (await matrixService.uploadFiles([file]))[0] as FileDef;
    }
    let commandModule = await this.loadCommandModule();
    const { FileForAttachmentCard } = commandModule;
    return new FileForAttachmentCard({ fileForAttachment: file });
  }
}
