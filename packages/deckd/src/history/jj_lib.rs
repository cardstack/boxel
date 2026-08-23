//! jj-lib History — derived from the boxel-labs `jj-historyd`
//! implementation, with these Deck-only deltas called out inline:
//!
//! 1. `Workspace::init_internal_git` (not colocated) — no depot `.git` / gitlink.
//! 2. After init, durable store lives at `.deck/history/repo` with a thin
//!    `.jj/repo` *file* pointer (jj's supported out-of-tree repo path).
//! 3. Snapshot ignores `.deck` / `.jj` / … so History cannot capture itself.
//! 4. `/file-list-at` + optional seal `actor` (Deck D1 gaps historyd lacked).
//!
//! HTTP still runs ops on `spawn_blocking` + `pollster` because jj-lib
//! futures are `!Send` — same as historyd's `main.rs`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{TimeZone, Utc};
use futures::AsyncReadExt as _;
use futures::StreamExt as _;
use jj_lib::backend::{FileId, TreeValue};
use jj_lib::commit::Commit;
use jj_lib::config::{ConfigLayer, ConfigSource, StackedConfig};
use jj_lib::fileset::FilesetExpression;
use jj_lib::gitignore::GitIgnoreFile;
use jj_lib::matchers::{EverythingMatcher, NothingMatcher};
use jj_lib::merge::Diff;
use jj_lib::merged_tree::MergedTree;
use jj_lib::object_id::{HexPrefix, ObjectId, PrefixResolution};
use jj_lib::ref_name::WorkspaceName;
use jj_lib::repo::{ReadonlyRepo, Repo as _, StoreFactories};
use jj_lib::repo_path::{RepoPath, RepoPathBuf};
use jj_lib::revset::{RevsetExpression, RevsetFilterPredicate};
use jj_lib::settings::UserSettings;
use jj_lib::working_copy::SnapshotOptions;
use jj_lib::workspace::{
    default_working_copy_factories, Workspace, WorkspaceInitError, WorkspaceLoadError,
};
use tokio::sync::Mutex;

/// Per-depot async note debounce. Realm servers fire `/note` and return;
/// seals collapse across many realms / many paths under the same depot.
const NOTE_DEBOUNCE_MS: u64 = 400;

use super::{
    history_dir, is_machinery_path, Actor, BoxFuture, HistoryBackend,
    HistoryBackendError, HistoryEntry, RestorePlan,
};

