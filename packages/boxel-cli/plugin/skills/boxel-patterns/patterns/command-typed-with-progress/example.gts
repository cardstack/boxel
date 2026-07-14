import { Command } from '@cardstack/runtime-common/commands';
import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';

// 🧩 PATTERN: Typed Command with tracked progressStep
//
// The progressStep enum + @tracked field make `restartableTask` work without
// callback plumbing — the invoking component sees each phase transition.

type UploadProgressStep =
  | 'idle'
  | 'requesting-direct-upload-url'
  | 'uploading-file'
  | 'saving-card'
  | 'done';

class UploadImageInput extends CardDef {
  @field dataUri = contains(StringField);
  @field targetRealmUrl = contains(StringField);
}

class UploadImageResult extends CardDef {
  @field cardId = contains(StringField);
  @field publicUrl = contains(StringField);
}

export class UploadImageCommand extends Command<
  typeof UploadImageInput,
  typeof UploadImageResult
> {
  static actionVerb = 'Upload';

  inputType = UploadImageInput;

  @tracked progressStep: UploadProgressStep = 'idle';
  @tracked result?: UploadImageResult;

  protected async run(input: UploadImageInput): Promise<UploadImageResult> {
    this.progressStep = 'requesting-direct-upload-url';
    let { uploadUrl } = await this.requestUploadUrl(input.targetRealmUrl);

    this.progressStep = 'uploading-file';
    let { publicUrl } = await this.uploadFile(input.dataUri, uploadUrl);

    this.progressStep = 'saving-card';
    let card = await this.saveCard(publicUrl, input.targetRealmUrl);

    this.progressStep = 'done';
    this.result = card;
    return card;
  }

  // ⚠️ Pseudocode helpers — replace with your real implementation.
  private async requestUploadUrl(realmUrl: string) {
    void realmUrl;
    return { uploadUrl: '' };
  }
  private async uploadFile(dataUri: string, uploadUrl: string) {
    void dataUri;
    void uploadUrl;
    return { publicUrl: '' };
  }
  private async saveCard(publicUrl: string, realmUrl: string) {
    void publicUrl;
    void realmUrl;
    return new UploadImageResult();
  }
}

// === Consumer side (sketch) ===========================================
//
// import { restartableTask } from 'ember-concurrency';
//
// class MyCard extends Component<typeof MyCardDef> {
//   uploadCommand = new UploadImageCommand(this.args.context!.commandContext);
//
//   runUpload = restartableTask(async () => {
//     await this.uploadCommand.execute({ dataUri: '…', targetRealmUrl: '…' });
//   });
//
//   <template>
//     <button {{on 'click' (perform this.runUpload)}}>Upload</button>
//     <p>Status: {{this.uploadCommand.progressStep}}</p>
//   </template>
// }
