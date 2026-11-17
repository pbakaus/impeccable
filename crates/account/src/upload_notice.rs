//! Success notices are owed until an upload can report them in human output.
use crate::{config::Account, store};
use impeccable_common::Io;

#[derive(Clone, Copy)]
pub(crate) enum Kind {
    Design,
    Critique,
    Audit,
}

pub(crate) fn emit(io: &mut Io, account: &Account, login: u64, kind: Kind, quiet: bool) {
    if quiet {
        return;
    }
    let (key, text) = match kind {
        Kind::Design => ("design", "Saved your DESIGN.md to your account, and again whenever it changes.\nTo stop: impeccable health design off\n"),
        Kind::Critique => ("critique", "Saved this critique report to your account, and each one you save after it.\nTo stop: impeccable critiques off\n"),
        Kind::Audit => ("audit", "Saved this audit report to your account, and each one you save after it.\nTo stop: impeccable critiques off\n"),
    };
    // The caller holds this upload kind's admission lock through this step.
    // Login is stable across token refreshes and changes on a new sign-in.
    let path = account.dir().join(format!("{key}-notice-{login}"));
    if store::read_private(&path).ok().flatten().is_some() {
        return;
    }
    // A failed marker write never hides a successful upload's notice.
    let _ = store::private_dir(&account.dir()).and_then(|_| store::write_private(&path, b"shown"));
    match kind {
        Kind::Design => io.err(text),
        Kind::Critique | Kind::Audit => io.out(text),
    }
}

/// Whether this is the first time `kind` is reported on this sign-in, marking
/// it so. Uploads that print their own line use it to add the one-time
/// disclosure (how to stop) to the first one.
pub(crate) fn first(account: &Account, login: u64, kind: Kind) -> bool {
    let key = match kind {
        Kind::Design => "design",
        Kind::Critique => "critique",
        Kind::Audit => "audit",
    };
    let path = account.dir().join(format!("{key}-notice-{login}"));
    if store::read_private(&path).ok().flatten().is_some() {
        return false;
    }
    let _ = store::private_dir(&account.dir()).and_then(|_| store::write_private(&path, b"shown"));
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    trait Output {
        fn out(&self) -> String;
        fn err(&self) -> String;
    }
    impl Output for impeccable_common::Captured {
        fn out(&self) -> String {
            String::from_utf8(self.stdout.borrow().clone()).unwrap()
        }
        fn err(&self) -> String {
            String::from_utf8(self.stderr.borrow().clone()).unwrap()
        }
    }

    #[test]
    fn notices_are_once_per_login_and_suppression_keeps_them_owed() {
        let home =
            std::env::temp_dir().join(format!("upload-notices-{}", crate::oauth::random_b64(12)));
        let account = Account {
            home: home.clone(),
            issuer: "https://example.com".into(),
        };
        for kind in [Kind::Design, Kind::Critique] {
            let (mut io, cap) = Io::captured("", home.clone(), Default::default());
            emit(&mut io, &account, 1, kind, true);
            assert!(cap.out().is_empty() && cap.err().is_empty());
            emit(&mut io, &account, 1, kind, false);
            let first = (cap.out(), cap.err());
            assert!(first.0.contains("To stop:") || first.1.contains("To stop:"));
            emit(&mut io, &account, 1, kind, false);
            assert_eq!((cap.out(), cap.err()), first);
            emit(&mut io, &account, 2, kind, false);
            assert_eq!(cap.out(), first.0.repeat(2));
            assert_eq!(cap.err(), first.1.repeat(2));
        }
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn marker_failure_still_prints() {
        let home = std::env::temp_dir().join(format!(
            "upload-notice-failure-{}",
            crate::oauth::random_b64(12)
        ));
        std::fs::write(&home, b"not a directory").unwrap();
        let account = Account {
            home: home.clone(),
            issuer: "https://example.com".into(),
        };
        for kind in [Kind::Design, Kind::Critique] {
            let (mut io, cap) = Io::captured("", home.clone(), Default::default());
            emit(&mut io, &account, 1, kind, false);
            assert!(cap.out().contains("To stop:") || cap.err().contains("To stop:"));
        }
        std::fs::remove_file(home).unwrap();
    }
}
