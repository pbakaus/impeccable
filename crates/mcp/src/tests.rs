use super::*;

/// The account service as a script: each call takes the next answer; `sign_in` answers as told and counts.
struct Script {
    answers: Vec<Result<Value, Failure>>,
    sign_in: Result<(), String>,
    signed: usize,
    calls: usize,
}

impl Upstream for Script {
    fn call(&mut self, request: &Value) -> Result<Value, Failure> {
        self.calls += 1;
        match self.answers.remove(0) {
            Ok(result) => Ok(json!({ "jsonrpc": "2.0", "id": request["id"], "result": result })),
            Err(f) => Err(f),
        }
    }
    fn sign_in(&mut self) -> Result<(), String> {
        self.signed += 1;
        self.sign_in.clone()
    }
}

fn script(answers: Vec<Result<Value, Failure>>, sign_in: Result<(), String>) -> Script {
    Script { answers, sign_in, signed: 0, calls: 0 }
}

/// Every frame written for `lines`, and stderr.
fn talk(lines: &[Value], upstream: &mut Script) -> (Vec<Value>, String) {
    let input = lines.iter().map(Value::to_string).collect::<Vec<_>>().join("\n");
    let (mut out, mut err) = (Vec::new(), Vec::new());
    serve(input.as_bytes(), &mut out, &mut err, upstream);
    let frames = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    (frames, String::from_utf8(err).unwrap())
}

const TOOL: &str = "taste.get";
fn call(progress: bool) -> Value {
    let meta = if progress { json!({ "progressToken": "p1" }) } else { json!({}) };
    json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": TOOL, "arguments": {}, "_meta": meta } })
}

// Catches a held call that is not retried after the person approves (or retried twice), the agent not told it is
// waiting, and a reply that is not the service's own.
#[test]
fn signs_in_once_and_retries_a_call_the_sign_in_blocked() {
    let mut up = script(vec![Err(Failure::Auth), Ok(json!({ "content": [{ "type": "text", "text": "rules" }] }))], Ok(()));
    let (frames, err) = talk(&[call(true)], &mut up);
    assert_eq!((up.signed, up.calls), (1, 2));
    assert_eq!(frames[0]["method"], "notifications/progress");
    assert_eq!(frames[0]["params"]["message"], WAITING);
    assert_eq!(frames[1]["result"]["content"][0]["text"], "rules");
    assert!(err.contains(WAITING));
}

// Catches a sign-in that cannot happen (no browser, or not approved) answered as anything but the one line, or a
// call that keeps failing being retried without end.
#[test]
fn says_one_line_when_the_sign_in_cannot_happen() {
    for (sign_in, then, line) in [
        (Err(NO_BROWSER.to_string()), vec![], NO_BROWSER),
        (Ok(()), vec![Err(Failure::Auth)], NOT_APPROVED),
    ] {
        let mut answers = vec![Err(Failure::Auth)];
        answers.extend(then);
        let mut up = script(answers, sign_in);
        let (frames, _) = talk(&[call(false)], &mut up);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0]["result"]["isError"], true);
        assert_eq!(frames[0]["result"]["content"][0]["text"], line);
        assert_eq!(up.signed, 1);
    }
}

// Catches an agent's start opening a browser, a reply that names the service rather than Impeccable, and a
// notification being answered.
#[test]
fn starts_without_signing_in_and_answers_no_notification() {
    let mut up = script(vec![Err(Failure::Auth)], Ok(()));
    let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } });
    let (frames, _) = talk(&[init, json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })], &mut up);
    assert_eq!(up.signed, 0);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["result"]["serverInfo"]["name"], "Impeccable");
    assert_eq!(frames[0]["result"]["protocolVersion"], "2025-03-26");
}

// Catches an agent's tool list waiting on a sign-in: its start never opens a browser, and the list answers at once.
#[test]
fn lists_without_signing_in() {
    let mut up = script(vec![Err(Failure::Auth)], Ok(()));
    let (frames, err) = talk(&[json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })], &mut up);
    assert_eq!(up.signed, 0);
    assert_eq!(frames[0]["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].clone()).collect::<Vec<_>>(), [json!(SIGN_IN_TOOL)]);
    assert!(!err.contains(WAITING));
}

// Catches a signed-out agent left without Impeccable's tools after it signs in: the sign-in tool signs in, then the
// agent hears its tools changed.
#[test]
fn signs_in_from_its_tool_and_says_the_tools_changed() {
    let mut up = script(vec![Err(Failure::Auth), Ok(json!({ "tools": [{ "name": TOOL }] }))], Ok(()));
    let ask = json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": SIGN_IN_TOOL, "arguments": {}, "_meta": { "progressToken": "p3" } } });
    let (frames, _) = talk(&[ask], &mut up);
    assert_eq!(up.signed, 1);
    // The wait is heard on the caller's own progress token.
    assert_eq!((frames[0]["method"].as_str(), frames[0]["params"]["progressToken"].as_str()), (Some("notifications/progress"), Some("p3")));
    assert_eq!(frames[1]["method"], "notifications/tools/list_changed");
    assert_eq!(frames[2]["id"], 3);
    assert_eq!(frames[2]["result"]["isError"], Value::Null);
}

// Catches a failure that is not about the sign-in opening the browser.
#[test]
fn leaves_other_failures_to_the_agent() {
    let mut up = script(vec![Err(Failure::Other("down".into()))], Ok(()));
    let (frames, _) = talk(&[call(false)], &mut up);
    assert_eq!((up.signed, frames[0]["error"]["message"].as_str()), (0, Some("down")));
}

#[test]
fn opens_no_browser_over_ssh() {
    let env = |k: &str| [(k.to_string(), "1".to_string())].into_iter().collect::<HashMap<_, _>>();
    assert!(!can_open_browser(&env("SSH_CONNECTION")));
    assert!(!can_open_browser(&env("SSH_TTY")));
    // Nor where the person said so, as `impeccable login` reads it.
    assert!(!can_open_browser(&env("IMPECCABLE_NO_BROWSER")));
    // Read as `impeccable login` reads it: false or 0 leaves the browser on.
    for off in ["false", "0", "no"] {
        let env: HashMap<String, String> = [("IMPECCABLE_NO_BROWSER".to_string(), off.to_string())].into_iter().collect();
        assert_eq!(can_open_browser(&env), !cfg!(target_os = "linux"), "{off}");
    }
}
