import FileVideoIcon from '@cardstack/boxel-icons/file-video';
import Mp4Def from './mp4-video-def';

// QuickTime is the container MP4 was standardized from, and the box layout this
// reads is identical — so MOV differs only in what it calls itself and in the
// codecs it is likely to carry. Subclassing rather than duplicating keeps the
// two from drifting.
export class MovDef extends Mp4Def {
  static displayName = 'QuickTime Video';
  static icon = FileVideoIcon;
  static acceptTypes = '.mov,video/quicktime';

  protected static containerLabel = 'QuickTime';
}

export default MovDef;
