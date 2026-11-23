// The staged search docs a commit's derived tables are built from, read once
// per chunk of URLs.
//
// The vector sync and the passage sync each read a chunk's staged docs
// (`boxel_index_pending`), with their own filter, in that order. Reading a
// staged doc detoasts it, and the vector filter casts it to text as well, so
// the two reads of the same chunk cost twice what one does: on a 12,084-card
// realm, 50 statements and 0.6-1.7 s of the commit. One read now answers both:
// it returns each row with a flag for each filter, hands the vector sync its
// rows, and keeps the passage rows (usually few) until the passage sync asks
// for the same chunk. A chunk the vector sync did not read (no vector store
// on this database) is read for the passage sync alone.

// Docs that may carry vectors: an inline vector value, or a declared vector
// field.
export const VECTOR_DOC_FILTER = `(search_doc::text LIKE '%"vec:[%' OR jsonb_exists(search_doc, '_vectorFields'))`;

// Docs that carry passages.
export const PASSAGE_DOC_FILTER = `search_doc ? '_passages'`;

export interface StagedSearchDoc {
  url: string;
  type: string;
  search_doc: Record<string, unknown> | null;
}

interface FlaggedStagedSearchDoc extends StagedSearchDoc {
  for_vectors: boolean;
  for_passages: boolean;
}

export class StagedSearchDocReads {
  // The passage rows the vector sync's reads found, by chunk.
  #passages = new Map<string, StagedSearchDoc[]>();

  // Reads the chunk's live staged docs that match `where`, with any extra
  // SELECT expressions named in `flags`.
  #read: (
    chunk: string[],
    where: string,
    flags?: Record<string, string>,
  ) => Promise<Record<string, unknown>[]>;

  constructor(
    read: (
      chunk: string[],
      where: string,
      flags?: Record<string, string>,
    ) => Promise<Record<string, unknown>[]>,
  ) {
    this.#read = read;
  }

  // The chunk's staged docs that match `filter`.
  async docs(chunk: string[], filter: string): Promise<StagedSearchDoc[]> {
    let key = chunk.join('\u0000');
    if (filter === VECTOR_DOC_FILTER) {
      let rows = (await this.#read(
        chunk,
        `(${VECTOR_DOC_FILTER} OR ${PASSAGE_DOC_FILTER})`,
        { for_vectors: VECTOR_DOC_FILTER, for_passages: PASSAGE_DOC_FILTER },
      )) as unknown as FlaggedStagedSearchDoc[];
      this.#passages.set(
        key,
        rows.filter((row) => row.for_passages).map(strip),
      );
      return rows.filter((row) => row.for_vectors).map(strip);
    }
    if (filter === PASSAGE_DOC_FILTER) {
      let kept = this.#passages.get(key);
      if (kept) {
        this.#passages.delete(key);
        return kept;
      }
    }
    return (await this.#read(chunk, filter)) as unknown as StagedSearchDoc[];
  }
}

function strip(row: FlaggedStagedSearchDoc): StagedSearchDoc {
  return { url: row.url, type: row.type, search_doc: row.search_doc };
}
