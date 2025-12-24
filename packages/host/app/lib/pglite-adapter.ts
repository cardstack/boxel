import {
  type DBAdapter,
  type PgPrimitive,
  type ExecuteOptions,
  type Expression,
  expressionToSql,
  logger,
  Deferred,
} from '@cardstack/runtime-common';
import { Extensions, PGlite, PGliteInterface } from '@electric-sql/pglite';
const log = logger('pg-lite-adapter');

export default class PgLiteAdapter implements DBAdapter {
  readonly kind = 'pg';
  #isClosed = false;
  private base: PGliteInterface<Extensions>;
  private db: PGliteInterface<Extensions>;

  constructor() {
    console.log('Constructing new PgLiteAdapter');
    (globalThis as any).__dbAdapter = this;
  }

  get isClosed() {
    return this.#isClosed;
  }

  async close() {
    await this.db.close();
    this.#isClosed = true;
  }

  async setup() {
    this.base = await PGlite.create();
    await this.base.exec(`
      --
-- PostgreSQL database dump
--

-- Dumped from database version 16.3 (Debian 16.3-1.pgdg120+1)
-- Dumped by pg_dump version 16.3 (Debian 16.3-1.pgdg120+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: credit_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.credit_type AS ENUM (
    'plan_allowance',
    'plan_allowance_used',
    'extra_credit',
    'extra_credit_used',
    'plan_allowance_expired'
);


--
-- Name: job_statuses; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_statuses AS ENUM (
    'unfulfilled',
    'resolved',
    'rejected'
);


--
-- Name: queue_statuses; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.queue_statuses AS ENUM (
    'idle',
    'working'
);


--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_status AS ENUM (
    'active',
    'canceled',
    'expired',
    'ended_due_to_plan_change'
);


--
-- Name: delete_old_ai_bot_event_processing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_old_ai_bot_event_processing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      DELETE FROM ai_bot_event_processing
      WHERE (completed_at IS NOT NULL AND completed_at < NOW() - INTERVAL '30 minutes')
         OR (completed_at IS NULL AND processing_started_at < NOW() - INTERVAL '30 minutes');
      RETURN NEW;
    END;
    $$;


--
-- Name: ensure_single_active_subscription(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_single_active_subscription() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.status = 'active' THEN
        IF EXISTS (
          SELECT 1 FROM subscriptions
          WHERE user_id = NEW.user_id
            AND status = 'active'
            AND id != NEW.id
        ) THEN
          RAISE EXCEPTION 'User already has an active subscription';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;


--
-- Name: jsonb_tree(jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jsonb_tree(data jsonb, root_path text DEFAULT NULL::text) RETURNS TABLE(fullkey text, jsonb_value jsonb, text_value text, level integer)
    LANGUAGE sql
    AS $_$
    WITH RECURSIVE cte AS (
        SELECT
            (
              CASE
                WHEN root_path IS NULL THEN '$'
                ELSE root_path
              END
            ) AS current_key,
            (CASE
              WHEN root_path IS NULL THEN data
              ELSE data #> string_to_array(substring(root_path from 3), '.') -- trim off leading '$.'
            END) AS jsonb_value,
            null AS text_value,
            1 AS level

        UNION ALL

        (
          SELECT
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN c.current_key || '.' || key
                  WHEN c.jsonb_value IS JSON ARRAY THEN c.current_key || '[' || (index - 1)::TEXT || ']'
                  ELSE c.current_key
              END,
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN kv.value
                  WHEN c.jsonb_value IS JSON ARRAY THEN arr.value
              END,
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN trim('"' from kv.value::text)
                  WHEN c.jsonb_value IS JSON ARRAY THEN trim('"' from arr.value::text)
              END,
              c.level + 1
          FROM
              cte c
          CROSS JOIN LATERAL jsonb_each(
              CASE
                  WHEN c.jsonb_value IS JSON OBJECT THEN c.jsonb_value
                  ELSE '{"_":null}'::jsonb
              END
          ) AS kv (key, value)
          CROSS JOIN LATERAL jsonb_array_elements(
              CASE
                  WHEN c.jsonb_value IS JSON ARRAY THEN c.jsonb_value
                  ELSE '[null]'::jsonb
              END
          ) WITH ORDINALITY arr(value, index)
          WHERE
              c.jsonb_value IS JSON OBJECT OR c.jsonb_value IS JSON ARRAY
        )
    )
    SELECT * FROM cte 
    $_$;


--
-- Name: boxel_index; Type: TABLE; Schema: public; Owner: -
--

CREATE UNLOGGED TABLE public.boxel_index (
    url character varying NOT NULL,
    file_alias character varying NOT NULL,
    type character varying NOT NULL,
    realm_version integer NOT NULL,
    realm_url character varying NOT NULL,
    pristine_doc jsonb,
    search_doc jsonb,
    error_doc jsonb,
    deps jsonb DEFAULT '[]'::jsonb,
    types jsonb,
    isolated_html character varying,
    indexed_at bigint,
    is_deleted boolean,
    last_modified bigint,
    embedded_html jsonb,
    atom_html character varying,
    fitted_html jsonb,
    display_names jsonb,
    resource_created_at bigint,
    icon_html character varying,
    head_html character varying
);


--
-- Name: boxel_index_working; Type: TABLE; Schema: public; Owner: -
--

CREATE UNLOGGED TABLE public.boxel_index_working (
    url character varying NOT NULL,
    file_alias character varying NOT NULL,
    type character varying NOT NULL,
    realm_version integer NOT NULL,
    realm_url character varying NOT NULL,
    pristine_doc jsonb,
    search_doc jsonb,
    error_doc jsonb,
    deps jsonb DEFAULT '[]'::jsonb,
    types jsonb,
    icon_html character varying,
    isolated_html character varying,
    indexed_at bigint,
    is_deleted boolean,
    last_modified bigint,
    embedded_html jsonb,
    atom_html character varying,
    fitted_html jsonb,
    display_names jsonb,
    resource_created_at bigint,
    head_html character varying
);


--
-- Name: job_reservations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_reservations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: modules; Type: TABLE; Schema: public; Owner: -
--

CREATE UNLOGGED TABLE public.modules (
    url character varying NOT NULL,
    cache_scope character varying NOT NULL,
    auth_user_id character varying NOT NULL,
    resolved_realm_url character varying NOT NULL,
    definitions jsonb,
    deps jsonb,
    error_doc jsonb,
    created_at bigint
);


--
-- Name: published_realms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.published_realms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_username character varying NOT NULL,
    source_realm_url character varying NOT NULL,
    published_realm_url character varying NOT NULL,
    last_published_at bigint
);


--
-- Name: realm_file_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.realm_file_meta (
    realm_url character varying NOT NULL,
    file_path character varying NOT NULL,
    created_at integer NOT NULL
);


--
-- Name: realm_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.realm_meta (
    realm_url character varying NOT NULL,
    realm_version integer NOT NULL,
    value jsonb NOT NULL,
    indexed_at bigint
);


--
-- Name: realm_user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.realm_user_permissions (
    realm_url character varying NOT NULL,
    username character varying NOT NULL,
    read boolean NOT NULL,
    write boolean NOT NULL,
    realm_owner boolean DEFAULT false NOT NULL
);


--
-- Name: realm_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE UNLOGGED TABLE public.realm_versions (
    realm_url character varying NOT NULL,
    current_version integer NOT NULL
);


--
-- Name: boxel_index boxel_index_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boxel_index
    ADD CONSTRAINT boxel_index_pkey PRIMARY KEY (url, realm_url);


--
-- Name: boxel_index_working boxel_index_working_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boxel_index_working
    ADD CONSTRAINT boxel_index_working_pkey PRIMARY KEY (url, realm_url);


--
-- Name: modules modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (url, cache_scope, auth_user_id);


--
-- Name: published_realms published_realms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_realms
    ADD CONSTRAINT published_realms_pkey PRIMARY KEY (id);


--
-- Name: realm_file_meta realm_file_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realm_file_meta
    ADD CONSTRAINT realm_file_meta_pkey PRIMARY KEY (realm_url, file_path);


--
-- Name: realm_meta realm_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realm_meta
    ADD CONSTRAINT realm_meta_pkey PRIMARY KEY (realm_url, realm_version);


--
-- Name: realm_user_permissions realm_user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realm_user_permissions
    ADD CONSTRAINT realm_user_permissions_pkey PRIMARY KEY (realm_url, username);


--
-- Name: realm_versions realm_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realm_versions
    ADD CONSTRAINT realm_versions_pkey PRIMARY KEY (realm_url);


--
-- Name: boxel_index_deps_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_deps_index ON public.boxel_index USING gin (deps);


--
-- Name: boxel_index_embedded_html_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_embedded_html_index ON public.boxel_index USING gin (embedded_html);


--
-- Name: boxel_index_file_alias_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_file_alias_index ON public.boxel_index USING btree (file_alias);


--
-- Name: boxel_index_fitted_html_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_fitted_html_index ON public.boxel_index USING gin (fitted_html);


--
-- Name: boxel_index_last_modified_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_last_modified_index ON public.boxel_index USING btree (last_modified);


--
-- Name: boxel_index_realm_url_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_realm_url_index ON public.boxel_index USING btree (realm_url);


--
-- Name: boxel_index_realm_url_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_realm_url_type_index ON public.boxel_index USING btree (realm_url, type);


--
-- Name: boxel_index_realm_version_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_realm_version_index ON public.boxel_index USING btree (realm_version);


--
-- Name: boxel_index_resource_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_resource_created_at_index ON public.boxel_index USING btree (resource_created_at);


--
-- Name: boxel_index_search_doc_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_search_doc_index ON public.boxel_index USING gin (search_doc);


--
-- Name: boxel_index_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_type_index ON public.boxel_index USING btree (type);


--
-- Name: boxel_index_types_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_types_index ON public.boxel_index USING gin (types);


--
-- Name: boxel_index_url_realm_version_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_url_realm_version_index ON public.boxel_index USING btree (url, realm_version);


--
-- Name: boxel_index_working_deps_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_deps_index ON public.boxel_index_working USING gin (deps);


--
-- Name: boxel_index_working_embedded_html_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_embedded_html_index ON public.boxel_index_working USING gin (embedded_html);


--
-- Name: boxel_index_working_file_alias_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_file_alias_index ON public.boxel_index_working USING btree (file_alias);


--
-- Name: boxel_index_working_fitted_html_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_fitted_html_index ON public.boxel_index_working USING gin (fitted_html);


--
-- Name: boxel_index_working_last_modified_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_last_modified_index ON public.boxel_index_working USING btree (last_modified);


--
-- Name: boxel_index_working_realm_url_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_realm_url_index ON public.boxel_index_working USING btree (realm_url);


--
-- Name: boxel_index_working_realm_url_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_realm_url_type_index ON public.boxel_index_working USING btree (realm_url, type);


--
-- Name: boxel_index_working_realm_version_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_realm_version_index ON public.boxel_index_working USING btree (realm_version);


--
-- Name: boxel_index_working_resource_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_resource_created_at_index ON public.boxel_index_working USING btree (resource_created_at);


--
-- Name: boxel_index_working_search_doc_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_search_doc_index ON public.boxel_index_working USING gin (search_doc);


--
-- Name: boxel_index_working_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_type_index ON public.boxel_index_working USING btree (type);


--
-- Name: boxel_index_working_types_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_types_index ON public.boxel_index_working USING gin (types);


--
-- Name: boxel_index_working_url_realm_version_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boxel_index_working_url_realm_version_index ON public.boxel_index_working USING btree (url, realm_version);


--
-- Name: modules_resolved_realm_url_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX modules_resolved_realm_url_index ON public.modules USING btree (resolved_realm_url);


--
-- Name: published_realms_published_realm_url_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX published_realms_published_realm_url_index ON public.published_realms USING btree (published_realm_url);


--
-- Name: published_realms_source_realm_url_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX published_realms_source_realm_url_index ON public.published_realms USING btree (source_realm_url);


--
-- Name: realm_file_meta_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX realm_file_meta_created_at_index ON public.realm_file_meta USING btree (created_at);


--
-- Name: realm_file_meta_realm_url_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX realm_file_meta_realm_url_index ON public.realm_file_meta USING btree (realm_url);


--
-- Name: realm_user_permissions_username_read_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX realm_user_permissions_username_read_index ON public.realm_user_permissions USING btree (username, read);


--
-- Name: realm_versions_current_version_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX realm_versions_current_version_index ON public.realm_versions USING btree (current_version);


--
-- PostgreSQL database dump complete
--


    `);
    this.db = await this.base.clone();
  }

