//! `crypto.randomUUID()` for the server token and the manual-apply event ids.

/// A version-4 UUID from the OS CSPRNG (falls back to a time/pid hash only if
/// the OS source is unavailable, which is not expected).
pub fn random_uuid() -> String {
    let mut b = [0u8; 16];
    if getrandom::getrandom(&mut b).is_err() {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mut x = (t as u64) ^ ((std::process::id() as u64) << 32) ^ 0x9E3779B97F4A7C15;
        for chunk in b.chunks_mut(8) {
            x ^= x >> 33;
            x = x.wrapping_mul(0xff51afd7ed558ccd);
            x ^= x >> 33;
            for (i, byte) in chunk.iter_mut().enumerate() {
                *byte = (x >> (i * 8)) as u8;
            }
        }
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: Vec<String> = b.iter().map(|x| format!("{:02x}", x)).collect();
    format!(
        "{}{}{}{}-{}{}-{}{}-{}{}-{}{}{}{}{}{}",
        hex[0],
        hex[1],
        hex[2],
        hex[3],
        hex[4],
        hex[5],
        hex[6],
        hex[7],
        hex[8],
        hex[9],
        hex[10],
        hex[11],
        hex[12],
        hex[13],
        hex[14],
        hex[15]
    )
}

/// JS: `randomUUID().replace(/-/g, '').slice(0, 8)`
pub fn random_id8() -> String {
    random_uuid().replace('-', "").chars().take(8).collect()
}
