//! deckd — every-save History daemon for Deck.
//!
//! Speaks the Deck History HTTP contract used by `@cardstack/deck-history`.
//! Realm Server seals explicitly over HTTP. A watched directory instead
//! captures through notify → filter → per-directory debounce → jj-lib seal.
//!
//! The binary contains only History and its explicit/watch capture modes.

mod api;
mod history;
mod watch;

use std::net::SocketAddr;
use std::sync::Arc;

use tracing_subscriber::EnvFilter;

use crate::api::AppState;
use crate::history::jj_lib::JjLibHistory;
use crate::history::HistoryBackend;
use crate::watch::WatchPlane;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("deckd=info".parse()?))
        .init();

    let bind = std::env::var("DECKD_BIND").unwrap_or_else(|_| "127.0.0.1:8787".into());

    let jj_history = JjLibHistory::new();
    let history_service = jj_history.history();
    let watch = match WatchPlane::start(history_service) {
        Ok(w) => Some(w),
        Err(error) => {
            tracing::warn!(%error, "FS watch plane disabled; HTTP /note still works");
            None
        }
    };

    let history: Arc<dyn HistoryBackend> = Arc::new(jj_history);
    let state = AppState { history, watch };

    let app = api::router(state);
    let addr: SocketAddr = bind.parse()?;
    tracing::info!(
        %addr,
        "deckd listening (jj-lib History + watchexec-shaped FS captures)"
    );
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
