#!/usr/bin/env node
// image-gen.mjs — image generation for keyless harnesses.
// Playbook: skill/reference/image-api.md (canonical; this help text is not).
//
//   node image-gen.mjs --prompt "..." --out /abs/path.png
//       [--ref /abs/ref.png] [--width 1408] [--height 1408]
//
// One CLI, several providers. IMAGE_GEN_PROVIDER in .impeccable/.env picks
// the backend:
//   bfl     FLUX (Black Forest Labs). No ref: flux-pro-1.1 text-to-image;
//           with ref: flux-kontext-max image-to-image, aspect ratio 1:1.
//   gemini  Google Nano Banana (Gemini image models), always square 1:1.
//   <else>  delegates to a project-local .impeccable/image-gen.mjs that
//           implements this same CLI (see image-api.md for the contract).
// When the provider line is missing it is inferred from the key's shape
// (Google keys start with "AIza"; anything else is treated as bfl).
//
// Prints the absolute output path on success; exits non-zero with the
// error on stderr on failure. Dependency-free; needs curl and (as a DNS
// fallback) dig on PATH.
//
// Reads IMAGE_GEN_API_KEY from the environment, falling back to
// ./.impeccable/.env relative to the working directory, so callers never
// need to `source` anything: run it from the project root and it finds
// the key itself.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dns from "node:dns";
import { execFileSync, spawnSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ env

// The key lives in .impeccable/.env per the document seed flow. Loading it
// here (instead of requiring the caller to export it) removes the one setup
// step subagents historically forgot, which cost a failed call each time.
// IMAGE_API_KEY is accepted as a legacy alias: early seed runs wrote that
// name, and those .env files are still in the wild.
function loadEnv(...names) {
  for (const name of names) if (process.env[name]) return process.env[name];
  const envPath = path.join(process.cwd(), ".impeccable", ".env");
  if (!fs.existsSync(envPath)) return undefined;
  const vars = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  for (const name of names) if (vars[name]) return vars[name];
  return undefined;
}

// ------------------------------------------------------------------ DNS

// Sandboxed harnesses (Claude Code among them) often block the default
// resolver for the providers' hosts while the hosts stay reachable by IP.
// So every request resolves the host here — system resolver first, then
// dig against the default, Google, and Cloudflare resolvers — and pins
// curl to the IP with --resolve. fetch() is never used; it dies at the
// DNS stage.
async function resolveIp(hostname) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { address } = await dns.promises.lookup(hostname, { family: 4 });
      if (address) return address;
    } catch {
      // fall through to dig
    }
    for (const server of [null, "8.8.8.8", "1.1.1.1"]) {
      try {
        const args = ["+short", "+time=3", "A", hostname];
        if (server) args.push(`@${server}`);
        const ips = execFileSync("dig", args, { encoding: "utf8" })
          .trim()
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^\d+\.\d+\.\d+\.\d+$/.test(l));
        if (ips.length > 0) return ips[ips.length - 1];
      } catch {
        // next resolver
      }
    }
    await sleep(1000);
  }
  throw new Error(`cannot resolve ${hostname} via system resolver, dig, 8.8.8.8, or 1.1.1.1`);
}

// ----------------------------------------------------------------- curl

