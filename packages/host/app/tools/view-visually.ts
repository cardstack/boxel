import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import {
  captureForAgent,
  resolveViewTarget,
  type ViewFormat,
} from '../lib/visual-capture';

import type MatrixService from '../services/matrix-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// The whole call stays under the tool service's own timeout, with room for
// uploading the image after the capture answers.
const VIEW_DEADLINE_MS = 90_000;

export default class ViewVisuallyTool extends HostBaseTool<
  typeof BaseToolModule.ViewVisuallyInput,
  typeof BaseToolModule.ViewVisuallyResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'View';

  description =
    'See a card instance or a file in a workspace as it renders: it is ' +
    'captured as an image and attached to this tool result, so you can look ' +
    'at it. Use it to check what something looks like and to check your own ' +
    'work after you change it. Takes the URL of a card or a workspace file ' +
    '(HTML, markdown, images, PDFs and other files are captured through ' +
    'their file view).';

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
      realm: this.realm,
      realmServer: this.realmServer,
    };
    let target = resolveViewTarget(input.url, services);
    let viewed = await captureForAgent(
      target,
      {
        format: (input.format?.trim() || undefined) as ViewFormat | undefined,
        viewportWidth: input.viewportWidth ?? undefined,
        viewportHeight: input.viewportHeight ?? undefined,
        fullPage: input.fullPage ?? undefined,
      },
      services,
      { deadline: Date.now() + VIEW_DEADLINE_MS },
    );
    let commandModule = await this.loadToolModule();
    const { ViewVisuallyResult, AttachedImageField } = commandModule;
    return new ViewVisuallyResult({
      sourceUrl: viewed.sourceUrl,
      kind: viewed.kind,
      format: viewed.format,
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
}