const REPO_POINTER: &str = "../.deck/history/repo";

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Init(#[from] WorkspaceInitError),
    #[error(transparent)]
    Load(#[from] WorkspaceLoadError),
    #[error(transparent)]
    Other(#[from] Box<dyn std::error::Error + Send + Sync>),
}

impl HistoryError {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }
}

impl From<HistoryError> for HistoryBackendError {
    fn from(value: HistoryError) -> Self {
        HistoryBackendError::Jj(value.to_string())
    }
}

type HistoryResult<T> = std::result::Result<T, HistoryError>;

#[derive(Default)]
struct PendingNotes {
    paths: HashSet<String>,
    /// True while one debounce worker is armed for this depot (watchexec coalesce).
    armed: bool,
}

/// Per-depot gates — write vs read split so `/list` never waits on a seal.
///
/// - **write** (`RwLock` write): ensure / seal / restore (mutates WC + op log)
/// - **read** (`RwLock` read): list / file-at / file-list-at (concurrent OK)
///
/// Async notes only touch the in-memory map; sealing takes the write gate later.
pub struct HistoryService {
    gates: Mutex<HashMap<PathBuf, Arc<tokio::sync::RwLock<()>>>>,
    notes: Mutex<HashMap<PathBuf, PendingNotes>>,
}

impl Default for HistoryService {
    fn default() -> Self {
        Self::new()
    }
}

impl HistoryService {
    pub fn new() -> Self {
        hermetic_git_env();
        Self {
            gates: Mutex::new(HashMap::new()),
            notes: Mutex::new(HashMap::new()),
        }
    }

    async fn gate_for(&self, dir: &Path) -> Arc<tokio::sync::RwLock<()>> {
        let key = dir.to_path_buf();
        let mut map = self.gates.lock().await;
        map.entry(key)
            .or_insert_with(|| Arc::new(tokio::sync::RwLock::new(())))
            .clone()
    }

    pub async fn ensure_repo(&self, dir: &Path) -> HistoryResult<()> {
        let gate = self.gate_for(dir).await;
        let _guard = gate.write().await;
        ensure_repo_inner(dir).await
    }

    /// Remember `path` under `dir` and schedule a collapsed seal. Returns
    /// immediately. One debounce worker per depot (not one task per keystroke).
    pub async fn enqueue_note(self: &Arc<Self>, dir: &Path, path: &str) -> HistoryResult<()> {
        if path.is_empty() || is_machinery_path(path) {
            return Ok(());
        }
        let dir = dir.to_path_buf();
        let spawn_worker = {
            let mut map = self.notes.lock().await;
            let pending = map.entry(dir.clone()).or_default();
            pending.paths.insert(path.to_owned());
            if pending.armed {
                false
            } else {
                pending.armed = true;
                true
            }
        };
        if spawn_worker {
            let this = Arc::clone(self);
            tokio::spawn(async move {
                this.debounce_seal_loop(dir).await;
            });
        }
        Ok(())
    }

    /// Watchexec-style coalesce: sleep, drain paths, seal, repeat while dirty.
    async fn debounce_seal_loop(self: Arc<Self>, dir: PathBuf) {
        loop {
            tokio::time::sleep(Duration::from_millis(NOTE_DEBOUNCE_MS)).await;
            let message = {
                let mut map = self.notes.lock().await;
                let Some(pending) = map.get_mut(&dir) else {
                    return;
                };
                let paths = std::mem::take(&mut pending.paths);
                if paths.is_empty() {
                    pending.armed = false;
                    map.remove(&dir);
                    return;
                }
                // Stay armed: more notes may arrive during seal.
                message_for_paths(&paths)
            };
            let this = Arc::clone(&self);
            let dir2 = dir.clone();
            let result = tokio::task::spawn_blocking(move || {
                pollster::block_on(this.seal(&dir2, &message, None))
            })
            .await;
            match result {
                Ok(Ok(_)) => {}
                Ok(Err(error)) => tracing::warn!(%error, "async note seal failed"),
                Err(error) => tracing::warn!(%error, "async note seal join failed"),
            }
            // If nothing new arrived, disarm; else loop for another debounce.
            let mut map = self.notes.lock().await;
            match map.get_mut(&dir) {
                Some(pending) if !pending.paths.is_empty() => continue,
                Some(pending) => {
                    pending.armed = false;
                    map.remove(&dir);
                    return;
                }
                None => return,
            }
        }
    }

    /// Take pending note message for `dir`, if any (disarms debounce worker).
    pub async fn take_pending_message(&self, dir: &Path) -> Option<String> {
        let mut map = self.notes.lock().await;
        match map.remove(dir) {
            Some(pending) if !pending.paths.is_empty() => Some(message_for_paths(&pending.paths)),
            _ => None,
        }
    }

    pub async fn seal(
        &self,
        dir: &Path,
        message: &str,
        actor: Option<&Actor>,
    ) -> HistoryResult<Option<String>> {
        let gate = self.gate_for(dir).await;
        let _guard = gate.write().await;
        ensure_repo_inner(dir).await?;
        seal_inner(dir, message, actor).await
    }

    pub async fn list(&self, dir: &Path) -> HistoryResult<Vec<HistoryEntry>> {
        // Ensure under write (rare after first), then list under read so Hub
        // `_history` fans-out across demos without queuing behind seals.
        self.ensure_repo(dir).await?;
        let gate = self.gate_for(dir).await;
        let _guard = gate.read().await;
        // Do NOT seal here — read path only.
        list_inner(dir).await
    }

    pub async fn file_at(
        &self,
        dir: &Path,
        revision_id: &str,
        path: &str,
    ) -> HistoryResult<Option<Vec<u8>>> {
        if !is_valid_revision_id(revision_id) || !is_valid_history_path(path) {
            return Ok(None);
        }
        self.ensure_repo(dir).await?;
        let gate = self.gate_for(dir).await;
        let _guard = gate.read().await;
        file_at_inner(dir, revision_id, path).await
    }

    pub async fn file_list_at(&self, dir: &Path, revision_id: &str) -> HistoryResult<Vec<String>> {
        if !is_valid_revision_id(revision_id) {
            return Err(HistoryError::msg("invalid revision id"));
        }
        self.ensure_repo(dir).await?;
        let gate = self.gate_for(dir).await;
        let _guard = gate.read().await;
        file_list_at_inner(dir, revision_id).await
    }

    pub async fn restore_plan(&self, dir: &Path, revision_id: &str) -> HistoryResult<RestorePlan> {
        if !is_valid_revision_id(revision_id) {
            return Err(HistoryError::msg("invalid revision id"));
        }
        let gate = self.gate_for(dir).await;
        let _guard = gate.write().await;
        ensure_repo_inner(dir).await?;
        let _ = seal_inner(dir, "save", None).await?;
        restore_plan_inner(dir, revision_id).await
    }
}

/// History adapter: historyd's `spawn_blocking` + `pollster` pattern.
pub struct JjLibHistory {
    inner: Arc<HistoryService>,
}

impl Default for JjLibHistory {
    fn default() -> Self {
        Self::new()
    }
}

impl JjLibHistory {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(HistoryService::new()),
        }
    }

    /// Shared sealer used by HTTP `/note` and the FS watch plane.
    pub fn history(&self) -> Arc<HistoryService> {
        self.inner.clone()
    }

    async fn run<T, F>(&self, f: F) -> std::result::Result<T, HistoryBackendError>
    where
        T: Send + 'static,
        F: FnOnce(Arc<HistoryService>) -> std::result::Result<T, HistoryError> + Send + 'static,
    {
        let inner = self.inner.clone();
        tokio::task::spawn_blocking(move || f(inner))
            .await
            .map_err(|e| HistoryBackendError::Jj(format!("join error: {e}")))?
            .map_err(HistoryBackendError::from)
    }
}

