// The macOS Keychain, as host/Secrets.cs is Windows Credential Manager. The Canvas token and
// calendar feed links are bearer secrets: they live only here and in the request that uses them,
// never in data.json and never in the page.
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use keyring::{Entry, Error};

// Its own service name, so a trial run on Windows never touches the WebView2 build's credentials.
const SERVICE: &str = "app.stilltoday.widget";
pub const CANVAS: &str = "Canvas";

pub fn feed(id: &str) -> String {
    format!("Feed/{id}")
}

// What this run has read or written. An app the Keychain does not yet trust asks for the password
// on every read, and a launch reads the token several times: kept here, it asks once.
static KNOWN: LazyLock<Mutex<HashMap<String, Option<String>>>> = LazyLock::new(Default::default);

pub fn read(account: &str) -> Result<Option<String>, String> {
    if let Some(known) = KNOWN.lock().unwrap().get(account) {
        return Ok(known.clone());
    }
    let secret = match Entry::new(SERVICE, account).and_then(|e| e.get_password()) {
        Ok(secret) => Some(secret),
        Err(Error::NoEntry) => None,
        Err(_) => return Err("secret".into()),
    };
    KNOWN.lock().unwrap().insert(account.into(), secret.clone());
    Ok(secret)
}

pub fn write(account: &str, secret: &str) -> Result<(), String> {
    Entry::new(SERVICE, account).and_then(|e| e.set_password(secret)).map_err(|_| "secret")?;
    KNOWN.lock().unwrap().insert(account.into(), Some(secret.into()));
    Ok(())
}

pub fn delete(account: &str) {
    KNOWN.lock().unwrap().remove(account);
    if let Ok(entry) = Entry::new(SERVICE, account) {
        let _ = entry.delete_credential();
    }
}

/// The Canvas host and token, stored together as one item.
pub fn canvas() -> Result<Option<(String, String)>, String> {
    let Some(raw) = read(CANVAS)? else { return Ok(None) };
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|_| "secret")?;
    match (value["host"].as_str(), value["token"].as_str()) {
        (Some(host), Some(token)) => Ok(Some((host.into(), token.into()))),
        _ => Ok(None),
    }
}

pub fn set_canvas(host: &str, token: &str) -> Result<(), String> {
    write(CANVAS, &serde_json::json!({ "host": host, "token": token }).to_string())
}