// Returns { status, json, text } instead of throwing on HTTP errors, so
// callers can branch on 402 (credits) and 429 (rate/quota) rather than
// seeing one opaque curl failure. Request bodies always travel via a temp
// file: a base64 reference image passed as a literal -d argument overflows
// argv (E2BIG) and kills the call before it reaches the network.
async function curlJson(url, { method = "GET", headers = {}, body } = {}) {
  const { hostname } = new URL(url);
  const ip = await resolveIp(hostname);
  const args = ["-sS", "--max-time", "180", "--resolve", `${hostname}:443:${ip}`, "-X", method, "-w", "\n%{http_code}"];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  let bodyFile;
  if (body !== undefined) {
    bodyFile = path.join(os.tmpdir(), `image-gen-body-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(bodyFile, body);
    args.push("-d", `@${bodyFile}`);
  }
  args.push(url);
  try {
    const out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const nl = out.lastIndexOf("\n");
    const status = parseInt(out.slice(nl + 1), 10);
    const text = out.slice(0, nl);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON body (edge HTML error page); callers see json === null
    }
    return { status, json, text };
  } finally {
    if (bodyFile) fs.rmSync(bodyFile, { force: true });
  }
}

async function download(url, outPath) {
  const { hostname } = new URL(url);
  let lastErr;
  // Re-resolve on every attempt: CDN delivery hosts are the flakiest to
  // resolve, and a fresh IP is usually what fixes a failure.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ip = await resolveIp(hostname);
      execFileSync("curl", ["-sS", "-f", "--max-time", "60", "--resolve", `${hostname}:443:${ip}`, "-o", outPath, url]);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return;
      lastErr = new Error("download produced an empty file");
    } catch (e) {
      lastErr = e;
    }
    await sleep(2000 * (attempt + 1));
  }
  throw lastErr;
}

// ----------------------------------------------------------------- args

function getArg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ------------------------------------------------------------------ bfl

// FLUX is asynchronous: submit returns a polling_url, poll until Ready,
// download the signed result URL inside its 10-minute expiry. Transient
// failures are absorbed internally so a network blip costs this script
// seconds instead of costing a caller one of its generation attempts.
// Only two failures are final on the spot: 402 means the account is out
// of credits (a human must top up; retrying is pointless), and a
// moderation status means the prompt itself must change.
async function generateBfl({ apiKey, prompt, ref, width, height, out }) {
  for (const [label, v] of [["width", width], ["height", height]]) {
    if (Number.isNaN(v) || v < 256 || v > 1440 || v % 32 !== 0) {
      fail(`${label} ${v} out of range: BFL takes 256-1440 in multiples of 32`);
    }
  }

  const base = "https://api.bfl.ai";
  let endpoint, body;
  if (ref) {
    endpoint = "/v1/flux-kontext-max";
    body = { prompt, input_image: fs.readFileSync(ref).toString("base64"), aspect_ratio: "1:1", output_format: "png" };
  } else {
    endpoint = "/v1/flux-pro-1.1";
    body = { prompt, width, height, output_format: "png" };
  }

  const authHeaders = { "x-key": apiKey, "Content-Type": "application/json", accept: "application/json" };
  let submit;
  for (let attempt = 0; ; attempt++) {
    try {
      submit = await curlJson(base + endpoint, { method: "POST", headers: authHeaders, body: JSON.stringify(body) });
    } catch (e) {
      submit = { status: 0, json: null, text: e.message };
    }
    if (submit.status === 200 && submit.json?.polling_url) break;
    if (submit.status === 402) fail("BFL account is out of credits; add credits at dashboard.bfl.ai and re-run");
    if (submit.status === 401 || submit.status === 403) fail(`BFL rejected the key (HTTP ${submit.status}): check IMAGE_GEN_API_KEY`);
    if (attempt >= 2) fail(`Submit failed after 3 attempts (last HTTP ${submit.status}): ${submit.text?.slice(0, 300)}`);
    // 429 is the active-task cap (24 tasks; 6 for kontext-max): wait longer.
    await sleep(submit.status === 429 ? 10000 : 2000 * (attempt + 1));
  }

  // Poll the returned polling_url (never a reconstructed one; the global
  // endpoint requires it). Tolerate a few consecutive transient poll
  // failures — the task keeps running server-side regardless.
  let result;
  let pollFailures = 0;
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    let poll;
    try {
      poll = await curlJson(submit.json.polling_url, { headers: { "x-key": apiKey, accept: "application/json" } });
    } catch {
      poll = null;
    }
    if (!poll || poll.status >= 500 || !poll.json) {
      if (++pollFailures >= 5) fail("Polling failed 5 times in a row; giving up");
      continue;
    }
    pollFailures = 0;
    if (poll.json.status === "Ready") {
      result = poll.json.result;
      break;
    }
    if (["Error", "Failed", "Content Moderated", "Request Moderated", "Task not found"].includes(poll.json.status)) {
      fail(`Generation failed with status "${poll.json.status}": ${JSON.stringify(poll.json).slice(0, 300)}`);
    }
  }
  if (!result) fail("Timed out waiting for the generation (5 minutes)");

  // The sample URL is signed and expires after 10 minutes; download now.
  await download(result.sample, out);
}

// --------------------------------------------------------------- gemini

// Nano Banana is synchronous: one generateContent call returns the image
// as base64 in the response, no polling, no delivery CDN. The aspect ratio
// is pinned 1:1 in imageConfig, so output is always square regardless of
// --width/--height (Gemini picks its own pixel size per tier; the pipeline
// only requires square). Moderation shows up as a response with no image
// part plus a block reason, not as an HTTP error.
async function generateGemini({ apiKey, prompt, ref, out }) {
  // IMAGE_GEN_MODEL overrides for users on a different tier; the default
  // is the high-volume Nano Banana model.
  let model = loadEnv("IMAGE_GEN_MODEL") || "gemini-3.1-flash-image";
  const parts = [{ text: prompt }];
  if (ref) parts.push({ inlineData: { mimeType: "image/png", data: fs.readFileSync(ref).toString("base64") } });
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
  });
  const headers = { "x-goog-api-key": apiKey, "Content-Type": "application/json" };
  const urlFor = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await curlJson(urlFor(model), { method: "POST", headers, body });
    } catch (e) {
      res = { status: 0, json: null, text: e.message };
    }
    if (res.status === 200) break;
    const msg = res.json?.error?.message || res.text?.slice(0, 300) || "";
    if (res.status === 400 && /API key not valid/i.test(msg)) fail(`Gemini rejected the key: check IMAGE_GEN_API_KEY (${msg.slice(0, 200)})`);
    if (res.status === 401 || res.status === 403) fail(`Gemini rejected the key (HTTP ${res.status}): ${msg.slice(0, 200)}`);
    // Model ids drift between stable and -preview suffixes as Google
    // promotes them; try the sibling name once before giving up.
    if (res.status === 404 && !model.endsWith("-preview")) {
      model = `${model}-preview`;
      continue;
    }
    if (res.status === 429 && attempt >= 4) fail(`Gemini quota or rate limit exhausted after 5 attempts: ${msg.slice(0, 200)}; check the plan and billing for this key`);
    if (attempt >= 4) fail(`Gemini call failed after 5 attempts (last HTTP ${res.status}): ${msg.slice(0, 300)}`);
    await sleep(res.status === 429 ? 15000 : 2000 * (attempt + 1));
  }

  const blocked = res.json?.promptFeedback?.blockReason;
  if (blocked) fail(`Prompt was moderated (${blocked}); reword the prompt and re-run`);
  const cand = res.json?.candidates?.[0];
  const imgPart = cand?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (!imgPart) {
    const reason = cand?.finishReason || "no image part in the response";
    fail(`Generation returned no image (${reason}); reword the prompt and re-run`);
  }
  fs.writeFileSync(out, Buffer.from(imgPart.inlineData?.data || imgPart.inline_data.data, "base64"));
}

// ----------------------------------------------------------------- main

const prompt = getArg("prompt");
const out = getArg("out");
const ref = getArg("ref");
// 1408 is the default square: comfortably under BFL's 1440 cap and
// divisible by 32. Gemini ignores it (aspect ratio 1:1 pins its square).
const width = parseInt(getArg("width", "1408"), 10);
const height = parseInt(getArg("height", "1408"), 10);
const apiKey = loadEnv("IMAGE_GEN_API_KEY", "IMAGE_API_KEY");
// Users and earlier runs write provider names loosely ("flux" for bfl,
// "nano-banana" for gemini); normalize the known spellings instead of
// failing on them. Google API keys start with "AIza", so a missing
// provider line is recoverable from the key itself.
const PROVIDER_ALIASES = {
  bfl: "bfl", flux: "bfl", "black-forest-labs": "bfl",
  gemini: "gemini", google: "gemini", "nano-banana": "gemini", nanobanana: "gemini",
};
const rawProvider = (loadEnv("IMAGE_GEN_PROVIDER") || (apiKey?.startsWith("AIza") ? "gemini" : "bfl")).toLowerCase();
const provider = PROVIDER_ALIASES[rawProvider] || rawProvider;

if (!prompt || !out) fail("Usage: --prompt <p> --out <abs path> [--ref <abs path>] [--width n] [--height n]");

if (provider !== "bfl" && provider !== "gemini") {
  // Unknown provider: hand the same argv to a project-local wrapper that
  // implements this CLI. The env guard stops a copied shipped script from
  // delegating to itself forever.
  const custom = path.join(process.cwd(), ".impeccable", "image-gen.mjs");
  if (process.env.IMPECCABLE_IMAGE_GEN_DELEGATED || !fs.existsSync(custom)) {
    fail(`Unknown IMAGE_GEN_PROVIDER "${provider}" and no ${custom}; supported providers are bfl and gemini, or write that file implementing the same CLI (see reference/image-api.md)`);
  }
  const child = spawnSync(process.execPath, [custom, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, IMPECCABLE_IMAGE_GEN_DELEGATED: "1" },
  });
  process.exit(child.status ?? 1);
}

if (!apiKey) fail("Missing IMAGE_GEN_API_KEY (environment or ./.impeccable/.env)");

fs.mkdirSync(path.dirname(out), { recursive: true });
if (provider === "gemini") await generateGemini({ apiKey, prompt, ref, out });
else await generateBfl({ apiKey, prompt, ref, width, height, out });
console.log(path.resolve(out));
