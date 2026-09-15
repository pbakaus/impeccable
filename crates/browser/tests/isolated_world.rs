use impeccable_browser::{cdp::Browser, discovery};
use std::time::Duration;

#[test]
fn isolated_world_keeps_page_prototypes_and_globals_separate_and_rejects_navigation() {
    let env = std::env::vars().collect();
    let Ok(exe) = discovery::find_browser(&env) else {
        eprintln!("skip: no browser");
        return;
    };
    let mut browser = Browser::launch(&exe, &[], false).unwrap();
    let mut page = browser.new_page().unwrap();
    page.goto("data:text/html,<div id='target' style='position:absolute;left:20px;top:20px;width:80px;height:80px'></div>","load",Duration::from_secs(15)).unwrap();
    page.evaluate_value(
        "Element.prototype.getBoundingClientRect=function(){return new DOMRect(999,999,1,1)};true",
    )
    .unwrap();
    let world = page.create_isolated_world().unwrap();
    assert_eq!(
        page.evaluate_value("document.querySelector('#target').getBoundingClientRect().x")
            .unwrap(),
        999
    );
    assert_eq!(
        page.evaluate_value_in_world(
            &world,
            "document.querySelector('#target').getBoundingClientRect().x"
        )
        .unwrap(),
        20
    );
    page.evaluate_value_in_world(&world, "globalThis.__capture_secret=42;true")
        .unwrap();
    assert_eq!(
        page.evaluate_value("typeof globalThis.__capture_secret")
            .unwrap(),
        "undefined"
    );
    page.goto("about:blank", "load", Duration::from_secs(15))
        .unwrap();
    assert!(
        page.evaluate_value_in_world(&world, "true").is_err(),
        "old world must not follow navigation"
    );
    let next = page.create_isolated_world().unwrap();
    assert!(page.evaluate_value_in_world(&next,"setTimeout(()=>location.href='about:blank',0);new Promise(r=>setTimeout(()=>r(true),100))").is_err(),"navigation while awaiting must not return successful evidence");
    page.close();
    browser.close();
}
