declare module 'marked-gfm-heading-id' {
  export function gfmHeadingId(
    options?: { prefix?: string },
  ): import('marked').MarkedExtension;
  export interface HeadingData {
    level: number;
    text: string;
    id: string;
  }
  export function getHeadingList(): HeadingData[];
  export function resetHeadings(): void;
}
