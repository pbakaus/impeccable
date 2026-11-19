// A line of text that morphs from one string to the next: letters the two share slide to their new places, the rest
// roll out upward and in from below, staggered, with a little blur. Drawn from a timeline, so any moment can be drawn
// again (a redraw carries on where it was).
//
//   const line = new RollText(el, { duration: 0.5 });
//   line.steps = [{ at: 0, text: 'One' }, { at: 2.6, text: 'Two' }];
//   line.renderAt(t);   // t in seconds
//
// The element keeps its own font; the line height comes from its computed line-height. Measure after the font loads.
const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const clamp = v => Math.min(Math.max(v, 0), 1);

// Longest common subsequence of two strings, as matched index pairs: the
// letters that stay on screen and slide instead of rolling.
function sharedLetters(a, b) {
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

export class RollText {
  constructor(el, { duration = 0.45, stagger = 0.014, rise = 0.9 } = {}) {
    this.el = el;
    this.duration = duration;   // seconds each letter takes to roll or slide
    this.stagger = stagger;     // seconds between neighbouring letters starting
    this.rise = rise;           // how far a letter rolls, in line heights
    this.steps = [];
    this.cache = new Map();
    this.ctx = document.createElement('canvas').getContext('2d');
    Object.assign(el.style, {
      position: 'relative', display: 'inline-block', whiteSpace: 'pre', verticalAlign: 'bottom',
      // Soft top and bottom edges so a rolling letter fades at the line's edge instead of being cut
      maskImage: 'linear-gradient(transparent, #000 12%, #000 88%, transparent)',
      webkitMaskImage: 'linear-gradient(transparent, #000 12%, #000 88%, transparent)',
    });
  }

  // Each letter's x position (prefix widths, so kerning is kept) and the line's width.
  measure(text) {
    if (!this.cache.has(text)) {
      this.ctx.font = getComputedStyle(this.el).font;
      const chars = [...text];
      const xs = chars.map((_, i) => this.ctx.measureText(chars.slice(0, i).join('')).width);
      this.cache.set(text, { chars, xs, width: this.ctx.measureText(text).width });
    }
    return this.cache.get(text);
  }

  renderAt(t) {
    if (!this.steps.length) return;
    let k = 0;
    this.steps.forEach((s, i) => { if (s.at <= t) k = i; });
    const cur = this.measure(this.steps[k].text);
    const prev = k > 0 && t >= this.steps[0].at ? this.measure(this.steps[k - 1].text) : null;
    const local = t - this.steps[k].at;
    const lh = parseFloat(getComputedStyle(this.el).lineHeight);
    this.el.style.height = `${lh}px`;
    this.el.setAttribute('aria-label', this.steps[k].text);
    const glyphs = [];
    const glyph = (c, x, y = 0, o = 1, blur = 0) => glyphs.push({ c, x, y, o, blur });

    if (!prev || local >= this.duration + this.stagger * (prev.chars.length + cur.chars.length)) {
      cur.chars.forEach((c, i) => glyph(c, cur.xs[i]));
      this.el.style.width = `${cur.width}px`;
    } else {
      const pairs = sharedLetters(prev.chars, cur.chars);
      const kept = new Set(pairs.map(p => p[0])), arrived = new Set(pairs.map(p => p[1]));
      const p = ease(clamp(local / this.duration));
      pairs.forEach(([i, j]) => glyph(cur.chars[j], prev.xs[i] + (cur.xs[j] - prev.xs[i]) * p));
      let r = 0;
      prev.chars.forEach((c, i) => {
        if (kept.has(i)) return;
        const q = ease(clamp((local - r++ * this.stagger) / (this.duration * 0.8)));
        glyph(c, prev.xs[i], -q * lh * this.rise, 1 - q, q * 2);
      });
      r = 0;
      cur.chars.forEach((c, j) => {
        if (arrived.has(j)) return;
        const q = ease(clamp((local - 0.06 - r++ * this.stagger) / (this.duration * 0.8)));
        glyph(c, cur.xs[j], (1 - q) * lh * this.rise, q, (1 - q) * 2);
      });
      this.el.style.width = `${prev.width + (cur.width - prev.width) * p}px`;
    }

    // Reuse one span per glyph slot
    while (this.el.children.length < glyphs.length) {
      const s = document.createElement('span');
      s.setAttribute('aria-hidden', 'true');
      s.style.cssText = `position:absolute;left:0;top:0;line-height:${lh}px`;
      this.el.append(s);
    }
    [...this.el.children].forEach((s, i) => {
      const g = glyphs[i];
      s.style.display = g ? '' : 'none';
      if (!g) return;
      s.textContent = g.c;
      s.style.transform = `translate(${g.x}px, ${g.y}px)`;
      s.style.opacity = g.o;
      s.style.filter = g.blur > 0.01 ? `blur(${g.blur}px)` : '';
    });
  }
}
