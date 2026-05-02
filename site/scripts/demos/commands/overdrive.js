// Overdrive command demo - laser-etched signature on a premium dark surface
// Laser effect adapted from pbakaus/shaders laser-precision

export default {
  id: 'overdrive',
  caption: 'Static flat card → Laser-etched signature effect',

  before: `
    <div style="width: 100%; height: 100%; min-height: 200px; display: flex; align-items: center; justify-content: center; background: #f5f5f5; font-family: system-ui, sans-serif;">
      <div style="text-align: center; padding: 20px;">
        <div style="font-size: 12px; color: #666; font-style: italic; line-height: 1.6; max-width: 220px; margin-bottom: 16px;">It's time to spark your imagination. Welcome to the Impeccable Community.</div>
        <div style="font-size: 12px; color: #aaa;">Paul Bakaus</div>
      </div>
    </div>
  `,

  after: `
    <canvas class="od-burn" style="position: absolute; inset: 0; width: 100%; height: 100%; background: #0e0d0b;"></canvas>
    <canvas class="od-sparks" style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;"></canvas>
    <div style="position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; pointer-events: none; text-align: center;">
      <p style="font-family: 'Cormorant Garamond', serif; font-size: 1.1rem; font-style: italic; font-weight: 400; color: rgba(240,230,210,0.85); line-height: 1.5; max-width: 260px; margin: 0 0 24px;">It's time to spark your imagination.<br>Welcome to the Impeccable Community.</p>
    </div>
  `,

  init(container) {
    const burnCanvas = container.querySelector('.od-burn');
    const sparkCanvas = container.querySelector('.od-sparks');
    if (!burnCanvas || !sparkCanvas) return;

    const rect = burnCanvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Size both canvases
    for (const c of [burnCanvas, sparkCanvas]) {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    }

    const ctx = burnCanvas.getContext('2d');  // persistent burn trails
    const sCtx = sparkCanvas.getContext('2d'); // cleared each frame
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;

    // Fill background
    ctx.fillStyle = '#0e0d0b';
    ctx.fillRect(0, 0, w, h);

    // ── Signature paths — two separate strokes ──
    function buildSignaturePaths() {
      function makePath(buildFn) {
        const pts = [];
        function bez(x0,y0, cx1,cy1, cx2,cy2, x1,y1, n) {
          for (let i = 0; i <= n; i++) {
            const t = i / n, mt = 1-t;
            pts.push({
              x: mt*mt*mt*x0 + 3*mt*mt*t*cx1 + 3*mt*t*t*cx2 + t*t*t*x1,
              y: mt*mt*mt*y0 + 3*mt*mt*t*cy1 + 3*mt*t*t*cy2 + t*t*t*y1
            });
          }
        }
        buildFn(bez);
        return pts;
      }

      const paul = makePath(bez => {
        // P
        bez(6,44, 5,32, 4,18, 8,8, 14);
        bez(8,8, 16,5, 26,7, 26,16, 12);
        bez(26,16, 26,22, 18,26, 14,28, 10);
        // a
        bez(14,28, 18,22, 23,20, 26,22, 8);
        bez(26,22, 29,24, 28,30, 24,32, 6);
        bez(24,32, 28,34, 30,30, 32,28, 5);
        // u
        bez(32,28, 34,36, 38,40, 42,32, 8);
        bez(42,32, 44,26, 47,24, 48,28, 6);
        // l
        bez(48,28, 49,16, 50,6, 53,8, 10);
        bez(53,8, 55,14, 56,28, 58,32, 8);
      });

      const bakaus = makePath(bez => {
        // B
        bez(66,44, 66,32, 67,16, 70,8, 14);
        bez(70,8, 78,4, 83,10, 79,18, 12);
        bez(79,18, 84,15, 87,24, 80,30, 12);
        bez(80,30, 78,34, 80,36, 84,32, 5);
        // akaus
        bez(84,32, 89,24, 94,22, 97,26, 8);
        bez(97,26, 99,30, 96,34, 100,30, 5);
        bez(100,30, 101,20, 102,14, 104,16, 8);
        bez(104,16, 106,24, 109,28, 107,32, 6);
        bez(107,32, 105,36, 110,36, 113,30, 6);
        bez(113,30, 118,24, 122,22, 125,28, 8);
        bez(125,28, 128,36, 133,38, 137,30, 8);
        bez(137,30, 139,26, 142,24, 144,28, 5);
        bez(144,28, 154,24, 170,22, 195,28, 16);
      });

      // Scale both paths
      const rawW = 200;
      const scale = (w * 0.7) / rawW;
      const ox = (w - rawW * scale) / 2;
      const oy = h * 0.52;
      const transform = p => ({ x: p.x * scale + ox, y: p.y * scale * 0.75 + oy });
      return [paul.map(transform), bakaus.map(transform)];
    }

    const strokes = buildSignaturePaths();

    // Precompute lengths for each stroke
    function computeLengths(pts) {
      const lens = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
        const l = Math.sqrt(dx*dx + dy*dy);
        lens.push(l); total += l;
      }
      return { lens, total };
    }

    const strokeData = strokes.map(pts => {
      const { lens, total } = computeLengths(pts);
      return { pts, lens, total };
    });

    function posAtStroke(stroke, dist) {
      let d = 0;
      for (let i = 0; i < stroke.lens.length; i++) {
        if (d + stroke.lens[i] >= dist) {
          const t = stroke.lens[i] > 0 ? (dist - d) / stroke.lens[i] : 0;
          const p0 = stroke.pts[i], p1 = stroke.pts[i+1];
          return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
        }
        d += stroke.lens[i];
      }
      return stroke.pts[stroke.pts.length - 1];
    }

    const totalLength = strokeData.reduce((s, d) => s + d.total, 0);

    // ── State ──
    let currentStroke = 0;
    let drawnLength = 0;
    const drawSpeed = totalLength / 3.0;
    let prevTip = strokes[0][0];
    let sparks = [];
    let phase = 'drawing'; // drawing, lifting, holding, fading
    let phaseTimer = 0;
    let lastTime = 0;

    // Track drawn points per stroke for smooth rendering
    const allDrawnStrokes = [[], []];

    function drawBurnTrail() {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      function strokeSmooth(pts, color, width) {
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i+1].x) / 2;
          const my = (pts[i].y + pts[i+1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      }

      // Draw all accumulated strokes
      for (const pts of allDrawnStrokes) {
        strokeSmooth(pts, 'rgba(180, 100, 30, 0.12)', 5);
        strokeSmooth(pts, 'rgba(220, 140, 50, 0.3)', 2.5);
        strokeSmooth(pts, 'rgba(255, 210, 130, 0.7)', 1.2);
        strokeSmooth(pts, 'rgba(255, 248, 235, 0.6)', 0.4);
      }
    }

    function emitSparks(x, y, count) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 140;
        sparks.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: 0.15 + Math.random() * 0.35, maxLife: 0.15 + Math.random() * 0.35,
          size: 0.3 + Math.random() * 1.0, bright: Math.random() > 0.4
        });
      }
    }

    function draw(timestamp) {
      if (!document.contains(burnCanvas)) return;

      // Actual frame delta time
      if (!lastTime) lastTime = timestamp;
      const dt = Math.min(0.05, (timestamp - lastTime) / 1000);
      lastTime = timestamp;

      switch (phase) {
        case 'drawing': {
          const sd = strokeData[currentStroke];
          drawnLength += drawSpeed * dt;
          if (drawnLength >= sd.total) {
            drawnLength = sd.total;
            emitSparks(prevTip.x, prevTip.y, 6);
            if (currentStroke < strokes.length - 1) {
              // Lift — pause briefly before starting next stroke
              phase = 'lifting';
              phaseTimer = 0;
            } else {
              phase = 'holding';
              phaseTimer = 0;
            }
          }
          const tip = posAtStroke(sd, drawnLength);
          allDrawnStrokes[currentStroke].push({ x: tip.x, y: tip.y });
          prevTip = tip;
          if (Math.random() < 0.4) emitSparks(tip.x, tip.y, 1);
          // Redraw full smooth trail
          ctx.fillStyle = '#0e0d0b';
          ctx.fillRect(0, 0, w, h);
          drawBurnTrail();
          break;
        }

        case 'lifting':
          phaseTimer += dt;
          if (phaseTimer >= 0.25) {
            currentStroke++;
            drawnLength = 0;
            prevTip = strokes[currentStroke][0];
            phase = 'drawing';
            phaseTimer = 0;
          }
          break;

        case 'holding':
          phaseTimer += dt;
          if (phaseTimer >= 3.5) { phase = 'fading'; phaseTimer = 0; }
          break;

        case 'fading':
          phaseTimer += dt;
          ctx.fillStyle = 'rgba(14, 13, 11, 0.04)';
          ctx.fillRect(0, 0, w, h);
          if (phaseTimer >= 2.0) {
            ctx.fillStyle = '#0e0d0b';
            ctx.fillRect(0, 0, w, h);
            currentStroke = 0; drawnLength = 0;
            prevTip = strokes[0][0];
            sparks = [];
            allDrawnStrokes[0].length = 0;
            allDrawnStrokes[1].length = 0;
            phase = 'drawing'; phaseTimer = 0;
          }
          break;
      }

      // Update sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.vx *= 0.94; s.vy *= 0.94; s.vy += 100 * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
      }

      // Draw sparks + tip on overlay (cleared each frame)
      sCtx.clearRect(0, 0, w, h);

      for (const s of sparks) {
        const t = s.life / s.maxLife;
        const r = s.size * (0.3 + t * 0.7);
        // Spark trail
        const speed = Math.sqrt(s.vx*s.vx + s.vy*s.vy);
        if (speed > 20) {
          const tl = speed * 0.01;
          sCtx.beginPath();
          sCtx.moveTo(s.x, s.y);
          sCtx.lineTo(s.x - s.vx/speed * tl, s.y - s.vy/speed * tl);
          sCtx.strokeStyle = s.bright
            ? `rgba(255,255,240,${(t*0.4).toFixed(3)})`
            : `rgba(255,180,60,${(t*0.3).toFixed(3)})`;
          sCtx.lineWidth = r * 0.5;
          sCtx.lineCap = 'round';
          sCtx.stroke();
        }
        sCtx.beginPath();
        sCtx.arc(s.x, s.y, r, 0, Math.PI * 2);
        sCtx.fillStyle = s.bright
          ? `rgba(255,255,255,${(t*0.85).toFixed(3)})`
          : `rgba(255,200,80,${(t*0.75).toFixed(3)})`;
        sCtx.fill();
      }

      // Draw laser tip on overlay
      if (phase === 'drawing' && drawnLength < strokeData[currentStroke].total) {
        const tip = posAtStroke(strokeData[currentStroke], drawnLength);
        const fl = 0.85 + Math.random() * 0.15;

        // Wide heat bloom
        const g0 = sCtx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 35);
        g0.addColorStop(0, `rgba(255,100,20,${0.15*fl})`);
        g0.addColorStop(0.4, `rgba(200,60,10,${0.05*fl})`);
        g0.addColorStop(1, 'rgba(150,40,10,0)');
        sCtx.fillStyle = g0; sCtx.beginPath(); sCtx.arc(tip.x, tip.y, 35, 0, Math.PI*2); sCtx.fill();

        // Amber corona
        const g1 = sCtx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 16);
        g1.addColorStop(0, `rgba(255,180,60,${0.45*fl})`);
        g1.addColorStop(0.5, `rgba(255,140,40,${0.15*fl})`);
        g1.addColorStop(1, 'rgba(200,80,20,0)');
        sCtx.fillStyle = g1; sCtx.beginPath(); sCtx.arc(tip.x, tip.y, 16, 0, Math.PI*2); sCtx.fill();

        // White-hot core
        const g2 = sCtx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 6);
        g2.addColorStop(0, `rgba(255,255,255,${0.95*fl})`);
        g2.addColorStop(0.3, `rgba(255,250,240,${0.7*fl})`);
        g2.addColorStop(0.6, `rgba(255,220,160,${0.3*fl})`);
        g2.addColorStop(1, 'rgba(255,180,80,0)');
        sCtx.fillStyle = g2; sCtx.beginPath(); sCtx.arc(tip.x, tip.y, 6, 0, Math.PI*2); sCtx.fill();

        // Overexposed center
        const g3 = sCtx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 2.5);
        g3.addColorStop(0, `rgba(255,255,255,${fl})`);
        g3.addColorStop(1, 'rgba(255,255,255,0)');
        sCtx.fillStyle = g3; sCtx.beginPath(); sCtx.arc(tip.x, tip.y, 2.5, 0, Math.PI*2); sCtx.fill();
      }

      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
  }
};
