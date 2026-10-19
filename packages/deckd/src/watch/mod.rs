//! Watchexec-shaped FS pipeline for every-save History writes.
//!
//! notify → channel → machinery filter → HistoryService::enqueue_note
//! (per-depot debounce + jj-lib seal on a blocking pool).
//!
//! Architecture: deck/docs/deckd-watchexec-architecture.md
//! Shape reference: watchexec crates/lib (workers + coalesce), not the CLI.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::history::is_machinery_path;
use crate::history::jj_lib::HistoryService;

/// Relative path change inside a watched depot.
#[derive(Debug, Clone)]
pub struct FsNote {
    pub depot: PathBuf,
    pub path: String,
}

/// Owns the notify watcher and fans filtered events into async note/seal.
pub struct WatchPlane {
    roots: Mutex<HashSet<PathBuf>>,
    watcher: Mutex<RecommendedWatcher>,
}

impl WatchPlane {
    pub fn start(history: Arc<HistoryService>) -> Result<Arc<Self>, String> {
        let (event_tx, event_rx) = std::sync::mpsc::channel::<Result<Event, notify::Error>>();
        let (note_tx, mut note_rx) = mpsc::unbounded_channel::<FsNote>();

        let watcher = RecommendedWatcher::new(
            move |res| {
                let _ = event_tx.send(res);
            },
            notify::Config::default(),
        )
        .map_err(|e| format!("notify watcher: {e}"))?;

        let plane = Arc::new(Self {
            roots: Mutex::new(HashSet::new()),
            watcher: Mutex::new(watcher),
        });

        // Bridge sync notify → filtered FsNote (blocking thread ≈ watchexec fs worker).
        let plane_bridge = Arc::clone(&plane);
        std::thread::Builder::new()
            .name("deckd-fs".into())
            .spawn(move || {
                while let Ok(res) = event_rx.recv() {
                    match res {
                        Ok(event) => {
                            for note in plane_bridge.notes_from_event(event) {
                                let _ = note_tx.send(note);
                            }
                        }
                        Err(error) => warn!(%error, "notify error"),
                    }
                }
            })
            .map_err(|e| format!("spawn deckd-fs: {e}"))?;

        // Action worker: enqueue_note (one debounce worker per depot inside HistoryService).
        let history_action = history;
        tokio::spawn(async move {
            while let Some(note) = note_rx.recv().await {
                if let Err(error) = history_action
                    .enqueue_note(&note.depot, &note.path)
                    .await
                {
                    warn!(
                        depot = %note.depot.display(),
                        path = %note.path,
                        %error,
                        "watch note failed"
                    );
                } else {
                    debug!(
                        depot = %note.depot.display(),
                        path = %note.path,
                        "watch noted"
                    );
                }
            }
        });

        Ok(plane)
    }

    /// Register a depot root for recursive watch (idempotent). Called from `/ensure`.
    pub fn watch_depot(&self, dir: &Path) -> Result<(), String> {
        let root = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        {
            let mut roots = self.roots.lock().unwrap();
            if !roots.insert(root.clone()) {
                return Ok(());
            }
        }
        self.watcher
            .lock()
            .unwrap()
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| format!("watch {}: {e}", root.display()))?;
        info!(root = %root.display(), "watching depot for History captures");
        Ok(())
    }

    /// Select writer-managed History for this depot. Idempotent and safe when
    /// the root has never been watched.
    pub fn unwatch_depot(&self, dir: &Path) -> Result<(), String> {
        let root = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        {
            let mut roots = self.roots.lock().unwrap();
            if !roots.remove(&root) {
                return Ok(());
            }
        }
        self.watcher
            .lock()
            .unwrap()
            .unwatch(&root)
            .map_err(|e| format!("unwatch {}: {e}", root.display()))?;
        info!(root = %root.display(), "using writer-managed History");
        Ok(())
    }

    fn notes_from_event(&self, event: Event) -> Vec<FsNote> {
        if !is_interesting_kind(&event.kind) {
            return Vec::new();
        }
        let roots: Vec<PathBuf> = self.roots.lock().unwrap().iter().cloned().collect();
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for abs in event.paths {
            let Some((depot, rel)) = match_root(&roots, &abs) else {
                continue;
            };
            let path = rel.replace('\\', "/");
            if path.is_empty() || is_machinery_path(&path) {
                continue;
            }
            // One note per (depot, path) per event — notify often duplicates.
            if !seen.insert((depot.clone(), path.clone())) {
                continue;
            }
            out.push(FsNote { depot, path });
        }
        out
    }
}

/// Drop access/noise; keep create/remove/data/name changes (watchexec filter).
fn is_interesting_kind(kind: &EventKind) -> bool {
    match kind {
        EventKind::Create(_) | EventKind::Remove(_) => true,
        EventKind::Modify(ModifyKind::Data(_)) => true,
        EventKind::Modify(ModifyKind::Name(RenameMode::Both | RenameMode::To | RenameMode::From)) => {
            true
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::Any)) => true,
        // Metadata-only / Any / Other / Access — not author content.
        EventKind::Modify(ModifyKind::Metadata(_))
        | EventKind::Modify(ModifyKind::Any)
        | EventKind::Modify(ModifyKind::Other)
        | EventKind::Access(_)
        | EventKind::Other
        | EventKind::Any => false,
        _ => true,
    }
}

fn match_root(roots: &[PathBuf], abs: &Path) -> Option<(PathBuf, String)> {
    let abs = std::fs::canonicalize(abs).unwrap_or_else(|_| abs.to_path_buf());
    let mut best: Option<&PathBuf> = None;
    for root in roots {
        if abs.starts_with(root) {
            match best {
                None => best = Some(root),
                Some(cur) if root.components().count() > cur.components().count() => {
                    best = Some(root);
                }
                _ => {}
            }
        }
    }
    let root = best?;
    let rel = abs.strip_prefix(root).ok()?;
    Some((root.clone(), rel.to_string_lossy().into_owned()))
}
