//! `impeccable first-viewport`: both selectors are required; a page whose
//! thesis and action sit in the first viewport and that has no empty stretch
//! passes; a page with its thesis below the fold, its action cut off and a
//! blank stretch fails on all three, even when a flipped-away face or a
//! clipped image covers the stretch's rows.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("impeccable-first-viewport-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

fn run(cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_impeccable"))
        .arg("first-viewport")
        .args(args)
        .current_dir(cwd)
        .env("IMPECCABLE_NO_UPDATE_CHECK", "1")
        .output()
        .unwrap()
}

fn has_browser() -> bool {
    let env = std::env::vars().collect();
    impeccable_browser::discovery::find_browser(&env).is_ok()
}

const STYLE: &str = "body { margin: 0; font: 16px/1.4 Georgia, serif; } p { margin: 0; padding: 8px; }";

#[test]
fn both_selectors_are_required() {
    let dir = scratch("usage");
    std::fs::write(dir.join("index.html"), "<p>hi</p>").unwrap();
    for args in [&["index.html", "--thesis", ".t"][..], &["index.html", "--thesis", "", "--action", ".a"][..]] {
        let out = run(&dir, args);
        assert_eq!(out.status.code(), Some(2), "{args:?}");
        assert!(String::from_utf8_lossy(&out.stderr).starts_with("Usage: impeccable first-viewport"));
    }
}

#[test]
fn a_page_that_opens_on_its_thesis_passes() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("pass");
    std::fs::write(
        dir.join("index.html"),
        format!(
            "<!doctype html><style>{STYLE} .thesis {{ height: 300px; background: #c33; }}
             .buy {{ transform: rotate(180deg); backface-visibility: hidden; }}</style>
             <h1>Seeds</h1><div class=\"thesis\"></div><button class=\"buy\" onclick=\"this.textContent = 'Added'\">Add to basket</button>
             <p>One</p><p>Two</p><p>Three</p>"
        ),
    )
    .unwrap();
    let out = run(&dir, &["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{text}");
    assert_eq!(text.matches("ok  ").count(), 5, "{text}");
}

