use std::{
    collections::{hash_map::Entry, HashMap},
    env,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};

use serde_json::{json, Map, Value};

use crate::error::BackendErrorDto;

const EXPECTED_APP_VERSION: &str = env!("SURVEY_SYNTH_APPVERSION");
const EXPECTED_PROTOCOL_VERSION_TEXT: &str = env!("SURVEY_SYNTH_PROTOCOLVERSION");
const STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);

fn expected_protocol_version() -> u64 {
    EXPECTED_PROTOCOL_VERSION_TEXT
        .parse()
        .expect("shared protocolVersion must be an unsigned integer")
}

#[derive(Debug, Clone)]
pub struct SidecarCommand {
    pub program: String,
    pub args: Vec<String>,
    pub current_dir: Option<PathBuf>,
}

impl SidecarCommand {
    pub fn new(program: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            program: program.into(),
            args,
            current_dir: None,
        }
    }

    pub fn node(script: impl Into<PathBuf>) -> Self {
        Self::new("node", vec![script.into().to_string_lossy().into_owned()])
    }

    pub fn from_environment() -> Self {
        if let Ok(executable) = env::var("SURVEY_SYNTH_SIDECAR_EXECUTABLE") {
            return Self::new(executable, Vec::new());
        }

        let script = env::var_os("SURVEY_SYNTH_SIDECAR_SCRIPT")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("apps")
                    .join("sidecar")
                    .join("dist")
                    .join("main.js")
            });
        Self::node(script)
    }
}

struct SharedState {
    pending: Mutex<HashMap<String, mpsc::Sender<Result<Value, BackendErrorDto>>>>,
    status: Mutex<BridgeStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum BridgeStatus {
    Ready,
    Unavailable,
    ShuttingDown,
}

pub struct BackendBridge {
    shared: Arc<SharedState>,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Child>,
}

impl BackendBridge {
    pub fn spawn(command: SidecarCommand) -> Result<Self, String> {
        let mut process = Command::new(&command.program);
        process
            .args(&command.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(current_dir) = &command.current_dir {
            process.current_dir(current_dir);
        }

        let mut child = process
            .spawn()
            .map_err(|error| format!("Could not start sidecar: {error}"))?;
        let stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => return startup_failure(&mut child, "Sidecar stdin unavailable"),
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => return startup_failure(&mut child, "Sidecar stdout unavailable"),
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => return startup_failure(&mut child, "Sidecar stderr unavailable"),
        };

        let (ready_sender, ready_receiver) = mpsc::channel();
        if let Err(error) = thread::Builder::new()
            .name("survey-synth-sidecar-startup-reader".to_owned())
            .spawn(move || read_ready(stdout, ready_sender))
        {
            return startup_failure(
                &mut child,
                &format!("Could not start sidecar startup reader: {error}"),
            );
        }
        let (stdout_reader, ready) = match ready_receiver.recv_timeout(STARTUP_TIMEOUT) {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => return startup_failure(&mut child, &error),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return startup_failure(&mut child, "Sidecar ready handshake timed out")
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return startup_failure(&mut child, "Sidecar startup reader stopped")
            }
        };
        if let Err(error) = validate_ready(&ready) {
            return startup_failure(&mut child, &error);
        }

        let shared = Arc::new(SharedState {
            pending: Mutex::new(HashMap::new()),
            status: Mutex::new(BridgeStatus::Ready),
        });

        let reader_state = Arc::clone(&shared);
        if let Err(error) = thread::Builder::new()
            .name("survey-synth-sidecar-reader".to_owned())
            .spawn(move || read_responses(stdout_reader, reader_state))
        {
            return startup_failure(
                &mut child,
                &format!("Could not start sidecar reader: {error}"),
            );
        }

        if let Err(error) = thread::Builder::new()
            .name("survey-synth-sidecar-logger".to_owned())
            .spawn(move || read_stderr(stderr))
        {
            return startup_failure(
                &mut child,
                &format!("Could not start sidecar logger: {error}"),
            );
        }

        Ok(Self {
            shared,
            stdin: Mutex::new(Some(stdin)),
            child: Mutex::new(child),
        })
    }

    pub fn send(&self, request_text: &str) -> Result<Value, BackendErrorDto> {
        let request = parse_transport_request(request_text)?;
        let id = request
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| BackendErrorDto::validation("Request id is missing"))?
            .to_owned();
        let encoded = serde_json::to_string(&request)
            .map_err(|_| BackendErrorDto::validation("Request cannot be encoded"))?;

