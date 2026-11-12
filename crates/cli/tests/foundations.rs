//! `impeccable foundations --json` on small projects built in temp dirs:
//! each check's pass and fail, and what an empty folder reports.
use serde_json::Value;
use std::path::Path;
use std::process::{Command, Stdio};

fn foundations(dir: &Path) -> Value {
    let home = dir.parent().unwrap().join(format!(
        "{}-home",
        dir.file_name().unwrap().to_string_lossy()
    ));
    std::fs::create_dir_all(&home).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_impeccable"))
        .args(["foundations", "--json"])
        .current_dir(dir)
        .env_clear()
        .envs(
            ["PATH", "SystemRoot", "TEMP", "TMP"]
                .iter()
                .filter_map(|k| std::env::var(k).ok().map(|v| (*k, v))),
        )
        .env("IMPECCABLE_HOME", &home)
        .env("HOME", &home)
        .env("CI", "1")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&home);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

fn git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.email=t@example.com", "-c", "user.name=t"])
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap()
        .success();
    assert!(ok, "git {args:?}");
}

const NESTED_CARDS: &str = include_str!("../../../tests/fixtures/antipatterns/nested-cards.html");
const WORKFLOW_TESTS: &str = "on:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npm test\n";
const WORKFLOW_BUILD: &str =
    "on: [push]\njobs:\n  build:\n    steps:\n      - run: npm run build\n";
const REACT: &str = r#"{"dependencies":{"react":"19.0.0"},"scripts":{"dev":"vite"}}"#;
const NEXT: &str = r#"{"dependencies":{"next":"15.0.0","react":"19.0.0"}}"#;
const SVELTEKIT: &str = r#"{"devDependencies":{"@sveltejs/kit":"2.0.0"}}"#;

