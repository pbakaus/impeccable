// Impeccable Loop for opencode (REN-2057): registers Needs you cards and wakes an idle session when its answer lands.
// opencode has no blocking stop hook, but a plugin can start a turn itself: on session.idle it runs Loop's helper in
// the background, and when the helper says an answer is ready, promptAsync continues the same session.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const COMMAND = __COMMAND__;

/** opencode's session ids (ses_…) as the UUID Loop keys sessions by: stable, one per session. */
const sessionUUID = (id: string) => {
  const h = createHash("sha256").update(`opencode:${id}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const run = (kind: string, payload: object) => new Promise<string>((resolve) => {
  const child = spawn("/bin/sh", ["-c", COMMAND + " " + kind], { stdio: ["pipe", "pipe", "ignore"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.on("close", () => resolve(out.trim()));
  child.on("error", () => resolve(""));
  child.stdin.end(JSON.stringify(payload));
});

export const ImpeccableLoop = async ({ client, directory }: any) => {
  const waiting = new Set<string>();
  return {
    event: async ({ event }: any) => {
      if (event.type === "session.created") {
        await run("lifecycle", { hook_event_name: "SessionStart", session_id: sessionUUID(event.properties.info.id), cwd: directory });
      }
      if (event.type === "session.idle") {
        const id = event.properties.sessionID;
        if (waiting.has(id)) return;
        waiting.add(id);
        run("lifecycle", { hook_event_name: "Stop", session_id: sessionUUID(id), cwd: directory }).then(async (out) => {
          waiting.delete(id);
          if (!out) return;
          const reason = (() => { try { return JSON.parse(out).reason; } catch { return null; } })();
          if (reason) await client.session.promptAsync({ path: { id }, body: { parts: [{ type: "text", text: reason }] } });
        });
      }
    },
    "tool.execute.after": async (input: any, output: any) => {
      const match = /^impeccable_(needs_you_(?:post|answer|withdraw))$/.exec(input.tool ?? "");
      if (!match) return;
      await run("register", {
        hook_event_name: "PostToolUse", session_id: sessionUUID(input.sessionID), cwd: directory,
        tool_name: `mcp__impeccable__${match[1]}`, tool_response: { content: output?.content ?? [{ type: "text", text: String(output?.output ?? "") }] },
      });
    },
  };
};
