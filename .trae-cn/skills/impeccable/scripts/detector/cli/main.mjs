import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDesignSystemForTarget } from '../design-system.mjs';
import { RULE_SCOPES, filterByScopes } from '../registry/antipatterns.mjs';
import { createBrowserDetector, detectUrl } from '../engines/browser/detect-url.mjs';
import { detectHtml } from '../engines/static-html/detect-html.mjs';
import { detectText } from '../engines/regex/detect-text.mjs';
import {
  filterDetectionFindings,
  readDetectionConfig,
  shouldIgnoreDetectionFile,
} from '../../lib/impeccable-config.mjs';
import {
  HTML_EXTENSIONS,
  buildImportGraph,
  detectFrameworkConfig,
  isPortListening,
  walkDir,
} from '../node/file-system.mjs';

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatFindingSummary(count) {
  return `${count} anti-pattern${count === 1 ? '' : 's'} found.`;
}

// Local filesystem path behind a file:// URL, or null when it can't be mapped.
function fileUrlToLocalPath(url) {
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

// Advisory findings are detected but never treated as failures: they list in a
// separate, visually dimmed section, are excluded from the failure count that
// drives the exit code, and carry `"advisory": true` in JSON so consumers can
// filter. Every advisory finding carries the flag (stamped by the registry via
// findings.mjs).
function isAdvisory(finding) {
  return finding && finding.advisory === true;
}

function partitionAdvisory(findings) {
  const primary = [];
  const advisory = [];
  for (const f of findings) (isAdvisory(f) ? advisory : primary).push(f);
  return { primary, advisory };
}

// ANSI dim, when stderr is a TTY. Advisory output is chrome, so keep it quiet.
function dim(text) {
  return process.stderr.isTTY ? `\x1b[2m${text}\x1b[0m` : text;
}

function formatFindingsBody(findings) {
  const grouped = {};
  for (const f of findings) {
    if (!grouped[f.file]) grouped[f.file] = [];
    grouped[f.file].push(f);
  }
  const out = [];
  for (const [file, items] of Object.entries(grouped)) {
    const importNote = items[0]?.importedBy?.length ? ` (imported by ${items[0].importedBy.join(', ')})` : '';
    out.push(`\n${file}${importNote}`);
    for (const item of items) {
      out.push(`  ${item.line ? `line ${item.line}: ` : ''}[${item.antipattern}] ${item.snippet}`);
      out.push(`    → ${item.description}`);
    }
  }
  return out;
}

function formatAdvisorySection(advisory) {
  if (!advisory || advisory.length === 0) return '';
  const lines = [`\n${dim('── Advisory (not counted as failures) ──')}`];
  for (const line of formatFindingsBody(advisory)) lines.push(dim(line));
  lines.push(dim(`\n${advisory.length} advisory note${advisory.length === 1 ? '' : 's'}. Suppress with --no-advisory.`));
  return lines.join('\n');
}

// Text/JSON formatter. `findings` is the full set; advisory items are separated
// out into their own section and excluded from the failure summary count. JSON
// output keeps every finding (each advisory one flagged) in a single array.
function formatFindings(findings, jsonMode) {
  if (jsonMode) return JSON.stringify(findings, null, 2);

  const { primary, advisory } = partitionAdvisory(findings);
  const out = [...formatFindingsBody(primary)];
  out.push(`\n${formatFindingSummary(primary.length)}`);
  const advisorySection = formatAdvisorySection(advisory);
  if (advisorySection) out.push(advisorySection);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Stdin handling
// ---------------------------------------------------------------------------

// `optionsFor` maps a local path to scan options carrying that path's own
// project design system (or base options when null). Falls back to a plain
// object so direct/legacy callers still work.
async function handleStdin(optionsFor = () => ({})) {
  const resolve = typeof optionsFor === 'function' ? optionsFor : () => optionsFor;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = Buffer.concat(chunks).toString('utf-8');
  try {
    const parsed = JSON.parse(input);
    const fp = parsed?.tool_input?.file_path;
    if (fp && fs.existsSync(fp)) {
      const options = resolve(fp);
      return HTML_EXTENSIONS.has(path.extname(fp).toLowerCase())
        ? detectHtml(fp, options) : detectText(fs.readFileSync(fp, 'utf-8'), fp, options);
    }
  } catch { /* not JSON */ }
  return detectText(input, '<stdin>', resolve(null));
}


// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function confirm(question) {
  const rl = (await import('node:readline')).default.createInterface({
    input: process.stdin, output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(`${question} [Y/n] `, (answer) => {
      rl.close();
      resolve(!answer || /^y(es)?$/i.test(answer.trim()));
    });
  });
}

function printUsage() {
  console.log(`Usage: impeccable detect [options] [file-or-dir-or-url...]

Scan files or URLs for UI anti-patterns and design quality issues.

Options:
  --json              Output results as JSON
  --quiet             In text mode, only print the final findings count
  --scope <name>      Only report rules in the given design domain
                      (type, layout). Comma-separated.
  --viewport <WxH>    Browser viewport for URL scans (default 1280x800),
                      e.g. --viewport 390x844 for a mobile-width pass
  --no-config         Do not apply project config, detector ignores, inline
                      ignore comments, or DESIGN.md
  --no-inline-ignores Do not honor in-file impeccable-disable* ignore comments
  --no-design-system  Do not load local DESIGN.md / .impeccable/design.json context
  --no-advisory       Suppress advisory findings entirely (e.g. em-dash overuse)
  --help              Show this help message

Advisory findings:
  Some rules are advisory: detected and listed in a separate section, but never
  counted as failures and never changing the exit code. They stay out of the
  failure count so they never block automation. --no-advisory hides them.

Project config:
  Respects .impeccable/config.json and .impeccable/config.local.json detector
  settings: detector.ignoreRules, detector.ignoreFiles, detector.ignoreValues,
  and detector.designSystem.enabled.

Inline ignores:
  In-file comments waive a finding where it lives and travel with the file:
    <!-- impeccable-disable overused-font -- exported brand doc -->
    .brand { font-family: Inter } /* impeccable-disable-line overused-font */
    // impeccable-disable-next-line bounce-easing: intentional bounce
  impeccable-disable applies to the whole file; -line / -next-line are scoped.
  List one or more rule ids (comma-separated), or omit them / use * for all.

Detection modes:
  HTML files     Static HTML/CSS analysis (default, catches linked CSS)
  Non-HTML files Regex pattern matching (CSS, JSX, TSX, etc.)
  URLs           Puppeteer full browser rendering (auto-detected;
                 http(s):// and file:// URLs)

Examples:
  impeccable detect src/
  impeccable detect index.html
  impeccable detect https://example.com
  impeccable detect --json .
  impeccable detect --no-config src/`);
}

async function detectCli() {
  let args = process.argv.slice(2).map(arg => {
    if (arg === '-json') return '--json';
    if (arg === '-fast') return '--fast';
    return arg;
  });
  if (args[0] === 'detect') args = args.slice(1);
  const jsonMode = args.includes('--json');
  const quietMode = args.includes('--quiet');
  const helpMode = args.includes('--help');
  const noAdvisory = args.includes('--no-advisory');
  // --fast (regex-only) is deprecated: since the jsdom removal, the static
  // HTML/CSS analysis is fast and covers every rule, so the regex-only path
  // only loses coverage for no real speed win. Accept the flag for back-compat
  // but ignore it and run the full scan.
  if (args.includes('--fast')) {
    process.stderr.write(
      'Note: --fast is deprecated and ignored. The full scan is fast now and runs every rule.\n',
    );
  }
  if (args.includes('--gpt') || args.includes('--gemini')) {
    process.stderr.write(
      'Note: --gpt and --gemini are deprecated and ignored. Generated-UI tells now run by default.\n',
    );
  }
  const configEnabled = !args.includes('--no-config');
  const detectionConfig = configEnabled
    ? readDetectionConfig(process.cwd())
    : { ignoreRules: [], ignoreFiles: [], ignoreValues: [] };
  const scopes = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--scope' && !args[i].startsWith('--scope=')) continue;
    const inline = args[i].startsWith('--scope=');
    const value = inline ? args[i].slice('--scope='.length) : args[i + 1];
    const parsed = (value && !value.startsWith('--'))
      ? value.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    // A bare `--scope` would otherwise fall out of `targets` and scan unscoped;
    // fail loudly so a mistyped pre-scan never runs the wrong rule set.
    if (parsed.length === 0) {
      process.stderr.write(
        `Error: --scope requires a value. Valid scopes: ${[...RULE_SCOPES].join(', ')}\n`,
      );
      process.exit(1);
    }
    scopes.push(...parsed);
    args.splice(i, inline ? 1 : 2);
    i -= 1;
  }
  let viewport = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--viewport' && !args[i].startsWith('--viewport=')) continue;
    const inline = args[i].startsWith('--viewport=');
    const value = inline ? args[i].slice('--viewport='.length) : args[i + 1];
    const match = /^(\d{2,5})x(\d{2,5})$/i.exec(value || '');
    if (!match) {
      process.stderr.write('Error: --viewport requires a WxH value, e.g. --viewport 390x844\n');
      process.exit(1);
    }
    viewport = { width: Number(match[1]), height: Number(match[2]) };
    args.splice(i, inline ? 1 : 2);
    i -= 1;
  }
  const unknownScopes = scopes.filter(s => !RULE_SCOPES.has(s));
  if (unknownScopes.length > 0) {
    process.stderr.write(
      `Error: unknown --scope value(s): ${unknownScopes.join(', ')}. Valid scopes: ${[...RULE_SCOPES].join(', ')}\n`,
    );
    process.exit(1);
  }
  const designSystemEnabled = configEnabled && !args.includes('--no-design-system') && detectionConfig.designSystem?.enabled !== false;
  // Inline `impeccable-disable*` waivers are part of the scanned file, so they
  // apply by default. `--no-config` (raw scan) and the dedicated
  // `--no-inline-ignores` both turn them off.
  const inlineIgnoresEnabled = configEnabled && !args.includes('--no-inline-ignores');
  const baseScanOptions = { inlineIgnores: inlineIgnoresEnabled };
  if (viewport) baseScanOptions.viewport = viewport;
  // DESIGN.md must resolve from EACH scan target's own project root, not from
  // process.cwd(): scanning project B's files from inside project A applied A's
  // design rules (cross-project contamination). Resolve per target, memoized by
  // resolved project root so a multi-file scan pays the read once per project.
  // A target with no project marker above it gets no design system (never cwd's).
  const designSystemCache = new Map();
  const scanOptionsFor = (localPath) => {
    if (!designSystemEnabled || !localPath) return baseScanOptions;
    const designSystem = loadDesignSystemForTarget(localPath, { cache: designSystemCache });
    return designSystem ? { ...baseScanOptions, designSystem } : baseScanOptions;
  };
  const targets = args.filter(a => !a.startsWith('--'));

  if (helpMode) { printUsage(); process.exit(0); }

  let allFindings = [];

  if (!process.stdin.isTTY && targets.length === 0) {
    allFindings = await handleStdin(scanOptionsFor);
  } else {
    const paths = targets.length > 0 ? targets : [process.cwd()];
    // file:// URLs get the same Puppeteer-rendered pass as http(s) — the
    // real cascade, real computed styles, real layout. Callers that want a
    // browser-grade scan of a local artifact can pass file:///abs/path.html
    // instead of the bare path (which stays on the static engine).
    const urlRe = /^(?:https?|file):\/\//i;
    const urlTargetCount = paths.filter(target => urlRe.test(target)).length;
    const browserDetector = urlTargetCount > 1 ? await createBrowserDetector() : null;

    try {
      for (const target of paths) {
        if (urlRe.test(target)) {
          // A file:// URL points at a local artifact, so its design system
          // resolves from that file's project. A remote http(s) URL has no
          // local project — it gets base options (no design system), never
          // process.cwd()'s.
          const urlOptions = /^file:/i.test(target)
            ? scanOptionsFor(fileUrlToLocalPath(target))
            : baseScanOptions;
          try {
            const scanner = browserDetector
              ? (url) => browserDetector.detectUrl(url, urlOptions)
              : (url) => detectUrl(url, urlOptions);
            allFindings.push(...await scanner(target));
          } catch (e) { process.stderr.write(`Error: ${e.message}\n`); }
          continue;
        }

        const resolved = path.resolve(target);
        let stat;
        try { stat = fs.statSync(resolved); }
        catch { process.stderr.write(`Warning: cannot access ${target}\n`); continue; }

        if (stat.isDirectory()) {
          // Check for framework dev server config (skip in JSON/quiet modes to avoid polluting output)
          if (!jsonMode && !quietMode) {
            const fwConfig = detectFrameworkConfig(resolved);
            if (fwConfig) {
              const probe = await isPortListening(fwConfig.port, fwConfig.fingerprint);
              if (probe.listening && probe.matched) {
                process.stderr.write(
                  `\n${fwConfig.name} dev server detected on localhost:${fwConfig.port}.\n` +
                  `For more accurate results, scan the running site:\n` +
                  `  npx impeccable detect http://localhost:${fwConfig.port}\n\n`
                );
              } else if (probe.listening && !probe.matched) {
                process.stderr.write(
                  `\n${fwConfig.name} project detected (${path.basename(fwConfig.configPath)}).\n` +
                  `Port ${fwConfig.port} is in use by another service. Start the ${fwConfig.name} dev server and scan via URL for best results.\n\n`
                );
              } else {
                process.stderr.write(
                  `\n${fwConfig.name} project detected (${path.basename(fwConfig.configPath)}).\n` +
                  `Start the dev server and scan via URL for best results:\n` +
                  `  npx impeccable detect http://localhost:${fwConfig.port}\n\n`
                );
              }
            }
          }

          const files = walkDir(resolved)
            .filter(file => !shouldIgnoreDetectionFile(file, process.cwd(), detectionConfig));
          const htmlCount = files.filter(f => HTML_EXTENSIONS.has(path.extname(f).toLowerCase())).length;

          // Warn and confirm if scanning many files (static HTML/CSS processes each HTML file)
          if (files.length > 50 && process.stdin.isTTY && !jsonMode && !quietMode) {
            process.stderr.write(
              `\nFound ${files.length} files (${htmlCount} HTML) in ${target}.\n` +
              `Scanning may take a while${htmlCount > 10 ? ' (static HTML/CSS processes each HTML file individually)' : ''}.\n` +
              `Target a specific subdirectory to narrow scope.\n`
            );
            const ok = await confirm('Continue?');
            if (!ok) { process.stderr.write('Aborted.\n'); process.exit(0); }
          }

          // Build import graph for multi-file awareness
          const graph = buildImportGraph(files);
          // Build reverse map: file -> set of files that import it
          const importedByMap = new Map();
          for (const [importer, imports] of graph) {
            for (const imported of imports) {
              if (!importedByMap.has(imported)) importedByMap.set(imported, new Set());
              importedByMap.get(imported).add(importer);
            }
          }

          for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            // Each file resolves its own project design system (cached by root),
            // so a scan spanning sibling projects applies the right rules per file.
            const fileOptions = scanOptionsFor(file);
            let fileFindings;
            if (HTML_EXTENSIONS.has(ext)) {
              fileFindings = await detectHtml(file, fileOptions);
            } else {
              fileFindings = detectText(fs.readFileSync(file, 'utf-8'), file, fileOptions);
            }
            // Annotate findings with import context
            const importers = importedByMap.get(file);
            if (importers && importers.size > 0) {
              const importerNames = [...importers].map(f => path.basename(f));
              for (const f of fileFindings) {
                f.importedBy = importerNames;
              }
            }
            allFindings.push(...fileFindings);
          }
        } else if (stat.isFile()) {
          if (shouldIgnoreDetectionFile(resolved, process.cwd(), detectionConfig)) continue;
          const ext = path.extname(resolved).toLowerCase();
          const fileOptions = scanOptionsFor(resolved);
          if (HTML_EXTENSIONS.has(ext)) {
            allFindings.push(...await detectHtml(resolved, fileOptions));
          } else {
            allFindings.push(...detectText(fs.readFileSync(resolved, 'utf-8'), resolved, fileOptions));
          }
        }
      }
    } finally {
      if (browserDetector) await browserDetector.close();
    }
  }

  allFindings = filterDetectionFindings(allFindings, detectionConfig);
  allFindings = filterByScopes(allFindings, scopes);
  // --no-advisory drops advisory findings before any output or exit-code math.
  if (noAdvisory) allFindings = allFindings.filter((f) => !isAdvisory(f));

  // The exit code and failure count reflect non-advisory findings only. An
  // advisory-only scan still prints its notes but exits 0 (a clean pass), so
  // advisory rules never break CI or block automation.
  const { primary, advisory } = partitionAdvisory(allFindings);

  if (allFindings.length > 0) {
    if (jsonMode) process.stdout.write(formatFindings(allFindings, true) + '\n');
    else if (quietMode) {
      process.stderr.write(formatFindingSummary(primary.length) + '\n');
      if (advisory.length > 0) {
        process.stderr.write(dim(`${advisory.length} advisory note${advisory.length === 1 ? '' : 's'} (not counted).`) + '\n');
      }
    }
    else process.stderr.write(formatFindings(allFindings, false) + '\n');
    process.exit(primary.length > 0 ? 2 : 0);
  }
  if (jsonMode) process.stdout.write('[]\n');
  process.exit(0);
}

export { formatFindings, handleStdin, confirm, printUsage, detectCli };