        let (sender, receiver) = mpsc::channel();
        {
            let status = self
                .shared
                .status
                .lock()
                .map_err(|_| BackendErrorDto::internal("Sidecar state lock failed"))?;
            if *status != BridgeStatus::Ready {
                return Err(BackendErrorDto::unavailable("Sidecar is unavailable"));
            }
            let mut pending = self
                .shared
                .pending
                .lock()
                .map_err(|_| BackendErrorDto::internal("Pending request lock failed"))?;
            if let Entry::Occupied(_) = pending.entry(id.clone()) {
                return Err(BackendErrorDto::validation("Duplicate request id"));
            }
            pending.insert(id.clone(), sender);
        }

        let write_result = (|| {
            let mut stdin = self
                .stdin
                .lock()
                .map_err(|_| BackendErrorDto::internal("Sidecar stdin lock failed"))?;
            let stream = stdin
                .as_mut()
                .ok_or_else(|| BackendErrorDto::unavailable("Sidecar stdin is closed"))?;
            stream
                .write_all(format!("{encoded}\n").as_bytes())
                .and_then(|_| stream.flush())
                .map_err(|_| BackendErrorDto::unavailable("Could not write to sidecar"))
        })();
        if let Err(error) = write_result {
            remove_pending(&self.shared, &id);
            mark_unavailable(&self.shared);
            return Err(error);
        }

        match receiver.recv_timeout(RESPONSE_TIMEOUT) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                remove_pending(&self.shared, &id);
                Err(BackendErrorDto::unavailable("Sidecar response timed out"))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(BackendErrorDto::unavailable(
                "Sidecar exited before responding",
            )),
        }
    }

    pub fn shutdown(&self) {
        let should_request = self
            .shared
            .status
            .lock()
            .map(|status| *status == BridgeStatus::Ready)
            .unwrap_or(false);

        if should_request {
            let request = json!({
                "v": expected_protocol_version(),
                "type": "request",
                "id": "host_shutdown",
                "method": "system.shutdown",
                "params": {}
            });
            let _ = self.send(&request.to_string());
        }

        if let Ok(mut status) = self.shared.status.lock() {
            *status = BridgeStatus::ShuttingDown;
        }
        if let Ok(mut child) = self.child.lock() {
            let mut exited = false;
            for _ in 0..20 {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        exited = true;
                        break;
                    }
                    Ok(None) => thread::sleep(Duration::from_millis(25)),
                    Err(_) => break,
                }
            }
            if !exited {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        mark_unavailable(&self.shared);
    }
}

impl Drop for BackendBridge {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn parse_transport_request(request_text: &str) -> Result<Map<String, Value>, BackendErrorDto> {
    let value: Value = serde_json::from_str(request_text)
        .map_err(|_| BackendErrorDto::validation("Request is not valid JSON"))?;
    let object = value
        .as_object()
        .ok_or_else(|| BackendErrorDto::validation("Request must be a JSON object"))?;
    if object.get("v").and_then(Value::as_u64) != Some(expected_protocol_version()) {
        return Err(BackendErrorDto::validation(
            "Protocol version is incompatible",
        ));
    }
    if object.get("type").and_then(Value::as_str) != Some("request") {
        return Err(BackendErrorDto::validation("Message is not a request"));
    }
    if object
        .get("id")
        .and_then(Value::as_str)
        .is_none_or(|id| id.is_empty() || id.contains('\n'))
    {
        return Err(BackendErrorDto::validation("Request id is invalid"));
    }
    if object
        .get("method")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        return Err(BackendErrorDto::validation("Request method is invalid"));
    }
    Ok(object.clone())
}

fn validate_ready(ready: &Value) -> Result<(), String> {
    let object = ready
        .as_object()
        .ok_or_else(|| "Sidecar ready handshake must be an object".to_owned())?;
    if object.get("type").and_then(Value::as_str) != Some("ready") {
        return Err("Sidecar ready handshake has wrong message type".to_owned());
    }
    if object.get("appVersion").and_then(Value::as_str) != Some(EXPECTED_APP_VERSION) {
        return Err("Sidecar app version is incompatible".to_owned());
    }
    if object.get("protocolVersion").and_then(Value::as_u64) != Some(expected_protocol_version()) {
        return Err("Sidecar protocol version is incompatible".to_owned());
    }
    for key in [
        "databaseSchemaVersion",
        "domainSchemaVersion",
        "engineVersion",
        "profilerVersion",
    ] {
        if object.get(key).and_then(Value::as_u64).is_none() {
            return Err(format!("Sidecar ready handshake is missing {key}"));
        }
    }
    Ok(())
}

