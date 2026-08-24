/**
 * Browser-side resolution of project detector waivers for Impeccable live mode.
 *
 * The live server serializes `.impeccable/config.json` + `config.local.json`
 * detector ignores (plus the served-root prefixes from the inject config's
 * `files` globs) into `window.__IMPECCABLE_PROJECT_IGNORES__`. This part
 * resolves that config against the current page's URL path when a detect scan
 * starts, so the overlay suppresses the same findings the CLI and the edit
 * hook do (issue #639).
 *
 * Mirrors filterDetectionFindings in cli/lib/impeccable-config.mjs:
 *   1. `ignoreRules` suppress a rule project-wide.
 *   2. `ignoreValues` entries with `value: "*"` suppress their rule in the
 *      files their globs name. The CLI never applies an unscoped wildcard
 *      (isIgnoredFindingValue returns false for it), so neither does this.
 *   3. Remaining `ignoreValues` entries match on the finding's own value;
 *      those are forwarded as `disabledValues` for the detector bundle to
 *      apply where the findings are assembled.
 *
 * Kept separate from live-browser.js so the glob and page-scope logic can be
 * unit tested in Node (tests/live-browser-ignores.test.mjs) without the full
 * overlay UI bundle.
 */
(function (root) {
  'use strict';
  if (!root) return;

  // Keep in step with normalizeIgnoreRule / normalizeIgnoreValue in
  // cli/lib/impeccable-config.mjs.
  function normalizeIgnoreRule(rule) {
    return String(rule || '').trim().toLowerCase();
  }

  function normalizeIgnoreValue(value) {
    return String(value || '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\+/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  // Glob -> RegExp. Supports `**`, `*`, `?`, and `{a,b}` alternation.
  // Keep in step with globToRegex in cli/lib/impeccable-config.mjs.
  function globToRegex(glob) {
    let re = '^';
    let i = 0;
    while (i < glob.length) {
      const c = glob[i];
      if (c === '*') {
        if (glob[i + 1] === '*') {
          re += '.*';
          i += 2;
          if (glob[i] === '/') i += 1;
        } else {
          re += '[^/]*';
          i += 1;
        }
      } else if (c === '?') {
        re += '[^/]';
        i += 1;
      } else if (c === '{') {
        const end = glob.indexOf('}', i);
        if (end === -1) { re += '\\{'; i += 1; continue; }
        const parts = glob.slice(i + 1, end).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&'));
        re += `(?:${parts.join('|')})`;
        i = end + 1;
      } else if (/[.+^$()|[\]\\]/.test(c)) {
        re += `\\${c}`;
        i += 1;
      } else {
        re += c;
        i += 1;
      }
    }
    re += '$';
    return new RegExp(re);
  }

  // The project-relative paths this page could be known as. Ignore globs are
  // project-relative (prototype/foo.html) and the URL is site-relative
  // (/foo.html), because a static server's root usually sits inside the
  // project; `roots` carries that prefix. The server reads it from the inject
  // config's own `files` globs, which already state where the served pages
  // are. Do not derive it from the ignore globs: a single entry scoped to
  // prototype/library/** would then lend prototype/library/ as a candidate
  // prefix to every page, and that rule would suppress site-wide.
  //
  // Each prefixed path also contributes its slash suffixes, mirroring
  // findingMatchesScopedIgnoreFile in cli/lib/impeccable-config.mjs (which
  // matches globs against every path suffix of the finding's file).
  //
  // One live session is served by one server, so a single document root must
  // sit at or above every configured page. The only prefix that can safely
  // be asserted is therefore the deepest common ancestor of the glob roots.
  // Treating each glob's own prefix as an identity goes wrong in both
  // directions: disjoint roots (src/ and public/) invent simultaneous
  // identities for one URL, so a waiver scoped to src/foo.html hides a
  // finding on a page served from public/foo.html; nested roots (prototype/
  // and prototype/library/, from globs at two depths in one tree) are not
  // alternatives at all, and demanding a waiver match under both stops
  // prototype/index.html from applying anywhere. When the globs share no
  // common root, no prefix is asserted and only the URL path itself matches.
  function pageCandidates(pathname, roots) {
    let pagePath = String(pathname || '');
    try {
      pagePath = decodeURIComponent(pagePath);
    } catch {
      // Malformed percent-escape: match on the raw path rather than throwing.
    }
    pagePath = pagePath.replace(/^\/+/, '');
    // A directory URL serves that directory's index, and the ignore globs
    // name files. Without this, /news/ never matches prototype/news/index.html.
    if (pagePath === '' || pagePath.endsWith('/')) pagePath += 'index.html';

    const prefixes = [];
    for (const entry of Array.isArray(roots) ? roots : []) {
      if (typeof entry !== 'string') continue;
      prefixes.push(entry.split('/').filter(Boolean));
    }
    let common = prefixes.length > 0 ? prefixes[0] : [];
    for (const segments of prefixes.slice(1)) {
      let i = 0;
      while (i < common.length && i < segments.length && common[i] === segments[i]) i += 1;
      common = common.slice(0, i);
    }

    const candidates = new Set();
    const addSuffixes = (fullPath) => {
      const parts = fullPath.split('/').filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        candidates.add(parts.slice(i).join('/'));
      }
    };
    addSuffixes(pagePath);
    if (common.length > 0) addSuffixes(common.join('/') + '/' + pagePath);
    return [...candidates];
  }

  function matchesScope(globs, candidates) {
    return globs.some((glob) => {
      let re;
      try {
        re = globToRegex(String(glob));
      } catch {
        // Malformed glob: skip it, as matchesAnyGlob does in the CLI.
        return false;
      }
      return candidates.some((candidate) => re.test(candidate));
    });
  }

  /**
   * Resolve the serialized project ignores for one page.
   *
   * @param {object} options
   * @param {object} options.ignores  window.__IMPECCABLE_PROJECT_IGNORES__,
   *   in whatever state it arrived: absent, null, or hand-edited into the
   *   wrong shape. Every read tolerates that and degrades to no filtering.
   * @param {string} options.pathname  location.pathname of the scanned page.
   * @returns {{ disabledRules: string[], disabledValues: Array<{rule: string, value: string}> }}
   */
  function resolveDetectIgnores({ ignores, pathname } = {}) {
    const config = ignores && typeof ignores === 'object' ? ignores : {};
    const asArray = (value) => (Array.isArray(value) ? value : []);
    const candidates = pageCandidates(pathname, config.roots);

    const disabledRules = new Set(
      asArray(config.ignoreRules)
        .filter((rule) => typeof rule === 'string')
        .map(normalizeIgnoreRule)
        .filter(Boolean),
    );
    const disabledValues = [];

    for (const entry of asArray(config.ignoreValues)) {
      if (!entry || typeof entry !== 'object') continue;
      const rule = normalizeIgnoreRule(entry.rule);
      const value = normalizeIgnoreValue(entry.value);
      if (!rule || !value) continue;
      const files = [
        ...(typeof entry.file === 'string' && entry.file.trim() ? [entry.file.trim()] : []),
        ...asArray(entry.files).filter((glob) => typeof glob === 'string' && glob.trim()),
      ];
      if (value === '*') {
        // Wildcards suppress their rule only inside the files they name.
        if (files.length > 0 && matchesScope(files, candidates)) disabledRules.add(rule);
        continue;
      }
      if (files.length > 0 && !matchesScope(files, candidates)) continue;
      disabledValues.push({ rule, value });
    }

    return { disabledRules: [...disabledRules], disabledValues };
  }

  root.__IMPECCABLE_LIVE_IGNORES__ = {
    version: 1,
    resolveDetectIgnores,
  };
})(typeof window !== 'undefined' ? window : globalThis);