#[test]
fn a_thesis_below_the_fold_a_cut_action_and_a_blank_stretch_fail() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("fail");
    // Text down to just past the fold, so the only blank stretch is the card.
    let lines = "<p>A line of the introduction</p>".repeat(20);
    std::fs::write(
        dir.join("index.html"),
        format!(
            "<!doctype html><style>{STYLE}
                          .buy {{ display: block; margin-top: 100px; height: 80px; }}
             .card {{ position: relative; height: 900px; }}
             .back {{ position: absolute; inset: 0; transform: rotateY(180deg); backface-visibility: hidden; }}
             .back svg {{ width: 100%; height: 100%; }}
             .crop {{ height: 40px; overflow: hidden; }} .crop img {{ display: block; width: 100px; height: 1000px; }}
             .thesis {{ height: 200px; background: #c33; }}</style>
             <div class=\"intro\">{lines}</div><button class=\"buy\">Add to basket</button>
             <div class=\"crop\"><img alt=\"\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\"></div>
             <div class=\"card\"><div class=\"back\"><svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\" fill=\"none\" stroke=\"#000\"/></svg></div></div>
             <div class=\"thesis\"></div><p>End</p>"
        ),
    )
    .unwrap();
    let out = run(&dir, &["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(1), "{text}");
    assert!(text.contains("FAIL  thesis .thesis: 0% shows"), "{text}");
    assert!(text.contains("FAIL  primary action .buy: not wholly inside"), "{text}");
    assert!(text.contains("FAIL  longest empty stretch"), "{text}");
}

#[test]
fn a_drawing_in_an_app_shell_below_the_fold_is_content() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("shell");
    std::fs::write(
        dir.join("index.html"),
        format!(
            "<!doctype html><style>{STYLE} html, body {{ height: 100%; overflow: hidden; }}
             main {{ height: 100%; overflow-y: auto; }} .thesis {{ height: 300px; background: #c33; }}
             svg {{ display: block; width: 390px; height: 1600px; }}</style>
             <main><h1>Seeds</h1><div class=\"thesis\"></div><button class=\"buy\" onclick=\"this.textContent = 'Added'\">Add</button>
             <svg viewBox=\"0 0 10 10\" preserveAspectRatio=\"none\"><circle cx=\"5\" cy=\"5\" r=\"4.5\" fill=\"none\" stroke=\"#000\" stroke-width=\".05\"/></svg>
             <p>End</p></main>"
        ),
    )
    .unwrap();
    let out = run(&dir, &["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{text}");
}

#[test]
fn a_thesis_a_full_height_wrapper_hides_fails() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("hidden");
    std::fs::write(
        dir.join("index.html"),
        format!(
            "<!doctype html><style>{STYLE} .frame {{ width: 97px; height: 100vh; overflow: hidden; }}
             .thesis {{ width: 388px; height: 300px; background: #c33; }}</style>
             <div class=\"frame\"><h1>Seeds</h1><button class=\"buy\">Add</button>
             <div class=\"thesis\">The whole season on one packet, from seed to seed.</div></div>"
        ),
    )
    .unwrap();
    let out = run(&dir, &["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(1), "{text}");
    assert!(text.contains("FAIL  thesis .thesis: 25% shows"), "{text}");
}

fn page_with(dir: &Path, body: &str) {
    std::fs::write(dir.join("index.html"), format!("<!doctype html><style>{STYLE}</style><h1>Seeds</h1><div class=\"thesis\">{body}</div>")).unwrap();
}

#[test]
fn an_unmarked_price_and_a_dead_action_fail() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("figures");
    let args = ["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"];
    // A price with no sample mark, and a link that goes nowhere.
    page_with(&dir, "<p>Poppy seeds, $4.50 a packet</p><a class=\"buy\" href=\"#\">Buy</a>");
    let text = String::from_utf8_lossy(&run(&dir, &args).stdout).to_string();
    assert!(text.contains("FAIL  figures: 1 in the first viewport with no sample mark beside them ($4.50)"), "{text}");
    assert!(text.contains("FAIL  primary action .buy: a link that goes nowhere"), "{text}");
    // A button nothing listens to.
    page_with(&dir, "<p>Poppy seeds, $4.50 a packet <small>sample price</small></p><button class=\"buy\">Buy</button>");
    let text = String::from_utf8_lossy(&run(&dir, &args).stdout).to_string();
    assert!(text.contains("ok    figures"), "{text}");
    assert!(text.contains("FAIL  primary action .buy: nothing happens when it is clicked"), "{text}");
    // Figures the user supplied, and a link to a real page.
    std::fs::write(dir.join("shop.html"), "<!doctype html><p>Shop</p>").unwrap();
    page_with(&dir, "<p>Poppy seeds, $4.50 a packet</p><a class=\"buy\" href=\"shop.html\">Buy</a>");
    let mut supplied = args.to_vec();
    supplied.push("--figures-supplied");
    let out = run(&dir, &supplied);
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    assert!(!text.contains("figures"), "{text}");
    assert!(text.contains("ok    primary action .buy: answers a click"), "{text}");
}

#[test]
fn capture_writes_the_review_files() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("capture");
    page_with(&dir, "<button class=\"buy\" onclick=\"this.textContent = 'Added'\">Buy</button>");
    let out = run(&dir, &["index.html", "--thesis", ".thesis", "--action", ".buy", "--capture", ".impeccable/review"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    for name in ["mobile.png", "desktop.png"] {
        let bytes = std::fs::read(dir.join(".impeccable/review").join(name)).unwrap();
        assert!(bytes.starts_with(b"\x89PNG"), "{name}");
    }
}

#[test]
fn hidden_or_unrelated_marks_and_background_motion_do_not_pass() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("strict");
    let args = ["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"];
    // A hidden "sample" and "for example" are no mark; a ticking clock does
    // not make an inert button live.
    page_with(
        &dir,
        "<p>Poppy seeds, $4.50 <span hidden>sample</span></p><p>Tomatoes, for example, $3.75</p>\
         <p class=\"clock\">0</p><button class=\"buy\">Buy</button>\
         <script>setInterval(() => { const c = document.querySelector('.clock'); c.textContent = +c.textContent + 1; }, 100);</script>",
    );
    let text = String::from_utf8_lossy(&run(&dir, &args).stdout).to_string();
    assert!(text.contains("FAIL  figures: 2 in the first viewport"), "{text}");
    assert!(text.contains("FAIL  primary action .buy: nothing happens when it is clicked"), "{text}");
    // A new-tab link and a button that only scrolls are live.
    page_with(&dir, "<a class=\"buy\" href=\"https://example.com/\" target=\"_blank\">Shop</a><div style=\"height: 3000px\"></div>");
    let text = String::from_utf8_lossy(&run(&dir, &args).stdout).to_string();
    assert!(text.contains("ok    primary action .buy: a link that goes somewhere"), "{text}");
    page_with(&dir, "<button class=\"buy\" onclick=\"window.scrollTo(0, 900)\">See the plates</button><div style=\"height: 3000px\"></div>");
    let text = String::from_utf8_lossy(&run(&dir, &args).stdout).to_string();
    assert!(text.contains("ok    primary action .buy: answers a click"), "{text}");
}

#[test]
fn an_extra_viewport_keeps_its_own_capture() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("names");
    page_with(&dir, "<button class=\"buy\" onclick=\"this.textContent = 'Added'\">Buy</button>");
    let out = run(
        &dir,
        &["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844", "--viewport", "640x900", "--capture", "shots"],
    );
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    assert!(dir.join("shots/mobile.png").is_file() && dir.join("shots/user-640.png").is_file());
}

#[test]
fn a_link_that_cancels_fails_and_late_or_busy_pages_still_answer() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("probe");
    let args = ["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"];
    page_with(&dir, "<a class=\"buy\" href=\"shop.html\" onclick=\"event.preventDefault()\">Buy</a>");
    let text = String::from_utf8_lossy(&run(&dir, &args).stdout).to_string();
    assert!(text.contains("FAIL  primary action .buy: nothing happens when it is clicked"), "{text}");
    // Cancelled through the Navigation API instead (#1500): still dead.
    page_with(
        &dir,
        "<a class=\"buy\" href=\"shop.html\">Buy</a>\
         <script>window.navigation && navigation.addEventListener('navigate', (e) => e.preventDefault());</script>",
    );
    let text = String::from_utf8_lossy(&run(&dir, &args).stdout).to_string();
    assert!(text.contains("FAIL  primary action .buy: nothing happens when it is clicked"), "{text}");
    // ...including by a listener the click itself adds.
    page_with(
        &dir,
        "<a class=\"buy\" href=\"shop.html\" onclick=\"window.navigation && navigation.addEventListener('navigate', (e) => e.preventDefault())\">Buy</a>",
    );
    let text = String::from_utf8_lossy(&run(&dir, &args).stdout).to_string();
    assert!(text.contains("FAIL  primary action .buy: nothing happens when it is clicked"), "{text}");
    // The app toggles a class on body all the time; the button's dialog
    // under body still counts.
    page_with(
        &dir,
        "<button class=\"buy\" onclick=\"document.body.append(Object.assign(document.createElement('dialog'), { open: true, textContent: 'Added' }))\">Buy</button>\
         <script>setInterval(() => document.body.classList.toggle('tick'), 100);</script>",
    );
    let text = String::from_utf8_lossy(&run(&dir, &args).stdout).to_string();
    assert!(text.contains("ok    primary action .buy: answers a click"), "{text}");
    // A button mounted a second after load is waited for, then clicked.
    std::fs::write(
        dir.join("index.html"),
        format!(
            "<!doctype html><style>{STYLE}</style><h1>Seeds</h1><div class=\"thesis\">Plates</div>\
             <script>setTimeout(() => {{ const b = document.createElement('button'); b.className = 'buy'; b.textContent = 'Buy'; \
             b.onclick = () => {{ b.textContent = 'Added'; }}; document.querySelector('.thesis').append(b); }}, 1000);</script>"
        ),
    )
    .unwrap();
    let text = String::from_utf8_lossy(&run(&dir, &args).stdout).to_string();
    assert!(text.contains("ok    primary action .buy: answers a click"), "{text}");
}

/// Serves "/" at once and "/slow" after three seconds, on a loopback port.
fn slow_server() -> u16 {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let body = if req.starts_with("GET /slow") {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    "<!doctype html><p>Shop</p>".to_string()
                } else {
                    format!("<!doctype html><style>{STYLE}</style><h1>Seeds</h1><div class=\"thesis\"><a class=\"buy\" href=\"/slow\">Shop</a></div>")
                };
                let _ = write!(stream, "HTTP/1.0 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            });
        }
    });
    port
}

#[test]
fn a_link_to_a_slow_page_answers_when_navigation_starts() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("slow");
    let url = format!("http://127.0.0.1:{}/", slow_server());
    let out = run(&dir, &[&url, "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("ok    primary action .buy: answers a click"), "{text}");
}

#[test]
fn a_fixed_action_escapes_a_clipping_wrapper_unless_one_holds_it() {
    // Catches (#1497): a position: fixed action at the viewport's edge, wholly visible,
    // failed because a narrow overflow: hidden wrapper it escapes was counted as clipping it.
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("fixed");
    let args = ["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844", "--figures-supplied"];
    let wrapped = |wrapper_style: &str| {
        page_with(
            &dir,
            &format!("<div style=\"margin-left: 50px; width: 120px; height: 100vh; overflow: hidden; {wrapper_style}\">\
             <a class=\"buy\" href=\"#buy\" style=\"position: fixed; left: 100px; top: 200px; width: 120px\">Buy seeds</a></div>"),
        );
        String::from_utf8_lossy(&run(&dir, &args).stdout).to_string()
    };
    let text = wrapped("");
    assert!(text.contains("ok    primary action .buy: wholly inside the first viewport"), "{text}");
    // A transformed wrapper holds fixed boxes, so it does clip it: the action's box stays
    // inside the viewport but runs past the wrapper's right edge.
    for held in ["transform: translateZ(0)", "translate: 0 0", "will-change: scale"] {
        let text = wrapped(held);
        assert!(text.contains("FAIL  primary action .buy: not wholly inside"), "{held}: {text}");
    }
    // Holding it without clipping changes nothing.
    let text = wrapped("transform: translateZ(0); overflow: visible");
    assert!(text.contains("ok    primary action .buy: wholly inside the first viewport"), "{text}");
}
