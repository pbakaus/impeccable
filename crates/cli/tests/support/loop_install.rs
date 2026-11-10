use super::*;

#[test]
fn platform_refuses_non_macos() {
    assert_eq!(
        check_platform("linux").unwrap_err(),
        "Impeccable Loop is only available on macOS."
    );
    assert!(check_platform("macos").is_ok());
    // Arguments are read before the platform check: usage is the same everywhere, and only real work is macOS-only.
    let io = Io::stdio();
    assert!(run_inner(&["bogus".into()], &io, "", "linux")
        .unwrap_err()
        .starts_with("Usage: impeccable loop"));
    assert!(run_inner(&["--help".into()], &io, "", "linux")
        .unwrap()
        .starts_with("Usage: impeccable loop"));
    assert_eq!(
        run_inner(&["install".into()], &io, "", "linux").unwrap_err(),
        "Impeccable Loop is only available on macOS."
    );
}

#[test]
fn pins_are_strict_and_sort_semantically() {
    let pins = parse_pins(&format!(
        "{}  impeccable-loop-1.9.0.zip\n{}  impeccable-loop-1.10.0.zip\n",
        "a".repeat(64),
        "b".repeat(64)
    ))
    .unwrap();
    assert_eq!(pins.last_key_value().unwrap().0.to_string(), "1.10.0");
    assert!(parse_pins("broken").is_err());
    assert!(parse_pins(include_str!("../../loop-checksums.txt")).is_ok());
}

#[test]
fn urls_and_missing_pins_fail_closed() {
    for url in [
        "http://example.com",
        "http://localhost.evil.test",
        "file:///tmp/loop.zip",
        "https://user@example.com",
        "http://127.0.0.2",
    ] {
        assert!(secure_url(url, true).is_err(), "{url}");
    }
    for url in [
        "https://github.com/pbakaus/impeccable/releases/download",
        "http://127.0.0.1:1234",
        "http://localhost:1234",
    ] {
        assert!(secure_url(url, false).is_ok(), "{url}");
    }
    // A configured base never carries a query; a redirect target may (GitHub's signed asset URLs), still HTTPS-only.
    let signed = "https://objects.githubusercontent.com/x/loop.zip?sp=r&sig=abc";
    assert!(secure_url(signed, false).is_err());
    assert!(secure_url(signed, true).is_ok());
    assert!(secure_url("http://example.com/loop.zip?sig=abc", true).is_err());
    let home = Stage::new(&std::env::temp_dir()).unwrap();
    let mut io = Io::stdio();
    io.env
        .insert("HOME".into(), home.0.to_string_lossy().into_owned());
    assert!(run_inner(&["install".into()], &io, "# no pins", "macos")
        .unwrap_err()
        .contains("No Loop release is pinned"));
    assert!(run_inner(
        &["install".into(), "--version".into(), "8.0.0".into()],
        &io,
        "",
        "macos"
    )
    .unwrap_err()
    .contains("No checksum pinned"));
}

