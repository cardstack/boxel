import { CommandField } from './command';
import { action } from '@ember/object';

type JSONValue = string | number | boolean | null | JSONObject | [JSONValue];

type JSONObject = { [x: string]: JSONValue };

export type PatchObject = { patch: { attributes: JSONObject }; id: string };
export interface PatchCardPayload {
  type: 'patchCard';
  payload: PatchObject;
  eventId: string;
}

export class PatchCommandField extends CommandField {
  //Runs functions available to host
  get hostCommandArgs() {
    return this.payload;
  }

  @action
  run() {
    this.hostCommand();
  }
}
