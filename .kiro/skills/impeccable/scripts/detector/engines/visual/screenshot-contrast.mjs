function sanitizeScreenshotClip(clip, viewport) {
  if (!clip) return null;
  const x = Math.max(0, Math.floor(clip.x || 0));
  const y = Math.max(0, Math.floor(clip.y || 0));
  const width = Math.min(
    Math.max(1, Math.ceil(clip.width || 0)),
    Math.max(1, viewport?.width || 1600),
  );
  const height = Math.min(
    Math.max(1, Math.ceil(clip.height || 0)),
    320,
  );
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

async function compareScreenshotContrast(page, beforeBase64, afterBase64, candidate) {
  return page.evaluate(async ({ beforeBase64, afterBase64, candidate }) => {
    const loadImage = (base64) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode contrast screenshot'));
      img.src = `data:image/png;base64,${base64}`;
    });
    const [before, after] = await Promise.all([loadImage(beforeBase64), loadImage(afterBase64)]);
    const width = Math.min(before.width, after.width);
    const height = Math.min(before.height, after.height);
    if (width < 1 || height < 1) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(before, 0, 0, width, height);
    const beforePixels = ctx.getImageData(0, 0, width, height).data;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(after, 0, 0, width, height);
    const afterPixels = ctx.getImageData(0, 0, width, height).data;

    const luminance = ({ r, g, b }) => {
      const convert = c => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * convert(r) + 0.7152 * convert(g) + 0.0722 * convert(b);
    };
    const ratio = (a, b) => {
      const l1 = luminance(a);
      const l2 = luminance(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const APCA = {
      mainTRC: 2.4,
      sRco: 0.2126729,
      sGco: 0.7151522,
      sBco: 0.0721750,
      normBG: 0.56,
      normTXT: 0.57,
      revTXT: 0.62,
      revBG: 0.65,
      blkThrs: 0.022,
      blkClmp: 1.414,
      scaleBoW: 1.14,
      scaleWoB: 1.14,
      loBoWoffset: 0.027,
      loWoBoffset: 0.027,
      deltaYmin: 0.0005,
      loClip: 0.1,
    };
    const apcaY = ({ r, g, b }) => {
      const toLinear = channel => Math.pow(channel / 255, APCA.mainTRC);
      return APCA.sRco * toLinear(r) + APCA.sGco * toLinear(g) + APCA.sBco * toLinear(b);
    };
    const apcaContrast = (textColor, backgroundColor) => {
      let textY = apcaY(textColor);
      let backgroundY = apcaY(backgroundColor);
      const isOutOfRange = Number.isNaN(textY)
        || Number.isNaN(backgroundY)
        || Math.min(textY, backgroundY) < 0
        || Math.max(textY, backgroundY) > 1.1;
      if (isOutOfRange) return 0;

      textY = textY > APCA.blkThrs ? textY : textY + Math.pow(APCA.blkThrs - textY, APCA.blkClmp);
      backgroundY = backgroundY > APCA.blkThrs
        ? backgroundY
        : backgroundY + Math.pow(APCA.blkThrs - backgroundY, APCA.blkClmp);

      if (Math.abs(backgroundY - textY) < APCA.deltaYmin) return 0;
      if (backgroundY > textY) {
        const contrast = (Math.pow(backgroundY, APCA.normBG) - Math.pow(textY, APCA.normTXT)) * APCA.scaleBoW;
        return (contrast < APCA.loClip ? 0 : contrast - APCA.loBoWoffset) * 100;
      }

      const contrast = (Math.pow(backgroundY, APCA.revBG) - Math.pow(textY, APCA.revTXT)) * APCA.scaleWoB;
      return (contrast > -APCA.loClip ? 0 : contrast + APCA.loWoBoffset) * 100;
    };
    const apcaThreshold = (bgColor) => {
      if (candidate.isStyledButton) return 45;
      const tag = candidate.tagName || '';
      const fontSize = candidate.fontSize || 16;
      const fontWeight = candidate.fontWeight || 400;
      if (['h1', 'h2', 'h3'].includes(tag) && (fontSize >= 24 || fontWeight >= 700)) return 45;
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) return 60;

      const text = (candidate.text || '').trim();
      const wordCount = Number.isFinite(candidate.wordCount)
        ? candidate.wordCount
        : (text ? text.split(/\s+/).length : 0);
      if (luminance(bgColor) < 0.02 || wordCount >= 12) return 60;
      return 45;
    };

    const cssTextColor = candidate.textColor && !candidate.preferRenderedForeground
      ? {
          r: candidate.textColor.r,
          g: candidate.textColor.g,
          b: candidate.textColor.b,
        }
      : null;
    const samples = [];
    let glyphPixels = 0;
    let strongestDelta = 0;
    for (let i = 0; i < beforePixels.length; i += 4) {
      const delta = Math.abs(beforePixels[i] - afterPixels[i])
        + Math.abs(beforePixels[i + 1] - afterPixels[i + 1])
        + Math.abs(beforePixels[i + 2] - afterPixels[i + 2])
        + Math.abs(beforePixels[i + 3] - afterPixels[i + 3]);
      strongestDelta = Math.max(strongestDelta, delta);
      if (delta < 10) continue;
      glyphPixels++;
      const fg = cssTextColor || {
        r: beforePixels[i],
        g: beforePixels[i + 1],
        b: beforePixels[i + 2],
      };
      const bg = {
        r: afterPixels[i],
        g: afterPixels[i + 1],
        b: afterPixels[i + 2],
      };
      const lc = apcaContrast(fg, bg);
      const threshold = apcaThreshold(bg);
      samples.push({
        lc,
        threshold,
        ratio: ratio(fg, bg),
        margin: Math.abs(lc ?? 0) - threshold,
      });
    }

    if (samples.length < 8) {
      return {
        glyphPixels,
        strongestDelta,
        worstLc: null,
        p10Lc: null,
        p10Threshold: null,
        p10Ratio: null,
        medianRatio: null,
      };
    }

    samples.sort((a, b) => a.margin - b.margin);
    const pick = pct => samples[Math.min(samples.length - 1, Math.max(0, Math.floor((pct / 100) * samples.length)))];
    const p10 = pick(10);
    const median = pick(50);
    return {
      glyphPixels,
      strongestDelta,
      worstLc: samples[0].lc,
      p10Lc: p10.lc,
      p10Threshold: p10.threshold,
      p10Ratio: p10.ratio,
      medianLc: median.lc,
      medianRatio: median.ratio,
    };
  }, { beforeBase64, afterBase64, candidate });
}

