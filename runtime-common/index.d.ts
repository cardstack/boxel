import * as JSON from "json-typescript";

export const externalsMap: Map<string, string[]>;
export function traverse(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  opts?: { create?: boolean }
): Promise<{ handle: FileSystemDirectoryHandle; filename: string }>;

export interface CardJSON {
  data: {
    attributes?: Record<string, any>;
    // TODO add relationships
    meta: {
      adoptsFrom: {
        module: string;
        name: string;
      };
    };
  };
  // TODO add included
}
export function isCardJSON(json: any): json is CardJSON;

export interface ResourceObject {
  type: string;
  attributes?: JSON.Object;
  relationships?: JSON.Object;
  meta?: JSON.Object;
}

export interface ResourceObjectWithId extends ResourceObject {
  id: string;
}
