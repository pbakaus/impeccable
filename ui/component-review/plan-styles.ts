/** Plan and asset review styles, on the Impeccable design system (tokens.ts mirrors
 * kinpaku-tokens.css). One paper plane: hairline rules separate the queue, the comp and the
 * decision column; nothing nests a card in a card. Ink fills the primary action, patina marks
 * state and selection, gold is the one indicator line, vermilion is warnings only. */
import { ksKit } from './kit';
export const planStyles = ksKit + `
:host{display:block;height:var(--component-review-height,100dvh);min-height:0;overflow:hidden;color:var(--ks-text);font:400 var(--ks-type-small-size)/1.5 var(--ks-font);
 --asset:var(--ks-patina);--plan:var(--ks-ink);--flag:var(--ks-vermilion);--missing:var(--ks-vermilion)}
*{box-sizing:border-box}
h1,h2,p,figure,fieldset{margin:0}fieldset{border:0;padding:0}
button,input,textarea{font:inherit;color:inherit}
button{cursor:pointer}
button:disabled{cursor:not-allowed}
:focus-visible{outline:2px solid var(--ks-focus-ring);outline-offset:3px}
svg{width:16px;height:16px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
kbd{font:400 var(--ks-type-micro-size)/1 var(--ks-mono);color:inherit;opacity:.55;margin-left:-6px}
textarea,input:not([type=radio]){width:100%;display:block;margin-top:8px;background:var(--ks-paper-raised);color:var(--ks-ink);border:1px solid var(--ks-edge);border-radius:var(--ks-radius-sm);padding:10px 14px;line-height:1.45}
textarea{resize:vertical;min-height:64px}
textarea:focus,input:focus{outline:none;border-color:var(--ks-patina);box-shadow:0 0 0 1px var(--ks-patina)}
.eyebrow{font:400 var(--ks-type-eyebrow-size)/1.3 var(--ks-mono);letter-spacing:var(--ks-type-eyebrow-track);text-transform:uppercase;color:var(--ks-text-muted)}

.plan-review{height:100%;display:flex;flex-direction:column;min-height:0;background:var(--ks-paper)}
.plan-review>header{flex-shrink:0;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:18px 28px 16px;border-bottom:1px solid var(--ks-rule)}
.titles{min-width:0}
h1{font:300 40px/1.04 var(--ks-font-display);font-variation-settings:'wght' 300;color:var(--ks-ink)}
.titles p{margin-top:6px;color:var(--ks-text-muted);font-size:var(--ks-type-ui-size)}
.meta{display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap;justify-content:flex-end;white-space:nowrap;font-size:var(--ks-type-ui-size);color:var(--ks-text-muted)}
.meta .surface{color:var(--ks-ink);font-weight:500;max-width:32ch;overflow:hidden;text-overflow:ellipsis}
.badge{display:inline-flex;align-items:center;min-height:22px;padding:0 7px;border-radius:var(--ks-radius-sm);background:var(--ks-gray);color:var(--ks-text-muted);font:600 var(--ks-type-eyebrow-size)/1 var(--ks-mono);letter-spacing:.02em;text-transform:uppercase}

.banner{flex-shrink:0;display:flex;align-items:center;gap:14px;padding:12px 28px;border-bottom:1px solid var(--ks-rule)}
.banner>svg{width:18px;height:18px}
.banner>div{flex:1;min-width:0}
.banner strong{display:block;color:var(--ks-ink);font-weight:500}
.banner p{color:var(--ks-text-muted);font-size:var(--ks-type-ui-size)}
.banner.stale>svg,.banner.error>svg{color:var(--ks-vermilion)}
.banner.done>svg{color:var(--ks-state-ink)}
.banner button{flex-shrink:0}

.queue{flex-shrink:0;display:flex;align-items:stretch;gap:20px;padding:0 28px;border-bottom:1px solid var(--ks-rule);min-width:0}
.queue-head{flex-shrink:0;display:flex;flex-direction:column;justify-content:center;gap:3px}
.queue-head h2{font:400 var(--ks-type-eyebrow-size)/1.2 var(--ks-mono);letter-spacing:var(--ks-type-eyebrow-track);text-transform:uppercase;color:var(--ks-text-muted)}
.queue-head span{font-size:var(--ks-type-label-size);color:var(--ks-text-faint)}
.queue-list{flex:1;min-width:0;display:flex;overflow-x:auto;scrollbar-width:thin;padding-right:28px;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}
.queue-empty{font-size:var(--ks-type-ui-size);color:var(--ks-text-muted);align-self:center}
.chip{display:flex;align-items:center;color:inherit;flex:0 0 auto;justify-content:flex-start;gap:10px;padding:10px 16px 10px 0;margin-right:16px;min-height:0;max-width:250px;text-align:left;border:0;border-radius:0;background:transparent;box-shadow:inset 0 -2px 0 transparent;font-weight:400}
.chip:hover:not(:disabled){box-shadow:inset 0 -2px 0 var(--ks-gray-2)}
.thumb{position:relative;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--ks-paper-deep);overflow:hidden}
.crop{position:relative;overflow:hidden;display:block}
.crop img{position:absolute;max-width:none;height:auto;display:block;user-select:none}
.chip-text{min-width:0;display:flex;flex-direction:column;gap:1px}
.chip-text strong{font-size:var(--ks-type-ui-size);font-weight:500;color:var(--ks-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip-text span{font-size:var(--ks-type-micro-size);color:var(--ks-text-muted);white-space:nowrap}
.chip.flagged .chip-text span{color:var(--ks-vermilion)}
.chip-state{flex-shrink:0;width:16px;height:16px;border-radius:50%;border:1px solid var(--ks-edge);display:flex;align-items:center;justify-content:center}
.chip-state svg{width:11px;height:11px;stroke-width:2}
.chip.approved .chip-state{background:var(--ks-state-ink);border-color:var(--ks-state-ink);color:var(--ks-paper-raised)}
.chip.revise .chip-state,.chip.reclassify .chip-state{background:var(--ks-ink);border-color:var(--ks-ink);color:var(--ks-paper-raised)}
.chip.approved .chip-text strong{color:var(--ks-text-muted)}
.disclosure{display:flex;gap:8px;cursor:pointer;flex-shrink:0;align-self:center;border-color:transparent;background:transparent;font-weight:400;font-size:var(--ks-type-label-size);color:var(--ks-text-muted);text-align:left;max-width:300px;justify-content:flex-start;align-items:flex-start;line-height:1.35;padding:6px 0}
.disclosure:hover:not(:disabled){border-color:transparent;color:var(--ks-ink)}
.disclosure>span{display:flex;flex-direction:column;min-width:0;white-space:normal}
.disclosure strong{font-weight:500;color:var(--ks-ink)}
.disclosure>svg{margin-top:1px;transition:transform var(--ks-quick) var(--ks-ease)}
.disclosure[aria-expanded=true]>svg{transform:rotate(180deg)}
.region-list{flex-shrink:0;display:flex;flex-wrap:wrap;gap:6px;padding:10px 28px;max-height:104px;overflow:auto;border-bottom:1px solid var(--ks-rule)}

.work{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(400px,.9fr)}
.map-pane{min-height:0;display:flex;flex-direction:column;gap:12px;padding:22px 28px}
.map-space{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.map{position:relative;flex-shrink:0;overflow:hidden;background:var(--ks-paper-deep);box-shadow:0 0 0 1px var(--ks-rule)}
.comp{display:block;width:100%;height:100%;user-select:none;pointer-events:none}
.region{position:absolute;padding:0;min-height:0;border:0;border-radius:0;background:transparent;transition:none;outline:2px solid transparent;outline-offset:-1px}
.region:hover:not(:disabled){border-color:transparent}
.region.is-asset{outline:2px solid var(--asset);box-shadow:0 0 0 1px oklch(99.5% 0 0 / .7),inset 0 0 0 1px oklch(99.5% 0 0 / .7)}
.region.is-plan{outline:1.5px dashed var(--plan);box-shadow:0 0 0 1px oklch(99.5% 0 0 / .6),inset 0 0 0 1px oklch(99.5% 0 0 / .6)}
.region.flagged{outline:2px solid var(--flag);background:oklch(52% 0.16 35 / .1);box-shadow:0 0 0 1px var(--ks-paper-raised),inset 0 0 0 1px var(--ks-paper-raised)}
.region.code:hover,.region.code:focus-visible{outline:1.5px dotted var(--ks-ink);background:oklch(99.5% 0 0 / .15);box-shadow:0 0 0 1px oklch(99.5% 0 0 / .6)}
.region.code.reclassify{outline:2px solid var(--ks-ink);background:oklch(13% 0 0 / .06)}
.region.missing{outline:2px dashed var(--missing);background:oklch(52% 0.16 35 / .12);box-shadow:0 0 0 1px oklch(99.5% 0 0 / .7)}
.region.approved{opacity:.5}.region.approved:hover{opacity:1}
.region.revise,.region.reclassify{outline-color:var(--ks-ink);outline-style:solid}
.region:hover{background-color:oklch(99.5% 0 0 / .12)}
.map.has-selection .region.selected{z-index:5;opacity:1;outline:2px solid var(--ks-paper-raised);box-shadow:0 0 0 1.5px var(--ks-ink),0 0 0 100vmax oklch(13% 0 0 / .16)}
.tag{position:absolute;left:-2px;bottom:calc(100% + 4px);padding:3px 7px;border-radius:var(--ks-radius-sm);background:var(--ks-ink);color:var(--ks-paper-raised);font:500 var(--ks-type-micro-size)/1.25 var(--ks-font);white-space:nowrap;pointer-events:none;opacity:0;transform:translateY(2px);transition:opacity var(--ks-quick) var(--ks-ease),transform var(--ks-quick) var(--ks-ease);z-index:6;max-width:260px;overflow:hidden;text-overflow:ellipsis}
.region.tag-below .tag{bottom:auto;top:calc(100% + 4px)}
.region.tag-right .tag{left:auto;right:-2px}
.region:hover .tag,.region:focus-visible .tag,.region.selected .tag{opacity:1;transform:none}
.region:hover{z-index:4}
.map.marking{cursor:crosshair;touch-action:none}
.map.marking .region{pointer-events:none;opacity:.35}
.draw-box{position:absolute;outline:2px dashed var(--missing);background:oklch(52% 0.16 35 / .15);pointer-events:none;z-index:7}
.legend{flex-shrink:0;display:flex;flex-wrap:wrap;gap:4px 18px;font-size:var(--ks-type-label-size);color:var(--ks-text-muted);min-height:18px}
.legend span{display:inline-flex;align-items:center;gap:7px}
.lg{display:inline-block;width:14px;height:10px}
.lg.asset{border:2px solid var(--asset)}.lg.plan{border:1.5px dashed var(--plan)}.lg.flagged{border:2px solid var(--flag)}.lg.code{border:1.5px dotted var(--ks-ink)}.lg.missing{border:2px dashed var(--missing)}
.marking-hint{color:var(--ks-ink);font-weight:500}

.detail{min-height:0;display:flex;flex-direction:column;gap:16px;padding:22px 28px 20px;border-left:1px solid var(--ks-rule);overflow:auto}
.detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0}
.eyebrow.flagged{color:var(--ks-vermilion)}.eyebrow.missing{color:var(--ks-vermilion)}
.detail-head h2{margin-top:6px;font-size:var(--ks-type-title-lg-size);font-weight:500;line-height:1.2;color:var(--ks-ink)}
.pill{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;min-height:var(--ks-control-sm);padding:0 12px;border-radius:var(--ks-radius-pill);border:1px solid var(--ks-rule);font-size:var(--ks-type-label-size);color:var(--ks-text-muted);white-space:nowrap}
.pill svg{width:12px;height:12px;stroke-width:2}
.pill.approved{color:var(--ks-state-ink);border-color:currentColor}
.pill.revise,.pill.reclassify{color:var(--ks-ink);border-color:var(--ks-edge)}
.flag{flex-shrink:0;display:flex;gap:10px;padding:2px 0 2px 14px;border-left:2px solid var(--ks-vermilion);color:var(--ks-ink);font-size:var(--ks-type-small-size)}
.flag svg{width:16px;height:16px;margin-top:2px;color:var(--ks-vermilion)}
.flag p+p{margin-top:4px}
.change-note{flex-shrink:0;font-size:var(--ks-type-label-size);color:var(--ks-text-muted)}
.stage{flex:1 1 0;min-height:160px;overflow:hidden;display:flex;gap:16px;align-items:center;justify-content:center}
.stage[data-direction=column]{flex-direction:column}
.stage.single{align-items:flex-start}
.stage figure{display:flex;flex-direction:column;gap:8px;min-width:0}
.stage figcaption{height:18px;font:400 var(--ks-type-eyebrow-size)/18px var(--ks-mono);letter-spacing:var(--ks-type-eyebrow-track);text-transform:uppercase;color:var(--ks-text-muted)}
.frame{position:relative;overflow:hidden;background:var(--ks-paper-deep);box-shadow:0 0 0 1px var(--ks-rule)}
.frame.crop img{position:absolute;max-width:none;height:auto}
.frame.asset img{display:block;width:100%;height:100%;object-fit:contain}
.focus-box{position:absolute;outline:2px solid var(--ks-paper-raised);box-shadow:0 0 0 1.5px var(--ks-ink),0 0 0 100vmax oklch(13% 0 0 / .35);pointer-events:none}
.stage-empty{color:var(--ks-text-muted)}
.plan-copy{flex-shrink:0;display:flex;flex-direction:column;gap:4px}
.statement{font-size:var(--ks-type-ui-lead);color:var(--ks-ink)}
.statement strong{font-weight:600}
.note{color:var(--ks-text-muted);font-size:var(--ks-type-small-size);max-width:62ch}
.decide{flex-shrink:0;display:flex;flex-direction:column;gap:12px;padding-top:16px;border-top:1px solid var(--ks-rule)}
.decisions{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.decisions button:disabled,.decisions .yes:disabled{background:transparent;color:var(--ks-text-mute-deep);border-color:var(--ks-rule);box-shadow:none}
.verdict{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:2px 0 2px 14px;border-left:2px solid var(--ks-gray-2);font-size:var(--ks-type-ui-size);color:var(--ks-text)}
.verdict strong{color:var(--ks-ink);font-weight:500}
.verdict.approved{border-left-color:var(--ks-state-ink)}
.verdict.revise,.verdict.reclassify{border-left-color:var(--ks-ink)}
.verdict-actions{display:flex;gap:2px;flex-shrink:0;margin:-6px 0}
.verdict-actions button{min-height:var(--ks-control-sm);padding:0 8px;font-size:var(--ks-type-label-size)}
.region-note{display:flex;align-items:center;justify-content:space-between;gap:16px}
.region-note p{font-size:var(--ks-type-ui-size);color:var(--ks-text-muted);max-width:44ch}
.region-note button{flex-shrink:0}
.decision-form{display:flex;flex-direction:column;gap:14px}
.field{display:block;font-size:var(--ks-type-ui-size);font-weight:500;color:var(--ks-ink)}
.field span{font-weight:400;color:var(--ks-text-faint);font-size:var(--ks-type-label-size);margin-left:4px}
.form-actions{display:flex;justify-content:flex-end;gap:8px}
.missing-form{display:flex;flex-direction:column;gap:14px;align-items:flex-start}
.missing-form .field{align-self:stretch}
.detail-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--ks-text-muted)}

.plan-review>footer{flex-shrink:0;display:flex;align-items:center;gap:16px;padding:12px 28px;background:var(--ks-paper-raised);border-top:1px solid var(--ks-rule)}
.progress{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font-size:var(--ks-type-ui-size);color:var(--ks-text-muted)}
.progress span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.keys{display:inline-flex;align-items:center;gap:5px;font-size:var(--ks-type-label-size);color:var(--ks-text-faint)}.keys kbd{margin-left:8px;opacity:1}.keys kbd:first-child{margin-left:0}.keys kbd+kbd{margin-left:2px}
.submit{display:flex;align-items:center;gap:16px}
.submit p{font-size:var(--ks-type-label-size);color:var(--ks-text-muted);text-align:right;max-width:56ch}
.mark{flex-shrink:0;padding:0 12px 0 4px}
.is-submitted.plan-review>footer{justify-content:space-between}

@media (max-width:1100px) and (min-width:821px){.work{grid-template-columns:minmax(0,1fr) minmax(360px,1fr)}.kinds{grid-template-columns:1fr}.map-pane,.detail{padding:18px 20px}}
@media (max-width:820px){
 :host{height:auto;overflow:visible}
 .plan-review{height:auto;min-height:100dvh}
 .plan-review>header{flex-direction:column;align-items:flex-start;gap:8px;padding:16px 16px 14px}
 h1{font-size:32px}.meta{justify-content:flex-start}
 .banner{padding:12px 16px;flex-wrap:wrap}
 .queue{flex-wrap:wrap;gap:0 12px;padding:8px 16px 0}
 .queue-head{flex-direction:row;gap:8px;align-items:baseline}
 .queue-list{flex-basis:100%;order:2}
 .disclosure{order:3;max-width:none;flex-basis:100%}
 .region-list{padding:8px 16px}
 .work{display:flex;flex-direction:column}
 .map-pane{padding:16px}
 .map-space{flex:none;display:block}
 .detail{overflow:visible;padding:18px 16px;border-left:0;border-top:1px solid var(--ks-rule)}
 .stage{flex:none;height:min(52vh,380px)}
 kbd,.keys{display:none}
 .kinds{grid-template-columns:1fr}
 .region-note{flex-direction:column;align-items:stretch}
 .plan-review>footer{position:sticky;bottom:0;z-index:10;flex-wrap:wrap;gap:8px 12px;padding:10px 16px calc(10px + env(safe-area-inset-bottom))}
 .progress:not(:has(button)){display:none}
 .progress{order:-1;flex-basis:100%}
 .submit{flex:1;justify-content:flex-end;flex-wrap:wrap;gap:6px 12px}
 .submit p{order:2;flex-basis:100%;text-align:right;max-width:none}
 .submit .primary{padding:0 16px;white-space:nowrap}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
.text-action{border:0;background:none;padding:0 2px;min-height:0;color:var(--ks-link-on-paper);font:inherit;font-size:var(--ks-type-label-size);text-decoration:underline;text-decoration-color:var(--ks-link-on-paper-line);text-underline-offset:3px;transition:text-decoration-color var(--ks-quick) var(--ks-ease)}
.text-action:hover:not(:disabled){text-decoration-color:var(--ks-link-on-paper-line-hover)}
.text-action:disabled{color:var(--ks-text-mute-deep)}
.tool{display:inline-flex;align-items:center;gap:10px}
.tool-label{font:400 var(--ks-type-eyebrow-size)/1.3 var(--ks-mono);letter-spacing:var(--ks-type-eyebrow-track);text-transform:uppercase;color:var(--ks-text-muted)}
.stage-tools{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:10px 16px;flex-wrap:wrap}
.decisions{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.decisions .ks-button{width:100%}
.other-action{font-size:var(--ks-type-ui-size);color:var(--ks-text-muted)}
.other-action .text-action{font-size:var(--ks-type-ui-size)}
.kinds{display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.kind-hint{font-size:var(--ks-type-label-size);color:var(--ks-text-muted)}
.form-actions{display:flex;justify-content:flex-end;gap:8px}
.region-list.ks-tab-list{flex-wrap:wrap;gap:0 4px;max-height:none}
.region-list.ks-tab-list button{flex:0 0 auto;min-height:36px;padding:0 10px;font-size:var(--ks-type-ui-size);display:inline-flex;align-items:center;gap:6px}
.region-list.ks-tab-list small{font-size:var(--ks-type-micro-size);color:var(--ks-text-faint)}
.region-list.ks-tab-list button.reclassify small{color:var(--ks-ink);font-weight:500}
.chip{border-bottom:2px solid transparent;box-shadow:none;transition:border-color 180ms var(--ks-ease)}
.chip:hover:not(:disabled){box-shadow:none;border-bottom-color:var(--ks-rule)}
.chip[aria-selected=true]{border-bottom-color:var(--ks-kinpaku)}
.mark{flex-shrink:0}
.ks-button[disabled] .ks-button-arrow{color:currentColor}
.plan-review{position:relative;isolation:isolate}
.plan-review::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:0.055;mix-blend-mode:multiply;background-image:var(--ks-grain);background-size:160px 160px}
.is-submitted .decisions{display:none}
@media (max-width:820px){.decisions{grid-template-columns:1fr}.stage-tools{justify-content:flex-start}}
`;
