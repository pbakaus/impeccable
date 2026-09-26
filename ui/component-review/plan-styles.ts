/** Plan and asset review styles. Same family as styles.ts: patina teal, quiet greys, Albert Sans with
 * Alumni Sans for the title. Region colours are chosen to stay legible over arbitrary comp artwork. */
export const planStyles = `
:host{display:block;height:var(--component-review-height,100dvh);min-height:0;overflow:hidden;color:var(--ink);font:14px/1.45 var(--font-sans,Arial,sans-serif);
 --ink:var(--color-text,#232a26);--muted:#5d6862;--faint:#8a948e;--line:#d7dcd5;--line-strong:#bfc7bd;
 --bg:#e8ebe6;--canvas:#dde1dc;--surface:#fff;--dock:#f6f7f4;
 --teal:var(--color-patina,#28625e);--teal-ink:#1f4d4a;--teal-wash:#e6efeb;
 --warn:#9a5418;--warn-wash:#fbf0e2;--warn-line:#e7c49c;
 --asset:#17857a;--plan:#3a4750;--flag:#d27a1c;--missing:#b8412c;--danger:#9d3423;--danger-wash:#fbebe7}
*{box-sizing:border-box}
h1,h2,p,figure,fieldset{margin:0}fieldset{border:0;padding:0}
button,input,textarea{font:inherit;color:inherit}
button{cursor:pointer;border:1px solid var(--line-strong);border-radius:5px;background:var(--surface);padding:7px 12px;min-height:36px;display:inline-flex;align-items:center;justify-content:center;gap:7px;transition:background-color .12s,border-color .12s,color .12s}
button:hover:not(:disabled){border-color:var(--teal);color:var(--teal)}
button:disabled{cursor:default;opacity:.45}
:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
svg{width:16px;height:16px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
kbd{font:10px/1 var(--font-mono,monospace);padding:3px 4px;border-radius:3px;border:1px solid currentColor;opacity:.55;margin-left:2px}
textarea,input:not([type=radio]){width:100%;display:block;margin-top:6px;background:var(--surface);border:1px solid var(--line-strong);border-radius:5px;padding:8px 10px;line-height:1.4}
textarea{resize:vertical;min-height:64px}
textarea:focus,input:focus{outline:2px solid var(--teal);outline-offset:0;border-color:var(--teal)}
.primary{background:var(--teal);border-color:var(--teal);color:#fff;font-weight:600}
.primary:hover:not(:disabled){background:var(--teal-ink);border-color:var(--teal-ink);color:#fff}
.secondary{background:var(--surface);border-color:var(--teal);color:var(--teal);font-weight:500}
.secondary:hover:not(:disabled){background:var(--teal-wash)}
.ghost{background:transparent;border-color:transparent;color:var(--muted)}
.ghost:hover:not(:disabled){background:#e9ede8;border-color:transparent;color:var(--ink)}
.link{border:0;background:none;padding:0 2px;min-height:0;color:var(--teal);text-decoration:underline;text-underline-offset:2px}

.plan-review{height:100%;display:flex;flex-direction:column;min-height:0;background:var(--bg)}
.plan-review>header{flex-shrink:0;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:16px 24px 14px;background:var(--surface);border-bottom:1px solid var(--line)}
.titles{min-width:0}
h1{font:400 32px/1 var(--font-display,Arial,sans-serif);letter-spacing:-.01em}
.titles p{margin-top:6px;color:var(--muted);font-size:13px}
.meta{display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;justify-content:flex-end;font-size:12px;color:var(--muted);white-space:nowrap}
.meta .surface{color:var(--ink);font-weight:500;max-width:32ch;overflow:hidden;text-overflow:ellipsis}
.badge{border:1px solid var(--line-strong);border-radius:99px;padding:2px 9px;font-size:11px}

.banner{flex-shrink:0;display:flex;align-items:center;gap:12px;padding:10px 24px;border-bottom:1px solid}
.banner>svg{width:18px;height:18px}
.banner>div{flex:1;min-width:0}.banner strong{font-weight:600}.banner p{font-size:13px}
.banner.stale{background:var(--warn-wash);border-color:var(--warn-line);color:#5e3610}
.banner.error{background:var(--danger-wash);border-color:#ecc3ba;color:#62200f}
.banner.done{background:var(--teal-wash);border-color:#c2d6cf;color:var(--teal-ink)}
.banner button{flex-shrink:0}

.queue{flex-shrink:0;display:flex;align-items:center;gap:16px;padding:10px 24px;background:var(--dock);border-bottom:1px solid var(--line);min-width:0}
.queue-head{flex-shrink:0;display:flex;flex-direction:column;gap:1px}
.queue-head h2{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.queue-head span{font:12px var(--font-mono,monospace);color:var(--faint)}
.queue-list{flex:1;min-width:0;display:flex;gap:8px;overflow-x:auto;padding:2px 28px 2px 2px;scrollbar-width:thin;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}
.queue-empty{font-size:13px;color:var(--muted);align-self:center}
.chip{flex:0 0 auto;justify-content:flex-start;gap:10px;padding:5px 10px 5px 5px;min-height:52px;max-width:260px;text-align:left;background:var(--surface);border-color:var(--line)}
.chip[aria-current=true]{border-color:var(--teal);box-shadow:inset 0 0 0 1px var(--teal);color:inherit}
.chip:hover:not(:disabled){color:inherit}
.thumb{position:relative;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--canvas);border-radius:3px;overflow:hidden}
.crop{position:relative;overflow:hidden;display:block}
.crop img{position:absolute;max-width:none;height:auto;display:block;user-select:none}
.chip-text{min-width:0;display:flex;flex-direction:column}
.chip-text strong{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip-text span{font-size:11px;color:var(--muted);white-space:nowrap}
.chip.flagged .chip-text span{color:var(--warn);font-weight:500}
.chip-state{flex-shrink:0;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--line-strong);display:flex;align-items:center;justify-content:center}
.chip-state svg{width:12px;height:12px;stroke-width:2}
.chip.approved .chip-state{background:var(--teal);border-color:var(--teal);color:#fff}
.chip.revise .chip-state,.chip.reclassify .chip-state{background:var(--warn);border-color:var(--warn);color:#fff}
.chip.approved{opacity:.78}.chip.approved[aria-current=true]{opacity:1}
.disclosure{flex-shrink:0;border-color:transparent;background:transparent;font-size:12px;color:var(--muted);text-align:left;max-width:300px;justify-content:flex-start;align-items:flex-start;line-height:1.3;padding:6px 8px}
.disclosure>span{display:flex;flex-direction:column;min-width:0;white-space:normal}.disclosure strong{font-weight:500;color:var(--ink)}
.disclosure>svg{margin-top:1px;transition:transform .15s}
.disclosure[aria-expanded=true]>svg{transform:rotate(180deg)}
.region-list{flex-shrink:0;display:flex;flex-wrap:wrap;gap:6px;padding:10px 24px;max-height:104px;overflow:auto;background:var(--dock);border-bottom:1px solid var(--line)}
.region-list button{min-height:28px;padding:3px 10px;font-size:12px;border-radius:99px;gap:6px;border-color:var(--line)}
.region-list small{color:var(--faint);font-size:11px}
.region-list button[aria-current=true]{border-color:var(--teal);box-shadow:inset 0 0 0 1px var(--teal)}
.region-list button.reclassify{border-color:var(--warn-line);background:var(--warn-wash)}
.region-list button.reclassify small{color:var(--warn)}

.work{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.08fr) minmax(400px,.92fr);gap:20px;padding:18px 24px}
.map-pane{min-height:0;display:flex;flex-direction:column;gap:10px}
.map-space{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.map{position:relative;flex-shrink:0;overflow:hidden;background:var(--canvas);box-shadow:0 1px 2px #1a261f1f,0 6px 20px #1a261f1a;border-radius:2px}
.comp{display:block;width:100%;height:100%;user-select:none;pointer-events:none}
.region{position:absolute;padding:0;min-height:0;border:0;border-radius:1px;background:transparent;transition:none;outline:2px solid transparent;outline-offset:-1px}
.region:hover:not(:disabled){color:inherit}
.region.is-asset{outline:2px solid var(--asset);box-shadow:0 0 0 1px #ffffffb3,inset 0 0 0 1px #ffffffb3}
.region.is-plan{outline:2px dashed var(--plan);box-shadow:0 0 0 1px #ffffff99,inset 0 0 0 1px #ffffff99}
.region.flagged{outline:2.5px solid var(--flag);background:#d27a1c1f;box-shadow:0 0 0 1px #fff,inset 0 0 0 1px #fff}
.region.code:hover,.region.code:focus-visible{outline:1.5px dotted var(--plan);background:#ffffff26;box-shadow:0 0 0 1px #ffffff99}
.region.code.reclassify{outline:2px solid var(--warn);background:#9a541814}
.region.missing{outline:2px dashed var(--missing);background:#b8412c1f;box-shadow:0 0 0 1px #ffffffb3}
.region.approved{opacity:.5}.region.approved:hover{opacity:1}
.region.revise,.region.reclassify{outline-color:var(--warn);outline-style:solid}
.region:hover{background-color:#ffffff1f}
.map.has-selection .region.selected{z-index:5;opacity:1;outline:2.5px solid #fff;box-shadow:0 0 0 1.5px var(--ink),0 0 0 100vmax #0f17132e}
.tag{position:absolute;left:-2px;bottom:calc(100% + 4px);padding:3px 7px;border-radius:3px;background:#17201b;color:#fff;font-size:11px;line-height:1.25;white-space:nowrap;pointer-events:none;opacity:0;transform:translateY(2px);transition:opacity .12s,transform .12s;z-index:6;max-width:260px;overflow:hidden;text-overflow:ellipsis}
.region.tag-below .tag{bottom:auto;top:calc(100% + 4px)}
.region.tag-right .tag{left:auto;right:-2px}
.region:hover .tag,.region:focus-visible .tag,.region.selected .tag{opacity:1;transform:none}
.region:hover{z-index:4}
.map.marking{cursor:crosshair;touch-action:none}
.map.marking .region{pointer-events:none;opacity:.35}
.draw-box{position:absolute;outline:2px dashed var(--missing);background:#b8412c26;pointer-events:none;z-index:7}
.legend{flex-shrink:0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--muted);min-height:18px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.lg{display:inline-block;width:14px;height:10px;border-radius:1px}
.lg.asset{border:2px solid var(--asset)}.lg.plan{border:2px dashed var(--plan)}.lg.flagged{border:2px solid var(--flag);background:#d27a1c29}.lg.code{border:1.5px dotted var(--plan)}.lg.missing{border:2px dashed var(--missing)}
.marking-hint{color:var(--missing);font-weight:500}

.detail{min-height:0;display:flex;flex-direction:column;gap:14px;padding:18px 20px 16px;background:var(--surface);border-radius:6px;box-shadow:0 1px 2px #1a261f14,0 8px 24px #1a261f14;overflow:auto}
.detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.eyebrow.flagged{color:var(--warn)}.eyebrow.missing{color:var(--missing)}
.detail-head h2{margin-top:3px;font-size:20px;font-weight:500;line-height:1.2}
.pill{flex-shrink:0;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:12px;background:#eef1ed;color:var(--muted);white-space:nowrap}
.pill svg{width:12px;height:12px;stroke-width:2}
.pill.approved{background:var(--teal-wash);color:var(--teal-ink)}
.pill.revise,.pill.reclassify{background:var(--warn-wash);color:var(--warn)}
.flag{flex-shrink:0;display:flex;gap:10px;padding:10px 12px;border-radius:5px;background:var(--warn-wash);border:1px solid var(--warn-line);color:#5e3610;font-size:13.5px}
.flag svg{width:18px;height:18px;margin-top:1px;color:var(--warn)}
.flag p+p{margin-top:4px}
.change-note{flex-shrink:0;font-size:12px;color:var(--warn)}
.stage{flex:1 1 0;min-height:160px;overflow:hidden;display:flex;gap:16px;align-items:center;justify-content:center}
.stage[data-direction=column]{flex-direction:column}
.stage figure{display:flex;flex-direction:column;gap:6px;min-width:0}
.stage figcaption{height:20px;font-size:12px;color:var(--muted)}
.frame{position:relative;overflow:hidden;background:var(--canvas);border-radius:2px;box-shadow:0 0 0 1px #1a261f1f}
.frame.crop img{position:absolute;max-width:none;height:auto}
.frame.asset img{display:block;width:100%;height:100%;object-fit:contain}
.frame.asset.clear{box-shadow:0 0 0 1px #1a261f1f}
.focus-box{position:absolute;outline:2px solid #fff;box-shadow:0 0 0 1.5px var(--ink),0 0 0 100vmax #0f171340;pointer-events:none}
.stage-empty{color:var(--muted)}
.stage-tools{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:6px;background:#eef1ed}
.seg-label{font-size:11px;color:var(--muted);padding:0 6px}
.seg button{min-height:28px;padding:3px 9px;font-size:12px;border-color:transparent;background:transparent;gap:6px}
.seg button[aria-pressed=true]{background:var(--surface);border-color:var(--line-strong);color:var(--ink);box-shadow:0 1px 2px #1a261f1a}
.seg i{display:inline-block;width:12px;height:12px;border-radius:2px;box-shadow:inset 0 0 0 1px #0000002e}
.seg i.light{background:#f6f6f3}.seg i.dark{background:#1d201e}
.plan-copy{flex-shrink:0;display:flex;flex-direction:column;gap:4px}
.statement{font-size:15px}
.statement strong{font-weight:600}
.note{color:var(--muted);font-size:13.5px;max-width:62ch}
.decide{flex-shrink:0;display:flex;flex-direction:column;gap:10px;padding-top:14px;border-top:1px solid var(--line)}
.decisions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.decisions button{min-height:44px;font-size:14px;font-weight:600}
.decisions .yes{background:var(--teal);border-color:var(--teal);color:#fff}
.decisions .yes:hover:not(:disabled){background:var(--teal-ink);color:#fff}
.decisions .yes.chosen{background:var(--teal-wash);color:var(--teal-ink);border-color:var(--teal)}
.decisions .no{color:var(--ink)}
.decisions .no.chosen{background:var(--warn-wash);border-color:var(--warn);color:var(--warn)}
.verdict{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:9px 12px;border-radius:5px;background:#f2f4f1;font-size:13px}
.verdict.revise,.verdict.reclassify{background:var(--warn-wash);color:#5e3610}
.verdict.approved{background:var(--teal-wash);color:var(--teal-ink)}
.verdict-actions{display:flex;gap:2px;flex-shrink:0;margin:-5px -6px -5px 0}
.verdict-actions button{min-height:28px;padding:3px 8px;font-size:12px}
.region-note{display:flex;align-items:center;justify-content:space-between;gap:16px}
.region-note p{font-size:13px;color:var(--muted);max-width:44ch}
.region-note button{flex-shrink:0}
.decision-form{display:flex;flex-direction:column;gap:12px}
.kinds{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.kinds legend{font-size:13px;font-weight:500;margin-bottom:8px}
.kind{position:relative;display:block;cursor:pointer}
.kind input{position:absolute;opacity:0;pointer-events:none}
.kind span{display:flex;flex-direction:column;gap:2px;height:100%;padding:9px 11px;border:1px solid var(--line-strong);border-radius:5px;background:var(--surface)}
.kind strong{font-size:13px;font-weight:600}.kind small{font-size:11.5px;color:var(--muted)}
.kind input:checked+span{border-color:var(--teal);box-shadow:inset 0 0 0 1px var(--teal);background:var(--teal-wash)}
.kind input:focus-visible+span{outline:2px solid var(--teal);outline-offset:2px}
.field{display:block;font-size:13px;font-weight:500}
.field span{font-weight:400;color:var(--faint);font-size:12px;margin-left:4px}
.form-actions{display:flex;justify-content:flex-end;gap:8px}
.missing-form{display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.missing-form .field{align-self:stretch}
.detail-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted)}

.plan-review>footer{flex-shrink:0;display:flex;align-items:center;gap:16px;padding:10px 24px;background:var(--surface);border-top:1px solid var(--line)}
.progress{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.progress span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.keys{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--faint)}.keys kbd{margin-left:6px}.keys kbd:first-child{margin-left:0}.keys kbd+kbd{margin-left:0}
.submit{display:flex;align-items:center;gap:14px}
.submit p{font-size:12px;color:var(--muted);text-align:right;max-width:56ch}
.submit .primary{min-height:40px;padding:8px 18px;font-size:14px}
.mark{flex-shrink:0}
.is-submitted .plan-review>footer{justify-content:space-between}

@media (max-width:1100px) and (min-width:821px){.work{grid-template-columns:minmax(0,1fr) minmax(360px,1fr)}.kinds{grid-template-columns:1fr}}
@media (max-width:820px){
 :host{height:auto;overflow:visible}
 .plan-review{height:auto;min-height:100dvh}
 .plan-review>header{flex-direction:column;align-items:flex-start;gap:8px;padding:14px 16px 12px}
 h1{font-size:28px}.meta{justify-content:flex-start}
 .banner{padding:10px 16px;flex-wrap:wrap}
 .queue{flex-wrap:wrap;gap:8px 12px;padding:10px 16px}
 .queue-head{flex-direction:row;gap:8px;align-items:baseline}
 .queue-list{flex-basis:100%;order:2}
 .disclosure{order:3;max-width:none;padding-left:0}
 .region-list{padding:8px 16px}
 .work{display:flex;flex-direction:column;gap:14px;padding:14px 16px}
 .map-space{flex:none;display:block}
 .detail{overflow:visible;padding:16px}
 .stage{flex:none;height:min(52vh,380px)}
 kbd,.keys{display:none}
 .kinds{grid-template-columns:1fr}
 .region-note{flex-direction:column;align-items:stretch}
 .plan-review>footer{position:sticky;bottom:0;z-index:10;flex-wrap:wrap;gap:8px 12px;padding:10px 16px calc(10px + env(safe-area-inset-bottom))}
 .progress{order:-1;flex-basis:100%}
 .progress:not(:has(button)){display:none}
 .submit{flex:1;justify-content:flex-end;flex-wrap:wrap;gap:6px 12px}
 .submit p{order:2;flex-basis:100%;text-align:right;font-size:11px;max-width:none}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;
