// Parse a DESIGN.md (Stitch-spec format) into a structured JSON model that
// the live-mode design-system panel can render. Deterministic, dependency-free.
//
// Two-layer: YAML frontmatter (machine-readable tokens) + markdown body
// (prose with eight canonical H2 sections). When frontmatter is present, it's
// exposed on `model.frontmatter` alongside the prose-scraped sections;
// consumers can prefer frontmatter values and fall back to prose.

// Array order is also match precedence: matchCanonicalSection's keyword-contained
// pass returns the first entry a heading contains, so reordering this changes
// which section an ambiguous heading resolves to.
const CANONICAL_SECTIONS = [
  'Overview',
  'Colors',
  'Typography',
  'Layout',
  'Elevation',
  'Shapes',
  'Components',
  "Do's and Don'ts",
];

// ---------- Frontmatter (Stitch YAML subset) ----------

function parseFrontmatter(md) {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { frontmatter: null, body: md };

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { frontmatter: null, body: md };

  const yaml = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');
  try {
    return { frontmatter: parseYamlSubset(yaml), body };
  } catch {
    return { frontmatter: null, body: md };
  }
}

// Minimal YAML reader for the Stitch frontmatter subset: scalar maps with
// one level of nested objects (typography roles, components). Indent-based,
// 2-space convention. No arrays, no anchors, no multi-line scalars — Stitch's
// schema doesn't need them and accepting them would require a real YAML
// dependency we don't want to vendor.
function parseYamlSubset(yaml) {
  const lines = yaml.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (const raw of lines) {
    // Skip blanks and line-only comments. Don't strip inline comments:
    // unquoted hex values start with `#` and can't be safely distinguished
    // from a comment after whitespace.
    if (!raw.trim() || /^\s*#/.test(raw)) continue;

    const indent = raw.match(/^\s*/)[0].length;
    const content = raw.slice(indent);

    const colonIdx = findTopLevelColon(content);
    if (colonIdx === -1) continue;

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const key = unquoteYamlKey(content.slice(0, colonIdx).trim());
    const rest = stripInlineYamlComment(content.slice(colonIdx + 1).trim());
    const parent = stack[stack.length - 1].obj;

    if (rest === '') {
      const obj = {};
      parent[key] = obj;
      stack.push({ indent, obj });
    } else {
      parent[key] = parseScalar(rest);
    }
  }

  return root;
}

function findTopLevelColon(s) {
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === inQuote && s[i - 1] !== '\\') inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ':') {
      return i;
    }
  }
  return -1;
}

function unquoteYamlKey(key) {
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return key.slice(1, -1);
  }
  return key;
}

function stripInlineYamlComment(s) {
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === inQuote && s[i - 1] !== '\\') inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '#' && i > 0 && /\s/.test(s[i - 1])) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

// YAML double-quoted scalars process backslash escapes. Stripping the outer
// quotes without unescaping leaves them in place, so a nested font family like
//   fontFamily: "\"IBM Plex Sans\", system-ui, sans-serif"
// keeps its literal backslashes and never matches the same family in CSS.
// The full YAML 1.2 double-quote escape set (spec section 5.7).
const YAML_SIMPLE_ESCAPES = {
  '0': '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\u0085',
  _: '\u00a0',
  L: '\u2028',
  P: '\u2029',
};
const YAML_HEX_ESCAPE_LENGTHS = { x: 2, u: 4, U: 8 };

