import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';

export class OggDef extends AudioDef {
  static displayName = 'OGG Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.ogg,.oga,audio/ogg';
}