impl HistoryBackend for JjLibHistory {
    fn ensure<'a>(
        &'a self,
        dir: &'a str,
    ) -> BoxFuture<'a, std::result::Result<(), HistoryBackendError>> {
        let dir = PathBuf::from(dir);
        Box::pin(async move {
            self.run(move |h| pollster::block_on(h.ensure_repo(&dir)))
                .await
        })
    }

    fn note<'a>(
        &'a self,
        dir: &'a str,
        path: &'a str,
    ) -> BoxFuture<'a, std::result::Result<(), HistoryBackendError>> {
        let dir = PathBuf::from(dir);
        let path = path.to_owned();
        let inner = self.inner.clone();
        Box::pin(async move {
            inner
                .enqueue_note(&dir, &path)
                .await
                .map_err(HistoryBackendError::from)
        })
    }

    fn flush_notes<'a>(
        &'a self,
        dir: &'a str,
    ) -> BoxFuture<'a, std::result::Result<Option<String>, HistoryBackendError>> {
        let dir = PathBuf::from(dir);
        let inner = self.inner.clone();
        Box::pin(async move {
            let message = inner.take_pending_message(&dir).await;
            match message {
                Some(message) => {
                    let h = Arc::clone(&inner);
                    tokio::task::spawn_blocking(move || {
                        pollster::block_on(h.seal(&dir, &message, None))
                    })
                    .await
                    .map_err(|e| HistoryBackendError::Jj(format!("join error: {e}")))?
                    .map_err(HistoryBackendError::from)
                }
                None => Ok(None),
            }
        })
    }

    fn seal<'a>(
        &'a self,
        dir: &'a str,
        message: &'a str,
        actor: Option<&'a Actor>,
    ) -> BoxFuture<'a, std::result::Result<Option<String>, HistoryBackendError>> {
        let dir = PathBuf::from(dir);
        let message = message.to_owned();
        let actor = actor.cloned();
        Box::pin(async move {
            self.run(move |h| {
                pollster::block_on(h.seal(&dir, &message, actor.as_ref()))
            })
            .await
        })
    }

    fn list<'a>(
        &'a self,
        dir: &'a str,
    ) -> BoxFuture<'a, std::result::Result<Vec<HistoryEntry>, HistoryBackendError>> {
        let dir = PathBuf::from(dir);
        Box::pin(async move { self.run(move |h| pollster::block_on(h.list(&dir))).await })
    }

    fn file_at<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
        path: &'a str,
    ) -> BoxFuture<'a, std::result::Result<Option<Vec<u8>>, HistoryBackendError>> {
        let dir = PathBuf::from(dir);
        let revision_id = revision_id.to_owned();
        let path = path.to_owned();
        Box::pin(async move {
            self.run(move |h| pollster::block_on(h.file_at(&dir, &revision_id, &path)))
                .await
        })
    }

    fn file_list_at<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
    ) -> BoxFuture<'a, std::result::Result<Vec<String>, HistoryBackendError>> {
        let dir = PathBuf::from(dir);
        let revision_id = revision_id.to_owned();
        Box::pin(async move {
            self.run(move |h| pollster::block_on(h.file_list_at(&dir, &revision_id)))
                .await
        })
    }

    fn restore_plan<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
    ) -> BoxFuture<'a, std::result::Result<RestorePlan, HistoryBackendError>> {
        let dir = PathBuf::from(dir);
        let revision_id = revision_id.to_owned();
        Box::pin(async move {
            self.run(move |h| pollster::block_on(h.restore_plan(&dir, &revision_id)))
                .await
        })
    }
}

