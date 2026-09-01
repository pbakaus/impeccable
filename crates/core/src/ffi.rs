//! The open half of the C-ABI: the `extern "C"` declarations, the one-time
//! ABI check, and the host vtable the closed side calls back through.
//!
//! Every shim in this crate funnels through [`call`] / [`call_dom`] /
//! [`call_style`]: encode the arguments with postcard, hand them to
//! `det_call`, decode the result. The contract, the ids and the encoding all
//! live in [`impeccable_foundation::boundary`].

use core::ffi::c_void;
use impeccable_foundation::boundary::{
    self, decode, encode, host_method as hm, status, Buf, HostVTable,
};
use impeccable_foundation::browser::dom::{Dom, ElId, KeyframeFrame, Rect, SelectorError};
use impeccable_foundation::css::measures::{CustomProps, StyleMap};
use serde::de::DeserializeOwned;
use serde::Serialize;

extern "C" {
    fn det_abi_version() -> u32;
    fn det_call(
        id: u32,
        args: *const u8,
        args_len: usize,
        host: *const HostVTable,
        ctx: *const c_void,
        out: *mut Buf,
    ) -> i32;
    fn det_free(buf: Buf);
}

/// Checked once, before the first call: a prebuilt detector from another ABI
/// generation would decode this crate's argument bytes as something else.
fn ensure_abi() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let theirs = unsafe { det_abi_version() };
        assert_eq!(
            theirs,
            boundary::ABI,
            "impeccable: the linked detector speaks boundary ABI {theirs}, this runtime speaks \
             ABI {}. Rebuild or refetch the detector archive for this release \
             (docs/ENGINE.md).",
            boundary::ABI
        );
    });
}

/// What the closed side reaches back into for the duration of one call. Kept
/// on the caller's stack; `ctx` points at it.
pub(crate) struct HostCtx<'a> {
    pub dom: Option<&'a dyn Dom>,
    pub style: Option<&'a dyn StyleMap>,
    pub custom: Option<&'a dyn CustomProps>,
}

impl HostCtx<'_> {
    const NONE: HostCtx<'static> = HostCtx {
        dom: None,
        style: None,
        custom: None,
    };
}

static HOST_VTABLE: HostVTable = HostVTable {
    call: host_call,
    free: host_free,
};

/// Encode `args`, run closed function `id`, decode the result.
pub(crate) fn invoke<A: Serialize + ?Sized, R: DeserializeOwned>(
    id: u32,
    args: &A,
    ctx: &HostCtx<'_>,
) -> R {
    ensure_abi();
    let bytes = encode(args);
    let mut out = Buf::EMPTY;
    let st = unsafe {
        det_call(
            id,
            bytes.as_ptr(),
            bytes.len(),
            &HOST_VTABLE as *const HostVTable,
            ctx as *const HostCtx<'_> as *const c_void,
            &mut out,
        )
    };
    let data = if out.ptr.is_null() {
        Vec::new()
    } else {
        unsafe { core::slice::from_raw_parts(out.ptr, out.len) }.to_vec()
    };
    unsafe { det_free(out) };
    if st != status::OK {
        let what = fn_name(id);
        let message = String::from_utf8_lossy(&data);
        match st {
            status::PANIC => panic!("impeccable detector panicked in {what}: {message}"),
            status::DECODE => panic!("impeccable detector could not decode {what}: {message}"),
            status::UNKNOWN => panic!("impeccable detector has no {what}: {message}"),
            other => panic!("impeccable detector returned status {other} for {what}: {message}"),
        }
    }
    decode(&data).unwrap_or_else(|e| {
        panic!("impeccable: result of {} does not decode: {e}", fn_name(id))
    })
}

fn fn_name(id: u32) -> String {
    boundary::fn_id::TABLE_ENTRIES
        .iter()
        .find(|(i, _)| *i == id)
        .map(|(_, n)| (*n).to_string())
        .unwrap_or_else(|| format!("fn {id:#06x}"))
}

/// A closed function that takes no host callback.
pub(crate) fn call<A: Serialize + ?Sized, R: DeserializeOwned>(id: u32, args: &A) -> R {
    invoke(id, args, &HostCtx::NONE)
}

/// A closed function that takes `&dyn Dom`.
pub(crate) fn call_dom<A: Serialize + ?Sized, R: DeserializeOwned>(
    id: u32,
    dom: &dyn Dom,
    args: &A,
) -> R {
    let ctx = HostCtx {
        dom: Some(dom),
        style: None,
        custom: None,
    };
    invoke(id, args, &ctx)
}

