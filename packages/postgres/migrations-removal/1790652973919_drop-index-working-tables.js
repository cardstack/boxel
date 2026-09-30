exports.shorthands = undefined;

// Every index pass stages its rows in its own staging in `boxel_index_pending`
// / `prerendered_html_pending`, and nothing reads or writes the shared
// `boxel_index_working` / `prerendered_html_working` tables. Drop them; their
// indexes and constraints fall with them.

const TABLES = ['boxel_index_working', 'prerendered_html_working'];

exports.up = (pgm) => {
  for (let table of TABLES) {
    pgm.dropTable(table, { ifExists: true });
  }
};

// Restore both tables empty, in the shape they had when they were dropped: the
// `down` of every earlier migration that touched them drops a column or index
// by name, so each of those has to exist again.
exports.down = (pgm) => {
  pgm.sql(`
    CREATE UNLOGGED TABLE boxel_index_working (
      url character varying NOT NULL,
      file_alias character varying NOT NULL,
      type character varying NOT NULL,
      generation integer NOT NULL,
      realm_url character varying NOT NULL,
      pristine_doc jsonb,
      search_doc jsonb,
      error_doc jsonb,
      deps jsonb DEFAULT '[]'::jsonb,
      types jsonb,
      icon_html character varying,
      indexed_at bigint,
      is_deleted boolean,
      last_modified bigint,
      display_names jsonb,
      resource_created_at bigint,
      has_error boolean DEFAULT false NOT NULL,
      last_known_good_deps jsonb,
      diagnostics jsonb,
      job_id integer,
      host_shell_generation integer,
      source_content_hash character varying,
      CONSTRAINT boxel_index_working_type_check
        CHECK (type IN ('instance', 'file')),
      CONSTRAINT boxel_index_working_pkey PRIMARY KEY (url, realm_url, type)
    );
    CREATE INDEX boxel_index_working_deps_index
      ON boxel_index_working USING gin (deps);
    CREATE INDEX boxel_index_working_file_alias_index
      ON boxel_index_working (file_alias);
    CREATE INDEX boxel_index_working_generation_index
      ON boxel_index_working (generation);
    CREATE INDEX boxel_index_working_host_shell_generation_index
      ON boxel_index_working (realm_url, host_shell_generation)
      WHERE host_shell_generation IS NOT NULL;
    CREATE INDEX boxel_index_working_last_modified_index
      ON boxel_index_working (last_modified);
    CREATE INDEX boxel_index_working_realm_url_index
      ON boxel_index_working (realm_url);
    CREATE INDEX boxel_index_working_realm_url_job_id_index
      ON boxel_index_working (realm_url, job_id);
    CREATE INDEX boxel_index_working_realm_url_type_index
      ON boxel_index_working (realm_url, type);
    CREATE INDEX boxel_index_working_resource_created_at_index
      ON boxel_index_working (resource_created_at);
    CREATE INDEX boxel_index_working_search_doc_index
      ON boxel_index_working USING gin (search_doc);
    CREATE INDEX boxel_index_working_type_index
      ON boxel_index_working (type);
    CREATE INDEX boxel_index_working_types_containment_idx
      ON boxel_index_working
      USING gin (COALESCE(types, '[]'::jsonb) jsonb_path_ops);
    CREATE INDEX boxel_index_working_url_generation_index
      ON boxel_index_working (url, generation);

    CREATE UNLOGGED TABLE prerendered_html_working (
      url character varying NOT NULL,
      file_alias character varying NOT NULL,
      realm_url character varying NOT NULL,
      type character varying NOT NULL,
      fitted_html jsonb,
      embedded_html jsonb,
      atom_html character varying,
      head_html character varying,
      isolated_html character varying,
      markdown text,
      deps jsonb,
      last_known_good_deps jsonb,
      generation integer NOT NULL,
      is_deleted boolean,
      error_doc jsonb,
      rendered_at bigint,
      job_id integer,
      diagnostics jsonb,
      screenshots jsonb,
      CONSTRAINT prerendered_html_working_pkey
        PRIMARY KEY (url, realm_url, type)
    );
    CREATE INDEX prerendered_html_working_markdown_fts_idx
      ON prerendered_html_working
      USING gin (to_tsvector('english', markdown_search_text(markdown)));
    CREATE INDEX prerendered_html_working_realm_url_index
      ON prerendered_html_working (realm_url);
    CREATE INDEX prerendered_html_working_realm_url_job_id_index
      ON prerendered_html_working (realm_url, job_id);
  `);
};
