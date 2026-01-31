import type { SearchGoogleImagesInput } from './command';
import type { BaseMatrixEvent } from './matrix-event';

export interface MatrixEventFilter {
  // Minimal filter to match incoming Matrix event types for command routing.
  // TODO: When MatrixEvents are cards, promote this to use runtime-common Query/Filter.
  type: string;
}

// Example custom event that a user could emit and match to a command via MatrixEventFilter.
export interface SearchGoogleImagesEvent extends BaseMatrixEvent {
  type: 'app.boxel.search-google-images';
  content: {
    commandInput: SearchGoogleImagesInput;
  };
}
