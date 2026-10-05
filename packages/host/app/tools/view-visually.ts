import { service } from '@ember/service';

import HostBaseTool, { type ResultAttachment } from '../lib/host-base-tool';
import {
  captureDeadline,
  captureForAgent,
  resolveViewTarget,
  uploadedImages,
  type ViewFormat,
} from '../lib/visual-capture';

import type MatrixService from '../services/matrix-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// The whole call — capture, fitting and upload — is done by then, under the
// tool service's own execute timeout.
const VIEW_DEADLINE_MS = 100_000;

export default class ViewVisuallyTool extends HostBaseTool<
  typeof BaseToolModule.ViewVisuallyInput,
  typeof BaseToolModule.ViewVisuallyResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'View';

  description =
    'See a card instance or a file in a workspace as it renders: it is ' +
    'captured as an image and attached to this tool result, so you can look ' +
    'at it. Use it to check what something looks like and to check your own ' +
    'work after you change it. Takes the URL of a card or a workspace file ' +
    '(HTML, markdown, images, PDFs and other files are captured through ' +
    'their file view; a .gts URL shows the module source, so view an ' +
    'instance to see a card). A full-page capture taller than 4096px is ' +
    'cut to its top.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ViewVisuallyInput } = commandModule;
    return ViewVisuallyInput;
  }

  requireInputFields = ['url'];

  protected async run(
    input: BaseToolModule.ViewVisuallyInput,
  ): Promise<BaseToolModule.ViewVisuallyResult> {
    let services = {
      loaderService: this.loaderService,
      matrixService: this.matrixService,
      network: this.network,
      realm: this.realm,
      realmServer: this.realmServer,
    };
    let start = Date.now();
    let target = await resolveViewTarget(input.url, services);
    let viewed = await captureForAgent(
      target,
      {
        format: (input.format?.trim() || undefined) as ViewFormat | undefined,
        viewportWidth: input.viewportWidth ?? undefined,
        viewportHeight: input.viewportHeight ?? undefined,
        fullPage: input.fullPage ?? undefined,
      },
      services,
      { deadline: captureDeadline(start + VIEW_DEADLINE_MS) },
    );
    let commandModule = await this.loadToolModule();
    const { ViewVisuallyResult, AttachedImageField } = commandModule;
    return new ViewVisuallyResult({
      sourceUrl: viewed.sourceUrl,
      kind: viewed.kind,
      format: viewed.format,
      note: viewed.note,
      attachedImages: [
        new AttachedImageField({
          name: viewed.file.name,
          sourceUrl: viewed.file.sourceUrl,
          url: viewed.file.url,
          contentType: viewed.file.contentType,
          contentHash: viewed.file.contentHash,
          contentSize: viewed.file.contentSize,
          width: viewed.width,
          height: viewed.height,
        }),
      ],
    });
  }

  // The image it captured.
  resultAttachments(
    result: BaseToolModule.ViewVisuallyResult,
  ): ResultAttachment[] {
    return uploadedImages(result.attachedImages);
  }
}