function unescapeYamlDoubleQuoted(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\' || i === body.length - 1) {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (Object.prototype.hasOwnProperty.call(YAML_SIMPLE_ESCAPES, next)) {
      out += YAML_SIMPLE_ESCAPES[next];
      i++;
      continue;
    }
    // \xNN, \uNNNN, \UNNNNNNNN. Malformed or out-of-range sequences stay
    // literal rather than corrupting the rest of the scalar.
    const hexLen = YAML_HEX_ESCAPE_LENGTHS[next];
    if (hexLen) {
      const hex = body.slice(i + 2, i + 2 + hexLen);
      const codePoint = hex.length === hexLen && /^[0-9a-fA-F]+$/.test(hex) ? parseInt(hex, 16) : -1;
      if (codePoint >= 0 && codePoint <= 0x10ffff) {
        out += String.fromCodePoint(codePoint);
        i += 1 + hexLen;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return unescapeYamlDoubleQuoted(s.slice(1, -1));
  }
  // Single-quoted YAML escapes only the quote itself, by doubling it.
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).split("''").join("'");
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  return s;
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const OKLCH_RE = /oklch\([^)]+\)/gi;

// ---------- Section splitting ----------

function splitSections(md) {
  const lines = md.split(/\r?\n/);
  let title = null;
  const sections = {};
  let current = null;

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!title && line.startsWith('# ') && !line.startsWith('## ')) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }

    const h2 = line.match(/^##\s+(?:\d+\.\s*)?([^:\n]+?)(?::\s*(.+))?$/);
    if (h2) {
      const rawName = normalizeApostrophes(h2[1].trim());
      const subtitle = h2[2] ? h2[2].trim() : null;
      const canonical = matchCanonicalSection(rawName);
      if (canonical) {
        current = { name: canonical, subtitle, lines: [] };
        sections[canonical] = current;
        continue;
      }
      // non-canonical H2 — ignore but stop feeding into current
      current = null;
      continue;
    }

    if (current) current.lines.push(raw);
  }

  return { title, sections };
}

function normalizeApostrophes(s) {
  return s.replace(/[\u2018\u2019]/g, "'");
}

function matchCanonicalSection(name) {
  const normalized = normalizeApostrophes(name).toLowerCase();
  // Exact match first
  for (const c of CANONICAL_SECTIONS) {
    if (normalizeApostrophes(c).toLowerCase() === normalized) return c;
  }
  // Keyword-contained match: "Overview & Creative North Star" -> "Overview",
  // "Elevation & Depth" -> "Elevation", etc.
  for (const c of CANONICAL_SECTIONS) {
    const key = normalizeApostrophes(c).toLowerCase();
    const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (pattern.test(normalized)) return c;
  }
  return null;
}

// ---------- Subsection splitting (inside a canonical section) ----------

function splitSubsections(lines) {
  const subs = [];
  let current = { name: null, lines: [] };
  subs.push(current);

  for (const raw of lines) {
    const h3 = raw.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      current = { name: h3[1].trim(), lines: [] };
      subs.push(current);
      continue;
    }
    current.lines.push(raw);
  }

  return subs;
}

// ---------- Generic helpers ----------

function collectParagraphs(lines) {
  const paragraphs = [];
  let buf = [];
  const flush = () => {
    if (buf.length) {
      paragraphs.push(buf.join(' ').trim());
      buf = [];
    }
  };
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '') { flush(); continue; }
    // Horizontal rules (---, ***) and headings/bullets end a paragraph.
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flush(); continue; }
    if (raw.startsWith('#') || raw.match(/^[-*]\s/)) { flush(); continue; }
    buf.push(trimmed);
  }
  flush();
  return paragraphs.filter(Boolean);
}

function collectBullets(lines) {
  const bullets = [];
  let current = null;
  for (const raw of lines) {
    const m = raw.match(/^\s*[-*]\s+(.+)$/);
    if (m) {
      if (current) bullets.push(current);
      current = m[1];
      continue;
    }
    // continuation of a bullet (indented line)
    if (current && raw.match(/^\s{2,}\S/)) {
      current += ' ' + raw.trim();
      continue;
    }
    // blank line ends a bullet
    if (raw.trim() === '' && current) {
      bullets.push(current);
      current = null;
    }
  }
  if (current) bullets.push(current);
  return bullets;
}

function stripBold(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '$1');
}

