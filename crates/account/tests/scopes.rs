//! Feature scopes compose and stay attached to the original grant.
mod support;
use impeccable_account::{config::Account, http::ApiError, login, session::Session};
use serde_json::json;
use std::time::Duration;
use support::fake::{browser, Fake};

#[test]
fn every_offered_scope_combination_survives_refresh() {
    for mask in 0..32 {
        let fake = Fake::start();
        let mut expected = vec!["account:read", "rules:read"];
        {
            let mut k = fake.knobs.lock().unwrap();
            k.health = mask & 1 != 0;
            k.setup = mask & 2 != 0;
            k.foundations = mask & 4 != 0;
            k.design = mask & 8 != 0;
            k.critiques = mask & 16 != 0;
            for (offered, scope) in [
                (k.health, "health:write"),
                (k.setup, "setup:write"),
                (k.foundations, "foundations:write"),
                (k.design, "design:write"),
                (k.critiques, "critiques:write"),
            ] {
                if offered {
                    expected.push(scope);
                }
            }
        }
        let env = fake.env(&format!("combined-scopes-{mask}"));
        login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
        assert_eq!(fake.record.lock().unwrap().scopes, [expected.join(" ")]);
        let account = Account::from_env(&env).unwrap();
        let mut session = Session::load(&account).unwrap();
        assert_eq!(session.state.foundations, mask & 4 != 0);
        session.refresh().unwrap();
        assert_eq!(session.state.foundations, mask & 4 != 0);
        // Enabling a route after consent must not grant it to an old token.
        {
            let mut k = fake.knobs.lock().unwrap();
            k.health = true;
            k.setup = true;
            k.foundations = true;
            k.design = true;
            k.critiques = true;
        }
        let token = session.access_token().unwrap();
        for (bit, path, body) in [
            (1, "/cli/v1/health/forget", json!({})),
            (2, "/cli/v1/setup/forget", json!({})),
            (16, "/cli/v1/critiques/forget", json!({})),
            (8, "/cli/v1/design", json!({
                "version": 1, "uploadId": "0".repeat(36), "repoKey": "0".repeat(64),
                "changedAt": "2026-11-10T00:00:00.000Z", "text": "Design", "sidecar": null,
            })),
            (
                4,
                "/cli/v1/foundations",
                json!({
                    "version": 1, "scanId": "0".repeat(36), "repoKey": "0".repeat(64),
                    "scannedAt": "2026-11-10T00:00:00Z", "productType": null, "items": {},
                }),
            ),
        ] {
            let result = session
                .client
                .post_json(&format!("{}{path}", fake.url), &token, body);
            if mask & bit != 0 {
                assert!(result.is_ok(), "mask {mask}, {path}");
            } else {
                assert!(
                    matches!(result, Err(ApiError::Status { status: 403, .. })),
                    "mask {mask}, {path}"
                );
            }
        }
    }
}

#[test]
fn omitted_scope_keeps_login_grants_and_refresh_features() {
    for mask in 0..32 {
        let fake = Fake::start();
        let mut expected = vec!["account:read", "rules:read"];
        {
            let mut k = fake.knobs.lock().unwrap();
            k.omit_token_scope = true;
            k.health = mask & 1 != 0;
            k.setup = mask & 2 != 0;
            k.foundations = mask & 4 != 0;
            k.design = mask & 8 != 0;
            k.critiques = mask & 16 != 0;
            for (offered, scope) in [
                (k.health, "health:write"),
                (k.setup, "setup:write"),
                (k.foundations, "foundations:write"),
                (k.design, "design:write"),
                (k.critiques, "critiques:write"),
            ] {
                if offered {
                    expected.push(scope);
                }
            }
        }
        let env = fake.env(&format!("omitted-scopes-{mask}"));
        login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
        let account = Account::from_env(&env).unwrap();
        let mut session = Session::load(&account).unwrap();
        assert_eq!(session.state.scopes, expected);
        assert_eq!(session.state.foundations, mask & 4 != 0);
        let grant: serde_json::Value =
            serde_json::from_slice(&std::fs::read(account.dir().join("setup-grant.json")).unwrap())
                .unwrap();
        assert_eq!(grant["allowed"], mask & 2 != 0);
        // Metadata changes must not enlarge an existing grant on refresh.
        {
            let mut k = fake.knobs.lock().unwrap();
            k.health = true;
            k.setup = true;
            k.foundations = true;
            k.design = true;
            k.critiques = true;
        }
        session.refresh().unwrap();
        assert_eq!(session.state.scopes, expected);
        assert_eq!(session.state.foundations, mask & 4 != 0);
    }
}

#[test]
fn sign_in_asks_for_worlds_read_only_where_it_is_offered() {
    // Catches: `impeccable world` 403ing for every fresh sign-in because login
    // never asked for the scope the seed route checks.
    for offered in [false, true] {
        let fake = Fake::start();
        fake.knobs.lock().unwrap().worlds = offered;
        let env = fake.env(&format!("worlds-scope-{offered}"));
        login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
        let asked = fake.record.lock().unwrap().scopes.join(" ");
        assert_eq!(asked.split(' ').any(|s| s == "worlds:read"), offered, "{asked}");
    }
}
