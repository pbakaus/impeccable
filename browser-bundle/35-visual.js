// --- browser-bundle/35-visual.js ---
// Visual-contrast sampling. Only the async / IO acts live here (image
// loading, canvas pixel reads, scrollIntoView, paint waits) plus the
// control flow that awaits them; every decision — candidate gates,
// reasons, sample points, painted-rect math, thresholds, blending, method
// and reason strings, percentiles, the result objects — is a call into the
// WASM core (crates/core/src/browser/visual.rs via `IO.core('vc_*', ...)`).
//
// The same orchestration runs in two places, so the IO is an adapter:
//   - in the page (50-scan.js): nodes are Elements, the core is called
//     synchronously, images and canvases are right here;
//   - in the extension's offscreen document (60-offscreen.js): nodes are
//     snapshot ids, the core runs over the snapshot and its hit-test needs
//     are answered by the content script between calls, images and pixels
//     are read by the content script and travel back as facts.
//
// createVisualContrast(IO) -> { collectVisualContrastCandidates(options),
//   analyzeVisualContrastCandidate(candidate), analyzeVisualContrast(options),
//   waitForVisualPaint() }
//
// IO contract (N = the adapter's node representation):
//   core(fn, ...args)          -> Promise<result>  wasm export by name
//   coreSync(fn, ...args)      -> result           (only used by the sync
//                                 candidate collector; offscreen may throw)
//   node(handle) / handle(N)   handle <-> N
//   parentOrBody(N)            -> N   (`node.parentElement || document.body`)
//   intrinsicImg(N)            -> [w, h]  naturalWidth||videoWidth||width
//   intrinsicRaster(N)         -> [w, h]  width||videoWidth
//   imgSrc(N)                  -> currentSrc || src || ''
//   loadImage(src)             -> Promise<{ ref, w, h } | null>
//   readPixel(ref, plan, px, py) -> Promise<{ data } | { error } | { noContext }>
//                                 ref is an N (page drawable) or a loadImage ref
//   querySelector(selector)    -> N | null   (scroll retry only)
//   scroll()                   -> { x, y }
//   scrollTo(x, y), scrollIntoView(N), waitForPaint() -> Promise

