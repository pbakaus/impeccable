(()=>{function mi(e,n){let o=n?.changes[e],a=n?.feedback?.[e],t=a?.decision??(n?.submitted?n.draft.decisions[e]:void 0),p=o?.kind==="unchanged"&&(o.carried??(n?.submitted&&t?.action==="approve"))===!0;return{change:o,prior:t,feedbackRound:a?.round??n?.packet.round,carried:p,label:o?.kind==="added"?"New component":o?.kind==="changed"?"Review again":p?"Approval kept":t?.action==="revise"?"Changes still requested":"Awaiting review"}}function cn(e,n,o){let a=n.decisions[e.id],t=a?.revision===e.revision?a:void 0,p=mi(e.id,o);if(t?.action==="approve")return{kind:"approved",label:p.carried?"Approval kept":"Approved",priority:3};if(t?.action==="revise")return{kind:"feedback",label:"Feedback ready",priority:2};return{kind:"pending",label:p.change?.kind==="changed"?"Review again":p.change?.kind==="added"?"New · review needed":"Not reviewed",priority:p.change?.kind==="changed"||p.change?.kind==="added"?0:1}}function ve(e){return{packetRevision:e.revision,decisions:{},missing:[],inventoryConfirmed:!1}}function Wi(e){return Object.values(e).every(Number.isFinite)&&e.x>=0&&e.y>=0&&e.w>0&&e.h>0&&e.x+e.w<=1.00001&&e.y+e.h<=1.00001}function Rn(e,n){let o=e.components.map((g)=>n.decisions[g.id]?.revision===g.revision?n.decisions[g.id]:void 0),a=o.filter((g)=>g?.action==="approve").length,t=o.filter((g)=>g?.action==="revise").length,p=o.length-a-t,w=t>0||n.missing.length>0;return{approved:a,revisions:t,pending:p,hasFeedback:w,canSubmit:n.packetRevision===e.revision&&n.missing.every((g)=>g.name.trim()&&Wi(g.box))&&(w||!p&&n.inventoryConfirmed)}}function ue(e,n){let o={...n.decisions};for(let a of e.components)if(!o[a.id]||o[a.id].revision!==a.revision)o[a.id]={revision:a.revision,action:"approve",feedback:"",split:!1};return{...n,decisions:o}}function ce(e,n){if(!Rn(e,n).canSubmit)throw Error("Review is incomplete or stale");return{schemaVersion:1,requestId:e.id,...structuredClone(n)}}function Fn(e){let n=e.preview.kind==="page"||e.preview.sourceKind==="page",o=e.preview.sourceKind==="page";return{code:n,captured:o,label:n?e.medium.match(/html|css|svg/i)?e.medium:"HTML / CSS / SVG":"Raster",caption:n?o?e.preview.isolation?"Component only":"Region capture":"Live component":"Produced asset",fileLabel:o?"Open captured preview":"Open source image"}}function be(e,n,o){let a=e.components.findIndex((t)=>t.id===o);for(let t=1;t<=e.components.length;t++){let p=e.components[(a+t)%e.components.length];if(cn(p,n).kind==="pending")return p.id}}function wi(e,n){if(!n.reviewGroup||!Fn(n).code)return[n];return e.components.filter((o)=>o.reviewGroup===n.reviewGroup&&Fn(o).code)}function pi(e,n,o,a,t=[]){let p=a?wi(e,o):[o];if(p.length===1)return[o];return p.filter((w)=>cn(w,n).kind==="pending"&&(w.id===o.id||!t.includes(w.id)))}function fe(e,n,o){let a=new Set;return e.components.flatMap((t)=>{if(a.has(t.id))return[];let p=wi(e,t);p.forEach((k)=>a.add(k.id));let w=p.filter((k)=>cn(k,n,o).kind==="pending"),g=p.filter((k)=>cn(k,n,o).kind==="feedback"),M=w[0]??g[0]??t,j=w.length?"pending":g.length?"feedback":"approved";return[{id:t.id,members:p,representative:M,pending:w.length,kind:j,label:p.length>1?t.reviewGroup.replace(/[-_]+/g," ").replace(/^./,(k)=>k.toUpperCase()):t.name,box:{x:Math.min(...p.map((k)=>k.box.x)),y:Math.min(...p.map((k)=>k.box.y)),w:Math.max(...p.map((k)=>k.box.x+k.box.w))-Math.min(...p.map((k)=>k.box.x)),h:Math.max(...p.map((k)=>k.box.y+k.box.h))-Math.min(...p.map((k)=>k.box.y))},stateLabel:w.length?p.length>1?`${w.length} to review`:cn(M,n,o).label:g.length?p.length>1?`${g.length} ${g.length===1?"needs":"need"} work`:"Feedback ready":"Approved"}]})}function yi(e,n){let o=new Set(n.preview.isolation?.excludedComponents??[]),a=n.box,t=e.components.filter((p)=>{if(p.id===n.id)return!1;if(o.has(p.id))return!0;let w=p.box,g=Math.min(a.x+a.w,w.x+w.w)-Math.max(a.x,w.x),M=Math.min(a.y+a.h,w.y+w.h)-Math.max(a.y,w.y);return w.w*w.h<a.w*a.h&&g*e.comp.width>1&&M*e.comp.height>1});return{description:n.note.trim(),related:t,excluded:t.filter((p)=>o.has(p.id))}}function Ii(e,n,o,a,t){let p=t==="fit"?Math.min(1,o/e,a/n):t;return{scale:p,width:e*p,height:n*p}}function Oi(e,n,o,a){if(o<=0||a<=o)return 0;return Math.max(0,Math.min(1,((e-n)/o-0.08)/0.84))*(a-o)}var me=`
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
`;var we=`/* VENDORED from impeccable-site/site/styles/kinpaku-tokens.css (the source of truth).
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
`,ye=`/* VENDORED from impeccable-site/site/styles/kinpaku-kit.css (buttons, tabs, select, icon button, instrument strip, grain, switch, paper strip, thumb) (the source of truth).
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
`,ze=`/* VENDORED from impeccable-site/site/styles/docs-kinpaku.css (the command rail list: the site's selected-row pattern) (the source of truth).
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
`;var je=(e)=>e.replace(/^:root\s*\{/gm,":root, :host {"),zi=je(we)+`
`+je(ye)+`
`+ze,Bn='<span class="ks-button-arrow" aria-hidden="true"><svg viewBox="0 0 16 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M0 4h14M10 0l4 4-4 4"/></svg></span>';var Me=`
.review-peers{display:grid;gap:8px;padding:8px 0 12px;font-size:12px}
.review-peers strong span{font-weight:400}.review-peers>div{display:flex;flex-wrap:wrap;gap:4px}
.review-peers button{min-width:28px;min-height:28px;padding:3px;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:inherit}
.review-peers button[aria-pressed="true"]{background:var(--teal);color:var(--ks-paper-raised)}
.review-peers label{display:flex;align-items:center;gap:6px}

:host{display:block;color:var(--ks-text);font:14px/1.45 var(--ks-font);--line:var(--ks-rule);--paper:var(--ks-paper-raised);--muted:var(--ks-text-muted);--teal:var(--ks-patina-deep);--warn:var(--ks-vermilion);--selection:var(--ks-patina)}
*{box-sizing:border-box}h1,h2,p,figure{margin:0}button,input,textarea{font:inherit}button{cursor:pointer;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:inherit;padding:8px 12px;min-height:36px}button:hover{border-color:var(--teal);color:var(--teal)}button:disabled{cursor:default;opacity:.45}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--teal);outline-offset:3px}button[aria-pressed=true]{box-shadow:inset 0 0 0 1px var(--teal)}input[type=checkbox]{accent-color:var(--teal);width:16px;height:16px;flex-shrink:0}textarea,input:not([type=checkbox]){width:100%;background:var(--paper);color:inherit;border:1px solid var(--ks-edge);border-radius:4px;padding:9px 10px}textarea{resize:vertical;min-height:80px}::selection{background:var(--ks-patina-pale)}a{color:var(--teal)}
.review{max-width:1600px;margin:auto;padding:24px 28px 0}header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:16px}h1{font:400 40px/1.05 var(--font-display,Arial,sans-serif);letter-spacing:-.02em}header p{margin-top:8px;font-size:15px}header p span,.medium{color:var(--muted)}.badge{border:1px solid var(--line);padding:5px 10px;font-size:12px;white-space:nowrap}.preview-note{color:var(--muted);font-size:12px;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:24px}
.connector{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible}.connector path{fill:none;stroke:var(--selection);stroke-width:2}.workbench{align-items:start;display:grid;grid-template-columns:minmax(0,1.18fr) minmax(0,1fr);gap:40px;position:relative}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;min-height:36px}.section-head h2{font-size:17px;font-weight:500;line-height:1.2}.section-head>span,.section-head h2>span:not(.number){font-size:12px;color:var(--muted)}.section-head button{font-size:12px}.number{display:inline-flex;align-items:center;justify-content:center;width:27px;height:27px;border:1px solid var(--teal);color:var(--teal);margin-right:7px;font:12px var(--font-mono,monospace)}
.map{position:relative;background:var(--ks-paper-deep);isolation:isolate}.comp{width:100%;height:100%;display:block;user-select:none}.map.marking{touch-action:none;cursor:crosshair}.map.marking .pin{pointer-events:none;opacity:.25}.pin{position:absolute;transform:translate(-50%,-50%);padding:0;min-height:25px;width:25px;height:25px;border-radius:50%;border:1px solid var(--ks-paper-raised);background:var(--ks-paper-raised);color:var(--ks-text);font:11px var(--font-mono,monospace);box-shadow:0 1px 4px oklch(13% 0 0 / .4);z-index:2}.pin.selected{background:var(--teal);color:var(--ks-paper-raised);border-color:var(--teal);box-shadow:none;outline:none;z-index:3}.pin:focus-visible{outline:2px solid var(--ks-paper-raised);outline-offset:3px}.region,.draw-box{position:absolute;pointer-events:none;outline:2px solid var(--selection);z-index:1}.draw-box{background:oklch(45% 0.10 190 / .2);z-index:4}.map-caption{font-size:12px;color:var(--muted);padding-top:12px;min-height:40px}.map-caption button{display:block;margin-top:10px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}.compare figure{min-width:0}.compare figcaption{height:24px;min-height:0;font-size:12px;margin-bottom:9px}.compare figcaption span{display:block;color:var(--muted);font-size:11px}.crop-stage{position:relative;overflow:hidden;background:var(--comp-background,var(--ks-paper-deep));min-width:0}.crop-image{position:absolute;max-width:none;height:auto}.asset{display:block;width:100%;height:100%;object-fit:contain}.crop-stage iframe{position:absolute;max-width:none;border:0;transform-origin:top left;pointer-events:none}.overlay-image{opacity:.5;pointer-events:none}.component-note{font-size:12px;line-height:1.5;color:var(--muted);margin:6px 0 0}.decisions{display:flex;gap:10px;padding:10px 0;background:var(--paper);position:sticky;bottom:0;z-index:6}.feedback-field{display:block;margin-top:16px;font-size:13px}.feedback-field>span{float:right;color:var(--muted);font-size:12px}.feedback-field textarea,.feedback-field input{display:block;margin-top:7px}.check{display:flex;align-items:center;gap:7px;font-size:12px;line-height:1.5;margin-top:12px}.coordinates{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.coordinates label{font-size:12px}.coordinates input{margin-top:5px}
.inventory-section{margin-top:28px;border-top:1px solid var(--line);padding-top:16px}.inventory-section .section-head{margin-bottom:10px}.inventory{display:flex;gap:8px;overflow-x:auto;padding:3px 3px 14px;scrollbar-color:var(--ks-gray-2) var(--ks-paper-deep);scrollbar-width:thin}.item{position:relative;flex:0 0 134px;display:grid;grid-template-columns:20px 1fr;column-gap:8px;row-gap:3px;padding:10px;text-align:left;background:transparent}.item strong{grid-column:2;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item.active{background:var(--paper);border-color:var(--teal)}.thumb-crop{position:relative;display:block;overflow:hidden}.item-thumb{display:flex;align-items:center;justify-content:center;grid-column:1/-1;position:relative;overflow:hidden;width:100%;height:76px;background:var(--comp-background,var(--ks-paper-deep));margin-bottom:7px}.item-thumb img{width:100%;height:100%;object-fit:contain}.item-thumb img[style]{height:auto}.inventory.all{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));overflow:visible}.item-number{grid-row:2/4;font:12px var(--font-mono,monospace);color:var(--muted);padding-top:2px}.state{grid-column:2;font-size:11px;color:var(--muted)}.state.approve{color:var(--teal)}.state.revise{color:var(--warn)}footer{display:flex;justify-content:space-between;gap:24px;padding:20px 0 24px;border-top:1px solid var(--line);margin-top:8px}.submit-area{display:flex;align-items:center;gap:20px}.submit-area p{font-size:12px;color:var(--muted);max-width:28ch}.inspector>p{margin:12px 0}
@media(min-width:1300px){.workbench{gap:56px}.review{padding-top:32px}.component-note{max-width:62ch}}
@media(max-width:800px){.connector{display:none}.review{padding:20px 16px 0}.workbench{grid-template-columns:1fr;gap:24px}.reference{max-width:640px;margin:auto;width:100%}.inspector{border-top:1px solid var(--line);padding-top:16px}.compare{max-width:640px}.inventory-section .section-head{align-items:flex-start;flex-direction:column;gap:4px}footer{flex-direction:column}.submit-area{justify-content:space-between}.badge{font-size:11px}.section-head{gap:8px}h1{font-size:34px}header{align-items:flex-start}.section-head h2{font-size:16px}}

.inspector{height:690px;overflow-y:auto;scrollbar-gutter:stable;scrollbar-width:thin;padding:0 5px 0 1px;overflow-anchor:none}
.material{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 12px;min-height:34px;margin-bottom:6px}.material strong{font-size:14px;font-weight:600}.material span{font:11px var(--font-mono,monospace);color:var(--muted)}
.compare-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}.compare-toolbar label{font-size:12px;display:flex;align-items:center;gap:8px}select{font:inherit;color:inherit;background:var(--paper);border:1px solid var(--ks-edge);border-radius:4px;padding:7px 9px;min-height:36px}select:focus-visible,.pan-viewport:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.pan-viewport{height:248px;overflow:auto;display:flex;background:var(--ks-paper-deep);scrollbar-width:thin;scrollbar-color:var(--ks-gray-2) var(--ks-paper-deep);overscroll-behavior:contain}.crop-stage{flex-shrink:0;margin:auto}.checker{background-color:var(--ks-paper-deep);background-image:conic-gradient(var(--ks-gray-2) 25%,transparent 0 50%,var(--ks-gray-2) 0 75%,transparent 0);background-size:16px 16px}
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
`+me+`
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
.instance-produced{justify-self:center;display:flex;align-items:center;justify-content:center;min-height:36px;max-height:180px;overflow:hidden}
.instance-produced img{display:block;width:100%;height:100%;object-fit:contain}
.instance-row.approved{opacity:.65}.instance-row.feedback .instance-caption>span{color:var(--warn)}
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
.pan-viewport,.crop-stage{background:transparent}
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
`+zi+`
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
.ks-icon-button .utility-icon{width:16px;height:16px}
.mobile-panes{padding:8px 14px}
.ks-checkbox input{margin:0}
.review .ks-switch,.review .ks-switch[aria-pressed=true],.review .ks-instrument-key[aria-pressed=true]{box-shadow:none}
`;var Ce={chevronDown:'<path d="m6 9 6 6 6-6"/>',code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',compact:'<path d="M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',hideTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12 3 3 2 3-2"/>',showTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12-4 3-3 3 3"/>',next:'<path d="M5 12h14m-6-6 6 6-6 6"/>',mark:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5M8 12h8m-4-4v8"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',undo:'<path d="M4 10h9a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" transform="translate(0 -2)"/>',external:'<path d="M14 3h7v7m0-7L10 14m0-10H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',zoom:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'};function zn(e){return`<svg class="utility-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${Ce[e]}</svg>`}var Di=[{kind:"plate",label:"Illustration / plate",hint:"Painted or drawn artwork"},{kind:"image",label:"Photo / image",hint:"A photograph"},{kind:"texture",label:"Texture",hint:"A surface or material"}];function Mi(e){let n=e;return!!n&&n.schemaVersion===3&&n.stage==="components"}function Fi(e){return e.role==="plan"&&(!!e.flags?.length||!!e.codeDrawn)}function Ri(e){let n=(o)=>Fi(o)?0:o.role==="asset"?1:2;return e.components.map((o,a)=>({c:o,i:a})).sort((o,a)=>n(o.c)-n(a.c)||o.i-a.i).map((o)=>o.c)}function Ti(e){let n=new Set(e.components.map((o)=>o.id));return(e.codeRegions??[]).filter((o)=>!n.has(o.id))}function Gn(e,n){let o=n.decisions[e.id];return o?.revision===e.revision?o:void 0}function jn(e,n){let o=Gn(e,n);return o?o.action==="approve"?"approved":o.action:"pending"}function qi(e,n){return e.reclassify?.find((o)=>o.id===n)}function Ci(e){let n=[e.name,e.note,...(e.flags??[]).map((o)=>o.message)].join(" ");if(/\b(textures?|surfaces?|grain|grainy|brushed|metal(lic)?|steel|brass|copper|paper|linen|canvas|fabric|cloth|wood(en)?|stone|marble|concrete|plaster|leather|noise|pattern(ed)?|weave|patina)\b/i.test(n))return"texture";if(/\b(photo|photos|photograph|photographs|photographic|photography)\b/i.test(n)&&!/\bphotographic shading\b/i.test(n))return"image";return"plate"}function qe(e){return`Drawn in code (${e.kind})`}function Ve(e){return e.message}function Cn(e,n){let o=e.components.map((f)=>jn(f,n)),a=o.filter((f)=>f==="approved").length,t=o.filter((f)=>f==="revise").length,p=new Set(Ti(e).map((f)=>f.id)),w=(n.reclassify??[]).filter((f)=>p.has(f.id)).length,g=o.filter((f)=>f==="reclassify").length+w,M=o.filter((f)=>f==="pending").length,j=n.missing.length,k=t+g+j>0,m=n.packetRevision===e.revision,z=n.missing.every((f)=>f.name.trim()&&Wi(f.box)),v=m&&!k&&M===0;return{total:o.length,approved:a,revise:t,reclassify:g,pending:M,missing:j,hasChanges:k,canApprove:v,mode:k?"changes":"approve",canSubmit:m&&z&&(k||v)}}function Pi(e,n,o,a={}){if(o==="revise"&&n.role!=="asset"&&!(a.feedback??"").trim())throw Error("Revising a plan item needs feedback");if(o==="reclassify"&&n.role!=="plan")throw Error("Only planned code can become an image");let t={revision:n.revision,action:o,feedback:o==="approve"?"":(a.feedback??"").trim(),split:!1};if(o==="reclassify")t.kind=a.kind??Ci(n);return{...e,inventoryConfirmed:!1,decisions:{...e.decisions,[n.id]:t}}}function Ee(e,n){let o={...e.decisions};return delete o[n],{...e,inventoryConfirmed:!1,decisions:o}}function Si(e,n,o){let a=(e.reclassify??[]).filter((t)=>t.id!==n);return{...e,inventoryConfirmed:!1,reclassify:o?[...a,{id:n,kind:o.kind,feedback:(o.feedback??"").trim()}]:a}}function Ye(e,n){let o=Cn(e,n);if(!o.canSubmit)throw Error("Review is incomplete or stale");let a={};for(let w of e.components){let g=Gn(w,n);if(g)a[w.id]=structuredClone(g)}let t=new Set(Ti(e).map((w)=>w.id)),p=(n.reclassify??[]).filter((w)=>t.has(w.id)).map((w)=>({...w}));return{schemaVersion:1,requestId:e.id,packetRevision:n.packetRevision,decisions:a,missing:structuredClone(n.missing),inventoryConfirmed:o.mode==="approve",...p.length?{reclassify:p}:{}}}function Xe(e){return{packetRevision:e.revision,decisions:{},missing:[],inventoryConfirmed:!1,reclassify:[]}}function Je(e,n,o,a,t=0.02){let p=Math.max(0,Math.floor((a.x-t)*n)),w=Math.min(n-1,Math.ceil((a.x+a.w+t)*n)),g=Math.max(0,Math.floor((a.y-t)*o)),M=Math.min(o-1,Math.ceil((a.y+a.h+t)*o)),j=Math.floor(a.x*n),k=Math.ceil((a.x+a.w)*n),m=Math.floor(a.y*o),z=Math.ceil((a.y+a.h)*o),v=[],f=Math.max(1,Math.round(Math.max(w-p,M-g)/80));for(let Q=g;Q<=M;Q+=f)for(let Z=p;Z<=w;Z+=f){if(Z>=j&&Z<k&&Q>=m&&Q<z)continue;let dn=(Q*n+Z)*4;if(e[dn+3]<200)continue;v.push([e[dn],e[dn+1],e[dn+2]])}return v}function $e(e){if(!e.length)return;let n=(o)=>{let a=e.map((t)=>t[o]).sort((t,p)=>t-p);return a[a.length>>1]};return"#"+[0,1,2].map((o)=>n(o).toString(16).padStart(2,"0")).join("")}function ne(e,n,o,a,t,p=4,w=24){let g=e.w*n,M=e.h*o,j=Math.min(24,Math.max(8,0.04*Math.max(g,M))),k=Math.min(n,g+j*2),m=Math.min(o,M+j*2),z=Math.min(p,a/k,t/m);if(M*z<w&&M>0)z=Math.min(p,w/M,t/m),k=Math.min(k,a/z);let v=(e.x+e.w/2)*n,f=(e.y+e.h/2)*o,Q=Math.max(0,Math.min(n-k,v-k/2)),Z=Math.max(0,Math.min(o-m,f-m/2));return{scale:z,width:k*z,height:m*z,view:{x:Q/n,y:Z/o,w:k/n,h:m/o}}}var Pe=["no","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"],ji=(e)=>Pe[e]??String(e),Te=(e)=>e[0].toUpperCase()+e.slice(1);function Ge(e,n,o){let a=e.components.filter((p)=>jn(p,n)==="pending").length;if(o&&e.round>1){let p=e.components.filter((g)=>["changed","added"].includes(o.changes[g.id]?.kind??"")||o.feedback?.[g.id]).length,w=e.components.filter((g)=>jn(g,n)==="approved").length;return`The agent worked on your notes for ${ji(p)} ${p===1?"item":"items"}. ${Te(ji(w))} ${w===1?"approval is":"approvals are"} kept.`}let t=Math.max(1,Math.round(a*15/60));return`${Te(ji(a))} ${a===1?"thing":"things"} to check before any page code is written. About ${ji(t)} ${t===1?"minute":"minutes"}.`}function Vi(e,n){if(!n)return null;let o=n.feedback?.[e],a=n.packet.components.find((w)=>w.id===e),t=n.packet.codeRegions?.find((w)=>w.id===e),p=n.changes[e]?.kind;if(!o&&p!=="changed")return null;return{round:o?.round??n.packet.round,action:o?.decision.action,words:(o?.decision.feedback??"").trim(),beforeUrl:a?.role==="asset"?a.preview.url:void 0,wasCode:a?.role==="plan"||!a&&!!t,wasKind:a?.kind??t?.kind,wasNote:a?.note??t?.note??""}}function Qe(e,n,o,a,t,p=4,w){let g=e.length,M=Math.max(0,Math.min(o-t,(n-a*(g-1))/e.reduce((z,v)=>z+v,0))),j=Math.max(0,Math.min(n,(o-g*t-a*(g-1))/e.reduce((z,v)=>z+1/v,0)));if(w)M=Math.min(M,w.h*p),j=Math.min(j,w.w*p);let k=e.reduce((z,v)=>z+v*M*M,0),m=e.reduce((z,v)=>z+j*j/v,0);return k>=m?{direction:"row",sizes:e.map((z)=>({w:z*M,h:M}))}:{direction:"column",sizes:e.map((z)=>({w:j,h:j/z}))}}function Ze(e,n,o,a,t,p){return{x:t-e*o*p,y:t-n*a*p}}function Ue(e,n,o){return Ri(e).map((a)=>({id:a.id,name:a.name,state:jn(a,n),current:a.id===o}))}function Ae(e,n){let o=Cn(e,n);if(o.mode==="approve")return"Approve plan and assets";return`Send notes (${[o.revise?`${o.revise} ${o.revise===1?"note":"notes"}`:"",o.reclassify?`${o.reclassify} to become ${o.reclassify===1?"an image":"images"}`:"",o.missing?`${o.missing} missing`:""].filter(Boolean).join(", ")})`}var Le=zi+`
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
`;var Ne=new Map;function Ei(e){let n=e.querySelector('.ks-instrument-key:is(.is-active, [aria-selected="true"], [aria-pressed="true"])');if(!n){if(e.classList.contains("has-thumb"))e.classList.remove("has-thumb");return}let o=e.getBoundingClientRect(),a=n.getBoundingClientRect();if(!o.width)return;let t=getComputedStyle(e),p=o.width/parseFloat(t.width)||1,w=parseFloat(t.borderLeftWidth)||0,g=Math.round(((a.left-o.left)/p-w+e.scrollLeft)*100)/100,M=Math.round(a.width/p*100)/100,j=e.querySelector(":scope > .ks-thumb"),k=e.dataset.ksStrip;if(!j){j=document.createElement("span"),j.className="ks-thumb",j.setAttribute("aria-hidden","true"),e.appendChild(j);let z=k?Ne.get(k):void 0;if(z&&(z.x!==g||z.w!==M))j.style.transition="none",j.style.width=`${z.w}px`,j.style.transform=`translateX(${z.x}px)`,j.offsetWidth,j.style.transition=""}if(k)Ne.set(k,{x:g,w:M});if(j.style.width!==`${M}px`)j.style.width=`${M}px`;let m=`translateX(${g}px)`;if(j.style.transform!==m)j.style.transform=m;if(!e.classList.contains("has-thumb"))e.classList.add("has-thumb")}function Se(e,n,o){if(e.dataset.thumb)return;e.dataset.thumb="1",Ei(e);let a=new MutationObserver((z)=>{if(z.some((v)=>v.target!==e&&!v.target.classList?.contains("ks-thumb")))Ei(e)});a.observe(e,{subtree:!0,attributes:!0,attributeFilter:["class","aria-selected","aria-pressed"],childList:!0});let t=new ResizeObserver(()=>Ei(e));t.observe(e);let p=null,w=!1,g=0,M=null,j=(z,v)=>n.elementFromPoint(z,v)?.closest(".ks-instrument-key")??null;e.addEventListener("pointerdown",(z)=>{if(!["mouse","pen"].includes(z.pointerType)||!z.isPrimary||z.button!==0||p!==null)return;p=z.pointerId,w=!1,g=z.clientX,M=j(z.clientX,z.clientY)}),e.addEventListener("pointermove",(z)=>{if(z.pointerId!==p)return;if(!w&&Math.abs(z.clientX-g)<6)return;w=!0;let v=j(z.clientX,z.clientY);if(v&&v!==M&&e.contains(v))M=v,v.click()});let k=()=>{p=null,w=!1,M=null},m=(z)=>{if(z.pointerId===p)k()};window.addEventListener("pointerup",m),window.addEventListener("pointercancel",m),window.addEventListener("blur",k),o.push(()=>{a.disconnect(),t.disconnect(),window.removeEventListener("pointerup",m),window.removeEventListener("pointercancel",m),window.removeEventListener("blur",k)})}function Yi(e){let n=[];return e.querySelectorAll(".ks-instrument-strip").forEach((o)=>Se(o,e,n)),document.fonts?.ready.then(()=>e.querySelectorAll(".ks-instrument-strip").forEach(Ei)),()=>n.forEach((o)=>o())}var X=(e)=>e.replace(/[&<>"']/g,(n)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]),Xi=(e)=>`${e*100}%`,Kn=(e)=>{let n=new URL(e,location.href);if(!["http:","https:"].includes(n.protocol))throw Error("Unsupported preview URL");return X(n.href)},Pn=(e)=>`left:${Xi(e.x)};top:${Xi(e.y)};width:${Xi(e.w)};height:${Xi(e.h)}`,_e=(e)=>`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${e}</svg>`,Ji={check:_e('<path d="m3 8.5 3 3 7-7"/>'),alert:_e('<path d="M8 2 1.5 13.5h13L8 2Z"/><path d="M8 6.5v3.2M8 11.6v.1"/>')},Yn=(e)=>`<kbd class="cap">${e}</kbd>`,Un={plate:"illustration",image:"photo",texture:"texture"};function nr(e){let n=e.match(/^review is stale:\s*(.+?)\s+changed\b/i);if(n)return`${n[1]} changed after this round was prepared.`;let o=e.replace(/;?\s*prepare a new round\.?\s*$/i,"").trim();return o?`${o[0].toUpperCase()}${o.slice(1)}${/[.!?]$/.test(o)?"":"."}`:""}var Be={get(e){try{return localStorage.getItem(e)}catch{return null}},set(e,n){try{localStorage.setItem(e,n)}catch{}}};function Ke(e,n,o){let a=e.shadowRoot??e.attachShadow({mode:"open"}),t={...Xe(n),...structuredClone(o.initialDraft??{})};t.reclassify??=[];let p=Ri(n),w=Ti(n),g=o.history??null,M=new URLSearchParams(location.search),j=!!o.completed,k=j?"summary":["intro","stage","summary"].includes(M.get("view")??"")?M.get("view"):"intro",m=(M.get("item")&&p.some((r)=>r.id===M.get("item"))?M.get("item"):void 0)??p.find((r)=>jn(r,t)==="pending")?.id??p[0]?.id,z=null,v=null,f=null,Q=!1,Z=!1,dn=!1,xn={},U=!1,Qn=!1,Xn="",O=null,C=Be.get("impeccable.review.flipHint")==="1",bn=null,W=null,Ln=new Map,hn=new Map,fn=null,pn=()=>matchMedia("(prefers-reduced-motion: reduce)").matches,D=(r)=>n.components.find((s)=>s.id===r),Zn=(r)=>w.find((s)=>s.id===r),F=()=>j||U||!!o.status,kn=(r)=>r.w*n.comp.width/(r.h*n.comp.height),an=new Image;an.onload=()=>{try{let r=Math.min(1,480/an.naturalWidth),s=document.createElement("canvas");s.width=Math.max(1,Math.round(an.naturalWidth*r)),s.height=Math.max(1,Math.round(an.naturalHeight*r));let l=s.getContext("2d",{willReadFrequently:!0});if(l.drawImage(an,0,0,s.width,s.height),fn={data:l.getImageData(0,0,s.width,s.height).data,width:s.width,height:s.height},k==="stage")A()}catch{}},an.src=new URL(n.comp.url,location.href).href;function mn(r){if(!hn.has(r.id)&&fn)hn.set(r.id,$e(Je(fn.data,fn.width,fn.height,r.box))??"");return hn.get(r.id)||n.comp.background||"var(--ks-paper-deep)"}function Hn(r,s){if(r.material?.alpha==="transparent")return!0;if(r.material?.alpha==="opaque")return!1;if(Ln.has(s))return Ln.get(s);if(Ln.set(s,!1),!/\.(png|webp)(\?|$)/i.test(s))return!1;let l=new Image;return l.onload=()=>{try{let h=Math.min(1,160/Math.max(l.naturalWidth,l.naturalHeight)),b=document.createElement("canvas");b.width=Math.max(1,Math.round(l.naturalWidth*h)),b.height=Math.max(1,Math.round(l.naturalHeight*h));let x=b.getContext("2d",{willReadFrequently:!0});x.drawImage(l,0,0,b.width,b.height);let c=x.getImageData(0,0,b.width,b.height).data;for(let u=3;u<c.length;u+=4)if(c[u]<250){if(Ln.set(s,!0),k==="stage")A();break}}catch{}},l.src=new URL(s,location.href).href,!1}function rn(r,s,l="fade"){if(s)m=s;if(z=pn()?null:l,k=r,v=null,dn=!1,Z=!1,r!=="summary")f=null,Q=!1;A();let h=r==="intro"?"start":r==="stage"?"decide-yes":"send";a.getElementById(h)?.focus({preventScroll:!0})}function Nn(r){if(k!=="stage"||!p.length)return;let s=p.findIndex((l)=>l.id===m)+r;if(s>=p.length)return rn("summary",void 0,"next");if(s<0)return;rn("stage",p[s].id,r>0?"next":"prev")}function li(r,s){if(O)clearTimeout(O.timer);O={label:r,before:s,view:k,current:m,timer:window.setTimeout(()=>{O=null,a.querySelector(".toast")?.classList.add("gone")},6000)}}function Tn(r,s){let l=t;t=r,v=null,Xn="",li(s,l)}function Sn(){let r=p.findIndex((l)=>l.id===m),s=[...p.slice(r+1),...p.slice(0,r+1)].find((l)=>jn(l,t)==="pending");if(s)rn("stage",s.id,"next");else rn("summary",void 0,"next")}function Jn(){let r=D(m);if(k!=="stage"||!r||F()||v)return;Tn(Pi(t,r,"approve"),`${r.role==="asset"?"Approved":"Kept in code"}: ${r.name}.`),Sn()}function Wn(r,s){if(F())return;let l=s?Zn(s):void 0,h=l?void 0:D(m),b=h??l;if(!b||h&&r==="reclassify"&&h.role!=="plan")return;let x=h?Gn(h,t):void 0,c=l?qi(t,l.id):void 0;v={type:r,id:b.id,region:!!l,text:x?.action===r?x.feedback:c?.feedback??"",kind:x?.kind??c?.kind??Ci({name:b.name,note:b.note??"",flags:h?.flags})},A(),a.getElementById("form-text")?.focus()}function ni(){if(!v||F())return;let r=v;if(r.region){let l=Zn(r.id);Tn(Si(t,l.id,{kind:r.kind,feedback:r.text}),`${l.name} will become ${Un[r.kind]}.`),A();return}let s=D(r.id);if(r.type==="revise"&&s.role==="plan"&&!r.text.trim()){a.getElementById("form-text")?.focus();return}Tn(Pi(t,s,r.type,{feedback:r.text,kind:r.kind}),r.type==="revise"?`Noted: ${s.name}.`:`${s.name} will become ${Un[r.kind]}.`),Sn()}function In(){if(!O||F())return;let r=O;clearTimeout(r.timer),O=null,t=r.before,rn(r.view,r.current,"prev")}async function di(){let r=Cn(n,t);if(U||j||v||!r.canSubmit||o.status)return;U=!0,Xn="",A();try{await o.onSubmit(Ye(n,t)),j=!0,Qn=!0,Q=!1,O=null}catch(s){Xn=s instanceof Error?s.message:"The review could not be saved."}finally{U=!1,A()}}function xi(r){let s=`missing-${crypto.randomUUID()}`;t={...t,inventoryConfirmed:!1,missing:[...t.missing,{id:s,name:"",feedback:"",box:r}]},Q=!1,f={type:"missing",id:s},A(),a.getElementById("missing-name")?.focus()}let J=(r)=>{let s=jn(r,t);if(s==="approved")return r.role==="asset"?"Looks good":"Code is fine";if(s==="revise")return"Needs work";if(s==="reclassify")return`Becomes ${Un[Gn(r,t).kind]}`;return j?"Not decided":"To decide"},Y=(r,s="")=>`<span class="pic crop ${s}"><img src="${Kn(n.comp.url)}" alt="" draggable="false" style="width:${100/r.w}%;left:${-100*r.x/r.w}%;top:${-100*r.y/r.h}%"></span>`,$=(r,s,l="gen")=>{let h=Hn(r,s),b=xn[r.id]??"comp",x=!h?"":b==="light"?"var(--ks-paper-raised)":b==="dark"?"var(--ks-instrument)":mn(r);return`<span class="pic ${l}" style="${x?`background:${X(x)}`:""}"><img src="${Kn(s)}" alt="" draggable="false"></span>`};function N(r){return[...r.code?w.map((l)=>({kind:"region",id:l.id,name:l.name,box:l.box,cls:`code ${qi(t,l.id)?"reclassify":""}`})):[],...n.components.map((l)=>({kind:"item",id:l.id,name:l.name,box:l.box,cls:`is-${l.role} ${Fi(l)?"flagged":""} ${jn(l,t)}`})),...t.missing.map((l)=>({kind:"missing",id:l.id,name:l.name||"Missing",box:l.box,cls:"missing"}))].sort((l,h)=>h.box.w*h.box.h-l.box.w*l.box.h).map((l)=>{let h=f?.id===l.id||Z&&k==="stage"&&l.id===m,b=`<span class="tag">${X(l.name)}</span>`;return r.interactive?`<button type="button" class="region ${l.cls} ${h?"selected":""} ${l.box.y<0.06?"tag-below":""} ${l.box.x>0.7?"tag-right":""}" style="${Pn(l.box)}" data-${l.kind}="${X(l.id)}" aria-label="${X(l.name)}">${b}</button>`:`<span class="region ${l.cls}" style="${Pn(l.box)}"></span>`}).join("")}function H(){let r=Ue(n,t,k==="stage"?m:void 0),s=r.filter((l)=>l.state!=="pending").length;return`<header class="bar">
      <div class="bar-title"><span class="bar-name">${X(n.title)}</span><span class="bar-round">Round ${n.round}</span></div>
      ${p.length?`<nav class="lights ${r.length>20?"dense":""}" aria-label="Progress, ${s} of ${r.length} decided">${r.map((l,h)=>`<button type="button" class="light ${l.state==="pending"?"":"decided"} ${l.current?"current":""}" data-go="${X(l.id)}" aria-label="${X(`${h+1}. ${l.name}: ${J(D(l.id))}`)}" ${l.current?'aria-current="step"':""}><span class="tip">${X(l.name)}</span></button>`).join("")}<button type="button" class="lights-summary ${k==="summary"?"current":""}" id="to-summary">Summary</button></nav>`:""}
      ${k==="stage"?`<button type="button" class="bar-locator" id="open-map-bar" aria-label="Open the comp">${Y({x:0,y:0,w:1,h:1})}</button>`:""}
    </header>`}function R(){if(o.status)return`<div class="banner stale" role="alert">${Ji.alert}<div><strong>This review is out of date.</strong><p>${X(nr(o.status))} Ask the agent to prepare a new round, then reload this page.</p></div><button id="reload" class="ks-button ks-button-secondary">Reload</button></div>`;if(Xn)return`<div class="banner error" role="alert">${Ji.alert}<div><strong>Your decisions were not sent.</strong><p>${X(Xn)}</p></div><button id="retry" class="ks-button ks-button-secondary">Try again</button></div>`;return""}function $n(){let r=!!g&&n.round>1;return`<div class="intro ${z?`enter-${z}`:""}">
      <div class="intro-copy">
        <p class="eyebrow">${r?`Round ${n.round}`:"Before any page code"}</p>
        <h1>${r?"Check what changed.":"Review the plan and assets."}</h1>
        <p class="lead">${X(Ge(n,t,g))}</p>
        <dl class="kinds-explained">
          <div><dt><i class="swatch asset"></i>A generated image</dt><dd>Does it match the comp?</dd></div>
          <div><dt><i class="swatch plan"></i>A region drawn in code</dt><dd>Can code do it justice, or should it be an image?</dd></div>
        </dl>
        <button type="button" class="ks-button ks-button-primary" id="start">Start${Yn("↵")}${Bn}</button>
      </div>
      <figure class="intro-comp"><div class="map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img class="comp" src="${Kn(n.comp.url)}" alt="The approved comp" draggable="false">${N({code:!1,interactive:!1})}</div></figure>
    </div>`}function P(r){let s=Vi(r.id,g),l=kn(r.box),h=`${r.box.w*n.comp.width}x${r.box.h*n.comp.height}`;if(r.role==="asset"&&r.preview.url){let b=r.preview.url,x=Hn(r,b),c=xn[r.id]??"comp",u=x?`<button type="button" class="ks-switch backdrop-switch" id="backdrop" aria-pressed="${c!=="comp"}" title="Backdrop behind the transparent image"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">${c==="comp"?"On comp colour":c==="light"?"On light":"On dark"}</span></button>`:"",q=`<figure class="fig" data-role="generated"><figcaption><span class="eyebrow">${dn?"In the comp":s?.beforeUrl?"After":"Generated"}</span>${u}</figcaption><div class="frame ${dn?"flipped":""}">${$(r,b)}${Y(r.box,"flip")}</div></figure>`,L=`<figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${Y(r.box)}</div></figure>`;if(s?.beforeUrl){let K=`<figure class="fig"><figcaption><span class="eyebrow">Before · round ${s.round}</span></figcaption><div class="frame">${$(r,s.beforeUrl,"gen before")}</div></figure>`;return`<div class="figures" data-ratios="${l},${l},${l}" data-natural="${h}">${K}${q}${L}</div>`}return`<div class="figures" data-ratios="${l},${l}" data-natural="${h}">${L}${q}</div>`}if(r.role==="asset")return'<div class="figures empty"><p>This image has no generated file.</p></div>';return`<div class="figures single" data-box="${X(JSON.stringify(r.box))}"><figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${Y(r.box)}<span class="focus-box"></span></div></figure></div>`}function ii(r){if(j)return`<div class="decide-bar"><p class="record">${X(J(r))}${Gn(r,t)?.feedback?`: “${X(Gn(r,t).feedback)}”`:"."}</p></div>`;if(v&&!v.region){let h=v.type==="reclassify",b=!h&&r.role==="plan";return`<form class="decide-bar form" id="decision-form">
        ${h?`<div class="form-row"><span class="eyebrow" id="kinds-label">Make it</span><div class="ks-instrument-strip is-paper" data-ks-strip="kind" role="group" aria-labelledby="kinds-label">${Di.map((x)=>`<button type="button" class="ks-instrument-key" data-kind="${x.kind}" aria-pressed="${v.kind===x.kind}">${x.label}</button>`).join("")}</div></div>`:""}
        <label class="field"><span class="eyebrow">${h?"Anything the image should keep? Optional":b?"What should change?":"What needs to change? Optional"}</span><textarea id="form-text" rows="2" placeholder="${h?"For example: keep the brushed direction horizontal.":b?"For example: extend the hero photo under the nav.":"For example: the figure should face the sea."}">${X(v.text)}</textarea></label>
        <div class="form-actions"><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel${Yn("Esc")}</button><button type="submit" class="ks-button ks-button-primary">${h?"Make it an image":"Save note"}${Yn("⌘↵")}</button></div>
      </form>`}let s=Gn(r,t),l=r.role==="asset";return`<div class="decide-bar">
      ${s?`<p class="current-decision">${s.action==="approve"?Ji.check:""}<span>${X(J(r))}${s.feedback?`: “${X(s.feedback)}”`:"."}</span><button type="button" class="text-action" id="decision-clear">Clear</button></p>`:""}
      <div class="decisions">
        <button type="button" id="decide-yes" class="ks-button ks-button-primary">${l?"Looks good":"Code is fine"}${Yn("A")}</button>
        <button type="button" id="decide-no" class="ks-button ks-button-secondary">${l?"Needs work":"Make it an image"}${Yn("N")}</button>
        ${l?"":`<button type="button" id="decide-other" class="ks-button ks-button-ghost">Something else…${Yn("F")}</button>`}
      </div>
    </div>`}function $i(){let r=D(m);if(!r)return'<div class="stage"><p>Nothing to review.</p></div>';let s=p.findIndex((c)=>c.id===r.id)+1,l=Vi(r.id,g),h=r.role==="plan"?[...(r.flags??[]).map(Ve),...r.codeDrawn?["The plan draws this artwork in code."]:[]]:[],b=(r.note??"").trim(),x=r.role==="plan"?`<p class="sentence"><strong>Will be drawn in code:</strong> ${X(b||qe(r).toLowerCase())}</p>`:l?.wasCode?`<p class="sentence"><s>Was going to be drawn in code: ${X(l.wasNote)}</s> Now a generated ${X(Un[r.kind]??r.kind)}.</p>`:b?`<p class="sentence muted">${X(b)}</p>`:"";return`<div class="stage ${r.role==="plan"?"is-single":""} ${z?`enter-${z}`:""}">
      <div class="stage-head">
        <p class="eyebrow">${r.role==="asset"?`Generated ${X(Un[r.kind]??r.kind)}`:`Drawn in code · ${X(r.kind)}`} · ${s} of ${p.length}</p>
        <h1>${X(r.name)}</h1>
        ${l?.words?`<blockquote class="asked"><span class="eyebrow">You asked in round ${l.round}</span><p>“${X(l.words)}”</p></blockquote>`:""}
      </div>
      ${P(r)}
      <div class="stage-foot">
        ${x}
        ${h.map((c)=>`<p class="flag">${X(c)}</p>`).join("")}
        ${r.role==="asset"&&!C&&!j?`<p class="hint">Hold ${Yn("Space")} to flip to the comp. Hover to magnify both.</p>`:""}
      </div>
      <button type="button" class="locator" id="open-map" aria-label="Open the comp"><span class="locator-map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img src="${Kn(n.comp.url)}" alt="" draggable="false"><span class="locator-box" style="${Pn(r.box)}"></span></span><span class="locator-label">Comp ${Yn("C")}</span></button>
    </div>
    ${ii(r)}`}function Gi(){if(f?.type==="missing"){let r=t.missing.find((s)=>s.id===f.id);if(!r)return"";return`<div class="side-panel"><p class="eyebrow missing">Missing from the review</p>
        <label class="field"><span class="eyebrow">Name</span><input id="missing-name" value="${X(r.name)}" placeholder="For example: harbour boat" ${F()?"disabled":""}></label>
        <label class="field"><span class="eyebrow">What is missing? Optional</span><textarea id="missing-feedback" rows="2" ${F()?"disabled":""}>${X(r.feedback)}</textarea></label>
        <div class="form-actions start"><button type="button" id="panel-done" class="ks-button ks-button-secondary">Done</button>${F()?"":'<button type="button" id="missing-remove" class="ks-button ks-button-ghost">Remove</button>'}</div></div>`}if(f?.type==="region"){let r=Zn(f.id);if(!r)return"";let s=qi(t,r.id),l=v?.region&&v.id===r.id;return`<div class="side-panel"><p class="eyebrow">Set in code · ${X(r.kind)}</p><h3>${X(r.name)}</h3>
        <div class="panel-crop" style="aspect-ratio:${Math.max(0.5,Math.min(6,kn(r.box)))}">${Y(r.box)}</div>
        ${l?`<form id="decision-form" class="panel-form"><div class="ks-instrument-strip is-paper" data-ks-strip="region-kind" role="group" aria-label="Make it">${Di.map((h)=>`<button type="button" class="ks-instrument-key" data-kind="${h.kind}" aria-pressed="${v.kind===h.kind}">${Un[h.kind][0].toUpperCase()+Un[h.kind].slice(1)}</button>`).join("")}</div><textarea id="form-text" rows="2" placeholder="Anything the image should keep? Optional">${X(v.text)}</textarea><div class="form-actions start"><button type="submit" class="ks-button ks-button-primary">Make it an image</button><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel</button></div></form>`:s?`<p class="current-decision"><span>Becomes ${X(Un[s.kind])}${s.feedback?`: “${X(s.feedback)}”`:"."}</span>${F()?"":'<button type="button" class="text-action" id="region-keep">Keep in code</button>'}</p>`:`<p class="muted">Checked in the first-viewport review, once the page is built.</p><div class="form-actions start">${F()?"":'<button type="button" class="ks-button ks-button-secondary" id="region-image">Make it an image</button>'}<button type="button" id="panel-done" class="ks-button ks-button-ghost">Close</button></div>`}
      </div>`}return`<div class="side-panel quiet"><p>Every outlined region above was on your list. Hover the comp to see what is set in code; click a region to make it an image.</p>${F()?"":`<button type="button" class="ks-button ks-button-secondary" id="mark" aria-pressed="${Q}">${Q?"Cancel marking":"Mark missing"}</button>`}${Q?'<p class="marking-hint">Drag on the comp around what is missing.</p>':""}${t.missing.length?`<ul class="missing-list">${t.missing.map((r)=>`<li><button type="button" class="text-action" data-missing="${X(r.id)}">${X(r.name||"Unnamed missing piece")}</button></li>`).join("")}</ul>`:""}</div>`}function Qi(){let r=Cn(n,t),s=o.status?"This round can no longer be sent.":r.pending&&!r.hasChanges?`${r.pending} still to decide.`:r.mode==="approve"?"Approval confirms nothing is missing from the comp.":`${r.pending?`${r.pending} undecided stay open. `:""}The agent applies your notes and opens a new round.`,l=(h)=>{let b=Gn(h,t),x=jn(h,t),c;if(h.role==="asset"&&h.preview.url){let u=kn(h.box);c=`<span class="card-pic" style="aspect-ratio:${u};width:min(100%, ${Math.round(118*u)}px)">${$(h,h.preview.url)}</span>`}else{let u=ne(h.box,n.comp.width,n.comp.height,220,118),q=u.view;c=`<span class="card-pic" style="width:${Math.floor(u.width)}px;height:${Math.floor(u.height)}px"><span class="pic crop"><img src="${Kn(n.comp.url)}" alt="" draggable="false" style="width:${100/q.w}%;left:${-100*q.x/q.w}%;top:${-100*q.y/q.h}%"></span><span class="focus-box" style="${Pn({x:(h.box.x-q.x)/q.w,y:(h.box.y-q.y)/q.h,w:h.box.w/q.w,h:h.box.h/q.h})}"></span></span>`}return`<button type="button" class="card ${x}" data-go="${X(h.id)}"><span class="card-thumb">${c}</span><span class="card-text"><span class="card-name">${X(h.name)}</span><span class="card-state">${x==="approved"?Ji.check:""}${X(J(h))}</span>${b?.feedback?`<span class="card-note">“${X(b.feedback)}”</span>`:""}</span></button>`};return`<div class="summary ${z?`enter-${z}`:""}">
      <div class="summary-head">
        <p class="eyebrow">${j?`Round ${n.round} · sent`:"Summary"}</p>
        <h1>${j?r.hasChanges?"Notes sent.":"Plan and assets approved.":r.pending?"Almost there.":"Your decisions."}</h1>
        ${j?`<p class="lead">${r.hasChanges?"The agent applies them and opens a new round for anything that changed.":"The agent continues to the first viewport."}${Qn?"":" This round is read-only."}</p>`:""}
      </div>
      <div class="sheet">${p.map(l).join("")}</div>
      <section class="coverage" aria-label="Coverage">
        <h2>Anything on the comp we didn't cover?</h2>
        <div class="coverage-grid">
          <div class="map-space"><div class="map ${Q?"marking":""} ${f?"has-selection":""}" id="summary-map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img class="comp" src="${Kn(n.comp.url)}" alt="The approved comp" draggable="false">${N({code:!0,interactive:!0})}<div class="draw-box" hidden></div></div></div>
          ${Gi()}
        </div>
      </section>
    </div>
    ${j?"":`<div class="send-row"><div class="send-inner"><p>${X(s)}</p><button type="button" class="ks-button ks-button-primary" id="send" ${!r.canSubmit||!!v||U||!!o.status?"disabled":""}>${U?"Sending…":X(Ae(n,t))}${U?"":Bn}</button></div></div>`}`}function hi(){if(!Z)return"";return`<div class="overlay" role="dialog" aria-modal="true" aria-label="The comp"><div class="overlay-head"><span class="eyebrow">The comp · click a region to go to it</span><button type="button" class="ks-button ks-button-ghost" id="close-map">Close${Yn("Esc")}</button></div>
      <div class="overlay-body"><div class="map has-selection" id="overlay-map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img class="comp" src="${Kn(n.comp.url)}" alt="The approved comp" draggable="false">${N({code:!0,interactive:!0})}</div></div></div>`}function A(){bn?.disconnect(),W?.();let s=a.activeElement?.id,l=k==="summary"?a.querySelector(".view-summary .screen")?.scrollTop??0:0;a.innerHTML=`<style>${Le}</style><section class="rv view-${k} ${j?"is-submitted":""}" aria-label="Plan and asset review">
      ${H()}${R()}
      <main class="screen">${k==="intro"?$n():k==="stage"?$i():Qi()}</main>
      ${O?`<div class="toast" role="status"><span>${X(O.label)}</span><button type="button" class="text-action" id="undo">Undo${Yn("⌘Z")}</button></div>`:""}
      ${hi()}
    </section>`,z=null;let h=a.querySelector(".screen");if(h&&l)h.scrollTop=l;if(s)a.getElementById(s)?.focus({preventScroll:!0});if(on(),ki(),bn=new ResizeObserver(ki),bn.observe(a.querySelector(".screen")),W=Yi(a),!j)o.onDraftChange?.(structuredClone(t))}function ki(){let r=matchMedia("(max-width: 760px)").matches,s=a.querySelector(".figures[data-ratios]");if(s&&s.clientWidth){let h=s.dataset.ratios.split(",").map(Number),[b,x]=(s.dataset.natural??"0x0").split("x").map(Number),c=r?{direction:"column",sizes:h.map((u)=>({w:Math.min(s.clientWidth,360*u),h:Math.min(s.clientWidth,360*u)/u}))}:Qe(h,s.clientWidth,s.clientHeight,28,30,4,{w:b,h:x});s.dataset.direction=c.direction,s.querySelectorAll(":scope > .fig > .frame").forEach((u,q)=>{u.style.width=`${Math.floor(c.sizes[q].w)}px`,u.style.height=`${Math.floor(c.sizes[q].h)}px`}),I(s)}let l=a.querySelector(".figures.single");if(l?.clientWidth){let h=JSON.parse(l.dataset.box),b=l.closest(".stage"),x=b.clientHeight-36-28-(b.querySelector(".stage-head")?.offsetHeight??0)-(b.querySelector(".stage-foot")?.offsetHeight??0)-30-80,c=ne(h,n.comp.width,n.comp.height,Math.min(l.clientWidth,1120),r?320:Math.max(80,x)),u=l.querySelector(".frame"),q=u.querySelector("img"),L=u.querySelector(".focus-box"),K=c.view;u.style.width=`${Math.floor(c.width)}px`,u.style.height=`${Math.floor(c.height)}px`,q.style.cssText=`width:${100/K.w}%;left:${-100*K.x/K.w}%;top:${-100*K.y/K.h}%`,L.style.cssText=Pn({x:(h.x-K.x)/K.w,y:(h.y-K.y)/K.h,w:h.w/K.w,h:h.h/K.h}),I(l)}for(let h of a.querySelectorAll(".overlay-body .map, .intro-comp .map")){let b=h.parentElement,x=getComputedStyle(b),c=b.clientWidth-parseFloat(x.paddingLeft)-parseFloat(x.paddingRight),u=b.clientHeight-parseFloat(x.paddingTop)-parseFloat(x.paddingBottom);if(!c||!u)continue;let q=Math.min(c/n.comp.width,u/n.comp.height);h.style.width=`${n.comp.width*q}px`,h.style.height=`${n.comp.height*q}px`}}let ei=78,G=3;function I(r){r.querySelectorAll(".frame").forEach((s)=>{s.querySelector(".lens")?.remove();let l=document.createElement("span");l.className="lens",l.setAttribute("aria-hidden","true");let h=document.createElement("span");h.className="lens-inner",h.style.width=`${s.clientWidth}px`,h.style.height=`${s.clientHeight}px`,s.querySelectorAll(":scope > .pic, :scope > .focus-box").forEach((b)=>h.append(b.cloneNode(!0))),l.append(h),s.append(l)})}function S(r,s){a.querySelectorAll(".figures .frame").forEach((l)=>{let h=l.querySelector(".lens"),b=h?.querySelector(".lens-inner");if(!h||!b)return;let{clientWidth:x,clientHeight:c}=l;h.style.transform=`translate(${r*x-ei}px, ${s*c-ei}px)`;let u=Ze(r,s,x,c,ei,G);b.style.transform=`translate(${u.x}px, ${u.y}px) scale(${G})`})}function on(){let r=(x,c)=>a.getElementById(x)?.addEventListener("click",c);r("start",()=>{let x=p.find((c)=>jn(c,t)==="pending")??p[0];if(x)rn("stage",x.id,"next");else rn("summary")}),a.querySelectorAll("[data-go]").forEach((x)=>x.addEventListener("click",()=>{let c=x.dataset.go,u=p.findIndex((q)=>q.id===m);rn("stage",c,k!=="stage"?"fade":p.findIndex((q)=>q.id===c)>=u?"next":"prev")})),r("to-summary",()=>rn("summary",void 0,"next")),r("decide-yes",Jn),r("decide-no",()=>Wn(D(m)?.role==="asset"?"revise":"reclassify")),r("decide-other",()=>Wn("revise")),r("decision-clear",()=>{let x=D(m);if(x&&!F())Tn(Ee(t,x.id),`Cleared: ${x.name}.`),A()}),r("form-cancel",()=>{v=null,A()}),a.getElementById("decision-form")?.addEventListener("submit",(x)=>{x.preventDefault(),ni()}),a.getElementById("form-text")?.addEventListener("input",(x)=>{if(v)v.text=x.target.value}),a.querySelectorAll("[data-kind]").forEach((x)=>x.addEventListener("click",()=>{if(!v)return;v.kind=x.dataset.kind,a.querySelectorAll("[data-kind]").forEach((c)=>c.setAttribute("aria-pressed",String(c===x)))})),r("backdrop",()=>{let x=D(m);if(!x)return;let c=["comp","light","dark"];xn[x.id]=c[(c.indexOf(xn[x.id]??"comp")+1)%3],A()}),r("undo",In),r("send",()=>void di()),r("retry",()=>void di()),r("reload",()=>location.reload());let s=()=>{Z=!0,A(),a.getElementById("close-map")?.focus()};if(r("open-map",s),r("open-map-bar",s),r("close-map",()=>{Z=!1,A()}),r("mark",()=>{if(F())return;Q=!Q,f=null,v=null,A()}),r("panel-done",()=>{f=null,v=null,A()}),r("region-image",()=>{if(f?.type==="region")Wn("reclassify",f.id)}),r("region-keep",()=>{let x=f?.type==="region"?Zn(f.id):void 0;if(x&&!F())Tn(Si(t,x.id,null),`${x.name} stays in code.`),A()}),r("missing-remove",()=>{if(f?.type!=="missing")return;let x=f.id;t={...t,missing:t.missing.filter((c)=>c.id!==x)},f=null,A()}),a.getElementById("missing-name")?.addEventListener("input",(x)=>{let c=t.missing.find((u)=>u.id===f?.id);if(c){c.name=x.target.value;let u=a.getElementById("send");if(u)u.disabled=!Cn(n,t).canSubmit||U||!!o.status;o.onDraftChange?.(structuredClone(t))}}),a.getElementById("missing-feedback")?.addEventListener("input",(x)=>{let c=t.missing.find((u)=>u.id===f?.id);if(c)c.feedback=x.target.value,o.onDraftChange?.(structuredClone(t))}),F())a.querySelectorAll("#decide-yes,#decide-no,#decide-other,#decision-clear,#mark,#region-image").forEach((x)=>x.disabled=!0);a.querySelectorAll(".map [data-item]").forEach((x)=>x.addEventListener("click",()=>{if(!Q)rn("stage",x.dataset.item,"fade")}));let l=(x)=>{if(Q)return;if(f=x,v=null,k!=="summary")k="summary",Z=!1,z=pn()?null:"fade";A(),a.querySelector(".coverage")?.scrollIntoView({block:"start"})};a.querySelectorAll("[data-region]").forEach((x)=>x.addEventListener("click",()=>l({type:"region",id:x.dataset.region}))),a.querySelectorAll("[data-missing]").forEach((x)=>x.addEventListener("click",()=>l({type:"missing",id:x.dataset.missing})));let h=a.querySelector(".figures");h?.querySelectorAll(":scope > .fig > .frame").forEach((x)=>{x.addEventListener("pointerenter",(c)=>{if(c.pointerType==="mouse")h.classList.add("looking")}),x.addEventListener("pointerleave",()=>h.classList.remove("looking")),x.addEventListener("pointermove",(c)=>{let u=x.getBoundingClientRect();S((c.clientX-u.left)/u.width,(c.clientY-u.top)/u.height)})});let b=a.getElementById("summary-map");if(b){let x=(q)=>{let L=b.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(q.clientX-L.left)/L.width)),y:Math.max(0,Math.min(1,(q.clientY-L.top)/L.height))}},c=null,u=null;b.addEventListener("pointerdown",(q)=>{if(!Q)return;c=x(q),u=null,b.setPointerCapture(q.pointerId),q.preventDefault()}),b.addEventListener("pointermove",(q)=>{if(!c)return;let L=x(q);u={x:Math.min(c.x,L.x),y:Math.min(c.y,L.y),w:Math.abs(L.x-c.x),h:Math.abs(L.y-c.y)};let K=a.querySelector(".draw-box");K.hidden=!1,K.style.cssText=Pn(u)}),b.addEventListener("pointerup",()=>{if(u&&u.w>0.01&&u.h>0.01)xi(u);c=null,u=null}),b.addEventListener("pointercancel",()=>{c=null,u=null,A()})}}function tn(r){if(dn===r)return;dn=r,a.querySelectorAll('[data-role="generated"] .frame').forEach((l)=>l.classList.toggle("flipped",r));let s=a.querySelector('[data-role="generated"] figcaption .eyebrow');if(s)s.textContent=r?"In the comp":Vi(m??"",g)?.beforeUrl?"After":"Generated";if(r&&!C)C=!0,Be.set("impeccable.review.flipHint","1"),a.querySelector(".hint")?.classList.add("gone")}let ri=(r)=>{let s=r;if(!e.isConnected||s.defaultPrevented)return;let l=s.composedPath()[0],h=l instanceof HTMLTextAreaElement||l instanceof HTMLInputElement;if(s.key==="Escape"){if(Z)s.preventDefault(),Z=!1,A();else if(v)s.preventDefault(),v=null,A();else if(Q)s.preventDefault(),Q=!1,A();else if(f)s.preventDefault(),f=null,A();return}if(s.key==="Enter"&&(s.metaKey||s.ctrlKey)&&v){s.preventDefault(),ni();return}if(h||s.altKey||s.isComposing)return;if((s.metaKey||s.ctrlKey)&&s.key.toLowerCase()==="z"){if(O)s.preventDefault(),In();return}if(s.metaKey||s.ctrlKey)return;if(k==="intro"&&s.key==="Enter"&&l?.tagName!=="BUTTON"){s.preventDefault(),a.getElementById("start")?.click();return}if(Z||v)return;let b=s.key.toLowerCase();if(s.key===" "&&k==="stage"&&D(m)?.role==="asset"&&l?.tagName!=="BUTTON"&&l?.tagName!=="A"){if(s.preventDefault(),!s.repeat)tn(!0);return}if(s.key===" "&&k==="stage"&&D(m)?.role==="asset"){if(s.preventDefault(),!s.repeat)tn(!0);return}if(b==="c"&&k!=="intro"){s.preventDefault(),Z=!0,A();return}if(k!=="stage"||F()){if(k==="summary"&&(b==="k"||s.key==="ArrowLeft")&&p.length&&!F())s.preventDefault(),rn("stage",p[p.length-1].id,"prev");return}if(b==="a")s.preventDefault(),Jn();else if(b==="n")s.preventDefault(),a.getElementById("decide-no")?.click();else if(b==="f"&&D(m)?.role==="plan")s.preventDefault(),Wn("revise");else if(b==="j"||s.key==="ArrowRight")s.preventDefault(),Nn(1);else if(b==="k"||s.key==="ArrowLeft")s.preventDefault(),Nn(-1)},ai=(r)=>{if(r.key===" "&&dn)r.preventDefault(),tn(!1)},oi=()=>tn(!1);return document.addEventListener("keydown",ri),document.addEventListener("keyup",ai),window.addEventListener("blur",oi),A(),{destroy(){bn?.disconnect(),W?.(),document.removeEventListener("keydown",ri),document.removeEventListener("keyup",ai),window.removeEventListener("blur",oi),a.replaceChildren()},getDraft(){return structuredClone(t)}}}var T=(e)=>e.replace(/[&<>"']/g,(n)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]),An=(e)=>`${e*100}%`,Mn=(e)=>{let n=new URL(e,location.href);if(!["http:","https:"].includes(n.protocol))throw Error("Unsupported preview URL");return T(n.href)};function He(e,n,o){if(Mi(n))return Ke(e,n,{...o,history:o.history,initialDraft:o.initialDraft,onDraftChange:o.onDraftChange,onSubmit:o.onSubmit});let a=e.attachShadow({mode:"open"}),t=structuredClone(o.initialDraft??ve(n)),p=n.stage==="hero"&&n.components.length===1&&!t.missing.length,w=()=>[...n.components].sort((Y,$)=>cn(Y,t,o.history).priority-cn($,t,o.history).priority),g=w().find((Y)=>cn(Y,t,o.history).kind!=="approved")?.id??n.components[0]?.id,M=Rn(n,t).pending?"pending":"reviewed",j=!1,k=!1,m=o.completed??!1,z="",v={},f=!!o.completed||!Rn(n,t).pending,Q=null,Z=!0,dn=/Mac|iPhone|iPad/.test(navigator.platform)?"⌘Enter":"Ctrl+Enter",xn=!1,U=!1,Qn=!1,Xn=null,O=!1,C=!0,bn=!1,W="comp",Ln=W,hn="fit",fn="checker",pn=!1,D="isolated",Zn,F="fit",kn=null,an=null,mn=null,Hn=null,rn='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>',Nn='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11 1 2 2-1 7-7-3-3-7 7v2Z"/></svg>',li=(Y,$)=>{if(Y.stage==="hero")return"";let N=yi(Y,$);if(!N.related.length)return"";let H=N.related.map((R)=>T(R.name)).join(" · ");return`<div class="review-scope" aria-label="Review scope"><p><strong>Reviewing</strong> ${T(N.description||$.name)}</p><p class="separate-reviews"><strong>Outlined · reviewed separately</strong> ${H}</p>${N.excluded.length?`<p class="scope-excluded">Hidden in this preview: ${N.excluded.map((R)=>T(R.name)).join(" · ")}</p>`:""}</div>`},Tn=(Y)=>`left:${An(Y.x)};top:${An(Y.y)};width:${An(Y.w)};height:${An(Y.h)}`,Sn=(Y,$)=>Y.stage==="hero"?"":yi(Y,$).related.map((N)=>{let H=$.box,R=N.box,$n=Math.max(H.x,R.x),P=Math.max(H.y,R.y),ii={x:($n-H.x)/H.w,y:(P-H.y)/H.h,w:Math.max(0,Math.min(H.x+H.w,R.x+R.w)-$n)/H.w,h:Math.max(0,Math.min(H.y+H.h,R.y+R.h)-P)/H.h};return`<span class="reference-layer" style="${Tn(ii)}" title="Reviewed separately: ${T(N.name)}" aria-label="Reviewed separately: ${T(N.name)}"><span>${T(N.name)}</span></span>`}).join("");function Jn(Y){a.getElementById(Y)?.focus({preventScroll:!0})}function Wn(Y){let $=be(n,t,Y);if(f=!$,$)g=$;W="component",pn=!1,xn=!1,hn="fit",D="isolated",Z=!0,M=f?"reviewed":"pending";let N=()=>{J(),Jn(f?"review-summary":v[g]?"feedback":"approve")};if(f&&U&&Xn)Xn(N);else N()}async function ni(){if(k||m||pn||Object.keys(v).length)return;k=!0,z="",J();try{await o.onSubmit(ce(n,t)),m=!0,f=!0,j=!1,M="reviewed"}catch(Y){z=Y instanceof Error?Y.message:"Could not save. Try again."}finally{k=!1,J()}}function In(Y){if(k||m||pn||Qn)return;let $=n.components.find((P)=>P.id===g);if(!$||!pi(n,t,$,Z,Object.keys(v)).length)return;let N=t.decisions[$.id],H=N?.revision===$.revision?N:void 0,R=pi(n,t,$,Z,Object.keys(v));Q={id:$.id,name:R.length>1?`${$.reviewGroup} · ${R.length} instances`:$.name,action:Y,previous:Object.fromEntries(R.map((P)=>[P.id,t.decisions[P.id]?{...t.decisions[P.id]}:void 0]))};let $n=v[$.id]??H;for(let P of R)t.decisions[P.id]={revision:P.revision,action:Y,feedback:Y==="revise"?$n?.feedback??"":"",split:Y==="revise"&&($n?.split??!1)};if(delete v[$.id],bn)C=!0,bn=!1;if(p)t.inventoryConfirmed=Y==="approve",Q=null,ni();else Wn($.id)}function di(){if(k||m||pn||Qn)return;let Y=n.components.find((H)=>H.id===g);if(!Y||!pi(n,t,Y,Z,Object.keys(v)).length)return;let $=t.decisions[Y.id],N=$?.revision===Y.revision?$:void 0;if(v[Y.id]??={feedback:N?.feedback??"",split:N?.split??!1},C&&(a.querySelector(".workbench")?.clientHeight??0)<420)bn=!0,C=!1;f=!1,J(),Jn("feedback")}function xi(Y){let $=`missing-${crypto.randomUUID()}`;t.missing.push({id:$,name:"Missing component",feedback:"",box:Y}),t.inventoryConfirmed=!1,f=!1,g=$,W="component",j=!1,kn=null,an=null,J(),a.querySelector("#missing-name")?.focus()}function J(){if(mn?.disconnect(),Hn?.(),m||f&&!p)U=!1;let Y=a.activeElement,$=Y?.id,N=Y?.dataset.select,H=window.scrollX,R=window.scrollY,$n=a.querySelector(".inventory")?.scrollLeft??0,P=Zn===g,ii=W==="component"&&(!P||Ln!==W);Ln=W;let $i=P?a.querySelector(".inspection-content")?.scrollTop??0:0,Gi=P&&(a.querySelector(".changed-files")?.open??!1),Qi=a.querySelector(".comparison-slot")?.clientHeight??200,hi=a.querySelector(".pan-viewport"),A=Zn===g&&F===hn,ki=A?hi?.scrollLeft??0:0,ei=A?hi?.scrollTop??0:0;Zn=g,F=hn;let G=n.components.find((i)=>i.id===g),I=t.missing.find((i)=>i.id===g),S=fe(n,t,o.history),on=S.find((i)=>i.members.some((d)=>d.id===g)),tn=!!on&&on.members.length>1&&Z,ri=tn?on.box:G?.box??I?.box,ai=on?S.indexOf(on)+1:S.length+t.missing.findIndex((i)=>i.id===g)+1,oi=G?t.decisions[G.id]:void 0,r=oi?.revision===G?.revision?oi:void 0,s=G?v[G.id]:void 0,l=Object.keys(v).length>0,h=G?wi(n,G):[],b=G?pi(n,t,G,Z,Object.keys(v)):[],x=G?!n.components.some((i)=>!b.some((d)=>d.id===i.id)&&cn(i,t).kind==="pending"):!1,c=Q&&!m?`<div class="decision-notice"><span role="status">${T(Q.name)} ${Q.action==="approve"?"approved":"flagged for repair"}.</span><button id="undo-decision" class="text-action">Undo</button></div>`:"",u=Rn(n,t),q=o.history,L=G?mi(G.id,q):void 0,K=q?.packet.components.find((i)=>i.id===G?.id),qn=pn&&!!K,V=qn?K:G,ln=qn?q.packet:n,ie=Object.values(q?.changes??{}),ee=ie.filter((i)=>i.kind==="changed").length,re=ie.filter((i)=>i.kind==="added").length,Zi=n.components.filter((i)=>cn(i,t,q).kind==="approved"&&mi(i.id,q).carried).length,Ui=(i)=>{let d=cn(i,t,q);return m&&d.kind==="feedback"?{...d,label:"Changes requested"}:d},ti=S.filter((i)=>i.kind==="pending").length,We=S.length-ti+t.missing.length,ae=S.filter((i)=>M==="all"||i.kind==="pending"===(M==="pending")).map((i)=>i.representative),Ie=(i)=>S.find((d)=>d.members.some((y)=>y.id===i))?.label??i,Oe=[u.revisions+t.missing.length?`${u.revisions+t.missing.length} feedback ready`:"",Zi?`${Zi} ${Zi===1?"approval":"approvals"} kept`:"",ee?`${ee} changed`:"",re?`${re} added`:"",q?.removed.length?`${q.removed.length} removed`:""].filter(Boolean).join(" · "),De=z||(l?"Save or cancel your open feedback before sending.":m?o.preview?"Preview submitted. No run changed.":"Review submitted.":u.hasFeedback?"Ready to send for corrections.":u.pending?`${ti} left to review`:!t.inventoryConfirmed?"Confirm the map is complete.":"Ready to continue."),Vn=V?Fn(V):null,Ai=V?.preview.kind==="image"&&!Vn?.code,Li=Ai||V?.material?.alpha==="transparent",wn=!!(V?.context&&D==="context"),oe=V&&(wn?V.context?.kind!=="image":V.preview.kind==="page"),Ni=wn&&V?.context?V.context.url:V?.preview.url,te=V?yi(ln,V):null,Fe=Vn?.code?`${Vn.label} · ${Vn.captured?"captured from code":"live preview"}`:V?.material?`${V.material.alpha==="transparent"?"Transparent":V.material.alpha==="opaque"?"Opaque":"Transparency unverified"} ${V.material.format}`:"Raster · transparency unverified";a.innerHTML=`<style>${Me}</style><section class="review ${p?"assembled-review":""}" aria-label="${p?"Assembled page review":"Component review"}" style="--comp-background:${/^#[0-9a-f]{6}$/i.test(n.comp.background??"")?n.comp.background:"#eeeeee"}">
      <header><div><h1>${m?"Review record.":p?"Review the assembled page.":"Review the components."}</h1><p>${T(n.title)} <span>· Round ${n.round}</span></p></div>${m?'<span class="badge">Submitted · read-only</span>':o.preview?'<span class="badge">Interactive preview</span>':""}</header>
      ${o.preview?'<p class="preview-note">Historical hotel artwork for testing this interface. Decisions stay in this preview; no run is changed.</p>':""}
      ${q&&!p?`<section class="round-summary" aria-label="Changes since previous round"><p><strong>${ti} ${ti===1?"item":"items"} to review</strong><span>${Oe}</span></p>${u.pending?`<button id="review-changes" class="ks-icon-button" aria-label="Next to review" title="Next to review">${zn("next")}</button>`:""}${q.removed.length?`<details><summary>Removed from the map</summary><p>${q.removed.map((i)=>T(i.name)).join(" · ")}. Confirm these omissions are intentional before accepting the map.</p></details>`:""}</section>`:""}
      ${!p?`<div class="mobile-panes"><div class="ks-instrument-strip is-paper" data-ks-strip="pane" role="group" aria-label="Inspection view"><button type="button" class="ks-instrument-key" id="show-comp" aria-pressed="${W==="comp"}">Approved comp</button><button type="button" class="ks-instrument-key" id="show-component" aria-pressed="${W==="component"}">Component ${ai}</button></div></div>`:""}
      <div class="workbench" data-mobile-pane="${W}">${!p?`<svg class="connector" aria-hidden="true"><path /></svg>
        <section class="reference" aria-label="Approved composition">
          <div class="section-head"><h2>Approved comp</h2>${!m?`<button id="mark" class="ks-button ks-button-ghost" aria-pressed="${j}">${j?"Cancel":"Mark missing"}</button>`:""}</div>
          <div class="map-space"><div class="map ${j?"marking":""}" style="aspect-ratio:${n.comp.width}/${n.comp.height}">
            <img class="comp" src="${Mn(n.comp.url)}" alt="Approved composition for ${T(n.title)}" draggable="false">
            ${ri&&!f?`<div class="region" style="${Tn(ri)}"></div>`:""}
            ${S.map((i,d)=>{let y=i.representative,E={kind:i.kind,label:i.stateLabel},un=!f&&on?.id===i.id;return`<button class="pin ${E.kind} ${un?"selected":""}" data-select="${T(y.id)}" style="left:${An(Math.min(0.96,i.box.x+i.box.w/2))};top:${An(Math.max(0.035,i.box.y))}" aria-label="Inspect ${T(i.label)}${i.members.length>1?` · ${i.members.length} instances`:""} — ${T(E.label)}" title="${d+1}. ${T(i.label)} · ${T(E.label)}" aria-pressed="${un}">${E.kind==="approved"?rn:E.kind==="feedback"?Nn:""}<span>${d+1}</span>${i.members.length>1?`<small>×${i.members.length}</small>`:""}</button>`}).join("")}
            ${tn&&!f?on.members.map((i)=>`<div class="region instance-region" style="${Tn(i.box)}"></div>`).join(""):""}
            ${t.missing.map((i,d)=>`<button class="pin feedback ${!f&&g===i.id?"selected":""}" data-select="${T(i.id)}" style="left:${An(i.box.x+i.box.w/2)};top:${An(i.box.y)}" aria-label="Inspect missing ${T(i.name)}" title="Missing: ${T(i.name)}">${Nn}<span>${S.length+d+1}</span></button>`).join("")}

            <div class="draw-box" hidden></div>
          </div></div>
          <div class="map-legend" aria-label="Map status legend"><span><i class="legend-pending">#</i> To review</span><span><i class="legend-feedback">${Nn}</i> ${m?"Changes requested":"Feedback ready"}</span><span><i class="legend-approved">${rn}</i> Approved</span></div>
          ${j?'<div class="map-caption">Draw around the missing piece.<button id="add-box">Add an adjustable box</button></div>':""}
        </section>`:""}
        <section class="inspector" aria-label="${p?"Page comparison":"Selected component"}">
          ${!p?`<div class="section-head"><h2>${f?"Review summary":`<span class="number">${ai}</span> ${T(tn?on.label:G?.name??I?.name??"Component")}`}</h2></div>`:""}<div class="inspection-content" role="region" aria-label="${p?"Page comparison":"Component comparison"}" tabindex="0">
          ${f&&!p?`<section class="review-summary" id="review-summary" tabindex="-1"><div class="completion-mark" aria-hidden="true">${rn}</div><h2>${m?"Review sent.":"All components reviewed."}</h2><p>${u.approved} approved · ${u.revisions} flagged for repair${t.missing.length?` · ${t.missing.length} missing`:""}</p><p>${m?"Your decisions are saved.":u.hasFeedback?"Send your feedback to start the next repair round.":"Confirm nothing is missing, then approve and continue."}</p><div class="summary-decisions">${S.map((i)=>{let d=i.representative,y=t.decisions[d.id],E=Ui(d);return`<button data-select="${T(d.id)}"><strong>${T(i.label)}</strong><span>${i.kind==="pending"?"Not reviewed":E.kind==="feedback"?"Needs work":"Approved"}</span>${y?.action==="revise"?`<small>${T(y.feedback||"No note — agent will diagnose.")}</small>`:""}</button>`}).join("")}${t.missing.map((i)=>`<button data-select="${T(i.id)}"><strong>${T(i.name)}</strong><span>Missing</span><small>${T(i.feedback)}</small></button>`).join("")}</div></section></div>${c?`<div class="review-form">${c}</div>`:""}`:G?`
          ${q?`<div class="repair-context">
            ${qn&&L?.prior?.action==="revise"?`<section class="previous-feedback" aria-label="Previous feedback"><h3>Previous feedback <span>· Round ${L.feedbackRound}</span></h3><blockquote>${T(L.prior.feedback||"No written feedback was supplied.")}</blockquote>${L.prior.split?"<p>Requested: split into separately reviewable components.</p>":""}</section>`:L?.carried?'<p class="kept-approval">Unchanged · approval kept</p>':""}
            ${L?.change?.kind==="changed"?`<details class="changed-files" ${Gi?"open":""}><summary>${L.change.files.length?`${L.change.files.length} changed ${L.change.files.length===1?"file":"files"}`:L.change.reasons.includes("region")?"Region changed":K?.note!==G.note?"Description changed · files unchanged":"Component definition changed · files unchanged"}</summary>${L.change.files.length?`<ul>${L.change.files.map((i)=>`<li>${T(i)}</li>`).join("")}</ul>`:""}${K&&K.note!==G.note?`<dl class="description-diff"><dt>Previous description</dt><dd>${T(K.note)}</dd><dt>Current description</dt><dd>${T(G.note)}</dd></dl>`:""}</details>`:""}
          </div>`:""}

          <div class="comparison-slot"><div class="comparison-panel ${tn?"group-overview":""}"><h2 class="expanded-title">${T(tn?on.label:V.name)}</h2>${h.length>1?`<div class="review-peers"><strong>${h.length} instances</strong>${!tn?'<button id="all-instances" class="quiet">All instances</button>':'<span class="group-hint">Select to inspect</span>'}</div>`:""}<div class="compare-toolbar">${K?`<div class="round-switch ks-instrument-strip is-paper" data-ks-strip="round" role="group" aria-label="Preview version"><button type="button" class="ks-instrument-key" id="current-round" aria-label="Current · round ${n.round}" title="Current · round ${n.round}" aria-pressed="${!qn}">Current</button><button type="button" class="ks-instrument-key" id="previous-round" aria-label="Previous · round ${q.packet.round}" title="Previous · round ${q.packet.round}" aria-pressed="${qn}">Previous</button></div>`:""}<div class="ks-instrument-strip is-paper zoom-strip" data-ks-strip="zoom" role="group" aria-label="Comparison zoom">${[["fit","Fit"],["1","100%"],["2","200%"],["4","400%"]].map(([i,d])=>`<button type="button" class="ks-instrument-key" data-zoom="${i}" aria-pressed="${String(hn)===i}">${d}</button>`).join("")}</div><button id="overlay" type="button" class="ks-switch" title="Overlay the approved comp" aria-pressed="${xn}"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">Overlay</span></button><div class="comparison-actions" role="group" aria-label="Comparison view actions"><button id="expand-comparison" class="ks-icon-button" aria-label="${U?"Restore comparison":"Enlarge comparison"}" title="${U?"Restore comparison (Esc)":"Enlarge comparison"}" aria-expanded="${U}">${zn(U?"compact":"expand")}</button>${V?.preview.kind==="image"?`<a class="ks-icon-button source-link" href="${Mn(Ni)}" target="_blank" rel="noopener" aria-label="${wn?"Open context capture":Vn.fileLabel}" title="${wn?"Open context capture":Vn.fileLabel}">${zn("external")}</a>`:""}</div></div>
          ${tn?`<div class="instance-grid" aria-label="All instances of ${T(on.label)}"><div class="instance-grid-labels"><span>Full comp crop</span><span>Component preview</span></div>${on.members.map((i,d)=>{let y=Ui(i);return`<button class="instance-row ${y.kind}" data-instance="${T(i.id)}" aria-label="Inspect instance ${d+1}: ${T(i.name)} — ${T(y.label)}"><span class="instance-caption"><strong>${T(i.name)}</strong><span>${T(y.label)}</span></span><span class="instance-pair"><span class="instance-reference" style="width:min(100%,${i.box.w*n.comp.width}px,${180*i.box.w*n.comp.width/(i.box.h*n.comp.height)}px);aspect-ratio:${i.box.w*n.comp.width}/${i.box.h*n.comp.height}"><img src="${Mn(n.comp.url)}" alt="Comp: ${T(i.name)}" loading="lazy" style="width:${100/i.box.w}%;left:${-100*i.box.x/i.box.w}%;top:${-100*i.box.y/i.box.h}%">${Sn(n,i)}</span><span class="instance-produced" style="width:min(100%,${i.box.w*n.comp.width}px,${180*i.box.w*n.comp.width/(i.box.h*n.comp.height)}px);aspect-ratio:${i.box.w*n.comp.width}/${i.box.h*n.comp.height}">${i.preview.kind==="image"?`<img src="${Mn(i.preview.url)}" alt="Produced: ${T(i.name)}" loading="lazy">`:i.thumbnail?`<img src="${Mn(i.thumbnail.url)}" alt="Preview: ${T(i.name)}" loading="lazy">`:"Open live component"}</span></span>${li(n,i)}</button>`}).join("")}</div>`:""}
          ${!tn&&V?li(ln,V):""}<div class="compare">
            <figure><figcaption>${qn?`Comp · Round ${q.packet.round}`:p?"Approved comp":te?.related.length?"Full comp crop":"In the comp"}</figcaption><div class="pan-viewport" aria-label="Reference comparison canvas" tabindex="0"><div class="crop-stage"><img class="crop-image" src="${Mn(ln.comp.url)}" alt="Reference region for ${T(V.name)}" style="width:${100/V.box.w}%;left:${-100*V.box.x/V.box.w}%;top:${-100*V.box.y/V.box.h}%">${Sn(ln,V)}</div></div></figure>
            <figure><figcaption>${qn?`Previous · Round ${q.packet.round}`:p?"Assembled page":wn?"In context":q?`${Vn.caption} · Round ${n.round}`:Vn.caption}</figcaption><div class="pan-viewport" aria-label="Produced comparison canvas" tabindex="0"><div class="output crop-stage ${Li&&!wn&&!oe&&fn==="checker"?"checker":""}">${!oe?`<img class="asset" src="${Mn(Ni)}" alt="Produced ${T(V.name)}" style="object-position:${T(V.preview.position??"center")}">`:`<iframe aria-hidden="true" title="Rendered ${T(V.name)}" src="${Mn(Ni)}" sandbox="" tabindex="-1" width="${ln.comp.width}" height="${ln.comp.height}"></iframe>`}${xn?`<img class="crop-image overlay-image" src="${Mn(ln.comp.url)}" alt="Reference overlay" style="width:${100/V.box.w}%;left:${-100*V.box.x/V.box.w}%;top:${-100*V.box.y/V.box.h}%">`:""}</div></div></figure>
          </div>
          ${Li||V.context?`<div class="view-controls">${V.context?`<div class="ks-instrument-strip is-paper" data-ks-strip="view" role="group" aria-label="Component view"><button type="button" class="ks-instrument-key" id="isolated" aria-pressed="${!wn}">${Ai?"Asset only":"Component only"}</button><button type="button" class="ks-instrument-key" id="context" aria-pressed="${wn}">In context</button></div>`:""}${Li?`<div class="background-options ks-instrument-strip is-paper" data-ks-strip="background" role="group" aria-label="Asset preview background"><button type="button" id="background-checker" class="ks-instrument-key" aria-label="Checkerboard background" title="Checkerboard background" aria-pressed="${fn==="checker"}" ${wn?"disabled":""}>Checker</button><button type="button" id="background-page" class="ks-instrument-key" aria-label="${ln.comp.background?"Page color":"Neutral"} background" title="${ln.comp.background?"Page color":"Neutral"} background" aria-pressed="${fn==="page"}" ${wn?"disabled":""}>Page</button></div>`:""}</div>`:""}
          </div></div>${!p&&!tn?`<div class="component-details"><div class="material">${zn(Vn.code?"code":"image")}<strong>${T(Fe)}</strong><span>${V?.material?`${V.material.width} × ${V.material.height} px`:""}</span></div>${ln.stage==="components"&&Vn?.captured&&!V?.preview.isolation?'<p class="layering">Legacy region capture · may include overlapping components.</p>':""}${V?.context?.layering&&(Ai||wn)?`<p class="layering">${T(V.context.layering)}</p>`:""}
          <p class="component-note">${!te?.related.length?T(V.note):""}</p>
          </div>`:""}</div><div class="review-form">${c}${qn?'<p class="previous-notice">Viewing the previous round. Return to Current to make a decision.</p>':""}${m?`<div class="record-verdict"><strong>${r?.action==="approve"?"Approved":r?.action==="revise"?"Changes requested":"Not reviewed"}</strong><span>Submitted in round ${n.round} · read-only</span></div>`:`<div class="decisions" role="group" aria-label="Decision for ${T(G.name)}">${!p?`<div class="decision-title"><strong>Your review <span>Round ${n.round}</span></strong>${qn?"<p>Return to Current to review this round.</p>":""}</div>`:""}<button id="approve" ${!b.length?"disabled":""} class="ks-button ks-button-primary decision-approve ${r?.action==="approve"?"approved":""}" aria-pressed="${r?.action==="approve"}">${p?k?"Sending…":`Approve & continue${Bn}`:b.length>1?`Approve ${b.length} instances`:"Looks good"}</button><button id="revise" ${!b.length?"disabled":""} class="ks-button ks-button-secondary decision-revise ${r?.action==="revise"?"revise":""}" aria-pressed="${r?.action==="revise"}">${b.length>1?`Revise ${b.length} instances`:"Needs work"}</button>${r&&!p&&!tn?`<button id="clear" class="ks-icon-button" aria-label="Clear decision" title="Clear decision">${zn("undo")}</button>`:""}</div>`}
          ${s?`<form id="feedback-form"><div class="feedback-fields"><label class="feedback-field">What needs to change?<textarea id="feedback" aria-describedby="feedback-hint">${T(s.feedback)}</textarea></label><p id="feedback-hint" class="feedback-hint">Optional — leave blank for the agent to diagnose.</p>${!p?`<label class="check"><input id="split" type="checkbox" ${s.split?"checked":""}> Split into separately reviewable components</label>`:""}</div><div class="feedback-actions"><button id="cancel-feedback" type="button" class="ks-button ks-button-ghost">Cancel</button><button id="save-feedback" type="submit" class="ks-button ks-button-primary">${p?"Send feedback":x?"Save & finish review":"Save & next"}${Bn}</button><span class="shortcut-hint">${dn}</span></div></form>`:r?.action==="revise"?`<p class="saved-feedback">${T(r.feedback||"No note — agent will diagnose.")}</p>`:""}
          ${p?`<p class="page-review-status" role="status">${T(z||(m?"Your decision is saved.":k?"Sending…":s?"":"Approval confirms the composition and that nothing is missing."))}</p>`:""}</div>`:I?`<p>This piece will be added to the unresolved inventory.</p><label class="feedback-field">Name<input id="missing-name" value="${T(I.name)}"></label><label class="feedback-field">What is missing?<textarea id="missing-feedback">${T(I.feedback)}</textarea></label><div class="coordinates">${["x","y","w","h"].map((i)=>`<label>${{x:"Left",y:"Top",w:"Width",h:"Height"}[i]} %<input type="number" data-coordinate="${i}" value="${Math.round(I.box[i]*1000)/10}" min="0" max="100" step="0.1"></label>`).join("")}</div><button id="remove-missing">Remove this mark</button></div>`:"<p>No components supplied.</p></div>"}
        </section>
      </div>
      ${!p?`<section class="inventory-section ${C?"":"tray-collapsed"} ${O&&C?"tray-expanded":""}" aria-label="Component inventory"><div class="section-head"><h2>Components</h2><div class="inventory-filters ks-instrument-strip is-paper" data-ks-strip="filter" role="group" aria-label="Filter components"><button type="button" class="ks-instrument-key" data-filter="pending" aria-pressed="${M==="pending"}">To review <b>${ti}</b></button><button type="button" class="ks-instrument-key" data-filter="reviewed" aria-pressed="${M==="reviewed"}">Reviewed <b>${We}</b></button><button type="button" class="ks-instrument-key" data-filter="all" aria-pressed="${M==="all"}">All <b>${S.length+t.missing.length}</b></button></div><div class="tray-actions"><button id="show-all" class="ks-icon-button" aria-pressed="${O}" aria-controls="component-tray" aria-label="${O?"Compact":"Expand"} tray" title="${O?"Compact":"Expand"} tray">${zn(O?"compact":"expand")}</button><button id="toggle-tray" class="ks-icon-button" aria-expanded="${C}" aria-controls="component-tray" aria-label="${C?"Hide":"Show"} component tray" title="${C?"Hide":"Show"} component tray">${zn(C?"hideTray":"showTray")}</button></div></div>
      <div id="component-tray" class="inventory ${O?"all":""}">${ae.map((i)=>{let d=S.find((un)=>un.members.some((gn)=>gn.id===i.id)),y=S.indexOf(d),E={kind:d.kind,label:d.stateLabel};return`<button class="item ${E.kind} ${!f&&on?.id===d.id?"active":""}" data-select="${T(i.id)}" aria-pressed="${!f&&on?.id===d.id}">${i.thumbnail?`<span class="item-thumb">${i.thumbnail.box?`<span class="thumb-crop" style="width:min(100%,${76*i.thumbnail.box.w*n.comp.width/(i.thumbnail.box.h*n.comp.height)}px);aspect-ratio:${i.thumbnail.box.w*n.comp.width}/${i.thumbnail.box.h*n.comp.height}"><img alt="" loading="lazy" src="${Mn(i.thumbnail.url)}" style="position:absolute;width:${100/i.thumbnail.box.w}%;max-width:none;left:${-100*i.thumbnail.box.x/i.thumbnail.box.w}%;top:${-100*i.thumbnail.box.y/i.thumbnail.box.h}%;"></span>`:`<img alt="" loading="lazy" src="${Mn(i.thumbnail.url)}">`}</span>`:""}<span class="item-number">${E.kind==="approved"?rn:E.kind==="feedback"?Nn:""}${y+1}<span class="item-medium">${zn(Fn(i).code?"code":"image")}${T(Fn(i).label)}</span></span><strong>${T(Ie(i.id))}${d.members.length>1?` <small>×${d.members.length}</small>`:""}</strong><span class="state ${E.kind}">${T(E.label)}</span></button>`}).join("")}${(M==="pending"?[]:t.missing).map((i,d)=>`<button class="item feedback ${g===i.id?"active":""}" data-select="${T(i.id)}"><span class="item-number">${S.length+d+1}</span><strong>${T(i.name)}</strong><span class="state revise">Missing</span></button>`).join("")}${!ae.length&&(M==="pending"||!t.missing.length)?`<p class="inventory-empty">${M==="pending"?"Nothing left to review. Your decisions are ready.":"No components reviewed yet."}</p>`:""}</div></section>`:""}
      ${p?"":m?`<footer class="record-footer"><span>Round ${n.round} submitted · read-only</span><span>${u.approved} approved · ${u.revisions} changes requested</span></footer>`:`<footer class="${!u.pending&&!l?"queue-complete":""}"><div>${!u.pending&&!l?`<button id="show-summary" class="completion-link">${rn}${m?"Review sent":"All components reviewed"}</button>`:""}<button id="approve-rest" class="ks-button ks-button-secondary" ${!u.pending?"hidden":""} ${!u.pending||l?"disabled":""}>Approve ${u.approved||u.revisions?"remaining":"all"}</button><label class="check ks-checkbox"><input id="inventory-confirm" type="checkbox" ${t.inventoryConfirmed?"checked":""}> Nothing missing from the comp</label></div><div class="submit-area"><p role="status">${T(De)}</p><button id="submit" class="ks-button ks-button-primary" ${!u.canSubmit||l||k||m?"disabled":""}>${k?"Sending…":m?"Review sent":u.hasFeedback?"Send feedback":"Approve & continue"}${k||m?"":Bn}</button></div></footer>`}
    </section><dialog id="comparison-dialog" aria-label="${p?"Enlarged page comparison":"Enlarged component comparison"}"></dialog>`;let sn=a.querySelector("#comparison-dialog"),vn=a.querySelector(".comparison-panel"),_n=a.querySelector(".comparison-slot"),En=a.querySelector(".inspector > .review-form"),Re=a.querySelector(".inspector"),se=()=>{if(sn.append(vn),En)sn.append(En)};if(U&&vn&&_n)_n.style.height=`${Qi}px`,se(),sn.showModal();if(qn)a.querySelectorAll(".decisions button,#feedback,#split,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#submit,#inventory-confirm").forEach((i)=>i.disabled=!0);if(a.querySelector(".inspection-content").scrollTop=$i,m||k)a.querySelectorAll(".decisions button,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#mark,#inventory-confirm,#missing-name,#missing-feedback,#feedback,#split,#remove-missing,[data-coordinate]").forEach((i)=>i.disabled=!0);let pe=a.querySelector(".inventory");if(pe)pe.scrollLeft=$n;if(!P&&C)Array.from(a.querySelectorAll(".inventory [data-select]")).find((i)=>i.dataset.select===g)?.scrollIntoView({block:"nearest",inline:"nearest"});if($)a.getElementById($)?.focus({preventScroll:!0});else if(N)Array.from(a.querySelectorAll(".item[data-select]")).find((i)=>i.dataset.select===N)?.focus({preventScroll:!0});let B=(i,d)=>a.querySelector(`#${i}`)?.addEventListener("click",d);function _i(i,d=!1,y=!1){if(j)return;if(!y)i=S.find((E)=>E.members.some((un)=>un.id===i))?.representative.id??i;if(Z=!y,f=!1,g=i,W="component",xn=!1,hn="fit",D="isolated",pn=!1,J(),d)a.querySelector("#expand-comparison")?.click()}a.querySelectorAll("[data-select]").forEach((i)=>i.onclick=()=>_i(i.dataset.select,i.classList.contains("pin")&&n.components.some((d)=>d.id===i.dataset.select))),B("previous-round",()=>{pn=!0,J()}),B("current-round",()=>{pn=!1,J()}),B("review-changes",()=>{let i=w().filter((E)=>Ui(E).kind==="pending"),d=i.findIndex((E)=>E.id===g),y=i[(d+1)%i.length];if(y)Z=!0,f=!1,g=y.id,W="component",M="pending",pn=!1,hn="fit",xn=!1,D="isolated",J()}),a.querySelectorAll("[data-filter]").forEach((i)=>i.onclick=()=>{M=i.dataset.filter,f=!u.pending&&M==="pending";let d=S.filter((E)=>M==="all"||E.kind==="pending"===(M==="pending")).map((E)=>E.representative);if(!(M!=="pending"&&t.missing.some((E)=>E.id===g))&&!d.some((E)=>E.id===g)&&d.length)Z=!0,g=d[0].id,W="component",pn=!1,hn="fit",xn=!1,D="isolated";J()}),B("show-summary",()=>{f=!0,W="component",M="reviewed",J(),Jn("review-summary")}),B("approve",()=>In("approve")),B("revise",di),B("clear",()=>{if(G)delete t.decisions[G.id],delete v[G.id];Q=null,f=!1,M="pending",J()}),B("cancel-feedback",()=>{if(G)delete v[G.id];if(bn)C=!0,bn=!1;J(),Jn("revise")}),a.querySelector("#feedback-form")?.addEventListener("submit",(i)=>{i.preventDefault(),In("revise")}),a.querySelector("#feedback")?.addEventListener("keydown",(i)=>{let d=i;if(d.key==="Enter"&&(d.metaKey||d.ctrlKey)&&!d.isComposing)d.preventDefault(),d.stopPropagation(),In("revise")}),B("undo-decision",()=>{if(!Q||k||m)return;let i=Q;for(let[d,y]of Object.entries(i.previous))if(y)t.decisions[d]=y;else delete t.decisions[d];delete v[i.id],g=i.id,f=!1,pn=!1,W="component",M="all",Q=null,J(),Jn("approve")}),B("all-instances",()=>{Z=!0,g=on.representative.id,pn=!1,J()}),a.querySelectorAll("[data-instance]").forEach((i)=>i.onclick=()=>_i(i.dataset.instance,!1,!0)),B("overlay",()=>{xn=!xn,J()}),B("isolated",()=>{D="isolated",J()}),B("context",()=>{D="context",J()}),a.querySelectorAll("[data-zoom]").forEach((i)=>i.addEventListener("click",()=>{let d=i.dataset.zoom;hn=d==="fit"?"fit":Number(d),J()})),B("background-checker",()=>{fn="checker",J()}),B("background-page",()=>{fn="page",J()}),B("show-all",()=>{O=!O,C=!0,J()}),B("toggle-tray",()=>{bn=!1,C=!C,J()}),B("show-comp",()=>{W="comp",J()}),B("show-component",()=>{W="component",J()}),B("mark",()=>{j=!j,J()}),B("add-box",()=>xi({x:0.35,y:0.35,w:0.2,h:0.2})),B("remove-missing",()=>{t.missing=t.missing.filter((i)=>i.id!==g),g=n.components[0]?.id,J()}),B("approve-rest",()=>{if(l)return;t=ue(n,t),Q=null,f=!0,M="reviewed",W="component",J(),Jn("review-summary")}),a.querySelector("#inventory-confirm")?.addEventListener("change",(i)=>{t.inventoryConfirmed=i.target.checked,J()}),a.querySelector("#feedback")?.addEventListener("input",(i)=>{if(G&&v[G.id])v[G.id].feedback=i.target.value}),a.querySelector("#split")?.addEventListener("change",(i)=>{if(G&&v[G.id])v[G.id].split=i.target.checked}),a.querySelector("#missing-name")?.addEventListener("input",(i)=>{if(I)I.name=i.target.value;let d=a.querySelector("#submit");if(d)d.disabled=l||k||m||!Rn(n,t).canSubmit}),a.querySelector("#missing-feedback")?.addEventListener("input",(i)=>{if(I)I.feedback=i.target.value}),a.querySelectorAll("[data-coordinate]").forEach((i)=>i.addEventListener("change",()=>{if(!I)return;let d=i.dataset.coordinate,y=Number(i.value)/100;if(Number.isFinite(y))I.box[d]=Math.max(d==="w"||d==="h"?0.001:0,Math.min(1,y));I.box.w=Math.min(I.box.w,1-I.box.x),I.box.h=Math.min(I.box.h,1-I.box.y),J()})),B("submit",()=>{ni()});let yn=a.querySelector(".map");function Bi(i){let d=yn.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(i.clientX-d.left)/d.width)),y:Math.max(0,Math.min(1,(i.clientY-d.top)/d.height))}}function le(i){let d=Bi(i);return n.components.filter(({box:y})=>d.x>=y.x&&d.x<=y.x+y.w&&d.y>=y.y&&d.y<=y.y+y.h).sort((y,E)=>y.box.w*y.box.h-E.box.w*E.box.h)[0]}yn?.addEventListener("click",(i)=>{if(j||i.target.closest("[data-select]"))return;let d=le(i);if(d)_i(d.id,!0)}),yn?.addEventListener("pointermove",(i)=>{if(!j)yn.style.cursor=le(i)?"zoom-in":""}),yn?.addEventListener("pointerdown",(i)=>{if(!j)return;kn=Bi(i),yn.setPointerCapture(i.pointerId),i.preventDefault()}),yn?.addEventListener("pointermove",(i)=>{if(!kn)return;let d=Bi(i);an={x:Math.min(kn.x,d.x),y:Math.min(kn.y,d.y),w:Math.abs(d.x-kn.x),h:Math.abs(d.y-kn.y)};let y=a.querySelector(".draw-box");y.hidden=!1,y.style.cssText=Tn(an)}),yn?.addEventListener("pointerup",()=>{if(an&&an.w>0.01&&an.h>0.01)xi(an);else kn=null,an=null}),yn?.addEventListener("pointercancel",()=>{kn=null,an=null,J()});let de=a.querySelector(".output"),gi=a.querySelector("iframe"),xe=a.querySelector(".workbench"),On=a.querySelector(".inspection-content"),Ki=a.querySelector(".inspector");function Hi(){if(!On||!Ki)return;Ki.dataset.scrollAbove=String(On.scrollTop>1),Ki.dataset.scrollBelow=String(On.scrollHeight-On.clientHeight-On.scrollTop>1)}On?.addEventListener("scroll",Hi,{passive:!0});function vi(){let i=a.querySelector(".map-space");if(i&&i.clientWidth&&i.clientHeight){let _=Ii(n.comp.width,n.comp.height,Math.max(1,i.clientWidth-32),Math.max(1,i.clientHeight-32),"fit");yn.style.width=`${_.width}px`,yn.style.height=`${_.height}px`}let d=a.querySelector(".inspection-content"),y=Array.from(a.querySelectorAll(".pan-viewport"));if(d?.clientHeight){let _=U?Math.max(100,sn.clientHeight-(vn?.querySelector(".compare-toolbar")?.clientHeight??0)-(vn?.querySelector(".expanded-title")?.clientHeight??0)-(vn?.querySelector(".view-controls")?.clientHeight??0)-(En?.getBoundingClientRect().height??0)-124):Math.min(p?Number.POSITIVE_INFINITY:248,Math.max(100,d.clientHeight-((y[0]?.getBoundingClientRect().top??d.getBoundingClientRect().top)-d.getBoundingClientRect().top+d.scrollTop)-(vn?.querySelector(".view-controls")?.clientHeight??0)-12));y.forEach((nn)=>nn.style.height=`${_}px`)}if(V&&y.length&&!tn){let _=Ii(V.box.w*ln.comp.width,V.box.h*ln.comp.height,Math.min(...y.map((nn)=>nn.clientWidth)),Math.min(...y.map((nn)=>nn.clientHeight)),hn);a.querySelectorAll(".crop-stage").forEach((nn)=>{nn.style.width=`${_.width}px`,nn.style.height=`${_.height}px`})}if(y.forEach((_)=>{let nn=_.scrollWidth>_.clientWidth+1||_.scrollHeight>_.clientHeight+1;_.classList.toggle("pannable",nn),_.style.cursor=U?"":"zoom-in",_.setAttribute("role",U?"region":"button"),_.title=U?nn?"Move your pointer to pan. You can also scroll, swipe, or use arrow keys.":"":"Click to enlarge comparison"}),de&&gi&&V){let _=de.clientWidth/(V.box.w*ln.comp.width);gi.style.transform=`scale(${_})`,gi.style.left=`${-V.box.x*ln.comp.width*_}px`,gi.style.top=`${-V.box.y*ln.comp.height*_}px`}let E=xe.getBoundingClientRect(),un=a.querySelector(".region"),gn=a.querySelector(".number"),ci=a.querySelector(".connector path");if(un&&gn&&ci){let _=un.getBoundingClientRect(),nn=gn.getBoundingClientRect(),bi=_.right-E.left,en=_.top+_.height/2-E.top,si=nn.left-E.left-8,fi=nn.top+nn.height/2-E.top;ci.setAttribute("d",`M ${bi} ${en} H ${si-14} V ${fi} H ${si}`)}}function Dn(i,d){if(!vn||!_n||i===U)return;let y=a.querySelector("#expand-comparison"),E=(U?sn:vn).getBoundingClientRect(),un=window.matchMedia("(prefers-reduced-motion: reduce)").matches,gn=vn.querySelector(".pan-viewport"),ci=gn?gn.scrollLeft/Math.max(1,gn.scrollWidth-gn.clientWidth):0,_=gn?gn.scrollTop/Math.max(1,gn.scrollHeight-gn.clientHeight):0,nn=()=>vn.querySelectorAll(".pan-viewport").forEach((en)=>{en.scrollLeft=ci*Math.max(0,en.scrollWidth-en.clientWidth),en.scrollTop=_*Math.max(0,en.scrollHeight-en.clientHeight)}),bi=()=>{if(_n.append(vn),En)Re.append(En),En.inert=!1;sn.close(),_n.style.height="",Qn=!1,U=!1,y.innerHTML=zn("expand"),y.setAttribute("aria-label","Enlarge comparison"),y.title="Enlarge comparison",y.setAttribute("aria-expanded","false"),vi(),nn(),y.focus({preventScroll:!0}),d?.()};if(i){_n.style.height=`${E.height}px`,se(),sn.showModal(),U=!0,y.innerHTML=zn("compact"),y.setAttribute("aria-label","Restore comparison"),y.title="Restore comparison (Esc)",y.setAttribute("aria-expanded","true"),vi(),nn(),y.focus({preventScroll:!0});let en=sn.getBoundingClientRect();if(!un)sn.animate([{transform:`translate(${E.x-en.x}px,${E.y-en.y}px) scale(${E.width/en.width},${E.height/en.height})`,opacity:0.6},{transform:"none",opacity:1}],{duration:240,easing:"cubic-bezier(.2,.8,.2,1)"})}else{if(y.disabled)return;let en=_n.getBoundingClientRect();if(un){bi();return}if(y.disabled=!0,Qn=!0,En)En.inert=!0;let si=sn.animate([{transform:"none",opacity:1},{transform:`translate(${en.x-E.x}px,${en.y-E.y}px) scale(${en.width/E.width},${en.height/E.height})`,opacity:0.6}],{duration:200,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});sn.inert=!0;let fi=()=>{if(si.cancel(),y.disabled=!1,sn.inert=!1,sn.isConnected)bi();else Qn=!1,U=!1,J(),d?.()};si.finished.then(fi,fi)}}if(Xn=(i)=>Dn(!1,i),B("expand-comparison",()=>Dn(!U)),sn.addEventListener("cancel",(i)=>{i.preventDefault(),i.stopPropagation(),Dn(!1)}),sn.addEventListener("keydown",(i)=>{if(i.key==="Escape")i.preventDefault(),i.stopPropagation(),Dn(!1)}),Hn=Yi(a),mn=new ResizeObserver(()=>{vi(),Hi()}),mn.observe(xe),mn.observe(sn),En)mn.observe(En);let he=a.querySelector(".inspection-content");if(he)mn.observe(he);let ke=a.querySelector(".repair-context");if(ke)mn.observe(ke);let ge=vn?.querySelector(".compare-toolbar");if(ge)mn.observe(ge);vi();let ui=Array.from(a.querySelectorAll(".pan-viewport"));if(ui.forEach((i)=>{i.scrollLeft=ki,i.scrollTop=ei}),ui.forEach((i)=>{i.querySelectorAll("img").forEach((d)=>d.draggable=!1),i.addEventListener("click",()=>{if(!U)Dn(!0)}),i.addEventListener("pointermove",(d)=>{if(d.pointerType!=="mouse"||d.buttons||!i.classList.contains("pannable"))return;let y=i.getBoundingClientRect();i.scrollLeft=Oi(d.clientX,y.left,i.clientWidth,i.scrollWidth),i.scrollTop=Oi(d.clientY,y.top,i.clientHeight,i.scrollHeight)}),i.addEventListener("keydown",(d)=>{if(!U&&(d.key==="Enter"||d.key===" ")){d.preventDefault(),d.stopPropagation(),Dn(!0);return}let E={ArrowLeft:[-48,0],ArrowRight:[48,0],ArrowUp:[0,-48],ArrowDown:[0,48]}[d.key];if(!E)return;d.preventDefault(),d.stopPropagation(),i.scrollLeft+=E[0],i.scrollTop+=E[1]})}),ui.forEach((i)=>i.addEventListener("scroll",()=>{for(let d of ui)if(d!==i){if(d.scrollLeft!==i.scrollLeft)d.scrollLeft=i.scrollLeft;if(d.scrollTop!==i.scrollTop)d.scrollTop=i.scrollTop}})),ii&&window.matchMedia("(max-width:800px)").matches){let i=a.querySelector(".inspection-content"),d=a.querySelector(".compare");if(i&&d)i.scrollTop+=d.getBoundingClientRect().top-i.getBoundingClientRect().top}if(Hi(),window.scrollTo(H,R),!m)o.onDraftChange?.(structuredClone(t))}return J(),{destroy(){mn?.disconnect(),Hn?.(),a.replaceChildren()},getDraft(){return structuredClone(t)}}}function ir(){let e=document.createElement("style");e.textContent=[["Albert Sans","albertsans"],["Alumni Sans","alumnisans"],["JetBrains Mono","jetbrainsmono"]].map(([n,o])=>`@font-face{font-family:"${n}";src:url(/fonts/${o}.ttf);font-weight:100 900}`).join(""),document.head.append(e)}function er(e){let n=document.createElement("div");n.setAttribute("role","alert"),n.style.cssText="max-width:560px;margin:18vh auto 0;padding:0 0 0 18px;border-left:2px solid oklch(52% 0.16 35);color:oklch(22% 0 0);font:400 15px/1.55 var(--font-sans,Arial,sans-serif)";let o=document.createElement("p");o.textContent="Review unavailable",o.style.cssText="margin:0 0 8px;font:400 11px/1.3 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:oklch(46% 0 0)";let a=document.createElement("strong");a.textContent="The review could not be opened.",a.style.cssText="display:block;font-weight:500;color:oklch(13% 0 0)";let t=document.createElement("p");t.style.cssText="margin:4px 0 18px;color:oklch(46% 0 0)",t.textContent=`${e} If the review server stopped, ask the agent to serve the review again, then reload.`;let p=document.createElement("button");return p.textContent="Reload",p.style.cssText="font:500 15px/1 var(--font-sans,Arial,sans-serif);min-height:44px;padding:0 22px;border:1px solid oklch(13% 0 0);border-radius:3px;background:oklch(13% 0 0);color:oklch(99.5% 0 0);cursor:pointer",p.onclick=()=>location.reload(),n.append(o,a,t,p),n}async function rr(){ir(),document.body.style.background="oklch(97.8% 0 0)";let e=document.getElementById("review"),n=await fetch("/packet",{cache:"no-store"});if(!n.ok)throw Error("The review packet could not be loaded.");let o=await n.json(),a=Mi(o.packet);if(o.sourceStatus&&!a){let t=document.createElement("p");t.textContent=o.sourceStatus,e.before(t)}He(e,o.packet,{initialDraft:o.draft,history:o.history,completed:!!o.receipt,status:a?o.sourceStatus:null,onSubmit:async(t)=>{let p=await fetch("/decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)}),w=await p.json().catch(()=>({}));if(!p.ok)throw Error(w.error??"The review could not be saved. Try again.")}})}rr().catch((e)=>{document.getElementById("review")?.replaceChildren(er(e instanceof Error?e.message:String(e)))});})();
