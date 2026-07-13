import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type MatrixService from '../services/matrix-service';
import type * as BaseToolModule from '@cardstack/base/command';
import type { FileDef } from '@cardstack/base/file-api';

export default class ReadFileForAssistantTool extends HostBaseTool<
  typeof BaseToolModule.FileIdentifierCard,
  typeof BaseToolModule.FileForAttachmentCard
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Send';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { FileIdentifierCard } = commandModule;
    return FileIdentifierCard;
  }

  requireInputFields = ['fileIdentifier'];

  protected async run(
    input: BaseToolModule.FileIdentifierCard,
  ): Promise<BaseToolModule.FileForAttachmentCard> {
    let { matrixService } = this;

    let fileUrl = input.fileIdentifier;

    await matrixService.ready;
    let file: FileDef | undefined = matrixService.fileAPI.createFileDef({
      sourceUrl: fileUrl,
      name: fileUrl.split('/').pop(),
      contentType: 'text/plain',
    });
    if (file) {
      file = (await matrixService.uploadFiles([file]))[0] as FileDef;
    }
    let commandModule = await this.loadToolModule();
    const { FileForAttachmentCard } = commandModule;
    return new FileForAttachmentCard({ fileForAttachment: file });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { ReadFileForAssistantTool as ReadFileForAssistantCommand };
