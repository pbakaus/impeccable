//! Offline verification of local release assets using the installer's trust roots.
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use impeccable_common::Io;

use crate::bundle_signature::{self, Envelope, TrustedKeys, MAX_SIGNATURE_BYTES};
use crate::{Flow, R};

const USAGE: &str = "Usage: impeccable verify-bundle <zip> --version <expected-version> [options]

Verify a local skill bundle's signature and SHA-256 using the pinned signing keys.
Runs offline without extracting files, installing skills, or enabling hooks.

Options:
  --version <version>    Required expected skill version (for example, 4.3.1)
  --signature <path>     Signature manifest (default: <zip>.sig.json)
  --json                 Print verified metadata as JSON
  -h, --help             Show this help message

Exit codes: 0 verified, 1 verification or file error, 2 invalid arguments.
";

struct Options {
    bundle: PathBuf,
    signature: PathBuf,
    version: String,
    json: bool,
}

fn parse(args: &[String]) -> Result<Options, String> {
    let (mut bundle, mut signature, mut version) = (None, None, None);
    let mut json = false;
    let mut positional = false;
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if !positional && arg == "--" {
            positional = true;
        } else if !positional && arg == "--json" {
            json = true;
        } else if !positional
            && (arg == "--version"
                || arg == "--signature"
                || arg.starts_with("--version=")
                || arg.starts_with("--signature="))
        {
            let (name, value) = match arg.split_once('=') {
                Some(pair) => pair,
                None => (arg.as_str(), args.next().map(String::as_str).unwrap_or("")),
            };
            if value.is_empty() || value.starts_with('-') {
                return Err(format!("{name} requires a value"));
            }
            let slot = if name == "--version" {
                &mut version
            } else {
                &mut signature
            };
            if slot.replace(value.to_string()).is_some() {
                return Err(format!("{name} may only be specified once"));
            }
        } else if !positional && arg.starts_with('-') {
            return Err(format!("Unknown option: {arg}"));
        } else if bundle.replace(PathBuf::from(arg)).is_some() {
            return Err("Expected exactly one local bundle path".into());
        }
    }
    let bundle = bundle.ok_or("A local bundle path is required")?;
    let version = version.ok_or("--version is required; specify the expected skill release")?;
    // Reuse the installer's exact release-version grammar.
    bundle_signature::release_version(&format!(
        "https://github.com/pbakaus/impeccable/releases/download/skill-v{version}/universal.zip"
    ))?;
    let signature = signature.map(PathBuf::from).unwrap_or_else(|| {
        let mut path = bundle.as_os_str().to_os_string();
        path.push(".sig.json");
        PathBuf::from(path)
    });
    Ok(Options {
        bundle,
        signature,
        version,
        json,
    })
}

fn verify(options: &Options, cwd: &Path, keys: &TrustedKeys) -> Result<Envelope, String> {
    let read_error = |path: &Path, error| format!("Could not read {}: {error}", path.display());
    let file =
        File::open(cwd.join(&options.signature)).map_err(|e| read_error(&options.signature, e))?;
    let mut signature = Vec::new();
    file.take(MAX_SIGNATURE_BYTES + 1)
        .read_to_end(&mut signature)
        .map_err(|e| read_error(&options.signature, e))?;
    let file = File::open(cwd.join(&options.bundle)).map_err(|e| read_error(&options.bundle, e))?;
    bundle_signature::verify_reader(
        &mut BufReader::new(file),
        &signature,
        &options.version,
        keys,
    )
}

