/** Plan and asset review: the stage. Only the vendored site kit and its tokens (kit.ts). One paper
 * plane, one hairline per boundary, images outlined by --ks-rule with no card, eyebrows for labels,
 * Alumni Sans for the one title per screen. Motion on --ks-ease; none when reduced motion is asked. */
import { ksKit } from './kit';
export const planStyles = ksKit + `
:host{display:block;height:var(--component-review-height,100dvh);min-height:0;overflow:hidden;color:var(--ks-text);font:400 var(--ks-type-small-size)/1.5 var(--ks-font);
 --asset:var(--ks-patina);--plan:var(--ks-ink);--flag:var(--ks-vermilion);--missing:var(--ks-vermilion);--stage-ease:var(--ks-ease)}
*{box-sizing:border-box}
h1,h2,h3,p,figure,blockquote,dl,dd{margin:0}
button,input,textarea{font:inherit;color:inherit}
button{cursor:pointer}
button:disabled{cursor:not-allowed}
svg{width:16px;height:16px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
:focus-visible{outline:2px solid var(--ks-focus-ring);outline-offset:3px}
.eyebrow{font:400 var(--ks-type-eyebrow-size)/1.3 var(--ks-mono);letter-spacing:var(--ks-type-eyebrow-track);text-transform:uppercase;color:var(--ks-text-muted)}
.muted{color:var(--ks-text-muted)}
.cap{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;margin:0 -8px 0 2px;border:1px solid currentColor;border-radius:var(--ks-radius-sm);font:500 var(--ks-type-micro-size)/1 var(--ks-mono);letter-spacing:0;opacity:.5}
.ks-button-primary .cap{opacity:.55}
.ks-button[disabled] .ks-button-arrow{color:currentColor}
.text-action{border:0;background:none;padding:0 2px;min-height:0;color:var(--ks-link-on-paper);font:inherit;text-decoration:underline;text-decoration-color:var(--ks-link-on-paper-line);text-underline-offset:3px;transition:text-decoration-color var(--ks-quick) var(--ks-ease)}
.text-action:hover:not(:disabled){text-decoration-color:var(--ks-link-on-paper-line-hover)}
.text-action .cap{margin:0 0 0 8px;height:18px;min-width:18px}
textarea,input{width:100%;display:block;background:var(--ks-paper-raised);color:var(--ks-ink);border:1px solid var(--ks-edge);border-radius:var(--ks-radius-sm);padding:10px 14px;line-height:1.45}
textarea{resize:vertical;min-height:64px}
textarea:focus,input:focus{outline:none;border-color:var(--ks-patina);box-shadow:0 0 0 1px var(--ks-patina)}
.field{display:flex;flex-direction:column;gap:8px}

.rv{height:100%;display:flex;flex-direction:column;min-height:0;background:var(--ks-paper);position:relative;isolation:isolate}
.rv::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:0.055;mix-blend-mode:multiply;background-image:var(--ks-grain);background-size:160px 160px}

/* Top bar: title, round, a light per item. */
.bar{flex-shrink:0;height:56px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:20px;padding:0 28px;border-bottom:1px solid var(--ks-rule)}
.bar-title{display:flex;align-items:baseline;gap:12px;min-width:0}
.bar-name{font-size:var(--ks-type-ui-size);font-weight:500;color:var(--ks-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-round{font:400 var(--ks-type-eyebrow-size)/1 var(--ks-mono);letter-spacing:var(--ks-type-eyebrow-track);text-transform:uppercase;color:var(--ks-text-muted);white-space:nowrap}
.lights{display:flex;align-items:center;gap:4px}
.light{position:relative;width:20px;height:24px;padding:0;border:0;background:transparent;display:grid;place-items:center}
.light::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ks-gray-2);box-shadow:inset 0 1px 1px oklch(13% 0 0 / 0.18);transition:background-color 160ms var(--ks-ease),box-shadow 160ms var(--ks-ease),transform 160ms var(--ks-ease)}
.lights.dense{gap:0}.lights.dense .light{width:14px}.lights.dense .light::before{width:7px;height:7px}
.light.decided::before{background:var(--ks-kinpaku);box-shadow:var(--ks-led)}
.light.current::before{transform:scale(1.35);background:var(--ks-patina);box-shadow:0 0 0 1px oklch(13% 0 0 / 0.12),0 0 4px color-mix(in oklch,var(--ks-patina) 60%,transparent)}
.light:hover::before{transform:scale(1.25)}
.light.current:hover::before{transform:scale(1.35)}
.light:focus-visible{outline-offset:0;border-radius:var(--ks-radius-sm)}
.tip{position:absolute;top:calc(100% + 6px);left:50%;transform:translate(-50%,-2px);padding:5px 8px;border:1px solid var(--ks-rule);border-radius:var(--ks-radius-sm);background:var(--ks-paper-deep);color:var(--ks-ink);font-size:var(--ks-type-label-size);white-space:nowrap;opacity:0;pointer-events:none;transition:opacity var(--ks-quick) var(--ks-ease),transform var(--ks-quick) var(--ks-ease);z-index:20}
.tip-state{color:var(--ks-text-muted)}
.light:hover .tip,.light:focus-visible .tip{opacity:1;transform:translate(-50%,0)}
.lights-summary{margin-left:14px;padding:4px 2px;border:0;background:none;border-bottom:2px solid transparent;font-size:var(--ks-type-label-size);color:var(--ks-text-muted);transition:color 180ms var(--ks-ease),border-color 180ms var(--ks-ease)}
.lights-summary:hover{color:var(--ks-ink)}
.lights-summary.current{color:var(--ks-ink);border-bottom-color:var(--ks-kinpaku)}
.bar-locator{display:none;justify-self:end;position:relative;width:52px;height:34px;padding:0;border:0;overflow:hidden;background:var(--ks-paper-deep);box-shadow:0 0 0 1px var(--ks-rule)}

.banner{flex-shrink:0;display:flex;align-items:center;gap:14px;padding:12px 28px;border-bottom:1px solid var(--ks-rule)}
.banner>svg{width:18px;height:18px;color:var(--ks-vermilion)}
.banner>div{flex:1;min-width:0}
.banner strong{display:block;color:var(--ks-ink);font-weight:500}
.banner p{color:var(--ks-text-muted);font-size:var(--ks-type-ui-size)}

.screen{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;position:relative}
.view-summary .screen{overflow:auto}

/* Arrivals. */
@keyframes enter-next{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
@keyframes enter-prev{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
@keyframes enter-fade{from{opacity:0}to{opacity:1}}
.enter-next{animation:enter-next 240ms var(--stage-ease) both}
.enter-prev{animation:enter-prev 240ms var(--stage-ease) both}
.enter-fade{animation:enter-fade 200ms var(--stage-ease) both}

/* Intro. */
.intro{flex:1;min-height:0;display:grid;grid-template-columns:minmax(320px,440px) minmax(0,1fr);gap:56px;align-items:center;padding:40px 56px}
.intro-copy{display:flex;flex-direction:column;align-items:flex-start;gap:18px}
.intro h1{font:300 clamp(2.6rem,4.4vw,3.6rem)/1.02 var(--ks-font-display);font-variation-settings:'wght' 300;color:var(--ks-ink)}
.lead{font-size:var(--ks-type-lead-size,1.125rem);line-height:1.5;color:var(--ks-text);max-width:34ch}
.kinds-explained{display:flex;flex-direction:column;gap:12px;margin-top:6px;padding-top:18px;border-top:1px solid var(--ks-rule);width:100%}
.kinds-explained dt{display:flex;align-items:center;gap:10px;color:var(--ks-ink);font-weight:500}
.kinds-explained dd{margin-left:24px;color:var(--ks-text-muted);font-size:var(--ks-type-ui-size)}
.swatch{display:inline-block;width:14px;height:10px}
.swatch.asset{border:2px solid var(--asset)}.swatch.plan{border:1.5px dashed var(--plan)}
.intro-copy .ks-button{margin-top:14px}
.intro-comp{min-height:0;height:100%;display:flex;align-items:center;justify-content:center}

/* The comp with regions (intro, summary, overlay). */
.map{position:relative;overflow:hidden;background:var(--ks-paper-deep);box-shadow:0 0 0 1px var(--ks-rule)}
.map .comp{display:block;width:100%;height:100%;user-select:none;pointer-events:none}
.region{position:absolute;padding:0;min-height:0;border:0;border-radius:0;background:transparent;outline:2px solid transparent;outline-offset:-1px}
.region.is-asset{outline:2px solid var(--asset);box-shadow:0 0 0 1px oklch(99.5% 0 0 / .7),inset 0 0 0 1px oklch(99.5% 0 0 / .7)}
.region.is-plan{outline:1.5px dashed var(--plan);box-shadow:0 0 0 1px oklch(99.5% 0 0 / .6),inset 0 0 0 1px oklch(99.5% 0 0 / .6)}
.region.flagged{outline:2px solid var(--flag);background:oklch(52% 0.16 35 / .1);box-shadow:0 0 0 1px var(--ks-paper-raised),inset 0 0 0 1px var(--ks-paper-raised)}
.region.code:hover,.region.code:focus-visible,.region.code.selected{outline:1.5px dotted var(--ks-ink);background:oklch(99.5% 0 0 / .15);box-shadow:0 0 0 1px oklch(99.5% 0 0 / .6)}
.region.code.reclassify{outline:2px solid var(--ks-ink);background:oklch(13% 0 0 / .06)}
.region.missing{outline:2px dashed var(--missing);background:oklch(52% 0.16 35 / .12);box-shadow:0 0 0 1px oklch(99.5% 0 0 / .7)}
.region.approved{opacity:.55}
.region.revise,.region.reclassify{outline-color:var(--ks-ink);outline-style:solid}
button.region{cursor:pointer}
button.region:hover{opacity:1;background-color:oklch(99.5% 0 0 / .14);z-index:4}
.map.has-selection .region.selected{z-index:5;opacity:1;outline:2px solid var(--ks-paper-raised);box-shadow:0 0 0 1.5px var(--ks-ink),0 0 0 100vmax oklch(13% 0 0 / .22)}
.tag{position:absolute;left:-2px;bottom:calc(100% + 4px);padding:3px 7px;border-radius:var(--ks-radius-sm);background:var(--ks-ink);color:var(--ks-paper-raised);font:500 var(--ks-type-micro-size)/1.25 var(--ks-font);white-space:nowrap;pointer-events:none;opacity:0;transform:translateY(2px);transition:opacity var(--ks-quick) var(--ks-ease),transform var(--ks-quick) var(--ks-ease);z-index:6}
.region.tag-below .tag{bottom:auto;top:calc(100% + 4px)}
.region.tag-right .tag{left:auto;right:-2px}
.region:hover .tag,.region:focus-visible .tag,.region.selected .tag{opacity:1;transform:none}
.map.marking{cursor:crosshair;touch-action:none}
.map.marking .region{pointer-events:none;opacity:.35}
.draw-box{position:absolute;outline:2px dashed var(--missing);background:oklch(52% 0.16 35 / .15);pointer-events:none;z-index:7}

/* Stage: one item. */
.stage{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;gap:14px;padding:22px 48px 12px;position:relative}
.stage-head{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;max-width:760px}
.stage h1{font:300 clamp(2rem,3vw,2.75rem)/1.04 var(--ks-font-display);font-variation-settings:'wght' 300;color:var(--ks-ink)}
.asked{margin-top:6px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 18px 0;border-top:1px solid var(--ks-rule)}
.asked p{font-size:var(--ks-type-lead-size,1.125rem);line-height:1.45;color:var(--ks-ink);max-width:58ch}
.figures{flex:1 1 0;min-height:0;width:100%;display:flex;justify-content:center;align-items:center;gap:28px}
.figures[data-direction=column]{flex-direction:column;gap:14px}
.stage.is-single{justify-content:center}
.figures.single{flex:none;align-items:center}
.figures.empty{color:var(--ks-text-muted)}
.fig{display:flex;flex-direction:column;gap:10px;min-width:0}
.fig figcaption{height:20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.frame{position:relative;overflow:hidden;background:var(--ks-paper-deep);box-shadow:0 0 0 1px var(--ks-rule)}
.pic{position:absolute;inset:0;display:block;overflow:hidden}
.pic.crop img{position:absolute;max-width:none;height:auto;user-select:none}
.pic.gen img{display:block;width:100%;height:100%;object-fit:contain;user-select:none}
.frame .flip{visibility:hidden}
.frame.flipped .flip{visibility:visible}
.frame.flipped .gen:not(.before){visibility:hidden}
.focus-box{position:absolute;outline:2px solid var(--ks-paper-raised);box-shadow:0 0 0 1.5px var(--ks-ink),0 0 0 100vmax oklch(13% 0 0 / .35);pointer-events:none}
.figures.looking .frame{cursor:none}
.lens{position:absolute;top:0;left:0;width:156px;height:156px;border-radius:50%;overflow:hidden;pointer-events:none;opacity:0;z-index:3;background:var(--ks-paper-deep);box-shadow:0 0 0 2px var(--ks-paper-raised),0 0 0 3px oklch(13% 0 0 / .35),var(--ks-lift-2);transition:opacity var(--ks-quick) var(--ks-ease)}
.figures.looking .lens{opacity:1}
.lens-inner{position:absolute;top:0;left:0;transform-origin:0 0}
.lens-inner .focus-box{box-shadow:0 0 0 1.5px var(--ks-ink)}
.backdrop-switch{font-size:var(--ks-type-label-size)}
.backdrop-switch .ks-switch-track{transform:scale(.8);transform-origin:right center;margin-right:-6px}
.stage-foot{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;max-width:720px;min-height:22px}
.sentence{font-size:var(--ks-type-ui-lead);color:var(--ks-ink)}
.sentence.muted{color:var(--ks-text-muted);font-size:var(--ks-type-small-size)}
.sentence strong{font-weight:600}
.sentence s{color:var(--ks-text-muted);text-decoration-color:var(--ks-text-muted);margin-right:4px}
.flag{display:flex;align-items:baseline;gap:8px;text-align:left;font-size:var(--ks-type-ui-size);color:var(--ks-vermilion);max-width:64ch}
.flag::before{content:"";flex-shrink:0;width:6px;height:6px;border-radius:50%;background:var(--ks-vermilion);transform:translateY(-1px)}
.hint{font-size:var(--ks-type-label-size);color:var(--ks-text-faint);transition:opacity 400ms var(--ks-ease)}
.hint .cap{margin:0 2px;height:18px}
.hint.gone,.toast.gone{opacity:0;pointer-events:none}
.locator{position:absolute;left:28px;bottom:14px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:0;border:0;background:none;color:var(--ks-text-muted)}
.locator-map{position:relative;display:block;width:128px;overflow:hidden;box-shadow:0 0 0 1px var(--ks-rule);transition:box-shadow var(--ks-quick) var(--ks-ease)}
.locator-map img{display:block;width:100%;height:100%}
.locator-box{position:absolute;outline:1.5px solid var(--ks-paper-raised);box-shadow:0 0 0 1px var(--ks-ink),0 0 0 100vmax oklch(13% 0 0 / .3)}
.locator:hover .locator-map{box-shadow:0 0 0 1px var(--ks-edge),var(--ks-lift-1)}
.locator-label{font:400 var(--ks-type-eyebrow-size)/1 var(--ks-mono);letter-spacing:var(--ks-type-eyebrow-track);text-transform:uppercase;display:inline-flex;align-items:center}
.locator-label .cap{margin:0 0 0 8px;height:18px;min-width:18px}
.locator:hover{color:var(--ks-ink)}

/* Decision bar. */
.decide-bar{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px 28px 22px;border-top:1px solid var(--ks-rule);background:var(--ks-paper)}
.decisions{display:flex;justify-content:center;gap:12px}
.decisions .ks-button{min-width:210px}
.decisions .ks-button-ghost{min-width:0}
.current-decision{display:inline-flex;align-items:center;gap:8px;font-size:var(--ks-type-ui-size);color:var(--ks-text-muted);max-width:720px}
.current-decision svg{color:var(--ks-state-ink)}
.current-decision span{color:var(--ks-ink)}
.record{font-size:var(--ks-type-ui-lead);color:var(--ks-ink)}
.decide-bar.form{align-items:stretch;width:100%}
.decide-bar.form>*{width:100%;max-width:720px;margin:0 auto}
.form-row{display:flex;align-items:center;gap:14px}
.form-actions{display:flex;justify-content:flex-end;gap:8px}
.form-actions.start{justify-content:flex-start}

/* Toast. */
@keyframes toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.toast{position:absolute;left:28px;bottom:24px;display:flex;align-items:center;gap:14px;padding:10px 12px 10px 16px;border-radius:var(--ks-radius-sm);background:var(--ks-instrument);color:var(--ks-instrument-text);font-size:var(--ks-type-ui-size);box-shadow:var(--ks-lift-2);z-index:30;animation:toast-in 200ms var(--ks-ease) both;transition:opacity 300ms var(--ks-ease)}
.toast .text-action{color:var(--ks-instrument-text);text-decoration-color:oklch(100% 0 0 / .4)}
.toast .text-action:hover{text-decoration-color:var(--ks-kinpaku)}
.view-summary .toast{bottom:22px}

/* Summary. */
.summary{width:100%;max-width:1240px;margin:0 auto;padding:36px 48px 0;display:flex;flex-direction:column;gap:36px}
.summary-head{display:flex;flex-direction:column;gap:10px}
.summary h1{font:300 clamp(2.4rem,4vw,3.4rem)/1.02 var(--ks-font-display);font-variation-settings:'wght' 300;color:var(--ks-ink)}
.sheet{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:28px 24px}
.card{display:flex;flex-direction:column;gap:10px;padding:0;border:0;background:none;text-align:left;color:inherit;min-width:0}
.card-thumb .focus-box{box-shadow:0 0 0 1px var(--ks-ink),0 0 0 100vmax oklch(13% 0 0 / .3);outline-width:1.5px}
.card-thumb{height:118px;display:flex;align-items:center;justify-content:center;background:var(--ks-paper-deep);box-shadow:0 0 0 1px var(--ks-rule);overflow:hidden;transition:box-shadow var(--ks-quick) var(--ks-ease)}
.card:hover .card-thumb{box-shadow:0 0 0 1px var(--ks-edge)}
.card-pic{position:relative;display:block;max-height:100%;overflow:hidden}
.card-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.card-name{font-weight:500;color:var(--ks-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-state{display:inline-flex;align-items:center;gap:5px;font-size:var(--ks-type-label-size);color:var(--ks-text-muted)}
.card-state svg{width:13px;height:13px;stroke-width:2}
.card.approved .card-state{color:var(--ks-state-ink)}
.card.revise .card-state,.card.reclassify .card-state{color:var(--ks-ink);font-weight:500}
.card.pending .card-state{color:var(--ks-vermilion)}
.card-note{font-size:var(--ks-type-label-size);color:var(--ks-text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.coverage{display:flex;flex-direction:column;gap:18px;padding-top:32px;border-top:1px solid var(--ks-rule)}
.coverage h2{font:300 clamp(1.8rem,2.6vw,2.3rem)/1.05 var(--ks-font-display);font-variation-settings:'wght' 300;color:var(--ks-ink)}
.coverage-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:32px;align-items:start}
.map-space .map{width:100%}
.side-panel{display:flex;flex-direction:column;gap:14px;align-items:stretch}
.side-panel.quiet p{color:var(--ks-text-muted);font-size:var(--ks-type-ui-size)}
.side-panel.quiet .ks-button{align-self:flex-start}
.side-panel h3{font-size:var(--ks-type-subhead-size,1.25rem);font-weight:500;color:var(--ks-ink)}
.side-panel .eyebrow.missing{color:var(--ks-vermilion)}
.panel-crop{position:relative;width:100%;max-height:180px;overflow:hidden;box-shadow:0 0 0 1px var(--ks-rule);background:var(--ks-paper-deep)}
.panel-form{display:flex;flex-direction:column;gap:12px}
.marking-hint{color:var(--ks-ink)!important;font-weight:500}
.missing-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:var(--ks-type-ui-size)}
.summary{padding-bottom:40px}
.send-row{position:sticky;bottom:0;z-index:10;margin-top:auto;background:var(--ks-paper-raised);border-top:1px solid var(--ks-rule)}
.send-inner{max-width:1240px;margin:0 auto;display:flex;align-items:center;justify-content:flex-end;gap:20px;padding:14px 48px 18px}
.send-row p{font-size:var(--ks-type-ui-size);color:var(--ks-text-muted);text-align:right}

/* The comp overlay (C). */
@keyframes overlay-in{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}
.overlay{position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;background:var(--ks-paper);animation:overlay-in 200ms var(--ks-ease) both}
.overlay-head{flex-shrink:0;height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px 0 28px;border-bottom:1px solid var(--ks-rule)}
.overlay-body{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:28px}

@media (max-width:1100px){.intro{grid-template-columns:1fr;gap:28px;overflow:auto;align-content:start}.intro-comp{height:auto}.intro-comp .map{width:100%!important;height:auto!important}.coverage-grid{grid-template-columns:1fr}}
@media (max-width:760px){
 :host{height:auto;overflow:visible}
 .rv{height:auto;min-height:100dvh}
 .bar{grid-template-columns:1fr auto;grid-template-rows:auto auto;height:auto;gap:8px 12px;padding:10px 16px}
 .bar-title{grid-column:1}
 .bar-locator{display:block;grid-column:2;grid-row:1}
 .lights{grid-column:1/-1;flex-wrap:wrap}
 .screen{overflow:visible}
 .intro{padding:24px 16px}
 .stage{padding:18px 16px 8px}
 .figures{flex:none}
 .locator{display:none}
 .decide-bar{position:sticky;bottom:0;z-index:10;padding:12px 16px calc(12px + env(safe-area-inset-bottom))}
 .decisions{flex-wrap:wrap;width:100%}
 .decisions .ks-button{flex:1 1 40%;min-width:0}
 .cap{display:none}
 .toast{position:fixed;left:16px;bottom:128px;width:max-content;max-width:calc(100% - 32px)}
 .summary{padding:24px 16px 0}
 .send-inner{padding:12px 16px;flex-wrap:wrap}
 .send-row p{text-align:left}
}
@media (prefers-reduced-motion:reduce){*,*::before{animation:none!important;transition:none!important}}
`;
