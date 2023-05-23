import { RealmInterface } from './realm';

// For now the only kind of append only realm is a matrix realm so this class
// will directly consume matrix SDK for the time being
export class AppendOnlyRealm implements RealmInterface {}