/// A closed function that takes `&dyn StyleMap` (or `Option<&dyn StyleMap>`,
/// with the `present` flag in `args`).
pub(crate) fn call_style<A: Serialize + ?Sized, R: DeserializeOwned>(
    id: u32,
    style: Option<&dyn StyleMap>,
    args: &A,
) -> R {
    let ctx = HostCtx {
        dom: None,
        style,
        custom: None,
    };
    invoke(id, args, &ctx)
}

// ── the host side of the vtable ───────────────────────────────────────────

unsafe extern "C" fn host_free(buf: Buf) {
    drop(buf.into_vec());
}

unsafe extern "C" fn host_call(
    ctx: *const c_void,
    method: u32,
    args: *const u8,
    args_len: usize,
    out: *mut Buf,
) -> i32 {
    let args: &[u8] = if args.is_null() || args_len == 0 {
        &[]
    } else {
        core::slice::from_raw_parts(args, args_len)
    };
    let host = &*(ctx as *const HostCtx<'_>);
    // Same reason as `det_call`'s: `extern "C"` aborts on unwind.
    let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        host_dispatch(host, method, args)
    }));
    match caught {
        Ok(Ok(bytes)) => {
            if !out.is_null() {
                *out = Buf::from_vec(bytes);
            }
            status::OK
        }
        Ok(Err((code, message))) => {
            if !out.is_null() {
                *out = Buf::from_vec(message.into_bytes());
            }
            code
        }
        Err(_) => {
            if !out.is_null() {
                *out = Buf::from_vec(
                    format!("impeccable host method {method} panicked").into_bytes(),
                );
            }
            status::PANIC
        }
    }
}

/// `SelectorError` carries nothing, so it crosses as `Result<_, ()>`.
fn sel<T: Serialize>(r: Result<T, SelectorError>) -> Vec<u8> {
    encode(&r.map_err(|_| ()))
}