function extractNamedRules(lines) {
  const rules = [];
  const seen = new Set();

  // Style A (Impeccable): "**The X Rule.** body body body" — can span lines.
  const joined = lines.join('\n');
  const inlineStart = /\*\*(The [^*]+?Rule)\.\*\*/g;
  const inlineMatches = [];
  let m;
  while ((m = inlineStart.exec(joined)) !== null) {
    inlineMatches.push({ name: m[1], start: m.index, end: inlineStart.lastIndex });
  }
  for (let i = 0; i < inlineMatches.length; i++) {
    const mm = inlineMatches[i];
    const bodyEnd = i + 1 < inlineMatches.length ? inlineMatches[i + 1].start : joined.length;
    const body = joined
      .slice(mm.end, bodyEnd)
      .replace(/\n##[^\n]*$/s, '')
      .replace(/\n###[^\n]*$/s, '')
      .trim();
    const name = stripBold(mm.name).trim();
    seen.add(name.toLowerCase());
    rules.push({ name, body: stripBold(body) });
  }

  // Style B (Stitch): `### The "X" Rule` or `### The X Fallback`, body is the
  // bullets/paragraphs until the next heading. Accept Rule / Fallback / Principle.
  for (let i = 0; i < lines.length; i++) {
    const h3 = lines[i].match(/^###\s+(.+?)\s*$/);
    if (!h3) continue;
    const headerName = stripBold(h3[1]).replace(/["“”]/g, '').trim();
    if (!/^The\b.*\b(Rule|Fallback|Principle)\b/i.test(headerName)) continue;
    if (seen.has(headerName.toLowerCase())) continue;

    const bodyLines = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^##\s|^###\s/.test(lines[j])) break;
      bodyLines.push(lines[j]);
    }
    const body = stripBold(bodyLines.join('\n').replace(/\n+/g, ' ')).trim();
    if (body) {
      seen.add(headerName.toLowerCase());
      rules.push({ name: headerName, body });
    }
  }

  // Style C (Stitch bullet form): "*   **The Layering Principle:** body"
  // Colon/period lives inside the bold, so match "**...**" then inspect.
  for (const b of collectBullets(lines)) {
    const mm = b.match(/^\*\*([^*]+?)\*\*\s*(.+)$/);
    if (!mm) continue;
    const nameRaw = mm[1].replace(/[.:]\s*$/, '').replace(/["“”]/g, '').trim();
    if (!/^The\b.+\b(Rule|Fallback|Principle)$/i.test(nameRaw)) continue;
    if (seen.has(nameRaw.toLowerCase())) continue;
    seen.add(nameRaw.toLowerCase());
    rules.push({ name: nameRaw, body: stripBold(mm[2]).trim() });
  }

  return rules;
}

// ---------- Per-section extractors ----------

function extractOverview(section) {
  if (!section) return null;
  const text = section.lines.join('\n');
  const northStar = text.match(/\*\*Creative North Star:\s*"([^"]+)"\*\*/);
  const keyCharMatch = text.match(/\*\*Key Characteristics:\*\*\s*\n([\s\S]+?)(?:\n##|\n###|$)/);
  const keyChars = keyCharMatch
    ? collectBullets(keyCharMatch[1].split('\n')).map((bullet) => stripBold(bullet.trim()))
    : [];
  const prose = keyCharMatch
    ? text.slice(0, keyCharMatch.index) + text.slice(keyCharMatch.index + keyCharMatch[0].length)
    : text;

  // Philosophy paragraphs: everything that isn't a rule header or key-char block
  const paragraphs = collectParagraphs(prose.split('\n')).filter(
    (p) =>
      !p.startsWith('**Creative North Star') &&
      !p.startsWith('**Key Characteristics')
  );

  return {
    subtitle: section.subtitle,
    creativeNorthStar: northStar ? northStar[1] : null,
    philosophy: paragraphs,
    keyCharacteristics: keyChars,
  };
}

function extractColors(section) {
  if (!section) return null;
  const subs = splitSubsections(section.lines);

  const description = collectParagraphs(subs[0].lines).join(' ');
  const groups = [];
  const ROLE_KEYWORDS = /^(primary|secondary|tertiary|neutral|accent)\b/i;

  for (const sub of subs.slice(1)) {
    if (!sub.name || /Named Rules?/i.test(sub.name) || /^The\s/i.test(sub.name)) continue;

    const bullets = collectBullets(sub.lines);
    const parsed = bullets.map((b) => parseColorBullet(b)).filter(Boolean);
    if (parsed.length === 0) continue;

    // If every bullet starts with a role keyword (Primary/Secondary/...), promote
    // each bullet to its own group. Otherwise keep the subsection as the group.
    const allRoleBullets =
      parsed.length > 0 && parsed.every((p) => p.name && ROLE_KEYWORDS.test(p.name));

    if (allRoleBullets) {
      for (const p of parsed) {
        groups.push({ role: p.name, colors: [p] });
      }
    } else {
      groups.push({ role: sub.name, colors: parsed });
    }
  }

  // If the Colors section has no subsections at all (unlikely), fall back to
  // scanning the whole section as a flat bullet list.
  if (groups.length === 0) {
    const flat = collectBullets(section.lines)
      .map((b) => parseColorBullet(b))
      .filter(Boolean);
    if (flat.length) {
      for (const p of flat) {
        if (p.name && ROLE_KEYWORDS.test(p.name)) {
          groups.push({ role: p.name, colors: [p] });
        } else {
          const fallback = groups.find((g) => g.role === 'Palette');
          if (fallback) fallback.colors.push(p);
          else groups.push({ role: 'Palette', colors: [p] });
        }
      }
    }
  }

  return {
    subtitle: section.subtitle,
    description: description || null,
    groups,
    rules: extractNamedRules(section.lines),
  };
}

function parseColorBullet(bullet) {
  const text = bullet.trim();

  // Case 1 (Impeccable): **Name** (value-with-maybe-nested-parens): description
  const bold = text.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  if (bold && bold[2].startsWith('(')) {
    const value = extractParenGroup(bold[2]);
    if (value !== null) {
      const after = bold[2].slice(value.length + 2).trimStart();
      if (after.startsWith(':')) {
        return buildColor(bold[1], value, after.slice(1).trim());
      }
    }
  }

  // Case 2 (Stitch): **Name (values):** description   — value embedded in bold.
  const stitch = text.match(/^\*\*([^*]+?)\s*\(([^)]+)\):\*\*\s*(.*)$/);
  if (stitch) {
    return buildColor(stitch[1].trim(), stitch[2], stitch[3]);
  }

  // Case 3: bullet without bold, just hex/oklch inside.
  const values = collectColorValues(text);
  if (values.length) {
    return buildColor(null, values.join(' to '), text);
  }
  return null;
}

function extractParenGroup(s) {
  if (s[0] !== '(') return null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return s.slice(1, i);
    }
  }
  return null;
}

function buildColor(name, rawValue, description) {
  const values = collectColorValues(rawValue);
  const primary = values[0] ?? rawValue.trim();
  return {
    name: name ? stripBold(name).trim() : null,
    value: primary,
    valueRange: values.length > 1 ? values : null,
    format: detectFormat(primary),
    description: stripBold(description || '').trim() || null,
  };
}

function collectColorValues(s) {
  const out = [];
  s.replace(HEX_RE, (v) => {
    out.push(v);
    return v;
  });
  s.replace(OKLCH_RE, (v) => {
    out.push(v);
    return v;
  });
  return out;
}

function detectFormat(v) {
  if (!v) return 'unknown';
  if (v.startsWith('#')) return 'hex';
  if (/^oklch/i.test(v)) return 'oklch';
  if (/^rgb/i.test(v)) return 'rgb';
  return 'unknown';
}

function extractTypography(section) {
  if (!section) return null;
  const text = section.lines.join('\n');

  const fonts = {};
  // Pattern A: **Display Font:** Family (with fallback)
  const fontLineRe = /\*\*([\w\s/]+?)Font:\*\*\s*([^\n(]+?)(?:\s*\(with\s+([^)]+)\))?\s*$/gm;
  let fm;
  while ((fm = fontLineRe.exec(text)) !== null) {
    const rawRole = fm[1].trim().toLowerCase().replace(/\s+/g, '-');
    const role = normalizeFontRole(rawRole) || 'display';
    fonts[role] = {
      family: fm[2].trim(),
      fallback: fm[3] ? fm[3].trim() : null,
    };
  }

  // Pattern B (Stitch): *   **Display & Headlines (Noto Serif):** description
  if (Object.keys(fonts).length === 0) {
    const stitchRe = /\*\*([\w\s&/]+?)\s*\(([^)]+)\):\*\*\s*(.+)/g;
    let sm;
    while ((sm = stitchRe.exec(text)) !== null) {
      const rawRole = sm[1]
        .trim()
        .toLowerCase()
        .replace(/\s*&\s*/g, '-')
        .replace(/\s+/g, '-');
      const role = normalizeFontRole(rawRole) || rawRole;
      fonts[role] = { family: sm[2].trim(), fallback: null, purpose: sm[3].trim() };
    }
  }

  // Character paragraph — either a **Character:** label, or fall back to the
  // first free paragraph under the section header (Stitch style).
  const characterMatch = text.match(/\*\*Character:\*\*\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\n|\n###|\n##|$)/);
  let character = characterMatch ? characterMatch[1].replace(/\n/g, ' ').trim() : null;
  if (!character) {
    const paragraphs = collectParagraphs(section.lines).filter(
      (p) => !/^\*\*[\w\s/&]+Font/i.test(p) && !/^\*\*[\w\s/&]+\([^)]+\)/.test(p)
    );
    if (paragraphs.length) character = paragraphs[0];
  }

  // Hierarchy bullets under ### Hierarchy
  const subs = splitSubsections(section.lines);
  let hierarchy = [];
  const hierSub = subs.find((s) => s.name && /hierarch/i.test(s.name));
  if (hierSub) {
    const bullets = collectBullets(hierSub.lines);
    hierarchy = bullets.map(parseTypeBullet).filter(Boolean);
  }

  return {
    subtitle: section.subtitle,
    fonts,
    character,
    hierarchy,
    rules: extractNamedRules(section.lines),
  };
}

function normalizeFontRole(raw) {
  // Canonical roles the panel cares about: display, body, label, mono.
  // Stitch often writes compound roles like "display-&-headlines" or "ui-&-body"
  // — collapse them to the first canonical role present.
  const tokens = raw.split(/[-/&\s]+/).filter(Boolean);
  const priority = ['display', 'headline', 'body', 'ui', 'label', 'mono'];
  const canonical = { headline: 'display', ui: 'body' };
  for (const p of priority) {
    if (tokens.includes(p)) return canonical[p] || p;
  }
  return null;
}

function parseTypeBullet(bullet) {
  // - **Display** (family, weight 300, italic, clamp(...), line-height 1): purpose
  const m = bullet.match(/^\*\*(.+?)\*\*\s*\(([^)]+)\):\s*(.*)$/);
  if (!m) return null;
  const name = m[1].trim();
  const specs = m[2].split(',').map((s) => s.trim());
  return {
    name,
    specs,
    purpose: stripBold(m[3] || '').trim() || null,
  };
}

function extractGuidance(section) {
  if (!section) return null;
  const subs = splitSubsections(section.lines);
  return {
    subtitle: section.subtitle,
    description: collectParagraphs(subs[0].lines).join(' ') || null,
    rules: extractNamedRules(section.lines),
  };
}

function extractElevation(section) {
  const guidance = extractGuidance(section);
  if (!guidance) return null;

  const shadows = [];
  const seen = new Set();
  const dedupe = (entry) => {
    const key = (entry.name || '') + '::' + entry.value;
    if (seen.has(key)) return;
    seen.add(key);
    shadows.push(entry);
  };

  for (const b of collectBullets(section.lines)) {
    const parsed = parseShadowBullet(b);
    if (parsed) dedupe(parsed);
  }

  // Fallback: extract shadows written inline in prose. Stitch style is
  //   "...use an extra-diffused shadow: `box-shadow: 0 12px 40px rgba(...)`."
  for (const p of collectParagraphs(section.lines)) {
    for (const inline of extractInlineShadows(p)) dedupe(inline);
  }
  for (const b of collectBullets(section.lines)) {
    for (const inline of extractInlineShadows(b)) dedupe(inline);
  }

  return { ...guidance, shadows };
}

function extractInlineShadows(text) {
  // Find `box-shadow: ...` anywhere in prose and capture the value. Work on the
  // raw string so it handles both backtick-fenced and unfenced variants.
  const out = [];
  const re = /box-shadow\s*:\s*([^`;\n]+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = m[1].replace(/[`.)]+$/, '').trim();
    if (!value) continue;
    // Name heuristic: the noun immediately before the shadow phrase.
    // e.g. "an extra-diffused shadow: ..." -> "extra-diffused shadow"
    const before = text.slice(0, m.index);
    const nameMatch = before.match(/\b([A-Za-z][A-Za-z\- ]{2,40})\s+shadow\b[^A-Za-z0-9]*$/i);
    let name = null;
    if (nameMatch) {
      const stripped = nameMatch[1]
        .replace(/^(?:use|using|apply|applying|is|are|looks? like)\s+/i, '')
        .replace(/^(?:a|an|the)\s+/i, '')
        .trim();
      if (stripped) {
        name =
          stripped.charAt(0).toUpperCase() + stripped.slice(1) + ' shadow';
      }
    }
    out.push({
      name,
      value,
      purpose: null,
    });
  }
  return out;
}

