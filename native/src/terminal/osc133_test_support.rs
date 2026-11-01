//! OSC 133 marker helpers shared by the real-shell lifecycle tests.
//!
//! A marker is trusted only when its `aid` equals the session nonce, the same rule as the
//! frontend `parseOsc133Payload`.

/// Every complete OSC 133 payload, split on `;`.
pub(super) fn markers(text: &str) -> Vec<Vec<String>> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("\u{1b}]133;") {
        rest = &rest[start + 6..];
        let Some(end) = rest.find('\u{7}') else { break };
        found.push(rest[..end].split(';').map(str::to_string).collect());
        rest = &rest[end + 1..];
    }
    found
}

pub(super) fn field<'a>(fields: &'a [String], key: &str) -> Option<&'a str> {
    fields.iter().find_map(|f| f.strip_prefix(key))
}

pub(super) fn aid(fields: &[String]) -> Option<&str> {
    field(fields, "aid=")
}

pub(super) fn render(fields: &[String]) -> String {
    match fields[0].as_str() {
        "C" => format!(
            "C {}|{}",
            field(fields, "cmd=").map(b64).unwrap_or_else(|| "?".into()),
            field(fields, "cwd=").map(b64).unwrap_or_default()
        ),
        // A status-less end (`D;aid=...`) means the shell reported no status.
        "D" if fields[1].starts_with("aid=") => "D ?".to_string(),
        "D" => format!("D {}", fields[1]),
        "P" => format!(
            "P {}={}",
            field(fields, "k=").unwrap_or(""),
            field(fields, "v=").unwrap_or("")
        ),
        code => code.to_string(),
    }
}

pub(super) fn b64(encoded: &str) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let (mut bits, mut acc, mut out) = (0, 0u32, Vec::new());
    for byte in encoded.bytes().filter(|b| *b != b'=') {
        acc = (acc << 6) | ALPHABET.iter().position(|c| *c == byte).unwrap() as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    String::from_utf8(out).unwrap()
}
