//! The urls behind image-backed text (#560), the part of the sampled
//! path every build compiles: how a `url()` names its file and how a
//! finding names the image. The decoders live in `image_sampling` behind
//! the `image-sampling` feature.

use crate::background::ImageLayer;
use crate::dom::StaticDocument;
use ego_tree::NodeId;
use impeccable_common::jsp;
use std::borrow::Cow;

/// A file url's path with its `%XX` escapes decoded, the way the browser
/// requests `url(light%20%28copy%29.png)`; the query and fragment are cut
/// first, so an escaped `#` or `?` stays part of the name. An escape that
/// is not two hex digits is left as written.
pub(crate) fn percent_decoded_path(url: &str) -> Cow<'_, str> {
    let path = url.split(['?', '#']).next().unwrap_or("");
    if !path.contains('%') {
        return Cow::Borrowed(path);
    }
    let bytes = path.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%'
            && i + 2 < bytes.len()
            && bytes[i + 1].is_ascii_hexdigit()
            && bytes[i + 2].is_ascii_hexdigit())
        .then(|| u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?, 16).ok())
        .flatten();
        match hex {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    Cow::Owned(String::from_utf8_lossy(&out).into_owned())
}

/// The url of an element's image layer, borrowed from its computed style.
pub fn layer_url<'d>(doc: &'d StaticDocument, node: NodeId, layer: &ImageLayer) -> Cow<'d, str> {
    let bg_image = doc
        .get_style(node)
        .get("backgroundImage")
        .map(|s| s.as_str())
        .unwrap_or("");
    layer.call.value(bg_image)
}

pub(crate) fn is_data_uri(url: &str) -> bool {
    // `get`, not a byte slice: a url may open with a multibyte character.
    url.get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("data:"))
}

/// The name a finding gives the image: the file name, or `data:<mime>`.
pub fn ground_label(url: &str) -> String {
    let url = url.trim();
    if is_data_uri(url) {
        let header = url[5..].split(',').next().unwrap_or("");
        let mime = header
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        return if mime.is_empty() {
            "data:image".into()
        } else {
            format!("data:{mime}")
        };
    }
    jsp::basename(&percent_decoded_path(url))
}

