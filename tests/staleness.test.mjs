/**
 * Tests for staleness detection of Impeccable's own project artifacts.
 * Run with: node --test tests/staleness.test.mjs
 *
 * The checks are pure or near-pure, so most cases assert on the returned
 * finding set. The CLI cases at the bottom cover the one thing the units
 * cannot: that context.mjs emits a single CONTEXT_STALE directive at boot and
 * respects its throttle and its opt-outs.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  PRODUCT_SCHEMA_VERSION,
  productStampLine,
  readProductSchemaVersion,
  stampProductSchema,
} from '../skill/scripts/lib/artifact-schema.mjs';
import {
  checkBuildPathUnset,
  checkConfig,
  checkDesignSidecar,
  checkNativePlatformEvidence,
  checkProduct,
  checkProjectRoots,
  checkSurfaceBriefs,
  designSidecarCandidatesFor,
} from '../skill/scripts/lib/staleness.mjs';
import {
  buildStalenessDirective,
  filterFreshFindings,
  stalenessCheckDisabled,
} from '../skill/scripts/lib/staleness-notice.mjs';

const SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'scripts', 'context.mjs',
);

let scratch;
let savedCacheEnv;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-stale-'));
  savedCacheEnv = process.env.IMPECCABLE_STALENESS_CACHE;
  process.env.IMPECCABLE_STALENESS_CACHE = path.join(scratch, 'notice.json');
});

afterEach(() => {
  if (savedCacheEnv === undefined) delete process.env.IMPECCABLE_STALENESS_CACHE;
  else process.env.IMPECCABLE_STALENESS_CACHE = savedCacheEnv;
  fs.rmSync(scratch, { recursive: true, force: true });
});

function write(rel, body) {
  const abs = path.join(scratch, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

function ids(findings) {
  return findings.map((entry) => entry.id);
}

const CURRENT_PRODUCT = [
  '# Product',
  '',
  productStampLine(),
  '',
  '## Platform',
  '',
  'web',
  '',
  '## Positioning',
  'The only one that does the thing.',
  '',
].join('\n');

// ─── the PRODUCT.md stamp ──────────────────────────────────────────────────

describe('product schema stamp', () => {
  it('reads a stamped version and returns null when unstamped', () => {
    assert.equal(readProductSchemaVersion(CURRENT_PRODUCT), PRODUCT_SCHEMA_VERSION);
    assert.equal(readProductSchemaVersion('# Product\n\n## Users\nx\n'), null);
    assert.equal(readProductSchemaVersion(''), null);
    assert.equal(readProductSchemaVersion(null), null);
  });

  it('places a new stamp under the leading heading', () => {
    const stamped = stampProductSchema('# Product\n\n## Users\nDesigners.\n');
    assert.equal(stamped.split('\n')[0], '# Product');
    assert.equal(readProductSchemaVersion(stamped), PRODUCT_SCHEMA_VERSION);
    assert.match(stamped, /## Users\nDesigners\./);
  });

  it('stamps a body with no heading at the top', () => {
    const stamped = stampProductSchema('## Users\nDesigners.\n');
    assert.equal(stamped.split('\n')[0], productStampLine());
    assert.equal(readProductSchemaVersion(stamped), PRODUCT_SCHEMA_VERSION);
  });

  it('is idempotent and updates an older stamp in place', () => {
    const once = stampProductSchema('# Product\n\n## Users\nx\n');
    assert.equal(stampProductSchema(once), once);
    const upgraded = stampProductSchema('# Product\n\n<!-- impeccable:product-schema 0 -->\n\n## Users\nx\n');
    assert.equal(readProductSchemaVersion(upgraded), PRODUCT_SCHEMA_VERSION);
    assert.equal((upgraded.match(/impeccable:product-schema/g) || []).length, 1);
  });
});

// ─── PRODUCT.md ────────────────────────────────────────────────────────────

describe('checkProduct', () => {
  it('flags a deprecated Register section and binds the agent to ignore it', () => {
    const findings = checkProduct('# Product\n\n## Register\n\nbrand\n\n## Positioning\nx\n');
    assert.deepEqual(ids(findings), ['product-deprecated-register']);
    assert.match(findings[0].summary, /visitor modes/);
    assert.match(findings[0].fix, /Treat `## Register` as absent/);
    assert.equal(findings[0].severity, 'mention');
  });

  it('flags an unstamped file carrying none of the current sections', () => {
    const findings = checkProduct('# Product\n\n## Users\nDesigners.\n');
    assert.deepEqual(ids(findings), ['product-schema-legacy']);
    assert.equal(findings[0].severity, 'route');
    assert.match(findings[0].fix, /Offer `init`/);
  });

  it('trusts a current stamp over the section heuristic', () => {
    const stamped = stampProductSchema('# Product\n\n## Users\nDesigners.\n');
    assert.deepEqual(checkProduct(stamped), []);
  });

  it('accepts an unstamped file that has the current sections', () => {
    assert.deepEqual(checkProduct('# Product\n\n## Product Principles\n- One\n'), []);
  });

  it('flags a stamp older than the current schema', () => {
    const findings = checkProduct('# Product\n\n<!-- impeccable:product-schema 0 -->\n\n## Users\nx\n');
    assert.deepEqual(ids(findings), ['product-schema-outdated']);
  });

  it('reports nothing when there is no PRODUCT.md', () => {
    assert.deepEqual(checkProduct(null), []);
  });
});

// ─── native platform evidence ──────────────────────────────────────────────

describe('checkNativePlatformEvidence', () => {
  it('flags a web platform on a project carrying native build files', () => {
    write('ios/Podfile', "platform :ios, '15.0'\n");
    const findings = checkNativePlatformEvidence({
      projectRoot: scratch, platform: 'web', product: CURRENT_PRODUCT, productPath: 'PRODUCT.md',
    });
    assert.deepEqual(ids(findings), ['platform-native-evidence']);
    assert.match(findings[0].summary, /ios\/Podfile/);
    assert.match(findings[0].fix, /`ios`/);
  });

  it('reads react-native and expo out of package.json', () => {
    write('package.json', JSON.stringify({ devDependencies: { expo: '51' } }));
    const findings = checkNativePlatformEvidence({
      projectRoot: scratch, platform: 'web', product: CURRENT_PRODUCT,
    });
    assert.deepEqual(ids(findings), ['platform-native-evidence']);
    assert.match(findings[0].fix, /`adaptive`/);
  });

  it('suggests adaptive when both native targets are present', () => {
    write('ios/Podfile', '');
    write('android/build.gradle', '');
    const findings = checkNativePlatformEvidence({
      projectRoot: scratch, platform: 'web', product: CURRENT_PRODUCT,
    });
    assert.match(findings[0].fix, /`adaptive`/);
  });

  it('says so when the platform field is missing rather than web', () => {
    write('pubspec.yaml', 'name: app\n');
    const findings = checkNativePlatformEvidence({
      projectRoot: scratch, platform: null, product: '# Product\n\n## Users\nx\n',
    });
    assert.match(findings[0].summary, /no `## Platform` section/);
  });

  it('stays silent when the platform is already native', () => {
    write('ios/Podfile', '');
    for (const platform of ['ios', 'android', 'adaptive']) {
      assert.deepEqual(
        checkNativePlatformEvidence({ projectRoot: scratch, platform, product: CURRENT_PRODUCT }),
        [],
        platform,
      );
    }
  });

  it('stays silent on an ordinary web project', () => {
    write('package.json', JSON.stringify({ dependencies: { react: '19' } }));
    assert.deepEqual(
      checkNativePlatformEvidence({ projectRoot: scratch, platform: 'web', product: CURRENT_PRODUCT }),
      [],
    );
  });
});

// ─── design.json sidecar ───────────────────────────────────────────────────

describe('checkDesignSidecar', () => {
  function candidates() {
    return designSidecarCandidatesFor(scratch, scratch);
  }

  it('reports nothing when no sidecar exists anywhere', () => {
    assert.deepEqual(checkDesignSidecar({ sidecarCandidates: candidates(), projectRoot: scratch }), []);
  });

  it('accepts a current sidecar in the canonical location', () => {
    write('.impeccable/design.json', JSON.stringify({ schemaVersion: 2 }));
    assert.deepEqual(checkDesignSidecar({ sidecarCandidates: candidates(), projectRoot: scratch }), []);
  });

  it('flags an outdated schema version as a routable repair', () => {
    write('.impeccable/design.json', JSON.stringify({ schemaVersion: 1 }));
    const findings = checkDesignSidecar({ sidecarCandidates: candidates(), projectRoot: scratch });
    assert.deepEqual(ids(findings), ['design-sidecar-schema-outdated']);
    assert.equal(findings[0].severity, 'route');
    assert.match(findings[0].fix, /Offer `document`/);
  });

  it('treats a missing schemaVersion as an outdated sidecar', () => {
    write('.impeccable/design.json', JSON.stringify({ title: 'x' }));
    assert.deepEqual(
      ids(checkDesignSidecar({ sidecarCandidates: candidates(), projectRoot: scratch })),
      ['design-sidecar-schema-outdated'],
    );
  });

  it('flags a retired location as an automatic migration', () => {
    write('DESIGN.json', JSON.stringify({ schemaVersion: 2 }));
    const findings = checkDesignSidecar({ sidecarCandidates: candidates(), projectRoot: scratch });
    assert.deepEqual(ids(findings), ['design-sidecar-legacy-path']);
    assert.equal(findings[0].severity, 'auto');
    assert.match(findings[0].fix, /\.impeccable\/design\.json/);
  });

  it('flags a sidecar older than the DESIGN.md it extends', () => {
    const sidecar = write('.impeccable/design.json', JSON.stringify({ schemaVersion: 2 }));
    const design = write('DESIGN.md', '---\nname: X\n---\n');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(sidecar, old, old);
    const findings = checkDesignSidecar({
      designPath: design, sidecarCandidates: candidates(), projectRoot: scratch,
    });
    assert.deepEqual(ids(findings), ['design-sidecar-stale']);
    assert.equal(findings[0].severity, 'mention');
  });

  it('does not flag a sidecar newer than DESIGN.md', () => {
    const design = write('DESIGN.md', '---\nname: X\n---\n');
    const sidecar = write('.impeccable/design.json', JSON.stringify({ schemaVersion: 2 }));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(design, old, old);
    fs.utimesSync(sidecar, new Date(), new Date());
    assert.deepEqual(
      checkDesignSidecar({ designPath: design, sidecarCandidates: candidates(), projectRoot: scratch }),
      [],
    );
  });
});

// ─── config.json ───────────────────────────────────────────────────────────

describe('checkConfig', () => {
  it('accepts a config using only recognized keys', () => {
    write('.impeccable/config.json', JSON.stringify({
      updateCheck: true,
      projectRoots: ['apps/*'],
      hook: { enabled: true, consent: 'accepted' },
      detector: { ignoreRules: ['side-tab'], designSystem: { enabled: false } },
    }));
    assert.deepEqual(checkConfig({ projectRoot: scratch, repoRoot: scratch }), []);
  });

  it('flags unrecognized top-level keys', () => {
    write('.impeccable/config.json', JSON.stringify({ updateChek: true }));
    const findings = checkConfig({ projectRoot: scratch, repoRoot: scratch });
    assert.deepEqual(ids(findings), ['config-unknown-keys']);
    assert.match(findings[0].summary, /`updateChek`/);
  });

  it('flags unrecognized detector keys, the singular-typo case', () => {
    write('.impeccable/config.json', JSON.stringify({ detector: { ignoreRule: ['side-tab'] } }));
    const findings = checkConfig({ projectRoot: scratch, repoRoot: scratch });
    assert.deepEqual(ids(findings), ['config-unknown-detector-keys']);
    assert.match(findings[0].summary, /`ignoreRule`/);
  });

  it('checks the local config too', () => {
    write('.impeccable/config.local.json', JSON.stringify({ bogus: 1 }));
    const findings = checkConfig({ projectRoot: scratch, repoRoot: scratch });
    assert.deepEqual(ids(findings), ['config-unknown-keys']);
    assert.match(findings[0].path, /config\.local\.json$/);
  });

  it('does not check the hook subtree, which has many writers', () => {
    write('.impeccable/config.json', JSON.stringify({ hook: { somethingRuntime: true } }));
    assert.deepEqual(checkConfig({ projectRoot: scratch, repoRoot: scratch }), []);
  });

  it('ignores a malformed config rather than reporting it as drift', () => {
    write('.impeccable/config.json', '{ not json');
    assert.deepEqual(checkConfig({ projectRoot: scratch, repoRoot: scratch }), []);
  });

  it('accepts both build-path values', () => {
    for (const value of ['comp', 'code']) {
      write('.impeccable/config.json', JSON.stringify({ buildPath: value }));
      assert.deepEqual(checkConfig({ projectRoot: scratch, repoRoot: scratch }), []);
    }
  });

  it('flags a build-path value nothing reads', () => {
    write('.impeccable/config.json', JSON.stringify({ buildPath: 'code-first' }));
    const findings = checkConfig({ projectRoot: scratch, repoRoot: scratch });
    assert.deepEqual(ids(findings), ['config-invalid-build-path']);
    assert.match(findings[0].summary, /"code-first"/);
  });
});

// ─── build path ────────────────────────────────────────────────────────────

describe('checkBuildPathUnset', () => {
  const args = () => ({ projectRoot: scratch, repoRoot: scratch, product: '# Product' });

  it('flags a project that has done direction work and recorded nothing', () => {
    fs.mkdirSync(path.join(scratch, '.impeccable', 'surfaces'), { recursive: true });
    const findings = checkBuildPathUnset(args());
    assert.deepEqual(ids(findings), ['config-build-path-unset']);
    // The one precondition this module cannot see must reach the reader that can.
    assert.match(findings[0].fix, /image generation/);
  });

  it('accepts decision mocks as the same evidence', () => {
    fs.mkdirSync(path.join(scratch, '.impeccable', 'mocks', 'decision'), { recursive: true });
    assert.deepEqual(ids(checkBuildPathUnset(args())), ['config-build-path-unset']);
  });

  it('stays silent on a project that has never done direction work', () => {
    assert.deepEqual(checkBuildPathUnset(args()), []);
  });

  it('stays silent without a product record, where init already routes', () => {
    fs.mkdirSync(path.join(scratch, '.impeccable', 'surfaces'), { recursive: true });
    assert.deepEqual(checkBuildPathUnset({ ...args(), product: null }), []);
  });

  it('stays silent once a value is recorded, in either config file', () => {
    fs.mkdirSync(path.join(scratch, '.impeccable', 'surfaces'), { recursive: true });
    write('.impeccable/config.json', JSON.stringify({ buildPath: 'code' }));
    assert.deepEqual(checkBuildPathUnset(args()), []);

    fs.rmSync(path.join(scratch, '.impeccable', 'config.json'));
    write('.impeccable/config.local.json', JSON.stringify({ buildPath: 'comp' }));
    assert.deepEqual(checkBuildPathUnset(args()), []);
  });

  it('defers to the invalid-value finding rather than reporting the key twice', () => {
    fs.mkdirSync(path.join(scratch, '.impeccable', 'surfaces'), { recursive: true });
    write('.impeccable/config.json', JSON.stringify({ buildPath: 'comp-first' }));
    assert.deepEqual(checkBuildPathUnset(args()), []);
  });
});

// ─── surface briefs ────────────────────────────────────────────────────────

describe('checkSurfaceBriefs', () => {
  it('flags a brief whose primary target no longer exists', () => {
    const findings = checkSurfaceBriefs({
      projectRoot: scratch,
      candidates: [{ path: '.impeccable/surfaces/pricing.md', primaryTarget: 'src/Pricing.tsx' }],
    });
    assert.deepEqual(ids(findings), ['surface-brief-orphaned']);
    assert.match(findings[0].summary, /src\/Pricing\.tsx/);
  });

  it('accepts a brief whose target is still on disk', () => {
    write('src/Pricing.tsx', 'export default null;\n');
    assert.deepEqual(checkSurfaceBriefs({
      projectRoot: scratch,
      candidates: [{ path: '.impeccable/surfaces/pricing.md', primaryTarget: 'src/Pricing.tsx' }],
    }), []);
  });

  it('skips route and URL targets, which have no file to check', () => {
    assert.deepEqual(checkSurfaceBriefs({
      projectRoot: scratch,
      candidates: [
        { path: 'a.md', primaryTarget: 'route:/pricing' },
        { path: 'b.md', primaryTarget: 'https://example.com/pricing' },
      ],
    }), []);
  });
});

// ─── projectRoots ──────────────────────────────────────────────────────────

describe('checkProjectRoots', () => {
  it('flags patterns that match no directory', () => {
    const findings = checkProjectRoots({ patterns: ['apps/*'], candidates: [] });
    assert.deepEqual(ids(findings), ['config-project-roots-match-nothing']);
    assert.match(findings[0].summary, /`apps\/\*`/);
  });

  it('stays quiet when candidates were discovered', () => {
    assert.deepEqual(checkProjectRoots({ patterns: ['apps/*'], candidates: [{ path: 'apps/web' }] }), []);
  });

  it('stays quiet when only negations are declared', () => {
    assert.deepEqual(checkProjectRoots({ patterns: ['!apps/legacy'], candidates: [] }), []);
  });
});

// ─── notice throttling ─────────────────────────────────────────────────────

describe('staleness notices', () => {
  const mention = { id: 'a', severity: 'mention', summary: 's', fix: 'f', artifact: 'x', path: null };
  const auto = { id: 'b', severity: 'auto', summary: 's', fix: 'f', artifact: 'x', path: null };

  it('passes a finding through once, then suppresses it', () => {
    assert.deepEqual(ids(filterFreshFindings([mention], { projectRoot: scratch })), ['a']);
    assert.deepEqual(filterFreshFindings([mention], { projectRoot: scratch }), []);
  });

  it('re-surfaces a finding once the renotify window has passed', () => {
    const now = Date.now();
    filterFreshFindings([mention], { projectRoot: scratch, now });
    const later = now + 8 * 24 * 60 * 60 * 1000;
    assert.deepEqual(ids(filterFreshFindings([mention], { projectRoot: scratch, now: later })), ['a']);
  });

  it('never throttles auto findings, which the agent needs every session', () => {
    assert.deepEqual(ids(filterFreshFindings([auto], { projectRoot: scratch })), ['b']);
    assert.deepEqual(ids(filterFreshFindings([auto], { projectRoot: scratch })), ['b']);
  });

  it('keys throttling per project', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-stale-other-'));
    try {
      filterFreshFindings([mention], { projectRoot: scratch });
      assert.deepEqual(ids(filterFreshFindings([mention], { projectRoot: other })), ['a']);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('forgets a finding that stopped firing so a recurrence is reported again', () => {
    filterFreshFindings([mention, { ...mention, id: 'c' }], { projectRoot: scratch });
    filterFreshFindings([mention], { projectRoot: scratch });
    assert.deepEqual(ids(filterFreshFindings([{ ...mention, id: 'c' }], { projectRoot: scratch })), ['c']);
  });

  it('renders one directive for the whole set, or nothing', () => {
    assert.equal(buildStalenessDirective([]), null);
    const directive = buildStalenessDirective([mention, auto]);
    assert.equal((directive.match(/CONTEXT_STALE:/g) || []).length, 1);
    assert.match(directive, /Do not stop, reorder, or expand the requested task/);
    assert.match(directive, /Surface the reportable findings once/);
  });

  it('omits the user-facing instruction when every finding is automatic', () => {
    assert.doesNotMatch(buildStalenessDirective([auto]), /Surface the reportable findings/);
  });

  it('honors stalenessCheck false in config, local overriding shared', () => {
    assert.equal(stalenessCheckDisabled([scratch]), false);
    write('.impeccable/config.json', JSON.stringify({ stalenessCheck: false }));
    assert.equal(stalenessCheckDisabled([scratch]), true);
    write('.impeccable/config.local.json', JSON.stringify({ stalenessCheck: true }));
    assert.equal(stalenessCheckDisabled([scratch]), false);
  });

  it('honors the environment opt-out', () => {
    process.env.IMPECCABLE_NO_STALENESS_CHECK = '1';
    try {
      assert.equal(stalenessCheckDisabled([scratch]), true);
    } finally {
      delete process.env.IMPECCABLE_NO_STALENESS_CHECK;
    }
  });
});

// ─── boot integration ──────────────────────────────────────────────────────

describe('context.mjs CONTEXT_STALE directive', () => {
  function run(env = {}) {
    return spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: {
        ...process.env,
        IMPECCABLE_NO_UPDATE_CHECK: '1',
        IMPECCABLE_STALENESS_CACHE: path.join(scratch, 'notice.json'),
        ...env,
      },
    });
  }

  it('emits one directive at boot and throttles the next run', () => {
    write('PRODUCT.md', '# Product\n\n## Register\n\nbrand\n\n## Users\nDesigners.\n');
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /CONTEXT_STALE:/);
    assert.match(first.stdout, /product-deprecated-register/);
    assert.equal((first.stdout.match(/CONTEXT_STALE:/g) || []).length, 1);
    // Context itself still leads; staleness never replaces it.
    assert.match(first.stdout, /^# PRODUCT\.md/);

    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /CONTEXT_STALE:/);
  });

  it('says nothing on a current project', () => {
    write('PRODUCT.md', CURRENT_PRODUCT);
    const res = run();
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /CONTEXT_STALE:/);
  });

  it('respects IMPECCABLE_NO_STALENESS_CHECK', () => {
    write('PRODUCT.md', '# Product\n\n## Register\n\nbrand\n');
    const res = run({ IMPECCABLE_NO_STALENESS_CHECK: '1' });
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /CONTEXT_STALE:/);
  });

  it('checks sidecar and config drift with no PRODUCT.md present', () => {
    write('.impeccable/design.json', JSON.stringify({ schemaVersion: 1 }));
    write('.impeccable/config.json', JSON.stringify({ detector: { ignoreRule: [] } }));
    const res = run();
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /NO_PRODUCT_MD:/);
    assert.match(res.stdout, /design-sidecar-schema-outdated/);
    assert.match(res.stdout, /config-unknown-detector-keys/);
  });

  it('leaves the native-platform question to init when no PRODUCT.md exists', () => {
    write('ios/Podfile', '');
    write('src/app.css', ':root { --a: 1; --b: 2; --c: 3; }\n');
    const res = run();
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /platform-native-evidence/);
  });

  it('flags projectRoots globs that match nothing in a monorepo', () => {
    write('package.json', JSON.stringify({ name: 'root', workspaces: ['apps/*'] }));
    write('.impeccable/config.json', JSON.stringify({ projectRoots: ['services/*'] }));
    write('PRODUCT.md', CURRENT_PRODUCT);
    const res = run();
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /config-project-roots-match-nothing/);
  });
});
