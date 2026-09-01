//! impeccable-comp: the pure, browser-independent foundation of the
//! comp-fidelity pipeline, ported from the skill's JS libs.
//!
//! Ported modules (all pure, no browser, no CLI):
//!   - `png_io`   — JS lib/png.mjs (decode/encode + loadRaster)
//!   - `raster`   — JS lib/raster.mjs (image type and ops)
//!   - `metrics`  — JS lib/image-metrics.mjs (the comparison math)
//!   - `font_fingerprint` — JS lib/font-fingerprint.mjs
//!   - `font_index`       — JS lib/font-index.mjs
//!   - `hero`     — JS lib/hero-checks.mjs (+ the pure `inkBox`)
//!
//! Deferred to step 2 (need a browser or the verb orchestrators): the
//! Playwright/CDP rendering behind font-match `renderCandidates`, and the four
//! orchestrators build-phase / comp-diff / comp-spec / font-match.

pub mod font_fingerprint;
pub mod font_index;
pub mod hero;
pub mod jsnum;
pub mod metrics;
pub mod png_io;
pub mod raster;

/// CRC-32 (IEEE, the same polynomial the JS png encoder uses) over a byte
/// slice. Exposed so parity tests can checksum decoded pixel buffers.
pub fn crc32(data: &[u8]) -> u32 {
    static TABLE: once_cell::sync::Lazy<[u32; 256]> = once_cell::sync::Lazy::new(|| {
        let mut t = [0u32; 256];
        for (n, slot) in t.iter_mut().enumerate() {
            let mut c = n as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *slot = c;
        }
        t
    });
    let mut c: u32 = 0xffff_ffff;
    for &b in data {
        c = TABLE[((c ^ b as u32) & 0xff) as usize] ^ (c >> 8);
    }
    c ^ 0xffff_ffff
}

/// CRC-32 over an f32 slice, matching the JS `crc32(new Uint8Array(f32.buffer))`
/// (little-endian byte layout, as on the recording host).
pub fn crc32_f32(data: &[f32]) -> u32 {
    let mut bytes = Vec::with_capacity(data.len() * 4);
    for &v in data {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    crc32(&bytes)
}