pub fn is_valid_revision_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes
            .iter()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'z').contains(b))
}

pub fn is_valid_history_path(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.contains('\0') {
        return false;
    }
    !path
        .split('/')
        .any(|segment| segment.is_empty() || segment == "..")
}

fn hermetic_git_env() {
    // Prevent GitBackend from reading host git config (same as historyd).
    unsafe {
        std::env::set_var("GIT_CONFIG_SYSTEM", "/dev/null");
        std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
    }
}

fn user_settings(actor: Option<&Actor>) -> HistoryResult<UserSettings> {
    let name = actor
        .map(|a| sanitize(&a.name))
        .unwrap_or_else(|| "deck-history".into());
    let email = actor
        .and_then(|a| a.email.as_deref())
        .map(sanitize)
        .unwrap_or_else(|| "deck-history@localhost".into());
    let config_text = format!(
        r#"
        user.name = "{name}"
        user.email = "{email}"
        operation.username = "{name}"
        operation.hostname = "deckd.localhost"
    "#
    );
    let mut config = StackedConfig::with_defaults();
    config.add_layer(
        ConfigLayer::parse(ConfigSource::User, &config_text)
            .map_err(|e| HistoryError::msg(e.to_string()))?,
    );
    UserSettings::from_config(config).map_err(|e| HistoryError::msg(e.to_string()))
}

fn sanitize(value: &str) -> String {
    value.replace('"', "").chars().take(200).collect()
}

fn snapshot_options() -> HistoryResult<SnapshotOptions<'static>> {
    // Deck delta vs historyd's empty ignores: never snapshot machinery.
    let ignores = GitIgnoreFile::empty()
        .chain(
            RepoPath::root(),
            Path::new(""),
            b".deck/\n.jj/\n.jj.*/\n.git/\n.gitignore\nnode_modules/\n.DS_Store\n.boxel-history/\n",
        )
        .map_err(|e| HistoryError::msg(e.to_string()))?;
    Ok(SnapshotOptions {
        base_ignores: ignores,
        progress: None,
        start_tracking_matcher: &EverythingMatcher,
        force_tracking_matcher: &NothingMatcher,
        max_new_file_size: u64::MAX,
    })
}

