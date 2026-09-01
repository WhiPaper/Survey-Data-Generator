use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendErrorDto {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    pub recoverable: bool,
}

impl BackendErrorDto {
    pub fn new(code: &str, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
            details: None,
            recoverable,
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new("BACKEND_UNAVAILABLE", message, true)
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new("VALIDATION_FAILED", message, true)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("INTERNAL", message, true)
    }
}
