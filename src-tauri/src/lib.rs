pub mod bridge;
pub mod error;

use std::sync::Arc;

use bridge::BackendBridge;
use error::BackendErrorDto;
use serde_json::Value;
use tauri::Manager;

struct AppState {
    bridge: Arc<BackendBridge>,
}

#[tauri::command]
async fn backend_call(
    request: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, BackendErrorDto> {
    let bridge = Arc::clone(&state.bridge);
    tauri::async_runtime::spawn_blocking(move || bridge.send(&request))
        .await
        .map_err(|_| BackendErrorDto::internal("Backend bridge task failed"))?
}

pub fn run() {
    let app = match tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(std::io::Error::other)?;
            let bridge = BackendBridge::spawn(bridge::SidecarCommand::from_environment().with_env(
                "SURVEY_SYNTH_APP_DATA_DIR",
                app_data_dir.to_string_lossy().into_owned(),
            ))
            .map_err(std::io::Error::other)?;
            app.manage(AppState {
                bridge: Arc::new(bridge),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_call])
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(error) => {
            eprintln!("Survey Synth startup failed: {error}");
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.bridge.shutdown();
            }
        }
    });
}
