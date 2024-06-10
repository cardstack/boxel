import { CommandField } from './command';

type JSONValue = string | number | boolean | null | JSONObject | [JSONValue];

type JSONObject = { [x: string]: JSONValue };

export type PatchObject = { patch: { attributes: JSONObject }; id: string };
export interface PatchCardPayload {
  type: 'patchCard';
  payload: PatchObject;
  eventId: string;
}

export class PatchCommandField extends CommandField {}
