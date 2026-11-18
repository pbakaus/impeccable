(()=>{function wt(t,e){let o=e?.changes[t],r=e?.feedback?.[t],s=r?.decision??(e?.submitted?e.draft.decisions[t]:void 0),l=o?.kind==="unchanged"&&(o.carried??(e?.submitted&&s?.action==="approve"))===!0;return{change:o,prior:s,feedbackRound:r?.round??e?.packet.round,carried:l,label:o?.kind==="added"?"New component":o?.kind==="changed"?"Review again":l?"Approval kept":s?.action==="revise"?"Changes still requested":"Awaiting review"}}function fe(t,e,o){let r=e.decisions[t.id],s=r?.revision===t.revision?r:void 0,l=wt(t.id,o);if(s?.action==="approve")return{kind:"approved",label:l.carried?"Approval kept":"Approved",priority:3};if(s?.action==="revise")return{kind:"feedback",label:"Feedback ready",priority:2};return{kind:"pending",label:l.change?.kind==="changed"?"Review again":l.change?.kind==="added"?"New · review needed":"Not reviewed",priority:l.change?.kind==="changed"||l.change?.kind==="added"?0:1}}function $n(t){return{packetRevision:t.revision,decisions:{},missing:[],inventoryConfirmed:!1}}function Yt(t){return Object.values(t).every(Number.isFinite)&&t.x>=0&&t.y>=0&&t.w>0&&t.h>0&&t.x+t.w<=1.00001&&t.y+t.h<=1.00001}function _e(t,e){let o=t.components.map((u)=>e.decisions[u.id]?.revision===u.revision?e.decisions[u.id]:void 0),r=o.filter((u)=>u?.action==="approve").length,s=o.filter((u)=>u?.action==="revise").length,l=o.length-r-s,c=s>0||e.missing.length>0;return{approved:r,revisions:s,pending:l,hasFeedback:c,canSubmit:e.packetRevision===t.revision&&e.missing.every((u)=>u.name.trim()&&Yt(u.box))&&(c||!l&&e.inventoryConfirmed)}}function Mn(t,e){let o={...e.decisions};for(let r of t.components)if(!o[r.id]||o[r.id].revision!==r.revision)o[r.id]={revision:r.revision,action:"approve",feedback:"",split:!1};return{...e,decisions:o}}function En(t,e){if(!_e(t,e).canSubmit)throw Error("Review is incomplete or stale");return{schemaVersion:1,requestId:t.id,...structuredClone(e)}}function Xe(t){let e=t.preview.kind==="page"||t.preview.sourceKind==="page",o=t.preview.sourceKind==="page";return{code:e,captured:o,label:e?t.medium.match(/html|css|svg/i)?t.medium:"HTML / CSS / SVG":"Raster",caption:e?o?t.preview.isolation?"Component only":"Region capture":"Live component":"Produced asset",fileLabel:o?"Open captured preview":"Open source image"}}function zn(t,e,o){let r=t.components.findIndex((s)=>s.id===o);for(let s=1;s<=t.components.length;s++){let l=t.components[(r+s)%t.components.length];if(fe(l,e).kind==="pending")return l.id}}function yt(t,e){if(!e.reviewGroup||!Xe(e).code)return[e];return t.components.filter((o)=>o.reviewGroup===e.reviewGroup&&Xe(o).code)}function pt(t,e,o,r,s=[]){let l=r?yt(t,o):[o];if(l.length===1)return[o];return l.filter((c)=>fe(c,e).kind==="pending"&&(c.id===o.id||!s.includes(c.id)))}function Sn(t,e,o){let r=new Set;return t.components.flatMap((s)=>{if(r.has(s.id))return[];let l=yt(t,s);l.forEach((k)=>r.add(k.id));let c=l.filter((k)=>fe(k,e,o).kind==="pending"),u=l.filter((k)=>fe(k,e,o).kind==="feedback"),w=c[0]??u[0]??s,L=c.length?"pending":u.length?"feedback":"approved";return[{id:s.id,members:l,representative:w,pending:c.length,kind:L,label:l.length>1?s.reviewGroup.replace(/[-_]+/g," ").replace(/^./,(k)=>k.toUpperCase()):s.name,box:{x:Math.min(...l.map((k)=>k.box.x)),y:Math.min(...l.map((k)=>k.box.y)),w:Math.max(...l.map((k)=>k.box.x+k.box.w))-Math.min(...l.map((k)=>k.box.x)),h:Math.max(...l.map((k)=>k.box.y+k.box.h))-Math.min(...l.map((k)=>k.box.y))},stateLabel:c.length?l.length>1?`${c.length} to review`:fe(w,e,o).label:u.length?l.length>1?`${u.length} ${u.length===1?"needs":"need"} work`:"Feedback ready":"Approved"}]})}function $t(t,e){let o=new Set(e.preview.isolation?.excludedComponents??[]),r=e.box,s=t.components.filter((l)=>{if(l.id===e.id)return!1;if(o.has(l.id))return!0;let c=l.box,u=Math.min(r.x+r.w,c.x+c.w)-Math.max(r.x,c.x),w=Math.min(r.y+r.h,c.y+c.h)-Math.max(r.y,c.y);return c.w*c.h<r.w*r.h&&u*t.comp.width>1&&w*t.comp.height>1});return{description:e.note.trim(),related:s,excluded:s.filter((l)=>o.has(l.id))}}function Xt(t,e,o,r,s){let l=s==="fit"?Math.min(1,o/t,r/e):s;return{scale:l,width:t*l,height:e*l}}function _t(t,e,o,r){if(o<=0||r<=o)return 0;return Math.max(0,Math.min(1,((t-e)/o-0.08)/0.84))*(r-o)}var Ln=`
:host{height:var(--component-review-height,100dvh);min-height:0;overflow:hidden}
.review{height:100%;max-width:none;min-height:0;padding:0;display:flex;flex-direction:column;overflow:hidden;background:var(--color-bg,var(--ks-paper))}
.review>header{flex-shrink:0;padding:16px 24px;margin:0;border-bottom:1px solid var(--line);gap:16px}.review>header>div{min-width:0}.review h1{font-size:30px;line-height:1}.review>header p{font-size:12px;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.review .badge{font-size:11px}
.review>.preview-note{flex-shrink:0;margin:0;padding:8px 24px;font-size:11px}.review>.round-summary{flex-shrink:0;margin:0;padding:8px 24px;border-top:0;gap:6px 16px;max-height:120px;overflow:auto}.round-summary p{font-size:12px;gap:6px 14px}.round-summary button{font-size:12px;min-height:32px;padding:5px 10px}
.review>.workbench{flex:1;min-height:0;align-items:stretch;padding:20px 24px;gap:32px;overflow:hidden;grid-template-columns:minmax(0,1.12fr) minmax(0,1fr)}.reference{display:flex;flex-direction:column;min-height:0;width:100%;max-width:none;margin:0}.reference>.section-head{flex-shrink:0;margin-bottom:10px}.map-space{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:var(--ks-paper-deep);border:1px solid var(--line);overflow:hidden}.map{flex-shrink:0;max-width:100%;max-height:100%}.map-legend{flex-shrink:0;margin-top:9px;gap:6px 14px}.map-caption{flex-shrink:0;min-height:0;padding-top:6px;font-size:10px}.map-caption button{display:inline-block;margin:0 0 0 8px;min-height:28px;padding:3px 7px}
.workbench>.inspector{height:100%;min-height:0;padding:0;border:0}.inspector>.section-head{margin-bottom:10px;min-height:32px}.section-head h2{font-size:16px}.inspection-content{padding-bottom:8px}.review-form{max-height:55%;overflow-y:auto;scrollbar-width:thin;scrollbar-gutter:stable}.material{min-height:28px}.material strong{font-size:13px}.compare-toolbar{margin-bottom:12px}.previous-feedback{padding:10px 12px}.repair-context{margin-bottom:12px}.preview-round{margin-bottom:10px}.decision-title p{font-size:11px}.decision-title strong{font-size:13px}.view-controls{margin-top:8px}.component-details{height:auto;max-height:80px}
.review>.inventory-section{height:236px;flex-shrink:0;display:flex;flex-direction:column;min-height:0;margin:0;padding:10px 24px 8px;border-top:1px solid var(--line);background:var(--color-panel,var(--ks-paper));overflow:hidden}.inventory-section>.section-head{margin:0 0 8px;min-height:36px;flex-shrink:0;gap:10px}.inventory-section h2{font-size:14px}.inventory{flex:1;min-height:0;align-items:stretch;margin:0;padding:3px 3px 7px;overflow-x:auto;overflow-y:hidden}.inventory.all{overflow:auto;align-items:start;grid-auto-rows:160px}.inventory .item{flex:0 0 136px;padding:8px;gap:3px;grid-template-rows:auto auto minmax(24px,1fr) auto;min-height:0}.inventory .item-thumb{height:46px;margin-bottom:3px}.inventory .thumb-crop{max-height:46px}.inventory .item-number{font-size:11px;min-height:16px;padding:0}.inventory .item strong{font-size:12px;min-height:26px;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.inventory .state{font-size:11px;padding-top:4px}.tray-actions{display:flex;gap:6px;align-items:center}.tray-actions button{white-space:nowrap;font-size:11px;min-height:32px}.tray-actions svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.review>.inventory-section.tray-expanded{height:min(42dvh,390px)}.review>.inventory-section.tray-collapsed{height:56px;padding-block:10px}.tray-collapsed .inventory{display:none}.tray-collapsed>.section-head{margin-bottom:0}
.review>footer{flex-shrink:0;margin:0;padding:12px 24px;gap:16px;border-top:1px solid var(--line);background:var(--paper);align-items:center}.review>footer>div:first-child{display:flex;align-items:center;gap:14px;min-width:0}.review>footer .check{margin:0;max-width:240px;font-size:11px}.review>footer .submit-area{gap:12px}.review>footer .submit-area p{font-size:11px;max-width:24ch}.mobile-panes{display:none}
/* Depth describes the shell: recessed work area, raised inspector, anchored docks. */
.review{--workspace:var(--ks-paper);--canvas:var(--ks-paper-deep);--dock:var(--ks-paper);--surface:var(--ks-paper-raised);background:var(--workspace)}
.review>header{position:relative;z-index:8;background:var(--surface);border-bottom-color:var(--ks-rule)}
.review>.round-summary,.review>.preview-note{position:relative;z-index:7;background:var(--dock);box-shadow:0 3px 6px oklch(13% 0 0 / 0.06);border-bottom-color:var(--ks-rule)}
.review>.workbench{background:var(--workspace)}
.map-space{background:var(--canvas);border-color:var(--ks-rule);box-shadow:inset 0 2px 7px oklch(13% 0 0 / 0.07);border-radius:5px}
.map{box-shadow:0 3px 10px oklch(13% 0 0 / 0.17)}
.workbench>.inspector{background:var(--surface);border-radius:6px;box-shadow:0 2px 4px oklch(13% 0 0 / 0.07),0 8px 24px oklch(13% 0 0 / 0.09);scrollbar-gutter:auto;isolation:isolate}
.inspector>.section-head{position:relative;z-index:2;margin:0;padding:12px 16px;background:var(--surface);border-bottom:1px solid var(--ks-rule)}
.inspection-content{padding:14px 12px 14px 16px;background:var(--ks-paper)}
.inspector>.review-form{position:relative;z-index:2;padding:12px 12px 12px 16px;background:var(--surface);border-top:1px solid var(--ks-rule)}
.inspector[data-scroll-above=true]>.section-head{box-shadow:0 6px 8px -4px oklch(13% 0 0 / 0.22)}
.inspector[data-scroll-below=true]>.review-form{box-shadow:0 -6px 8px -4px oklch(13% 0 0 / 0.22)}
.inspection-content,.review-form,.inventory{scrollbar-width:auto;scrollbar-color:var(--ks-gray-2) var(--ks-paper-deep);overscroll-behavior:contain}
.inspection-content::-webkit-scrollbar,.review-form::-webkit-scrollbar,.inventory::-webkit-scrollbar{width:10px;height:10px}
.inspection-content::-webkit-scrollbar-track,.review-form::-webkit-scrollbar-track,.inventory::-webkit-scrollbar-track{background:var(--ks-paper-deep);border-radius:6px}
.inspection-content::-webkit-scrollbar-thumb,.review-form::-webkit-scrollbar-thumb,.inventory::-webkit-scrollbar-thumb{background:var(--ks-gray-2);border:2px solid var(--ks-paper-deep);border-radius:6px}
.review>.inventory-section{position:relative;z-index:8;background:var(--dock);border-top-color:var(--ks-rule);box-shadow:0 -3px 5px oklch(13% 0 0 / 0.05),0 -10px 24px oklch(13% 0 0 / 0.08)}
.inventory-section>.section-head{border-bottom:1px solid var(--ks-rule);padding-bottom:8px;margin-bottom:8px}
.tray-collapsed>.section-head{border:0;padding-bottom:0;margin-bottom:0}
.inventory{background:transparent;border-radius:0;padding:3px 3px 7px}
.inventory .item{background:var(--ks-paper)}
.inventory .item.active{background:var(--ks-paper-raised)}
.review>footer{position:relative;z-index:9;background:var(--surface);border-top-color:var(--ks-rule);box-shadow:0 -2px 5px oklch(13% 0 0 / 0.04)}
.mobile-panes{position:relative;z-index:7;box-shadow:0 3px 6px oklch(13% 0 0 / 0.06)}
/* Utility actions share a compact icon language; decisions retain explicit labels. */
.utility-icon{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.review .tray-actions .utility-icon{width:18px;height:18px;stroke-width:1.6}
.material{align-items:center;margin-bottom:10px}
.compare-toolbar{margin-bottom:10px}
.view-controls{min-height:0}.view-controls>.background-options{margin-left:auto;gap:2px}.page-swatch{background:var(--comp-background,var(--ks-paper-deep))}
.review>footer .submit-area p{max-width:25ch}
@media(max-width:1100px) and (min-width:801px){.review>header{padding:12px 20px}.review>.workbench{padding:16px 20px;gap:24px}.review>.round-summary{padding-inline:20px}.round-summary p{max-width:calc(100% - 52px)}.round-summary p>span{font-size:11px}.inventory-section>.section-head h2{max-width:none;white-space:nowrap}.review>footer>div:first-child{gap:8px}.review>footer .submit-area p{max-width:19ch}}
@media(max-width:800px){
 .review>header{padding:12px 14px;align-items:center}.review h1{font-size:25px}.review>header p{max-width:68vw;font-size:11px}.review .badge{display:none}.review>.preview-note{padding:6px 14px}.review>.round-summary{padding:6px 14px;max-height:76px;gap:4px 8px}.round-summary p{max-width:calc(100% - 44px);gap:4px 10px;font-size:11px}.round-summary p>span{font-size:10px}.round-summary button{font-size:11px}
 .mobile-panes{display:flex;flex-shrink:0;gap:4px;padding:7px 14px;border-bottom:1px solid var(--line);background:var(--paper)}
 .review>.workbench{display:block;padding:12px 14px;min-height:0;overflow:hidden}.workbench[data-mobile-pane=component]>.reference,.workbench[data-mobile-pane=comp]>.inspector{display:none}.reference{height:100%;max-width:none}.connector{display:none}.inspector{height:100%;border:0}.map-legend{gap:6px 12px;font-size:10px}.map-caption{font-size:9px}.reference .section-head button{min-height:30px;padding:4px 8px}.reference .section-head h2{font-size:14px}.inspector>.section-head{min-height:26px;margin-bottom:0;padding:9px 12px}.inspection-content{padding:10px 8px 10px 12px}.inspector>.review-form{padding:8px 8px 8px 12px}.number{width:23px;height:23px;font-size:11px}.section-head h2{font-size:14px}.review-form{padding-top:8px}.decision-title strong{font-size:12px}.decision-title p{font-size:10px}.review-form .feedback-field{font-size:12px}.review-form .feedback-field textarea{min-height:60px}.compare{max-width:none}
 .review>.inventory-section{height:160px;padding:6px 14px}.inventory-section>.section-head{flex-direction:row;flex-wrap:nowrap;align-items:center;gap:6px;min-height:34px;margin-bottom:4px}.inventory-section h2{display:none}.tray-actions svg{width:16px;height:16px}.review>.inventory-section.tray-collapsed{height:46px;padding:6px 14px}.review>.inventory-section.tray-expanded{height:160px}.inventory .item{flex-basis:130px;grid-template-rows:auto 1fr auto;padding:6px}.inventory .item-thumb{display:none}.inventory.all{display:flex;overflow-x:auto;overflow-y:hidden}.inventory .item strong{font-size:11px;min-height:22px}.inventory .state{font-size:10px}.inventory .item-number{font-size:10px;min-height:14px}.inventory-empty{padding:8px 0;font-size:12px}
 .review>footer{padding:8px 14px calc(8px + env(safe-area-inset-bottom));gap:8px;flex-direction:column;align-items:stretch}.review>footer>div:first-child{gap:10px;justify-content:space-between}.review>footer .check{font-size:10px;max-width:48%;gap:4px}.review>footer .check input{width:14px;height:14px}.review>footer .submit-area{justify-content:space-between;gap:10px}.review>footer .submit-area p{font-size:10px;max-width:22ch}
}
`;var Tn=`/* VENDORED from impeccable-site/site/styles/kinpaku-tokens.css (the source of truth).
   Do not edit here: change the site, then run node scripts/sync-kinpaku-kit.mjs. */
/*
 * impeccable.style tokens (page-global, single source of truth)
 *
 * One theme. The page is neutral paper, the type is ink, and the brand gold
 * appears as a mark, a line, or an indicator on a dark control surface. It
 * never carries text and it never fills a large area on paper.
 *
 * Three families of surface:
 *   paper       the page and everything that sits flat on it
 *   gray        chips, inactive fills, sunk wells
 *   instrument  dark control surfaces: sliders, tab strips, segmented
 *               controls, terminals. This is where gold and patina signal.
 *
 * New pages read these via var(--ks-*) rather than hand-typing oklch values.
 * Pages may override a token locally when there is a documented reason.
 * When in doubt, do not override; match.
 */

:root {
	color-scheme: light;

	/* ============================================================
	   Brand anchors. Kinpaku gold is the mark and the signal. Verdigris
	   patina carries state, links, and selection wherever color has to
	   be read as text, because gold cannot pass contrast on paper.
	   ============================================================ */

	/* Kinpaku gold. Fills on instruments, the mark, hairlines, and the label
	   of the active key on a dark instrument. Never text on paper. */
	--ks-kinpaku:        oklch(84% 0.19 80.46);  /* mark, indicators, gold fills on instruments */
	--ks-kinpaku-vivid:  oklch(87% 0.20 85);     /* lit hover on a gold fill */
	--ks-kinpaku-pale:   oklch(86% 0.07 84);     /* pale tint; rarely needed on paper */
	--ks-kinpaku-rich:   oklch(77% 0.13 82);     /* hairline gold on paper, active rule */
	--ks-kinpaku-deep:   oklch(61% 0.085 78);    /* gold border against paper */
	--ks-on-gold:        oklch(14% 0.018 95);    /* foreground on a gold fill */
	--ks-gold-line:      var(--ks-kinpaku-rich); /* the one-pixel gold rule */

	/* Verdigris patina. State, links, selection. */
	--ks-patina:         oklch(70% 0.12 188);    /* indicator on instruments, focus */
	--ks-patina-pale:    oklch(82% 0.07 188);    /* soft fill behind a selected row */
	--ks-patina-deep:    oklch(45% 0.10 190);    /* text-safe patina, including selected gray surfaces */
	--ks-patina-ink:     oklch(41% 0.11 190);    /* hover on patina text */

	/* Semantic foregrounds. Labels, eyebrows and category names are muted
	   ink; color is not how this site labels things. Patina is reserved for
	   state: selected, live, passed. */
	--ks-gold-ink:       var(--ks-text-muted);
	--ks-accent-ink:     var(--ks-text-muted);
	--ks-state-ink:      var(--ks-patina-deep);
	--ks-focus-ring:     var(--ks-patina-deep); /* paper; dark controls override locally */
	--ks-kinpaku-ink:    var(--ks-text-muted);   /* legacy alias, same rule */

	/* Links on paper are ink with a quiet underline; the underline turns
	   gold on hover, which is the brand as a line. */
	--ks-link-on-paper:            var(--ks-ink);
	--ks-link-on-paper-hover:      var(--ks-ink);
	--ks-link-on-paper-line:       oklch(13% 0 0 / 0.28);
	--ks-link-on-paper-line-hover: var(--ks-kinpaku);
	--ks-nav-active:               var(--ks-ink);

	/* Warning. Failures and warnings only. */
	--ks-vermilion:      oklch(52% 0.16 35);

	/* ============================================================
	   Paper. The page ground is a hair below white so a raised card can
	   read as raised. Neutral, no warm cast: gold on cream is gold on gold.
	   ============================================================ */
	--ks-paper:          oklch(97.8% 0 0);   /* page ground */
	--ks-paper-raised:   oklch(99.5% 0 0);   /* cards, panels, inputs */
	--ks-paper-deep:     oklch(95% 0 0);     /* sunk wells, code blocks, footer */
	--ks-gray:           oklch(92% 0 0);     /* chips, inactive fills */
	--ks-gray-2:         oklch(88% 0 0);     /* one step down from gray */

	/* ============================================================
	   Instrument. Dark control surfaces on the paper, like a device on a
	   desk. The only place the site goes dark, and the only place gold is
	   read as a signal rather than a mark.
	   ============================================================ */
	--ks-instrument:        oklch(24% 0 0);          /* face */
	--ks-instrument-deep:   oklch(17% 0 0);          /* track, well */
	--ks-instrument-raised: oklch(31% 0 0);          /* key cap, thumb */
	--ks-instrument-text:   oklch(93% 0 0);
	--ks-instrument-muted:  oklch(68% 0 0);
	--ks-instrument-rule:   oklch(100% 0 0 / 0.12);
	--ks-instrument-edge:   oklch(100% 0 0 / 0.3);

	/* ============================================================
	   Ink. Neutral. Body copy is --ks-text; headlines and <strong> are
	   --ks-ink. Muted is for labels and captions, faint for meta.
	   ============================================================ */
	--ks-ink:            oklch(13% 0 0);   /* headlines, <strong>, active nav */
	--ks-text:           oklch(22% 0 0);   /* body */
	--ks-text-muted:     oklch(46% 0 0);   /* captions, meta, eyebrows */
	--ks-text-faint:     oklch(51% 0 0);   /* subdued meta, readable on paper and gray */
	--ks-text-mute-deep: oklch(66% 0 0);   /* disabled */

	/* ============================================================
	   Rules. A divider is faint. The boundary of a control is not:
	   WCAG 1.4.11 asks 3:1 of anything that tells you where a control is.
	   Use --ks-rule to divide, --ks-edge to bound something you can operate.
	   ============================================================ */
	--ks-rule:           oklch(13% 0 0 / 0.08);
	--ks-edge:           oklch(13% 0 0 / 0.45);

	/* ============================================================
	   Control scales. Three radii, three heights, two lifts.
	   ============================================================ */
	--ks-radius-sm:      3px;
	--ks-radius-md:      8px;
	--ks-radius-pill:    999px;

	--ks-control-sm:     26px;
	--ks-control-md:     32px;
	--ks-control-lg:     44px;

	/* Section cadence. Every top-level section on a page takes this vertical
	   padding, so the seams between sections are one rhythm. */
	--ks-section-pad:    clamp(72px, 8vw, 120px);

	/* Layered, so they read as one soft light from above rather than a
	   single blurred rectangle: a contact edge, a short throw, a long one. */
	--ks-lift-1:         0 1px 1px oklch(13% 0 0 / 0.05), 0 2px 3px oklch(13% 0 0 / 0.04), 0 6px 12px oklch(13% 0 0 / 0.05);
	--ks-lift-2:         0 1px 1px oklch(13% 0 0 / 0.04), 0 3px 5px oklch(13% 0 0 / 0.05), 0 12px 20px oklch(13% 0 0 / 0.06), 0 32px 48px oklch(13% 0 0 / 0.07);

	/* Instrument depth. A raised key sits a pixel off its dark strip, and the
	   lit indicator throws a short gold glow. These are the only shadows that
	   read against a dark surface. */
	--ks-key-lift:       0 1px 2px oklch(0% 0 0 / 0.4);

	/* Light hardware. A paper key is a raised cap: a white highlight along
	   its top edge, a hard 1px shadow under it, a soft one behind. The track
	   it sits in is recessed. Gold is the lit indicator. */
	--ks-cap-lift:       inset 0 1px 0 oklch(100% 0 0 / 0.9), 0 1px 0 oklch(13% 0 0 / 0.14), 0 2px 3px oklch(13% 0 0 / 0.08);
	--ks-cap-press:      inset 0 1px 2px oklch(13% 0 0 / 0.14);
	--ks-track-recess:   inset 0 1px 3px oklch(13% 0 0 / 0.16), inset 0 -1px 0 oklch(100% 0 0 / 0.7);
	--ks-led:            0 0 0 1px oklch(13% 0 0 / 0.12), 0 0 4px oklch(84% 0.19 80 / 0.6);
	--ks-indicator-glow: 0 0 0 1px oklch(0% 0 0 / 0.3), 0 0 4px oklch(84% 0.19 80 / 0.65);

	/* ============================================================
	   Code. Inline code is a gray chip. Blocks and CLI commands are a sunk
	   paper well with a hairline. A command that is itself a link reads as
	   a link.
	   ============================================================ */
	--ks-code-fg:         var(--ks-ink);
	--ks-code-bg:         var(--ks-gray);
	--ks-code-radius:     3px;
	--ks-code-pad:        0.2em 0.45em;
	--ks-code-block-fg:   var(--ks-text);
	--ks-code-block-bg:   var(--ks-paper-deep);
	--ks-code-block-border: var(--ks-rule);
	--ks-code-block-radius: 3px;
	--ks-code-cmd:        var(--ks-link-on-paper);

	/* ============================================================
	   Typography. One family for everything that is read: Albert Sans, a
	   quiet geometric humanist, at normal weights. The wordmark keeps
	   Alumni Sans because it is part of the logo lockup, and that is the
	   only place it appears.
	   ============================================================ */
	--ks-font:          "Albert Sans", "Avenir Next", "Helvetica Neue", Arial, system-ui, sans-serif;
	--ks-font-display:  var(--ks-font-wordmark);  /* Alumni Sans: the brand's own display voice, at a weight that holds on paper */
	--ks-font-wordmark: "Alumni Sans", "Albert Sans", Arial, sans-serif;
	--ks-mono:          "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;

	/* Display: page h1. */
	--ks-type-display-size:   clamp(3.2rem, 6.2vw, 5.6rem);
	--ks-type-display-weight: 200;
	--ks-type-display-line:   1.0;
	--ks-type-display-track:  0;

	/* Headline: section h2. */
	--ks-type-headline-size:   clamp(2.4rem, 3.6vw, 3.4rem);
	--ks-type-headline-weight: 300;
	--ks-type-headline-line:   1.04;
	--ks-type-headline-track:  0;

	/* Title: card and panel headings (h3). */
	--ks-type-title-size:   1.0625rem;
	--ks-type-title-weight: 600;
	--ks-type-title-line:   1.35;

	/* Body. */
	--ks-type-body-size: 1rem;
	--ks-type-body-line: 1.65;

	/* Eyebrow: small mono labels above titles. */
	--ks-type-eyebrow-size:  0.6875rem;
	--ks-type-eyebrow-track: 0.14em;

	/* Wordmark: IMPECCABLE in the header. */
	--ks-type-wordmark-size:  1.25rem;
	--ks-type-wordmark-track: 0.18em;

	/* Mono: code, terminal, audit lines. */
	--ks-type-mono-size:  0.6875rem;
	--ks-type-mono-track: 0.12em;

	/* Dense UI ramp. Micro is the floor for anything functional. */
	--ks-type-micro-size: 0.6875rem;  /* 11px */
	--ks-type-label-size: 0.75rem;    /* 12px */
	--ks-type-ui-size:    0.8125rem;  /* 13px */
	--ks-type-ui-lead:    0.9375rem;  /* 15px */

	/* Reading ramp between body and headline. Small is secondary body copy
	   and captions that are read, not scanned; lead and subhead are the
	   intro paragraph and the card-level heading; title-lg is a bento tile
	   or panel heading that is larger than a card title but not a section. */
	--ks-type-small-size:    0.875rem;   /* 14px */
	--ks-type-lead-size:     1.125rem;   /* 18px */
	--ks-type-subhead-size:  1.25rem;    /* 20px */
	--ks-type-title-lg-size: 1.5rem;     /* 24px */

	/* ============================================================
	   Motion. Quick is a state change, settle is something arriving.
	   ============================================================ */
	--ks-ease:   cubic-bezier(0.2, 0.8, 0.2, 1);
	--ks-quick:  120ms;
	--ks-settle: 200ms;
}
`,Cn=`/* VENDORED from impeccable-site/site/styles/kinpaku-kit.css (buttons, tabs, select, icon button, instrument strip, grain, switch, paper strip, thumb) (the source of truth).
   Do not edit here: change the site, then run node scripts/sync-kinpaku-kit.mjs. */
/* ============================================================
   Buttons: primary, secondary, ghost, disabled

   The primary action is ink on paper. Gold does not fill a button on this
   site: a gold slab on paper is the hotel-lobby read. The brand is present
   on the primary as the gold arrow, not as the fill.

   Variants chain on .ks-button so specificity (0,2,0) wins over generic page
   anchor resets like \`.kinpaku-system-page a { color: inherit }\` (0,1,1).
   Use class="ks-button ks-button-primary", both classes required.
   ============================================================ */

.ks-button {
  position: relative;
  min-height: var(--ks-control-lg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 0 22px;
  border-radius: var(--ks-radius-sm);
  font-family: var(--ks-font);
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.005em;
  text-decoration: none;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color var(--ks-quick) var(--ks-ease), border-color var(--ks-quick) var(--ks-ease), color var(--ks-quick) var(--ks-ease);
}

.ks-button .ks-button-arrow {
  width: 16px;
  height: 8px;
  display: inline-block;
  flex: none;
}

.ks-button-arrow svg { width: 100%; height: 100%; display: block; overflow: visible; }

/* The arrow says where the button goes. On a button whose target is further
   down the page (an in-page anchor, or .is-down on the arrow) it curves and
   points downward on hover, and straightens again on leave. The rest shape
   is set here too, as the same command list, so the two interpolate. */
.ks-button-arrow path {
  d: path("M0 4C5 4 9 4 14 4M10 0L14 4L10 8");
  transition: d 420ms var(--ks-ease);
}

.ks-button[href^="#"]:hover .ks-button-arrow path,
.ks-button:hover .ks-button-arrow.is-down path {
  d: path("M0 4C7 4 11 4 11 11M7 7L11 11L15 7");
}

@media (prefers-reduced-motion: reduce) {
  .ks-button-arrow path { transition: none; }
}

.ks-button.ks-button-primary {
  color: var(--ks-paper-raised);
  background: var(--ks-ink);
  border-color: var(--ks-ink);
}

.ks-button.ks-button-primary .ks-button-arrow {
  color: var(--ks-kinpaku);
}

.ks-button.ks-button-primary:hover {
  color: var(--ks-paper-raised);
  background: var(--ks-text);
  border-color: var(--ks-text);
}

.ks-button.ks-button-primary:active {
  background: oklch(8% 0 0);
  border-color: oklch(8% 0 0);
}

.ks-button.ks-button-secondary {
  color: var(--ks-ink);
  background: var(--ks-paper-raised);
  border-color: var(--ks-edge);
}

.ks-button.ks-button-secondary:hover {
  color: var(--ks-ink);
  border-color: var(--ks-ink);
}

.ks-button.ks-button-secondary:active {
  background: var(--ks-gray);
}

.ks-button.ks-button-ghost {
  color: var(--ks-ink);
  background: transparent;
  border-color: transparent;
  padding: 0 12px;
}

.ks-button.ks-button-ghost:hover {
  color: var(--ks-accent-ink);
}

.ks-button[disabled],
.ks-button.ks-button-disabled {
  color: var(--ks-text-mute-deep);
  background: transparent;
  border-color: var(--ks-rule);
  cursor: not-allowed;
  transform: none !important;
}

.ks-button:focus-visible {
  outline: 2px solid var(--ks-focus-ring);
  outline-offset: 3px;
}

.ks-button-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 18px;
}

/* ============================================================
   Tabs
   ============================================================ */

.ks-tabs { max-width: 460px; }

.ks-tab-list { display: flex; border-bottom: 1px solid var(--ks-rule); }

.ks-tab-list button {
  flex: 1;
  min-height: 42px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ks-text-muted);
  cursor: pointer;
  font-size: 0.92rem;
  transition: color 180ms var(--ks-ease), border-color 180ms var(--ks-ease);
}

.ks-tab-list button:hover { color: var(--ks-ink); }

.ks-tab-list button[aria-selected="true"] {
  color: var(--ks-accent-ink);
  border-bottom-color: var(--ks-kinpaku);
}

.ks-tab-panel {
  padding: 22px 4px 0;
  color: var(--ks-ink);
  font-size: 0.92rem;
  line-height: 1.6;
}

/* ============================================================
   Form controls — input, toggle, checkbox, select
   ============================================================ */

.ks-form-sample {
  display: grid;
  gap: 22px;
  max-width: 360px;
}

.ks-form-sample label {
  display: grid;
  gap: 8px;
  color: var(--ks-text-muted);
  font-size: 0.82rem;
  letter-spacing: 0.04em;
}

.ks-form-sample input[type="search"],
.ks-form-sample input[type="text"] {
  min-height: 46px;
  padding: 0 14px;
  border: 1px solid var(--ks-rule);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-paper-raised);
  color: var(--ks-ink);
  font-size: 0.92rem;
}

.ks-form-sample input[type="search"]:focus,
.ks-form-sample input[type="text"]:focus {
  outline: none;
  border-color: var(--ks-patina);
}

.ks-toggle {
  display: flex !important;
  align-items: center;
  gap: 12px !important;
}

.ks-toggle input {
  appearance: none;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--ks-rule);
  background: var(--ks-gray);
  position: relative;
  cursor: pointer;
  flex: none;
}

.ks-toggle input::before {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  left: 3px;
  top: 3px;
  border-radius: 999px;
  background: var(--ks-text-muted);
  transition: transform 220ms var(--ks-ease), background 220ms var(--ks-ease);
}

.ks-toggle input:checked {
  border-color: var(--ks-patina);
  background: oklch(48% 0.08 188 / 0.2);
}

.ks-toggle input:checked::before {
  transform: translateX(20px);
  background: var(--ks-patina);
}

.ks-toggle span { color: var(--ks-ink); font-size: 0.92rem; }

.ks-checkbox {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ks-ink);
  font-size: 0.92rem;
  cursor: pointer;
}

.ks-checkbox input {
  appearance: none;
  width: 18px;
  height: 18px;
  border: 1px solid var(--ks-rule);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-paper-raised);
  position: relative;
  cursor: pointer;
  flex: none;
}

.ks-checkbox input:checked {
  border-color: var(--ks-ink);
  background: var(--ks-ink);
}

.ks-checkbox input:checked::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 2px;
  width: 5px;
  height: 9px;
  border: solid var(--ks-paper-raised);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.ks-select {
  appearance: none;
  min-height: 46px;
  padding: 0 38px 0 14px;
  border: 1px solid var(--ks-rule);
  border-radius: var(--ks-radius-sm);
  background-color: var(--ks-paper-raised);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='%23222222' stroke-width='1.2'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  background-size: 10px 6px;
  color: var(--ks-ink);
  font-size: 0.92rem;
  cursor: pointer;
}

/* ============================================================
   Icon button + tooltip
   ============================================================ */

.ks-icon-button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid var(--ks-rule);
  border-radius: 999px;
  background: transparent;
  color: var(--ks-accent-ink);
  cursor: pointer;
}

.ks-tooltip {
  position: absolute;
  bottom: calc(100% - 18px);
  left: 50%;
  transform: translateX(-50%);
  width: 200px;
  padding: 10px 12px;
  border: 1px solid var(--ks-rule);
  background: var(--ks-paper-deep);
  color: var(--ks-ink);
  font-size: 0.8rem;
  line-height: 1.4;
  border-radius: var(--ks-radius-sm);
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms var(--ks-ease);
}

.ks-icon-button:focus-visible + .ks-tooltip {
  opacity: 1;
}

/* ============================================================
   Instrument strip: the site's one dark control.

   A row of keys on a dark strip, sitting on the paper like a device on a
   desk. The active key is raised and carries a gold indicator. Use for tab
   strips, view switches and command pickers: anything the reader operates.
   Never for decoration, and never for a link list.

   Markup: <div class="ks-instrument-strip" role="tablist">
             <button class="ks-instrument-key is-active">One</button>
             <button class="ks-instrument-key">Two</button>
           </div>
   ============================================================ */
.ks-instrument-strip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--ks-instrument);
  border: 1px solid var(--ks-instrument-deep);
  border-radius: var(--ks-radius-pill);
  box-shadow: inset 0 1px 0 var(--ks-instrument-rule), var(--ks-lift-1);
}

.ks-instrument-key {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: var(--ks-control-md);
  padding: 0 14px 0 12px;
  color: var(--ks-instrument-muted);
  background: transparent;
  border: 0;
  border-radius: var(--ks-radius-pill);
  font-family: var(--ks-mono);
  font-size: var(--ks-type-label-size);
  letter-spacing: 0.02em;
  text-transform: none;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--ks-quick) var(--ks-ease), background-color var(--ks-quick) var(--ks-ease);
}

.ks-instrument-key::before {
  content: "";
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--ks-instrument-raised);
  box-shadow: inset 0 0 0 1px var(--ks-instrument-rule);
  transition: background-color var(--ks-quick) var(--ks-ease), box-shadow var(--ks-quick) var(--ks-ease);
}

.ks-instrument-key:hover,
.ks-instrument-key:focus-visible {
  color: var(--ks-instrument-text);
}

.ks-instrument-key:focus-visible {
  outline: 2px solid var(--ks-focus-ring);
  outline-offset: 2px;
}

.ks-instrument-key.is-active,
.ks-instrument-key[aria-selected="true"] {
  color: var(--ks-instrument-text);
  background: var(--ks-instrument-raised);
  box-shadow: inset 0 1px 0 var(--ks-instrument-edge), var(--ks-key-lift);
}

.ks-instrument-key.is-active::before,
.ks-instrument-key[aria-selected="true"]::before {
  background: var(--ks-kinpaku);
  box-shadow: var(--ks-indicator-glow);
}

/* ============================================================
   Grain.

   Grain is part of a material, not a layer over the page. The page ground
   (the paper) carries it, and so do the moulded surfaces: the recessed
   track and raised caps of a paper strip, the dark instruments, code
   blocks. Anything that sits on top of those (a card, a demo, an image,
   type) is clean. One 160px tile of monochrome noise from an SVG filter,
   held under 6% on paper and a little higher on dark, where it is what
   makes a strip read as a part instead of a black rectangle.
   ============================================================ */
:root {
  --ks-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n' x='0' y='0'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* The paper. Fixed behind the page's content, above the canvas colour. */
body {
  position: relative;
  isolation: isolate;
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  opacity: 0.055;
  mix-blend-mode: multiply;
  background-image: var(--ks-grain);
  background-size: 160px 160px;
}

/* Moulded surfaces. The pseudo sits under the surface's own children. */
.ks-grain,
.ks-instrument-strip {
  position: relative;
}

.ks-grain::before,
.ks-instrument-strip::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0.16;
  mix-blend-mode: screen;
  will-change: opacity;
  background-image: var(--ks-grain);
  background-size: 160px 160px;
}

.ks-instrument-strip.is-paper::before {
  opacity: 0.05;
  mix-blend-mode: normal;
}

/* The strip is its own stacking context: grain at 0, the cap at 1, the
   labels at 2, whatever the page around it does. */
.ks-instrument-strip {
  isolation: isolate;
}


.ks-instrument-strip > :not(.ks-thumb) {
  position: relative;
  z-index: 2;
}

/* ============================================================
   Switch: a physical slide switch for one on/off state.

   A recessed track, a raised knob that slides from left (off) to right
   (on), and a lit dot on the knob when on. Markup:
   <button class="ks-switch" type="button" aria-pressed="true">
     <span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span>
     <span class="ks-switch-label">Detector on</span>
   </button>
   ============================================================ */
.ks-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ks-text-muted);
  font-family: var(--ks-font);
  font-size: var(--ks-type-ui-size);
  font-weight: 500;
  cursor: pointer;
}

.ks-switch[aria-pressed="true"] {
  color: var(--ks-ink);
}

.ks-switch-track {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-gray-2);
  box-shadow: var(--ks-track-recess);
  transition: background-color var(--ks-quick) var(--ks-ease);
}

.ks-switch-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--ks-paper-raised);
  box-shadow: var(--ks-cap-lift);
  transition: transform 220ms cubic-bezier(0.3, 0.7, 0.2, 1);
}

.ks-switch-knob::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: var(--ks-gray-2);
  box-shadow: inset 0 1px 1px oklch(13% 0 0 / 0.18);
  transition: background-color var(--ks-quick) var(--ks-ease), box-shadow var(--ks-quick) var(--ks-ease);
}

.ks-switch[aria-pressed="true"] .ks-switch-knob {
  transform: translateX(20px);
}

.ks-switch[aria-pressed="true"] .ks-switch-knob::after {
  background: var(--ks-patina);
  box-shadow: var(--ks-led);
}

.ks-switch:active .ks-switch-knob {
  box-shadow: var(--ks-cap-press);
}

.ks-switch:focus-visible {
  outline: none;
}

.ks-switch:focus-visible .ks-switch-track {
  outline: 2px solid var(--ks-kinpaku);
  outline-offset: 2px;
}

/* ============================================================
   Tag: the brand's label.

   The detector flags bad design with a small gold tag carrying dark mono
   text. That tag is the one device a visitor already associates with
   Impeccable, so it is also how the site labels things: section numerals,
   a card's state, a release's status. Small, mono, ink on gold. It is the
   only gold fill allowed on paper, and it never grows past a label.
   ============================================================ */
.ks-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 0 7px;
  color: var(--ks-ink);
  background: var(--ks-kinpaku);
  border-radius: var(--ks-radius-sm);
  font-family: var(--ks-mono);
  font-size: var(--ks-type-eyebrow-size);
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: normal;
  text-transform: uppercase;
  white-space: nowrap;
  vertical-align: middle;
}

/* A quiet tag for a secondary label sitting next to a gold one. */
.ks-tag.is-quiet {
  color: var(--ks-text-muted);
  background: var(--ks-gray);
}

/* Paper variant. A page control (a view switch, a tab row) sits on paper
   and keeps the gold dot, so it does not compete with the primary action
   the way a dark strip does. The dark strip is for product chrome: the
   live picker, lab toolbars, terminals. */

.ks-instrument-strip.is-paper {
  background: var(--ks-gray);
  border-color: transparent;
  box-shadow: var(--ks-track-recess);
}

.ks-instrument-strip.is-paper .ks-instrument-key {
  color: var(--ks-text-muted);
  transition: color var(--ks-quick) var(--ks-ease), background-color var(--ks-quick) var(--ks-ease), box-shadow var(--ks-quick) var(--ks-ease), transform var(--ks-quick) var(--ks-ease);
}

.ks-instrument-strip.is-paper .ks-instrument-key::before {
  background: var(--ks-gray-2);
  box-shadow: inset 0 1px 1px oklch(13% 0 0 / 0.18);
}

.ks-instrument-strip.is-paper .ks-instrument-key:hover,
.ks-instrument-strip.is-paper .ks-instrument-key:focus-visible {
  color: var(--ks-ink);
}

.ks-instrument-strip.is-paper .ks-instrument-key:active {
  box-shadow: var(--ks-cap-press);
  transform: translateY(1px);
}

/* The raised cap. Light from above: a white edge on top, a hard shadow
   underneath, so it stands a millimetre proud of the track. */
.ks-instrument-strip.is-paper .ks-instrument-key.is-active,
.ks-instrument-strip.is-paper .ks-instrument-key[aria-selected="true"],
.ks-instrument-strip.is-paper .ks-instrument-key[aria-pressed="true"] {
  color: var(--ks-ink);
  background: var(--ks-paper-raised);
  box-shadow: var(--ks-cap-lift);
}

.ks-instrument-strip.is-paper .ks-instrument-key.is-active::before,
.ks-instrument-strip.is-paper .ks-instrument-key[aria-selected="true"]::before,
.ks-instrument-strip.is-paper .ks-instrument-key[aria-pressed="true"]::before {
  background: var(--ks-patina);
  box-shadow: 0 0 0 1px oklch(13% 0 0 / 0.12), 0 0 4px color-mix(in oklch, var(--ks-patina) 60%, transparent);
}

.ks-instrument-strip.is-paper .ks-instrument-key:focus-visible {
  outline: 2px solid var(--ks-focus-ring);
  outline-offset: 1px;
}

/* ============================================================
   Instrument strip thumb (real element, positioned by
   instrument-strip.js). Last in the file on purpose: these override the
   key's own cap, and they must come after every key rule above.
   ============================================================ */
.ks-thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  width: 0;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-instrument-raised);
  box-shadow: inset 0 1px 0 var(--ks-instrument-edge), var(--ks-key-lift);
  transition: transform 360ms cubic-bezier(0.22, 1, 0.3, 1);
  pointer-events: none;
  z-index: 1;
}

.ks-instrument-strip.is-paper .ks-thumb {
  background: var(--ks-paper-raised);
  box-shadow: var(--ks-cap-lift);
}

.ks-instrument-strip.has-thumb .ks-instrument-key,
.ks-instrument-strip.has-thumb .ks-instrument-key.is-active,
.ks-instrument-strip.has-thumb .ks-instrument-key[aria-selected="true"],
.ks-instrument-strip.has-thumb .ks-instrument-key[aria-pressed="true"],
.ks-instrument-strip.is-paper.has-thumb .ks-instrument-key.is-active,
.ks-instrument-strip.is-paper.has-thumb .ks-instrument-key[aria-selected="true"],
.ks-instrument-strip.is-paper.has-thumb .ks-instrument-key[aria-pressed="true"] {
  background: transparent;
  box-shadow: none;
  transform: none;
  transition: color 120ms var(--ks-ease);
}

.ks-instrument-strip.has-thumb .ks-instrument-key::before {
  transition: background-color 120ms var(--ks-ease), box-shadow 120ms var(--ks-ease);
}

/* Dark instruments need the light state color for keyboard focus. */
.ks-instrument-strip:not(.is-paper),
.live-demo-gbar,
.live-demo-ctx,
.worlds-rating {
  --ks-focus-ring: var(--ks-patina);
}

/* Touch gets the kit's large target, without enlarging the desktop controls
   or their labels. Pointer capability also covers tablets with a keyboard. */
@media (any-pointer: coarse) {
  .ks-instrument-strip .ks-instrument-key,
  .ks-segmented button {
    min-height: var(--ks-control-lg);
    min-width: var(--ks-control-lg);
  }

  .site-header-menu {
    width: var(--ks-control-lg);
    height: var(--ks-control-lg);
  }

  .kinpaku-chrome .site-header-brand,
  .kinpaku-chrome .site-header-github {
    min-height: var(--ks-control-lg);
  }

  .kinpaku-chrome .site-header-nav a {
    min-height: var(--ks-control-lg);
    min-width: var(--ks-control-lg);
    padding-block: 10px;
  }
}
`,Pn=`/* VENDORED from impeccable-site/site/styles/docs-kinpaku.css (the command rail list: the site's selected-row pattern) (the source of truth).
   Do not edit here: change the site, then run node scripts/sync-kinpaku-kit.mjs. */
/* Group headings are ink and bold, so they read as headings over their
   links rather than as meta beside them; the links are muted and a step
   smaller, ink on hover and on the current page. */
.docs-kinpaku .skills-sidebar-category {
  display: block;
  font-family: var(--ks-font);
  font-size: 0.8125rem;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-transform: none;
  color: var(--ks-ink);
  margin-bottom: 6px;
  padding: 0 0 0 14px;
}

.docs-kinpaku .skills-sidebar-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.docs-kinpaku .skills-sidebar-list li {
  margin: 0;
}

.docs-kinpaku .skills-sidebar-list a {
  display: block;
  padding: 4px 0 4px 12px;
  border-left: 2px solid transparent;
  font-family: var(--ks-font);
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.5;
  color: var(--ks-text-muted);
  text-decoration: none;
  transition: color 160ms var(--ks-ease),
              border-color 160ms var(--ks-ease);
}

.docs-kinpaku .skills-sidebar-list a:hover {
  color: var(--ks-ink);
}

.docs-kinpaku .skills-sidebar-list a[aria-current="page"] {
  color: var(--ks-ink);
  font-weight: 600;
  border-left-color: var(--ks-gold-line);
}
`;var Rn=`/* Local review chrome. Keep the vendored site kit and inspected artwork independent. */
:root, :host {
  --review-media-paper: oklch(97.8% 0 0);
  --review-media-raised: oklch(99.5% 0 0);
  --review-media-deep: oklch(95% 0 0);
  --review-media-gray: oklch(92% 0 0);
  --review-media-gray-2: oklch(88% 0 0);
}

/* Embedded artwork keeps the review's original light presentation, including SVG and HTML. */
img, iframe { color-scheme: light; }

@media (prefers-color-scheme: dark) {
  :root, :host {
    color-scheme: dark;
    --ks-paper: oklch(22% 0 0);
    --ks-paper-raised: oklch(27% 0 0);
    --ks-paper-deep: oklch(18% 0 0);
    --ks-gray: oklch(31% 0 0);
    --ks-gray-2: oklch(36% 0 0);
    --ks-ink: oklch(93% 0 0);
    --ks-text: oklch(88% 0 0);
    --ks-text-muted: oklch(75% 0 0);
    --ks-text-faint: oklch(72% 0 0);
    --ks-text-mute-deep: oklch(60% 0 0);
    --ks-rule: oklch(93% 0 0 / 0.16);
    --ks-edge: oklch(93% 0 0 / 0.45);
    --ks-patina: oklch(76% 0.088 190);
    --ks-patina-deep: oklch(76% 0.088 190);
    --ks-patina-ink: oklch(82% 0.07 188);
    --ks-patina-pale: oklch(38% 0.045 190);
    --ks-vermilion: oklch(76% 0.12 35);
    --ks-link-on-paper-line: oklch(93% 0 0 / 0.35);
    --ks-lift: 0 2px 10px oklch(0% 0 0 / 0.3);
    --ks-lift-1: 0 2px 10px oklch(0% 0 0 / 0.3);
    --ks-lift-2: 0 8px 24px oklch(0% 0 0 / 0.4);
    --ks-cap-lift: inset 0 1px 0 oklch(100% 0 0 / 0.06), 0 1px 3px oklch(0% 0 0 / 0.3);
    --ks-cap-press: inset 0 1px 2px oklch(0% 0 0 / 0.4);
    --ks-track-recess: inset 0 1px 3px oklch(0% 0 0 / 0.4);
  }

  .ks-button.ks-button-primary:active {
    background: var(--ks-text-muted);
    border-color: var(--ks-text-muted);
  }
}
`;var Dn=(t)=>t.replace(/^:root\s*\{/gm,":root, :host {"),Mt=Dn(Tn)+`
`+Dn(Cn)+`
`+Pn+`
`+Rn,Fe='<span class="ks-button-arrow" aria-hidden="true"><svg viewBox="0 0 16 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M0 4h14M10 0l4 4-4 4"/></svg></span>';var Hn=`
.review-peers{display:grid;gap:8px;padding:8px 0 12px;font-size:12px}
.review-peers strong span{font-weight:400}.review-peers>div{display:flex;flex-wrap:wrap;gap:4px}
.review-peers button{min-width:28px;min-height:28px;padding:3px;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:inherit}
.review-peers button[aria-pressed="true"]{background:var(--teal);color:var(--ks-paper-raised)}
.review-peers label{display:flex;align-items:center;gap:6px}

:host{display:block;color:var(--ks-text);font:14px/1.45 var(--ks-font);--line:var(--ks-rule);--paper:var(--ks-paper-raised);--muted:var(--ks-text-muted);--teal:var(--ks-patina-deep);--warn:var(--ks-vermilion);--selection:var(--ks-patina)}
*{box-sizing:border-box}h1,h2,p,figure{margin:0}button,input,textarea{font:inherit}button{cursor:pointer;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:inherit;padding:8px 12px;min-height:36px}button:hover{border-color:var(--teal);color:var(--teal)}button:disabled{cursor:default;opacity:.45}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--teal);outline-offset:3px}button[aria-pressed=true]{box-shadow:inset 0 0 0 1px var(--teal)}input[type=checkbox]{accent-color:var(--teal);width:16px;height:16px;flex-shrink:0}textarea,input:not([type=checkbox]){width:100%;background:var(--paper);color:inherit;border:1px solid var(--ks-edge);border-radius:4px;padding:9px 10px}textarea{resize:vertical;min-height:80px}::selection{background:var(--ks-patina-pale)}a{color:var(--teal)}
.review{max-width:1600px;margin:auto;padding:24px 28px 0}header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:16px}h1{font:400 40px/1.05 var(--font-display,Arial,sans-serif);letter-spacing:-.02em}header p{margin-top:8px;font-size:15px}header p span,.medium{color:var(--muted)}.badge{border:1px solid var(--line);padding:5px 10px;font-size:12px;white-space:nowrap}.preview-note{color:var(--muted);font-size:12px;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:24px}
.connector{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible}.connector path{fill:none;stroke:var(--selection);stroke-width:2}.workbench{align-items:start;display:grid;grid-template-columns:minmax(0,1.18fr) minmax(0,1fr);gap:40px;position:relative}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;min-height:36px}.section-head h2{font-size:17px;font-weight:500;line-height:1.2}.section-head>span,.section-head h2>span:not(.number){font-size:12px;color:var(--muted)}.section-head button{font-size:12px}.number{display:inline-flex;align-items:center;justify-content:center;width:27px;height:27px;border:1px solid var(--teal);color:var(--teal);margin-right:7px;font:12px var(--font-mono,monospace)}
.map{position:relative;background:var(--review-media-deep);isolation:isolate}.comp{color-scheme:light;width:100%;height:100%;display:block;user-select:none}.map.marking{touch-action:none;cursor:crosshair}.map.marking .pin{pointer-events:none;opacity:.25}.pin{position:absolute;transform:translate(-50%,-50%);padding:0;min-height:25px;width:25px;height:25px;border-radius:50%;border:1px solid var(--ks-paper-raised);background:var(--ks-paper-raised);color:var(--ks-text);font:11px var(--font-mono,monospace);box-shadow:0 1px 4px oklch(13% 0 0 / .4);z-index:2}.pin.selected{background:var(--teal);color:var(--ks-paper-raised);border-color:var(--teal);box-shadow:none;outline:none;z-index:3}.pin:focus-visible{outline:2px solid var(--ks-paper-raised);outline-offset:3px}.region,.draw-box{position:absolute;pointer-events:none;outline:2px solid var(--selection);z-index:1}.draw-box{background:oklch(45% 0.10 190 / .2);z-index:4}.map-caption{font-size:12px;color:var(--muted);padding-top:12px;min-height:40px}.map-caption button{display:block;margin-top:10px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}.compare figure{min-width:0}.compare figcaption{height:24px;min-height:0;font-size:12px;margin-bottom:9px}.compare figcaption span{display:block;color:var(--muted);font-size:11px}.crop-stage{position:relative;overflow:hidden;background:var(--comp-background,var(--review-media-deep));min-width:0}.crop-image{position:absolute;max-width:none;height:auto}.asset{color-scheme:light;display:block;width:100%;height:100%;object-fit:contain}.crop-stage iframe{color-scheme:light;position:absolute;max-width:none;border:0;transform-origin:top left;pointer-events:none}.overlay-image{opacity:.5;pointer-events:none}.component-note{font-size:12px;line-height:1.5;color:var(--muted);margin:6px 0 0}.decisions{display:flex;gap:10px;padding:10px 0;background:var(--paper);position:sticky;bottom:0;z-index:6}.feedback-field{display:block;margin-top:16px;font-size:13px}.feedback-field>span{float:right;color:var(--muted);font-size:12px}.feedback-field textarea,.feedback-field input{display:block;margin-top:7px}.check{display:flex;align-items:center;gap:7px;font-size:12px;line-height:1.5;margin-top:12px}.coordinates{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.coordinates label{font-size:12px}.coordinates input{margin-top:5px}
.inventory-section{margin-top:28px;border-top:1px solid var(--line);padding-top:16px}.inventory-section .section-head{margin-bottom:10px}.inventory{display:flex;gap:8px;overflow-x:auto;padding:3px 3px 14px;scrollbar-color:var(--ks-gray-2) var(--ks-paper-deep);scrollbar-width:thin}.item{position:relative;flex:0 0 134px;display:grid;grid-template-columns:20px 1fr;column-gap:8px;row-gap:3px;padding:10px;text-align:left;background:transparent}.item strong{grid-column:2;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item.active{background:var(--paper);border-color:var(--teal)}.thumb-crop{position:relative;display:block;overflow:hidden}.item-thumb{display:flex;align-items:center;justify-content:center;grid-column:1/-1;position:relative;overflow:hidden;width:100%;height:76px;background:var(--comp-background,var(--review-media-deep));margin-bottom:7px}.item-thumb img{width:100%;height:100%;object-fit:contain}.item-thumb img[style]{height:auto}.inventory.all{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));overflow:visible}.item-number{grid-row:2/4;font:12px var(--font-mono,monospace);color:var(--muted);padding-top:2px}.state{grid-column:2;font-size:11px;color:var(--muted)}.state.approve{color:var(--teal)}.state.revise{color:var(--warn)}footer{display:flex;justify-content:space-between;gap:24px;padding:20px 0 24px;border-top:1px solid var(--line);margin-top:8px}.submit-area{display:flex;align-items:center;gap:20px}.submit-area p{font-size:12px;color:var(--muted);max-width:28ch}.inspector>p{margin:12px 0}
@media(min-width:1300px){.workbench{gap:56px}.review{padding-top:32px}.component-note{max-width:62ch}}
@media(max-width:800px){.connector{display:none}.review{padding:20px 16px 0}.workbench{grid-template-columns:1fr;gap:24px}.reference{max-width:640px;margin:auto;width:100%}.inspector{border-top:1px solid var(--line);padding-top:16px}.compare{max-width:640px}.inventory-section .section-head{align-items:flex-start;flex-direction:column;gap:4px}footer{flex-direction:column}.submit-area{justify-content:space-between}.badge{font-size:11px}.section-head{gap:8px}h1{font-size:34px}header{align-items:flex-start}.section-head h2{font-size:16px}}

.inspector{height:690px;overflow-y:auto;scrollbar-gutter:stable;scrollbar-width:thin;padding:0 5px 0 1px;overflow-anchor:none}
.material{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 12px;min-height:34px;margin-bottom:6px}.material strong{font-size:14px;font-weight:600}.material span{font:11px var(--font-mono,monospace);color:var(--muted)}
.compare-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}.compare-toolbar label{font-size:12px;display:flex;align-items:center;gap:8px}select{font:inherit;color:inherit;background:var(--paper);border:1px solid var(--ks-edge);border-radius:4px;padding:7px 9px;min-height:36px}select:focus-visible,.pan-viewport:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.pan-viewport{height:248px;overflow:auto;display:flex;background:var(--review-media-deep);scrollbar-width:thin;scrollbar-color:var(--ks-gray-2) var(--ks-paper-deep);overscroll-behavior:contain}.crop-stage{flex-shrink:0;margin:auto}.checker{background-color:var(--review-media-deep);background-image:conic-gradient(var(--review-media-gray-2) 25%,transparent 0 50%,var(--review-media-gray-2) 0 75%,transparent 0);background-size:16px 16px}
.view-controls{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px;min-height:36px}.view-controls label{font-size:11px;display:flex;gap:6px;align-items:center}.view-controls select{font-size:11px;min-height:32px;padding:5px}.view-controls>span{font-size:12px;color:var(--muted)}.scale-note{font-size:11px;color:var(--muted);margin:10px 0 0;min-height:18px}.scale-note a{white-space:nowrap}
.component-details{height:78px;overflow:auto;margin-top:12px;padding-right:4px;scrollbar-width:thin}.layering{font-size:12px;line-height:1.5}.component-details .component-note{margin-top:6px}
@media(max-width:800px){.inspector{height:720px}.pan-viewport{height:248px}.component-details{height:92px}.view-controls label{font-size:11px}.review header{align-items:flex-start}}

.round-summary{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 20px;padding:14px 0;margin-bottom:22px;border-block:1px solid var(--line)}.round-summary p{display:flex;flex-wrap:wrap;gap:5px 18px;font-size:13px}.round-summary p>span{color:var(--muted)}.round-summary details{flex-basis:100%;font-size:12px}.round-summary details p{font-size:12px;margin-top:8px;max-width:80ch}
.repair-context{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;margin:0 0 10px;font-size:12px}.previous-feedback{display:contents;overflow-wrap:anywhere}.previous-feedback h3{grid-column:1;grid-row:1;margin:0;font-size:11px;font-weight:500;color:var(--muted);align-self:center}.previous-feedback h3 span{font-weight:400;white-space:nowrap}.previous-feedback blockquote{grid-column:1/-1;grid-row:2;margin:0;white-space:pre-wrap;font-size:13px;line-height:1.45;max-height:5.8em;overflow:auto}.previous-feedback>p{grid-column:1/-1;margin:0;font-size:12px}.kept-approval{color:var(--teal);font-size:12px;align-self:center}
.changed-files{grid-column:2;grid-row:1;margin:0;color:var(--muted);font-size:11px}.changed-files summary{padding:2px 0;min-height:24px}.changed-files[open]{grid-column:1/-1;grid-row:auto}.changed-files[open] summary{font-weight:500}summary{cursor:pointer;padding:5px 0;min-height:30px}summary:focus-visible{outline:2px solid var(--teal);outline-offset:2px}.changed-files ul{padding-left:18px;margin:6px 0;overflow-wrap:anywhere;font:11px/1.6 var(--font-mono,monospace)}.description-diff{margin:6px 0 12px}.description-diff dt{font-weight:600;font-size:11px;margin-top:10px}.description-diff dd{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--color-text,var(--ks-text))}.previous-notice{font-size:12px;color:var(--muted);margin-top:8px}.inspector .previous-notice{display:none}
.decisions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px 10px;padding-top:12px}.decision-title{grid-column:1/-1}.decision-title strong{font-size:14px;font-weight:600;display:flex;justify-content:space-between;gap:12px}.decision-title strong span{font-size:11px;color:var(--muted);font-weight:400}.decision-title p{font-size:12px;font-weight:400;color:var(--muted);margin-top:4px}.decisions:not(:has(.quiet)){grid-template-columns:1fr 1fr}
.inspector{display:flex;flex-direction:column;overflow:hidden;padding:0}.inspection-content{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-gutter:stable;overscroll-behavior:contain;padding:0 5px 10px 1px}.review-form{flex-shrink:0;padding:12px 5px 0 1px;border-top:1px solid var(--line);background:var(--paper)}.review-form .decisions{position:static;padding:0 0 8px;background:transparent}.review-form .feedback{margin-top:8px}.review-form .feedback textarea{min-height:72px;max-height:120px}.review-form .check{margin:8px 0;font-size:11px}
.inspection-content:focus-visible{outline:2px solid var(--teal);outline-offset:-2px}
.inspector>.section-head{flex-shrink:0;padding:0 5px 0 1px}
.pin{display:flex;align-items:center;justify-content:center;gap:3px;font-size:12px;font-weight:600;width:30px;height:30px;min-height:30px}.pin svg,.map-legend svg,.item-number svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}.pin.pending,.pin.pending.selected{background:var(--ks-kinpaku);border-color:var(--ks-kinpaku);color:var(--ks-on-gold)}.pin.approved,.pin.approved.selected{width:38px;min-height:24px;height:24px;background:var(--ks-paper-raised);border-color:var(--ks-paper-raised);color:var(--ks-state-ink);border-radius:4px}.pin.approved:not(.selected){opacity:.55;box-shadow:none}.pin.approved:hover,.pin.approved:focus-visible{opacity:1}.pin.feedback,.pin.feedback.selected{width:38px;background:var(--ks-ink);border-color:var(--ks-paper-raised);color:var(--ks-paper-raised);border-radius:4px}.pin.selected{outline:none;border:3px solid var(--ks-paper-raised);box-shadow:none;z-index:3}.pin:focus-visible{outline:2px solid var(--ks-paper-raised);outline-offset:3px}
.map-legend{display:flex;flex-wrap:wrap;gap:9px 18px;margin-top:14px;font-size:11px;color:var(--muted)}.map-legend>span{display:flex;align-items:center;gap:6px}.map-legend i{display:inline-flex;align-items:center;justify-content:center;min-width:21px;height:21px;font-style:normal}.legend-pending{background:var(--ks-kinpaku);color:var(--ks-on-gold);border-radius:50%}.legend-feedback{background:var(--ks-ink);color:var(--ks-paper-raised);border-radius:3px}.legend-approved{background:var(--ks-paper-raised);color:var(--ks-state-ink);border-radius:3px}.map-caption{font-size:11px}
.inventory-section .section-head{flex-wrap:wrap}.item.pending{border-color:var(--ks-kinpaku-deep);background:var(--ks-paper-raised)}.item.feedback{border-color:var(--ks-ink);background:var(--ks-paper-raised)}.item.approved{background:var(--ks-paper);border-color:var(--ks-rule)}.item.approved .item-thumb{opacity:.65}.item.active{outline:2px solid var(--teal);outline-offset:0;box-shadow:none}.item-number{display:flex;align-items:center;gap:3px;grid-column:1/-1;grid-row:auto;min-height:20px;font-weight:600}.item strong{grid-column:1/-1;font-size:13px;white-space:normal;min-height:36px;line-height:1.35}.state{grid-column:1/-1;font-size:12px;font-weight:600;padding-top:6px;border-top:1px solid var(--ks-rule)}.state.pending{color:var(--ks-ink)}.state.feedback{color:var(--ks-ink)}.state.approved{color:var(--ks-state-ink)}.inventory-empty{padding:20px 0;font-size:13px;color:var(--muted)}
@media(max-width:800px){.inventory-section .section-head{gap:10px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
.item-medium{margin-left:auto;font-weight:400;display:flex;align-items:center;gap:4px;font-size:10px;color:var(--muted);min-height:16px}.item-medium .utility-icon{width:14px;height:14px;flex-shrink:0}.material>.utility-icon{width:18px;height:18px;align-self:center;color:var(--teal)}
.feedback-actions{display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap}.feedback-actions svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5}.feedback-hint,.shortcut-hint{font-size:12px;color:var(--muted)}.feedback-hint{margin-top:6px}.shortcut-hint{flex-basis:100%;text-align:right}.record-verdict{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 12px;font-size:13px}.record-verdict span{font-size:11px;color:var(--muted)}.review>.record-footer{font-size:12px;color:var(--muted);flex-wrap:wrap;gap:6px 16px}.saved-feedback{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.decision-notice{display:flex;align-items:center;gap:12px;font-size:12px;margin-bottom:10px}.decision-notice>span{flex:1;overflow-wrap:anywhere}.decision-notice button{color:var(--teal);flex-shrink:0}.review-summary{padding:4px 2px}.completion-mark{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:var(--ks-gray);color:var(--ks-patina-deep);float:left;margin:0 10px 8px 0}.completion-mark svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.6}.completion-link{display:inline-flex;align-items:center;gap:8px;color:var(--teal);border:0;background:transparent;padding:0;font-size:12px;text-align:left}.completion-link svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;flex-shrink:0}.review-summary h2{font-size:22px;line-height:32px}.review-summary p{clear:both;margin-top:8px;color:var(--muted)}.summary-decisions{margin-top:24px;display:grid}.summary-decisions button{display:grid;grid-template-columns:1fr auto;gap:6px 16px;text-align:left;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:12px 0;background:transparent}.summary-decisions strong{font-size:13px;font-weight:500}.summary-decisions span{font-size:12px;color:var(--teal)}.summary-decisions small{grid-column:1/-1;font-size:12px;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere}
`+Ln+`
.review-form:has(#feedback-form){max-height:75%;min-height:0;flex-shrink:1;display:flex;flex-direction:column;overflow:hidden;padding-top:8px}
#feedback-form{display:flex;flex-direction:column;flex:1;min-height:0}
/* Leave room inside the scrollport for the 2px focus ring and 3px offset. */
.feedback-fields{flex:1;min-height:0;overflow:auto;padding:6px}
.review-form:has(#feedback-form) .decision-notice{flex-shrink:0}
.review-form:has(#feedback-form) .decisions{display:none}
.feedback-actions{flex-shrink:0;position:static;background:var(--surface,var(--paper));padding:8px 0;margin-top:8px;box-shadow:0 -5px 8px -6px oklch(13% 0 0 / 0.22)}
.feedback-actions .shortcut-hint{flex-basis:auto;order:-1;margin-right:auto}
@media(max-height:800px),(max-width:800px){.feedback-actions .shortcut-hint{display:none}.review-form .feedback textarea{min-height:56px}.review-form:has(#feedback-form) .decision-notice{margin-bottom:4px}}

.comparison-panel{min-width:0;container-type:inline-size}.comparison-panel .expanded-title{display:none}.comparison-panel .compare-toolbar{justify-content:flex-start}.comparison-panel #expand-comparison{flex-shrink:0}.pan-viewport.pannable{cursor:move}.pan-viewport img{user-select:none;-webkit-user-drag:none}
#comparison-dialog{position:fixed;inset:16px;width:calc(100vw - 32px);height:calc(100dvh - 32px);max-width:none;max-height:none;margin:0;padding:24px;background:var(--paper);color:inherit;border:1px solid var(--line);border-radius:8px;box-shadow:0 20px 60px oklch(13% 0 0 / .25);overflow:hidden;transform-origin:top left}
#comparison-dialog[open]{display:flex;flex-direction:column;gap:12px}
#comparison-dialog>.review-form{width:100%;max-width:900px;align-self:center;max-height:55%;padding:12px 4px 0}
#comparison-dialog>.review-form .decision-title{display:none}
#comparison-dialog::backdrop{background:oklch(13% 0 0 / .6)}
#comparison-dialog .comparison-panel{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px}
#comparison-dialog .expanded-title{display:block;font-size:20px;line-height:1.3;margin:0;font-weight:500}
#comparison-dialog .compare-toolbar{flex-shrink:0;margin:0}
#comparison-dialog .compare{flex:1;min-height:0;max-width:none;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
#comparison-dialog .compare figure{display:flex;flex-direction:column;min-height:0}#comparison-dialog .pan-viewport{flex:1;min-height:0}#comparison-dialog .compare figcaption{flex-shrink:0}
#comparison-dialog .view-controls{flex-shrink:0;margin:0}
@media(max-width:600px){#comparison-dialog{inset:6px;width:calc(100vw - 12px);height:calc(100dvh - 12px);padding:14px}.comparison-panel .compare-toolbar{gap:6px}#comparison-dialog .compare{gap:8px}#comparison-dialog .compare figcaption{font-size:11px}}

.comparison-panel .compare-toolbar{gap:6px;padding:0;min-width:0;flex-wrap:wrap;margin-bottom:8px}
.comparison-actions{display:flex;align-items:center;gap:2px;margin-left:auto;flex-shrink:0}
.comparison-actions .source-link{color:var(--muted)}
.component-details .material{min-height:0;margin:12px 0 5px;gap:5px 8px}.component-details .material strong{font-size:11px;font-weight:500;color:var(--muted)}.component-details .material>.utility-icon{width:15px;height:15px}.component-details .material span{font-size:10px}
@container(max-width:460px){}
@media(forced-colors:active){}

/* A full-page checkpoint is one comparison, not a component inventory. */
.assembled-review>.workbench{grid-template-columns:minmax(0,1fr);gap:0}
.assembled-review .workbench>.inspector{display:flex}
.assembled-review .inspection-content{padding:16px 20px;scrollbar-gutter:auto}
.assembled-review .compare{max-width:none;gap:20px}
.assembled-review .pan-viewport{background:var(--canvas);border:1px solid var(--ks-rule);box-shadow:inset 0 2px 7px oklch(13% 0 0 / 0.07)}
.assembled-review .inspector>.review-form{padding:12px 20px;max-height:55%}
.assembled-review .decisions{display:flex;justify-content:flex-end;gap:10px}
.assembled-review .page-review-status{font-size:11px;color:var(--muted);text-align:right;line-height:1.4;overflow-wrap:anywhere}
.assembled-review .page-review-status:empty{display:none}
.assembled-review .review-form:has(#feedback-form){max-height:55%}
.assembled-review .feedback-field textarea{min-height:64px;max-height:120px}
.assembled-review .repair-context:empty{display:none}
@media(max-width:800px){
 .assembled-review>.workbench{display:flex;padding:10px}
 .assembled-review .inspection-content{padding:10px}
 .assembled-review .compare{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
 .assembled-review .inspector>.review-form{padding:10px}
 .assembled-review .page-review-status{text-align:left}
}

/* Grouped review is the default; instances are an explicit drill-down. */
.pin small{font:600 10px/1 var(--font-body, sans-serif);margin-left:3px}.pin:has(small){width:auto;min-width:32px;padding:0 7px}
.instance-region{opacity:.55;border-width:1px;pointer-events:none}
.group-overview>.compare,.group-overview>.view-controls{display:none}
.group-overview{position:relative}.group-overview>.review-peers{padding:0 44px 4px 0;min-height:36px}.group-overview>.compare-toolbar{position:absolute;right:0;top:0;justify-content:flex-end;margin:0}
.group-overview>.compare-toolbar>:not(.comparison-actions),.group-overview .source-link{display:none}
.group-overview .comparison-actions{margin-left:auto}
.review-peers{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.group-hint{font-size:12px;color:var(--muted)}
.instance-grid{display:grid;gap:0;flex:none;grid-auto-rows:max-content}
.instance-grid-labels{display:grid;grid-template-columns:1fr 1fr;gap:16px;color:var(--muted);font-size:12px;padding:8px 0}
.instance-row{display:block;height:auto;width:100%;text-align:left;padding:12px 0;border:0;border-top:1px solid var(--line);border-radius:0;background:transparent;color:inherit}
.instance-row:hover{background:var(--ks-paper-deep)}
.instance-caption{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:12px;margin-bottom:8px}
.instance-caption>span{color:var(--muted);font-size:11px}
.instance-pair{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:16px}
.instance-reference{justify-self:center;display:block;position:relative;overflow:hidden;max-height:180px;width:100%;background:var(--comp-background)}
.instance-reference img{position:absolute;max-width:none;height:auto}
.instance-produced{position:relative;justify-self:center;display:flex;align-items:center;justify-content:center;min-height:36px;max-height:180px;overflow:hidden;background:var(--review-media-paper)}
.instance-row:hover .instance-produced{background:var(--review-media-deep)}
.instance-produced img{display:block;width:100%;height:100%;object-fit:contain}
.instance-row.approved>:not(.instance-pair){opacity:.65}
/* Preserve approved artwork's original fade against paper, independent of the chrome. */
.instance-row.approved .instance-reference::after,.instance-row.approved .instance-produced::after{content:"";position:absolute;inset:0;z-index:3;background:var(--review-media-paper);opacity:.35;pointer-events:none}
.instance-row.feedback .instance-caption>span{color:var(--warn)}
.item strong small{font-size:11px;white-space:nowrap;color:var(--muted)}
#comparison-dialog .group-overview{overflow:auto;min-height:0}
#comparison-dialog .group-overview>.compare-toolbar{top:0}
#comparison-dialog .group-overview>.expanded-title{padding-right:44px}

.review-scope{font-size:12px;line-height:1.5;margin:8px 0 12px;color:var(--color-text,var(--ks-text));text-align:left;white-space:normal}
.review-scope p{margin:4px 0;overflow-wrap:anywhere}.review-scope strong{font-weight:600;margin-right:5px}
.review-scope .separate-reviews,.review-scope .scope-excluded{font-size:11px;color:var(--muted)}
.instance-row .review-scope{margin:12px 0 0}
#comparison-dialog .review-scope{flex:none}

.reference-layer{position:absolute;box-sizing:border-box;border:1px dashed var(--ks-paper-raised);outline:1px solid var(--ks-ink);pointer-events:none;z-index:2}.reference-layer>span{position:absolute;top:0;left:0;max-width:100%;padding:1px 4px;background:var(--ks-ink);color:var(--ks-paper-raised);font:10px/1.4 var(--font-sans,sans-serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .12s}.instance-row:hover .reference-layer>span,.instance-row:focus-visible .reference-layer>span,.pan-viewport:hover .reference-layer>span,.pan-viewport:focus .reference-layer>span{opacity:1}

/* Design-system pass (tokens.ts mirrors kinpaku-tokens.css). One paper plane, hairline rules
   instead of nested panels, ink for the primary action, patina for state, gold as a line. */
.review,.review>.workbench,.review>.inventory-section,.review>.round-summary,.review>.preview-note,.mobile-panes{--workspace:var(--ks-paper);--canvas:var(--ks-paper-deep);--dock:var(--ks-paper);--surface:var(--ks-paper);background:var(--ks-paper)}
.review{color:var(--ks-text)}
.review h1{font:300 34px/1.04 var(--ks-font-display);font-variation-settings:'wght' 300;color:var(--ks-ink);letter-spacing:0}
.review>header{background:var(--ks-paper);border-bottom:1px solid var(--ks-rule);box-shadow:none}
.review>header p,.review>header p span{color:var(--ks-text-muted)}
.review>.round-summary,.review>.preview-note,.mobile-panes{box-shadow:none;border-bottom:1px solid var(--ks-rule)}
.section-head h2,.inventory-section h2{font:400 var(--ks-type-eyebrow-size)/1.3 var(--ks-mono);letter-spacing:var(--ks-type-eyebrow-track);text-transform:uppercase;color:var(--ks-text-muted)}
.compare figcaption,.instance-grid-labels{font:400 var(--ks-type-eyebrow-size)/1.4 var(--ks-mono);letter-spacing:var(--ks-type-eyebrow-track);text-transform:uppercase;color:var(--ks-text-muted)}
.map-space{background:transparent;border:0;box-shadow:none;border-radius:0}
.map{box-shadow:0 0 0 1px var(--ks-rule)}
.workbench>.inspector{background:transparent;border-radius:0;box-shadow:none;border-left:1px solid var(--ks-rule)}
.inspector>.section-head{background:transparent;border-bottom:1px solid var(--ks-rule);box-shadow:none!important}
.inspection-content{background:transparent}
.inspector>.review-form{background:transparent;border-top:1px solid var(--ks-rule);box-shadow:none!important}
.pan-viewport{background:transparent}.crop-stage:not(.checker){background:var(--comp-background,var(--review-media-deep))}
.pan-viewport{border:0;box-shadow:none;border-radius:0}
.crop-stage{box-shadow:0 0 0 1px var(--ks-rule)}
.review>.inventory-section{box-shadow:none;border-top:1px solid var(--ks-rule)}
.inventory-section>.section-head{border-bottom:1px solid var(--ks-rule)}
.inventory .item,.inventory .item.active{background:var(--ks-paper-raised)}
.item.active{box-shadow:inset 0 -2px 0 var(--ks-kinpaku)}
.review>footer{background:var(--ks-paper-raised);border-top:1px solid var(--ks-rule);box-shadow:none}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline-color:var(--ks-focus-ring)}
textarea,input:not([type=checkbox]),select{border-color:var(--ks-edge);border-radius:var(--ks-radius-sm);background:var(--ks-paper-raised)}
input[type=checkbox]{accent-color:var(--ks-ink)}
.decisions{background:transparent}
.badge{border:0;border-radius:var(--ks-radius-sm);background:var(--ks-gray);color:var(--ks-text-muted);font:600 var(--ks-type-eyebrow-size)/1 var(--ks-mono);letter-spacing:.02em;text-transform:uppercase;padding:5px 7px}
#comparison-dialog{background:var(--ks-paper);border-color:var(--ks-rule);border-radius:var(--ks-radius-md);box-shadow:var(--ks-lift-2)}
/* The first-viewport review: two figures on the paper, a small toolbar, two buttons. */
.assembled-review>.workbench{padding:20px 28px 0}
.assembled-review .workbench>.inspector{border-left:0}
.assembled-review .inspection-content{padding:0}
.assembled-review .compare{gap:28px}
.assembled-review .pan-viewport{background:transparent;border:0;box-shadow:none}
.assembled-review .inspector>.review-form{padding:14px 0 18px;margin-top:8px}
.assembled-review .decisions{padding:0}
.assembled-review .page-review-status{color:var(--ks-text-muted);font-size:var(--ks-type-label-size)}
@media(max-width:800px){.assembled-review>.workbench{padding:12px 16px 0}.assembled-review .compare{gap:12px}}
`+Mt+`
/* Local fit for the vendored kit: sizes the legacy layout expects, the link-style text action,
   and the paper grain the site puts on its page ground (kit body::before, here on the review root). */
.review{position:relative;isolation:isolate}
.review::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:0.055;mix-blend-mode:multiply;background-image:var(--ks-grain);background-size:160px 160px}
.decisions>.ks-button{flex:1}
.assembled-review .decisions{display:flex;justify-content:flex-end;gap:12px}
.assembled-review .decisions>.ks-button{flex:0 0 auto;min-width:200px}
.assembled-review #approve{order:2}
.ks-button[disabled] .ks-button-arrow{color:currentColor}
.text-action{border:0;background:none;padding:0 2px;min-height:0;color:var(--ks-link-on-paper);font:inherit;font-size:var(--ks-type-label-size);text-decoration:underline;text-decoration-color:var(--ks-link-on-paper-line);text-underline-offset:3px;cursor:pointer}
.text-action:hover{text-decoration-color:var(--ks-link-on-paper-line-hover)}
.compare-toolbar{align-items:center;gap:16px}
.comparison-actions{display:flex;gap:8px;margin-left:auto}
.ks-icon-button{padding:0;min-height:0}
.ks-icon-button .utility-icon{width:16px;height:16px}
.mobile-panes{padding:8px 14px}
.ks-checkbox input{margin:0}
.review .ks-switch,.review .ks-switch[aria-pressed=true],.review .ks-instrument-key[aria-pressed=true]{box-shadow:none}
`;var li={chevronDown:'<path d="m6 9 6 6 6-6"/>',code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',compact:'<path d="M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',hideTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12 3 3 2 3-2"/>',showTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12-4 3-3 3 3"/>',next:'<path d="M5 12h14m-6-6 6 6-6 6"/>',mark:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5M8 12h8m-4-4v8"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',undo:'<path d="M4 10h9a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" transform="translate(0 -2)"/>',external:'<path d="M14 3h7v7m0-7L10 14m0-10H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',zoom:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'};function ye(t){return`<svg class="utility-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${li[t]}</svg>`}var Jt=[{kind:"plate",label:"Illustration / plate",hint:"Painted or drawn artwork"},{kind:"image",label:"Photo / image",hint:"A photograph"},{kind:"texture",label:"Texture",hint:"A surface or material"}];function zt(t){let e=t;return!!e&&e.schemaVersion===3&&e.stage==="components"}function Qt(t){return t.role==="plan"&&(!!t.flags?.length||!!t.codeDrawn)}function Zt(t){let e=(o)=>Qt(o)?0:o.role==="asset"?1:2;return t.components.map((o,r)=>({c:o,i:r})).sort((o,r)=>e(o.c)-e(r.c)||o.i-r.i).map((o)=>o.c)}function St(t){let e=new Set(t.components.map((o)=>o.id));return(t.codeRegions??[]).filter((o)=>!e.has(o.id))}function Me(t,e){let o=e.decisions[t.id];return o?.revision===t.revision?o:void 0}function $e(t,e){let o=Me(t,e);if(!o)return"pending";if(o.action==="approve")return"approved";return o.action==="revise"||o.action==="reclassify"?o.action:"pending"}function Lt(t,e){return t.reclassify?.find((o)=>o.id===e)}function en(t){let e=[t.name,t.note,...(t.flags??[]).map((o)=>o.message)].join(" ");if(/\b(textures?|surfaces?|grain|grainy|brushed|metal(lic)?|steel|brass|copper|paper|linen|canvas|fabric|cloth|wood(en)?|stone|marble|concrete|plaster|leather|noise|pattern(ed)?|weave|patina)\b/i.test(e))return"texture";if(/\b(photo|photos|photograph|photographs|photographic|photography)\b/i.test(e)&&!/\bphotographic shading\b/i.test(e))return"image";return"plate"}function qn(t){return`Drawn in code (${t.kind})`}function tn(t){return t.message}function Je(t,e){let o=t.components.map((T)=>$e(T,e)),r=o.filter((T)=>T==="approved").length,s=o.filter((T)=>T==="revise").length,l=new Set(St(t).map((T)=>T.id)),c=(e.reclassify??[]).filter((T)=>l.has(T.id)).length,u=o.filter((T)=>T==="reclassify").length+c,w=o.filter((T)=>T==="pending").length,L=e.missing.length,k=s+u+L>0,z=e.packetRevision===t.revision,x=e.missing.every((T)=>T.name.trim()&&Yt(T.box)),M=z&&!k&&w===0;return{total:o.length,approved:r,revise:s,reclassify:u,pending:w,missing:L,hasChanges:k,canApprove:M,mode:k?"changes":"approve",canSubmit:z&&x&&(k||M)}}function nn(t,e,o,r={}){if(r.split&&!(o==="revise"&&e.role==="asset"))throw Error("Only a generated asset can be split into layers");if(o==="revise"&&e.role!=="asset"&&!(r.feedback??"").trim())throw Error("Revising a plan item needs feedback");if(o==="reclassify"&&e.role!=="plan")throw Error("Only planned code can become an image");let s={revision:e.revision,action:o,feedback:o==="approve"?"":(r.feedback??"").trim(),split:!!r.split};if(o==="reclassify")s.kind=r.kind??en(e);return{...t,inventoryConfirmed:!1,decisions:{...t.decisions,[e.id]:s}}}function In(t,e){let o={...t.decisions};return delete o[e],{...t,inventoryConfirmed:!1,decisions:o}}function on(t,e,o){let r=(t.reclassify??[]).filter((s)=>s.id!==e);return{...t,inventoryConfirmed:!1,reclassify:o?[...r,{id:e,kind:o.kind,feedback:(o.feedback??"").trim()}]:r}}function Bn(t,e){let o=Je(t,e);if(!o.canSubmit)throw Error("Review is incomplete or stale");let r={};for(let c of t.components){let u=Me(c,e);if(u)r[c.id]=structuredClone(u)}let s=new Set(St(t).map((c)=>c.id)),l=(e.reclassify??[]).filter((c)=>s.has(c.id)).map((c)=>({...c}));return{schemaVersion:1,requestId:t.id,packetRevision:e.packetRevision,decisions:r,missing:structuredClone(e.missing),inventoryConfirmed:o.mode==="approve",...l.length?{reclassify:l}:{}}}function jn(t){return{packetRevision:t.revision,decisions:{},missing:[],inventoryConfirmed:!1,reclassify:[]}}function Nn(t,e,o,r,s=0.02){let l=Math.max(0,Math.floor((r.x-s)*e)),c=Math.min(e-1,Math.ceil((r.x+r.w+s)*e)),u=Math.max(0,Math.floor((r.y-s)*o)),w=Math.min(o-1,Math.ceil((r.y+r.h+s)*o)),L=Math.floor(r.x*e),k=Math.ceil((r.x+r.w)*e),z=Math.floor(r.y*o),x=Math.ceil((r.y+r.h)*o),M=[],T=Math.max(1,Math.round(Math.max(c-l,w-u)/80));for(let C=u;C<=w;C+=T)for(let H=l;H<=c;H+=T){if(H>=L&&H<k&&C>=z&&C<x)continue;let V=(C*e+H)*4;if(t[V+3]<200)continue;M.push([t[V],t[V+1],t[V+2]])}return M}function On(t){if(!t.length)return;let e=(o)=>{let r=t.map((s)=>s[o]).sort((s,l)=>s-l);return r[r.length>>1]};return"#"+[0,1,2].map((o)=>e(o).toString(16).padStart(2,"0")).join("")}function rn(t,e,o,r,s,l=4,c=24){let u=t.w*e,w=t.h*o,L=Math.min(24,Math.max(8,0.04*Math.max(u,w))),k=Math.min(e,u+L*2),z=Math.min(o,w+L*2),x=Math.min(l,r/k,s/z);if(w*x<c&&w>0)x=Math.min(l,c/w,s/z),k=Math.min(k,r/x);let M=(t.x+t.w/2)*e,T=(t.y+t.h/2)*o,C=Math.max(0,Math.min(e-k,M-k/2)),H=Math.max(0,Math.min(o-z,T-z/2));return{scale:x,width:k*x,height:z*x,view:{x:C/e,y:H/o,w:k/e,h:z/o}}}var pi=["no","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"],Et=(t)=>pi[t]??String(t),An=(t)=>t[0].toUpperCase()+t.slice(1);function Fn(t,e,o){let r=t.components.filter((l)=>$e(l,e)==="pending").length;if(o&&t.round>1){let l=t.components.filter((u)=>["changed","added"].includes(o.changes[u.id]?.kind??"")||o.feedback?.[u.id]).length,c=t.components.filter((u)=>$e(u,e)==="approved").length;return`The agent worked on your notes for ${Et(l)} ${l===1?"item":"items"}. ${An(Et(c))} ${c===1?"approval is":"approvals are"} kept.`}let s=Math.max(1,Math.round(r*15/60));return`${An(Et(r))} ${r===1?"thing":"things"} to check before any page code is written. About ${Et(s)} ${s===1?"minute":"minutes"}.`}var Un="Frame, view and moving parts as separate pieces, e.g. the shutters.";function an(t){return t.role==="asset"?t.flags??[]:[]}var sn=(t)=>an(t).some((e)=>e.id==="baked-composite"),ln=(t)=>t?.action==="revise"&&t.split===!0;function Tt(t,e){if(!e)return null;let o=e.feedback?.[t]?void 0:Object.entries(e.feedback??{}).filter(([u,w])=>w.decision.action==="revise"&&w.decision.split&&t.startsWith(`${u}-`)).sort((u,w)=>w[0].length-u[0].length)[0];if(o){let[u,w]=o;return{round:w.round,action:"split",words:(w.decision.feedback??"").trim(),splitFrom:e.packet.components.find((L)=>L.id===u)?.name??u,beforeUrl:void 0,wasCode:!1,wasKind:void 0,wasNote:""}}let r=e.feedback?.[t],s=e.packet.components.find((u)=>u.id===t),l=e.packet.codeRegions?.find((u)=>u.id===t),c=e.changes[t]?.kind;if(!r&&c!=="changed")return null;return{round:r?.round??e.packet.round,action:r?.decision.action,words:(r?.decision.feedback??"").trim(),beforeUrl:s?.role==="asset"?s.preview.url:void 0,wasCode:s?.role==="plan"||!s&&!!l,wasKind:s?.kind??l?.kind,wasNote:s?.note??l?.note??"",splitFrom:void 0}}function Kn(t,e,o,r,s,l=4,c){let u=t.length,w=Math.max(0,Math.min(o-s,(e-r*(u-1))/t.reduce((x,M)=>x+M,0))),L=Math.max(0,Math.min(e,(o-u*s-r*(u-1))/t.reduce((x,M)=>x+1/M,0)));if(c)w=Math.min(w,c.h*l),L=Math.min(L,c.w*l);let k=t.reduce((x,M)=>x+M*w*w,0),z=t.reduce((x,M)=>x+L*L/M,0);return k>=z?{direction:"row",sizes:t.map((x)=>({w:x*w,h:w}))}:{direction:"column",sizes:t.map((x)=>({w:L,h:L/x}))}}function Wn(t,e,o,r,s,l){return{x:s-t*o*l,y:s-e*r*l}}function Vn(t,e,o){return Zt(t).map((r)=>({id:r.id,name:r.name,state:$e(r,e),current:r.id===o}))}function Gn(t,e){let o=Je(t,e);if(o.mode==="approve")return"Approve plan and assets";let r=t.components.filter((c)=>ln(Me(c,e))).length,s=o.revise-r;return`Send notes (${[s?`${s} ${s===1?"note":"notes"}`:"",r?`${r} to split`:"",o.reclassify?`${o.reclassify} to become ${o.reclassify===1?"an image":"images"}`:"",o.missing?`${o.missing} missing`:""].filter(Boolean).join(", ")})`}function dt(t){if(typeof t!=="number"||!Number.isSafeInteger(t)||t<=0)throw TypeError("Invalid component review dimension");return t}function Qe(t){if(typeof t.round!=="number"||!Number.isSafeInteger(t.round)||t.round<1)throw TypeError("Invalid component review round");dt(t.comp.width),dt(t.comp.height)}function Yn(t){let e=(t||"center").trim().split(/\s+/);return e.length>0&&e.length<=2&&e.every((r)=>{if(/^(left|center|right|top|bottom)$/i.test(r))return!0;return/^\d+(?:\.\d+)?%$/.test(r)&&Number.parseFloat(r)<=100})?e.join(" "):"center"}var Xn=Mt+`
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
.bar-locator{display:none;justify-self:end;position:relative;width:52px;height:34px;padding:0;border:0;overflow:hidden;background:var(--review-media-deep);box-shadow:0 0 0 1px var(--ks-rule)}

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
.swatch.asset{color-scheme:light;border:2px solid var(--asset)}.swatch.plan{border:1.5px dashed var(--plan)}
.intro-copy .ks-button{margin-top:14px}
.intro-comp{min-height:0;height:100%;display:flex;align-items:center;justify-content:center}

/* The comp with regions (intro, summary, overlay). */
.map{position:relative;overflow:hidden;background:var(--review-media-deep);box-shadow:0 0 0 1px var(--ks-rule)}
.map .comp{color-scheme:light;display:block;width:100%;height:100%;user-select:none;pointer-events:none}
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
.frame{position:relative;overflow:hidden;background:var(--review-media-deep);box-shadow:0 0 0 1px var(--ks-rule)}
.pic{position:absolute;inset:0;display:block;overflow:hidden}
.pic.crop img{position:absolute;max-width:none;height:auto;user-select:none}
.pic.gen img{display:block;width:100%;height:100%;object-fit:contain;user-select:none}
.frame .flip{visibility:hidden}
.frame.flipped .flip{visibility:visible}
.frame.flipped .gen:not(.before){visibility:hidden}
.focus-box{position:absolute;outline:2px solid var(--ks-paper-raised);box-shadow:0 0 0 1.5px var(--ks-ink),0 0 0 100vmax oklch(13% 0 0 / .35);pointer-events:none}
.figures.looking .frame{cursor:none}
.lens{position:absolute;top:0;left:0;width:156px;height:156px;border-radius:50%;overflow:hidden;pointer-events:none;opacity:0;z-index:3;background:var(--review-media-deep);box-shadow:0 0 0 2px var(--ks-paper-raised),0 0 0 3px oklch(13% 0 0 / .35),var(--ks-lift-2);transition:opacity var(--ks-quick) var(--ks-ease)}
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
.undo-line{color:var(--ks-text-muted);animation:toast-in 240ms var(--ks-ease)}.undo-line .text-action{margin-left:6px}.undo-line .text-action .cap{margin-left:6px}.hint{font-size:var(--ks-type-label-size);color:var(--ks-text-faint);transition:opacity 400ms var(--ks-ease)}
.hint .cap{margin:0 2px;height:18px}
.hint.gone,.undo-line.gone{opacity:0;pointer-events:none}
.locator{position:absolute;left:28px;bottom:14px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:0;border:0;background:none;color:var(--ks-text-muted)}
.locator-map{position:relative;display:block;width:128px;overflow:hidden;background:var(--review-media-paper);box-shadow:0 0 0 1px var(--ks-rule);transition:box-shadow var(--ks-quick) var(--ks-ease)}
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



.view-summary 

/* Summary. */
.summary{width:100%;max-width:1240px;margin:0 auto;padding:36px 48px 0;display:flex;flex-direction:column;gap:36px}
.summary-head{display:flex;flex-direction:column;gap:10px}
.summary h1{font:300 clamp(2.4rem,4vw,3.4rem)/1.02 var(--ks-font-display);font-variation-settings:'wght' 300;color:var(--ks-ink)}
.sheet{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:28px 24px}
.card{display:flex;flex-direction:column;gap:10px;padding:0;border:0;background:none;text-align:left;color:inherit;min-width:0}
.card-thumb .focus-box{box-shadow:0 0 0 1px var(--ks-ink),0 0 0 100vmax oklch(13% 0 0 / .3);outline-width:1.5px}
.card-thumb{height:118px;display:flex;align-items:center;justify-content:center;background:var(--review-media-deep);box-shadow:0 0 0 1px var(--ks-rule);overflow:hidden;transition:box-shadow var(--ks-quick) var(--ks-ease)}
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
.panel-crop{position:relative;width:100%;max-height:180px;overflow:hidden;box-shadow:0 0 0 1px var(--ks-rule);background:var(--review-media-deep)}
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
 
 .summary{padding:24px 16px 0}
 .send-inner{padding:12px 16px;flex-wrap:wrap}
 .send-row p{text-align:left}
}
@media (prefers-reduced-motion:reduce){*,*::before{animation:none!important;transition:none!important}}
`;var _n=new Map;function Ct(t){let e=t.querySelector('.ks-instrument-key:is(.is-active, [aria-selected="true"], [aria-pressed="true"])');if(!e){if(t.classList.contains("has-thumb"))t.classList.remove("has-thumb");return}let o=t.getBoundingClientRect(),r=e.getBoundingClientRect();if(!o.width)return;let s=getComputedStyle(t),l=o.width/parseFloat(s.width)||1,c=parseFloat(s.borderLeftWidth)||0,u=Math.round(((r.left-o.left)/l-c+t.scrollLeft)*100)/100,w=Math.round(r.width/l*100)/100,L=t.querySelector(":scope > .ks-thumb"),k=t.dataset.ksStrip;if(!L){L=document.createElement("span"),L.className="ks-thumb",L.setAttribute("aria-hidden","true"),t.appendChild(L);let x=k?_n.get(k):void 0;if(x&&(x.x!==u||x.w!==w))L.style.transition="none",L.style.width=`${x.w}px`,L.style.transform=`translateX(${x.x}px)`,L.offsetWidth,L.style.transition=""}if(k)_n.set(k,{x:u,w});if(L.style.width!==`${w}px`)L.style.width=`${w}px`;let z=`translateX(${u}px)`;if(L.style.transform!==z)L.style.transform=z;if(!t.classList.contains("has-thumb"))t.classList.add("has-thumb")}function di(t,e,o){if(t.dataset.thumb)return;t.dataset.thumb="1",Ct(t);let r=new MutationObserver((x)=>{if(x.some((M)=>M.target!==t&&!M.target.classList?.contains("ks-thumb")))Ct(t)});r.observe(t,{subtree:!0,attributes:!0,attributeFilter:["class","aria-selected","aria-pressed"],childList:!0});let s=new ResizeObserver(()=>Ct(t));s.observe(t);let l=null,c=!1,u=0,w=null,L=(x,M)=>e.elementFromPoint(x,M)?.closest(".ks-instrument-key")??null;t.addEventListener("pointerdown",(x)=>{if(!["mouse","pen"].includes(x.pointerType)||!x.isPrimary||x.button!==0||l!==null)return;l=x.pointerId,c=!1,u=x.clientX,w=L(x.clientX,x.clientY)}),t.addEventListener("pointermove",(x)=>{if(x.pointerId!==l)return;if(!c&&Math.abs(x.clientX-u)<6)return;c=!0;let M=L(x.clientX,x.clientY);if(M&&M!==w&&t.contains(M))w=M,M.click()});let k=()=>{l=null,c=!1,w=null},z=(x)=>{if(x.pointerId===l)k()};window.addEventListener("pointerup",z),window.addEventListener("pointercancel",z),window.addEventListener("blur",k),o.push(()=>{r.disconnect(),s.disconnect(),window.removeEventListener("pointerup",z),window.removeEventListener("pointercancel",z),window.removeEventListener("blur",k)})}function Pt(t){let e=[];return t.querySelectorAll(".ks-instrument-strip").forEach((o)=>di(o,t,e)),document.fonts?.ready.then(()=>t.querySelectorAll(".ks-instrument-strip").forEach(Ct)),()=>e.forEach((o)=>o())}var D=(t)=>String(t??"").replace(/[&<>"']/g,(e)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e]),Rt=(t)=>`${(Number.isFinite(t)?Math.min(1,Math.max(0,t)):0)*100}%`,Ue=(t)=>{let e=new URL(t,location.href);if(!["http:","https:"].includes(e.protocol))throw Error("Unsupported preview URL");return D(e.href)},Ze=(t)=>`left:${Rt(t.x)};top:${Rt(t.y)};width:${Rt(t.w)};height:${Rt(t.h)}`,et=(t)=>D(t),Jn=(t)=>`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${t}</svg>`,Dt={check:Jn('<path d="m3 8.5 3 3 7-7"/>'),alert:Jn('<path d="M8 2 1.5 13.5h13L8 2Z"/><path d="M8 6.5v3.2M8 11.6v.1"/>')},Ee=(t)=>`<kbd class="cap">${t}</kbd>`,Ae={plate:"illustration",image:"photo",texture:"texture"};function ci(t){let e=t.match(/^review is stale:\s*(.+?)\s+changed\b/i);if(e)return`${e[1]} changed after this round was prepared.`;let o=t.replace(/;?\s*prepare a new round\.?\s*$/i,"").trim();return o?`${o[0].toUpperCase()}${o.slice(1)}${/[.!?]$/.test(o)?"":"."}`:""}var Qn={get(t){try{return localStorage.getItem(t)}catch{return null}},set(t,e){try{localStorage.setItem(t,e)}catch{}}};function Zn(t,e,o){Qe(e);let r=dt(e.comp.width),s=dt(e.comp.height);if(o.history)Qe(o.history.packet);let l=t.shadowRoot??t.attachShadow({mode:"open"}),c={...jn(e),...structuredClone(o.initialDraft??{})};c.reclassify??=[];let u=Zt(e),w=St(e),L=o.history??null,k=new URLSearchParams(location.search),z=!!o.completed,x=z?"summary":["intro","stage","summary"].includes(k.get("view")??"")?k.get("view"):"intro",M=(k.get("item")&&u.some((i)=>i.id===k.get("item"))?k.get("item"):void 0)??u.find((i)=>$e(i,c)==="pending")?.id??u[0]?.id,T=null,C=null,H=null,V=!1,Z=!1,N=!1,Se={},ce=!1,xe=!1,X="",_=null,J=()=>_?`<p class="hint undo-line" role="status">${D(_.label)} <button type="button" class="text-action" id="undo">Undo${Ee("⌘Z")}</button></p>`:"",Ke=Qn.get("impeccable.review.flipHint")==="1",se=null,Pe=null,ie=new Map,ve=new Map,Re=null,tt=()=>matchMedia("(prefers-reduced-motion: reduce)").matches,W=(i)=>e.components.find((a)=>a.id===i),le=(i)=>w.find((a)=>a.id===i),O=()=>z||ce||!!o.status,Ie=(i)=>i.w*r/(i.h*s),me=new Image;me.onload=()=>{try{let i=Math.min(1,480/me.naturalWidth),a=document.createElement("canvas");a.width=Math.max(1,Math.round(me.naturalWidth*i)),a.height=Math.max(1,Math.round(me.naturalHeight*i));let p=a.getContext("2d",{willReadFrequently:!0});if(p.drawImage(me,0,0,a.width,a.height),Re={data:p.getImageData(0,0,a.width,a.height).data,width:a.width,height:a.height},x==="stage")S()}catch{}},me.src=new URL(e.comp.url,location.href).href;function We(i){if(!ve.has(i.id)&&Re)ve.set(i.id,On(Nn(Re.data,Re.width,Re.height,i.box))??"");return ve.get(i.id)||e.comp.background||"var(--review-media-deep)"}function nt(i,a){if(i.material?.alpha==="transparent")return!0;if(i.material?.alpha==="opaque")return!1;if(ie.has(a))return ie.get(a);if(ie.set(a,!1),!/\.(png|webp)(\?|$)/i.test(a))return!1;let p=new Image;return p.onload=()=>{try{let g=Math.min(1,160/Math.max(p.naturalWidth,p.naturalHeight)),f=document.createElement("canvas");f.width=Math.max(1,Math.round(p.naturalWidth*g)),f.height=Math.max(1,Math.round(p.naturalHeight*g));let m=f.getContext("2d",{willReadFrequently:!0});m.drawImage(p,0,0,f.width,f.height);let h=m.getImageData(0,0,f.width,f.height).data;for(let y=3;y<h.length;y+=4)if(h[y]<250){if(ie.set(a,!0),x==="stage")S();break}}catch{}},p.src=new URL(a,location.href).href,!1}function re(i,a,p="fade"){if(a)M=a;if(T=tt()?null:p,x=i,C=null,N=!1,Z=!1,i!=="summary")H=null,V=!1;S();let g=i==="intro"?"start":i==="stage"?"decide-yes":"send";l.getElementById(g)?.focus({preventScroll:!0})}function it(i){if(x!=="stage"||!u.length)return;let a=u.findIndex((p)=>p.id===M)+i;if(a>=u.length)return re("summary",void 0,"next");if(a<0)return;re("stage",u[a].id,i>0?"next":"prev")}function De(i,a){if(_)clearTimeout(_.timer);_={label:i,before:a,view:x,current:M,timer:window.setTimeout(()=>{_=null,l.querySelector(".undo-line")?.classList.add("gone")},6000)}}function Be(i,a){let p=c;c=i,C=null,X="",De(a,p)}function ot(){let i=u.findIndex((p)=>p.id===M),a=[...u.slice(i+1),...u.slice(0,i+1)].find((p)=>$e(p,c)==="pending");if(a)re("stage",a.id,"next");else re("summary",void 0,"next")}function Ve(){let i=W(M);if(x!=="stage"||!i||O()||C)return;Be(nn(c,i,"approve"),`${i.role==="asset"?"Approved":"Kept in code"}: ${i.name}.`),ot()}function He(i,a,p=!1){if(O())return;let g=a?le(a):void 0,f=g?void 0:W(M),m=f??g;if(!m||f&&i==="reclassify"&&f.role!=="plan")return;let h=f?Me(f,c):void 0,y=g?Lt(c,g.id):void 0,R=h?.action===i&&!!h.split===p;C={type:i,split:p,id:m.id,region:!!g,text:R?h.feedback:p?Un:y?.feedback??"",kind:h?.kind??y?.kind??en({name:m.name,note:m.note??"",flags:f?.flags})},S(),l.getElementById("form-text")?.focus()}function rt(){if(!C||O())return;let i=C;if(i.region){let p=le(i.id);Be(on(c,p.id,{kind:i.kind,feedback:i.text}),`${p.name} will become ${Ae[i.kind]}.`),S();return}let a=W(i.id);if(i.type==="revise"&&a.role==="plan"&&!i.text.trim()){l.getElementById("form-text")?.focus();return}Be(nn(c,a,i.type,{feedback:i.text,kind:i.kind,split:i.split}),i.split?`Split into layers: ${a.name}.`:i.type==="revise"?`Noted: ${a.name}.`:`${a.name} will become ${Ae[i.kind]}.`),ot()}function q(){if(!_||O())return;let i=_;clearTimeout(i.timer),_=null,c=i.before,re(i.view,i.current,"prev")}async function A(){let i=Je(e,c);if(ce||z||C||!i.canSubmit||o.status)return;ce=!0,X="",S();try{await o.onSubmit(Bn(e,c)),z=!0,xe=!0,V=!1,_=null}catch(a){X=a instanceof Error?a.message:"The review could not be saved."}finally{ce=!1,S()}}function I(i){let a=`missing-${crypto.randomUUID()}`;c={...c,inventoryConfirmed:!1,missing:[...c.missing,{id:a,name:"",feedback:"",box:i}]},V=!1,H={type:"missing",id:a},S(),l.getElementById("missing-name")?.focus()}let j=(i)=>{let a=$e(i,c);if(a==="approved")return i.role==="asset"?"Looks good":"Code is fine";if(a==="revise")return ln(Me(i,c))?"Split into layers":"Needs work";if(a==="reclassify")return`Becomes ${Ae[Me(i,c).kind]}`;return z?"Not decided":"To decide"},F=(i,a="")=>`<span class="pic crop ${a}"><img src="${Ue(e.comp.url)}" alt="" draggable="false" style="width:${100/i.w}%;left:${-100*i.x/i.w}%;top:${-100*i.y/i.h}%"></span>`,G=(i,a,p="gen")=>{let g=nt(i,a),f=Se[i.id]??"comp",m=!g?"":f==="light"?"var(--review-media-raised)":f==="dark"?"var(--ks-instrument)":We(i);return`<span class="pic ${p}" style="${m?`background:${D(m)}`:""}"><img src="${Ue(a)}" alt="" draggable="false"></span>`};function ke(i){return[...i.code?w.map((p)=>({kind:"region",id:p.id,name:p.name,box:p.box,cls:`code ${Lt(c,p.id)?"reclassify":""}`})):[],...e.components.map((p)=>({kind:"item",id:p.id,name:p.name,box:p.box,cls:`is-${p.role} ${Qt(p)||sn(p)?"flagged":""} ${$e(p,c)}`})),...c.missing.map((p)=>({kind:"missing",id:p.id,name:p.name||"Missing",box:p.box,cls:"missing"}))].sort((p,g)=>g.box.w*g.box.h-p.box.w*p.box.h).map((p)=>{let g=H?.id===p.id||Z&&x==="stage"&&p.id===M,f=`<span class="tag">${D(p.name)}</span>`;return i.interactive?`<button type="button" class="region ${p.cls} ${g?"selected":""} ${p.box.y<0.06?"tag-below":""} ${p.box.x>0.7?"tag-right":""}" style="${Ze(p.box)}" data-${p.kind}="${D(p.id)}" aria-label="${D(p.name)}">${f}</button>`:`<span class="region ${p.cls}" style="${Ze(p.box)}"></span>`}).join("")}function ee(){let i=Vn(e,c,x==="stage"?M:void 0),a=i.filter((p)=>p.state!=="pending").length;return`<header class="bar">
      <div class="bar-title"><span class="bar-name">${D(e.title)}</span><span class="bar-round">Round ${et(e.round)}</span></div>
      ${u.length?`<nav class="lights ${i.length>20?"dense":""}" aria-label="Progress, ${a} of ${i.length} decided">${i.map((p,g)=>`<button type="button" class="light ${p.state==="pending"?"":"decided"} ${p.current?"current":""}" data-go="${D(p.id)}" aria-label="${D(`${g+1}. ${p.name}: ${j(W(p.id))}`)}" ${p.current?'aria-current="step"':""}><span class="tip">${D(p.name)}${p.state==="pending"?"":`<span class="tip-state"> · ${D(j(W(p.id)))}</span>`}</span></button>`).join("")}<button type="button" class="lights-summary ${x==="summary"?"current":""}" id="to-summary">Summary</button></nav>`:""}
      ${x==="stage"?`<button type="button" class="bar-locator" id="open-map-bar" aria-label="Open the comp">${F({x:0,y:0,w:1,h:1})}</button>`:""}
    </header>`}function at(){if(o.status)return`<div class="banner stale" role="alert">${Dt.alert}<div><strong>This review is out of date.</strong><p>${D(ci(o.status))} Ask the agent to prepare a new round, then reload this page.</p></div><button id="reload" class="ks-button ks-button-secondary">Reload</button></div>`;if(X)return`<div class="banner error" role="alert">${Dt.alert}<div><strong>Your decisions were not sent.</strong><p>${D(X)}</p></div><button id="retry" class="ks-button ks-button-secondary">Try again</button></div>`;return""}function Ht(){let i=!!L&&e.round>1;return`<div class="intro ${T?`enter-${T}`:""}">
      <div class="intro-copy">
        <p class="eyebrow">${i?`Round ${et(e.round)}`:"Before any page code"}</p>
        <h1>${i?"Check what changed.":"Review the plan and assets."}</h1>
        <p class="lead">${D(Fn(e,c,L))}</p>
        <dl class="kinds-explained">
          <div><dt><i class="swatch asset"></i>A generated image</dt><dd>Does it match the comp?</dd></div>
          <div><dt><i class="swatch plan"></i>A region drawn in code</dt><dd>Can code do it justice, or should it be an image?</dd></div>
        </dl>
        <button type="button" class="ks-button ks-button-primary" id="start">Start${Ee("↵")}${Fe}</button>
      </div>
      <figure class="intro-comp"><div class="map" style="aspect-ratio:${r}/${s}"><img class="comp" src="${Ue(e.comp.url)}" alt="The approved comp" draggable="false">${ke({code:!1,interactive:!1})}</div></figure>
    </div>`}function At(i){let a=Tt(i.id,L),p=Ie(i.box),g=`${i.box.w*r}x${i.box.h*s}`;if(i.role==="asset"&&i.preview.url){let f=i.preview.url,m=nt(i,f),h=Se[i.id]??"comp",y=m?`<button type="button" class="ks-switch backdrop-switch" id="backdrop" aria-pressed="${h!=="comp"}" title="Backdrop behind the transparent image"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">${h==="comp"?"On comp colour":h==="light"?"On light":"On dark"}</span></button>`:"",R=`<figure class="fig" data-role="generated"><figcaption><span class="eyebrow">${N?"In the comp":a?.beforeUrl?"After":"Generated"}</span>${y}</figcaption><div class="frame ${N?"flipped":""}">${G(i,f)}${F(i.box,"flip")}</div></figure>`,b=`<figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${F(i.box)}</div></figure>`;if(a?.beforeUrl){let B=`<figure class="fig"><figcaption><span class="eyebrow">Before · round ${et(a.round)}</span></figcaption><div class="frame">${G(i,a.beforeUrl,"gen before")}</div></figure>`;return`<div class="figures" data-ratios="${p},${p},${p}" data-natural="${g}">${B}${R}${b}</div>`}return`<div class="figures" data-ratios="${p},${p}" data-natural="${g}">${b}${R}</div>`}if(i.role==="asset")return'<div class="figures empty"><p>This image has no generated file.</p></div>';return`<div class="figures single" data-box="${D(JSON.stringify(i.box))}"><figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${F(i.box)}<span class="focus-box"></span></div></figure></div>`}function qt(i){if(z)return`<div class="decide-bar"><p class="record">${D(j(i))}${Me(i,c)?.feedback?`: “${D(Me(i,c).feedback)}”`:"."}</p></div>`;if(C&&!C.region){let g=C.type==="reclassify",f=!g&&i.role==="plan",m=!!C.split;return`<form class="decide-bar form" id="decision-form">
        ${g?`<div class="form-row"><span class="eyebrow" id="kinds-label">Make it</span><div class="ks-instrument-strip is-paper" data-ks-strip="kind" role="group" aria-labelledby="kinds-label">${Jt.map((h)=>`<button type="button" class="ks-instrument-key" data-kind="${h.kind}" aria-pressed="${C.kind===h.kind}">${h.label}</button>`).join("")}</div></div>`:""}
        <label class="field"><span class="eyebrow">${g?"Anything the image should keep? Optional":m?"How should it come apart? Edit or keep":f?"What should change?":"What needs to change? Optional"}</span><textarea id="form-text" rows="2" placeholder="${g?"For example: keep the brushed direction horizontal.":f?"For example: extend the hero photo under the nav.":"For example: the figure should face the sea."}">${D(C.text)}</textarea></label>
        <div class="form-actions"><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel${Ee("Esc")}</button><button type="submit" class="ks-button ks-button-primary">${g?"Make it an image":m?"Split into layers":"Save note"}${Ee("⌘↵")}</button></div>
      </form>`}let a=Me(i,c),p=i.role==="asset";return`<div class="decide-bar">
      ${a?`<p class="current-decision">${a.action==="approve"?Dt.check:""}<span>${D(j(i))}${a.feedback?`: “${D(a.feedback)}”`:"."}</span><button type="button" class="text-action" id="decision-clear">Clear</button></p>`:""}
      <div class="decisions">
        <button type="button" id="decide-yes" class="ks-button ks-button-primary">${p?"Looks good":"Code is fine"}${Ee("A")}</button>
        <button type="button" id="decide-no" class="ks-button ks-button-secondary">${p?"Needs work":"Make it an image"}${Ee("N")}</button>
        ${p?`<button type="button" id="decide-split" class="ks-button ${sn(i)?"ks-button-secondary":"ks-button-ghost"}">Split into layers${Ee("S")}</button>`:`<button type="button" id="decide-other" class="ks-button ks-button-ghost">Something else…${Ee("F")}</button>`}
      </div>
    </div>`}function ct(){let i=W(M);if(!i)return'<div class="stage"><p>Nothing to review.</p></div>';let a=u.findIndex((h)=>h.id===i.id)+1,p=Tt(i.id,L),g=i.role==="plan"?[...(i.flags??[]).map(tn),...i.codeDrawn?["The plan draws this artwork in code."]:[]]:an(i).map(tn),f=(i.note??"").trim(),m=i.role==="plan"?`<p class="sentence"><strong>Will be drawn in code:</strong> ${D(f||qn(i).toLowerCase())}</p>`:p?.wasCode?`<p class="sentence"><s>Was going to be drawn in code: ${D(p.wasNote)}</s> Now a generated ${D(Ae[i.kind]??i.kind)}.</p>`:f?`<p class="sentence muted">${D(f)}</p>`:"";return`<div class="stage ${i.role==="plan"?"is-single":""} ${T?`enter-${T}`:""}">
      <div class="stage-head">
        <p class="eyebrow">${i.role==="asset"?`Generated ${D(Ae[i.kind]??i.kind)}`:`Drawn in code · ${D(i.kind)}`} · ${a} of ${u.length}</p>
        <h1>${D(i.name)}</h1>
        ${p?.splitFrom?`<blockquote class="asked"><span class="eyebrow">A layer of ${D(p.splitFrom)} · you asked to split it in round ${et(p.round)}</span>${p.words?`<p>“${D(p.words)}”</p>`:""}</blockquote>`:p?.words?`<blockquote class="asked"><span class="eyebrow">You asked in round ${et(p.round)}</span><p>“${D(p.words)}”</p></blockquote>`:""}
      </div>
      ${At(i)}
      <div class="stage-foot">
        ${m}
        ${g.map((h)=>`<p class="flag">${D(h)}</p>`).join("")}
        ${_?J():i.role==="asset"&&!Ke&&!z?`<p class="hint">Hold ${Ee("Space")} to flip to the comp. Hover to magnify both.</p>`:""}
      </div>
      <button type="button" class="locator" id="open-map" aria-label="Open the comp"><span class="locator-map" style="aspect-ratio:${r}/${s}"><img src="${Ue(e.comp.url)}" alt="" draggable="false"><span class="locator-box" style="${Ze(i.box)}"></span></span><span class="locator-label">Comp ${Ee("C")}</span></button>
    </div>
    ${qt(i)}`}function mt(){if(H?.type==="missing"){let i=c.missing.find((a)=>a.id===H.id);if(!i)return"";return`<div class="side-panel"><p class="eyebrow missing">Missing from the review</p>
        <label class="field"><span class="eyebrow">Name</span><input id="missing-name" value="${D(i.name)}" placeholder="For example: harbour boat" ${O()?"disabled":""}></label>
        <label class="field"><span class="eyebrow">What is missing? Optional</span><textarea id="missing-feedback" rows="2" ${O()?"disabled":""}>${D(i.feedback)}</textarea></label>
        <div class="form-actions start"><button type="button" id="panel-done" class="ks-button ks-button-secondary">Done</button>${O()?"":'<button type="button" id="missing-remove" class="ks-button ks-button-ghost">Remove</button>'}</div></div>`}if(H?.type==="region"){let i=le(H.id);if(!i)return"";let a=Lt(c,i.id),p=C?.region&&C.id===i.id;return`<div class="side-panel"><p class="eyebrow">Set in code · ${D(i.kind)}</p><h3>${D(i.name)}</h3>
        <div class="panel-crop" style="aspect-ratio:${Math.max(0.5,Math.min(6,Ie(i.box)))}">${F(i.box)}</div>
        ${p?`<form id="decision-form" class="panel-form"><div class="ks-instrument-strip is-paper" data-ks-strip="region-kind" role="group" aria-label="Make it">${Jt.map((g)=>`<button type="button" class="ks-instrument-key" data-kind="${g.kind}" aria-pressed="${C.kind===g.kind}">${Ae[g.kind][0].toUpperCase()+Ae[g.kind].slice(1)}</button>`).join("")}</div><textarea id="form-text" rows="2" placeholder="Anything the image should keep? Optional">${D(C.text)}</textarea><div class="form-actions start"><button type="submit" class="ks-button ks-button-primary">Make it an image</button><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel</button></div></form>`:a?`<p class="current-decision"><span>Becomes ${D(Ae[a.kind])}${a.feedback?`: “${D(a.feedback)}”`:"."}</span>${O()?"":'<button type="button" class="text-action" id="region-keep">Keep in code</button>'}</p>`:`<p class="muted">Checked in the first-viewport review, once the page is built.</p><div class="form-actions start">${O()?"":'<button type="button" class="ks-button ks-button-secondary" id="region-image">Make it an image</button>'}<button type="button" id="panel-done" class="ks-button ks-button-ghost">Close</button></div>`}
      </div>`}return`<div class="side-panel quiet"><p>Every outlined region above was on your list. Hover the comp to see what is set in code; click a region to make it an image.</p>${O()?"":`<button type="button" class="ks-button ks-button-secondary" id="mark" aria-pressed="${V}">${V?"Cancel marking":"Mark missing"}</button>`}${V?'<p class="marking-hint">Drag on the comp around what is missing.</p>':""}${c.missing.length?`<ul class="missing-list">${c.missing.map((i)=>`<li><button type="button" class="text-action" data-missing="${D(i.id)}">${D(i.name||"Unnamed missing piece")}</button></li>`).join("")}</ul>`:""}</div>`}function It(){let i=Je(e,c),a=o.status?"This round can no longer be sent.":i.pending&&!i.hasChanges?`${i.pending} still to decide.`:i.mode==="approve"?"Approval confirms nothing is missing from the comp.":`${i.pending?`${i.pending} undecided stay open. `:""}The agent applies your notes and opens a new round.`,p=(g)=>{let f=Me(g,c),m=$e(g,c),h;if(g.role==="asset"&&g.preview.url){let y=Ie(g.box);h=`<span class="card-pic" style="aspect-ratio:${y};width:min(100%, ${Math.round(118*y)}px)">${G(g,g.preview.url)}</span>`}else{let y=rn(g.box,r,s,220,118),R=y.view;h=`<span class="card-pic" style="width:${Math.floor(y.width)}px;height:${Math.floor(y.height)}px"><span class="pic crop"><img src="${Ue(e.comp.url)}" alt="" draggable="false" style="width:${100/R.w}%;left:${-100*R.x/R.w}%;top:${-100*R.y/R.h}%"></span><span class="focus-box" style="${Ze({x:(g.box.x-R.x)/R.w,y:(g.box.y-R.y)/R.h,w:g.box.w/R.w,h:g.box.h/R.h})}"></span></span>`}return`<button type="button" class="card ${m}" data-go="${D(g.id)}"><span class="card-thumb">${h}</span><span class="card-text"><span class="card-name">${D(g.name)}</span><span class="card-state">${m==="approved"?Dt.check:""}${D(j(g))}</span>${f?.feedback?`<span class="card-note">“${D(f.feedback)}”</span>`:""}</span></button>`};return`<div class="summary ${T?`enter-${T}`:""}">
      <div class="summary-head">
        <p class="eyebrow">${z?`Round ${et(e.round)} · sent`:"Summary"}</p>
        <h1>${z?i.hasChanges?"Notes sent.":"Plan and assets approved.":i.pending?"Almost there.":"Your decisions."}</h1>
        ${z?`<p class="lead">${i.hasChanges?"The agent applies them and opens a new round for anything that changed.":"The agent continues to the first viewport."}${xe?"":" This round is read-only."}</p>`:""}
      </div>
      <div class="sheet">${u.map(p).join("")}</div>
      <section class="coverage" aria-label="Coverage">
        <h2>Anything on the comp we didn't cover?</h2>
        <div class="coverage-grid">
          <div class="map-space"><div class="map ${V?"marking":""} ${H?"has-selection":""}" id="summary-map" style="aspect-ratio:${r}/${s}"><img class="comp" src="${Ue(e.comp.url)}" alt="The approved comp" draggable="false">${ke({code:!0,interactive:!0})}<div class="draw-box" hidden></div></div></div>
          ${mt()}
        </div>
      </section>
    </div>
    ${z?"":`<div class="send-row"><div class="send-inner">${_?J():`<p>${D(a)}</p>`}<button type="button" class="ks-button ks-button-primary" id="send" ${!i.canSubmit||!!C||ce||!!o.status?"disabled":""}>${ce?"Sending…":D(Gn(e,c))}${ce?"":Fe}</button></div></div>`}`}function Bt(){if(!Z)return"";return`<div class="overlay" role="dialog" aria-modal="true" aria-label="The comp"><div class="overlay-head"><span class="eyebrow">The comp · click a region to go to it</span><button type="button" class="ks-button ks-button-ghost" id="close-map">Close${Ee("Esc")}</button></div>
      <div class="overlay-body"><div class="map has-selection" id="overlay-map" style="aspect-ratio:${r}/${s}"><img class="comp" src="${Ue(e.comp.url)}" alt="The approved comp" draggable="false">${ke({code:!0,interactive:!0})}</div></div></div>`}function S(){se?.disconnect(),Pe?.();let a=l.activeElement?.id,p=x==="summary"?l.querySelector(".view-summary .screen")?.scrollTop??0:0;l.innerHTML=`<style>${Xn}</style><section class="rv view-${x} ${z?"is-submitted":""}" aria-label="Plan and asset review">
      ${ee()}${at()}
      <main class="screen">${x==="intro"?Ht():x==="stage"?ct():It()}</main>
      ${Bt()}
    </section>`,T=null;let g=l.querySelector(".screen");if(g&&p)g.scrollTop=p;if(a)l.getElementById(a)?.focus({preventScroll:!0});if(gt(),Y(),se=new ResizeObserver(Y),se.observe(l.querySelector(".screen")),Pe=Pt(l),!z)o.onDraftChange?.(structuredClone(c))}function Y(){let i=matchMedia("(max-width: 760px)").matches,a=l.querySelector(".figures[data-ratios]");if(a&&a.clientWidth){let g=a.dataset.ratios.split(",").map(Number),[f,m]=(a.dataset.natural??"0x0").split("x").map(Number),h=i?{direction:"column",sizes:g.map((y)=>({w:Math.min(a.clientWidth,360*y),h:Math.min(a.clientWidth,360*y)/y}))}:Kn(g,a.clientWidth,a.clientHeight,28,30,4,{w:f,h:m});a.dataset.direction=h.direction,a.querySelectorAll(":scope > .fig > .frame").forEach((y,R)=>{y.style.width=`${Math.floor(h.sizes[R].w)}px`,y.style.height=`${Math.floor(h.sizes[R].h)}px`}),pe(a)}let p=l.querySelector(".figures.single");if(p?.clientWidth){let g=JSON.parse(p.dataset.box),f=p.closest(".stage"),m=f.clientHeight-36-28-(f.querySelector(".stage-head")?.offsetHeight??0)-(f.querySelector(".stage-foot")?.offsetHeight??0)-30-80,h=rn(g,r,s,Math.min(p.clientWidth,1120),i?320:Math.max(80,m)),y=p.querySelector(".frame"),R=y.querySelector("img"),b=y.querySelector(".focus-box"),B=h.view;y.style.width=`${Math.floor(h.width)}px`,y.style.height=`${Math.floor(h.height)}px`,R.style.cssText=`width:${100/B.w}%;left:${-100*B.x/B.w}%;top:${-100*B.y/B.h}%`,b.style.cssText=Ze({x:(g.x-B.x)/B.w,y:(g.y-B.y)/B.h,w:g.w/B.w,h:g.h/B.h}),pe(p)}for(let g of l.querySelectorAll(".overlay-body .map, .intro-comp .map")){let f=g.parentElement,m=getComputedStyle(f),h=f.clientWidth-parseFloat(m.paddingLeft)-parseFloat(m.paddingRight),y=f.clientHeight-parseFloat(m.paddingTop)-parseFloat(m.paddingBottom);if(!h||!y)continue;let R=Math.min(h/r,y/s);g.style.width=`${r*R}px`,g.style.height=`${s*R}px`}}let Q=78,oe=3;function pe(i){i.querySelectorAll(".frame").forEach((a)=>{a.querySelector(".lens")?.remove();let p=document.createElement("span");p.className="lens",p.setAttribute("aria-hidden","true");let g=document.createElement("span");g.className="lens-inner",g.style.width=`${a.clientWidth}px`,g.style.height=`${a.clientHeight}px`,a.querySelectorAll(":scope > .pic, :scope > .focus-box").forEach((f)=>g.append(f.cloneNode(!0))),p.append(g),a.append(p)})}function ut(i,a){l.querySelectorAll(".figures .frame").forEach((p)=>{let g=p.querySelector(".lens"),f=g?.querySelector(".lens-inner");if(!g||!f)return;let{clientWidth:m,clientHeight:h}=p;g.style.transform=`translate(${i*m-Q}px, ${a*h-Q}px)`;let y=Wn(i,a,m,h,Q,oe);f.style.transform=`translate(${y.x}px, ${y.y}px) scale(${oe})`})}function gt(){let i=(m,h)=>l.getElementById(m)?.addEventListener("click",h);i("start",()=>{let m=u.find((h)=>$e(h,c)==="pending")??u[0];if(m)re("stage",m.id,"next");else re("summary")}),l.querySelectorAll("[data-go]").forEach((m)=>m.addEventListener("click",()=>{let h=m.dataset.go,y=u.findIndex((R)=>R.id===M);re("stage",h,x!=="stage"?"fade":u.findIndex((R)=>R.id===h)>=y?"next":"prev")})),i("to-summary",()=>re("summary",void 0,"next")),i("decide-yes",Ve),i("decide-no",()=>He(W(M)?.role==="asset"?"revise":"reclassify")),i("decide-other",()=>He("revise")),i("decide-split",()=>He("revise",void 0,!0)),i("decision-clear",()=>{let m=W(M);if(m&&!O())Be(In(c,m.id),`Cleared: ${m.name}.`),S()}),i("form-cancel",()=>{C=null,S()}),l.getElementById("decision-form")?.addEventListener("submit",(m)=>{m.preventDefault(),rt()}),l.getElementById("form-text")?.addEventListener("input",(m)=>{if(C)C.text=m.target.value}),l.querySelectorAll("[data-kind]").forEach((m)=>m.addEventListener("click",()=>{if(!C)return;C.kind=m.dataset.kind,l.querySelectorAll("[data-kind]").forEach((h)=>h.setAttribute("aria-pressed",String(h===m)))})),i("backdrop",()=>{let m=W(M);if(!m)return;let h=["comp","light","dark"];Se[m.id]=h[(h.indexOf(Se[m.id]??"comp")+1)%3],S()}),i("undo",q),i("send",()=>void A()),i("retry",()=>void A()),i("reload",()=>location.reload());let a=()=>{Z=!0,S(),l.getElementById("close-map")?.focus()};if(i("open-map",a),i("open-map-bar",a),i("close-map",()=>{Z=!1,S()}),i("mark",()=>{if(O())return;V=!V,H=null,C=null,S()}),i("panel-done",()=>{H=null,C=null,S()}),i("region-image",()=>{if(H?.type==="region")He("reclassify",H.id)}),i("region-keep",()=>{let m=H?.type==="region"?le(H.id):void 0;if(m&&!O())Be(on(c,m.id,null),`${m.name} stays in code.`),S()}),i("missing-remove",()=>{if(H?.type!=="missing")return;let m=H.id;c={...c,missing:c.missing.filter((h)=>h.id!==m)},H=null,S()}),l.getElementById("missing-name")?.addEventListener("input",(m)=>{let h=c.missing.find((y)=>y.id===H?.id);if(h){h.name=m.target.value;let y=l.getElementById("send");if(y)y.disabled=!Je(e,c).canSubmit||ce||!!o.status;o.onDraftChange?.(structuredClone(c))}}),l.getElementById("missing-feedback")?.addEventListener("input",(m)=>{let h=c.missing.find((y)=>y.id===H?.id);if(h)h.feedback=m.target.value,o.onDraftChange?.(structuredClone(c))}),O())l.querySelectorAll("#decide-yes,#decide-no,#decide-other,#decide-split,#decision-clear,#mark,#region-image").forEach((m)=>m.disabled=!0);l.querySelectorAll(".map [data-item]").forEach((m)=>m.addEventListener("click",()=>{if(!V)re("stage",m.dataset.item,"fade")}));let p=(m)=>{if(V)return;if(H=m,C=null,x!=="summary")x="summary",Z=!1,T=tt()?null:"fade";S(),l.querySelector(".coverage")?.scrollIntoView({block:"start"})};l.querySelectorAll("[data-region]").forEach((m)=>m.addEventListener("click",()=>p({type:"region",id:m.dataset.region}))),l.querySelectorAll("[data-missing]").forEach((m)=>m.addEventListener("click",()=>p({type:"missing",id:m.dataset.missing})));let g=l.querySelector(".figures");g?.querySelectorAll(":scope > .fig > .frame").forEach((m)=>{m.addEventListener("pointerenter",(h)=>{if(h.pointerType==="mouse")g.classList.add("looking")}),m.addEventListener("pointerleave",()=>g.classList.remove("looking")),m.addEventListener("pointermove",(h)=>{let y=m.getBoundingClientRect();ut((h.clientX-y.left)/y.width,(h.clientY-y.top)/y.height)})});let f=l.getElementById("summary-map");if(f){let m=(R)=>{let b=f.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(R.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(R.clientY-b.top)/b.height))}},h=null,y=null;f.addEventListener("pointerdown",(R)=>{if(!V)return;h=m(R),y=null,f.setPointerCapture(R.pointerId),R.preventDefault()}),f.addEventListener("pointermove",(R)=>{if(!h)return;let b=m(R);y={x:Math.min(h.x,b.x),y:Math.min(h.y,b.y),w:Math.abs(b.x-h.x),h:Math.abs(b.y-h.y)};let B=l.querySelector(".draw-box");B.hidden=!1,B.style.cssText=Ze(y)}),f.addEventListener("pointerup",()=>{if(y&&y.w>0.01&&y.h>0.01)I(y);h=null,y=null}),f.addEventListener("pointercancel",()=>{h=null,y=null,S()})}}function je(i){if(N===i)return;N=i,l.querySelectorAll('[data-role="generated"] .frame').forEach((p)=>p.classList.toggle("flipped",i));let a=l.querySelector('[data-role="generated"] figcaption .eyebrow');if(a)a.textContent=i?"In the comp":Tt(M??"",L)?.beforeUrl?"After":"Generated";if(i&&!Ke)Ke=!0,Qn.set("impeccable.review.flipHint","1"),l.querySelector(".hint")?.classList.add("gone")}let ue=(i)=>{let a=i;if(!t.isConnected||a.defaultPrevented)return;let p=a.composedPath()[0],g=p instanceof HTMLTextAreaElement||p instanceof HTMLInputElement;if(a.key==="Escape"){if(Z)a.preventDefault(),Z=!1,S();else if(C)a.preventDefault(),C=null,S();else if(V)a.preventDefault(),V=!1,S();else if(H)a.preventDefault(),H=null,S();return}if(a.key==="Enter"&&(a.metaKey||a.ctrlKey)&&C){a.preventDefault(),rt();return}if(g||a.altKey||a.isComposing)return;if((a.metaKey||a.ctrlKey)&&a.key.toLowerCase()==="z"){if(_)a.preventDefault(),q();return}if(a.metaKey||a.ctrlKey)return;if(x==="intro"&&a.key==="Enter"&&p?.tagName!=="BUTTON"){a.preventDefault(),l.getElementById("start")?.click();return}if(Z||C)return;let f=a.key.toLowerCase();if(a.key===" "&&x==="stage"&&W(M)?.role==="asset"&&p?.tagName!=="BUTTON"&&p?.tagName!=="A"){if(a.preventDefault(),!a.repeat)je(!0);return}if(a.key===" "&&x==="stage"&&W(M)?.role==="asset"){if(a.preventDefault(),!a.repeat)je(!0);return}if(f==="c"&&x!=="intro"){a.preventDefault(),Z=!0,S();return}if(x!=="stage"||O()){if(x==="summary"&&(f==="k"||a.key==="ArrowLeft")&&u.length&&!O())a.preventDefault(),re("stage",u[u.length-1].id,"prev");return}if(f==="a")a.preventDefault(),Ve();else if(f==="n")a.preventDefault(),l.getElementById("decide-no")?.click();else if(f==="f"&&W(M)?.role==="plan")a.preventDefault(),He("revise");else if(f==="s"&&W(M)?.role==="asset")a.preventDefault(),He("revise",void 0,!0);else if(f==="j"||a.key==="ArrowRight")a.preventDefault(),it(1);else if(f==="k"||a.key==="ArrowLeft")a.preventDefault(),it(-1)},Ne=(i)=>{if(i.key===" "&&N)i.preventDefault(),je(!1)},Le=()=>je(!1);return document.addEventListener("keydown",ue),document.addEventListener("keyup",Ne),window.addEventListener("blur",Le),S(),{destroy(){se?.disconnect(),Pe?.(),document.removeEventListener("keydown",ue),document.removeEventListener("keyup",Ne),window.removeEventListener("blur",Le),l.replaceChildren()},getDraft(){return structuredClone(c)}}}var v=(t)=>String(t??"").replace(/[&<>"']/g,(e)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e]),qe=(t)=>`${(Number.isFinite(t)?Math.min(1,Math.max(0,t)):0)*100}%`,ze=(t)=>{let e=new URL(t,location.href);if(!["http:","https:"].includes(e.protocol))throw Error("Unsupported preview URL");return v(e.href)};function ei(t,e,o){if(zt(e))return Zn(t,e,{...o,history:o.history,initialDraft:o.initialDraft,onDraftChange:o.onDraftChange,onSubmit:o.onSubmit});if(Qe(e),o.history)Qe(o.history.packet);let r=t.attachShadow({mode:"open"}),s=structuredClone(o.initialDraft??$n(e)),l=e.stage==="hero"&&e.components.length===1&&!s.missing.length,c=()=>[...e.components].sort((A,I)=>fe(A,s,o.history).priority-fe(I,s,o.history).priority),u=c().find((A)=>fe(A,s,o.history).kind!=="approved")?.id??e.components[0]?.id,w=_e(e,s).pending?"pending":"reviewed",L=!1,k=!1,z=o.completed??!1,x="",M={},T=!!o.completed||!_e(e,s).pending,C=null,H=!0,V=/Mac|iPhone|iPad/.test(navigator.platform)?"⌘Enter":"Ctrl+Enter",Z=!1,N=!1,Se=!1,ce=null,xe=!1,X=!0,_=!1,J="comp",Ke=J,se="fit",Pe="checker",ie=!1,ve="isolated",Re,tt="fit",W=null,le=null,O=null,Ie=null,me='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>',We='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11 1 2 2-1 7-7-3-3-7 7v2Z"/></svg>',nt=(A,I)=>{if(A.stage==="hero")return"";let j=$t(A,I);if(!j.related.length)return"";let F=j.related.map((G)=>v(G.name)).join(" · ");return`<div class="review-scope" aria-label="Review scope"><p><strong>Reviewing</strong> ${v(j.description||I.name)}</p><p class="separate-reviews"><strong>Outlined · reviewed separately</strong> ${F}</p>${j.excluded.length?`<p class="scope-excluded">Hidden in this preview: ${j.excluded.map((G)=>v(G.name)).join(" · ")}</p>`:""}</div>`},re=(A)=>`left:${qe(A.x)};top:${qe(A.y)};width:${qe(A.w)};height:${qe(A.h)}`,it=(A,I)=>A.stage==="hero"?"":$t(A,I).related.map((j)=>{let F=I.box,G=j.box,ke=Math.max(F.x,G.x),ee=Math.max(F.y,G.y),at={x:(ke-F.x)/F.w,y:(ee-F.y)/F.h,w:Math.max(0,Math.min(F.x+F.w,G.x+G.w)-ke)/F.w,h:Math.max(0,Math.min(F.y+F.h,G.y+G.h)-ee)/F.h};return`<span class="reference-layer" style="${re(at)}" title="Reviewed separately: ${v(j.name)}" aria-label="Reviewed separately: ${v(j.name)}"><span>${v(j.name)}</span></span>`}).join("");function De(A){r.getElementById(A)?.focus({preventScroll:!0})}function Be(A){let I=zn(e,s,A);if(T=!I,I)u=I;J="component",ie=!1,Z=!1,se="fit",ve="isolated",H=!0,w=T?"reviewed":"pending";let j=()=>{q(),De(T?"review-summary":M[u]?"feedback":"approve")};if(T&&N&&ce)ce(j);else j()}async function ot(){if(k||z||ie||Object.keys(M).length)return;k=!0,x="",q();try{await o.onSubmit(En(e,s)),z=!0,T=!0,L=!1,w="reviewed"}catch(A){x=A instanceof Error?A.message:"Could not save. Try again."}finally{k=!1,q()}}function Ve(A){if(k||z||ie||Se)return;let I=e.components.find((ee)=>ee.id===u);if(!I||!pt(e,s,I,H,Object.keys(M)).length)return;let j=s.decisions[I.id],F=j?.revision===I.revision?j:void 0,G=pt(e,s,I,H,Object.keys(M));C={id:I.id,name:G.length>1?`${I.reviewGroup} · ${G.length} instances`:I.name,action:A,previous:Object.fromEntries(G.map((ee)=>[ee.id,s.decisions[ee.id]?{...s.decisions[ee.id]}:void 0]))};let ke=M[I.id]??F;for(let ee of G)s.decisions[ee.id]={revision:ee.revision,action:A,feedback:A==="revise"?ke?.feedback??"":"",split:A==="revise"&&(ke?.split??!1)};if(delete M[I.id],_)X=!0,_=!1;if(l)s.inventoryConfirmed=A==="approve",C=null,ot();else Be(I.id)}function He(){if(k||z||ie||Se)return;let A=e.components.find((F)=>F.id===u);if(!A||!pt(e,s,A,H,Object.keys(M)).length)return;let I=s.decisions[A.id],j=I?.revision===A.revision?I:void 0;if(M[A.id]??={feedback:j?.feedback??"",split:j?.split??!1},X&&(r.querySelector(".workbench")?.clientHeight??0)<420)_=!0,X=!1;T=!1,q(),De("feedback")}function rt(A){let I=`missing-${crypto.randomUUID()}`;s.missing.push({id:I,name:"Missing component",feedback:"",box:A}),s.inventoryConfirmed=!1,T=!1,u=I,J="component",L=!1,W=null,le=null,q(),r.querySelector("#missing-name")?.focus()}function q(){if(O?.disconnect(),Ie?.(),z||T&&!l)N=!1;let A=r.activeElement,I=A?.id,j=A?.dataset.select,{scrollX:F,scrollY:G}=window,ke=r.querySelector(".inventory")?.scrollLeft??0,ee=Re===u,at=J==="component"&&(!ee||Ke!==J);Ke=J;let Ht=ee?r.querySelector(".inspection-content")?.scrollTop??0:0,At=ee&&(r.querySelector(".changed-files")?.open??!1),qt=r.querySelector(".comparison-slot")?.clientHeight??200,ct=r.querySelector(".pan-viewport"),mt=Re===u&&tt===se,It=mt?ct?.scrollLeft??0:0,Bt=mt?ct?.scrollTop??0:0;Re=u,tt=se;let S=e.components.find((n)=>n.id===u),Y=s.missing.find((n)=>n.id===u),Q=Sn(e,s,o.history),oe=Q.find((n)=>n.members.some((d)=>d.id===u)),pe=!!oe&&oe.members.length>1&&H,ut=pe?oe.box:S?.box??Y?.box,gt=oe?Q.indexOf(oe)+1:Q.length+s.missing.findIndex((n)=>n.id===u)+1,je=S?s.decisions[S.id]:void 0,ue=je?.revision===S?.revision?je:void 0,Ne=S?M[S.id]:void 0,Le=Object.keys(M).length>0,i=S?yt(e,S):[],a=S?pt(e,s,S,H,Object.keys(M)):[],p=S?!e.components.some((n)=>!a.some((d)=>d.id===n.id)&&fe(n,s).kind==="pending"):!1,g=C&&!z?`<div class="decision-notice"><span role="status">${v(C.name)} ${C.action==="approve"?"approved":"flagged for repair"}.</span><button id="undo-decision" class="text-action">Undo</button></div>`:"",f=_e(e,s),m=o.history,h=S?wt(S.id,m):void 0,y=m?.packet.components.find((n)=>n.id===S?.id),R=ie&&!!y,b=R?y:S,B=R?m.packet:e,pn=Object.values(m?.changes??{}),dn=pn.filter((n)=>n.kind==="changed").length,cn=pn.filter((n)=>n.kind==="added").length,jt=e.components.filter((n)=>fe(n,s,m).kind==="approved"&&wt(n.id,m).carried).length,Nt=(n)=>{let d=fe(n,s,m);return z&&d.kind==="feedback"?{...d,label:"Changes requested"}:d},st=Q.filter((n)=>n.kind==="pending").length,ti=Q.length-st+s.missing.length,mn=Q.filter((n)=>w==="all"||n.kind==="pending"===(w==="pending")).map((n)=>n.representative),ni=(n)=>Q.find((d)=>d.members.some((E)=>E.id===n))?.label??n,ii=[f.revisions+s.missing.length?`${f.revisions+s.missing.length} feedback ready`:"",jt?`${jt} ${jt===1?"approval":"approvals"} kept`:"",dn?`${dn} changed`:"",cn?`${cn} added`:"",m?.removed.length?`${m.removed.length} removed`:""].filter(Boolean).join(" · "),oi=x||(Le?"Save or cancel your open feedback before sending.":z?o.preview?"Preview submitted. No run changed.":"Review submitted.":f.hasFeedback?"Ready to send for corrections.":f.pending?`${st} left to review`:!s.inventoryConfirmed?"Confirm the map is complete.":"Ready to continue."),Te=b?Xe(b):null,Ot=b?.preview.kind==="image"&&!Te?.code,Ft=Ot||b?.material?.alpha==="transparent",be=!!(b?.context&&ve==="context"),un=b&&(be?b.context?.kind!=="image":b.preview.kind==="page"),Ut=be&&b?.context?b.context.url:b?.preview.url,gn=b?$t(B,b):null,ri=Te?.code?`${Te.label} · ${Te.captured?"captured from code":"live preview"}`:b?.material?`${b.material.alpha==="transparent"?"Transparent":b.material.alpha==="opaque"?"Opaque":"Transparency unverified"} ${b.material.format}`:"Raster · transparency unverified";r.innerHTML=`<style>${Hn}</style><section class="review ${l?"assembled-review":""}" aria-label="${l?"Assembled page review":"Component review"}" style="--comp-background:${/^#[0-9a-f]{6}$/i.test(e.comp.background??"")?e.comp.background:"#eeeeee"}">
      <header><div><h1>${z?"Review record.":l?"Review the assembled page.":"Review the components."}</h1><p>${v(e.title)} <span>· Round ${v(e.round)}</span></p></div>${z?'<span class="badge">Submitted · read-only</span>':o.preview?'<span class="badge">Interactive preview</span>':""}</header>
      ${o.preview?'<p class="preview-note">Historical hotel artwork for testing this interface. Decisions stay in this preview; no run is changed.</p>':""}
      ${m&&!l?`<section class="round-summary" aria-label="Changes since previous round"><p><strong>${st} ${st===1?"item":"items"} to review</strong><span>${ii}</span></p>${f.pending?`<button id="review-changes" class="ks-icon-button" aria-label="Next to review" title="Next to review">${ye("next")}</button>`:""}${m.removed.length?`<details><summary>Removed from the map</summary><p>${m.removed.map((n)=>v(n.name)).join(" · ")}. Confirm these omissions are intentional before accepting the map.</p></details>`:""}</section>`:""}
      ${!l?`<div class="mobile-panes"><div class="ks-instrument-strip is-paper" data-ks-strip="pane" role="group" aria-label="Inspection view"><button type="button" class="ks-instrument-key" id="show-comp" aria-pressed="${J==="comp"}">Approved comp</button><button type="button" class="ks-instrument-key" id="show-component" aria-pressed="${J==="component"}">Component ${gt}</button></div></div>`:""}
      <div class="workbench" data-mobile-pane="${J}">${!l?`<svg class="connector" aria-hidden="true"><path /></svg>
        <section class="reference" aria-label="Approved composition">
          <div class="section-head"><h2>Approved comp</h2>${!z?`<button id="mark" class="ks-button ks-button-ghost" aria-pressed="${L}">${L?"Cancel":"Mark missing"}</button>`:""}</div>
          <div class="map-space"><div class="map ${L?"marking":""}" style="aspect-ratio:${e.comp.width}/${e.comp.height}">
            <img class="comp" src="${ze(e.comp.url)}" alt="Approved composition for ${v(e.title)}" draggable="false">
            ${ut&&!T?`<div class="region" style="${re(ut)}"></div>`:""}
            ${Q.map((n,d)=>{let E=n.representative,P={kind:n.kind,label:n.stateLabel},he=!T&&oe?.id===n.id;return`<button class="pin ${P.kind} ${he?"selected":""}" data-select="${v(E.id)}" style="left:${qe(Math.min(0.96,n.box.x+n.box.w/2))};top:${qe(Math.max(0.035,n.box.y))}" aria-label="Inspect ${v(n.label)}${n.members.length>1?` · ${n.members.length} instances`:""} — ${v(P.label)}" title="${d+1}. ${v(n.label)} · ${v(P.label)}" aria-pressed="${he}">${P.kind==="approved"?me:P.kind==="feedback"?We:""}<span>${d+1}</span>${n.members.length>1?`<small>×${n.members.length}</small>`:""}</button>`}).join("")}
            ${pe&&!T?oe.members.map((n)=>`<div class="region instance-region" style="${re(n.box)}"></div>`).join(""):""}
            ${s.missing.map((n,d)=>`<button class="pin feedback ${!T&&u===n.id?"selected":""}" data-select="${v(n.id)}" style="left:${qe(n.box.x+n.box.w/2)};top:${qe(n.box.y)}" aria-label="Inspect missing ${v(n.name)}" title="Missing: ${v(n.name)}">${We}<span>${Q.length+d+1}</span></button>`).join("")}

            <div class="draw-box" hidden></div>
          </div></div>
          <div class="map-legend" aria-label="Map status legend"><span><i class="legend-pending">#</i> To review</span><span><i class="legend-feedback">${We}</i> ${z?"Changes requested":"Feedback ready"}</span><span><i class="legend-approved">${me}</i> Approved</span></div>
          ${L?'<div class="map-caption">Draw around the missing piece.<button id="add-box">Add an adjustable box</button></div>':""}
        </section>`:""}
        <section class="inspector" aria-label="${l?"Page comparison":"Selected component"}">
          ${!l?`<div class="section-head"><h2>${T?"Review summary":`<span class="number">${gt}</span> ${v(pe?oe.label:S?.name??Y?.name??"Component")}`}</h2></div>`:""}<div class="inspection-content" role="region" aria-label="${l?"Page comparison":"Component comparison"}" tabindex="0">
          ${T&&!l?`<section class="review-summary" id="review-summary" tabindex="-1"><div class="completion-mark" aria-hidden="true">${me}</div><h2>${z?"Review sent.":"All components reviewed."}</h2><p>${f.approved} approved · ${f.revisions} flagged for repair${s.missing.length?` · ${s.missing.length} missing`:""}</p><p>${z?"Your decisions are saved.":f.hasFeedback?"Send your feedback to start the next repair round.":"Confirm nothing is missing, then approve and continue."}</p><div class="summary-decisions">${Q.map((n)=>{let d=n.representative,E=s.decisions[d.id],P=Nt(d);return`<button data-select="${v(d.id)}"><strong>${v(n.label)}</strong><span>${n.kind==="pending"?"Not reviewed":P.kind==="feedback"?"Needs work":"Approved"}</span>${E?.action==="revise"?`<small>${v(E.feedback||"No note — agent will diagnose.")}</small>`:""}</button>`}).join("")}${s.missing.map((n)=>`<button data-select="${v(n.id)}"><strong>${v(n.name)}</strong><span>Missing</span><small>${v(n.feedback)}</small></button>`).join("")}</div></section></div>${g?`<div class="review-form">${g}</div>`:""}`:S?`
          ${m?`<div class="repair-context">
            ${R&&h?.prior?.action==="revise"?`<section class="previous-feedback" aria-label="Previous feedback"><h3>Previous feedback <span>· Round ${h.feedbackRound}</span></h3><blockquote>${v(h.prior.feedback||"No written feedback was supplied.")}</blockquote>${h.prior.split?"<p>Requested: split into separately reviewable components.</p>":""}</section>`:h?.carried?'<p class="kept-approval">Unchanged · approval kept</p>':""}
            ${h?.change?.kind==="changed"?`<details class="changed-files" ${At?"open":""}><summary>${h.change.files.length?`${h.change.files.length} changed ${h.change.files.length===1?"file":"files"}`:h.change.reasons.includes("region")?"Region changed":y?.note!==S.note?"Description changed · files unchanged":"Component definition changed · files unchanged"}</summary>${h.change.files.length?`<ul>${h.change.files.map((n)=>`<li>${v(n)}</li>`).join("")}</ul>`:""}${y&&y.note!==S.note?`<dl class="description-diff"><dt>Previous description</dt><dd>${v(y.note)}</dd><dt>Current description</dt><dd>${v(S.note)}</dd></dl>`:""}</details>`:""}
          </div>`:""}

          <div class="comparison-slot"><div class="comparison-panel ${pe?"group-overview":""}"><h2 class="expanded-title">${v(pe?oe.label:b.name)}</h2>${i.length>1?`<div class="review-peers"><strong>${i.length} instances</strong>${!pe?'<button id="all-instances" class="quiet">All instances</button>':'<span class="group-hint">Select to inspect</span>'}</div>`:""}<div class="compare-toolbar">${y?`<div class="round-switch ks-instrument-strip is-paper" data-ks-strip="round" role="group" aria-label="Preview version"><button type="button" class="ks-instrument-key" id="current-round" aria-label="Current · round ${v(e.round)}" title="Current · round ${v(e.round)}" aria-pressed="${!R}">Current</button><button type="button" class="ks-instrument-key" id="previous-round" aria-label="Previous · round ${v(m.packet.round)}" title="Previous · round ${v(m.packet.round)}" aria-pressed="${R}">Previous</button></div>`:""}<div class="ks-instrument-strip is-paper zoom-strip" data-ks-strip="zoom" role="group" aria-label="Comparison zoom">${[["fit","Fit"],["1","100%"],["2","200%"],["4","400%"]].map(([n,d])=>`<button type="button" class="ks-instrument-key" data-zoom="${n}" aria-pressed="${String(se)===n}">${d}</button>`).join("")}</div><button id="overlay" type="button" class="ks-switch" title="Overlay the approved comp" aria-pressed="${Z}"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">Overlay</span></button><div class="comparison-actions" role="group" aria-label="Comparison view actions"><button id="expand-comparison" class="ks-icon-button" aria-label="${N?"Restore comparison":"Enlarge comparison"}" title="${N?"Restore comparison (Esc)":"Enlarge comparison"}" aria-expanded="${N}">${ye(N?"compact":"expand")}</button>${b?.preview.kind==="image"?`<a class="ks-icon-button source-link" href="${ze(Ut)}" target="_blank" rel="noopener" aria-label="${be?"Open context capture":Te.fileLabel}" title="${be?"Open context capture":Te.fileLabel}">${ye("external")}</a>`:""}</div></div>
          ${pe?`<div class="instance-grid" aria-label="All instances of ${v(oe.label)}"><div class="instance-grid-labels"><span>Full comp crop</span><span>Component preview</span></div>${oe.members.map((n,d)=>{let E=Nt(n);return`<button class="instance-row ${E.kind}" data-instance="${v(n.id)}" aria-label="Inspect instance ${d+1}: ${v(n.name)} — ${v(E.label)}"><span class="instance-caption"><strong>${v(n.name)}</strong><span>${v(E.label)}</span></span><span class="instance-pair"><span class="instance-reference" style="width:min(100%,${n.box.w*e.comp.width}px,${180*n.box.w*e.comp.width/(n.box.h*e.comp.height)}px);aspect-ratio:${n.box.w*e.comp.width}/${n.box.h*e.comp.height}"><img src="${ze(e.comp.url)}" alt="Comp: ${v(n.name)}" loading="lazy" style="width:${100/n.box.w}%;left:${-100*n.box.x/n.box.w}%;top:${-100*n.box.y/n.box.h}%">${it(e,n)}</span><span class="instance-produced" style="width:min(100%,${n.box.w*e.comp.width}px,${180*n.box.w*e.comp.width/(n.box.h*e.comp.height)}px);aspect-ratio:${n.box.w*e.comp.width}/${n.box.h*e.comp.height}">${n.preview.kind==="image"?`<img src="${ze(n.preview.url)}" alt="Produced: ${v(n.name)}" loading="lazy">`:n.thumbnail?`<img src="${ze(n.thumbnail.url)}" alt="Preview: ${v(n.name)}" loading="lazy">`:"Open live component"}</span></span>${nt(e,n)}</button>`}).join("")}</div>`:""}
          ${!pe&&b?nt(B,b):""}<div class="compare">
            <figure><figcaption>${R?`Comp · Round ${v(m.packet.round)}`:l?"Approved comp":gn?.related.length?"Full comp crop":"In the comp"}</figcaption><div class="pan-viewport" aria-label="Reference comparison canvas" tabindex="0"><div class="crop-stage"><img class="crop-image" src="${ze(B.comp.url)}" alt="Reference region for ${v(b.name)}" style="width:${100/b.box.w}%;left:${-100*b.box.x/b.box.w}%;top:${-100*b.box.y/b.box.h}%">${it(B,b)}</div></div></figure>
            <figure><figcaption>${R?`Previous · Round ${v(m.packet.round)}`:l?"Assembled page":be?"In context":m?`${Te.caption} · Round ${v(e.round)}`:Te.caption}</figcaption><div class="pan-viewport" aria-label="Produced comparison canvas" tabindex="0"><div class="output crop-stage ${Ft&&!be&&!un&&Pe==="checker"?"checker":""}">${!un?`<img class="asset" src="${ze(Ut)}" alt="Produced ${v(b.name)}" style="object-position:${Yn(b.preview.position)}">`:`<iframe aria-hidden="true" title="Rendered ${v(b.name)}" src="${ze(Ut)}" sandbox="" tabindex="-1" width="${B.comp.width}" height="${B.comp.height}"></iframe>`}${Z?`<img class="crop-image overlay-image" src="${ze(B.comp.url)}" alt="Reference overlay" style="width:${100/b.box.w}%;left:${-100*b.box.x/b.box.w}%;top:${-100*b.box.y/b.box.h}%">`:""}</div></div></figure>
          </div>
          ${Ft||b.context?`<div class="view-controls">${b.context?`<div class="ks-instrument-strip is-paper" data-ks-strip="view" role="group" aria-label="Component view"><button type="button" class="ks-instrument-key" id="isolated" aria-pressed="${!be}">${Ot?"Asset only":"Component only"}</button><button type="button" class="ks-instrument-key" id="context" aria-pressed="${be}">In context</button></div>`:""}${Ft?`<div class="background-options ks-instrument-strip is-paper" data-ks-strip="background" role="group" aria-label="Asset preview background"><button type="button" id="background-checker" class="ks-instrument-key" aria-label="Checkerboard background" title="Checkerboard background" aria-pressed="${Pe==="checker"}" ${be?"disabled":""}>Checker</button><button type="button" id="background-page" class="ks-instrument-key" aria-label="${B.comp.background?"Page color":"Neutral"} background" title="${B.comp.background?"Page color":"Neutral"} background" aria-pressed="${Pe==="page"}" ${be?"disabled":""}>Page</button></div>`:""}</div>`:""}
          </div></div>${!l&&!pe?`<div class="component-details"><div class="material">${ye(Te.code?"code":"image")}<strong>${v(ri)}</strong><span>${b?.material?`${b.material.width} × ${b.material.height} px`:""}</span></div>${B.stage==="components"&&Te?.captured&&!b?.preview.isolation?'<p class="layering">Legacy region capture · may include overlapping components.</p>':""}${b?.context?.layering&&(Ot||be)?`<p class="layering">${v(b.context.layering)}</p>`:""}
          <p class="component-note">${!gn?.related.length?v(b.note):""}</p>
          </div>`:""}</div><div class="review-form">${g}${R?'<p class="previous-notice">Viewing the previous round. Return to Current to make a decision.</p>':""}${z?`<div class="record-verdict"><strong>${ue?.action==="approve"?"Approved":ue?.action==="revise"?"Changes requested":"Not reviewed"}</strong><span>Submitted in round ${e.round} · read-only</span></div>`:`<div class="decisions" role="group" aria-label="Decision for ${v(S.name)}">${!l?`<div class="decision-title"><strong>Your review <span>Round ${e.round}</span></strong>${R?"<p>Return to Current to review this round.</p>":""}</div>`:""}<button id="approve" ${!a.length?"disabled":""} class="ks-button ks-button-primary decision-approve ${ue?.action==="approve"?"approved":""}" aria-pressed="${ue?.action==="approve"}">${l?k?"Sending…":`Approve & continue${Fe}`:a.length>1?`Approve ${a.length} instances`:"Looks good"}</button><button id="revise" ${!a.length?"disabled":""} class="ks-button ks-button-secondary decision-revise ${ue?.action==="revise"?"revise":""}" aria-pressed="${ue?.action==="revise"}">${a.length>1?`Revise ${a.length} instances`:"Needs work"}</button>${ue&&!l&&!pe?`<button id="clear" class="ks-icon-button" aria-label="Clear decision" title="Clear decision">${ye("undo")}</button>`:""}</div>`}
          ${Ne?`<form id="feedback-form"><div class="feedback-fields"><label class="feedback-field">What needs to change?<textarea id="feedback" aria-describedby="feedback-hint">${v(Ne.feedback)}</textarea></label><p id="feedback-hint" class="feedback-hint">Optional — leave blank for the agent to diagnose.</p>${!l?`<label class="check"><input id="split" type="checkbox" ${Ne.split?"checked":""}> Split into separately reviewable components</label>`:""}</div><div class="feedback-actions"><button id="cancel-feedback" type="button" class="ks-button ks-button-ghost">Cancel</button><button id="save-feedback" type="submit" class="ks-button ks-button-primary">${l?"Send feedback":p?"Save & finish review":"Save & next"}${Fe}</button><span class="shortcut-hint">${V}</span></div></form>`:ue?.action==="revise"?`<p class="saved-feedback">${v(ue.feedback||"No note — agent will diagnose.")}</p>`:""}
          ${l?`<p class="page-review-status" role="status">${v(x||(z?"Your decision is saved.":k?"Sending…":Ne?"":"Approval confirms the composition and that nothing is missing."))}</p>`:""}</div>`:Y?`<p>This piece will be added to the unresolved inventory.</p><label class="feedback-field">Name<input id="missing-name" value="${v(Y.name)}"></label><label class="feedback-field">What is missing?<textarea id="missing-feedback">${v(Y.feedback)}</textarea></label><div class="coordinates">${["x","y","w","h"].map((n)=>`<label>${{x:"Left",y:"Top",w:"Width",h:"Height"}[n]} %<input type="number" data-coordinate="${n}" value="${Math.round(Y.box[n]*1000)/10}" min="0" max="100" step="0.1"></label>`).join("")}</div><button id="remove-missing">Remove this mark</button></div>`:"<p>No components supplied.</p></div>"}
        </section>
      </div>
      ${!l?`<section class="inventory-section ${X?"":"tray-collapsed"} ${xe&&X?"tray-expanded":""}" aria-label="Component inventory"><div class="section-head"><h2>Components</h2><div class="inventory-filters ks-instrument-strip is-paper" data-ks-strip="filter" role="group" aria-label="Filter components"><button type="button" class="ks-instrument-key" data-filter="pending" aria-pressed="${w==="pending"}">To review <b>${st}</b></button><button type="button" class="ks-instrument-key" data-filter="reviewed" aria-pressed="${w==="reviewed"}">Reviewed <b>${ti}</b></button><button type="button" class="ks-instrument-key" data-filter="all" aria-pressed="${w==="all"}">All <b>${Q.length+s.missing.length}</b></button></div><div class="tray-actions"><button id="show-all" class="ks-icon-button" aria-pressed="${xe}" aria-controls="component-tray" aria-label="${xe?"Compact":"Expand"} tray" title="${xe?"Compact":"Expand"} tray">${ye(xe?"compact":"expand")}</button><button id="toggle-tray" class="ks-icon-button" aria-expanded="${X}" aria-controls="component-tray" aria-label="${X?"Hide":"Show"} component tray" title="${X?"Hide":"Show"} component tray">${ye(X?"hideTray":"showTray")}</button></div></div>
      <div id="component-tray" class="inventory ${xe?"all":""}">${mn.map((n)=>{let d=Q.find((he)=>he.members.some((de)=>de.id===n.id)),E=Q.indexOf(d),P={kind:d.kind,label:d.stateLabel};return`<button class="item ${P.kind} ${!T&&oe?.id===d.id?"active":""}" data-select="${v(n.id)}" aria-pressed="${!T&&oe?.id===d.id}">${n.thumbnail?`<span class="item-thumb">${n.thumbnail.box?`<span class="thumb-crop" style="width:min(100%,${76*n.thumbnail.box.w*e.comp.width/(n.thumbnail.box.h*e.comp.height)}px);aspect-ratio:${n.thumbnail.box.w*e.comp.width}/${n.thumbnail.box.h*e.comp.height}"><img alt="" loading="lazy" src="${ze(n.thumbnail.url)}" style="position:absolute;width:${100/n.thumbnail.box.w}%;max-width:none;left:${-100*n.thumbnail.box.x/n.thumbnail.box.w}%;top:${-100*n.thumbnail.box.y/n.thumbnail.box.h}%;"></span>`:`<img alt="" loading="lazy" src="${ze(n.thumbnail.url)}">`}</span>`:""}<span class="item-number">${P.kind==="approved"?me:P.kind==="feedback"?We:""}${E+1}<span class="item-medium">${ye(Xe(n).code?"code":"image")}${v(Xe(n).label)}</span></span><strong>${v(ni(n.id))}${d.members.length>1?` <small>×${d.members.length}</small>`:""}</strong><span class="state ${P.kind}">${v(P.label)}</span></button>`}).join("")}${(w==="pending"?[]:s.missing).map((n,d)=>`<button class="item feedback ${u===n.id?"active":""}" data-select="${v(n.id)}"><span class="item-number">${Q.length+d+1}</span><strong>${v(n.name)}</strong><span class="state revise">Missing</span></button>`).join("")}${!mn.length&&(w==="pending"||!s.missing.length)?`<p class="inventory-empty">${w==="pending"?"Nothing left to review. Your decisions are ready.":"No components reviewed yet."}</p>`:""}</div></section>`:""}
      ${l?"":z?`<footer class="record-footer"><span>Round ${v(e.round)} submitted · read-only</span><span>${f.approved} approved · ${f.revisions} changes requested</span></footer>`:`<footer class="${!f.pending&&!Le?"queue-complete":""}"><div>${!f.pending&&!Le?`<button id="show-summary" class="completion-link">${me}${z?"Review sent":"All components reviewed"}</button>`:""}<button id="approve-rest" class="ks-button ks-button-secondary" ${!f.pending?"hidden":""} ${!f.pending||Le?"disabled":""}>Approve ${f.approved||f.revisions?"remaining":"all"}</button><label class="check ks-checkbox"><input id="inventory-confirm" type="checkbox" ${s.inventoryConfirmed?"checked":""}> Nothing missing from the comp</label></div><div class="submit-area"><p role="status">${v(oi)}</p><button id="submit" class="ks-button ks-button-primary" ${!f.canSubmit||Le||k||z?"disabled":""}>${k?"Sending…":z?"Review sent":f.hasFeedback?"Send feedback":"Approve & continue"}${k||z?"":Fe}</button></div></footer>`}
    </section><dialog id="comparison-dialog" aria-label="${l?"Enlarged page comparison":"Enlarged component comparison"}"></dialog>`;let ae=r.querySelector("#comparison-dialog"),ge=r.querySelector(".comparison-panel"),Oe=r.querySelector(".comparison-slot"),Ce=r.querySelector(".inspector > .review-form"),ai=r.querySelector(".inspector"),hn=()=>{if(ae.append(ge),Ce)ae.append(Ce)};if(N&&ge&&Oe)Oe.style.height=`${qt}px`,hn(),ae.showModal();if(R)r.querySelectorAll(".decisions button,#feedback,#split,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#submit,#inventory-confirm").forEach((n)=>n.disabled=!0);if(r.querySelector(".inspection-content").scrollTop=Ht,z||k)r.querySelectorAll(".decisions button,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#mark,#inventory-confirm,#missing-name,#missing-feedback,#feedback,#split,#remove-missing,[data-coordinate]").forEach((n)=>n.disabled=!0);let fn=r.querySelector(".inventory");if(fn)fn.scrollLeft=ke;if(!ee&&X)Array.from(r.querySelectorAll(".inventory [data-select]")).find((n)=>n.dataset.select===u)?.scrollIntoView({block:"nearest",inline:"nearest"});if(I)r.getElementById(I)?.focus({preventScroll:!0});else if(j)Array.from(r.querySelectorAll(".item[data-select]")).find((n)=>n.dataset.select===j)?.focus({preventScroll:!0});let K=(n,d)=>r.querySelector(`#${n}`)?.addEventListener("click",d);function Kt(n,d=!1,E=!1){if(L)return;if(!E)n=Q.find((P)=>P.members.some((he)=>he.id===n))?.representative.id??n;if(H=!E,T=!1,u=n,J="component",Z=!1,se="fit",ve="isolated",ie=!1,q(),d)r.querySelector("#expand-comparison")?.click()}r.querySelectorAll("[data-select]").forEach((n)=>n.onclick=()=>Kt(n.dataset.select,n.classList.contains("pin")&&e.components.some((d)=>d.id===n.dataset.select))),K("previous-round",()=>{ie=!0,q()}),K("current-round",()=>{ie=!1,q()}),K("review-changes",()=>{let n=c().filter((P)=>Nt(P).kind==="pending"),d=n.findIndex((P)=>P.id===u),E=n[(d+1)%n.length];if(E)H=!0,T=!1,u=E.id,J="component",w="pending",ie=!1,se="fit",Z=!1,ve="isolated",q()}),r.querySelectorAll("[data-filter]").forEach((n)=>n.onclick=()=>{w=n.dataset.filter,T=!f.pending&&w==="pending";let d=Q.filter((P)=>w==="all"||P.kind==="pending"===(w==="pending")).map((P)=>P.representative);if(!(w!=="pending"&&s.missing.some((P)=>P.id===u))&&!d.some((P)=>P.id===u)&&d.length)H=!0,u=d[0].id,J="component",ie=!1,se="fit",Z=!1,ve="isolated";q()}),K("show-summary",()=>{T=!0,J="component",w="reviewed",q(),De("review-summary")}),K("approve",()=>Ve("approve")),K("revise",He),K("clear",()=>{if(S)delete s.decisions[S.id],delete M[S.id];C=null,T=!1,w="pending",q()}),K("cancel-feedback",()=>{if(S)delete M[S.id];if(_)X=!0,_=!1;q(),De("revise")}),r.querySelector("#feedback-form")?.addEventListener("submit",(n)=>{n.preventDefault(),Ve("revise")}),r.querySelector("#feedback")?.addEventListener("keydown",(n)=>{let d=n;if(d.key==="Enter"&&(d.metaKey||d.ctrlKey)&&!d.isComposing)d.preventDefault(),d.stopPropagation(),Ve("revise")}),K("undo-decision",()=>{if(!C||k||z)return;let n=C;for(let[d,E]of Object.entries(n.previous))if(E)s.decisions[d]=E;else delete s.decisions[d];delete M[n.id],u=n.id,T=!1,ie=!1,J="component",w="all",C=null,q(),De("approve")}),K("all-instances",()=>{H=!0,u=oe.representative.id,ie=!1,q()}),r.querySelectorAll("[data-instance]").forEach((n)=>n.onclick=()=>Kt(n.dataset.instance,!1,!0)),K("overlay",()=>{Z=!Z,q()}),K("isolated",()=>{ve="isolated",q()}),K("context",()=>{ve="context",q()}),r.querySelectorAll("[data-zoom]").forEach((n)=>n.addEventListener("click",()=>{let d=n.dataset.zoom;se=d==="fit"?"fit":Number(d),q()})),K("background-checker",()=>{Pe="checker",q()}),K("background-page",()=>{Pe="page",q()}),K("show-all",()=>{xe=!xe,X=!0,q()}),K("toggle-tray",()=>{_=!1,X=!X,q()}),K("show-comp",()=>{J="comp",q()}),K("show-component",()=>{J="component",q()}),K("mark",()=>{L=!L,q()}),K("add-box",()=>rt({x:0.35,y:0.35,w:0.2,h:0.2})),K("remove-missing",()=>{s.missing=s.missing.filter((n)=>n.id!==u),u=e.components[0]?.id,q()}),K("approve-rest",()=>{if(Le)return;s=Mn(e,s),C=null,T=!0,w="reviewed",J="component",q(),De("review-summary")}),r.querySelector("#inventory-confirm")?.addEventListener("change",(n)=>{s.inventoryConfirmed=n.target.checked,q()}),r.querySelector("#feedback")?.addEventListener("input",(n)=>{if(S&&M[S.id])M[S.id].feedback=n.target.value}),r.querySelector("#split")?.addEventListener("change",(n)=>{if(S&&M[S.id])M[S.id].split=n.target.checked}),r.querySelector("#missing-name")?.addEventListener("input",(n)=>{if(Y)Y.name=n.target.value;let d=r.querySelector("#submit");if(d)d.disabled=Le||k||z||!_e(e,s).canSubmit}),r.querySelector("#missing-feedback")?.addEventListener("input",(n)=>{if(Y)Y.feedback=n.target.value}),r.querySelectorAll("[data-coordinate]").forEach((n)=>n.addEventListener("change",()=>{if(!Y)return;let d=n.dataset.coordinate,E=Number(n.value)/100;if(Number.isFinite(E))Y.box[d]=Math.max(d==="w"||d==="h"?0.001:0,Math.min(1,E));Y.box.w=Math.min(Y.box.w,1-Y.box.x),Y.box.h=Math.min(Y.box.h,1-Y.box.y),q()})),K("submit",()=>{ot()});let we=r.querySelector(".map");function Wt(n){let d=we.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(n.clientX-d.left)/d.width)),y:Math.max(0,Math.min(1,(n.clientY-d.top)/d.height))}}function xn(n){let d=Wt(n);return e.components.filter(({box:E})=>d.x>=E.x&&d.x<=E.x+E.w&&d.y>=E.y&&d.y<=E.y+E.h).sort((E,P)=>E.box.w*E.box.h-P.box.w*P.box.h)[0]}we?.addEventListener("click",(n)=>{if(L||n.target.closest("[data-select]"))return;let d=xn(n);if(d)Kt(d.id,!0)}),we?.addEventListener("pointermove",(n)=>{if(!L)we.style.cursor=xn(n)?"zoom-in":""}),we?.addEventListener("pointerdown",(n)=>{if(!L)return;W=Wt(n),we.setPointerCapture(n.pointerId),n.preventDefault()}),we?.addEventListener("pointermove",(n)=>{if(!W)return;let d=Wt(n);le={x:Math.min(W.x,d.x),y:Math.min(W.y,d.y),w:Math.abs(d.x-W.x),h:Math.abs(d.y-W.y)};let E=r.querySelector(".draw-box");E.hidden=!1,E.style.cssText=re(le)}),we?.addEventListener("pointerup",()=>{if(le&&le.w>0.01&&le.h>0.01)rt(le);else W=null,le=null}),we?.addEventListener("pointercancel",()=>{W=null,le=null,q()});let vn=r.querySelector(".output"),ht=r.querySelector("iframe"),kn=r.querySelector(".workbench"),Ge=r.querySelector(".inspection-content"),Vt=r.querySelector(".inspector");function Gt(){if(!Ge||!Vt)return;Vt.dataset.scrollAbove=String(Ge.scrollTop>1),Vt.dataset.scrollBelow=String(Ge.scrollHeight-Ge.clientHeight-Ge.scrollTop>1)}Ge?.addEventListener("scroll",Gt,{passive:!0});function ft(){let n=r.querySelector(".map-space");if(n&&n.clientWidth&&n.clientHeight){let U=Xt(e.comp.width,e.comp.height,Math.max(1,n.clientWidth-32),Math.max(1,n.clientHeight-32),"fit");we.style.width=`${U.width}px`,we.style.height=`${U.height}px`}let d=r.querySelector(".inspection-content"),E=Array.from(r.querySelectorAll(".pan-viewport"));if(d?.clientHeight){let U=N?Math.max(100,ae.clientHeight-(ge?.querySelector(".compare-toolbar")?.clientHeight??0)-(ge?.querySelector(".expanded-title")?.clientHeight??0)-(ge?.querySelector(".view-controls")?.clientHeight??0)-(Ce?.getBoundingClientRect().height??0)-124):Math.min(l?Number.POSITIVE_INFINITY:248,Math.max(100,d.clientHeight-((E[0]?.getBoundingClientRect().top??d.getBoundingClientRect().top)-d.getBoundingClientRect().top+d.scrollTop)-(ge?.querySelector(".view-controls")?.clientHeight??0)-12));E.forEach((te)=>te.style.height=`${U}px`)}if(b&&E.length&&!pe){let U=Xt(b.box.w*B.comp.width,b.box.h*B.comp.height,Math.min(...E.map((te)=>te.clientWidth)),Math.min(...E.map((te)=>te.clientHeight)),se);r.querySelectorAll(".crop-stage").forEach((te)=>{te.style.width=`${U.width}px`,te.style.height=`${U.height}px`})}if(E.forEach((U)=>{let te=U.scrollWidth>U.clientWidth+1||U.scrollHeight>U.clientHeight+1;U.classList.toggle("pannable",te),U.style.cursor=N?"":"zoom-in",U.setAttribute("role",N?"region":"button"),U.title=N?te?"Move your pointer to pan. You can also scroll, swipe, or use arrow keys.":"":"Click to enlarge comparison"}),vn&&ht&&b){let U=vn.clientWidth/(b.box.w*B.comp.width);ht.style.transform=`scale(${U})`,ht.style.left=`${-b.box.x*B.comp.width*U}px`,ht.style.top=`${-b.box.y*B.comp.height*U}px`}let P=kn.getBoundingClientRect(),he=r.querySelector(".region"),de=r.querySelector(".number"),vt=r.querySelector(".connector path");if(he&&de&&vt){let U=he.getBoundingClientRect(),te=de.getBoundingClientRect(),kt=U.right-P.left,ne=U.top+U.height/2-P.top,lt=te.left-P.left-8,bt=te.top+te.height/2-P.top;vt.setAttribute("d",`M ${kt} ${ne} H ${lt-14} V ${bt} H ${lt}`)}}function Ye(n,d){if(!ge||!Oe||n===N)return;let E=r.querySelector("#expand-comparison"),P=(N?ae:ge).getBoundingClientRect(),he=window.matchMedia("(prefers-reduced-motion: reduce)").matches,de=ge.querySelector(".pan-viewport"),vt=de?de.scrollLeft/Math.max(1,de.scrollWidth-de.clientWidth):0,U=de?de.scrollTop/Math.max(1,de.scrollHeight-de.clientHeight):0,te=()=>ge.querySelectorAll(".pan-viewport").forEach((ne)=>{ne.scrollLeft=vt*Math.max(0,ne.scrollWidth-ne.clientWidth),ne.scrollTop=U*Math.max(0,ne.scrollHeight-ne.clientHeight)}),kt=()=>{if(Oe.append(ge),Ce)ai.append(Ce),Ce.inert=!1;ae.close(),Oe.style.height="",Se=!1,N=!1,E.innerHTML=ye("expand"),E.setAttribute("aria-label","Enlarge comparison"),E.title="Enlarge comparison",E.setAttribute("aria-expanded","false"),ft(),te(),E.focus({preventScroll:!0}),d?.()};if(n){Oe.style.height=`${P.height}px`,hn(),ae.showModal(),N=!0,E.innerHTML=ye("compact"),E.setAttribute("aria-label","Restore comparison"),E.title="Restore comparison (Esc)",E.setAttribute("aria-expanded","true"),ft(),te(),E.focus({preventScroll:!0});let ne=ae.getBoundingClientRect();if(!he)ae.animate([{transform:`translate(${P.x-ne.x}px,${P.y-ne.y}px) scale(${P.width/ne.width},${P.height/ne.height})`,opacity:0.6},{transform:"none",opacity:1}],{duration:240,easing:"cubic-bezier(.2,.8,.2,1)"})}else{if(E.disabled)return;let ne=Oe.getBoundingClientRect();if(he){kt();return}if(E.disabled=!0,Se=!0,Ce)Ce.inert=!0;let lt=ae.animate([{transform:"none",opacity:1},{transform:`translate(${ne.x-P.x}px,${ne.y-P.y}px) scale(${ne.width/P.width},${ne.height/P.height})`,opacity:0.6}],{duration:200,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});ae.inert=!0;let bt=()=>{if(lt.cancel(),E.disabled=!1,ae.inert=!1,ae.isConnected)kt();else Se=!1,N=!1,q(),d?.()};lt.finished.then(bt,bt)}}if(ce=(n)=>Ye(!1,n),K("expand-comparison",()=>Ye(!N)),ae.addEventListener("cancel",(n)=>{n.preventDefault(),n.stopPropagation(),Ye(!1)}),ae.addEventListener("keydown",(n)=>{if(n.key==="Escape")n.preventDefault(),n.stopPropagation(),Ye(!1)}),Ie=Pt(r),O=new ResizeObserver(()=>{ft(),Gt()}),O.observe(kn),O.observe(ae),Ce)O.observe(Ce);let bn=r.querySelector(".inspection-content");if(bn)O.observe(bn);let wn=r.querySelector(".repair-context");if(wn)O.observe(wn);let yn=ge?.querySelector(".compare-toolbar");if(yn)O.observe(yn);ft();let xt=Array.from(r.querySelectorAll(".pan-viewport"));if(xt.forEach((n)=>{n.scrollLeft=It,n.scrollTop=Bt}),xt.forEach((n)=>{n.querySelectorAll("img").forEach((d)=>d.draggable=!1),n.addEventListener("click",()=>{if(!N)Ye(!0)}),n.addEventListener("pointermove",(d)=>{if(d.pointerType!=="mouse"||d.buttons||!n.classList.contains("pannable"))return;let E=n.getBoundingClientRect();n.scrollLeft=_t(d.clientX,E.left,n.clientWidth,n.scrollWidth),n.scrollTop=_t(d.clientY,E.top,n.clientHeight,n.scrollHeight)}),n.addEventListener("keydown",(d)=>{if(!N&&(d.key==="Enter"||d.key===" ")){d.preventDefault(),d.stopPropagation(),Ye(!0);return}let P={ArrowLeft:[-48,0],ArrowRight:[48,0],ArrowUp:[0,-48],ArrowDown:[0,48]}[d.key];if(!P)return;d.preventDefault(),d.stopPropagation(),n.scrollLeft+=P[0],n.scrollTop+=P[1]})}),xt.forEach((n)=>n.addEventListener("scroll",()=>{for(let d of xt)if(d!==n){if(d.scrollLeft!==n.scrollLeft)d.scrollLeft=n.scrollLeft;if(d.scrollTop!==n.scrollTop)d.scrollTop=n.scrollTop}})),at&&window.matchMedia("(max-width:800px)").matches){let n=r.querySelector(".inspection-content"),d=r.querySelector(".compare");if(n&&d)n.scrollTop+=d.getBoundingClientRect().top-n.getBoundingClientRect().top}if(Gt(),window.scrollTo(F,G),!z)o.onDraftChange?.(structuredClone(s))}return q(),{destroy(){O?.disconnect(),Ie?.(),r.replaceChildren()},getDraft(){return structuredClone(s)}}}function mi(){let t=document.createElement("style");t.textContent=[["Albert Sans","albertsans"],["Alumni Sans","alumnisans"],["JetBrains Mono","jetbrainsmono"]].map(([e,o])=>`@font-face{font-family:"${e}";src:url(/fonts/${o}.ttf);font-weight:100 900}`).join(""),document.head.append(t)}function ui(t){let e=document.createElement("div");e.setAttribute("role","alert"),e.style.cssText="max-width:560px;margin:18vh auto 0;padding:0 0 0 18px;border-left:2px solid var(--ks-vermilion,oklch(52% 0.16 35));color:var(--ks-text,oklch(22% 0 0));font:400 15px/1.55 var(--font-sans,Arial,sans-serif)";let o=document.createElement("p");o.textContent="Review unavailable",o.style.cssText="margin:0 0 8px;font:400 11px/1.3 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:var(--ks-text-muted,oklch(46% 0 0))";let r=document.createElement("strong");r.textContent="The review could not be opened.",r.style.cssText="display:block;font-weight:500;color:var(--ks-ink,oklch(13% 0 0))";let s=document.createElement("p");s.style.cssText="margin:4px 0 18px;color:var(--ks-text-muted,oklch(46% 0 0))",s.textContent=`${t} If the review server stopped, ask the agent to serve the review again, then reload.`;let l=document.createElement("button");return l.textContent="Reload",l.style.cssText="font:500 15px/1 var(--font-sans,Arial,sans-serif);min-height:44px;padding:0 22px;border:1px solid oklch(13% 0 0);border-radius:3px;background:oklch(13% 0 0);color:oklch(99.5% 0 0);cursor:pointer",l.onclick=()=>location.reload(),e.append(o,r,s,l),e}async function gi(){mi();let t=document.getElementById("review"),e=await fetch("/packet",{cache:"no-store"});if(!e.ok)throw Error("The review packet could not be loaded.");let o=await e.json(),r=zt(o.packet);if(o.sourceStatus&&!r){let s=document.createElement("p");s.textContent=o.sourceStatus,t.before(s)}ei(t,o.packet,{initialDraft:o.draft,history:o.history,completed:!!o.receipt,status:r?o.sourceStatus:null,onSubmit:async(s)=>{let l=await fetch("/decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(s)}),c=await l.json().catch(()=>({}));if(!l.ok)throw Error(c.error??"The review could not be saved. Try again.")}})}gi().catch((t)=>{document.getElementById("review")?.replaceChildren(ui(t instanceof Error?t.message:String(t)))});})();
