---
name: impeccable-journeys
description: Have someone from the app's cast take a journey through the flow you changed (create, edit, delete…) on the dev server or the pull request's preview, fix what they trip on, and link the journey in the pull request. Use after a change to how a flow works.
---

# Impeccable journeys

When you change how a flow works, have Impeccable run a journey through it before you call the change done. Run everything from the checkout; add `--repo <owner/name>` if its origin is not the GitHub repository, and `--app <key>` on a repository of several apps.

1. `npx impeccable journeys workflows --json` lists the saved workflows: `{ "errands": [{ "slug", "name", "goal", "startPath", … }] }`. Pick the one your change touches. None fits: give a goal in plain words instead of a slug, and add `--save <lowercase-name>` to keep it.
2. Start it detached: `npx impeccable journeys <slug> --url <address> --detach --json`, where the address is the running dev server (`--pr <n>` instead of `--url` starts on the pull request's preview). It exits as soon as the journey has started, printing `{ "id", "state", "device", "page" }`; the journey goes on without it.
3. Poll: `npx impeccable journeys status <id> --wait <seconds> --json`, with the seconds well inside your own command time limit (`--wait 90` for a two-minute limit). Exit `3` means still going (`{ "id", "state", "steps", "issues", "device", "page" }`): run it again. Still `waiting_for_browser` after two polls: ask the person to open Chrome with the Impeccable browser extension. Exit `0` or `1` is the end, and stdout is the result: `finished`, `steps`, `ms`, `doneWhen` (each `{ text, met }`), `issues` (each `{ step, page, what, said? }`), `replayUrl`, `id`, `state`, `device`.
4. Read `issues` and every `doneWhen` that is not `met`. Fix them in the code, then run the journey again. Repeat until `issues` is empty and `finished` is true.
5. Put `replayUrl` in the pull request's description for the team. It opens only for members of the Impeccable workspace: label it that way, never as a link anyone can open.

Run it at the sizes the change affects: for a responsive or layout change, `--device mobile`, then `tablet`, then `desktop`, one device per detached journey, each to its end before the next. Otherwise leave `--device` out (the persona's own device). `journeys stop <id>` calls off a journey you no longer need.

Journeys need the person signed in on this machine. Before your first journey, ask them to run `npx impeccable login` in their own terminal and approve in the tab it opens, and wait for their word. Never open the sign-in link, approve, accept terms or type a password for them.

Exit codes: `0` the journey reached its goal; `1` it ended without getting there (read `issues`), broke down (`state: "failed"`, its reason as `error`) or was called off (`state: "cancelled"`); `2` it couldn't start, or that `journeys status` read failed, and stdout is `{ "error": "<code>" }` with one line on stderr saying what to do; `3` (`journeys status` only) still going; `4` not signed in: stdout is `{ "error": "not-signed-in" }`.

- `not-signed-in`, from any command: ask the person to run `npx impeccable login` as above, and wait for their word.
- `unreachable` (exit 2): poll again.
- `no-browser`, as `error` either way: the journey runs in the person's Chrome with the Impeccable browser extension. Ask them to open it, or add `--cloud`, before running it again.
- A failed journey with `session-failed` or `job-lost`: run it again once.
- Any other code: stop, and tell the person what the stderr line says.