function createVisualContrast(IO) {
  const __j = JSON.stringify;
  const __p = JSON.parse;
  const core = async (fn, ...args) => __p(await IO.core(fn, ...args));
  const coreRaw = (fn, ...args) => IO.core(fn, ...args);

  function collectVisualContrastCandidates(options = {}) {
    return __p(IO.coreSync('collect_visual_contrast_candidates', __j({
      maxCandidates: options.maxCandidates,
      imageOnly: options.imageOnly,
    })));
  }

  async function collectVisualContrastCandidatesAsync(options = {}) {
    return core('collect_visual_contrast_candidates', __j({
      maxCandidates: options.maxCandidates,
      imageOnly: options.imageOnly,
    }));
  }

  // Draw the drawable to a (cached) canvas and read one pixel: the plan and
  // the pixel address come from the core, the read from the IO.
  async function sampleDrawablePixel(ref, intrinsic, sourcePoint) {
    const plan = await core('vc_raster_plan', intrinsic[0], intrinsic[1]);
    const px = await core('vc_raster_pixel', __j(plan), sourcePoint.x, sourcePoint.y);
    const read = await IO.readPixel(ref, plan, px.x, px.y);
    if (read.noContext) return core('vc_raster_no_context_sample');
    if (read.error !== undefined) {
      const reason = await coreRaw('vc_raster_error_reason', read.error || '');
      return core('vc_raster_failure_sample', reason);
    }
    const d = read.data;
    return core('vc_pixel_sample', d[0], d[1], d[2], d[3]);
  }

  async function sampleCssBackground(node, point, textColor) {
    const plan = await core('vc_css_plan', IO.handle(node), __j(textColor));
    if (plan.kind === 'sample') return plan.sample;
    // A url() layer: load, map the point onto the painted image, read a pixel.
    const img = await IO.loadImage(plan.url);
    if (!img) return core('vc_css_url_no_image');
    const src = await core('vc_css_url_source_point', IO.handle(node), img.w, img.h, plan.size, plan.position, point.x, point.y);
    if (!src.point) return src.sample;
    return core('vc_css_url_finish', __j(await sampleDrawablePixel(img.ref, [img.w, img.h], src.point)));
  }

  async function sampleImageElement(imgNode, point) {
    const intrinsic = IO.intrinsicImg(imgNode);
    const geo = await core('vc_img_source_point', IO.handle(imgNode), intrinsic[0], intrinsic[1], point.x, point.y);
    if (!geo.point) return geo.sample;
    const sample = await sampleDrawablePixel(imgNode, intrinsic, geo.point);
    const finished = await core('vc_img_finish', __j(sample));
    if (finished.status === 'sampled') return finished;

    const src = IO.imgSrc(imgNode);
    if (src) {
      const loaded = await IO.loadImage(src);
      if (loaded) {
        const loadedPoint = await core('vc_img_loaded_source_point', __j(geo.painted), loaded.w, loaded.h, point.x, point.y);
        if (loadedPoint) {
          const loadedSample = await core('vc_img_finish', __j(await sampleDrawablePixel(loaded.ref, [loaded.w, loaded.h], loadedPoint)));
          if (loadedSample.status === 'sampled') return loadedSample;
        }
      }
    }
    return sample;
  }

  async function sampleVisualBackgroundAtPoint(el, point, textColor, depth = 0) {
    const walk = await core('vc_stack_nodes', IO.handle(el), point.x, point.y, depth);
    if (walk.unresolved) return walk.unresolved;
    const nodes = walk.nodes.map(n => ({ node: IO.node(n.el), kind: n.kind }));
    const unresolved = [];

    for (const { node, kind } of nodes) {
      if (kind === 'img') {
        const sample = await sampleImageElement(node, point);
        if (sample.status === 'sampled') return sample;
        unresolved.push(sample.reason);
        continue;
      }
      if (kind === 'raster') {
        const intrinsic = IO.intrinsicRaster(node);
        const sourcePoint = await core('vc_raster_source_point', IO.handle(node), intrinsic[0], intrinsic[1], point.x, point.y);
        if (sourcePoint) {
          const sample = await core('vc_raster_finish', IO.handle(node), __j(await sampleDrawablePixel(node, intrinsic, sourcePoint)));
          if (sample.status === 'sampled') return sample;
          unresolved.push(sample.reason);
        }
        continue;
      }
      const sample = await sampleCssBackground(node, point, textColor);
      if (sample.status === 'sampled') {
        if (await IO.core('vc_sample_is_opaque', __j(sample))) return sample;
        const parent = IO.parentOrBody(node);
        const under = await sampleVisualBackgroundAtPoint(parent, point, textColor, depth + 1);
        return core('vc_alpha_composite', __j(sample), __j(under));
      }
      unresolved.push(sample.reason);
    }

    return core('vc_unresolved_from_reasons', __j(unresolved));
  }

  async function analyzeVisualContrastCandidate(candidate) {
    const prepared = await core('vc_prepare_analysis', __j(candidate));
    if (prepared.early) return prepared.early;
    const el = IO.node(prepared.el);
    const samples = [];
    for (const point of prepared.points) {
      samples.push(await sampleVisualBackgroundAtPoint(el, point, prepared.textColor));
    }
    return core('vc_finish_analysis', __j(candidate), __j(prepared.textColor), __j(samples), prepared.points.length);
  }

  function waitForVisualPaint() {
    return IO.waitForPaint();
  }

  async function analyzeVisualContrast(options = {}) {
    // imageOnly is enforced inside the collector, before the candidate cap.
    const candidates = await collectVisualContrastCandidatesAsync(options);
    const results = [];
    const shouldScrollOffscreen = options.scrollOffscreen === true;
    const restoreScroll = IO.scroll();
    for (const candidate of candidates) {
      if (shouldScrollOffscreen) {
        const now = IO.scroll();
        if (now.x !== restoreScroll.x || now.y !== restoreScroll.y) {
          IO.scrollTo(restoreScroll.x, restoreScroll.y);
          await waitForVisualPaint();
        }
      }
      let result = await analyzeVisualContrastCandidate(candidate);
      if (shouldScrollOffscreen && await IO.core('vc_needs_scroll_retry', __j(result))) {
        const el = IO.querySelector(candidate.selector);
        if (el && IO.scrollIntoView(el)) {
          await waitForVisualPaint();
          result = await analyzeVisualContrastCandidate(candidate);
        }
      }
      results.push(result);
    }
    if (shouldScrollOffscreen) {
      const now = IO.scroll();
      if (now.x !== restoreScroll.x || now.y !== restoreScroll.y) IO.scrollTo(restoreScroll.x, restoreScroll.y);
    }
    return results;
  }

  return { collectVisualContrastCandidates, analyzeVisualContrastCandidate, analyzeVisualContrast, waitForVisualPaint };
}

// The in-page adapter: live Elements, the wasm namespace, this document.
// Elements (never handles) cross the awaits: a re-scan resets the probe
// registry, so a handle is only valid until the next await.
function createInPageVisualIO(wasm) {
  const io = __createDrawableIO();
  return {
    core: (fn, ...args) => wasm[fn](...args),
    coreSync: (fn, ...args) => wasm[fn](...args),
    node: (handle) => __el(handle),
    handle: (el) => __intern(el),
    parentOrBody: (el) => el.parentElement || document.body,
    intrinsicImg: (d) => [d.naturalWidth || d.videoWidth || d.width || 0, d.naturalHeight || d.videoHeight || d.height || 0],
    intrinsicRaster: (d) => [d.width || d.videoWidth || 0, d.height || d.videoHeight || 0],
    imgSrc: (img) => img.currentSrc || img.src || '',
    async loadImage(src) {
      const img = await io.loadImageEl(src);
      if (!img) return null;
      return { ref: img, w: img.naturalWidth || img.width || 0, h: img.naturalHeight || img.height || 0 };
    },
    readPixel: (drawable, plan, px, py) => io.readPixel(drawable, plan, px, py),
    querySelector(selector) {
      try { return document.querySelector(selector); } catch { return null; }
    },
    scroll: () => ({ x: window.scrollX, y: window.scrollY }),
    scrollTo: (x, y) => window.scrollTo(x, y),
    scrollIntoView(el) {
      if (typeof el.scrollIntoView !== 'function') return false;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      return true;
    },
    waitForPaint: () => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }),
  };
}