  async execute(
    sql: string,
    opts?: ExecuteOptions,
  ): Promise<Record<string, PgPrimitive>[]> {
    try {
      let { rows } = await this.db.query(sql, opts?.bind);
      return rows;
    } catch (e: any) {
      console.error(
        `Error executing SQL ${e.message} (${e.hint}):\n${sql}${
          opts?.bind ? ' with bindings: ' + JSON.stringify(opts?.bind) : ''
        }`,
        e,
      );
      throw e;
    }
  }

  async reset() {
    let start = performance.now();
    await this.db.close();
    console.log(
      `pg-lite db closed after ${(performance.now() - start).toFixed(2)} ms`,
    );
    this.db = await this.base.clone();
    console.log(
      `pg-lite db cloned after ${(performance.now() - start).toFixed(2)} ms`,
    );
  }

  async listen(
    channel: string,
    handler: (notification: any) => void,
    fn: () => Promise<void>,
  ) {
    let unsubscribe: (() => Promise<void>) | undefined;
    try {
      unsubscribe = await this.db.listen(safeName(channel), (n) => {
        log.debug(`heard pg notification for channel %s`, safeName(channel));
        handler(n);
      });
      await fn();
    } finally {
      if (unsubscribe) {
        await unsubscribe();
      }
    }
  }

  async getColumnNames(tableName: string): Promise<string[]> {
    let result = await this.execute(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      {
        bind: [tableName],
      },
    );
    return result.map((row) => row.column_name) as string[];
  }
}

function safeName(name: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`potentially unsafe name in SQL: ${name}`);
  }
  return name;
}