async function captureVisualContrastCandidate(page, candidate, viewport) {
  const clip = sanitizeScreenshotClip(candidate.clip, viewport);
  if (!clip) return null;

  const beforeBase64 = await page.screenshot({
    encoding: 'base64',
    clip,
    captureBeyondViewport: true,
  });
  const token = `impeccable-contrast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const applied = await page.evaluate(({ selector, token, backgroundClipText }) => {
    let el;
    try {
      el = document.querySelector(selector);
    } catch {
      return false;
    }
    if (!el) return false;
    let style = document.getElementById('impeccable-visual-contrast-hide-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'impeccable-visual-contrast-hide-style';
      style.textContent = [
        '[data-impeccable-visual-contrast-target] {',
        '  color: transparent !important;',
        '  -webkit-text-fill-color: transparent !important;',
        '  text-shadow: none !important;',
        '}',
        '[data-impeccable-visual-contrast-target][data-impeccable-bgclip-text="true"] {',
        '  background-image: none !important;',
        '}',
      ].join('\n');
      document.head.appendChild(style);
    }
    el.setAttribute('data-impeccable-visual-contrast-target', token);
    if (backgroundClipText) el.setAttribute('data-impeccable-bgclip-text', 'true');
    return true;
  }, {
    selector: candidate.selector,
    token,
    backgroundClipText: candidate.backgroundClipText,
  });
  if (!applied) return null;

  let afterBase64;
  try {
    afterBase64 = await page.screenshot({
      encoding: 'base64',
      clip,
      captureBeyondViewport: true,
    });
  } finally {
    await page.evaluate(({ selector }) => {
      try {
        const el = document.querySelector(selector);
        if (el) {
          el.removeAttribute('data-impeccable-visual-contrast-target');
          el.removeAttribute('data-impeccable-bgclip-text');
        }
      } catch {
        // Ignore invalid or stale selectors during cleanup.
      }
    }, { selector: candidate.selector }).catch(() => {});
  }

  const metrics = await compareScreenshotContrast(page, beforeBase64, afterBase64, candidate);
  if (!metrics || !Number.isFinite(metrics.p10Lc) || !Number.isFinite(metrics.p10Threshold) || metrics.glyphPixels < 8) return null;
  if (Math.abs(metrics.p10Lc) >= metrics.p10Threshold) return null;
  const textLabel = candidate.text ? ` "${candidate.text}"` : '';
  const reasonLabel = (candidate.reasons || []).slice(0, 3).join(', ') || 'visual background';
  const wcagThreshold = candidate.wcagThreshold || 4.5;
  return {
    id: 'low-contrast',
    snippet: `pixel APCA contrast Lc ${Math.round(metrics.p10Lc)} median ${Math.round(metrics.medianLc ?? 0)} (target ${metrics.p10Threshold}; WCAG ${metrics.p10Ratio.toFixed(1)}:1/${wcagThreshold}:1) on ${reasonLabel}${textLabel}`,
  };
}

export {
  sanitizeScreenshotClip,
  compareScreenshotContrast,
  captureVisualContrastCandidate,
};
