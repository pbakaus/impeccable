"""impeccable-design-hook: the Impeccable design detector as a Hermes plugin.

Hermes has no command-hook manifest, so this plugin feeds the engine's ``hook`` verb the
Claude-shaped events it already understands: ``transform_tool_result`` on ``write_file`` /
``patch`` sends a PostToolUse event and adds the findings to the tool result, and
``pre_verify`` sends a Stop event so the deep pass can keep the turn going. The engine owns
everything else (UI-file filtering, ``hook.enabled``, dedupe between the two passes).

It runs only where the impeccable skill is reachable: a ``.hermes/skills/impeccable`` above the
edited file in a project Hermes trusts (``hermes skills trust``, the gate Hermes itself puts on
project skills), else the one in the Hermes home. Fail-open: any error, timeout or missing
launcher leaves Hermes untouched.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

_TOOL_NAMES = {"write_file": "Write", "patch": "Edit"}
_EDIT_TIMEOUT_S = 5
_STOP_TIMEOUT_S = 30
_TRUTHY = {"1", "true", "yes", "on"}
_LAUNCHER = "impeccable.cmd" if os.name == "nt" else "impeccable"
_SKILL_SCRIPTS = os.path.join("skills", "impeccable", "scripts", _LAUNCHER)


def _disabled() -> bool:
    return os.environ.get("IMPECCABLE_HOOK_DISABLED", "").strip().lower() in _TRUTHY


def _hermes_home() -> str:
    return os.environ.get("HERMES_HOME") or os.path.join(os.path.expanduser("~"), ".hermes")


def _project_trusted(root: str) -> bool:
    """Hermes' own trust list for project skills; anything that cannot answer means no."""
    try:
        from pathlib import Path
        from agent.skill_utils import is_project_root_trusted
        return bool(is_project_root_trusted(Path(root)))
    except Exception:
        return False


def _find_launcher(start: str) -> Optional[str]:
    """Nearest trusted project install above ``start`` wins, then the Hermes home install.
    An untrusted clone's launcher never runs: it is repository code."""
    current = os.path.abspath(start)
    while True:
        candidate = os.path.join(current, ".hermes", _SKILL_SCRIPTS)
        if os.path.isfile(candidate) and _project_trusted(current):
            return candidate
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    home = os.path.join(_hermes_home(), _SKILL_SCRIPTS)
    return home if os.path.isfile(home) else None


def _run_hook(launcher: Optional[str], cwd: str, event: Dict[str, Any], timeout: int) -> Optional[Dict[str, Any]]:
    """Run ``<launcher> hook`` with ``event`` on stdin; the parsed stdout object, or None."""
    if launcher is None or _disabled():
        return None
    env = dict(os.environ, IMPECCABLE_HOOK_HARNESS="hermes")
    proc = subprocess.run(
        [launcher, "hook"], input=json.dumps(event), capture_output=True,
        encoding="utf-8", errors="replace", cwd=cwd, env=env, timeout=timeout,
    )
    out = proc.stdout.strip()
    if not out:
        return None
    parsed = json.loads(out)
    return parsed if isinstance(parsed, dict) else None


def _additional_context(output: Optional[Dict[str, Any]]) -> str:
    specific = output.get("hookSpecificOutput") if output else None
    text = specific.get("additionalContext") if isinstance(specific, dict) else None
    return text if isinstance(text, str) else ""


def _edited_paths(result: str, args: Any, cwd: str) -> list:
    """The paths the tool reports it wrote (a V4A ``patch`` can touch several), else
    ``args["path"]``."""
    try:
        parsed = json.loads(result)
    except ValueError:
        parsed = None
    raw: list = []
    if isinstance(parsed, dict):
        if "error" in parsed:
            return []
        modified = parsed.get("files_modified")
        raw = modified if isinstance(modified, list) else [parsed.get("resolved_path")]
    if not any(isinstance(value, str) and value for value in raw):
        raw = [args.get("path") if isinstance(args, dict) else None]
    return [os.path.abspath(os.path.join(cwd, value)) for value in raw if isinstance(value, str) and value]