async fn ensure_repo_inner(dir: &Path) -> HistoryResult<()> {
    std::fs::create_dir_all(dir).map_err(|e| HistoryError::msg(e.to_string()))?;
    std::fs::create_dir_all(dir.join(".deck")).map_err(|e| HistoryError::msg(e.to_string()))?;
    if dir.join(".deck").join("timeline").exists() {
        return Err(HistoryError::msg(
            "unsupported Deck History layout: .deck/timeline exists; Deck mode requires .deck/history",
        ));
    }

    let jj = dir.join(".jj");
    let history = history_dir(dir);
    let history_repo = history.join("repo");
    let jj_repo = jj.join("repo");

    if jj_repo.is_file() && history_repo.is_dir() && jj.join("working_copy").is_dir() {
        std::fs::write(&jj_repo, REPO_POINTER).map_err(|e| HistoryError::msg(e.to_string()))?;
        let _ = std::fs::remove_file(history.join(".jj"));
        return Ok(());
    }

    if jj.exists() || history.exists() {
        return Err(HistoryError::msg(format!(
            "noncanonical Deck History layout in {}; expected .deck/history/repo with a .jj/repo pointer",
            dir.display()
        )));
    }

    // Deck forbids a depot .git directory, so initialize jj's internal Git
    // backend and then relocate its durable repo beneath `.deck/history/`.
    let settings = user_settings(None)?;
    let (_workspace, _repo) = Workspace::init_internal_git(&settings, dir).await?;

    if !jj_repo.is_dir() {
        return Err(HistoryError::msg(
            "jj init did not create .jj/repo directory",
        ));
    }
    std::fs::create_dir_all(&history).map_err(|e| HistoryError::msg(e.to_string()))?;
    if history_repo.exists() {
        return Err(HistoryError::msg(format!(
            "{} already exists after init",
            history_repo.display()
        )));
    }
    std::fs::rename(&jj_repo, &history_repo).map_err(|e| HistoryError::msg(e.to_string()))?;
    std::fs::write(&jj_repo, REPO_POINTER).map_err(|e| HistoryError::msg(e.to_string()))?;
    Ok(())
}

async fn load_workspace(dir: &Path) -> HistoryResult<(Workspace, Arc<ReadonlyRepo>)> {
    let settings = user_settings(None)?;
    let workspace = Workspace::load(
        &settings,
        dir,
        &StoreFactories::default(),
        &default_working_copy_factories(),
    )?;
    let repo = workspace
        .repo_loader()
        .load_at_head()
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;
    Ok((workspace, repo))
}

/// Snapshot the working copy into the WC commit (amend tree if dirty).
/// Copied from historyd `snapshot_wc`.
async fn snapshot_wc(
    workspace: &mut Workspace,
    repo: Arc<ReadonlyRepo>,
) -> HistoryResult<(Arc<ReadonlyRepo>, Commit)> {
    let workspace_name = WorkspaceName::DEFAULT.to_owned();
    let options = snapshot_options()?;
    let mut locked_ws = workspace
        .start_working_copy_mutation()
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;

    let wc_commit_id = repo
        .view()
        .get_wc_commit_id(&workspace_name)
        .ok_or_else(|| HistoryError::msg("no working-copy commit"))?
        .clone();
    let wc_commit = repo
        .store()
        .get_commit(&wc_commit_id)
        .map_err(|e| HistoryError::msg(e.to_string()))?;

    let (new_tree, _stats) = locked_ws
        .locked_wc()
        .snapshot(&options)
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;

    let repo = if new_tree.tree_ids_and_labels() != wc_commit.tree().tree_ids_and_labels() {
        let mut tx = repo.start_transaction();
        tx.set_is_snapshot(true);
        let new_wc = tx
            .repo_mut()
            .rewrite_commit(&wc_commit)
            .set_tree(new_tree)
            .write()
            .await
            .map_err(|e| HistoryError::msg(e.to_string()))?;
        tx.repo_mut()
            .set_wc_commit(workspace_name, new_wc.id().clone())
            .map_err(|e| HistoryError::msg(e.to_string()))?;
        let _ = tx
            .repo_mut()
            .rebase_descendants()
            .await
            .map_err(|e| HistoryError::msg(e.to_string()))?;
        tx.commit("snapshot working copy")
            .await
            .map_err(|e| HistoryError::msg(e.to_string()))?
    } else {
        repo
    };

    locked_ws
        .finish(repo.op_id().clone())
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;

    let wc_commit_id = repo
        .view()
        .get_wc_commit_id(WorkspaceName::DEFAULT)
        .ok_or_else(|| HistoryError::msg("no working-copy commit after snapshot"))?
        .clone();
    let wc_commit = repo
        .store()
        .get_commit(&wc_commit_id)
        .map_err(|e| HistoryError::msg(e.to_string()))?;
    Ok((repo, wc_commit))
}