#[test]
fn failed_swap_restores_old_app() {
    let home = Stage::new(&std::env::temp_dir()).unwrap();
    let app = home.0.join(APP);
    fs::create_dir(&app).unwrap();
    fs::write(app.join("old"), "old").unwrap();
    let backup = home.0.join("backup");
    assert!(swap(&home.0.join("missing"), &app, &backup, true).is_err());
    assert_eq!(fs::read_to_string(app.join("old")).unwrap(), "old");
    assert!(!backup.exists());
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    fn fixture(version: &str, root: &Path) -> Vec<u8> {
        let app = root.join(APP);
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        fs::copy("/bin/sleep", app.join("Contents/MacOS/Impeccable Loop")).unwrap();
        fs::write(app.join("Contents/Info.plist"), format!(r#"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Impeccable Loop</string><key>CFBundleShortVersionString</key><string>{version}</string></dict></plist>"#)).unwrap();
        let zip = root.join("fixture.zip");
        assert!(Command::new("/usr/bin/ditto")
            .args(["-c", "-k", "--keepParent"])
            .arg(&app)
            .arg(&zip)
            .status()
            .unwrap()
            .success());
        fs::read(zip).unwrap()
    }

    fn serve(bytes: Vec<u8>, version: &str) -> (String, thread::JoinHandle<()>) {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.local_addr().unwrap());
        let expected = format!("GET /loop-v{version}/impeccable-loop-{version}.zip HTTP/1.1");
        let task = thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            assert!(String::from_utf8_lossy(&request).starts_with(&expected));
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            )
            .unwrap();
            stream.write_all(&bytes).unwrap();
        });
        (base, task)
    }

    /// Answers the release path with a 302 to a signed, query-carrying URL (as GitHub does), then serves the zip there.
    fn serve_signed(bytes: Vec<u8>, version: &str) -> (String, thread::JoinHandle<()>) {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.local_addr().unwrap());
        let expected = format!("GET /loop-v{version}/impeccable-loop-{version}.zip HTTP/1.1");
        let task = thread::spawn(move || {
            for step in 0..2 {
                let (mut stream, _) = server.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") {
                    stream.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                let request = String::from_utf8_lossy(&request).into_owned();
                if step == 0 {
                    assert!(request.starts_with(&expected));
                    write!(stream, "HTTP/1.1 302 Found\r\nLocation: /signed/loop.zip?sp=r&sig=abc\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                } else {
                    assert!(request.starts_with("GET /signed/loop.zip?sp=r&sig=abc HTTP/1.1"));
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        bytes.len()
                    )
                    .unwrap();
                    stream.write_all(&bytes).unwrap();
                }
            }
        });
        (base, task)
    }

    #[test]
    fn follows_a_signed_redirect_and_sweeps_stale_stages() {
        let source = Stage::new(&std::env::temp_dir()).unwrap();
        let home = Stage::new(&std::env::temp_dir()).unwrap();
        let apps = home.0.join("Applications");
        // A crashed run's stage is swept under the lock.
        fs::create_dir_all(apps.join(".impeccable-loop-1-2-3/unpacked")).unwrap();
        let bytes = fixture("1.0.0", &source.0);
        let pins = pin("1.0.0", &bytes);
        let (base, server) = serve_signed(bytes, "1.0.0");
        assert!(
            run_inner(&args("install"), &io(&home.0, &base), &pins, "macos")
                .unwrap()
                .contains("Installed Loop 1.0.0")
        );
        server.join().unwrap();
        clean(&apps);
    }

    fn io(home: &Path, base: &str) -> Io {
        let mut io = Io::stdio();
        io.env
            .insert("HOME".into(), home.to_string_lossy().into_owned());
        io.env
            .insert("IMPECCABLE_DOWNLOAD_BASE".into(), base.into());
        io
    }
    fn pin(version: &str, bytes: &[u8]) -> String {
        format!(
            "{:x}  impeccable-loop-{version}.zip\n",
            Sha256::digest(bytes)
        )
    }
    fn args(verb: &str) -> Vec<String> {
        vec![verb.into(), "--no-open".into()]
    }
    fn clean(apps: &Path) {
        let mut names: Vec<_> = fs::read_dir(apps)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(names, vec![APP]);
    }

    #[test]
    fn install_update_and_current_with_no_open() {
        let source = Stage::new(&std::env::temp_dir()).unwrap();
        let home = Stage::new(&std::env::temp_dir()).unwrap();
        let bytes = fixture("1.0.0", &source.0);
        let pins = pin("1.0.0", &bytes);
        let (base, server) = serve(bytes, "1.0.0");
        let mut io = io(&home.0, &base);
        assert!(run_inner(&args("install"), &io, &pins, "macos")
            .unwrap()
            .contains("Installed Loop 1.0.0"));
        server.join().unwrap();
        let apps = home.0.join("Applications");
        assert_eq!(
            plist(&apps.join(APP), "CFBundleShortVersionString").unwrap(),
            "1.0.0"
        );
        assert!(run_inner(&args("install"), &io, &pins, "macos")
            .unwrap_err()
            .contains("already installed"));
        assert!(run_inner(&args("update"), &io, &pins, "macos")
            .unwrap()
            .contains("already current"));
        fs::write(apps.join(APP).join("obsolete"), "old").unwrap();
        let bytes = fixture("1.1.0", &source.0);
        let pins = format!("{pins}{}", pin("1.1.0", &bytes));
        let (base, server) = serve(bytes, "1.1.0");
        io.env.insert("IMPECCABLE_DOWNLOAD_BASE".into(), base);
        assert!(run_inner(&args("update"), &io, &pins, "macos")
            .unwrap()
            .contains("Updated Loop 1.1.0"));
        server.join().unwrap();
        assert!(!apps.join(APP).join("obsolete").exists());
        // An engine that pins only an older release never downgrades the installed Loop.
        let older = pins.lines().next().unwrap().to_string();
        assert!(run_inner(&args("update"), &io, &older, "macos")
            .unwrap()
            .contains("newer than the newest pinned release"));
        assert_eq!(
            plist(&apps.join(APP), "CFBundleShortVersionString").unwrap(),
            "1.1.0"
        );
        clean(&apps);
    }

    #[test]
    fn wrong_digest_leaves_no_app_or_staging() {
        let home = Stage::new(&std::env::temp_dir()).unwrap();
        let (base, server) = serve(b"not even a zip".to_vec(), "1.0.0");
        let pins = format!("{}  impeccable-loop-1.0.0.zip", "0".repeat(64));
        assert!(
            run_inner(&args("install"), &io(&home.0, &base), &pins, "macos")
                .unwrap_err()
                .contains("checksum mismatch")
        );
        server.join().unwrap();
        let names: Vec<_> = fs::read_dir(home.0.join("Applications"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert!(names.is_empty());
    }

    /// Start the installed bundle's executable (the fixture's is /bin/sleep) and wait until the
    /// process listing the installer reads shows it.
    fn run_bundle(apps: &Path) -> std::process::Child {
        let process = Command::new(apps.join(APP).join("Contents/MacOS/Impeccable Loop"))
            .arg("60")
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while running_pids(&apps.join(APP)).unwrap().is_empty()
            && std::time::Instant::now() < deadline
        {
            thread::yield_now();
        }
        process
    }

    #[test]
    fn update_quits_a_running_loop_then_swaps() {
        // Catches (Loop journey, 10 Nov): Loop's menu line copies 'impeccable loop update', which always
        // failed the first time because the person ran it while Loop was open.
        let source = Stage::new(&std::env::temp_dir()).unwrap();
        let home = Stage::new(&std::env::temp_dir()).unwrap();
        let old = fixture("1.0.0", &source.0);
        let apps = home.0.join("Applications");
        fs::create_dir(&apps).unwrap();
        fs::rename(source.0.join(APP), apps.join(APP)).unwrap();
        let mut process = run_bundle(&apps);
        let bytes = fixture("1.1.0", &source.0);
        let pins = format!("{}{}", pin("1.0.0", &old), pin("1.1.0", &bytes));
        let (base, server) = serve(bytes, "1.1.0");
        let result = run_inner(&args("update"), &io(&home.0, &base), &pins, "macos");
        server.join().unwrap();
        let status = process.wait().unwrap();
        assert!(
            result
                .as_deref()
                .unwrap_or_default()
                .contains("Updated Loop 1.1.0"),
            "{result:?}"
        );
        assert!(!status.success(), "the running Loop was asked to quit");
        assert_eq!(
            plist(&apps.join(APP), "CFBundleShortVersionString").unwrap(),
            "1.1.0"
        );
        clean(&apps);
    }

    #[test]
    fn a_loop_that_does_not_quit_keeps_the_refusal_and_the_old_app() {
        let source = Stage::new(&std::env::temp_dir()).unwrap();
        let home = Stage::new(&std::env::temp_dir()).unwrap();
        fixture("1.0.0", &source.0);
        let apps = home.0.join("Applications");
        fs::create_dir(&apps).unwrap();
        fs::rename(source.0.join(APP), apps.join(APP)).unwrap();
        let mut process = run_bundle(&apps);
        // Signal 0 delivers nothing: a stand-in for a Loop that doesn't quit when asked.
        let error = quit_running_with(&apps.join(APP), Duration::from_millis(300), 0).unwrap_err();
        assert!(
            process.try_wait().unwrap().is_none(),
            "the Loop that didn't quit is left running"
        );
        process.kill().unwrap();
        process.wait().unwrap();
        assert!(error.contains("Quit Loop first"), "{error}");
        assert_eq!(
            plist(&apps.join(APP), "CFBundleShortVersionString").unwrap(),
            "1.0.0"
        );
    }

    #[test]
    fn quitting_touches_only_this_bundle() {
        // Another process (not this bundle's executable) is never signalled.
        let home = Stage::new(&std::env::temp_dir()).unwrap();
        let source = Stage::new(&std::env::temp_dir()).unwrap();
        fixture("1.0.0", &source.0);
        let apps = home.0.join("Applications");
        fs::create_dir(&apps).unwrap();
        fs::rename(source.0.join(APP), apps.join(APP)).unwrap();
        let mut other = Command::new("/bin/sleep").arg("60").spawn().unwrap();
        assert!(quit_running(&apps.join(APP), Duration::from_millis(300)).is_ok());
        assert!(
            other.try_wait().unwrap().is_none(),
            "an unrelated sleep kept running"
        );
        other.kill().unwrap();
        other.wait().unwrap();
    }

    #[test]
    fn crash_backup_recovers() {
        let source = Stage::new(&std::env::temp_dir()).unwrap();
        let home = Stage::new(&std::env::temp_dir()).unwrap();
        let bytes = fixture("1.0.0", &source.0);
        let apps = home.0.join("Applications");
        fs::create_dir(&apps).unwrap();
        fs::rename(
            source.0.join(APP),
            apps.join(".impeccable-loop-previous.app"),
        )
        .unwrap();
        let result = run_inner(
            &args("update"),
            &io(&home.0, "http://127.0.0.1:1"),
            &pin("1.0.0", &bytes),
            "macos",
        )
        .unwrap();
        assert!(result.contains("already current"));
        clean(&apps);
    }
}
