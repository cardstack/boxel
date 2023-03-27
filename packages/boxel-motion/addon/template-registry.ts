import registerContentModifier from './modifiers/register-context';
import registerContextOrphansEl from './modifiers/register-context-orphans-el';

export default interface BoxelMotionRegistry {
  'register-context': typeof registerContentModifier;
  'register-context-orphans-el': typeof registerContextOrphansEl;
}
