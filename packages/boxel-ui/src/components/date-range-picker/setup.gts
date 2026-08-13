import { registerDateLibrary } from 'ember-power-calendar';
import dateLibrary from 'ember-power-calendar-moment';

let hasRegistered = false;

export function setupDateLibrary() {
  if (!hasRegistered) {
    registerDateLibrary(dateLibrary);
    hasRegistered = true;
  }
}
