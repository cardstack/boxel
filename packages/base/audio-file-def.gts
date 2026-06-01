import MusicIcon from '@cardstack/boxel-icons/music';
import {
  BaseDefComponent,
  Component,
  NumberField,
  contains,
  field,
} from './card-api';
import { FileDef } from './file-api';
import { markdownLink } from './markdown-helpers';
import AudioDefIsolatedTemplate from './default-templates/audio-def-isolated';
import AudioDefEmbeddedTemplate from './default-templates/audio-def-embedded';
import AudioDefFittedTemplate from './default-templates/audio-def-fitted';
import AudioDefAtomTemplate from './default-templates/audio-def-atom';

export class AudioDef extends FileDef {
  static displayName = 'Audio';
  static icon = MusicIcon;
  static acceptTypes = 'audio/*';

  @field duration = contains(NumberField);

  static isolated: BaseDefComponent = AudioDefIsolatedTemplate;
  static embedded: BaseDefComponent = AudioDefEmbeddedTemplate;
  static fitted: BaseDefComponent = AudioDefFittedTemplate;
  static atom: BaseDefComponent = AudioDefAtomTemplate;

  // HTML5 has no native markdown syntax for audio, so emit a link to the
  // source. Downstream consumers (LLMs, exporters) get a stable reference
  // even when there's no inline player.
  static markdown: BaseDefComponent = class Markdown extends Component<
    typeof AudioDef
  > {
    get text() {
      let model = this.args.model;
      if (!model) {
        return '';
      }
      let url = model.url ?? model.sourceUrl ?? '';
      let name = model.name ?? '';
      if (!url && !name) {
        return '';
      }
      if (!url) {
        return name;
      }
      return markdownLink(name || url, url);
    }
    <template>{{this.text}}</template>
  };
}

export default AudioDef;