function parseShadowBullet(bullet) {
  // - **Name** (`box-shadow: value`): purpose
  // - **Name** (`value`): purpose
  // Only accept if the paren content looks like a shadow value (contains px,
  // rem, rgba, or box-shadow). This filters out `**Rule Name:**` bullets.
  const m = bullet.match(/^\*\*(.+?)\*\*\s*\(`?([^`]+?)`?\):\s*(.*)$/);
  if (!m) return null;
  const rawValue = m[2].replace(/^box-shadow:\s*/i, '').trim();
  const looksLikeShadow =
    /box-shadow|rgba?\(|\bpx\b|\brem\b|^-?\d+\s/i.test(rawValue) &&
    /\d/.test(rawValue);
  if (!looksLikeShadow) return null;
  const name = stripBold(m[1]).trim();
  return {
    name,
    value: rawValue,
    purpose: stripBold(m[3] || '').trim() || null,
  };
}

function extractComponents(section) {
  if (!section) return null;
  const subs = splitSubsections(section.lines);
  const components = [];

  for (const sub of subs.slice(1)) {
    if (!sub.name) continue;

    const bullets = collectBullets(sub.lines);
    const paragraphs = collectParagraphs(sub.lines);

    const variants = [];
    const properties = {};

    for (const b of bullets) {
      // - **Key:** value
      const m = b.match(/^\*\*(.+?):?\*\*:?\s*(.+)$/);
      if (m) {
        const key = stripBold(m[1]).trim();
        const value = stripBold(m[2]).trim();
        // Heuristic: "Primary", "Secondary", "Hover", "Focus" etc are variants;
        // "Shape", "Background", "Padding" are properties.
        if (/^(primary|secondary|tertiary|ghost|hover|focus|active|disabled|default|error|selected|unselected|state)$/i.test(key.split(/[\s/]/)[0])) {
          variants.push({ name: key, description: value });
        } else {
          properties[key.toLowerCase()] = value;
        }
      }
    }

    components.push({
      name: sub.name,
      description: paragraphs.join(' ') || null,
      properties,
      variants,
    });
  }

  return {
    subtitle: section.subtitle,
    components,
  };
}

function extractDosDonts(section) {
  if (!section) return null;
  const subs = splitSubsections(section.lines);
  const dos = [];
  const donts = [];

  for (const sub of subs.slice(1)) {
    if (!sub.name) continue;
    const subName = normalizeApostrophes(sub.name);
    const bullets = collectBullets(sub.lines).map((b) => stripBold(b).trim());
    if (/^do'?t?:?$/i.test(subName) || /^do:?$/i.test(subName)) {
      dos.push(...bullets);
    } else if (/^don'?t:?$/i.test(subName)) {
      donts.push(...bullets);
    }
  }

  // Classify by bullet prefix as a backup (catches loose bullets outside H3 wrappers)
  for (const b of collectBullets(section.lines)) {
    const stripped = normalizeApostrophes(stripBold(b).trim());
    if (/^don'?t\b/i.test(stripped)) {
      if (!donts.some((d) => normalizeApostrophes(d) === stripped)) donts.push(stripped);
    } else if (/^do\b/i.test(stripped)) {
      if (!dos.some((d) => normalizeApostrophes(d) === stripped)) dos.push(stripped);
    }
  }

  return { dos, donts };
}

// ---------- Coverage assessment ----------

// Sections whose model is description-plus-rules only (see extractGuidance).
const guidanceCoverage = (guidance) =>
  guidance
    ? {
        description: Boolean(guidance.description),
        rules: guidance.rules.length,
      }
    : 'missing';

function assessCoverage(model) {
  const report = {};

  report.overview = model.overview
    ? {
        northStar: Boolean(model.overview.creativeNorthStar),
        philosophy: model.overview.philosophy.length > 0,
        keyCharacteristics: model.overview.keyCharacteristics.length,
      }
    : 'missing';

  report.colors = model.colors
    ? {
        groups: model.colors.groups.length,
        totalColors: model.colors.groups.reduce((n, g) => n + g.colors.length, 0),
        rules: model.colors.rules.length,
      }
    : 'missing';

  report.typography = model.typography
    ? {
        fonts: Object.keys(model.typography.fonts).length,
        hierarchyEntries: model.typography.hierarchy.length,
        character: Boolean(model.typography.character),
        rules: model.typography.rules.length,
      }
    : 'missing';

  report.layout = guidanceCoverage(model.layout);

  report.elevation = model.elevation
    ? {
        shadows: model.elevation.shadows.length,
        rules: model.elevation.rules.length,
        description: Boolean(model.elevation.description),
      }
    : 'missing';

  report.shapes = guidanceCoverage(model.shapes);

  report.components = model.components
    ? {
        count: model.components.components.length,
        variantTotal: model.components.components.reduce((n, c) => n + c.variants.length, 0),
      }
    : 'missing';

  report.dosDonts = model.dosDonts
    ? {
        dos: model.dosDonts.dos.length,
        donts: model.dosDonts.donts.length,
      }
    : 'missing';

  return report;
}

// ---------- Main ----------

export function parseDesignMd(md) {
  const { frontmatter, body } = parseFrontmatter(md);
  const { title, sections } = splitSections(body);
  return {
    schemaVersion: 2,
    title,
    frontmatter,
    overview: extractOverview(sections['Overview']),
    colors: extractColors(sections['Colors']),
    typography: extractTypography(sections['Typography']),
    layout: extractGuidance(sections['Layout']),
    elevation: extractElevation(sections['Elevation']),
    shapes: extractGuidance(sections['Shapes']),
    components: extractComponents(sections['Components']),
    dosDonts: extractDosDonts(sections["Do's and Don'ts"]),
  };
}

export { assessCoverage };
