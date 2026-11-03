//! How printed commands spell the Windows `.cmd` launcher (issue #744).
//!
//! `IMPECCABLE_SELF` is the launcher path the binary names in the commands it
//! prints. When that path is the `.cmd` launcher and the printed spelling has
//! to be quoted, PowerShell parses `"<path>" <verb>` as a string expression
//! and fails with `Unexpected token '<verb>'`. The call operator runs it. The
//! path goes in a PowerShell single-quoted literal, `& '<path>' <verb>`,
//! because a double-quoted string expands `$` and backticks, so a folder
//! named `$work` would be rewritten before the launcher is found. Inside the
//! literal only a single quote is special, and doubling it escapes it.
//!
//! The rule keys on the `.cmd` suffix, not on the OS: only `impeccable.cmd`
//! exports a `.cmd` self path, and it only runs on a Windows shell without
//! sh. The sh launcher, the npm shim's `npx impeccable`, and unquoted paths
//! keep their spelling.

/// True when `value` names the Windows `.cmd` launcher. Compares bytes, so a
/// value ending in a multi-byte character can never split one.
pub fn is_cmd_launcher(value: &str) -> bool {
    let bytes = value.trim().as_bytes();
    bytes.len() > 4 && bytes[bytes.len() - 4..].eq_ignore_ascii_case(b".cmd")
}

/// `& '<path>'`: the `.cmd` launcher as a PowerShell call on a literal
/// string. PowerShell also treats the typographic single quotes as quote
/// characters, so each of them is doubled like `'`.
pub fn powershell_call(raw: &str) -> String {
    let mut escaped = String::with_capacity(raw.len() + 2);
    for c in raw.trim().chars() {
        if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
            escaped.push(c);
        }
        escaped.push(c);
    }
    format!("& '{escaped}'")
}

/// For sites that quote the self path themselves: when that quoted spelling
/// names the `.cmd` launcher, print the PowerShell call on the raw path
/// instead. `raw` is the unquoted self path, `rendered` the caller's spelling;
/// anything else comes back unchanged.
pub fn with_call_operator(raw: &str, rendered: String) -> String {
    if is_cmd_launcher(raw) && rendered.starts_with('"') {
        powershell_call(raw)
    } else {
        rendered
    }
}

/// The printed spelling for sites that print the self path as is. A `.cmd`
/// path containing whitespace splits unquoted in every Windows shell, so it
/// is printed as the PowerShell call; every other value is returned unchanged.
pub fn spell_self(raw: &str) -> String {
    let value = raw.trim();
    if is_cmd_launcher(value) && value.chars().any(char::is_whitespace) && !value.starts_with(['"', '\'', '&']) {
        powershell_call(value)
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_only_the_cmd_launcher() {
        assert!(is_cmd_launcher(r"C:\Users\A B\skill\scripts\impeccable.cmd"));
        assert!(is_cmd_launcher("C:/skill/scripts/IMPECCABLE.CMD"));
        assert!(!is_cmd_launcher("/Users/a b/skill/scripts/impeccable"));
        assert!(!is_cmd_launcher("npx impeccable"));
        assert!(!is_cmd_launcher(".cmd"));
    }

    #[test]
    fn multibyte_values_never_panic() {
        // A slice of the last four bytes would cut through these characters.
        for value in ["工具", "/opt/工具", "é", "工具.cmd工"] {
            assert!(!is_cmd_launcher(value), "{value}");
            assert_eq!(spell_self(value), value);
        }
        assert!(is_cmd_launcher(r"C:\Users\工具\impeccable.cmd"));
        assert_eq!(spell_self(r"C:\Users\工具 箱\impeccable.cmd"), r"& 'C:\Users\工具 箱\impeccable.cmd'");
    }

    #[test]
    fn quoted_cmd_becomes_a_powershell_literal_call() {
        let raw = r"C:\Users\A B\impeccable.cmd";
        assert_eq!(with_call_operator(raw, format!("\"{raw}\"")), format!("& '{raw}'"));
        // The caller's own escaping (doubled backslashes) is not carried over.
        assert_eq!(with_call_operator(raw, r#""C:\\Users\\A B\\impeccable.cmd""#.into()), format!("& '{raw}'"));
        // Unquoted, or the sh launcher quoted for sh: unchanged.
        assert_eq!(with_call_operator(r"C:\x\impeccable.cmd", r"C:\x\impeccable.cmd".into()), r"C:\x\impeccable.cmd");
        assert_eq!(with_call_operator("/a b/impeccable", "'/a b/impeccable'".into()), "'/a b/impeccable'");
        assert_eq!(with_call_operator("/a b/impeccable", "\"/a b/impeccable\"".into()), "\"/a b/impeccable\"");
    }

    #[test]
    fn powershell_metacharacters_stay_literal() {
        // `$` and backticks are inert in a single-quoted literal; quotes double.
        assert_eq!(powershell_call(r"C:\Users\A B\$work\impeccable.cmd"), r"& 'C:\Users\A B\$work\impeccable.cmd'");
        assert_eq!(powershell_call(r"C:\a `b\impeccable.cmd"), r"& 'C:\a `b\impeccable.cmd'");
        assert_eq!(powershell_call(r"C:\Users\O'Brien X\impeccable.cmd"), r"& 'C:\Users\O''Brien X\impeccable.cmd'");
        assert_eq!(powershell_call("C:\\a \u{2019}b\\impeccable.cmd"), "& 'C:\\a \u{2019}\u{2019}b\\impeccable.cmd'");
    }

    #[test]
    fn raw_spelling_quotes_only_a_spaced_cmd_path() {
        assert_eq!(spell_self(r"C:\Users\A B\impeccable.cmd"), r"& 'C:\Users\A B\impeccable.cmd'");
        assert_eq!(spell_self(r"C:\skill\impeccable.cmd"), r"C:\skill\impeccable.cmd");
        assert_eq!(spell_self("/Users/a b/skill/scripts/impeccable"), "/Users/a b/skill/scripts/impeccable");
        assert_eq!(spell_self("npx impeccable"), "npx impeccable");
        // Already spelled: never double-wrapped.
        let spelled = spell_self(r"C:\A B\impeccable.cmd");
        assert_eq!(spell_self(&spelled), spelled);
    }
}
