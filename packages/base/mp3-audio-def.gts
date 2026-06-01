import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';

export class Mp3Def extends AudioDef {
  static displayName = 'MP3 Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.mp3,audio/mpeg';
}