fn host_dispatch(host: &HostCtx<'_>, method: u32, args: &[u8]) -> Result<Vec<u8>, (i32, String)> {
    macro_rules! a {
        ($t:ty) => {
            match decode::<$t>(args) {
                Ok(v) => v,
                Err(e) => {
                    return Err((
                        status::DECODE,
                        format!("impeccable host method {method} arguments do not decode: {e}"),
                    ))
                }
            }
        };
    }

    if method == hm::STYLE_MAP_PROP {
        let Some(style) = host.style else {
            return Err((
                status::UNKNOWN,
                "impeccable: this call has no style map".to_string(),
            ));
        };
        return Ok(encode(&style.prop(a!(&str))));
    }
    if method == hm::CUSTOM_PROPS_GET {
        let Some(custom) = host.custom else {
            return Err((
                status::UNKNOWN,
                "impeccable: this call has no custom-property map".to_string(),
            ));
        };
        return Ok(encode(&custom.get(a!(&str))));
    }

    let Some(dom) = host.dom else {
        return Err((
            status::UNKNOWN,
            format!("impeccable: host method {method} needs a DOM and this call has none"),
        ));
    };

    let out = match method {
        hm::DOM_DOCUMENT_ELEMENT => encode(&dom.document_element()),
        hm::DOM_BODY => encode(&dom.body()),
        hm::DOM_QUERY_ALL => {
            let (root, selector) = a!((Option<ElId>, &str));
            sel(dom.query_all(root, selector))
        }
        hm::DOM_QUERY_ONE => {
            let (root, selector) = a!((Option<ElId>, &str));
            sel(dom.query_one(root, selector))
        }
        hm::DOM_INNER_WIDTH => encode(&dom.inner_width()),
        hm::DOM_INNER_HEIGHT => encode(&dom.inner_height()),
        hm::DOM_SCROLL_X => encode(&dom.scroll_x()),
        hm::DOM_SCROLL_Y => encode(&dom.scroll_y()),
        hm::DOM_HOSTNAME => encode(&dom.hostname()),
        hm::DOM_ELEMENT_FROM_POINT => {
            let (x, y) = a!((f64, f64));
            encode(&dom.element_from_point(x, y))
        }
        hm::DOM_ELEMENTS_FROM_POINT => {
            let (x, y) = a!((f64, f64));
            encode(&dom.elements_from_point(x, y))
        }
        hm::DOM_CSS_ESCAPE => encode(&dom.css_escape(a!(&str))),
        hm::DOM_KEYFRAMES => {
            let frames: Option<Vec<KeyframeFrame>> = dom.keyframes(a!(&str));
            encode(&frames)
        }
        hm::DOM_DOCUMENT_HTML_FOR_PATTERNS => encode(&dom.document_html_for_patterns()),
        hm::DOM_TAG_NAME => encode(&dom.tag_name(a!(ElId))),
        hm::DOM_NAMESPACE_URI => encode(&dom.namespace_uri(a!(ElId))),
        hm::DOM_PARENT => encode(&dom.parent(a!(ElId))),
        hm::DOM_CHILDREN => encode(&dom.children(a!(ElId))),
        hm::DOM_PREVIOUS_ELEMENT_SIBLING => encode(&dom.previous_element_sibling(a!(ElId))),
        hm::DOM_NEXT_ELEMENT_SIBLING => encode(&dom.next_element_sibling(a!(ElId))),
        hm::DOM_CONTAINS => {
            let (x, y) = a!((ElId, ElId));
            encode(&dom.contains(x, y))
        }
        hm::DOM_MATCHES => {
            let (el, selector) = a!((ElId, &str));
            sel(dom.matches(el, selector))
        }
        hm::DOM_CLOSEST => {
            let (el, selector) = a!((ElId, &str));
            sel(dom.closest(el, selector))
        }
        hm::DOM_ATTR => {
            let (el, name) = a!((ElId, &str));
            encode(&dom.attr(el, name))
        }
        hm::DOM_ID_PROP => encode(&dom.id_prop(a!(ElId))),
        hm::DOM_CLASS_NAME_PROP => encode(&dom.class_name_prop(a!(ElId))),
        hm::DOM_TEXT_CONTENT => encode(&dom.text_content(a!(ElId))),
        hm::DOM_INNER_TEXT => encode(&dom.inner_text(a!(ElId))),
        hm::DOM_DIRECT_TEXT_NODES => encode(&dom.direct_text_nodes(a!(ElId))),
        hm::DOM_IS_CONTENT_EDITABLE => encode(&dom.is_content_editable(a!(ElId))),
        hm::DOM_HIDDEN_PROP => encode(&dom.hidden_prop(a!(ElId))),
        hm::DOM_STYLE => {
            let (el, prop) = a!((ElId, &str));
            encode(&dom.style(el, prop))
        }
        hm::DOM_PSEUDO_STYLE => {
            let (el, pseudo, prop) = a!((ElId, &str, &str));
            encode(&dom.pseudo_style(el, pseudo, prop))
        }
        hm::DOM_RECT => {
            let r: Rect = dom.rect(a!(ElId));
            encode(&r)
        }
        hm::DOM_CLIENT_WIDTH => encode(&dom.client_width(a!(ElId))),
        hm::DOM_CLIENT_HEIGHT => encode(&dom.client_height(a!(ElId))),
        hm::DOM_CLIENT_LEFT => encode(&dom.client_left(a!(ElId))),
        hm::DOM_SCROLL_WIDTH => encode(&dom.scroll_width(a!(ElId))),
        hm::DOM_SCROLL_LEFT => encode(&dom.scroll_left(a!(ElId))),
        hm::DOM_OFFSET_WIDTH => encode(&dom.offset_width(a!(ElId))),
        hm::DOM_OFFSET_HEIGHT => encode(&dom.offset_height(a!(ElId))),
        hm::DOM_CHECK_VISIBILITY => encode(&dom.check_visibility(a!(ElId))),
        hm::DOM_DIRECT_TEXT_RECT => encode(&dom.direct_text_rect(a!(ElId))),
        other => {
            return Err((
                status::UNKNOWN,
                format!("impeccable: no host method with id {other}"),
            ))
        }
    };
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_matches() {
        assert_eq!(unsafe { det_abi_version() }, boundary::ABI);
    }

    #[test]
    fn function_table_matches() {
        let theirs: Vec<(u32, String)> = call(boundary::fn_id::TABLE, &());
        let ours: Vec<(u32, String)> = boundary::fn_id::TABLE_ENTRIES
            .iter()
            .map(|(id, name)| (*id, (*name).to_string()))
            .collect();
        assert_eq!(theirs, ours);
    }
}