/// Seal dirty WC as one change: describe + new empty child (jj commit).
/// Copied from historyd `seal_inner`, plus optional author via UserSettings
/// rewrite (description path unchanged).
async fn seal_inner(dir: &Path, message: &str, actor: Option<&Actor>) -> HistoryResult<Option<String>> {
    let (mut workspace, repo) = load_workspace(dir).await?;
    let (repo, wc_commit) = snapshot_wc(&mut workspace, repo).await?;

    let empty = wc_commit
        .is_empty(repo.as_ref())
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;
    if empty {
        return Ok(None);
    }

    let workspace_name = WorkspaceName::DEFAULT.to_owned();
    let mut tx = repo.start_transaction();
    let mut rewrite = tx.repo_mut().rewrite_commit(&wc_commit).set_description(message);
    if let Some(actor) = actor {
        // Closest to historyd (no actor) + Deck D1: stamp author on seal.
        let settings = user_settings(Some(actor))?;
        let signature = settings.signature();
        rewrite = rewrite.set_author(signature.clone()).set_committer(signature);
    }
    let sealed = rewrite
        .write()
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;

    let _ = tx
        .repo_mut()
        .rebase_descendants()
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;

    let new_wc = tx
        .repo_mut()
        .new_commit(vec![sealed.id().clone()], sealed.tree())
        .write()
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;
    tx.repo_mut()
        .edit(workspace_name, &new_wc)
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;
    let _ = tx
        .repo_mut()
        .rebase_descendants()
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;
    let _repo = tx
        .commit(format!("commit {}", sealed.id().hex()))
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;

    Ok(Some(sealed.change_id().to_string()))
}

fn message_for_paths(paths: &HashSet<String>) -> String {
    let mut sorted: Vec<&str> = paths.iter().map(String::as_str).collect();
    sorted.sort_unstable();
    let summary = sorted.iter().take(3).copied().collect::<Vec<_>>().join(", ");
    let extra = if sorted.len() > 3 {
        format!(" (+{} more)", sorted.len() - 3)
    } else {
        String::new()
    };
    format!("save: {summary}{extra}")
}

/// History listing via jj's **default commit index + revset engine** and the
/// **changed-path index** — not a hand-rolled DAG walk with per-commit tree
/// diffs (that was the concurrency cliff under `_history`).
async fn list_inner(dir: &Path) -> HistoryResult<Vec<HistoryEntry>> {
    let (_workspace, repo) = load_workspace(dir).await?;
    let store = repo.store();
    let wc_id = repo
        .view()
        .get_wc_commit_id(WorkspaceName::DEFAULT)
        .ok_or_else(|| HistoryError::msg("no working-copy commit"))?
        .clone();

    // ::@ ~ root() ∩ file(all()) — non-empty ancestors of the working copy,
    // evaluated by the index (newest-first).
    let expr = RevsetExpression::commit(wc_id)
        .ancestors()
        .minus(&RevsetExpression::root())
        .intersection(&RevsetExpression::filter(RevsetFilterPredicate::File(
            FilesetExpression::all(),
        )));
    let revset = expr
        .evaluate(repo.as_ref())
        .map_err(|e| HistoryError::msg(e.to_string()))?;

    let mut entries = Vec::new();
    let mut stream = revset.stream();
    while let Some(item) = stream.next().await {
        let commit_id = item.map_err(|e| HistoryError::msg(e.to_string()))?;
        let commit = store
            .get_commit(&commit_id)
            .map_err(|e| HistoryError::msg(e.to_string()))?;

        let files_summary = files_summary_from_index(repo.as_ref(), &commit).await?;
        // Seals that only touched `.jj` / `.jj.main-orphan` / `.deck` / …
        // are History noise from workspace moves — never content. Hide them
        // from `/list` so Hub /track and `/_history` stay readable.
        if files_summary.is_empty() {
            continue;
        }
        let author_name = commit.author().name.clone();
        // Prefer a description from the filtered summary: older seals may
        // still carry a commit message that lists machinery paths.
        let paths: HashSet<String> = files_summary
            .iter()
            .filter_map(|line| line.split_once(' ').map(|(_, p)| p.to_owned()))
            .collect();
        let description = if paths.is_empty() {
            first_line(commit.description()).to_owned()
        } else {
            message_for_paths(&paths)
        };
        entries.push(HistoryEntry {
            change_id: commit.change_id().to_string(),
            commit_id: commit.id().hex(),
            timestamp: format_timestamp(&commit),
            description,
            files_summary,
            author: if author_name.is_empty() || author_name == "deck-history" {
                None
            } else {
                Some(author_name)
            },
        });
    }

    Ok(entries)
}