#[test]
fn each_check_passes_and_fails_on_its_own_evidence() {
    // Catches: a check that misses its pass evidence, passes without it, or
    // claims an item it can't judge (an unknown framework, a non-web project).
    let stripe = format!("sk_{}_{}", "live", "4eC39HqLyjWDarjtT1zdp7dcAbCdEf12");
    let pem_body = "MIIEpAIBAAKCAQEA3Tz2mr7SZiAMfQyuvBjM9Oi4eFkE1JZhqrJr7Lw0xQ9vQb8Z\n".repeat(3);
    let github = format!("ghp_{}", "R8x2Kq9LmZ4vT7wN1pB6sD3fH5jY0cE2gA8u");
    let big: String = (0..1_200)
        .map(|i| format!("export const v{i} = {i};\n"))
        .collect();
    let many_hex: String = (0..25)
        .map(|i| format!(".c{i} {{ color: #{:06x}; }}\n", i * 4097))
        .collect();
    #[rustfmt::skip]
    let cases: Vec<(&str, Vec<(&str, String)>, bool, &str, Option<&str>)> = vec![
        ("review 1 pnpm -r test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: pnpm -r test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 pnpm --filter web test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: pnpm --filter web test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 yarn workspaces foreach -A run test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: yarn workspaces foreach -A run test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 node --test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: node --test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 make test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: make test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 make check", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: make check\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 just test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: just test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 turbo run test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: turbo run test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 nx test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: nx test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 nx run-many -t test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: nx run-many -t test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 deno test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: deno test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 tox", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: tox\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 nox", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: nox\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 mvn test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: mvn test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 mvn verify", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: mvn verify\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 gradle test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: gradle test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 gradle check", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: gradle check\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 dotnet test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: dotnet test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 swift test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: swift test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 mix test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: mix test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 phpunit", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: phpunit\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 rspec", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: rspec\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 bundle exec rake test", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: bundle exec rake test\n".into())], false, "ci-runs-tests", Some("checked")),
        ("review 1 unknown command", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: ./scripts/verify\n".into())], false, "ci-runs-tests", None),
        ("review 1 setup only", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n".into())], false, "ci-runs-tests", Some("failing")),
        ("review 2 public/icons", vec![("index.html", "<h1>Site</h1>".into()), ("public/icons/favicon.svg", "x".into()), ("public/icons/icon-192.png", "x".into())], false, "app-icons", Some("checked")),
        ("review 2 static/icons", vec![("index.html", "<h1>Site</h1>".into()), ("static/icons/favicon.svg", "x".into()), ("static/icons/icon-192.png", "x".into())], false, "app-icons", Some("checked")),
        ("review 2 public/images", vec![("index.html", "<h1>Site</h1>".into()), ("public/images/favicon.svg", "x".into()), ("public/images/icon-192.png", "x".into())], false, "app-icons", Some("checked")),
        ("review 2 linked icons anywhere", vec![("index.html", "<link rel=\"icon\" href=\"/brand/tab.svg\"><link rel=\"apple-touch-icon\" href=\"/brand/touch.png\">".into()), ("brand/tab.svg", "x".into()), ("brand/touch.png", "x".into())], false, "app-icons", Some("checked")),
        ("review 2 manifest anywhere", vec![("index.html", "<link rel=\"icon\" href=\"/brand/tab.svg\"><link rel=\"manifest\" href=\"/brand/app.webmanifest\">".into()), ("brand/tab.svg", "x".into()), ("brand/app.webmanifest", "{\"icons\":[{\"src\":\"touch.png\",\"sizes\":\"192x192\"}]}".into()), ("brand/touch.png", "x".into())], false, "app-icons", Some("checked")),
        ("review 3 nuxt", vec![("index.html", "<h1>Site</h1>".into()), ("src/App.vue", "useSeoMeta({ ogImage: '/og.png' })".into())], false, "social-previews", Some("checked")),
        ("review 3 nuxt head", vec![("index.html", "<h1>Site</h1>".into()), ("src/App.vue", "useHead({ meta: [{ property: 'og:image', content: '/og.png' }] })".into())], false, "social-previews", Some("checked")),
        ("review 3 svelte", vec![("index.html", "<h1>Site</h1>".into()), ("src/App.svelte", "<svelte:head><meta property=\"og:image\" content=\"/og.png\"></svelte:head>".into())], false, "social-previews", Some("checked")),
        ("review 3 astro", vec![("index.html", "<h1>Site</h1>".into()), ("src/Layout.astro", "<meta property=\"og:image\" content=\"/og.png\">".into())], false, "social-previews", Some("checked")),
        ("review 3 next", vec![("index.html", "<h1>Site</h1>".into()), ("src/page.tsx", "export function generateMetadata() { return { openGraph: { images: ['/og.png'] } }; }".into())], false, "social-previews", Some("checked")),
        ("review 4 entities", vec![("src/App.tsx", "<p>&#039; &#160;</p>\n".repeat(25))], false, "design-tokens", None),
        ("review 5 npm", vec![("package.json", "{\"main\":\"index.js\"}".into())], false, "infrastructure-as-code", None),
        ("review 5 crate", vec![("Cargo.toml", "[package]\nname=\"lib\"\n".into())], false, "infrastructure-as-code", None),
        ("review 5 gem", vec![("x.gemspec", "Gem::Specification.new {}".into())], false, "infrastructure-as-code", None),
        ("review 5 pypi", vec![("pyproject.toml", "[project]\nname=\"lib\"\n".into())], false, "infrastructure-as-code", None),
        ("review 6 card only", vec![("index.html", "<meta name=\"twitter:card\" content=\"summary_large_image\">".into())], false, "social-previews", Some("failing")),
        ("review 6 comments", vec![("index.html", "<!-- <meta property=\"og:image\" content=\"/og.png\"> -->".into()), ("src/meta.ts", "/* openGraph: { images: ['/og.png'] } */\n// og:image\n".into())], false, "social-previews", Some("failing")),
        ("review 7 commented guard", vec![("src/App.tsx", "// prefers-reduced-motion\n/* prefers-reduced-motion */\nexport const A = () => <div className=\"animate-spin\"/>;".into())], false, "reduced-motion", Some("failing")),
        ("review 7 waapi", vec![("src/App.svelte", "element.animate([{opacity:0}, {opacity:1}]);".into())], false, "reduced-motion", Some("failing")),
        ("review 7 svelte in", vec![("src/App.svelte", "<div in:fly/>".into())], false, "reduced-motion", Some("failing")),
        ("review 7 svelte out", vec![("src/App.svelte", "<div out:fade/>".into())], false, "reduced-motion", Some("failing")),
        ("review 7 svelte transition", vec![("src/App.svelte", "<div transition:slide/>".into())], false, "reduced-motion", Some("failing")),
        ("review 7 motion", vec![("src/App.svelte", "<motion.div animate={{x:10}}/>".into())], false, "reduced-motion", Some("failing")),
        ("review 7 tailwind", vec![("src/App.svelte", "<div class=\"animate-wiggle\"/>".into())], false, "reduced-motion", Some("failing")),
        ("review 8 third party", vec![("a.css", ":root { --swiper-color:#123; --tw-color:#456; --bs-color:#789; --mdc-color:#abc; }".into())], false, "design-tokens", None),
        ("review 8 project colours", vec![("a.css", ":root { --brand:#123; --surface:#456; --ink:#789; }\na { color: var(--ink); background: var(--surface); }\n".into())], false, "design-tokens", Some("checked")),
        ("review 9 commented step", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n      # - run: npm test\n".into())], false, "ci-runs-tests", Some("failing")),
        ("review 10 bootstrap", vec![("README.md", "Bootstrapped with `npx create-next-app`.".into())], false, "readme-runs", Some("failing")),
        ("review 10 prose", vec![("README.md", "Please npm install then npm run dev.".into()), ("package.json", "{\"scripts\":{\"dev\":\"vite\"}}".into())], false, "readme-runs", Some("failing")),
        ("review 10 spans", vec![("README.md", "Install with `npm install`, then `npm run dev`.".into()), ("package.json", "{\"scripts\":{\"dev\":\"vite\"}}".into())], false, "readme-runs", Some("checked")),
        ("review 11 source icon", vec![("index.html", "<h1>Site</h1>".into()), ("src/Icon.tsx", "export const Icon = () => <svg/>;".into()), ("public/apple-touch-icon.png", "x".into())], false, "app-icons", Some("failing")),
        ("linked public URL images", vec![("index.html", "<link rel='icon' href='/brand/tab.svg'><link rel='apple-touch-icon' href='/brand/home.png'>".into()), ("public/brand/tab.svg", "x".into()), ("public/brand/home.png", "x".into())], false, "app-icons", Some("checked")),
        ("readme npx runner", vec![("README.md", "Run `npx vite`.".into())], false, "readme-runs", Some("checked")),
        ("CI echo is not tests", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  test:\n    steps:\n      - run: echo npm test\n".into())], false, "ci-runs-tests", Some("failing")),
        ("CI recognised non-test steps", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  ci:\n    steps:\n      - run: npm ci\n      - run: npm run build\n      - run: npm run lint\n      - run: npm run format\n      - run: npm run typecheck\n      - run: npm run deploy\n      - run: echo done\n".into())], false, "ci-runs-tests", Some("failing")),
        ("CI unknown script among known commands", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  ci:\n    steps:\n      - run: npm ci\n      - run: ./scripts/ci.sh\n      - run: npm run build\n".into())], false, "ci-runs-tests", None),
        ("CI unknown make task", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  ci:\n    steps:\n      - run: make ci\n".into())], false, "ci-runs-tests", None),
        ("CI unknown task runner", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  ci:\n    steps:\n      - run: task all\n".into())], false, "ci-runs-tests", None),
        ("CI unknown binary", vec![(".github/workflows/ci.yml", "on: [push]\njobs:\n  ci:\n    steps:\n      - run: custom-ci\n".into())], false, "ci-runs-tests", None),
        ("project colour defined and used", vec![("a.css", ":root { --brand:#123; } a { color:var(--brand); }".into())], false, "design-tokens", Some("checked")),
        ("project colour unused", vec![("a.css", ":root { --brand:#123; }".into())], false, "design-tokens", None),
        ("third-party colours used", vec![("a.css", ":root { --swiper-color:#123; --tw-color:#456; --bs-color:#789; --mdc-color:#abc; } a { color:var(--swiper-color); background:var(--tw-color); border-color:var(--bs-color); outline-color:var(--mdc-color); }".into())], false, "design-tokens", None),
        ("project colour used in another file", vec![("a.css", ":root { --brand:#123; }".into()), ("b.css", "a { color:var( --brand , #fff); }".into())], false, "design-tokens", Some("checked")),
        ("project colour used only in comment", vec![("a.css", ":root { --brand:#123; } /* color:var(--brand); */".into())], false, "design-tokens", None),
        ("ci pass", vec![("package.json", REACT.into()), (".github/workflows/ci.yml", WORKFLOW_TESTS.into())], false, "ci-runs-tests", Some("checked")),
        ("ci no tests", vec![("package.json", REACT.into()), (".github/workflows/ci.yml", WORKFLOW_BUILD.into())], false, "ci-runs-tests", Some("failing")),
        ("dependabot", vec![("package.json", REACT.into()), (".github/dependabot.yml", "version: 2\n".into())], false, "dependency-scanning", Some("checked")),
        ("no dependabot", vec![("package.json", REACT.into())], false, "dependency-scanning", Some("failing")),
        ("no manifest", vec![("README.md", "# Notes\n".into())], false, "dependency-scanning", None),
        ("icons", vec![("package.json", NEXT.into()), ("app/favicon.ico", "x".into()), ("app/apple-icon.png", "x".into())], false, "app-icons", Some("checked")),
        ("screenshot is no icon", vec![("package.json", NEXT.into()), ("app/favicon.ico", "x".into()), ("public/screenshot-1920x1080.png", "x".into())], false, "app-icons", Some("failing")),
        ("component names are no legal pages", vec![("package.json", NEXT.into()), ("app/page.tsx", "x\n".into()), ("components/PrivacyToggle.tsx", "x\n".into()), ("lib/terms.ts", "x\n".into())], false, "legal-pages", Some("failing")),
        ("nested app is judged in its own folder", vec![("package.json", "{}".into()), ("apps/web/package.json", NEXT.into())], false, "not-found-page", None),
        ("page read by the html engine", vec![("index.html", "<!doctype html><html><body><p>Hello</p></body></html>".into())], false, "readable-contrast", Some("checked")),
        ("component read by regex only", vec![("index.html", "<!doctype html><html><body><div id=root></div></body></html>".into()), ("src/App.tsx", "export const App = () => <p>Hello</p>;\n".into())], false, "readable-contrast", None),
        ("favicon only", vec![("package.json", NEXT.into()), ("app/favicon.ico", "x".into())], false, "app-icons", Some("failing")),
        ("next icon routes drawn in code", vec![("package.json", NEXT.into()), ("app/icon.tsx", "export default function Icon() {}\n".into()), ("app/apple-icon.tsx", "export default function Icon() {}\n".into())], false, "app-icons", Some("checked")),
        ("a sized logo png is a large icon", vec![("package.json", REACT.into()), ("index.html", "<link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg/%3E\"><div id=root></div>\n".into()), ("public/pwa-512x512.png", "x".into())], false, "app-icons", Some("checked")),
        ("an inline favicon alone is no large icon", vec![("package.json", REACT.into()), ("index.html", "<link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg/%3E\"><div id=root></div>\n".into())], false, "app-icons", Some("failing")),
        ("not web", vec![("Cargo.toml", "[package]\nname = \"x\"\n".into()), ("src/main.rs", "fn main() {}\n".into())], false, "app-icons", None),
        ("next 404", vec![("package.json", NEXT.into()), ("app/not-found.tsx", "export default function N() {}\n".into())], false, "not-found-page", Some("checked")),
        ("sveltekit no error page", vec![("package.json", SVELTEKIT.into()), ("src/routes/+page.svelte", "<h1>Hi</h1>\n".into())], false, "not-found-page", Some("failing")),
        ("og image", vec![("index.html", "<meta property=\"og:image\" content=\"/og.png\">\n".into())], false, "social-previews", Some("checked")),
        ("no og image", vec![("index.html", "<title>Hi</title>\n".into())], false, "social-previews", Some("failing")),
        ("legal", vec![("package.json", NEXT.into()), ("app/privacy/page.tsx", "x\n".into()), ("app/terms/page.tsx", "x\n".into())], false, "legal-pages", Some("checked")),
        ("privacy only", vec![("package.json", NEXT.into()), ("app/privacy/page.tsx", "x\n".into())], false, "legal-pages", Some("failing")),
        ("motion guarded", vec![("a.css", "a { transition: color 1s; }\n@media (prefers-reduced-motion: reduce) { a { transition: none; } }\n".into())], false, "reduced-motion", Some("checked")),
        ("tailwind transition unguarded", vec![("package.json", REACT.into()), ("src/Card.tsx", "export const C = () => <div className=\"hover:scale-110 transition-transform\" />;\n".into())], false, "reduced-motion", Some("failing")),
        ("vue views legal pages", vec![("package.json", r#"{"dependencies":{"vue":"3.5.0"}}"#.into()), ("index.html", "<div id=app></div>\n".into()), ("src/views/Privacy.vue", "<template><h1>Privacy</h1></template>\n".into()), ("src/views/Terms.vue", "<template><h1>Terms</h1></template>\n".into())], false, "legal-pages", Some("checked")),
        ("key past the read cap", vec![("src/data.ts", format!("{}export const key = \"{stripe}\";\n", "// padding\n".repeat(60_000)))], true, "secrets-out-of-repo", Some("failing")),
        ("js component read by regex only", vec![("index.html", "<!doctype html><html><body><div id=root></div></body></html>".into()), ("src/App.js", "export const App = () => <p>Hello</p>;\n".into())], false, "readable-contrast", None),
        ("tailwind variant transition unguarded", vec![("package.json", REACT.into()), ("src/Card.tsx", "export const C = () => (\n  <div\n    className=\"p-4\n      hover:transition-transform\"\n  />\n);\n".into())], false, "reduced-motion", Some("failing")),
        ("readme script only in a nested app", vec![("package.json", "{}".into()), ("apps/web/package.json", REACT.into()), ("README.md", "```\nnpm install\nnpm run dev\n```\n".into())], false, "readme-runs", Some("failing")),
        ("the word transition in copy", vec![("package.json", REACT.into()), ("src/About.tsx", "const transition = 1;\nexport const A = () => <p className=\"text-lg\">We help teams transition to new tools.</p>;\n".into())], false, "reduced-motion", Some("checked")),
        ("transition in a shared class string", vec![("package.json", REACT.into()), ("src/Card.tsx", "const card = \"hover:scale-110 transition duration-200\";\nexport const C = () => <div className={cn(card, { [`${x}`]: y })} />;\n".into())], false, "reduced-motion", Some("failing")),
        ("arbitrary variant transition", vec![("package.json", REACT.into()), ("src/Menu.tsx", "export const M = () => <div className=\"data-[state=open]:transition-all\" />;\n".into())], false, "reduced-motion", Some("failing")),
        ("bare transition after a template interpolation", vec![("package.json", REACT.into()), ("src/Tab.tsx", "export const T = ({ x }) => <div className={`p-4 ${x} transition`} disabled />;\n".into())], false, "reduced-motion", Some("failing")),
        ("transition after an @-utility and an interpolation", vec![("package.json", REACT.into()), ("src/Box.tsx", "export const B = ({ x }) => <div className={`@container ${x} transition`} />;\n".into())], false, "reduced-motion", Some("failing")),
        ("a PEM header alone", vec![("src/auth.ts", "// expects -----BEGIN RSA PRIVATE KEY-----\nconst ok = pem.includes('-----BEGIN RSA PRIVATE KEY-----');\n".into())], true, "secrets-out-of-repo", Some("checked")),
        ("a PEM key with its body", vec![("deploy/key.pem", format!("-----BEGIN RSA PRIVATE KEY-----\n{}\n-----END RSA PRIVATE KEY-----\n", pem_body))], true, "secrets-out-of-repo", Some("failing")),
        ("placeholder keys in a redaction test", vec![("test/redact.spec.ts", "redact(\"AKIAABCDEFGHIJKLMNOP\");\nredact(\"ghp_abcdefghijklmnopqrstuvwxyz0123456789\");\n".into())], true, "secrets-out-of-repo", Some("checked")),
        ("a realistic key in a test file", vec![("test/redact.spec.ts", format!("redact(\"{github}\");\n"))], true, "secrets-out-of-repo", Some("failing")),
        ("public names in a tracked env file", vec![(".env.production", "PUBLIC_POSTHOG_PROJECT_TOKEN=phc_123\nPUBLIC_POSTHOG_HOST=https://eu.posthog.com\n".into())], true, "secrets-out-of-repo", Some("checked")),
        ("a password in a tracked env file", vec![(".env.production", "APP_NAME=shop\nDATABASE_PASSWORD=hunter2\n".into())], true, "secrets-out-of-repo", Some("failing")),
        ("a tracked env example", vec![(".env.example", "STRIPE_SECRET_KEY=\nDATABASE_URL=postgres://user:password@localhost/db\n".into())], true, "secrets-out-of-repo", Some("checked")),
        ("astro srcDir icons", vec![("package.json", r#"{"devDependencies":{"astro":"5.0.0"}}"#.into()), ("astro.config.mjs", "export default defineConfig({ srcDir: './site', publicDir: './site/public' });\n".into()), ("site/public/favicon.svg", "x".into()), ("site/public/apple-touch-icon.png", "x".into())], false, "app-icons", Some("checked")),
        ("app one folder down", vec![("package.json", "{}".into()), ("web/package.json", NEXT.into()), ("web/next.config.js", "module.exports = {};\n".into()), ("web/app/not-found.tsx", "export default function N() {}\n".into())], false, "not-found-page", Some("checked")),
        ("unrecognised web layout", vec![("package.json", NEXT.into()), ("lib/site.ts", "export {};\n".into())], false, "app-icons", None),
        ("slop markup in components only", vec![("src/App.tsx", NESTED_CARDS.into()), ("src/app.css", ".card { padding: 1rem; }\n".into())], false, "no-generic-ai-patterns", None),
        ("tailwind from a CDN", vec![("index.html", "<!doctype html><html><head><script src=\"https://cdn.tailwindcss.com\"></script></head><body class=\"bg-white\"><p class=\"text-gray-200\">Faint</p></body></html>".into())], false, "readable-contrast", None),
        ("styles from a remote stylesheet", vec![("index.html", "<!doctype html><html><head><link rel=\"stylesheet\" href=\"https://example.com/site.css\"></head><body><p class=\"faint\">Faint</p></body></html>".into())], false, "readable-contrast", None),
        ("a suppressed contrast finding", vec![("index.html", "<!doctype html><html><body><!-- impeccable-disable low-contrast --><p style=\"color:#bbb;background:#fff\">Faint</p></body></html>".into())], false, "readable-contrast", None),
        ("a vite library", vec![("package.json", r#"{"devDependencies":{"vite":"6.0.0"}}"#.into()), ("vite.config.ts", "export default {};\n".into()), ("src/index.ts", "export const x = 1;\n".into())], false, "app-icons", None),
        ("an expo app is not a site", vec![("package.json", r#"{"dependencies":{"expo":"52.0.0","react-native":"0.76.0","expo-router":"4.0.0"}}"#.into()), ("app.json", "{\"expo\":{}}\n".into()), ("app/index.tsx", "export default function I() {}\n".into())], false, "app-icons", None),
        ("app.json is no infrastructure", vec![("package.json", r#"{"dependencies":{"expo":"52.0.0","react-native":"0.76.0"}}"#.into()), ("app.json", "{\"expo\":{}}\n".into())], false, "infrastructure-as-code", Some("failing")),
        ("laravel 404 view", vec![("composer.json", r#"{"require":{"laravel/framework":"^11.0"}}"#.into()), ("package.json", r#"{"devDependencies":{"vite":"6.0.0","laravel-vite-plugin":"1.0.0"}}"#.into()), ("resources/views/errors/404.blade.php", "<h1>Not found</h1>\n".into()), ("resources/views/welcome.blade.php", "<h1>Hi</h1>\n".into())], false, "not-found-page", Some("checked")),
        ("a public env file", vec![(".env.production", "NEXT_PUBLIC_SITE_URL=https://example.com\n".into())], true, "secrets-out-of-repo", Some("checked")),
        ("the AWS documentation key", vec![("README.md", "Set `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE`.\n".into())], true, "secrets-out-of-repo", Some("checked")),
        ("a quoted brace in a class value", vec![("package.json", REACT.into()), ("src/Quote.tsx", "export const Q = () => <q className={\"after:content-['}'] transition\"} />;\n".into())], false, "reduced-motion", Some("failing")),
        ("an openssh private key", vec![("deploy/id_ed25519", format!("-----BEGIN OPENSSH PRIVATE {}-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n{}-----END OPENSSH PRIVATE KEY-----\n", "KEY", pem_body))], true, "secrets-out-of-repo", Some("failing")),
        ("astro leftovers in the default public folder", vec![("package.json", r#"{"devDependencies":{"astro":"5.0.0"}}"#.into()), ("astro.config.mjs", "export default defineConfig({ publicDir: './static' });\n".into()), ("public/favicon.svg", "x".into()), ("public/apple-touch-icon.png", "x".into()), ("static/robots.txt", "x".into()), ("src/pages/index.astro", "<h1>Hi</h1>\n".into())], false, "app-icons", Some("failing")),
        ("a canonical link is no outside style", vec![("index.html", "<!doctype html><html><head><link rel=\"canonical\" href=\"https://example.com/\"></head><body><p>Hello</p></body></html>".into())], false, "readable-contrast", Some("checked")),
        ("a suppressed finding in a scanned test page", vec![("index.html", "<!doctype html><html><body><p>Hello</p></body></html>".into()), ("tests/page.html", "<!doctype html><html><body><!-- impeccable-disable low-contrast --><p style=\"color:#bbb;background:#fff\">Hi</p></body></html>".into())], false, "readable-contrast", None),
        ("an escaped quote and a comment in a class value", vec![("package.json", REACT.into()), ("src/Esc.tsx", "export const E = () => <q className={cn(\"before:content-['\\\\'']\", /* it's */ \"transition\")} />;\n".into())], false, "reduced-motion", Some("failing")),
        ("a URL inside a template class value", vec![("package.json", REACT.into()), ("src/Bg.tsx", "export const B = ({ x }) => <div className={`bg-[url(https://example.com/bg.png)] ${x}`}><p>We help teams transition to new tools.</p></div>;\n".into())], false, "reduced-motion", Some("checked")),
        ("motion unguarded", vec![("a.css", "a { transition: color 1s; }\n".into())], false, "reduced-motion", Some("failing")),
        ("tokens", vec![("a.css", ":root { --brand: #3355ff; }\na { color: var(--brand); }\n".into())], false, "design-tokens", Some("checked")),
        ("hard-coded colors", vec![("a.css", many_hex)], false, "design-tokens", Some("failing")),
        ("tracked key", vec![("src/config.ts", format!("export const key = \"{stripe}\";\n"))], true, "secrets-out-of-repo", Some("failing")),
        ("tracked env", vec![(".env", "TOKEN=1\n".into()), (".env.example", "TOKEN=\n".into())], true, "secrets-out-of-repo", Some("failing")),
        ("clean repo", vec![(".env.example", "TOKEN=\n".into()), ("src/a.ts", "export {};\n".into())], true, "secrets-out-of-repo", Some("checked")),
        ("sentry", vec![("index.html", "<div id=root></div>\n".into()), ("package.json", r#"{"dependencies":{"react":"19.0.0","@sentry/react":"9.0.0"}}"#.into())], false, "error-tracking", Some("checked")),
        ("no sentry", vec![("index.html", "<div id=root></div>\n".into()), ("package.json", REACT.into())], false, "error-tracking", Some("failing")),
        ("wrangler", vec![("wrangler.toml", "name = \"x\"\n".into())], false, "infrastructure-as-code", Some("checked")),
        ("no iac", vec![("package.json", REACT.into())], false, "infrastructure-as-code", Some("failing")),
        ("readme runs", vec![("package.json", REACT.into()), ("README.md", "```\nnpm install\nnpm run dev\n```\n".into())], false, "readme-runs", Some("checked")),
        ("readme with an indented code block", vec![("package.json", REACT.into()), ("README.md", "# App\n\nRun it:\n\n    npm install\n    npm run dev\n".into())], false, "readme-runs", Some("checked")),
        ("gitlab inline script list", vec![("package.json", REACT.into()), (".gitlab-ci.yml", "test:\n  script: [npm ci, npm test]\n".into())], false, "ci-runs-tests", Some("checked")),
        ("a palette of unused tokens is not hard-coded colour", vec![("a.css", format!(":root {{\n{}}}\n", (0..24).map(|i| format!("  --c{i}: #{:06x};\n", i * 4369)).collect::<String>()))], false, "design-tokens", None),
        ("readme names a missing script", vec![("package.json", REACT.into()), ("README.md", "```\nnpm install\nnpm run start:prod\n```\n".into())], false, "readme-runs", Some("failing")),
        ("giant file", vec![("src/big.ts", big.clone())], false, "no-giant-files", Some("failing")),
        ("giant fixture", vec![("tests/fixtures/big.ts", big), ("src/a.ts", "export {};\n".into())], false, "no-giant-files", Some("checked")),
        ("down migration", vec![("db/migrations/001_users.up.sql", "create table u();\n".into()), ("db/migrations/001_users.down.sql", "drop table u;\n".into())], false, "reversible-migrations", Some("checked")),
        ("no down migration", vec![("db/migrations/001_users.up.sql", "create table u();\n".into())], false, "reversible-migrations", Some("failing")),
        ("prisma", vec![("prisma/migrations/1_init/migration.sql", "create table u();\n".into())], false, "reversible-migrations", None),
    ];
    let tmp = std::env::temp_dir().join(format!("impeccable-foundations-{}", std::process::id()));
    let mut failures = Vec::new();
    for (i, (name, files, tracked, id, want)) in cases.iter().enumerate() {
        let dir = tmp.join(format!("case-{i}"));
        for (path, body) in files {
            let p = dir.join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        if *tracked {
            git(&dir, &["init", "-q"]);
            git(&dir, &["add", "-A"]);
        }
        let got = foundations(&dir);
        let state = got["items"].get(*id).and_then(Value::as_str);
        if state != *want {
            failures.push(format!(
                "{name}: {id} = {state:?}, want {want:?} ({})",
                got["items"]
            ));
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn a_subfolder_is_judged_with_its_repository() {
    // Catches: a subfolder run failing CI and dependency scanning that live
    // at the repository's top, or judging the top's README as its own.
    let dir =
        std::env::temp_dir().join(format!("impeccable-foundations-sub-{}", std::process::id()));
    for (path, body) in [
        (".github/workflows/ci.yml", WORKFLOW_TESTS),
        (".github/dependabot.yml", "version: 2\n"),
        ("README.md", "```\nnpm install\nnpm run dev\n```\n"),
        ("frontend/package.json", REACT),
        ("frontend/src/main.ts", "export {};\n"),
    ] {
        let p = dir.join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    git(&dir, &["init", "-q"]);
    let got = foundations(&dir.join("frontend"));
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(got["items"]["ci-runs-tests"], "checked", "{got}");
    assert_eq!(got["items"]["dependency-scanning"], "checked", "{got}");
    assert!(got["items"].get("readme-runs").is_none(), "{got}");
}

#[test]
fn an_empty_folder_claims_nothing() {
    // Catches: an empty project crashing the verb or reporting vacuous passes.
    let dir = std::env::temp_dir().join(format!(
        "impeccable-foundations-empty-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let got = foundations(&dir);
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(got, serde_json::json!({ "items": {}, "next": null }));
}
