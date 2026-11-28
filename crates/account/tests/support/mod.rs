pub mod fake;

/// The person's yes to every upload kind (REN-2530), as `impeccable uploads on all` at their terminal saves it.
#[allow(dead_code)]
pub fn consent(env: &std::collections::HashMap<String, String>) {
    let account = impeccable_account::config::Account::from_env(env).unwrap();
    impeccable_account::uploads::seed(&account, &impeccable_account::uploads::Kind::ALL);
}
