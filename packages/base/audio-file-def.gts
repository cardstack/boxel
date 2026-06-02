import MusicIcon from '@cardstack/boxel-icons/music';
import {
  BaseDefComponent,
  Component,
  NumberField,
  contains,
  field,
} from './card-api';
import { FileDef } from './file-api';
import { markdownAudio } from './markdown-helpers';
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

  // Markdown has no native audio syntax, but CommonMark passes raw HTML
  // through, so we emit an inline `<audio controls>` so the Spec preview,
  // docs, and downstream consumers render a real player rather than a bare
  // link — matching what ImageDef does for `<img>`.
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
      return markdownAudio(name, url);
    }
    <template>{{this.text}}</template>
  };
}

export default AudioDef;
