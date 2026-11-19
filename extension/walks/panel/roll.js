/**
 * One line of text that rolls into the next. Letters both lines share slide to their new places; the others leave
 * upwards and fade, while the new ones rise in from below, each a little after its neighbour. Drawn as a function of
 * time, so drawing it again carries on where it was. The letters are hidden from screen readers.
 */
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp = (x) => Math.min(1, Math.max(0, x));

/** The letters two lines share, in order, as [index in a, index in b]: the longest such run. Spaces don't count. */
function shared(a, b) {
  const same = (i, j) => a[i] === b[j] && a[i] !== ' ';
  const len = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) len[i][j] = same(i, j) ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  }
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (same(i, j)) pairs.push([i++, j++]);
    else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

export class RollText {
  /** `steps` are `{ at, text }` in seconds; each line after the first rolls in over `duration` seconds from its `at`. */
  constructor(el, { duration }) {
    const style = getComputedStyle(el);
    Object.assign(this, { el, duration, steps: [] });
    this.height = parseFloat(style.lineHeight);
    this.ctx = document.createElement('canvas').getContext('2d');
    this.ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    Object.assign(el.style, { position: 'relative', display: 'inline-block', height: `${this.height}px` });
  }

  renderAt(t) {
    const i = Math.max(0, this.steps.findLastIndex((step) => step.at <= t));
    if (i !== this.shown) {
      this.shown = i;
      this.build(this.steps[i - 1]?.text ?? this.steps[i].text, this.steps[i].text);
    }
    this.draw(i ? clamp((t - this.steps[i].at) / this.duration) : 1);
  }

  /** Where each letter of a line starts, and the line's width. */
  measure(text) {
    return { x: [...text].map((_, i) => this.ctx.measureText(text.slice(0, i)).width), width: this.ctx.measureText(text).width };
  }

  build(from, to) {
    const a = this.measure(from), b = this.measure(to);
    const pairs = shared(from, to);
    const moves = new Map(pairs), arrived = new Set(pairs.map(([, j]) => j));
    const letter = (ch, props) => {
      const span = Object.assign(document.createElement('span'), { textContent: ch });
      span.setAttribute('aria-hidden', 'true');
      Object.assign(span.style, { position: 'absolute', left: '0', top: '0', whiteSpace: 'pre' });
      return { span, ...props };
    };
    this.letters = [
      ...[...from].map((ch, i) => (moves.has(i)
        ? letter(ch, { x: a.x[i], to: b.x[moves.get(i)] })
        : letter(ch, { x: a.x[i], out: true, order: i / from.length }))),
      ...[...to].flatMap((ch, j) => (arrived.has(j) ? [] : [letter(ch, { x: b.x[j], in: true, order: j / to.length })])),
    ];
    this.widths = [a.width, b.width];
    this.el.replaceChildren(...this.letters.map((l) => l.span));
  }

  /** The roll at `p`, from 0 (the old line) to 1 (the new one). */
  draw(p) {
    const [w0, w1] = this.widths, rise = this.height * 0.6;
    this.el.style.width = `${w0 + (w1 - w0) * ease(p)}px`;
    for (const l of this.letters) {
      let x = l.x, y = 0, shown = 1, blur = 0;
      if (l.out || l.in) {
        const q = ease(clamp((p - (l.in ? 0.2 : 0) - l.order * 0.3) / 0.5));
        y = l.out ? -rise * q : rise * (1 - q);
        shown = l.out ? 1 - q : q;
        blur = 4 * (1 - shown);
      } else {
        const q = ease(p);
        x += (l.to - l.x) * q;
        blur = Math.sin(Math.PI * q);
      }
      Object.assign(l.span.style, { transform: `translate(${x}px, ${y}px)`, opacity: shown, filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '' });
    }
  }
}
