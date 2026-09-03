use std::{path::PathBuf, thread, time::Duration};

use serde_json::{json, Value};
use survey_synth_host::bridge::{BackendBridge, SidecarCommand};

const EXPECTED_APP_VERSION: &str = env!("SURVEY_SYNTH_APPVERSION");

fn expected_protocol_version() -> u64 {
    env!("SURVEY_SYNTH_PROTOCOLVERSION")
        .parse()
        .expect("shared protocolVersion must be an unsigned integer")
}

fn sidecar_script() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("apps")
        .join("sidecar")
        .join("dist")
        .join("main.js")
}

fn staged_sidecar_resources() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("sidecar")
}

#[test]
fn reports_spawn_and_handshake_failures_without_panicking() {
    assert!(BackendBridge::spawn(SidecarCommand::new(
        "survey-synth-sidecar-does-not-exist",
        Vec::new(),
    ))
    .is_err());

    let malformed = BackendBridge::spawn(SidecarCommand::new(
        "node",
        vec![
            "-e".to_owned(),
            r#"process.stdout.write("not-json\n")"#.to_owned(),
        ],
    ));
    assert!(malformed.is_err());

    let incompatible = BackendBridge::spawn(SidecarCommand::new(
        "node",
        vec![
            "-e".to_owned(),
            format!(
                r#"process.stdout.write(JSON.stringify({{"type":"ready","appVersion":"9.9.9","protocolVersion":{},"databaseSchemaVersion":0,"domainSchemaVersion":0,"engineVersion":0,"profilerVersion":0}})+"\n")"#,
                expected_protocol_version()
            ),
        ],
    ));
    assert!(incompatible.is_err());
}

#[test]
fn launches_actual_sidecar_and_round_trips_system_ping() {
    let script = sidecar_script();
    assert!(
        script.is_file(),
        "build sidecar before Rust integration tests: {}",
        script.display()
    );
    let bridge = BackendBridge::spawn(SidecarCommand::node(script)).expect("sidecar starts");
    let request = json!({
        "v": expected_protocol_version(),
        "type": "request",
        "id": "rust_ping",
        "method": "system.ping",
        "params": {}
    });

    let result = bridge.send(&request.to_string()).expect("ping response");
    assert_eq!(result, json!({ "ok": true, "message": "pong" }));
    bridge.checkpoint().expect("database checkpoint response");

    let session_request = json!({
        "v": expected_protocol_version(),
        "type": "request",
        "id": "rust_session",
        "method": "session.get",
        "params": {}
    });
    assert_eq!(
        bridge
            .send(&session_request.to_string())
            .expect("session response"),
        Value::Null
    );
    bridge.shutdown();
}

#[test]
#[ignore = "requires generated sidecar staging"]
fn launches_staged_self_contained_sidecar_without_system_node() {
    let resources = staged_sidecar_resources();
    assert!(
        resources.is_dir(),
        "stage sidecar resources before this test: {}",
        resources.display()
    );
    let bridge = BackendBridge::spawn(
        SidecarCommand::bundled(resources).expect("staged sidecar layout is complete"),
    )
    .expect("staged sidecar starts");
    let request = json!({
        "v": expected_protocol_version(),
        "type": "request",
        "id": "staged_ping",
        "method": "system.ping",
        "params": {}
    });
    assert_eq!(
        bridge
            .send(&request.to_string())
            .expect("staged ping response"),
        json!({ "ok": true, "message": "pong" })
    );
    bridge
        .checkpoint()
        .expect("staged database checkpoint response");
    bridge.shutdown();
}

#[test]
fn unexpected_sidecar_exit_rejects_without_waiting_forever() {
    let ready = format!(
        r#"process.stdout.write(JSON.stringify({{"type":"ready","appVersion":"{}","protocolVersion":{},"databaseSchemaVersion":0,"domainSchemaVersion":0,"engineVersion":0,"profilerVersion":0}})+"\n");setTimeout(()=>process.exit(1),50);"#,
        EXPECTED_APP_VERSION,
        expected_protocol_version()
    );
    let bridge = BackendBridge::spawn(SidecarCommand::new(
        "node",
        vec!["-e".to_owned(), ready.to_owned()],
    ))
    .expect("crash fixture starts");
    thread::sleep(Duration::from_millis(150));
    let request = json!({
        "v": expected_protocol_version(),
        "type": "request",
        "id": "rust_after_exit",
        "method": "system.ping",
        "params": {}
    });

    let result = bridge
        .send(&request.to_string())
        .expect_err("sidecar exit must reject");
    assert_eq!(result.code, "BACKEND_UNAVAILABLE");
    bridge.shutdown();
}
