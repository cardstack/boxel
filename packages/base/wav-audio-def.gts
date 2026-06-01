import FileAudioIcon from '@cardstack/boxel-icons/file-audio';
import AudioDef from './audio-file-def';

export class WavDef extends AudioDef {
  static displayName = 'WAV Audio';
  static icon = FileAudioIcon;
  static acceptTypes = '.wav,audio/wav,audio/wave,audio/x-wav';
}
