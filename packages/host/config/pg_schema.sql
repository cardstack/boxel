-- PG-native schema for PGLite (in-process PostgreSQL for tests)
-- Derived from the same migrations as the SQLite schema.
-- Tables excluded: jobs, queues, job_reservations, subscription_cycles,
--   subscriptions, ai_actions, users, plans, credits_ledger, stripe_events,
--   ai_bot_event_processing, proxy_endpoints, claimed_domains_for_sites, session_rooms

CREATE TABLE IF NOT EXISTS bot_commands (
  id uuid NOT NULL,
  bot_id uuid NOT NULL,
  command text NOT NULL,
  command_filter jsonb NOT NULL,
  created_at timestamp NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS bot_registrations (
  id uuid NOT NULL,
  username text NOT NULL,
  created_at timestamp NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS boxel_index (
  url varchar NOT NULL,
  file_alias varchar NOT NULL,
  type varchar NOT NULL,
  realm_version integer NOT NULL,
  realm_url varchar NOT NULL,
  pristine_doc jsonb,
  search_doc jsonb,
  error_doc jsonb,
  deps jsonb DEFAULT '[]',
  types jsonb,
  isolated_html varchar,
  indexed_at bigint,
  is_deleted boolean,
  last_modified bigint,
  embedded_html jsonb,
  atom_html varchar,
  fitted_html jsonb,
  display_names jsonb,
  resource_created_at bigint,
  icon_html varchar,
  head_html varchar,
  has_error boolean DEFAULT false NOT NULL,
  last_known_good_deps jsonb,
  PRIMARY KEY (url, realm_url, type)
);

CREATE TABLE IF NOT EXISTS boxel_index_working (
  url varchar NOT NULL,
  file_alias varchar NOT NULL,
  type varchar NOT NULL,
  realm_version integer NOT NULL,
  realm_url varchar NOT NULL,
  pristine_doc jsonb,
  search_doc jsonb,
  error_doc jsonb,
  deps jsonb DEFAULT '[]',
  types jsonb,
  icon_html varchar,
  isolated_html varchar,
  indexed_at bigint,
  is_deleted boolean,
  last_modified bigint,
  embedded_html jsonb,
  atom_html varchar,
  fitted_html jsonb,
  display_names jsonb,
  resource_created_at bigint,
  head_html varchar,
  has_error boolean DEFAULT false NOT NULL,
  last_known_good_deps jsonb,
  PRIMARY KEY (url, realm_url, type)
);

CREATE TABLE IF NOT EXISTS incoming_webhooks (
  id uuid NOT NULL,
  username text NOT NULL,
  webhook_path text NOT NULL UNIQUE,
  verification_type text NOT NULL,
  verification_config jsonb NOT NULL,
  signing_secret text NOT NULL,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS modules (
  url varchar NOT NULL,
  cache_scope varchar NOT NULL,
  auth_user_id varchar NOT NULL,
  resolved_realm_url varchar NOT NULL,
  definitions jsonb,
  deps jsonb,
  error_doc jsonb,
  created_at bigint,
  file_alias text,
  url_hash text GENERATED ALWAYS AS (md5(url)) STORED NOT NULL,
  PRIMARY KEY (url_hash, cache_scope, auth_user_id)
);

CREATE TABLE IF NOT EXISTS published_realms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_username varchar NOT NULL,
  source_realm_url varchar NOT NULL,
  published_realm_url varchar NOT NULL,
  last_published_at bigint,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS realm_file_meta (
  realm_url varchar NOT NULL,
  file_path varchar NOT NULL,
  created_at integer NOT NULL,
  content_hash text,
  content_size integer,
  PRIMARY KEY (realm_url, file_path)
);

CREATE TABLE IF NOT EXISTS realm_meta (
  realm_url varchar NOT NULL,
  realm_version integer NOT NULL,
  value jsonb NOT NULL,
  indexed_at bigint,
  PRIMARY KEY (realm_url, realm_version)
);

CREATE TABLE IF NOT EXISTS realm_user_permissions (
  realm_url varchar NOT NULL,
  username varchar NOT NULL,
  read boolean NOT NULL,
  write boolean NOT NULL,
  realm_owner boolean DEFAULT false NOT NULL,
  PRIMARY KEY (realm_url, username)
);

CREATE TABLE IF NOT EXISTS realm_versions (
  realm_url varchar NOT NULL,
  current_version integer NOT NULL,
  PRIMARY KEY (realm_url)
);

CREATE TABLE IF NOT EXISTS webhook_commands (
  id uuid NOT NULL,
  incoming_webhook_id uuid NOT NULL REFERENCES incoming_webhooks(id) ON DELETE CASCADE,
  command text NOT NULL,
  command_filter jsonb,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL,
  PRIMARY KEY (id)
);

-- Custom function used by the query engine for deep JSON traversal
CREATE OR REPLACE FUNCTION jsonb_tree(data JSONB, root_path TEXT DEFAULT NULL)
RETURNS TABLE (fullkey TEXT, jsonb_value JSONB, text_value TEXT, level INT) AS
$$
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
          ELSE data #> string_to_array(substring(root_path from 3), '.')
        END) AS jsonb_value,
        null::text AS text_value,
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
$$
LANGUAGE SQL;