fn read_ready(
    stdout: ChildStdout,
    sender: mpsc::Sender<Result<(BufReader<ChildStdout>, Value), String>>,
) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let result = match reader.read_line(&mut line) {
        Ok(0) => Err("Sidecar exited before ready handshake".to_owned()),
        Ok(_) => serde_json::from_str(line.trim())
            .map(|ready| (reader, ready))
            .map_err(|_| "Sidecar ready handshake is not valid JSON".to_owned()),
        Err(error) => Err(format!("Could not read sidecar ready handshake: {error}")),
    };
    let _ = sender.send(result);
}

fn read_responses(reader: BufReader<impl std::io::Read>, shared: Arc<SharedState>) {
    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let message: Value = match serde_json::from_str(&line) {
            Ok(message) => message,
            Err(_) => {
                mark_unavailable(&shared);
                return;
            }
        };
        if !is_response(&message) {
            mark_unavailable(&shared);
            return;
        }
        let id = match message.get("id").and_then(Value::as_str) {
            Some(id) => id.to_owned(),
            None => {
                mark_unavailable(&shared);
                return;
            }
        };
        let result = if message.get("ok").and_then(Value::as_bool) == Some(true) {
            match message.get("result").cloned() {
                Some(result) => Ok(result),
                None => {
                    mark_unavailable(&shared);
                    return;
                }
            }
        } else {
            let error = message
                .get("error")
                .cloned()
                .and_then(|value| serde_json::from_value::<BackendErrorDto>(value).ok())
                .unwrap_or_else(|| BackendErrorDto::internal("Sidecar returned an invalid error"));
            Err(error)
        };
        if let Ok(mut pending) = shared.pending.lock() {
            if let Some(sender) = pending.remove(&id) {
                let _ = sender.send(result);
            }
        } else {
            mark_unavailable(&shared);
            return;
        }
    }
    mark_unavailable(&shared);
}

fn is_response(message: &Value) -> bool {
    message.get("v").and_then(Value::as_u64) == Some(expected_protocol_version())
        && message.get("type").and_then(Value::as_str) == Some("response")
        && message.get("id").and_then(Value::as_str).is_some()
        && message.get("ok").and_then(Value::as_bool).is_some()
}

fn read_stderr(stderr: impl std::io::Read) {
    for line in BufReader::new(stderr).lines() {
        if line.is_ok() {
            eprintln!("sidecar emitted a log record");
        } else {
            break;
        }
    }
}

fn remove_pending(shared: &Arc<SharedState>, id: &str) {
    if let Ok(mut pending) = shared.pending.lock() {
        pending.remove(id);
    }
}

fn mark_unavailable(shared: &Arc<SharedState>) {
    if let Ok(mut status) = shared.status.lock() {
        if *status != BridgeStatus::ShuttingDown {
            *status = BridgeStatus::Unavailable;
        }
    }
    if let Ok(mut pending) = shared.pending.lock() {
        let error = BackendErrorDto::unavailable("Sidecar exited unexpectedly");
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(error.clone()));
        }
    }
}

fn startup_failure<T>(child: &mut Child, message: &str) -> Result<T, String> {
    let _ = child.kill();
    let _ = child.wait();
    Err(message.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        expected_protocol_version, parse_transport_request, validate_ready, EXPECTED_APP_VERSION,
    };
    use serde_json::json;

    #[test]
    fn validates_transport_request_without_business_fields() {
        let request = json!({
            "v": expected_protocol_version(),
            "type": "request",
            "id": "r_1",
            "method": "system.ping",
            "params": {}
        });
        assert!(parse_transport_request(&request.to_string()).is_ok());
        assert!(parse_transport_request(&json!({ "v": 99 }).to_string()).is_err());
    }

    #[test]
    fn requires_exact_ready_versions_and_fields() {
        let ready = json!({
            "type": "ready",
            "appVersion": EXPECTED_APP_VERSION,
            "protocolVersion": expected_protocol_version(),
            "databaseSchemaVersion": 0,
            "domainSchemaVersion": 0,
            "engineVersion": 0,
            "profilerVersion": 0
        });
        assert!(validate_ready(&ready).is_ok());
        assert!(validate_ready(&json!({ "type": "ready" })).is_err());
        assert!(validate_ready(&json!({
            "type": "ready",
            "appVersion": "9.9.9",
            "protocolVersion": expected_protocol_version(),
            "databaseSchemaVersion": 0,
            "domainSchemaVersion": 0,
            "engineVersion": 0,
            "profilerVersion": 0
        }))
        .is_err());
    }
}