pub(crate) fn run(args: &[String], io: &mut Io) -> R<()> {
    if args
        .iter()
        .take_while(|a| a.as_str() != "--")
        .any(|a| a == "--help" || a == "-h")
    {
        io.out(USAGE);
        return Ok(());
    }
    let options = parse(args).map_err(|e| {
        io.err(&format!("{e}\n\n{USAGE}"));
        Flow::Exit(2)
    })?;
    let verified = bundle_signature::trusted_keys()
        .and_then(|keys| verify(&options, &io.cwd, &keys))
        .map_err(|e| Flow::Throw(format!("{}{e}", bundle_signature::ERROR_PREFIX)))?;
    if options.json {
        io.out(&format!(
            "{}\n",
            serde_json::json!({
                "verified": true, "version": verified.version, "artifact": verified.artifact,
                "keyId": verified.key_id, "size": verified.size, "sha256": verified.sha256,
            })
        ));
    } else {
        io.out(&format!(
            "Verified {} (skill-v{}).\nSigning key: {}\nSHA-256: {}\nSize: {} bytes\n",
            verified.artifact, verified.version, verified.key_id, verified.sha256, verified.size
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_local_pair_and_rejects_tampering_without_writes() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/bundle-signature.json"
        ))
        .unwrap();
        let root = crate::util::mkdtemp(
            &std::env::temp_dir()
                .join("verify-bundle-")
                .to_string_lossy(),
        )
        .unwrap();
        let root = Path::new(&root);
        let bundle = fixture["bundle"].as_str().unwrap().as_bytes();
        let signature = serde_json::to_vec(&fixture["envelope"]).unwrap();
        std::fs::write(root.join("renamed.zip"), bundle).unwrap();
        std::fs::write(root.join("manifest.json"), &signature).unwrap();
        let options = Options {
            bundle: "renamed.zip".into(),
            signature: "manifest.json".into(),
            version: "4.2.0".into(),
            json: true,
        };
        let keys = serde_json::from_value(fixture["keys"].clone()).unwrap();
        let result = verify(&options, root, &keys).unwrap();
        assert_eq!(result.version, "4.2.0");
        assert_eq!(result.sha256, fixture["envelope"]["sha256"]);
        assert!(verify(&options, root, &bundle_signature::trusted_keys().unwrap()).is_err());
        let wrong_release = Options {
            version: "4.2.1".into(),
            ..options
        };
        assert!(verify(&wrong_release, root, &keys).is_err());
        let options = Options {
            version: "4.2.0".into(),
            ..wrong_release
        };
        std::fs::write(root.join("renamed.zip"), b"tampered").unwrap();
        assert!(verify(&options, root, &keys).is_err());
        std::fs::write(root.join("renamed.zip"), bundle).unwrap();
        std::fs::write(
            root.join("manifest.json"),
            vec![b' '; MAX_SIGNATURE_BYTES as usize + 1],
        )
        .unwrap();
        assert!(verify(&options, root, &keys)
            .unwrap_err()
            .contains("too large"));
        std::fs::remove_file(root.join("manifest.json")).unwrap();
        assert!(verify(&options, root, &keys)
            .unwrap_err()
            .contains("Could not read"));
        assert_eq!(std::fs::read(root.join("renamed.zip")).unwrap(), bundle);
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn arguments_are_strict_and_default_to_adjacent_signature() {
        let parse_args =
            |args: &[&str]| parse(&args.iter().map(|a| a.to_string()).collect::<Vec<_>>());
        let options = parse_args(&["bundle.zip", "--version=4.3.1", "--json"]).unwrap();
        assert_eq!(options.signature, PathBuf::from("bundle.zip.sig.json"));
        assert!(options.json);
        let options = parse_args(&[
            "--version",
            "4.3.1",
            "--signature",
            "sig.json",
            "--",
            "-bundle.zip",
        ])
        .unwrap();
        assert_eq!(options.bundle, PathBuf::from("-bundle.zip"));
        assert_eq!(options.signature, PathBuf::from("sig.json"));
        for args in [
            vec![],
            vec!["bundle.zip"],
            vec!["bundle.zip", "--version"],
            vec!["bundle.zip", "--version=04.3.1"],
            vec!["bundle.zip", "--version=4.3.1", "--version=4.2.0"],
            vec!["bundle.zip", "--version=4.3.1", "extra.zip"],
            vec!["bundle.zip", "--version=4.3.1", "--skip-signature"],
            vec!["bundle.zip", "--version=4.3.1", "--signature="],
        ] {
            assert!(parse_args(&args).is_err(), "{args:?}");
        }
    }
}
