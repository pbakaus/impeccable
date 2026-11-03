(()=>{function kt(n,e){let r=e?.changes[n],o=e?.feedback?.[n],a=o?.decision??(e?.submitted?e.draft.decisions[n]:void 0),l=r?.kind==="unchanged"&&(r.carried??(e?.submitted&&a?.action==="approve"))===!0;return{change:r,prior:a,feedbackRound:o?.round??e?.packet.round,carried:l,label:r?.kind==="added"?"New component":r?.kind==="changed"?"Review again":l?"Approval kept":a?.action==="revise"?"Changes still requested":"Awaiting review"}}function ve(n,e,r){let o=e.decisions[n.id],a=o?.revision===n.revision?o:void 0,l=kt(n.id,r);if(a?.action==="approve")return{kind:"approved",label:l.carried?"Approval kept":"Approved",priority:3};if(a?.action==="revise")return{kind:"feedback",label:"Feedback ready",priority:2};return{kind:"pending",label:l.change?.kind==="changed"?"Review again":l.change?.kind==="added"?"New · review needed":"Not reviewed",priority:l.change?.kind==="changed"||l.change?.kind==="added"?0:1}}function kn(n){return{packetRevision:n.revision,decisions:{},missing:[],inventoryConfirmed:!1}}function Wt(n){return Object.values(n).every(Number.isFinite)&&n.x>=0&&n.y>=0&&n.w>0&&n.h>0&&n.x+n.w<=1.00001&&n.y+n.h<=1.00001}function Je(n,e){let r=n.components.map((g)=>e.decisions[g.id]?.revision===g.revision?e.decisions[g.id]:void 0),o=r.filter((g)=>g?.action==="approve").length,a=r.filter((g)=>g?.action==="revise").length,l=r.length-o-a,y=a>0||e.missing.length>0;return{approved:o,revisions:a,pending:l,hasFeedback:y,canSubmit:e.packetRevision===n.revision&&e.missing.every((g)=>g.name.trim()&&Wt(g.box))&&(y||!l&&e.inventoryConfirmed)}}function wn(n,e){let r={...e.decisions};for(let o of n.components)if(!r[o.id]||r[o.id].revision!==o.revision)r[o.id]={revision:o.revision,action:"approve",feedback:"",split:!1};return{...e,decisions:r}}function yn(n,e){if(!Je(n,e).canSubmit)throw Error("Review is incomplete or stale");return{schemaVersion:1,requestId:n.id,...structuredClone(e)}}function _e(n){let e=n.preview.kind==="page"||n.preview.sourceKind==="page",r=n.preview.sourceKind==="page";return{code:e,captured:r,label:e?n.medium.match(/html|css|svg/i)?n.medium:"HTML / CSS / SVG":"Raster",caption:e?r?n.preview.isolation?"Component only":"Region capture":"Live component":"Produced asset",fileLabel:r?"Open captured preview":"Open source image"}}function $n(n,e,r){let o=n.components.findIndex((a)=>a.id===r);for(let a=1;a<=n.components.length;a++){let l=n.components[(o+a)%n.components.length];if(ve(l,e).kind==="pending")return l.id}}function wt(n,e){if(!e.reviewGroup||!_e(e).code)return[e];return n.components.filter((r)=>r.reviewGroup===e.reviewGroup&&_e(r).code)}function lt(n,e,r,o,a=[]){let l=o?wt(n,r):[r];if(l.length===1)return[r];return l.filter((y)=>ve(y,e).kind==="pending"&&(y.id===r.id||!a.includes(y.id)))}function Mn(n,e,r){let o=new Set;return n.components.flatMap((a)=>{if(o.has(a.id))return[];let l=wt(n,a);l.forEach((h)=>o.add(h.id));let y=l.filter((h)=>ve(h,e,r).kind==="pending"),g=l.filter((h)=>ve(h,e,r).kind==="feedback"),v=y[0]??g[0]??a,M=y.length?"pending":g.length?"feedback":"approved";return[{id:a.id,members:l,representative:v,pending:y.length,kind:M,label:l.length>1?a.reviewGroup.replace(/[-_]+/g," ").replace(/^./,(h)=>h.toUpperCase()):a.name,box:{x:Math.min(...l.map((h)=>h.box.x)),y:Math.min(...l.map((h)=>h.box.y)),w:Math.max(...l.map((h)=>h.box.x+h.box.w))-Math.min(...l.map((h)=>h.box.x)),h:Math.max(...l.map((h)=>h.box.y+h.box.h))-Math.min(...l.map((h)=>h.box.y))},stateLabel:y.length?l.length>1?`${y.length} to review`:ve(v,e,r).label:g.length?l.length>1?`${g.length} ${g.length===1?"needs":"need"} work`:"Feedback ready":"Approved"}]})}function yt(n,e){let r=new Set(e.preview.isolation?.excludedComponents??[]),o=e.box,a=n.components.filter((l)=>{if(l.id===e.id)return!1;if(r.has(l.id))return!0;let y=l.box,g=Math.min(o.x+o.w,y.x+y.w)-Math.max(o.x,y.x),v=Math.min(o.y+o.h,y.y+y.h)-Math.max(o.y,y.y);return y.w*y.h<o.w*o.h&&g*n.comp.width>1&&v*n.comp.height>1});return{description:e.note.trim(),related:a,excluded:a.filter((l)=>r.has(l.id))}}function Vt(n,e,r,o,a){let l=a==="fit"?Math.min(1,r/n,o/e):a;return{scale:l,width:n*l,height:e*l}}function Gt(n,e,r,o){if(r<=0||o<=r)return 0;return Math.max(0,Math.min(1,((n-e)/r-0.08)/0.84))*(o-r)}var En=`
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
`;var zn=`/* VENDORED from impeccable-site/site/styles/kinpaku-tokens.css (the source of truth).
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
`,Sn=`/* VENDORED from impeccable-site/site/styles/kinpaku-kit.css (buttons, tabs, select, icon button, instrument strip, grain, switch, paper strip, thumb) (the source of truth).
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
`,Ln=`/* VENDORED from impeccable-site/site/styles/docs-kinpaku.css (the command rail list: the site's selected-row pattern) (the source of truth).
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
`;var Tn=`/* Local review chrome. Keep the vendored site kit and inspected artwork independent. */
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
`;var Cn=(n)=>n.replace(/^:root\s*\{/gm,":root, :host {"),$t=Cn(zn)+`
`+Cn(Sn)+`
`+Ln+`
`+Tn,Ue='<span class="ks-button-arrow" aria-hidden="true"><svg viewBox="0 0 16 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M0 4h14M10 0l4 4-4 4"/></svg></span>';var Pn=`
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
`+En+`
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
`+$t+`
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
`;var oi={chevronDown:'<path d="m6 9 6 6 6-6"/>',code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',compact:'<path d="M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',hideTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12 3 3 2 3-2"/>',showTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12-4 3-3 3 3"/>',next:'<path d="M5 12h14m-6-6 6 6-6 6"/>',mark:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5M8 12h8m-4-4v8"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',undo:'<path d="M4 10h9a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" transform="translate(0 -2)"/>',external:'<path d="M14 3h7v7m0-7L10 14m0-10H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',zoom:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'};function we(n){return`<svg class="utility-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${oi[n]}</svg>`}var Yt=[{kind:"plate",label:"Illustration / plate",hint:"Painted or drawn artwork"},{kind:"image",label:"Photo / image",hint:"A photograph"},{kind:"texture",label:"Texture",hint:"A surface or material"}];function Et(n){let e=n;return!!e&&e.schemaVersion===3&&e.stage==="components"}function Xt(n){return n.role==="plan"&&(!!n.flags?.length||!!n.codeDrawn)}function _t(n){let e=(r)=>Xt(r)?0:r.role==="asset"?1:2;return n.components.map((r,o)=>({c:r,i:o})).sort((r,o)=>e(r.c)-e(o.c)||r.i-o.i).map((r)=>r.c)}function zt(n){let e=new Set(n.components.map((r)=>r.id));return(n.codeRegions??[]).filter((r)=>!e.has(r.id))}function $e(n,e){let r=e.decisions[n.id];return r?.revision===n.revision?r:void 0}function ye(n,e){let r=$e(n,e);return r?r.action==="approve"?"approved":r.action:"pending"}function St(n,e){return n.reclassify?.find((r)=>r.id===e)}function Jt(n){let e=[n.name,n.note,...(n.flags??[]).map((r)=>r.message)].join(" ");if(/\b(textures?|surfaces?|grain|grainy|brushed|metal(lic)?|steel|brass|copper|paper|linen|canvas|fabric|cloth|wood(en)?|stone|marble|concrete|plaster|leather|noise|pattern(ed)?|weave|patina)\b/i.test(e))return"texture";if(/\b(photo|photos|photograph|photographs|photographic|photography)\b/i.test(e)&&!/\bphotographic shading\b/i.test(e))return"image";return"plate"}function Dn(n){return`Drawn in code (${n.kind})`}function Qt(n){return n.message}function Qe(n,e){let r=n.components.map((b)=>ye(b,e)),o=r.filter((b)=>b==="approved").length,a=r.filter((b)=>b==="revise").length,l=new Set(zt(n).map((b)=>b.id)),y=(e.reclassify??[]).filter((b)=>l.has(b.id)).length,g=r.filter((b)=>b==="reclassify").length+y,v=r.filter((b)=>b==="pending").length,M=e.missing.length,h=a+g+M>0,k=e.packetRevision===n.revision,z=e.missing.every((b)=>b.name.trim()&&Wt(b.box)),f=k&&!h&&v===0;return{total:r.length,approved:o,revise:a,reclassify:g,pending:v,missing:M,hasChanges:h,canApprove:f,mode:h?"changes":"approve",canSubmit:k&&z&&(h||f)}}function Zt(n,e,r,o={}){if(o.split&&!(r==="revise"&&e.role==="asset"))throw Error("Only a generated asset can be split into layers");if(r==="revise"&&e.role!=="asset"&&!(o.feedback??"").trim())throw Error("Revising a plan item needs feedback");if(r==="reclassify"&&e.role!=="plan")throw Error("Only planned code can become an image");let a={revision:e.revision,action:r,feedback:r==="approve"?"":(o.feedback??"").trim(),split:!!o.split};if(r==="reclassify")a.kind=o.kind??Jt(e);return{...n,inventoryConfirmed:!1,decisions:{...n.decisions,[e.id]:a}}}function An(n,e){let r={...n.decisions};return delete r[e],{...n,inventoryConfirmed:!1,decisions:r}}function en(n,e,r){let o=(n.reclassify??[]).filter((a)=>a.id!==e);return{...n,inventoryConfirmed:!1,reclassify:r?[...o,{id:e,kind:r.kind,feedback:(r.feedback??"").trim()}]:o}}function Hn(n,e){let r=Qe(n,e);if(!r.canSubmit)throw Error("Review is incomplete or stale");let o={};for(let y of n.components){let g=$e(y,e);if(g)o[y.id]=structuredClone(g)}let a=new Set(zt(n).map((y)=>y.id)),l=(e.reclassify??[]).filter((y)=>a.has(y.id)).map((y)=>({...y}));return{schemaVersion:1,requestId:n.id,packetRevision:e.packetRevision,decisions:o,missing:structuredClone(e.missing),inventoryConfirmed:r.mode==="approve",...l.length?{reclassify:l}:{}}}function qn(n){return{packetRevision:n.revision,decisions:{},missing:[],inventoryConfirmed:!1,reclassify:[]}}function In(n,e,r,o,a=0.02){let l=Math.max(0,Math.floor((o.x-a)*e)),y=Math.min(e-1,Math.ceil((o.x+o.w+a)*e)),g=Math.max(0,Math.floor((o.y-a)*r)),v=Math.min(r-1,Math.ceil((o.y+o.h+a)*r)),M=Math.floor(o.x*e),h=Math.ceil((o.x+o.w)*e),k=Math.floor(o.y*r),z=Math.ceil((o.y+o.h)*r),f=[],b=Math.max(1,Math.round(Math.max(y-l,v-g)/80));for(let q=g;q<=v;q+=b)for(let I=l;I<=y;I+=b){if(I>=M&&I<h&&q>=k&&q<z)continue;let de=(q*e+I)*4;if(n[de+3]<200)continue;f.push([n[de],n[de+1],n[de+2]])}return f}function Bn(n){if(!n.length)return;let e=(r)=>{let o=n.map((a)=>a[r]).sort((a,l)=>a-l);return o[o.length>>1]};return"#"+[0,1,2].map((r)=>e(r).toString(16).padStart(2,"0")).join("")}function tn(n,e,r,o,a,l=4,y=24){let g=n.w*e,v=n.h*r,M=Math.min(24,Math.max(8,0.04*Math.max(g,v))),h=Math.min(e,g+M*2),k=Math.min(r,v+M*2),z=Math.min(l,o/h,a/k);if(v*z<y&&v>0)z=Math.min(l,y/v,a/k),h=Math.min(h,o/z);let f=(n.x+n.w/2)*e,b=(n.y+n.h/2)*r,q=Math.max(0,Math.min(e-h,f-h/2)),I=Math.max(0,Math.min(r-k,b-k/2));return{scale:z,width:h*z,height:k*z,view:{x:q/e,y:I/r,w:h/e,h:k/r}}}var ri=["no","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"],Mt=(n)=>ri[n]??String(n),Rn=(n)=>n[0].toUpperCase()+n.slice(1);function jn(n,e,r){let o=n.components.filter((l)=>ye(l,e)==="pending").length;if(r&&n.round>1){let l=n.components.filter((g)=>["changed","added"].includes(r.changes[g.id]?.kind??"")||r.feedback?.[g.id]).length,y=n.components.filter((g)=>ye(g,e)==="approved").length;return`The agent worked on your notes for ${Mt(l)} ${l===1?"item":"items"}. ${Rn(Mt(y))} ${y===1?"approval is":"approvals are"} kept.`}let a=Math.max(1,Math.round(o*15/60));return`${Rn(Mt(o))} ${o===1?"thing":"things"} to check before any page code is written. About ${Mt(a)} ${a===1?"minute":"minutes"}.`}var Nn="Frame, view and moving parts as separate pieces, e.g. the shutters.";function nn(n){return n.role==="asset"?n.flags??[]:[]}var on=(n)=>nn(n).some((e)=>e.id==="baked-composite"),rn=(n)=>n?.action==="revise"&&n.split===!0;function Lt(n,e){if(!e)return null;let r=e.feedback?.[n]?void 0:Object.entries(e.feedback??{}).filter(([g,v])=>v.decision.action==="revise"&&v.decision.split&&n.startsWith(`${g}-`)).sort((g,v)=>v[0].length-g[0].length)[0];if(r){let[g,v]=r;return{round:v.round,action:"split",words:(v.decision.feedback??"").trim(),splitFrom:e.packet.components.find((M)=>M.id===g)?.name??g,beforeUrl:void 0,wasCode:!1,wasKind:void 0,wasNote:""}}let o=e.feedback?.[n],a=e.packet.components.find((g)=>g.id===n),l=e.packet.codeRegions?.find((g)=>g.id===n),y=e.changes[n]?.kind;if(!o&&y!=="changed")return null;return{round:o?.round??e.packet.round,action:o?.decision.action,words:(o?.decision.feedback??"").trim(),beforeUrl:a?.role==="asset"?a.preview.url:void 0,wasCode:a?.role==="plan"||!a&&!!l,wasKind:a?.kind??l?.kind,wasNote:a?.note??l?.note??"",splitFrom:void 0}}function On(n,e,r,o,a,l=4,y){let g=n.length,v=Math.max(0,Math.min(r-a,(e-o*(g-1))/n.reduce((z,f)=>z+f,0))),M=Math.max(0,Math.min(e,(r-g*a-o*(g-1))/n.reduce((z,f)=>z+1/f,0)));if(y)v=Math.min(v,y.h*l),M=Math.min(M,y.w*l);let h=n.reduce((z,f)=>z+f*v*v,0),k=n.reduce((z,f)=>z+M*M/f,0);return h>=k?{direction:"row",sizes:n.map((z)=>({w:z*v,h:v}))}:{direction:"column",sizes:n.map((z)=>({w:M,h:M/z}))}}function Fn(n,e,r,o,a,l){return{x:a-n*r*l,y:a-e*o*l}}function Un(n,e,r){return _t(n).map((o)=>({id:o.id,name:o.name,state:ye(o,e),current:o.id===r}))}function Kn(n,e){let r=Qe(n,e);if(r.mode==="approve")return"Approve plan and assets";let o=n.components.filter((y)=>rn($e(y,e))).length,a=r.revise-o;return`Send notes (${[a?`${a} ${a===1?"note":"notes"}`:"",o?`${o} to split`:"",r.reclassify?`${r.reclassify} to become ${r.reclassify===1?"an image":"images"}`:"",r.missing?`${r.missing} missing`:""].filter(Boolean).join(", ")})`}var Wn=$t+`
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
`;var Vn=new Map;function Tt(n){let e=n.querySelector('.ks-instrument-key:is(.is-active, [aria-selected="true"], [aria-pressed="true"])');if(!e){if(n.classList.contains("has-thumb"))n.classList.remove("has-thumb");return}let r=n.getBoundingClientRect(),o=e.getBoundingClientRect();if(!r.width)return;let a=getComputedStyle(n),l=r.width/parseFloat(a.width)||1,y=parseFloat(a.borderLeftWidth)||0,g=Math.round(((o.left-r.left)/l-y+n.scrollLeft)*100)/100,v=Math.round(o.width/l*100)/100,M=n.querySelector(":scope > .ks-thumb"),h=n.dataset.ksStrip;if(!M){M=document.createElement("span"),M.className="ks-thumb",M.setAttribute("aria-hidden","true"),n.appendChild(M);let z=h?Vn.get(h):void 0;if(z&&(z.x!==g||z.w!==v))M.style.transition="none",M.style.width=`${z.w}px`,M.style.transform=`translateX(${z.x}px)`,M.offsetWidth,M.style.transition=""}if(h)Vn.set(h,{x:g,w:v});if(M.style.width!==`${v}px`)M.style.width=`${v}px`;let k=`translateX(${g}px)`;if(M.style.transform!==k)M.style.transform=k;if(!n.classList.contains("has-thumb"))n.classList.add("has-thumb")}function ai(n,e,r){if(n.dataset.thumb)return;n.dataset.thumb="1",Tt(n);let o=new MutationObserver((z)=>{if(z.some((f)=>f.target!==n&&!f.target.classList?.contains("ks-thumb")))Tt(n)});o.observe(n,{subtree:!0,attributes:!0,attributeFilter:["class","aria-selected","aria-pressed"],childList:!0});let a=new ResizeObserver(()=>Tt(n));a.observe(n);let l=null,y=!1,g=0,v=null,M=(z,f)=>e.elementFromPoint(z,f)?.closest(".ks-instrument-key")??null;n.addEventListener("pointerdown",(z)=>{if(!["mouse","pen"].includes(z.pointerType)||!z.isPrimary||z.button!==0||l!==null)return;l=z.pointerId,y=!1,g=z.clientX,v=M(z.clientX,z.clientY)}),n.addEventListener("pointermove",(z)=>{if(z.pointerId!==l)return;if(!y&&Math.abs(z.clientX-g)<6)return;y=!0;let f=M(z.clientX,z.clientY);if(f&&f!==v&&n.contains(f))v=f,f.click()});let h=()=>{l=null,y=!1,v=null},k=(z)=>{if(z.pointerId===l)h()};window.addEventListener("pointerup",k),window.addEventListener("pointercancel",k),window.addEventListener("blur",h),r.push(()=>{o.disconnect(),a.disconnect(),window.removeEventListener("pointerup",k),window.removeEventListener("pointercancel",k),window.removeEventListener("blur",h)})}function Ct(n){let e=[];return n.querySelectorAll(".ks-instrument-strip").forEach((r)=>ai(r,n,e)),document.fonts?.ready.then(()=>n.querySelectorAll(".ks-instrument-strip").forEach(Tt)),()=>e.forEach((r)=>r())}var P=(n)=>n.replace(/[&<>"']/g,(e)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e]),Pt=(n)=>`${n*100}%`,Ke=(n)=>{let e=new URL(n,location.href);if(!["http:","https:"].includes(e.protocol))throw Error("Unsupported preview URL");return P(e.href)},Ze=(n)=>`left:${Pt(n.x)};top:${Pt(n.y)};width:${Pt(n.w)};height:${Pt(n.h)}`,Gn=(n)=>`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${n}</svg>`,Rt={check:Gn('<path d="m3 8.5 3 3 7-7"/>'),alert:Gn('<path d="M8 2 1.5 13.5h13L8 2Z"/><path d="M8 6.5v3.2M8 11.6v.1"/>')},Me=(n)=>`<kbd class="cap">${n}</kbd>`,Be={plate:"illustration",image:"photo",texture:"texture"};function si(n){let e=n.match(/^review is stale:\s*(.+?)\s+changed\b/i);if(e)return`${e[1]} changed after this round was prepared.`;let r=n.replace(/;?\s*prepare a new round\.?\s*$/i,"").trim();return r?`${r[0].toUpperCase()}${r.slice(1)}${/[.!?]$/.test(r)?"":"."}`:""}var Yn={get(n){try{return localStorage.getItem(n)}catch{return null}},set(n,e){try{localStorage.setItem(n,e)}catch{}}};function Xn(n,e,r){let o=n.shadowRoot??n.attachShadow({mode:"open"}),a={...qn(e),...structuredClone(r.initialDraft??{})};a.reclassify??=[];let l=_t(e),y=zt(e),g=r.history??null,v=new URLSearchParams(location.search),M=!!r.completed,h=M?"summary":["intro","stage","summary"].includes(v.get("view")??"")?v.get("view"):"intro",k=(v.get("item")&&l.some((i)=>i.id===v.get("item"))?v.get("item"):void 0)??l.find((i)=>ye(i,a)==="pending")?.id??l[0]?.id,z=null,f=null,b=null,q=!1,I=!1,de=!1,ce={},B=!1,He=!1,Ce="",V=null,ne=()=>V?`<p class="hint undo-line" role="status">${P(V.label)} <button type="button" class="text-action" id="undo">Undo${Me("⌘Z")}</button></p>`:"",ze=Yn.get("impeccable.review.flipHint")==="1",G=null,We=null,pe=new Map,Pe=new Map,Q=null,Se=()=>matchMedia("(prefers-reduced-motion: reduce)").matches,ie=(i)=>e.components.find((s)=>s.id===i),Ne=(i)=>y.find((s)=>s.id===i),O=()=>M||B||!!r.status,me=(i)=>i.w*e.comp.width/(i.h*e.comp.height),oe=new Image;oe.onload=()=>{try{let i=Math.min(1,480/oe.naturalWidth),s=document.createElement("canvas");s.width=Math.max(1,Math.round(oe.naturalWidth*i)),s.height=Math.max(1,Math.round(oe.naturalHeight*i));let p=s.getContext("2d",{willReadFrequently:!0});if(p.drawImage(oe,0,0,s.width,s.height),Q={data:p.getImageData(0,0,s.width,s.height).data,width:s.width,height:s.height},h==="stage")j()}catch{}},oe.src=new URL(e.comp.url,location.href).href;function et(i){if(!Pe.has(i.id)&&Q)Pe.set(i.id,Bn(In(Q.data,Q.width,Q.height,i.box))??"");return Pe.get(i.id)||e.comp.background||"var(--review-media-deep)"}function qe(i,s){if(i.material?.alpha==="transparent")return!0;if(i.material?.alpha==="opaque")return!1;if(pe.has(s))return pe.get(s);if(pe.set(s,!1),!/\.(png|webp)(\?|$)/i.test(s))return!1;let p=new Image;return p.onload=()=>{try{let m=Math.min(1,160/Math.max(p.naturalWidth,p.naturalHeight)),w=document.createElement("canvas");w.width=Math.max(1,Math.round(p.naturalWidth*m)),w.height=Math.max(1,Math.round(p.naturalHeight*m));let u=w.getContext("2d",{willReadFrequently:!0});u.drawImage(p,0,0,w.width,w.height);let c=u.getImageData(0,0,w.width,w.height).data;for(let x=3;x<c.length;x+=4)if(c[x]<250){if(pe.set(s,!0),h==="stage")j();break}}catch{}},p.src=new URL(s,location.href).href,!1}function re(i,s,p="fade"){if(s)k=s;if(z=Se()?null:p,h=i,f=null,de=!1,I=!1,i!=="summary")b=null,q=!1;j();let m=i==="intro"?"start":i==="stage"?"decide-yes":"send";o.getElementById(m)?.focus({preventScroll:!0})}function tt(i){if(h!=="stage"||!l.length)return;let s=l.findIndex((p)=>p.id===k)+i;if(s>=l.length)return re("summary",void 0,"next");if(s<0)return;re("stage",l[s].id,i>0?"next":"prev")}function Ve(i,s){if(V)clearTimeout(V.timer);V={label:i,before:s,view:h,current:k,timer:window.setTimeout(()=>{V=null,o.querySelector(".undo-line")?.classList.add("gone")},6000)}}function Ie(i,s){let p=a;a=i,f=null,Ce="",Ve(s,p)}function Re(){let i=l.findIndex((p)=>p.id===k),s=[...l.slice(i+1),...l.slice(0,i+1)].find((p)=>ye(p,a)==="pending");if(s)re("stage",s.id,"next");else re("summary",void 0,"next")}function pt(){let i=ie(k);if(h!=="stage"||!i||O()||f)return;Ie(Zt(a,i,"approve"),`${i.role==="asset"?"Approved":"Kept in code"}: ${i.name}.`),Re()}function De(i,s,p=!1){if(O())return;let m=s?Ne(s):void 0,w=m?void 0:ie(k),u=w??m;if(!u||w&&i==="reclassify"&&w.role!=="plan")return;let c=w?$e(w,a):void 0,x=m?St(a,m.id):void 0,T=c?.action===i&&!!c.split===p;f={type:i,split:p,id:u.id,region:!!m,text:T?c.feedback:p?Nn:x?.feedback??"",kind:c?.kind??x?.kind??Jt({name:u.name,note:u.note??"",flags:w?.flags})},j(),o.getElementById("form-text")?.focus()}function Ge(){if(!f||O())return;let i=f;if(i.region){let p=Ne(i.id);Ie(en(a,p.id,{kind:i.kind,feedback:i.text}),`${p.name} will become ${Be[i.kind]}.`),j();return}let s=ie(i.id);if(i.type==="revise"&&s.role==="plan"&&!i.text.trim()){o.getElementById("form-text")?.focus();return}Ie(Zt(a,s,i.type,{feedback:i.text,kind:i.kind,split:i.split}),i.split?`Split into layers: ${s.name}.`:i.type==="revise"?`Noted: ${s.name}.`:`${s.name} will become ${Be[i.kind]}.`),Re()}function dt(){if(!V||O())return;let i=V;clearTimeout(i.timer),V=null,a=i.before,re(i.view,i.current,"prev")}async function nt(){let i=Qe(e,a);if(B||M||f||!i.canSubmit||r.status)return;B=!0,Ce="",j();try{await r.onSubmit(Hn(e,a)),M=!0,He=!0,q=!1,V=null}catch(s){Ce=s instanceof Error?s.message:"The review could not be saved."}finally{B=!1,j()}}function H(i){let s=`missing-${crypto.randomUUID()}`;a={...a,inventoryConfirmed:!1,missing:[...a.missing,{id:s,name:"",feedback:"",box:i}]},q=!1,b={type:"missing",id:s},j(),o.getElementById("missing-name")?.focus()}let R=(i)=>{let s=ye(i,a);if(s==="approved")return i.role==="asset"?"Looks good":"Code is fine";if(s==="revise")return rn($e(i,a))?"Split into layers":"Needs work";if(s==="reclassify")return`Becomes ${Be[$e(i,a).kind]}`;return M?"Not decided":"To decide"},D=(i,s="")=>`<span class="pic crop ${s}"><img src="${Ke(e.comp.url)}" alt="" draggable="false" style="width:${100/i.w}%;left:${-100*i.x/i.w}%;top:${-100*i.y/i.h}%"></span>`,F=(i,s,p="gen")=>{let m=qe(i,s),w=ce[i.id]??"comp",u=!m?"":w==="light"?"var(--review-media-raised)":w==="dark"?"var(--ks-instrument)":et(i);return`<span class="pic ${p}" style="${u?`background:${P(u)}`:""}"><img src="${Ke(s)}" alt="" draggable="false"></span>`};function W(i){return[...i.code?y.map((p)=>({kind:"region",id:p.id,name:p.name,box:p.box,cls:`code ${St(a,p.id)?"reclassify":""}`})):[],...e.components.map((p)=>({kind:"item",id:p.id,name:p.name,box:p.box,cls:`is-${p.role} ${Xt(p)||on(p)?"flagged":""} ${ye(p,a)}`})),...a.missing.map((p)=>({kind:"missing",id:p.id,name:p.name||"Missing",box:p.box,cls:"missing"}))].sort((p,m)=>m.box.w*m.box.h-p.box.w*p.box.h).map((p)=>{let m=b?.id===p.id||I&&h==="stage"&&p.id===k,w=`<span class="tag">${P(p.name)}</span>`;return i.interactive?`<button type="button" class="region ${p.cls} ${m?"selected":""} ${p.box.y<0.06?"tag-below":""} ${p.box.x>0.7?"tag-right":""}" style="${Ze(p.box)}" data-${p.kind}="${P(p.id)}" aria-label="${P(p.name)}">${w}</button>`:`<span class="region ${p.cls}" style="${Ze(p.box)}"></span>`}).join("")}function _(){let i=Un(e,a,h==="stage"?k:void 0),s=i.filter((p)=>p.state!=="pending").length;return`<header class="bar">
      <div class="bar-title"><span class="bar-name">${P(e.title)}</span><span class="bar-round">Round ${e.round}</span></div>
      ${l.length?`<nav class="lights ${i.length>20?"dense":""}" aria-label="Progress, ${s} of ${i.length} decided">${i.map((p,m)=>`<button type="button" class="light ${p.state==="pending"?"":"decided"} ${p.current?"current":""}" data-go="${P(p.id)}" aria-label="${P(`${m+1}. ${p.name}: ${R(ie(p.id))}`)}" ${p.current?'aria-current="step"':""}><span class="tip">${P(p.name)}${p.state==="pending"?"":`<span class="tip-state"> · ${P(R(ie(p.id)))}</span>`}</span></button>`).join("")}<button type="button" class="lights-summary ${h==="summary"?"current":""}" id="to-summary">Summary</button></nav>`:""}
      ${h==="stage"?`<button type="button" class="bar-locator" id="open-map-bar" aria-label="Open the comp">${D({x:0,y:0,w:1,h:1})}</button>`:""}
    </header>`}function Ae(){if(r.status)return`<div class="banner stale" role="alert">${Rt.alert}<div><strong>This review is out of date.</strong><p>${P(si(r.status))} Ask the agent to prepare a new round, then reload this page.</p></div><button id="reload" class="ks-button ks-button-secondary">Reload</button></div>`;if(Ce)return`<div class="banner error" role="alert">${Rt.alert}<div><strong>Your decisions were not sent.</strong><p>${P(Ce)}</p></div><button id="retry" class="ks-button ks-button-secondary">Try again</button></div>`;return""}function Z(){let i=!!g&&e.round>1;return`<div class="intro ${z?`enter-${z}`:""}">
      <div class="intro-copy">
        <p class="eyebrow">${i?`Round ${e.round}`:"Before any page code"}</p>
        <h1>${i?"Check what changed.":"Review the plan and assets."}</h1>
        <p class="lead">${P(jn(e,a,g))}</p>
        <dl class="kinds-explained">
          <div><dt><i class="swatch asset"></i>A generated image</dt><dd>Does it match the comp?</dd></div>
          <div><dt><i class="swatch plan"></i>A region drawn in code</dt><dd>Can code do it justice, or should it be an image?</dd></div>
        </dl>
        <button type="button" class="ks-button ks-button-primary" id="start">Start${Me("↵")}${Ue}</button>
      </div>
      <figure class="intro-comp"><div class="map" style="aspect-ratio:${e.comp.width}/${e.comp.height}"><img class="comp" src="${Ke(e.comp.url)}" alt="The approved comp" draggable="false">${W({code:!1,interactive:!1})}</div></figure>
    </div>`}function it(i){let s=Lt(i.id,g),p=me(i.box),m=`${i.box.w*e.comp.width}x${i.box.h*e.comp.height}`;if(i.role==="asset"&&i.preview.url){let w=i.preview.url,u=qe(i,w),c=ce[i.id]??"comp",x=u?`<button type="button" class="ks-switch backdrop-switch" id="backdrop" aria-pressed="${c!=="comp"}" title="Backdrop behind the transparent image"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">${c==="comp"?"On comp colour":c==="light"?"On light":"On dark"}</span></button>`:"",T=`<figure class="fig" data-role="generated"><figcaption><span class="eyebrow">${de?"In the comp":s?.beforeUrl?"After":"Generated"}</span>${x}</figcaption><div class="frame ${de?"flipped":""}">${F(i,w)}${D(i.box,"flip")}</div></figure>`,Y=`<figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${D(i.box)}</div></figure>`;if(s?.beforeUrl){let N=`<figure class="fig"><figcaption><span class="eyebrow">Before · round ${s.round}</span></figcaption><div class="frame">${F(i,s.beforeUrl,"gen before")}</div></figure>`;return`<div class="figures" data-ratios="${p},${p},${p}" data-natural="${m}">${N}${T}${Y}</div>`}return`<div class="figures" data-ratios="${p},${p}" data-natural="${m}">${Y}${T}</div>`}if(i.role==="asset")return'<div class="figures empty"><p>This image has no generated file.</p></div>';return`<div class="figures single" data-box="${P(JSON.stringify(i.box))}"><figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${D(i.box)}<span class="focus-box"></span></div></figure></div>`}function Dt(i){if(M)return`<div class="decide-bar"><p class="record">${P(R(i))}${$e(i,a)?.feedback?`: “${P($e(i,a).feedback)}”`:"."}</p></div>`;if(f&&!f.region){let m=f.type==="reclassify",w=!m&&i.role==="plan",u=!!f.split;return`<form class="decide-bar form" id="decision-form">
        ${m?`<div class="form-row"><span class="eyebrow" id="kinds-label">Make it</span><div class="ks-instrument-strip is-paper" data-ks-strip="kind" role="group" aria-labelledby="kinds-label">${Yt.map((c)=>`<button type="button" class="ks-instrument-key" data-kind="${c.kind}" aria-pressed="${f.kind===c.kind}">${c.label}</button>`).join("")}</div></div>`:""}
        <label class="field"><span class="eyebrow">${m?"Anything the image should keep? Optional":u?"How should it come apart? Edit or keep":w?"What should change?":"What needs to change? Optional"}</span><textarea id="form-text" rows="2" placeholder="${m?"For example: keep the brushed direction horizontal.":w?"For example: extend the hero photo under the nav.":"For example: the figure should face the sea."}">${P(f.text)}</textarea></label>
        <div class="form-actions"><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel${Me("Esc")}</button><button type="submit" class="ks-button ks-button-primary">${m?"Make it an image":u?"Split into layers":"Save note"}${Me("⌘↵")}</button></div>
      </form>`}let s=$e(i,a),p=i.role==="asset";return`<div class="decide-bar">
      ${s?`<p class="current-decision">${s.action==="approve"?Rt.check:""}<span>${P(R(i))}${s.feedback?`: “${P(s.feedback)}”`:"."}</span><button type="button" class="text-action" id="decision-clear">Clear</button></p>`:""}
      <div class="decisions">
        <button type="button" id="decide-yes" class="ks-button ks-button-primary">${p?"Looks good":"Code is fine"}${Me("A")}</button>
        <button type="button" id="decide-no" class="ks-button ks-button-secondary">${p?"Needs work":"Make it an image"}${Me("N")}</button>
        ${p?`<button type="button" id="decide-split" class="ks-button ${on(i)?"ks-button-secondary":"ks-button-ghost"}">Split into layers${Me("S")}</button>`:`<button type="button" id="decide-other" class="ks-button ks-button-ghost">Something else…${Me("F")}</button>`}
      </div>
    </div>`}function At(){let i=ie(k);if(!i)return'<div class="stage"><p>Nothing to review.</p></div>';let s=l.findIndex((c)=>c.id===i.id)+1,p=Lt(i.id,g),m=i.role==="plan"?[...(i.flags??[]).map(Qt),...i.codeDrawn?["The plan draws this artwork in code."]:[]]:nn(i).map(Qt),w=(i.note??"").trim(),u=i.role==="plan"?`<p class="sentence"><strong>Will be drawn in code:</strong> ${P(w||Dn(i).toLowerCase())}</p>`:p?.wasCode?`<p class="sentence"><s>Was going to be drawn in code: ${P(p.wasNote)}</s> Now a generated ${P(Be[i.kind]??i.kind)}.</p>`:w?`<p class="sentence muted">${P(w)}</p>`:"";return`<div class="stage ${i.role==="plan"?"is-single":""} ${z?`enter-${z}`:""}">
      <div class="stage-head">
        <p class="eyebrow">${i.role==="asset"?`Generated ${P(Be[i.kind]??i.kind)}`:`Drawn in code · ${P(i.kind)}`} · ${s} of ${l.length}</p>
        <h1>${P(i.name)}</h1>
        ${p?.splitFrom?`<blockquote class="asked"><span class="eyebrow">A layer of ${P(p.splitFrom)} · you asked to split it in round ${p.round}</span>${p.words?`<p>“${P(p.words)}”</p>`:""}</blockquote>`:p?.words?`<blockquote class="asked"><span class="eyebrow">You asked in round ${p.round}</span><p>“${P(p.words)}”</p></blockquote>`:""}
      </div>
      ${it(i)}
      <div class="stage-foot">
        ${u}
        ${m.map((c)=>`<p class="flag">${P(c)}</p>`).join("")}
        ${V?ne():i.role==="asset"&&!ze&&!M?`<p class="hint">Hold ${Me("Space")} to flip to the comp. Hover to magnify both.</p>`:""}
      </div>
      <button type="button" class="locator" id="open-map" aria-label="Open the comp"><span class="locator-map" style="aspect-ratio:${e.comp.width}/${e.comp.height}"><img src="${Ke(e.comp.url)}" alt="" draggable="false"><span class="locator-box" style="${Ze(i.box)}"></span></span><span class="locator-label">Comp ${Me("C")}</span></button>
    </div>
    ${Dt(i)}`}function Ht(){if(b?.type==="missing"){let i=a.missing.find((s)=>s.id===b.id);if(!i)return"";return`<div class="side-panel"><p class="eyebrow missing">Missing from the review</p>
        <label class="field"><span class="eyebrow">Name</span><input id="missing-name" value="${P(i.name)}" placeholder="For example: harbour boat" ${O()?"disabled":""}></label>
        <label class="field"><span class="eyebrow">What is missing? Optional</span><textarea id="missing-feedback" rows="2" ${O()?"disabled":""}>${P(i.feedback)}</textarea></label>
        <div class="form-actions start"><button type="button" id="panel-done" class="ks-button ks-button-secondary">Done</button>${O()?"":'<button type="button" id="missing-remove" class="ks-button ks-button-ghost">Remove</button>'}</div></div>`}if(b?.type==="region"){let i=Ne(b.id);if(!i)return"";let s=St(a,i.id),p=f?.region&&f.id===i.id;return`<div class="side-panel"><p class="eyebrow">Set in code · ${P(i.kind)}</p><h3>${P(i.name)}</h3>
        <div class="panel-crop" style="aspect-ratio:${Math.max(0.5,Math.min(6,me(i.box)))}">${D(i.box)}</div>
        ${p?`<form id="decision-form" class="panel-form"><div class="ks-instrument-strip is-paper" data-ks-strip="region-kind" role="group" aria-label="Make it">${Yt.map((m)=>`<button type="button" class="ks-instrument-key" data-kind="${m.kind}" aria-pressed="${f.kind===m.kind}">${Be[m.kind][0].toUpperCase()+Be[m.kind].slice(1)}</button>`).join("")}</div><textarea id="form-text" rows="2" placeholder="Anything the image should keep? Optional">${P(f.text)}</textarea><div class="form-actions start"><button type="submit" class="ks-button ks-button-primary">Make it an image</button><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel</button></div></form>`:s?`<p class="current-decision"><span>Becomes ${P(Be[s.kind])}${s.feedback?`: “${P(s.feedback)}”`:"."}</span>${O()?"":'<button type="button" class="text-action" id="region-keep">Keep in code</button>'}</p>`:`<p class="muted">Checked in the first-viewport review, once the page is built.</p><div class="form-actions start">${O()?"":'<button type="button" class="ks-button ks-button-secondary" id="region-image">Make it an image</button>'}<button type="button" id="panel-done" class="ks-button ks-button-ghost">Close</button></div>`}
      </div>`}return`<div class="side-panel quiet"><p>Every outlined region above was on your list. Hover the comp to see what is set in code; click a region to make it an image.</p>${O()?"":`<button type="button" class="ks-button ks-button-secondary" id="mark" aria-pressed="${q}">${q?"Cancel marking":"Mark missing"}</button>`}${q?'<p class="marking-hint">Drag on the comp around what is missing.</p>':""}${a.missing.length?`<ul class="missing-list">${a.missing.map((i)=>`<li><button type="button" class="text-action" data-missing="${P(i.id)}">${P(i.name||"Unnamed missing piece")}</button></li>`).join("")}</ul>`:""}</div>`}function ct(){let i=Qe(e,a),s=r.status?"This round can no longer be sent.":i.pending&&!i.hasChanges?`${i.pending} still to decide.`:i.mode==="approve"?"Approval confirms nothing is missing from the comp.":`${i.pending?`${i.pending} undecided stay open. `:""}The agent applies your notes and opens a new round.`,p=(m)=>{let w=$e(m,a),u=ye(m,a),c;if(m.role==="asset"&&m.preview.url){let x=me(m.box);c=`<span class="card-pic" style="aspect-ratio:${x};width:min(100%, ${Math.round(118*x)}px)">${F(m,m.preview.url)}</span>`}else{let x=tn(m.box,e.comp.width,e.comp.height,220,118),T=x.view;c=`<span class="card-pic" style="width:${Math.floor(x.width)}px;height:${Math.floor(x.height)}px"><span class="pic crop"><img src="${Ke(e.comp.url)}" alt="" draggable="false" style="width:${100/T.w}%;left:${-100*T.x/T.w}%;top:${-100*T.y/T.h}%"></span><span class="focus-box" style="${Ze({x:(m.box.x-T.x)/T.w,y:(m.box.y-T.y)/T.h,w:m.box.w/T.w,h:m.box.h/T.h})}"></span></span>`}return`<button type="button" class="card ${u}" data-go="${P(m.id)}"><span class="card-thumb">${c}</span><span class="card-text"><span class="card-name">${P(m.name)}</span><span class="card-state">${u==="approved"?Rt.check:""}${P(R(m))}</span>${w?.feedback?`<span class="card-note">“${P(w.feedback)}”</span>`:""}</span></button>`};return`<div class="summary ${z?`enter-${z}`:""}">
      <div class="summary-head">
        <p class="eyebrow">${M?`Round ${e.round} · sent`:"Summary"}</p>
        <h1>${M?i.hasChanges?"Notes sent.":"Plan and assets approved.":i.pending?"Almost there.":"Your decisions."}</h1>
        ${M?`<p class="lead">${i.hasChanges?"The agent applies them and opens a new round for anything that changed.":"The agent continues to the first viewport."}${He?"":" This round is read-only."}</p>`:""}
      </div>
      <div class="sheet">${l.map(p).join("")}</div>
      <section class="coverage" aria-label="Coverage">
        <h2>Anything on the comp we didn't cover?</h2>
        <div class="coverage-grid">
          <div class="map-space"><div class="map ${q?"marking":""} ${b?"has-selection":""}" id="summary-map" style="aspect-ratio:${e.comp.width}/${e.comp.height}"><img class="comp" src="${Ke(e.comp.url)}" alt="The approved comp" draggable="false">${W({code:!0,interactive:!0})}<div class="draw-box" hidden></div></div></div>
          ${Ht()}
        </div>
      </section>
    </div>
    ${M?"":`<div class="send-row"><div class="send-inner">${V?ne():`<p>${P(s)}</p>`}<button type="button" class="ks-button ks-button-primary" id="send" ${!i.canSubmit||!!f||B||!!r.status?"disabled":""}>${B?"Sending…":P(Kn(e,a))}${B?"":Ue}</button></div></div>`}`}function mt(){if(!I)return"";return`<div class="overlay" role="dialog" aria-modal="true" aria-label="The comp"><div class="overlay-head"><span class="eyebrow">The comp · click a region to go to it</span><button type="button" class="ks-button ks-button-ghost" id="close-map">Close${Me("Esc")}</button></div>
      <div class="overlay-body"><div class="map has-selection" id="overlay-map" style="aspect-ratio:${e.comp.width}/${e.comp.height}"><img class="comp" src="${Ke(e.comp.url)}" alt="The approved comp" draggable="false">${W({code:!0,interactive:!0})}</div></div></div>`}function j(){G?.disconnect(),We?.();let s=o.activeElement?.id,p=h==="summary"?o.querySelector(".view-summary .screen")?.scrollTop??0:0;o.innerHTML=`<style>${Wn}</style><section class="rv view-${h} ${M?"is-submitted":""}" aria-label="Plan and asset review">
      ${_()}${Ae()}
      <main class="screen">${h==="intro"?Z():h==="stage"?At():ct()}</main>
      ${mt()}
    </section>`,z=null;let m=o.querySelector(".screen");if(m&&p)m.scrollTop=p;if(s)o.getElementById(s)?.focus({preventScroll:!0});if(ue(),ut(),G=new ResizeObserver(ut),G.observe(o.querySelector(".screen")),We=Ct(o),!M)r.onDraftChange?.(structuredClone(a))}function ut(){let i=matchMedia("(max-width: 760px)").matches,s=o.querySelector(".figures[data-ratios]");if(s&&s.clientWidth){let m=s.dataset.ratios.split(",").map(Number),[w,u]=(s.dataset.natural??"0x0").split("x").map(Number),c=i?{direction:"column",sizes:m.map((x)=>({w:Math.min(s.clientWidth,360*x),h:Math.min(s.clientWidth,360*x)/x}))}:On(m,s.clientWidth,s.clientHeight,28,30,4,{w,h:u});s.dataset.direction=c.direction,s.querySelectorAll(":scope > .fig > .frame").forEach((x,T)=>{x.style.width=`${Math.floor(c.sizes[T].w)}px`,x.style.height=`${Math.floor(c.sizes[T].h)}px`}),J(s)}let p=o.querySelector(".figures.single");if(p?.clientWidth){let m=JSON.parse(p.dataset.box),w=p.closest(".stage"),u=w.clientHeight-36-28-(w.querySelector(".stage-head")?.offsetHeight??0)-(w.querySelector(".stage-foot")?.offsetHeight??0)-30-80,c=tn(m,e.comp.width,e.comp.height,Math.min(p.clientWidth,1120),i?320:Math.max(80,u)),x=p.querySelector(".frame"),T=x.querySelector("img"),Y=x.querySelector(".focus-box"),N=c.view;x.style.width=`${Math.floor(c.width)}px`,x.style.height=`${Math.floor(c.height)}px`,T.style.cssText=`width:${100/N.w}%;left:${-100*N.x/N.w}%;top:${-100*N.y/N.h}%`,Y.style.cssText=Ze({x:(m.x-N.x)/N.w,y:(m.y-N.y)/N.h,w:m.w/N.w,h:m.h/N.h}),J(p)}for(let m of o.querySelectorAll(".overlay-body .map, .intro-comp .map")){let w=m.parentElement,u=getComputedStyle(w),c=w.clientWidth-parseFloat(u.paddingLeft)-parseFloat(u.paddingRight),x=w.clientHeight-parseFloat(u.paddingTop)-parseFloat(u.paddingBottom);if(!c||!x)continue;let T=Math.min(c/e.comp.width,x/e.comp.height);m.style.width=`${e.comp.width*T}px`,m.style.height=`${e.comp.height*T}px`}}let A=78,X=3;function J(i){i.querySelectorAll(".frame").forEach((s)=>{s.querySelector(".lens")?.remove();let p=document.createElement("span");p.className="lens",p.setAttribute("aria-hidden","true");let m=document.createElement("span");m.className="lens-inner",m.style.width=`${s.clientWidth}px`,m.style.height=`${s.clientHeight}px`,s.querySelectorAll(":scope > .pic, :scope > .focus-box").forEach((w)=>m.append(w.cloneNode(!0))),p.append(m),s.append(p)})}function ae(i,s){o.querySelectorAll(".figures .frame").forEach((p)=>{let m=p.querySelector(".lens"),w=m?.querySelector(".lens-inner");if(!m||!w)return;let{clientWidth:u,clientHeight:c}=p;m.style.transform=`translate(${i*u-A}px, ${s*c-A}px)`;let x=Fn(i,s,u,c,A,X);w.style.transform=`translate(${x.x}px, ${x.y}px) scale(${X})`})}function ue(){let i=(u,c)=>o.getElementById(u)?.addEventListener("click",c);i("start",()=>{let u=l.find((c)=>ye(c,a)==="pending")??l[0];if(u)re("stage",u.id,"next");else re("summary")}),o.querySelectorAll("[data-go]").forEach((u)=>u.addEventListener("click",()=>{let c=u.dataset.go,x=l.findIndex((T)=>T.id===k);re("stage",c,h!=="stage"?"fade":l.findIndex((T)=>T.id===c)>=x?"next":"prev")})),i("to-summary",()=>re("summary",void 0,"next")),i("decide-yes",pt),i("decide-no",()=>De(ie(k)?.role==="asset"?"revise":"reclassify")),i("decide-other",()=>De("revise")),i("decide-split",()=>De("revise",void 0,!0)),i("decision-clear",()=>{let u=ie(k);if(u&&!O())Ie(An(a,u.id),`Cleared: ${u.name}.`),j()}),i("form-cancel",()=>{f=null,j()}),o.getElementById("decision-form")?.addEventListener("submit",(u)=>{u.preventDefault(),Ge()}),o.getElementById("form-text")?.addEventListener("input",(u)=>{if(f)f.text=u.target.value}),o.querySelectorAll("[data-kind]").forEach((u)=>u.addEventListener("click",()=>{if(!f)return;f.kind=u.dataset.kind,o.querySelectorAll("[data-kind]").forEach((c)=>c.setAttribute("aria-pressed",String(c===u)))})),i("backdrop",()=>{let u=ie(k);if(!u)return;let c=["comp","light","dark"];ce[u.id]=c[(c.indexOf(ce[u.id]??"comp")+1)%3],j()}),i("undo",dt),i("send",()=>void nt()),i("retry",()=>void nt()),i("reload",()=>location.reload());let s=()=>{I=!0,j(),o.getElementById("close-map")?.focus()};if(i("open-map",s),i("open-map-bar",s),i("close-map",()=>{I=!1,j()}),i("mark",()=>{if(O())return;q=!q,b=null,f=null,j()}),i("panel-done",()=>{b=null,f=null,j()}),i("region-image",()=>{if(b?.type==="region")De("reclassify",b.id)}),i("region-keep",()=>{let u=b?.type==="region"?Ne(b.id):void 0;if(u&&!O())Ie(en(a,u.id,null),`${u.name} stays in code.`),j()}),i("missing-remove",()=>{if(b?.type!=="missing")return;let u=b.id;a={...a,missing:a.missing.filter((c)=>c.id!==u)},b=null,j()}),o.getElementById("missing-name")?.addEventListener("input",(u)=>{let c=a.missing.find((x)=>x.id===b?.id);if(c){c.name=u.target.value;let x=o.getElementById("send");if(x)x.disabled=!Qe(e,a).canSubmit||B||!!r.status;r.onDraftChange?.(structuredClone(a))}}),o.getElementById("missing-feedback")?.addEventListener("input",(u)=>{let c=a.missing.find((x)=>x.id===b?.id);if(c)c.feedback=u.target.value,r.onDraftChange?.(structuredClone(a))}),O())o.querySelectorAll("#decide-yes,#decide-no,#decide-other,#decide-split,#decision-clear,#mark,#region-image").forEach((u)=>u.disabled=!0);o.querySelectorAll(".map [data-item]").forEach((u)=>u.addEventListener("click",()=>{if(!q)re("stage",u.dataset.item,"fade")}));let p=(u)=>{if(q)return;if(b=u,f=null,h!=="summary")h="summary",I=!1,z=Se()?null:"fade";j(),o.querySelector(".coverage")?.scrollIntoView({block:"start"})};o.querySelectorAll("[data-region]").forEach((u)=>u.addEventListener("click",()=>p({type:"region",id:u.dataset.region}))),o.querySelectorAll("[data-missing]").forEach((u)=>u.addEventListener("click",()=>p({type:"missing",id:u.dataset.missing})));let m=o.querySelector(".figures");m?.querySelectorAll(":scope > .fig > .frame").forEach((u)=>{u.addEventListener("pointerenter",(c)=>{if(c.pointerType==="mouse")m.classList.add("looking")}),u.addEventListener("pointerleave",()=>m.classList.remove("looking")),u.addEventListener("pointermove",(c)=>{let x=u.getBoundingClientRect();ae((c.clientX-x.left)/x.width,(c.clientY-x.top)/x.height)})});let w=o.getElementById("summary-map");if(w){let u=(T)=>{let Y=w.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(T.clientX-Y.left)/Y.width)),y:Math.max(0,Math.min(1,(T.clientY-Y.top)/Y.height))}},c=null,x=null;w.addEventListener("pointerdown",(T)=>{if(!q)return;c=u(T),x=null,w.setPointerCapture(T.pointerId),T.preventDefault()}),w.addEventListener("pointermove",(T)=>{if(!c)return;let Y=u(T);x={x:Math.min(c.x,Y.x),y:Math.min(c.y,Y.y),w:Math.abs(Y.x-c.x),h:Math.abs(Y.y-c.y)};let N=o.querySelector(".draw-box");N.hidden=!1,N.style.cssText=Ze(x)}),w.addEventListener("pointerup",()=>{if(x&&x.w>0.01&&x.h>0.01)H(x);c=null,x=null}),w.addEventListener("pointercancel",()=>{c=null,x=null,j()})}}function Oe(i){if(de===i)return;de=i,o.querySelectorAll('[data-role="generated"] .frame').forEach((p)=>p.classList.toggle("flipped",i));let s=o.querySelector('[data-role="generated"] figcaption .eyebrow');if(s)s.textContent=i?"In the comp":Lt(k??"",g)?.beforeUrl?"After":"Generated";if(i&&!ze)ze=!0,Yn.set("impeccable.review.flipHint","1"),o.querySelector(".hint")?.classList.add("gone")}let ot=(i)=>{let s=i;if(!n.isConnected||s.defaultPrevented)return;let p=s.composedPath()[0],m=p instanceof HTMLTextAreaElement||p instanceof HTMLInputElement;if(s.key==="Escape"){if(I)s.preventDefault(),I=!1,j();else if(f)s.preventDefault(),f=null,j();else if(q)s.preventDefault(),q=!1,j();else if(b)s.preventDefault(),b=null,j();return}if(s.key==="Enter"&&(s.metaKey||s.ctrlKey)&&f){s.preventDefault(),Ge();return}if(m||s.altKey||s.isComposing)return;if((s.metaKey||s.ctrlKey)&&s.key.toLowerCase()==="z"){if(V)s.preventDefault(),dt();return}if(s.metaKey||s.ctrlKey)return;if(h==="intro"&&s.key==="Enter"&&p?.tagName!=="BUTTON"){s.preventDefault(),o.getElementById("start")?.click();return}if(I||f)return;let w=s.key.toLowerCase();if(s.key===" "&&h==="stage"&&ie(k)?.role==="asset"&&p?.tagName!=="BUTTON"&&p?.tagName!=="A"){if(s.preventDefault(),!s.repeat)Oe(!0);return}if(s.key===" "&&h==="stage"&&ie(k)?.role==="asset"){if(s.preventDefault(),!s.repeat)Oe(!0);return}if(w==="c"&&h!=="intro"){s.preventDefault(),I=!0,j();return}if(h!=="stage"||O()){if(h==="summary"&&(w==="k"||s.key==="ArrowLeft")&&l.length&&!O())s.preventDefault(),re("stage",l[l.length-1].id,"prev");return}if(w==="a")s.preventDefault(),pt();else if(w==="n")s.preventDefault(),o.getElementById("decide-no")?.click();else if(w==="f"&&ie(k)?.role==="plan")s.preventDefault(),De("revise");else if(w==="s"&&ie(k)?.role==="asset")s.preventDefault(),De("revise",void 0,!0);else if(w==="j"||s.key==="ArrowRight")s.preventDefault(),tt(1);else if(w==="k"||s.key==="ArrowLeft")s.preventDefault(),tt(-1)},rt=(i)=>{if(i.key===" "&&de)i.preventDefault(),Oe(!1)},he=()=>Oe(!1);return document.addEventListener("keydown",ot),document.addEventListener("keyup",rt),window.addEventListener("blur",he),j(),{destroy(){G?.disconnect(),We?.(),document.removeEventListener("keydown",ot),document.removeEventListener("keyup",rt),window.removeEventListener("blur",he),o.replaceChildren()},getDraft(){return structuredClone(a)}}}var S=(n)=>n.replace(/[&<>"']/g,(e)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e]),je=(n)=>`${n*100}%`,Ee=(n)=>{let e=new URL(n,location.href);if(!["http:","https:"].includes(e.protocol))throw Error("Unsupported preview URL");return S(e.href)};function _n(n,e,r){if(Et(e))return Xn(n,e,{...r,history:r.history,initialDraft:r.initialDraft,onDraftChange:r.onDraftChange,onSubmit:r.onSubmit});let o=n.attachShadow({mode:"open"}),a=structuredClone(r.initialDraft??kn(e)),l=e.stage==="hero"&&e.components.length===1&&!a.missing.length,y=()=>[...e.components].sort((R,D)=>ve(R,a,r.history).priority-ve(D,a,r.history).priority),g=y().find((R)=>ve(R,a,r.history).kind!=="approved")?.id??e.components[0]?.id,v=Je(e,a).pending?"pending":"reviewed",M=!1,h=!1,k=r.completed??!1,z="",f={},b=!!r.completed||!Je(e,a).pending,q=null,I=!0,de=/Mac|iPhone|iPad/.test(navigator.platform)?"⌘Enter":"Ctrl+Enter",ce=!1,B=!1,He=!1,Ce=null,V=!1,ne=!0,ze=!1,G="comp",We=G,pe="fit",Pe="checker",Q=!1,Se="isolated",ie,Ne="fit",O=null,me=null,oe=null,et=null,qe='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>',re='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11 1 2 2-1 7-7-3-3-7 7v2Z"/></svg>',tt=(R,D)=>{if(R.stage==="hero")return"";let F=yt(R,D);if(!F.related.length)return"";let W=F.related.map((_)=>S(_.name)).join(" · ");return`<div class="review-scope" aria-label="Review scope"><p><strong>Reviewing</strong> ${S(F.description||D.name)}</p><p class="separate-reviews"><strong>Outlined · reviewed separately</strong> ${W}</p>${F.excluded.length?`<p class="scope-excluded">Hidden in this preview: ${F.excluded.map((_)=>S(_.name)).join(" · ")}</p>`:""}</div>`},Ve=(R)=>`left:${je(R.x)};top:${je(R.y)};width:${je(R.w)};height:${je(R.h)}`,Ie=(R,D)=>R.stage==="hero"?"":yt(R,D).related.map((F)=>{let W=D.box,_=F.box,Ae=Math.max(W.x,_.x),Z=Math.max(W.y,_.y),it={x:(Ae-W.x)/W.w,y:(Z-W.y)/W.h,w:Math.max(0,Math.min(W.x+W.w,_.x+_.w)-Ae)/W.w,h:Math.max(0,Math.min(W.y+W.h,_.y+_.h)-Z)/W.h};return`<span class="reference-layer" style="${Ve(it)}" title="Reviewed separately: ${S(F.name)}" aria-label="Reviewed separately: ${S(F.name)}"><span>${S(F.name)}</span></span>`}).join("");function Re(R){o.getElementById(R)?.focus({preventScroll:!0})}function pt(R){let D=$n(e,a,R);if(b=!D,D)g=D;G="component",Q=!1,ce=!1,pe="fit",Se="isolated",I=!0,v=b?"reviewed":"pending";let F=()=>{H(),Re(b?"review-summary":f[g]?"feedback":"approve")};if(b&&B&&Ce)Ce(F);else F()}async function De(){if(h||k||Q||Object.keys(f).length)return;h=!0,z="",H();try{await r.onSubmit(yn(e,a)),k=!0,b=!0,M=!1,v="reviewed"}catch(R){z=R instanceof Error?R.message:"Could not save. Try again."}finally{h=!1,H()}}function Ge(R){if(h||k||Q||He)return;let D=e.components.find((Z)=>Z.id===g);if(!D||!lt(e,a,D,I,Object.keys(f)).length)return;let F=a.decisions[D.id],W=F?.revision===D.revision?F:void 0,_=lt(e,a,D,I,Object.keys(f));q={id:D.id,name:_.length>1?`${D.reviewGroup} · ${_.length} instances`:D.name,action:R,previous:Object.fromEntries(_.map((Z)=>[Z.id,a.decisions[Z.id]?{...a.decisions[Z.id]}:void 0]))};let Ae=f[D.id]??W;for(let Z of _)a.decisions[Z.id]={revision:Z.revision,action:R,feedback:R==="revise"?Ae?.feedback??"":"",split:R==="revise"&&(Ae?.split??!1)};if(delete f[D.id],ze)ne=!0,ze=!1;if(l)a.inventoryConfirmed=R==="approve",q=null,De();else pt(D.id)}function dt(){if(h||k||Q||He)return;let R=e.components.find((W)=>W.id===g);if(!R||!lt(e,a,R,I,Object.keys(f)).length)return;let D=a.decisions[R.id],F=D?.revision===R.revision?D:void 0;if(f[R.id]??={feedback:F?.feedback??"",split:F?.split??!1},ne&&(o.querySelector(".workbench")?.clientHeight??0)<420)ze=!0,ne=!1;b=!1,H(),Re("feedback")}function nt(R){let D=`missing-${crypto.randomUUID()}`;a.missing.push({id:D,name:"Missing component",feedback:"",box:R}),a.inventoryConfirmed=!1,b=!1,g=D,G="component",M=!1,O=null,me=null,H(),o.querySelector("#missing-name")?.focus()}function H(){if(oe?.disconnect(),et?.(),k||b&&!l)B=!1;let R=o.activeElement,D=R?.id,F=R?.dataset.select,{scrollX:W,scrollY:_}=window,Ae=o.querySelector(".inventory")?.scrollLeft??0,Z=ie===g,it=G==="component"&&(!Z||We!==G);We=G;let Dt=Z?o.querySelector(".inspection-content")?.scrollTop??0:0,At=Z&&(o.querySelector(".changed-files")?.open??!1),Ht=o.querySelector(".comparison-slot")?.clientHeight??200,ct=o.querySelector(".pan-viewport"),mt=ie===g&&Ne===pe,j=mt?ct?.scrollLeft??0:0,ut=mt?ct?.scrollTop??0:0;ie=g,Ne=pe;let A=e.components.find((t)=>t.id===g),X=a.missing.find((t)=>t.id===g),J=Mn(e,a,r.history),ae=J.find((t)=>t.members.some((d)=>d.id===g)),ue=!!ae&&ae.members.length>1&&I,Oe=ue?ae.box:A?.box??X?.box,ot=ae?J.indexOf(ae)+1:J.length+a.missing.findIndex((t)=>t.id===g)+1,rt=A?a.decisions[A.id]:void 0,he=rt?.revision===A?.revision?rt:void 0,i=A?f[A.id]:void 0,s=Object.keys(f).length>0,p=A?wt(e,A):[],m=A?lt(e,a,A,I,Object.keys(f)):[],w=A?!e.components.some((t)=>!m.some((d)=>d.id===t.id)&&ve(t,a).kind==="pending"):!1,u=q&&!k?`<div class="decision-notice"><span role="status">${S(q.name)} ${q.action==="approve"?"approved":"flagged for repair"}.</span><button id="undo-decision" class="text-action">Undo</button></div>`:"",c=Je(e,a),x=r.history,T=A?kt(A.id,x):void 0,Y=x?.packet.components.find((t)=>t.id===A?.id),N=Q&&!!Y,L=N?Y:A,le=N?x.packet:e,an=Object.values(x?.changes??{}),sn=an.filter((t)=>t.kind==="changed").length,ln=an.filter((t)=>t.kind==="added").length,qt=e.components.filter((t)=>ve(t,a,x).kind==="approved"&&kt(t.id,x).carried).length,It=(t)=>{let d=ve(t,a,x);return k&&d.kind==="feedback"?{...d,label:"Changes requested"}:d},at=J.filter((t)=>t.kind==="pending").length,Jn=J.length-at+a.missing.length,pn=J.filter((t)=>v==="all"||t.kind==="pending"===(v==="pending")).map((t)=>t.representative),Qn=(t)=>J.find((d)=>d.members.some((E)=>E.id===t))?.label??t,Zn=[c.revisions+a.missing.length?`${c.revisions+a.missing.length} feedback ready`:"",qt?`${qt} ${qt===1?"approval":"approvals"} kept`:"",sn?`${sn} changed`:"",ln?`${ln} added`:"",x?.removed.length?`${x.removed.length} removed`:""].filter(Boolean).join(" · "),ei=z||(s?"Save or cancel your open feedback before sending.":k?r.preview?"Preview submitted. No run changed.":"Review submitted.":c.hasFeedback?"Ready to send for corrections.":c.pending?`${at} left to review`:!a.inventoryConfirmed?"Confirm the map is complete.":"Ready to continue."),Le=L?_e(L):null,Bt=L?.preview.kind==="image"&&!Le?.code,jt=Bt||L?.material?.alpha==="transparent",be=!!(L?.context&&Se==="context"),dn=L&&(be?L.context?.kind!=="image":L.preview.kind==="page"),Nt=be&&L?.context?L.context.url:L?.preview.url,cn=L?yt(le,L):null,ti=Le?.code?`${Le.label} · ${Le.captured?"captured from code":"live preview"}`:L?.material?`${L.material.alpha==="transparent"?"Transparent":L.material.alpha==="opaque"?"Opaque":"Transparency unverified"} ${L.material.format}`:"Raster · transparency unverified";o.innerHTML=`<style>${Pn}</style><section class="review ${l?"assembled-review":""}" aria-label="${l?"Assembled page review":"Component review"}" style="--comp-background:${/^#[0-9a-f]{6}$/i.test(e.comp.background??"")?e.comp.background:"#eeeeee"}">
      <header><div><h1>${k?"Review record.":l?"Review the assembled page.":"Review the components."}</h1><p>${S(e.title)} <span>· Round ${e.round}</span></p></div>${k?'<span class="badge">Submitted · read-only</span>':r.preview?'<span class="badge">Interactive preview</span>':""}</header>
      ${r.preview?'<p class="preview-note">Historical hotel artwork for testing this interface. Decisions stay in this preview; no run is changed.</p>':""}
      ${x&&!l?`<section class="round-summary" aria-label="Changes since previous round"><p><strong>${at} ${at===1?"item":"items"} to review</strong><span>${Zn}</span></p>${c.pending?`<button id="review-changes" class="ks-icon-button" aria-label="Next to review" title="Next to review">${we("next")}</button>`:""}${x.removed.length?`<details><summary>Removed from the map</summary><p>${x.removed.map((t)=>S(t.name)).join(" · ")}. Confirm these omissions are intentional before accepting the map.</p></details>`:""}</section>`:""}
      ${!l?`<div class="mobile-panes"><div class="ks-instrument-strip is-paper" data-ks-strip="pane" role="group" aria-label="Inspection view"><button type="button" class="ks-instrument-key" id="show-comp" aria-pressed="${G==="comp"}">Approved comp</button><button type="button" class="ks-instrument-key" id="show-component" aria-pressed="${G==="component"}">Component ${ot}</button></div></div>`:""}
      <div class="workbench" data-mobile-pane="${G}">${!l?`<svg class="connector" aria-hidden="true"><path /></svg>
        <section class="reference" aria-label="Approved composition">
          <div class="section-head"><h2>Approved comp</h2>${!k?`<button id="mark" class="ks-button ks-button-ghost" aria-pressed="${M}">${M?"Cancel":"Mark missing"}</button>`:""}</div>
          <div class="map-space"><div class="map ${M?"marking":""}" style="aspect-ratio:${e.comp.width}/${e.comp.height}">
            <img class="comp" src="${Ee(e.comp.url)}" alt="Approved composition for ${S(e.title)}" draggable="false">
            ${Oe&&!b?`<div class="region" style="${Ve(Oe)}"></div>`:""}
            ${J.map((t,d)=>{let E=t.representative,C={kind:t.kind,label:t.stateLabel},xe=!b&&ae?.id===t.id;return`<button class="pin ${C.kind} ${xe?"selected":""}" data-select="${S(E.id)}" style="left:${je(Math.min(0.96,t.box.x+t.box.w/2))};top:${je(Math.max(0.035,t.box.y))}" aria-label="Inspect ${S(t.label)}${t.members.length>1?` · ${t.members.length} instances`:""} — ${S(C.label)}" title="${d+1}. ${S(t.label)} · ${S(C.label)}" aria-pressed="${xe}">${C.kind==="approved"?qe:C.kind==="feedback"?re:""}<span>${d+1}</span>${t.members.length>1?`<small>×${t.members.length}</small>`:""}</button>`}).join("")}
            ${ue&&!b?ae.members.map((t)=>`<div class="region instance-region" style="${Ve(t.box)}"></div>`).join(""):""}
            ${a.missing.map((t,d)=>`<button class="pin feedback ${!b&&g===t.id?"selected":""}" data-select="${S(t.id)}" style="left:${je(t.box.x+t.box.w/2)};top:${je(t.box.y)}" aria-label="Inspect missing ${S(t.name)}" title="Missing: ${S(t.name)}">${re}<span>${J.length+d+1}</span></button>`).join("")}

            <div class="draw-box" hidden></div>
          </div></div>
          <div class="map-legend" aria-label="Map status legend"><span><i class="legend-pending">#</i> To review</span><span><i class="legend-feedback">${re}</i> ${k?"Changes requested":"Feedback ready"}</span><span><i class="legend-approved">${qe}</i> Approved</span></div>
          ${M?'<div class="map-caption">Draw around the missing piece.<button id="add-box">Add an adjustable box</button></div>':""}
        </section>`:""}
        <section class="inspector" aria-label="${l?"Page comparison":"Selected component"}">
          ${!l?`<div class="section-head"><h2>${b?"Review summary":`<span class="number">${ot}</span> ${S(ue?ae.label:A?.name??X?.name??"Component")}`}</h2></div>`:""}<div class="inspection-content" role="region" aria-label="${l?"Page comparison":"Component comparison"}" tabindex="0">
          ${b&&!l?`<section class="review-summary" id="review-summary" tabindex="-1"><div class="completion-mark" aria-hidden="true">${qe}</div><h2>${k?"Review sent.":"All components reviewed."}</h2><p>${c.approved} approved · ${c.revisions} flagged for repair${a.missing.length?` · ${a.missing.length} missing`:""}</p><p>${k?"Your decisions are saved.":c.hasFeedback?"Send your feedback to start the next repair round.":"Confirm nothing is missing, then approve and continue."}</p><div class="summary-decisions">${J.map((t)=>{let d=t.representative,E=a.decisions[d.id],C=It(d);return`<button data-select="${S(d.id)}"><strong>${S(t.label)}</strong><span>${t.kind==="pending"?"Not reviewed":C.kind==="feedback"?"Needs work":"Approved"}</span>${E?.action==="revise"?`<small>${S(E.feedback||"No note — agent will diagnose.")}</small>`:""}</button>`}).join("")}${a.missing.map((t)=>`<button data-select="${S(t.id)}"><strong>${S(t.name)}</strong><span>Missing</span><small>${S(t.feedback)}</small></button>`).join("")}</div></section></div>${u?`<div class="review-form">${u}</div>`:""}`:A?`
          ${x?`<div class="repair-context">
            ${N&&T?.prior?.action==="revise"?`<section class="previous-feedback" aria-label="Previous feedback"><h3>Previous feedback <span>· Round ${T.feedbackRound}</span></h3><blockquote>${S(T.prior.feedback||"No written feedback was supplied.")}</blockquote>${T.prior.split?"<p>Requested: split into separately reviewable components.</p>":""}</section>`:T?.carried?'<p class="kept-approval">Unchanged · approval kept</p>':""}
            ${T?.change?.kind==="changed"?`<details class="changed-files" ${At?"open":""}><summary>${T.change.files.length?`${T.change.files.length} changed ${T.change.files.length===1?"file":"files"}`:T.change.reasons.includes("region")?"Region changed":Y?.note!==A.note?"Description changed · files unchanged":"Component definition changed · files unchanged"}</summary>${T.change.files.length?`<ul>${T.change.files.map((t)=>`<li>${S(t)}</li>`).join("")}</ul>`:""}${Y&&Y.note!==A.note?`<dl class="description-diff"><dt>Previous description</dt><dd>${S(Y.note)}</dd><dt>Current description</dt><dd>${S(A.note)}</dd></dl>`:""}</details>`:""}
          </div>`:""}

          <div class="comparison-slot"><div class="comparison-panel ${ue?"group-overview":""}"><h2 class="expanded-title">${S(ue?ae.label:L.name)}</h2>${p.length>1?`<div class="review-peers"><strong>${p.length} instances</strong>${!ue?'<button id="all-instances" class="quiet">All instances</button>':'<span class="group-hint">Select to inspect</span>'}</div>`:""}<div class="compare-toolbar">${Y?`<div class="round-switch ks-instrument-strip is-paper" data-ks-strip="round" role="group" aria-label="Preview version"><button type="button" class="ks-instrument-key" id="current-round" aria-label="Current · round ${e.round}" title="Current · round ${e.round}" aria-pressed="${!N}">Current</button><button type="button" class="ks-instrument-key" id="previous-round" aria-label="Previous · round ${x.packet.round}" title="Previous · round ${x.packet.round}" aria-pressed="${N}">Previous</button></div>`:""}<div class="ks-instrument-strip is-paper zoom-strip" data-ks-strip="zoom" role="group" aria-label="Comparison zoom">${[["fit","Fit"],["1","100%"],["2","200%"],["4","400%"]].map(([t,d])=>`<button type="button" class="ks-instrument-key" data-zoom="${t}" aria-pressed="${String(pe)===t}">${d}</button>`).join("")}</div><button id="overlay" type="button" class="ks-switch" title="Overlay the approved comp" aria-pressed="${ce}"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">Overlay</span></button><div class="comparison-actions" role="group" aria-label="Comparison view actions"><button id="expand-comparison" class="ks-icon-button" aria-label="${B?"Restore comparison":"Enlarge comparison"}" title="${B?"Restore comparison (Esc)":"Enlarge comparison"}" aria-expanded="${B}">${we(B?"compact":"expand")}</button>${L?.preview.kind==="image"?`<a class="ks-icon-button source-link" href="${Ee(Nt)}" target="_blank" rel="noopener" aria-label="${be?"Open context capture":Le.fileLabel}" title="${be?"Open context capture":Le.fileLabel}">${we("external")}</a>`:""}</div></div>
          ${ue?`<div class="instance-grid" aria-label="All instances of ${S(ae.label)}"><div class="instance-grid-labels"><span>Full comp crop</span><span>Component preview</span></div>${ae.members.map((t,d)=>{let E=It(t);return`<button class="instance-row ${E.kind}" data-instance="${S(t.id)}" aria-label="Inspect instance ${d+1}: ${S(t.name)} — ${S(E.label)}"><span class="instance-caption"><strong>${S(t.name)}</strong><span>${S(E.label)}</span></span><span class="instance-pair"><span class="instance-reference" style="width:min(100%,${t.box.w*e.comp.width}px,${180*t.box.w*e.comp.width/(t.box.h*e.comp.height)}px);aspect-ratio:${t.box.w*e.comp.width}/${t.box.h*e.comp.height}"><img src="${Ee(e.comp.url)}" alt="Comp: ${S(t.name)}" loading="lazy" style="width:${100/t.box.w}%;left:${-100*t.box.x/t.box.w}%;top:${-100*t.box.y/t.box.h}%">${Ie(e,t)}</span><span class="instance-produced" style="width:min(100%,${t.box.w*e.comp.width}px,${180*t.box.w*e.comp.width/(t.box.h*e.comp.height)}px);aspect-ratio:${t.box.w*e.comp.width}/${t.box.h*e.comp.height}">${t.preview.kind==="image"?`<img src="${Ee(t.preview.url)}" alt="Produced: ${S(t.name)}" loading="lazy">`:t.thumbnail?`<img src="${Ee(t.thumbnail.url)}" alt="Preview: ${S(t.name)}" loading="lazy">`:"Open live component"}</span></span>${tt(e,t)}</button>`}).join("")}</div>`:""}
          ${!ue&&L?tt(le,L):""}<div class="compare">
            <figure><figcaption>${N?`Comp · Round ${x.packet.round}`:l?"Approved comp":cn?.related.length?"Full comp crop":"In the comp"}</figcaption><div class="pan-viewport" aria-label="Reference comparison canvas" tabindex="0"><div class="crop-stage"><img class="crop-image" src="${Ee(le.comp.url)}" alt="Reference region for ${S(L.name)}" style="width:${100/L.box.w}%;left:${-100*L.box.x/L.box.w}%;top:${-100*L.box.y/L.box.h}%">${Ie(le,L)}</div></div></figure>
            <figure><figcaption>${N?`Previous · Round ${x.packet.round}`:l?"Assembled page":be?"In context":x?`${Le.caption} · Round ${e.round}`:Le.caption}</figcaption><div class="pan-viewport" aria-label="Produced comparison canvas" tabindex="0"><div class="output crop-stage ${jt&&!be&&!dn&&Pe==="checker"?"checker":""}">${!dn?`<img class="asset" src="${Ee(Nt)}" alt="Produced ${S(L.name)}" style="object-position:${S(L.preview.position??"center")}">`:`<iframe aria-hidden="true" title="Rendered ${S(L.name)}" src="${Ee(Nt)}" sandbox="" tabindex="-1" width="${le.comp.width}" height="${le.comp.height}"></iframe>`}${ce?`<img class="crop-image overlay-image" src="${Ee(le.comp.url)}" alt="Reference overlay" style="width:${100/L.box.w}%;left:${-100*L.box.x/L.box.w}%;top:${-100*L.box.y/L.box.h}%">`:""}</div></div></figure>
          </div>
          ${jt||L.context?`<div class="view-controls">${L.context?`<div class="ks-instrument-strip is-paper" data-ks-strip="view" role="group" aria-label="Component view"><button type="button" class="ks-instrument-key" id="isolated" aria-pressed="${!be}">${Bt?"Asset only":"Component only"}</button><button type="button" class="ks-instrument-key" id="context" aria-pressed="${be}">In context</button></div>`:""}${jt?`<div class="background-options ks-instrument-strip is-paper" data-ks-strip="background" role="group" aria-label="Asset preview background"><button type="button" id="background-checker" class="ks-instrument-key" aria-label="Checkerboard background" title="Checkerboard background" aria-pressed="${Pe==="checker"}" ${be?"disabled":""}>Checker</button><button type="button" id="background-page" class="ks-instrument-key" aria-label="${le.comp.background?"Page color":"Neutral"} background" title="${le.comp.background?"Page color":"Neutral"} background" aria-pressed="${Pe==="page"}" ${be?"disabled":""}>Page</button></div>`:""}</div>`:""}
          </div></div>${!l&&!ue?`<div class="component-details"><div class="material">${we(Le.code?"code":"image")}<strong>${S(ti)}</strong><span>${L?.material?`${L.material.width} × ${L.material.height} px`:""}</span></div>${le.stage==="components"&&Le?.captured&&!L?.preview.isolation?'<p class="layering">Legacy region capture · may include overlapping components.</p>':""}${L?.context?.layering&&(Bt||be)?`<p class="layering">${S(L.context.layering)}</p>`:""}
          <p class="component-note">${!cn?.related.length?S(L.note):""}</p>
          </div>`:""}</div><div class="review-form">${u}${N?'<p class="previous-notice">Viewing the previous round. Return to Current to make a decision.</p>':""}${k?`<div class="record-verdict"><strong>${he?.action==="approve"?"Approved":he?.action==="revise"?"Changes requested":"Not reviewed"}</strong><span>Submitted in round ${e.round} · read-only</span></div>`:`<div class="decisions" role="group" aria-label="Decision for ${S(A.name)}">${!l?`<div class="decision-title"><strong>Your review <span>Round ${e.round}</span></strong>${N?"<p>Return to Current to review this round.</p>":""}</div>`:""}<button id="approve" ${!m.length?"disabled":""} class="ks-button ks-button-primary decision-approve ${he?.action==="approve"?"approved":""}" aria-pressed="${he?.action==="approve"}">${l?h?"Sending…":`Approve & continue${Ue}`:m.length>1?`Approve ${m.length} instances`:"Looks good"}</button><button id="revise" ${!m.length?"disabled":""} class="ks-button ks-button-secondary decision-revise ${he?.action==="revise"?"revise":""}" aria-pressed="${he?.action==="revise"}">${m.length>1?`Revise ${m.length} instances`:"Needs work"}</button>${he&&!l&&!ue?`<button id="clear" class="ks-icon-button" aria-label="Clear decision" title="Clear decision">${we("undo")}</button>`:""}</div>`}
          ${i?`<form id="feedback-form"><div class="feedback-fields"><label class="feedback-field">What needs to change?<textarea id="feedback" aria-describedby="feedback-hint">${S(i.feedback)}</textarea></label><p id="feedback-hint" class="feedback-hint">Optional — leave blank for the agent to diagnose.</p>${!l?`<label class="check"><input id="split" type="checkbox" ${i.split?"checked":""}> Split into separately reviewable components</label>`:""}</div><div class="feedback-actions"><button id="cancel-feedback" type="button" class="ks-button ks-button-ghost">Cancel</button><button id="save-feedback" type="submit" class="ks-button ks-button-primary">${l?"Send feedback":w?"Save & finish review":"Save & next"}${Ue}</button><span class="shortcut-hint">${de}</span></div></form>`:he?.action==="revise"?`<p class="saved-feedback">${S(he.feedback||"No note — agent will diagnose.")}</p>`:""}
          ${l?`<p class="page-review-status" role="status">${S(z||(k?"Your decision is saved.":h?"Sending…":i?"":"Approval confirms the composition and that nothing is missing."))}</p>`:""}</div>`:X?`<p>This piece will be added to the unresolved inventory.</p><label class="feedback-field">Name<input id="missing-name" value="${S(X.name)}"></label><label class="feedback-field">What is missing?<textarea id="missing-feedback">${S(X.feedback)}</textarea></label><div class="coordinates">${["x","y","w","h"].map((t)=>`<label>${{x:"Left",y:"Top",w:"Width",h:"Height"}[t]} %<input type="number" data-coordinate="${t}" value="${Math.round(X.box[t]*1000)/10}" min="0" max="100" step="0.1"></label>`).join("")}</div><button id="remove-missing">Remove this mark</button></div>`:"<p>No components supplied.</p></div>"}
        </section>
      </div>
      ${!l?`<section class="inventory-section ${ne?"":"tray-collapsed"} ${V&&ne?"tray-expanded":""}" aria-label="Component inventory"><div class="section-head"><h2>Components</h2><div class="inventory-filters ks-instrument-strip is-paper" data-ks-strip="filter" role="group" aria-label="Filter components"><button type="button" class="ks-instrument-key" data-filter="pending" aria-pressed="${v==="pending"}">To review <b>${at}</b></button><button type="button" class="ks-instrument-key" data-filter="reviewed" aria-pressed="${v==="reviewed"}">Reviewed <b>${Jn}</b></button><button type="button" class="ks-instrument-key" data-filter="all" aria-pressed="${v==="all"}">All <b>${J.length+a.missing.length}</b></button></div><div class="tray-actions"><button id="show-all" class="ks-icon-button" aria-pressed="${V}" aria-controls="component-tray" aria-label="${V?"Compact":"Expand"} tray" title="${V?"Compact":"Expand"} tray">${we(V?"compact":"expand")}</button><button id="toggle-tray" class="ks-icon-button" aria-expanded="${ne}" aria-controls="component-tray" aria-label="${ne?"Hide":"Show"} component tray" title="${ne?"Hide":"Show"} component tray">${we(ne?"hideTray":"showTray")}</button></div></div>
      <div id="component-tray" class="inventory ${V?"all":""}">${pn.map((t)=>{let d=J.find((xe)=>xe.members.some((ge)=>ge.id===t.id)),E=J.indexOf(d),C={kind:d.kind,label:d.stateLabel};return`<button class="item ${C.kind} ${!b&&ae?.id===d.id?"active":""}" data-select="${S(t.id)}" aria-pressed="${!b&&ae?.id===d.id}">${t.thumbnail?`<span class="item-thumb">${t.thumbnail.box?`<span class="thumb-crop" style="width:min(100%,${76*t.thumbnail.box.w*e.comp.width/(t.thumbnail.box.h*e.comp.height)}px);aspect-ratio:${t.thumbnail.box.w*e.comp.width}/${t.thumbnail.box.h*e.comp.height}"><img alt="" loading="lazy" src="${Ee(t.thumbnail.url)}" style="position:absolute;width:${100/t.thumbnail.box.w}%;max-width:none;left:${-100*t.thumbnail.box.x/t.thumbnail.box.w}%;top:${-100*t.thumbnail.box.y/t.thumbnail.box.h}%;"></span>`:`<img alt="" loading="lazy" src="${Ee(t.thumbnail.url)}">`}</span>`:""}<span class="item-number">${C.kind==="approved"?qe:C.kind==="feedback"?re:""}${E+1}<span class="item-medium">${we(_e(t).code?"code":"image")}${S(_e(t).label)}</span></span><strong>${S(Qn(t.id))}${d.members.length>1?` <small>×${d.members.length}</small>`:""}</strong><span class="state ${C.kind}">${S(C.label)}</span></button>`}).join("")}${(v==="pending"?[]:a.missing).map((t,d)=>`<button class="item feedback ${g===t.id?"active":""}" data-select="${S(t.id)}"><span class="item-number">${J.length+d+1}</span><strong>${S(t.name)}</strong><span class="state revise">Missing</span></button>`).join("")}${!pn.length&&(v==="pending"||!a.missing.length)?`<p class="inventory-empty">${v==="pending"?"Nothing left to review. Your decisions are ready.":"No components reviewed yet."}</p>`:""}</div></section>`:""}
      ${l?"":k?`<footer class="record-footer"><span>Round ${e.round} submitted · read-only</span><span>${c.approved} approved · ${c.revisions} changes requested</span></footer>`:`<footer class="${!c.pending&&!s?"queue-complete":""}"><div>${!c.pending&&!s?`<button id="show-summary" class="completion-link">${qe}${k?"Review sent":"All components reviewed"}</button>`:""}<button id="approve-rest" class="ks-button ks-button-secondary" ${!c.pending?"hidden":""} ${!c.pending||s?"disabled":""}>Approve ${c.approved||c.revisions?"remaining":"all"}</button><label class="check ks-checkbox"><input id="inventory-confirm" type="checkbox" ${a.inventoryConfirmed?"checked":""}> Nothing missing from the comp</label></div><div class="submit-area"><p role="status">${S(ei)}</p><button id="submit" class="ks-button ks-button-primary" ${!c.canSubmit||s||h||k?"disabled":""}>${h?"Sending…":k?"Review sent":c.hasFeedback?"Send feedback":"Approve & continue"}${h||k?"":Ue}</button></div></footer>`}
    </section><dialog id="comparison-dialog" aria-label="${l?"Enlarged page comparison":"Enlarged component comparison"}"></dialog>`;let se=o.querySelector("#comparison-dialog"),fe=o.querySelector(".comparison-panel"),Fe=o.querySelector(".comparison-slot"),Te=o.querySelector(".inspector > .review-form"),ni=o.querySelector(".inspector"),mn=()=>{if(se.append(fe),Te)se.append(Te)};if(B&&fe&&Fe)Fe.style.height=`${Ht}px`,mn(),se.showModal();if(N)o.querySelectorAll(".decisions button,#feedback,#split,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#submit,#inventory-confirm").forEach((t)=>t.disabled=!0);if(o.querySelector(".inspection-content").scrollTop=Dt,k||h)o.querySelectorAll(".decisions button,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#mark,#inventory-confirm,#missing-name,#missing-feedback,#feedback,#split,#remove-missing,[data-coordinate]").forEach((t)=>t.disabled=!0);let un=o.querySelector(".inventory");if(un)un.scrollLeft=Ae;if(!Z&&ne)Array.from(o.querySelectorAll(".inventory [data-select]")).find((t)=>t.dataset.select===g)?.scrollIntoView({block:"nearest",inline:"nearest"});if(D)o.getElementById(D)?.focus({preventScroll:!0});else if(F)Array.from(o.querySelectorAll(".item[data-select]")).find((t)=>t.dataset.select===F)?.focus({preventScroll:!0});let K=(t,d)=>o.querySelector(`#${t}`)?.addEventListener("click",d);function Ot(t,d=!1,E=!1){if(M)return;if(!E)t=J.find((C)=>C.members.some((xe)=>xe.id===t))?.representative.id??t;if(I=!E,b=!1,g=t,G="component",ce=!1,pe="fit",Se="isolated",Q=!1,H(),d)o.querySelector("#expand-comparison")?.click()}o.querySelectorAll("[data-select]").forEach((t)=>t.onclick=()=>Ot(t.dataset.select,t.classList.contains("pin")&&e.components.some((d)=>d.id===t.dataset.select))),K("previous-round",()=>{Q=!0,H()}),K("current-round",()=>{Q=!1,H()}),K("review-changes",()=>{let t=y().filter((C)=>It(C).kind==="pending"),d=t.findIndex((C)=>C.id===g),E=t[(d+1)%t.length];if(E)I=!0,b=!1,g=E.id,G="component",v="pending",Q=!1,pe="fit",ce=!1,Se="isolated",H()}),o.querySelectorAll("[data-filter]").forEach((t)=>t.onclick=()=>{v=t.dataset.filter,b=!c.pending&&v==="pending";let d=J.filter((C)=>v==="all"||C.kind==="pending"===(v==="pending")).map((C)=>C.representative);if(!(v!=="pending"&&a.missing.some((C)=>C.id===g))&&!d.some((C)=>C.id===g)&&d.length)I=!0,g=d[0].id,G="component",Q=!1,pe="fit",ce=!1,Se="isolated";H()}),K("show-summary",()=>{b=!0,G="component",v="reviewed",H(),Re("review-summary")}),K("approve",()=>Ge("approve")),K("revise",dt),K("clear",()=>{if(A)delete a.decisions[A.id],delete f[A.id];q=null,b=!1,v="pending",H()}),K("cancel-feedback",()=>{if(A)delete f[A.id];if(ze)ne=!0,ze=!1;H(),Re("revise")}),o.querySelector("#feedback-form")?.addEventListener("submit",(t)=>{t.preventDefault(),Ge("revise")}),o.querySelector("#feedback")?.addEventListener("keydown",(t)=>{let d=t;if(d.key==="Enter"&&(d.metaKey||d.ctrlKey)&&!d.isComposing)d.preventDefault(),d.stopPropagation(),Ge("revise")}),K("undo-decision",()=>{if(!q||h||k)return;let t=q;for(let[d,E]of Object.entries(t.previous))if(E)a.decisions[d]=E;else delete a.decisions[d];delete f[t.id],g=t.id,b=!1,Q=!1,G="component",v="all",q=null,H(),Re("approve")}),K("all-instances",()=>{I=!0,g=ae.representative.id,Q=!1,H()}),o.querySelectorAll("[data-instance]").forEach((t)=>t.onclick=()=>Ot(t.dataset.instance,!1,!0)),K("overlay",()=>{ce=!ce,H()}),K("isolated",()=>{Se="isolated",H()}),K("context",()=>{Se="context",H()}),o.querySelectorAll("[data-zoom]").forEach((t)=>t.addEventListener("click",()=>{let d=t.dataset.zoom;pe=d==="fit"?"fit":Number(d),H()})),K("background-checker",()=>{Pe="checker",H()}),K("background-page",()=>{Pe="page",H()}),K("show-all",()=>{V=!V,ne=!0,H()}),K("toggle-tray",()=>{ze=!1,ne=!ne,H()}),K("show-comp",()=>{G="comp",H()}),K("show-component",()=>{G="component",H()}),K("mark",()=>{M=!M,H()}),K("add-box",()=>nt({x:0.35,y:0.35,w:0.2,h:0.2})),K("remove-missing",()=>{a.missing=a.missing.filter((t)=>t.id!==g),g=e.components[0]?.id,H()}),K("approve-rest",()=>{if(s)return;a=wn(e,a),q=null,b=!0,v="reviewed",G="component",H(),Re("review-summary")}),o.querySelector("#inventory-confirm")?.addEventListener("change",(t)=>{a.inventoryConfirmed=t.target.checked,H()}),o.querySelector("#feedback")?.addEventListener("input",(t)=>{if(A&&f[A.id])f[A.id].feedback=t.target.value}),o.querySelector("#split")?.addEventListener("change",(t)=>{if(A&&f[A.id])f[A.id].split=t.target.checked}),o.querySelector("#missing-name")?.addEventListener("input",(t)=>{if(X)X.name=t.target.value;let d=o.querySelector("#submit");if(d)d.disabled=s||h||k||!Je(e,a).canSubmit}),o.querySelector("#missing-feedback")?.addEventListener("input",(t)=>{if(X)X.feedback=t.target.value}),o.querySelectorAll("[data-coordinate]").forEach((t)=>t.addEventListener("change",()=>{if(!X)return;let d=t.dataset.coordinate,E=Number(t.value)/100;if(Number.isFinite(E))X.box[d]=Math.max(d==="w"||d==="h"?0.001:0,Math.min(1,E));X.box.w=Math.min(X.box.w,1-X.box.x),X.box.h=Math.min(X.box.h,1-X.box.y),H()})),K("submit",()=>{De()});let ke=o.querySelector(".map");function Ft(t){let d=ke.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(t.clientX-d.left)/d.width)),y:Math.max(0,Math.min(1,(t.clientY-d.top)/d.height))}}function gn(t){let d=Ft(t);return e.components.filter(({box:E})=>d.x>=E.x&&d.x<=E.x+E.w&&d.y>=E.y&&d.y<=E.y+E.h).sort((E,C)=>E.box.w*E.box.h-C.box.w*C.box.h)[0]}ke?.addEventListener("click",(t)=>{if(M||t.target.closest("[data-select]"))return;let d=gn(t);if(d)Ot(d.id,!0)}),ke?.addEventListener("pointermove",(t)=>{if(!M)ke.style.cursor=gn(t)?"zoom-in":""}),ke?.addEventListener("pointerdown",(t)=>{if(!M)return;O=Ft(t),ke.setPointerCapture(t.pointerId),t.preventDefault()}),ke?.addEventListener("pointermove",(t)=>{if(!O)return;let d=Ft(t);me={x:Math.min(O.x,d.x),y:Math.min(O.y,d.y),w:Math.abs(d.x-O.x),h:Math.abs(d.y-O.y)};let E=o.querySelector(".draw-box");E.hidden=!1,E.style.cssText=Ve(me)}),ke?.addEventListener("pointerup",()=>{if(me&&me.w>0.01&&me.h>0.01)nt(me);else O=null,me=null}),ke?.addEventListener("pointercancel",()=>{O=null,me=null,H()});let hn=o.querySelector(".output"),gt=o.querySelector("iframe"),fn=o.querySelector(".workbench"),Ye=o.querySelector(".inspection-content"),Ut=o.querySelector(".inspector");function Kt(){if(!Ye||!Ut)return;Ut.dataset.scrollAbove=String(Ye.scrollTop>1),Ut.dataset.scrollBelow=String(Ye.scrollHeight-Ye.clientHeight-Ye.scrollTop>1)}Ye?.addEventListener("scroll",Kt,{passive:!0});function ht(){let t=o.querySelector(".map-space");if(t&&t.clientWidth&&t.clientHeight){let U=Vt(e.comp.width,e.comp.height,Math.max(1,t.clientWidth-32),Math.max(1,t.clientHeight-32),"fit");ke.style.width=`${U.width}px`,ke.style.height=`${U.height}px`}let d=o.querySelector(".inspection-content"),E=Array.from(o.querySelectorAll(".pan-viewport"));if(d?.clientHeight){let U=B?Math.max(100,se.clientHeight-(fe?.querySelector(".compare-toolbar")?.clientHeight??0)-(fe?.querySelector(".expanded-title")?.clientHeight??0)-(fe?.querySelector(".view-controls")?.clientHeight??0)-(Te?.getBoundingClientRect().height??0)-124):Math.min(l?Number.POSITIVE_INFINITY:248,Math.max(100,d.clientHeight-((E[0]?.getBoundingClientRect().top??d.getBoundingClientRect().top)-d.getBoundingClientRect().top+d.scrollTop)-(fe?.querySelector(".view-controls")?.clientHeight??0)-12));E.forEach((ee)=>ee.style.height=`${U}px`)}if(L&&E.length&&!ue){let U=Vt(L.box.w*le.comp.width,L.box.h*le.comp.height,Math.min(...E.map((ee)=>ee.clientWidth)),Math.min(...E.map((ee)=>ee.clientHeight)),pe);o.querySelectorAll(".crop-stage").forEach((ee)=>{ee.style.width=`${U.width}px`,ee.style.height=`${U.height}px`})}if(E.forEach((U)=>{let ee=U.scrollWidth>U.clientWidth+1||U.scrollHeight>U.clientHeight+1;U.classList.toggle("pannable",ee),U.style.cursor=B?"":"zoom-in",U.setAttribute("role",B?"region":"button"),U.title=B?ee?"Move your pointer to pan. You can also scroll, swipe, or use arrow keys.":"":"Click to enlarge comparison"}),hn&&gt&&L){let U=hn.clientWidth/(L.box.w*le.comp.width);gt.style.transform=`scale(${U})`,gt.style.left=`${-L.box.x*le.comp.width*U}px`,gt.style.top=`${-L.box.y*le.comp.height*U}px`}let C=fn.getBoundingClientRect(),xe=o.querySelector(".region"),ge=o.querySelector(".number"),xt=o.querySelector(".connector path");if(xe&&ge&&xt){let U=xe.getBoundingClientRect(),ee=ge.getBoundingClientRect(),vt=U.right-C.left,te=U.top+U.height/2-C.top,st=ee.left-C.left-8,bt=ee.top+ee.height/2-C.top;xt.setAttribute("d",`M ${vt} ${te} H ${st-14} V ${bt} H ${st}`)}}function Xe(t,d){if(!fe||!Fe||t===B)return;let E=o.querySelector("#expand-comparison"),C=(B?se:fe).getBoundingClientRect(),xe=window.matchMedia("(prefers-reduced-motion: reduce)").matches,ge=fe.querySelector(".pan-viewport"),xt=ge?ge.scrollLeft/Math.max(1,ge.scrollWidth-ge.clientWidth):0,U=ge?ge.scrollTop/Math.max(1,ge.scrollHeight-ge.clientHeight):0,ee=()=>fe.querySelectorAll(".pan-viewport").forEach((te)=>{te.scrollLeft=xt*Math.max(0,te.scrollWidth-te.clientWidth),te.scrollTop=U*Math.max(0,te.scrollHeight-te.clientHeight)}),vt=()=>{if(Fe.append(fe),Te)ni.append(Te),Te.inert=!1;se.close(),Fe.style.height="",He=!1,B=!1,E.innerHTML=we("expand"),E.setAttribute("aria-label","Enlarge comparison"),E.title="Enlarge comparison",E.setAttribute("aria-expanded","false"),ht(),ee(),E.focus({preventScroll:!0}),d?.()};if(t){Fe.style.height=`${C.height}px`,mn(),se.showModal(),B=!0,E.innerHTML=we("compact"),E.setAttribute("aria-label","Restore comparison"),E.title="Restore comparison (Esc)",E.setAttribute("aria-expanded","true"),ht(),ee(),E.focus({preventScroll:!0});let te=se.getBoundingClientRect();if(!xe)se.animate([{transform:`translate(${C.x-te.x}px,${C.y-te.y}px) scale(${C.width/te.width},${C.height/te.height})`,opacity:0.6},{transform:"none",opacity:1}],{duration:240,easing:"cubic-bezier(.2,.8,.2,1)"})}else{if(E.disabled)return;let te=Fe.getBoundingClientRect();if(xe){vt();return}if(E.disabled=!0,He=!0,Te)Te.inert=!0;let st=se.animate([{transform:"none",opacity:1},{transform:`translate(${te.x-C.x}px,${te.y-C.y}px) scale(${te.width/C.width},${te.height/C.height})`,opacity:0.6}],{duration:200,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});se.inert=!0;let bt=()=>{if(st.cancel(),E.disabled=!1,se.inert=!1,se.isConnected)vt();else He=!1,B=!1,H(),d?.()};st.finished.then(bt,bt)}}if(Ce=(t)=>Xe(!1,t),K("expand-comparison",()=>Xe(!B)),se.addEventListener("cancel",(t)=>{t.preventDefault(),t.stopPropagation(),Xe(!1)}),se.addEventListener("keydown",(t)=>{if(t.key==="Escape")t.preventDefault(),t.stopPropagation(),Xe(!1)}),et=Ct(o),oe=new ResizeObserver(()=>{ht(),Kt()}),oe.observe(fn),oe.observe(se),Te)oe.observe(Te);let xn=o.querySelector(".inspection-content");if(xn)oe.observe(xn);let vn=o.querySelector(".repair-context");if(vn)oe.observe(vn);let bn=fe?.querySelector(".compare-toolbar");if(bn)oe.observe(bn);ht();let ft=Array.from(o.querySelectorAll(".pan-viewport"));if(ft.forEach((t)=>{t.scrollLeft=j,t.scrollTop=ut}),ft.forEach((t)=>{t.querySelectorAll("img").forEach((d)=>d.draggable=!1),t.addEventListener("click",()=>{if(!B)Xe(!0)}),t.addEventListener("pointermove",(d)=>{if(d.pointerType!=="mouse"||d.buttons||!t.classList.contains("pannable"))return;let E=t.getBoundingClientRect();t.scrollLeft=Gt(d.clientX,E.left,t.clientWidth,t.scrollWidth),t.scrollTop=Gt(d.clientY,E.top,t.clientHeight,t.scrollHeight)}),t.addEventListener("keydown",(d)=>{if(!B&&(d.key==="Enter"||d.key===" ")){d.preventDefault(),d.stopPropagation(),Xe(!0);return}let C={ArrowLeft:[-48,0],ArrowRight:[48,0],ArrowUp:[0,-48],ArrowDown:[0,48]}[d.key];if(!C)return;d.preventDefault(),d.stopPropagation(),t.scrollLeft+=C[0],t.scrollTop+=C[1]})}),ft.forEach((t)=>t.addEventListener("scroll",()=>{for(let d of ft)if(d!==t){if(d.scrollLeft!==t.scrollLeft)d.scrollLeft=t.scrollLeft;if(d.scrollTop!==t.scrollTop)d.scrollTop=t.scrollTop}})),it&&window.matchMedia("(max-width:800px)").matches){let t=o.querySelector(".inspection-content"),d=o.querySelector(".compare");if(t&&d)t.scrollTop+=d.getBoundingClientRect().top-t.getBoundingClientRect().top}if(Kt(),window.scrollTo(W,_),!k)r.onDraftChange?.(structuredClone(a))}return H(),{destroy(){oe?.disconnect(),et?.(),o.replaceChildren()},getDraft(){return structuredClone(a)}}}function li(){let n=document.createElement("style");n.textContent=[["Albert Sans","albertsans"],["Alumni Sans","alumnisans"],["JetBrains Mono","jetbrainsmono"]].map(([e,r])=>`@font-face{font-family:"${e}";src:url(/fonts/${r}.ttf);font-weight:100 900}`).join(""),document.head.append(n)}function pi(n){let e=document.createElement("div");e.setAttribute("role","alert"),e.style.cssText="max-width:560px;margin:18vh auto 0;padding:0 0 0 18px;border-left:2px solid var(--ks-vermilion,oklch(52% 0.16 35));color:var(--ks-text,oklch(22% 0 0));font:400 15px/1.55 var(--font-sans,Arial,sans-serif)";let r=document.createElement("p");r.textContent="Review unavailable",r.style.cssText="margin:0 0 8px;font:400 11px/1.3 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:var(--ks-text-muted,oklch(46% 0 0))";let o=document.createElement("strong");o.textContent="The review could not be opened.",o.style.cssText="display:block;font-weight:500;color:var(--ks-ink,oklch(13% 0 0))";let a=document.createElement("p");a.style.cssText="margin:4px 0 18px;color:var(--ks-text-muted,oklch(46% 0 0))",a.textContent=`${n} If the review server stopped, ask the agent to serve the review again, then reload.`;let l=document.createElement("button");return l.textContent="Reload",l.style.cssText="font:500 15px/1 var(--font-sans,Arial,sans-serif);min-height:44px;padding:0 22px;border:1px solid oklch(13% 0 0);border-radius:3px;background:oklch(13% 0 0);color:oklch(99.5% 0 0);cursor:pointer",l.onclick=()=>location.reload(),e.append(r,o,a,l),e}async function di(){li();let n=document.getElementById("review"),e=await fetch("/packet",{cache:"no-store"});if(!e.ok)throw Error("The review packet could not be loaded.");let r=await e.json(),o=Et(r.packet);if(r.sourceStatus&&!o){let a=document.createElement("p");a.textContent=r.sourceStatus,n.before(a)}_n(n,r.packet,{initialDraft:r.draft,history:r.history,completed:!!r.receipt,status:o?r.sourceStatus:null,onSubmit:async(a)=>{let l=await fetch("/decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(a)}),y=await l.json().catch(()=>({}));if(!l.ok)throw Error(y.error??"The review could not be saved. Try again.")}})}di().catch((n)=>{document.getElementById("review")?.replaceChildren(pi(n instanceof Error?n.message:String(n)))});})();