/// Prefer jj's changed-path index (O(changed files)). Fall back to a tree
/// diff only when that commit was never indexed.
async fn files_summary_from_index(
    repo: &dyn jj_lib::repo::Repo,
    commit: &Commit,
) -> HistoryResult<Vec<String>> {
    match repo
        .index()
        .changed_paths_in_commit(commit.id())
        .map_err(|e| HistoryError::msg(e.to_string()))?
    {
        Some(paths) => Ok(paths
            .map(|p| p.as_internal_file_string().to_owned())
            .filter(|p| !is_machinery_path(p))
            // Index lists paths, not A/M/D; History strips the letter.
            .map(|p| format!("M {p}"))
            .collect()),
        None => {
            let parent_tree = commit
                .parent_tree(repo)
                .await
                .map_err(|e| HistoryError::msg(e.to_string()))?;
            Ok(diff_summary(&parent_tree, &commit.tree())
                .await?
                .into_iter()
                .filter(|line| {
                    let path = line.split_once(' ').map(|(_, p)| p).unwrap_or(line);
                    !is_machinery_path(path)
                })
                .collect())
        }
    }
}

async fn file_at_inner(dir: &Path, revision_id: &str, path: &str) -> HistoryResult<Option<Vec<u8>>> {
    let (_workspace, repo) = load_workspace(dir).await?;
    let commit = match resolve_revision(repo.as_ref(), revision_id)? {
        Some(c) => c,
        None => return Ok(None),
    };
    let repo_path = match RepoPathBuf::from_internal_string(path) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let value = commit
        .tree()
        .path_value(&repo_path)
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;
    let Some(Some(TreeValue::File { id, .. })) = value.as_resolved().cloned() else {
        return Ok(None);
    };
    Ok(Some(read_file_bytes(repo.store(), &repo_path, &id).await?))
}

