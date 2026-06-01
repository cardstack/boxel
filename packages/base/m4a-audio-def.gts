import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';

export class M4aDef extends AudioDef {
  static displayName = 'M4A Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.m4a,audio/mp4,audio/x-m4a';
}