def _with_findings(result: str, text: str) -> str:
    """The result with the findings added. A JSON object gets them as an ``impeccable``
    key: Hermes reads the result JSON back to record the edit for its verify gate, and
    text after the JSON would hide the write from ``pre_verify``."""
    try:
        parsed = json.loads(result)
    except ValueError:
        parsed = None
    if isinstance(parsed, dict):
        parsed["impeccable"] = text
        return json.dumps(parsed, ensure_ascii=False)
    return result + "\n\n" + text


def _make_hooks(session_cwd: Callable[[], str]):
    # The launcher each session last edited through, so its Stop pass reaches a project
    # below the session cwd: the engine finds that project's cache by session id.
    session_launchers: Dict[str, str] = {}

    def on_transform_tool_result(tool_name: str = "", args: Any = None, result: Any = None,
                                 session_id: Optional[str] = None, **_: Any) -> Optional[str]:
        """Add the per-edit findings to a successful write_file / patch result."""
        if tool_name not in _TOOL_NAMES or not isinstance(result, str):
            return None
        cwd = session_cwd()
        texts = []
        for path in _edited_paths(result, args, cwd):
            event: Dict[str, Any] = {"hook_event_name": "PostToolUse", "cwd": cwd,
                                     "tool_name": _TOOL_NAMES[tool_name], "tool_input": {"file_path": path}}
            if session_id:
                event["session_id"] = session_id
            try:
                launcher = _find_launcher(os.path.dirname(path))
                if launcher and session_id:
                    session_launchers[session_id] = launcher
                texts.append(_additional_context(_run_hook(launcher, cwd, event, _EDIT_TIMEOUT_S)))
            except Exception as err:  # fail-open: a broken hook must never cost the user a write
                logger.debug("impeccable-design-hook: edit hook skipped for %s: %s", path, err)
        text = "\n\n".join(t for t in texts if t)
        return _with_findings(result, text) if text else None

    def on_pre_verify(session_id: Optional[str] = None, **_: Any) -> Optional[Dict[str, str]]:
        """Run the Stop deep pass; findings keep the turn going, silence lets it finish.
        Every nudge scans again: the engine reports only what is new, so a clean
        pass is silent and Hermes' own nudge cap bounds the loop."""
        try:
            cwd = session_cwd()
            event: Dict[str, Any] = {"hook_event_name": "Stop", "cwd": cwd, "stop_hook_active": False}
            if session_id:
                event["session_id"] = session_id
            launcher = session_launchers.get(session_id or "") or _find_launcher(cwd)
            output = _run_hook(launcher, cwd, event, _STOP_TIMEOUT_S)
        except Exception as err:  # fail-open: never trap the turn on a hook failure
            logger.debug("impeccable-design-hook: stop hook skipped: %s", err)
            return None
        if not output:
            return None
        reason = output.get("reason")
        if output.get("decision") == "block" and isinstance(reason, str) and reason:
            return {"decision": "block", "reason": reason}
        # Engines released before the hermes harness answer Stop in the PostToolUse shape.
        text = _additional_context(output)
        return {"action": "continue", "message": text} if text else None

    return on_transform_tool_result, on_pre_verify


def register(ctx) -> None:
    def session_cwd() -> str:
        # Hermes returns "" (or raises) outside a session; the process cwd is the fallback.
        try:
            cwd = ctx.session_cwd() if hasattr(ctx, "session_cwd") else ""
        except Exception:
            cwd = ""
        return cwd or os.getcwd()

    on_transform_tool_result, on_pre_verify = _make_hooks(session_cwd)
    ctx.register_hook("transform_tool_result", on_transform_tool_result)
    ctx.register_hook("pre_verify", on_pre_verify)
