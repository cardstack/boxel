//! HTTP surface — Deck History routes.

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tower_http::trace::TraceLayer;

use crate::history::{Actor, HistoryBackend, HistoryBackendError, HistoryEntry, RestorePlan};
use crate::watch::WatchPlane;

#[derive(Clone)]
pub struct AppState {
    pub history: Arc<dyn HistoryBackend>,
    /// Watchexec-shaped FS seals; `None` only if notify failed to start.
    pub watch: Option<Arc<WatchPlane>>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ensure", post(ensure))
        .route("/note", post(note))
        .route("/flush", post(flush))
        .route("/seal", post(seal))
        .route("/list", post(list))
        .route("/file-at", post(file_at))
        .route("/file-list-at", post(file_list_at))
        .route("/restore-plan", post(restore_plan))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[derive(Debug, Deserialize)]
struct EnsureBody {
    dir: String,
    watch: bool,
}

#[derive(Debug, Deserialize)]
struct DirBody {
    dir: String,
}

#[derive(Debug, Deserialize)]
struct NoteBody {
    dir: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct SealBody {
    dir: String,
    message: String,
    #[serde(default)]
    actor: Option<Actor>,
}

#[derive(Debug, Serialize)]
struct SealResponse {
    #[serde(rename = "changeId")]
    change_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileAtBody {
    dir: String,
    #[serde(rename = "revisionId")]
    revision_id: String,
    path: String,
}

#[derive(Debug, Serialize)]
struct FileAtResponse {
    found: bool,
    #[serde(rename = "contentBase64", skip_serializing_if = "Option::is_none")]
    content_base64: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileListAtBody {
    dir: String,
    #[serde(rename = "revisionId")]
    revision_id: String,
}

#[derive(Debug, Serialize)]
struct FileListAtResponse {
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RestorePlanBody {
    dir: String,
    #[serde(rename = "revisionId")]
    revision_id: String,
}

async fn ensure(
    State(st): State<AppState>,
    Json(body): Json<EnsureBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    st.history.ensure(&body.dir).await?;
    if let Some(watch) = &st.watch {
        let result = if body.watch {
            watch.watch_depot(std::path::Path::new(&body.dir))
        } else {
            watch.unwatch_depot(std::path::Path::new(&body.dir))
        };
        if let Err(error) = result {
            tracing::warn!(dir = %body.dir, %error, "watch register failed");
        }
    }
    Ok(Json(serde_json::json!({})))
}

async fn note(
    State(st): State<AppState>,
    Json(body): Json<NoteBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    st.history.note(&body.dir, &body.path).await?;
    Ok(Json(serde_json::json!({})))
}

async fn flush(
    State(st): State<AppState>,
    Json(body): Json<DirBody>,
) -> Result<Json<SealResponse>, ApiError> {
    let change_id = st.history.flush_notes(&body.dir).await?;
    Ok(Json(SealResponse { change_id }))
}

async fn seal(
    State(st): State<AppState>,
    Json(body): Json<SealBody>,
) -> Result<Json<SealResponse>, ApiError> {
    let change_id = st
        .history
        .seal(&body.dir, &body.message, body.actor.as_ref())
        .await?;
    Ok(Json(SealResponse { change_id }))
}

async fn list(
    State(st): State<AppState>,
    Json(body): Json<DirBody>,
) -> Result<Json<Vec<HistoryEntry>>, ApiError> {
    Ok(Json(st.history.list(&body.dir).await?))
}

async fn file_at(
    State(st): State<AppState>,
    Json(body): Json<FileAtBody>,
) -> Result<Json<FileAtResponse>, ApiError> {
    let bytes = st
        .history
        .file_at(&body.dir, &body.revision_id, &body.path)
        .await?;
    Ok(Json(match bytes {
        Some(b) => FileAtResponse {
            found: true,
            content_base64: Some(base64::engine::general_purpose::STANDARD.encode(b)),
        },
        None => FileAtResponse {
            found: false,
            content_base64: None,
        },
    }))
}

async fn file_list_at(
    State(st): State<AppState>,
    Json(body): Json<FileListAtBody>,
) -> Result<Json<FileListAtResponse>, ApiError> {
    Ok(Json(FileListAtResponse {
        paths: st
            .history
            .file_list_at(&body.dir, &body.revision_id)
            .await?,
    }))
}

async fn restore_plan(
    State(st): State<AppState>,
    Json(body): Json<RestorePlanBody>,
) -> Result<Json<RestorePlan>, ApiError> {
    Ok(Json(
        st.history
            .restore_plan(&body.dir, &body.revision_id)
            .await?,
    ))
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl From<HistoryBackendError> for ApiError {
    fn from(err: HistoryBackendError) -> Self {
        let status = match &err {
            HistoryBackendError::NotFound(_) => StatusCode::NOT_FOUND,
            HistoryBackendError::Invalid(_) => StatusCode::BAD_REQUEST,
            HistoryBackendError::Io(_) | HistoryBackendError::Jj(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        Self {
            status,
            message: err.to_string(),
        }
    }
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message,
        }
    }
}

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = Json(serde_json::json!({ "error": self.message }));
        (self.status, body).into_response()
    }
}
