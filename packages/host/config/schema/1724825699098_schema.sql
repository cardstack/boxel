-- This is auto-generated by packages/realm-server/scripts/convert-to-sqlite.ts
-- Please don't directly modify this file

 CREATE TABLE IF NOT EXISTS boxel_index (
   url TEXT NOT NULL,
   file_alias TEXT NOT NULL,
   type TEXT NOT NULL,
   realm_version INTEGER NOT NULL,
   realm_url TEXT NOT NULL,
   pristine_doc BLOB,
   search_doc BLOB,
   error_doc BLOB,
   deps BLOB,
   types BLOB,
   isolated_html TEXT,
   indexed_at,
   is_deleted BOOLEAN,
   source TEXT,
   transpiled_code TEXT,
   last_modified,
   embedded_html BLOB,
   atom_html TEXT,
   fitted_html BLOB,
   display_names BLOB,
   PRIMARY KEY ( url, realm_version, realm_url, type ) 
);

 CREATE TABLE IF NOT EXISTS realm_meta (
   realm_url TEXT NOT NULL,
   realm_version INTEGER NOT NULL,
   value BLOB NOT NULL,
   indexed_at,
   PRIMARY KEY ( realm_url, realm_version ) 
);

 CREATE TABLE IF NOT EXISTS realm_user_permissions (
   realm_url TEXT NOT NULL,
   username TEXT NOT NULL,
   read BOOLEAN NOT NULL,
   write BOOLEAN NOT NULL,
   PRIMARY KEY ( realm_url, username ) 
);

 CREATE TABLE IF NOT EXISTS realm_versions (
   realm_url TEXT NOT NULL,
   current_version INTEGER NOT NULL,
   PRIMARY KEY ( realm_url ) 
);