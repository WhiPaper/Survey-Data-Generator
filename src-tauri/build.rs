use std::{env, fs, path::PathBuf};

fn main() {
    tauri_build::build();

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let versions_path = manifest_dir.join("..").join("versions.json");
    println!("cargo:rerun-if-changed={}", versions_path.display());

    let versions: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&versions_path).expect("read shared versions.json"),
    )
    .expect("parse shared versions.json");

    let app_version = versions["appVersion"].as_str().expect("appVersion string");
    if app_version != env!("CARGO_PKG_VERSION") {
        panic!("Cargo package version must match versions.json appVersion");
    }

    for key in [
        "appVersion",
        "protocolVersion",
        "databaseSchemaVersion",
        "domainSchemaVersion",
        "engineVersion",
        "profilerVersion",
    ] {
        let value = &versions[key];
        let encoded = if let Some(string) = value.as_str() {
            string.to_owned()
        } else if let Some(number) = value.as_u64() {
            number.to_string()
        } else {
            panic!("version field must be a string or unsigned integer: {key}");
        };
        println!(
            "cargo:rustc-env=SURVEY_SYNTH_{}={encoded}",
            key.to_ascii_uppercase()
        );
    }
}
