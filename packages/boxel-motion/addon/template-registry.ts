import registerContentModifier from './modifiers/register-context';
import registerContextOrphansEl from './modifiers/register-context-orphans-el';

export default interface Registry {
  'register-context-orphans-el': typeof registerContextOrphansEl;
  'register-context': typeof registerContentModifier;
}
