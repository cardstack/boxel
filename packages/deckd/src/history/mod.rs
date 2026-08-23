//! History backend — opaque change ids, same contract as Deck's HistoryBackend.

use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod jj_lib;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Actor {
    pub name: String,
    #[serde(default)]
    pub email: Option<String>,
}

/// Wire shape matching Deck `HistoryEntry` / deckd client tests.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub change_id: String,
    pub commit_id: String,
    pub timestamp: String,
    pub description: String,
    pub files_summary: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
}

/// Wire shape matching Deck `RestorePlan`: path lists only (bytes via file-at).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestorePlan {
    pub writes: Vec<String>,
    pub deletes: Vec<String>,
}

#[derive(Debug, Error)]
pub enum HistoryBackendError {
    #[error("not found: {0}")]
    #[allow(dead_code)]
    NotFound(String),
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("jj: {0}")]
    Jj(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub trait HistoryBackend: Send + Sync {
    fn ensure<'a>(&'a self, dir: &'a str) -> BoxFuture<'a, Result<(), HistoryBackendError>>;

    /// Create a lightweight named workspace in the source Realm's shared
    /// History repository, with an empty working-copy change whose parent is
    /// `revision_id`. The destination does not become a separate History
    /// repository: all branch workspaces share `<realm>/.deck/history/repo`.
    fn fork<'a>(
        &'a self,
        source_dir: &'a str,
        target_dir: &'a str,
        revision_id: &'a str,
        workspace_name: &'a str,
    ) -> BoxFuture<'a, Result<(), HistoryBackendError>>;

    /// Remove a prepared named workspace. The owning Realm's shared History
    /// repository and all immutable ancestor commits remain intact.
    fn discard<'a>(&'a self, dir: &'a str) -> BoxFuture<'a, Result<(), HistoryBackendError>>;

    /// Fire-and-forget remember: schedule an async collapsed seal. Returns
    /// immediately; many notes across many depots must not block the caller.
    fn note<'a>(
        &'a self,
        dir: &'a str,
        path: &'a str,
    ) -> BoxFuture<'a, Result<(), HistoryBackendError>> {
        let _ = (dir, path);
        Box::pin(async { Err(HistoryBackendError::Invalid("note not supported".into())) })
    }

    /// Seal any pending async notes for `dir` now. No-op when nothing pending.
    fn flush_notes<'a>(
        &'a self,
        dir: &'a str,
    ) -> BoxFuture<'a, Result<Option<String>, HistoryBackendError>> {
        let _ = dir;
        Box::pin(async { Ok(None) })
    }

    fn seal<'a>(
        &'a self,
        dir: &'a str,
        message: &'a str,
        actor: Option<&'a Actor>,
    ) -> BoxFuture<'a, Result<Option<String>, HistoryBackendError>>;

    /// Seal the materialized working tree as a two-parent History change.
    /// Both ids are exact sealed changes in this Realm's shared repository;
    /// the target id must be the current working-copy parent.
    fn merge<'a>(
        &'a self,
        dir: &'a str,
        target_revision_id: &'a str,
        source_revision_id: &'a str,
        message: &'a str,
        actor: Option<&'a Actor>,
    ) -> BoxFuture<'a, Result<String, HistoryBackendError>>;

    fn list<'a>(
        &'a self,
        dir: &'a str,
    ) -> BoxFuture<'a, Result<Vec<HistoryEntry>, HistoryBackendError>>;

    fn file_at<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
        path: &'a str,
    ) -> BoxFuture<'a, Result<Option<Vec<u8>>, HistoryBackendError>>;

    fn file_list_at<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, HistoryBackendError>>;

    fn restore_plan<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
    ) -> BoxFuture<'a, Result<RestorePlan, HistoryBackendError>>;
}

pub fn history_dir(depot: &Path) -> std::path::PathBuf {
    depot.join(".deck").join("history")
}

/// Machinery / VCS paths that must never appear in History tree listings or
/// restore plans.
///
/// Any path segment named `.jj` or starting with `.jj.` is machinery: the
/// thin stub is `.jj/`, and jj may leave `.jj.main-orphan/` (and similar)
/// beside it during workspace moves.
pub fn is_machinery_path(path: &str) -> bool {
    path.split('/').any(|seg| {
        seg == ".deck"
            || seg == ".jj"
            || seg.starts_with(".jj.")
            || seg == ".git"
            || seg == ".gitignore"
            || seg == "node_modules"
            || seg == ".DS_Store"
            || seg == ".boxel-history"
    })
}
