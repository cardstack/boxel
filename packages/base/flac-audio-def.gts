import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';

export class FlacDef extends AudioDef {
  static displayName = 'FLAC Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.flac,audio/flac,audio/x-flac';
}
