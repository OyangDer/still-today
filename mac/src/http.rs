// Bounded GETs on behalf of the page, as host/Http.cs. The page cannot reach Canvas or a feed
// directly (CORS, and it must never hold the secrets), so it asks the host, which attaches the
// credential itself.
use std::sync::LazyLock;
use std::time::Duration;

use base64::Engine;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, LINK};
use reqwest::redirect::Policy;
use reqwest::{Client, RequestBuilder, Response};
use serde_json::{json, Value};
use url::Url;

const LIMIT: usize = 8 * 1024 * 1024;
#[cfg(target_os = "macos")]
const AGENT: &str = "StillToday/0.2 (macOS; +calendar)";
#[cfg(not(target_os = "macos"))]
const AGENT: &str = "StillToday/0.2 (Windows; +calendar)";

// Canvas never redirects its API; refusing redirects keeps the bearer token on its own host.
static API: LazyLock<Client> = LazyLock::new(|| client(Policy::none()));
// Requests without a credential (feeds, the profile picture) may follow redirects.
static PLAIN: LazyLock<Client> = LazyLock::new(|| client(Policy::limited(10)));

fn client(redirect: Policy) -> Client {
    Client::builder()
        .redirect(redirect)
        .timeout(Duration::from_secs(20))
        .user_agent(AGENT)
        .build()
        .expect("HTTP client")
}

pub struct Reply {
    pub status: i32,
    pub body: Option<String>,
    pub next: Option<String>,
}

impl Reply {
    pub fn code(status: i32) -> Self {
        Reply { status, body: None, next: None }
    }

    pub fn json(&self) -> Value {
        json!({ "status": self.status, "body": self.body, "next": self.next })
    }
}

pub async fn canvas_get(url: Url, token: &str) -> Reply {
    let request = API.get(url.clone()).header(AUTHORIZATION, format!("Bearer {token}")).header(ACCEPT, "application/json");
    send(request, &url).await
}

// Instructure's public directory of Canvas schools, the one its own apps search at sign-in.
pub async fn school_search(name: &str) -> Reply {
    let url = Url::parse_with_params(
        "https://canvas.instructure.com/api/v1/accounts/search",
        &[("per_page", "50"), ("name", name)],
    )
    .expect("school search URL");
    send(API.get(url.clone()).header(ACCEPT, "application/json"), &url).await
}

pub async fn feed_get(url: Url) -> Reply {
    let request = PLAIN.get(url.clone()).header(ACCEPT, "text/calendar, text/plain;q=0.8, */*;q=0.5");
    send_as(request, &url, unfold).await
}

// A calendar's folded lines joined again before the text is read as UTF-8: a fold may fall inside a
// character (some feeds count 75 bytes, not characters), and decoded first, a Chinese title split there
// came out as replacement marks. The page unfolds what is left, which is nothing.
fn unfold(bytes: &[u8]) -> String {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let fold = match bytes[i] {
            b'\r' if bytes.get(i + 1) == Some(&b'\n') && matches!(bytes.get(i + 2), Some(b' ' | b'\t')) => 3,
            b'\n' if matches!(bytes.get(i + 1), Some(b' ' | b'\t')) => 2,
            _ => 0,
        };
        if fold > 0 {
            i += fold;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// An image as a data: URL, the only kind the page's CSP lets it show; None when none arrives.
pub async fn image_get(url: Url) -> Option<String> {
    let response = PLAIN.get(url).send().await.ok()?;
    let kind = response.headers().get(CONTENT_TYPE)?.to_str().ok()?;
    let kind = kind.split(';').next()?.trim().to_ascii_lowercase();
    if !response.status().is_success() || !kind.starts_with("image/") {
        return None;
    }
    let bytes = read_bounded(response).await.ok()??;
    Some(format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

async fn send(request: RequestBuilder, origin: &Url) -> Reply {
    send_as(request, origin, |bytes| String::from_utf8_lossy(bytes).into_owned()).await
}

async fn send_as(request: RequestBuilder, origin: &Url, text: fn(&[u8]) -> String) -> Reply {
    // Error text can echo the request URL, which may carry a secret; report only a code.
    let Ok(response) = request.send().await else { return Reply::code(-1) };
    let status = response.status().as_u16() as i32;
    if !response.status().is_success() {
        return Reply::code(status);
    }
    let next = next_page(&response, origin);
    match read_bounded(response).await {
        Ok(Some(bytes)) => Reply { status, body: Some(text(&bytes)), next },
        Ok(None) => Reply::code(-2),
        Err(_) => Reply::code(-1),
    }
}

// The body, or None past the size limit.
async fn read_bounded(mut response: Response) -> reqwest::Result<Option<Vec<u8>>> {
    let mut buffer = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if buffer.len() + chunk.len() > LIMIT {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk);
    }
    Ok(Some(buffer))
}

// Canvas paginates with Link headers. Only a same-host https "next" link is followed.
fn next_page(response: &Response, origin: &Url) -> Option<String> {
    for value in response.headers().get_all(LINK) {
        for part in value.to_str().ok()?.split(',') {
            if !part.to_ascii_lowercase().contains("rel=\"next\"") {
                continue;
            }
            let start = part.find('<')?;
            let end = part.find('>')?;
            if end <= start + 1 {
                return None;
            }
            let next = origin.join(&part[start + 1..end]).ok()?;
            let same = next.host_str().zip(origin.host_str()).is_some_and(|(a, b)| a.eq_ignore_ascii_case(b));
            if next.scheme() != "https" || !same {
                return None;
            }
            return Some(match next.query() {
                Some(query) => format!("{}?{query}", next.path()),
                None => next.path().to_string(),
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unfolds_inside_a_character() {
        // 第三周, folded after the first byte of 周, as a 75-byte fold can fall.
        let mut feed = b"SUMMARY:\xe7\xac\xac\xe4\xb8\x89\xe5\r\n \x91\xa8\r\nEND:VEVENT".to_vec();
        assert_eq!(unfold(&feed), "SUMMARY:第三周\r\nEND:VEVENT");
        // Bare line feeds, and a tab as the fold's space.
        feed = b"A\n\tB\nC".to_vec();
        assert_eq!(unfold(&feed), "AB\nC");
    }
}