async fn file_list_at_inner(dir: &Path, revision_id: &str) -> HistoryResult<Vec<String>> {
    let (_workspace, repo) = load_workspace(dir).await?;
    let commit = resolve_revision(repo.as_ref(), revision_id)?
        .ok_or_else(|| HistoryError::msg("revision not found"))?;
    let root = repo.store().root_commit();
    let mut paths = Vec::new();
    let mut stream = root.tree().diff_stream(&commit.tree(), &EverythingMatcher);
    while let Some(entry) = stream.next().await {
        let values = entry
            .values
            .map_err(|e| HistoryError::msg(e.to_string()))?;
        let Diff { before: _, after } = values;
        let path = entry.path.as_internal_file_string().to_owned();
        if is_machinery_path(&path) {
            continue;
        }
        if after.as_resolved().and_then(|v| v.as_ref()).is_some() {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

async fn restore_plan_inner(dir: &Path, revision_id: &str) -> HistoryResult<RestorePlan> {
    let (_workspace, repo) = load_workspace(dir).await?;
    let target = resolve_revision(repo.as_ref(), revision_id)?
        .ok_or_else(|| HistoryError::msg("revision not found"))?;
    let wc_id = repo
        .view()
        .get_wc_commit_id(WorkspaceName::DEFAULT)
        .ok_or_else(|| HistoryError::msg("no working-copy commit"))?
        .clone();
    let wc = repo
        .store()
        .get_commit(&wc_id)
        .map_err(|e| HistoryError::msg(e.to_string()))?;

    let mut writes = Vec::new();
    let mut deletes = Vec::new();
    let mut stream = wc.tree().diff_stream(&target.tree(), &EverythingMatcher);
    while let Some(entry) = stream.next().await {
        let values = entry
            .values
            .map_err(|e| HistoryError::msg(e.to_string()))?;
        let Diff { before, after } = values;
        let path = entry.path.as_internal_file_string().to_owned();
        if is_machinery_path(&path) {
            continue;
        }
        let before_file = before.as_resolved().and_then(|v| v.as_ref()).is_some();
        let after_file = after.as_resolved().and_then(|v| v.as_ref()).is_some();
        match (before_file, after_file) {
            (false, true) | (true, true) => writes.push(path),
            (true, false) => deletes.push(path),
            (false, false) => {}
        }
    }
    Ok(RestorePlan { writes, deletes })
}

fn resolve_revision(repo: &ReadonlyRepo, revision_id: &str) -> HistoryResult<Option<Commit>> {
    if let Some(prefix) = HexPrefix::try_from_reverse_hex(revision_id) {
        match repo
            .resolve_change_id_prefix(&prefix)
            .map_err(|e| HistoryError::msg(e.to_string()))?
        {
            PrefixResolution::SingleMatch(targets) => {
                if let Some((_, commit_id)) = targets.visible_with_offsets().next() {
                    let commit = repo
                        .store()
                        .get_commit(commit_id)
                        .map_err(|e| HistoryError::msg(e.to_string()))?;
                    return Ok(Some(commit));
                }
            }
            PrefixResolution::AmbiguousMatch => {
                return Err(HistoryError::msg("ambiguous change id prefix"));
            }
            PrefixResolution::NoMatch => {}
        }
    }

    if let Some(prefix) = HexPrefix::try_from_hex(revision_id) {
        match repo
            .index()
            .resolve_commit_id_prefix(&prefix)
            .map_err(|e| HistoryError::msg(e.to_string()))?
        {
            PrefixResolution::SingleMatch(commit_id) => {
                let commit = repo
                    .store()
                    .get_commit(&commit_id)
                    .map_err(|e| HistoryError::msg(e.to_string()))?;
                return Ok(Some(commit));
            }
            PrefixResolution::AmbiguousMatch => {
                return Err(HistoryError::msg("ambiguous commit id prefix"));
            }
            PrefixResolution::NoMatch => {}
        }
    }

    Ok(None)
}

async fn read_file_bytes(
    store: &jj_lib::store::Store,
    path: &RepoPath,
    id: &FileId,
) -> HistoryResult<Vec<u8>> {
    let mut reader = store
        .read_file(path, id)
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;
    let mut buf = Vec::new();
    reader
        .read_to_end(&mut buf)
        .await
        .map_err(|e| HistoryError::msg(e.to_string()))?;
    Ok(buf)
}

async fn diff_summary(before: &MergedTree, after: &MergedTree) -> HistoryResult<Vec<String>> {
    let mut out = Vec::new();
    let mut stream = before.diff_stream(after, &EverythingMatcher);
    while let Some(entry) = stream.next().await {
        let values = entry
            .values
            .map_err(|e| HistoryError::msg(e.to_string()))?;
        let Diff { before, after } = values;
        let path = entry.path.as_internal_file_string();
        let had = before.as_resolved().and_then(|v| v.as_ref()).is_some();
        let has = after.as_resolved().and_then(|v| v.as_ref()).is_some();
        let status = match (had, has) {
            (false, true) => 'A',
            (true, false) => 'D',
            (true, true) => 'M',
            (false, false) => continue,
        };
        out.push(format!("{status} {path}"));
    }
    Ok(out)
}

fn first_line(description: &str) -> &str {
    description.lines().next().unwrap_or("")
}

fn format_timestamp(commit: &Commit) -> String {
    let ts = commit.committer().timestamp;
    let secs = ts.timestamp.0 / 1000;
    let nsecs = ((ts.timestamp.0 % 1000) * 1_000_000) as u32;
    match Utc.timestamp_opt(secs, nsecs) {
        chrono::LocalResult::Single(dt) => dt.format("%Y-%m-%dT%H:%M:%S%z").to_string(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn temporary_depot(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("deckd-{name}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn initializes_only_the_canonical_history_layout() {
        let depot = temporary_depot("canonical-layout");
        pollster::block_on(ensure_repo_inner(&depot)).unwrap();

        assert!(history_dir(&depot).join("repo").is_dir());
        assert!(depot.join(".jj/working_copy").is_dir());
        assert_eq!(
            std::fs::read_to_string(depot.join(".jj/repo")).unwrap(),
            REPO_POINTER
        );
        assert!(!depot.join(".git").exists());
        std::fs::remove_dir_all(depot).unwrap();
    }

    #[test]
    fn rejects_the_removed_timeline_layout() {
        let depot = temporary_depot("removed-layout");
        std::fs::create_dir_all(depot.join(".deck/timeline/repo")).unwrap();

        let error = pollster::block_on(ensure_repo_inner(&depot)).unwrap_err();

        assert!(error.to_string().contains("requires .deck/history"));
        assert!(!depot.join(".deck/history").exists());
        std::fs::remove_dir_all(depot).unwrap();
    }
}
