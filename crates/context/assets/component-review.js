(()=>{function wi(e,n){let o=n?.changes[e],a=n?.feedback?.[e],t=a?.decision??(n?.submitted?n.draft.decisions[e]:void 0),l=o?.kind==="unchanged"&&(o.carried??(n?.submitted&&t?.action==="approve"))===!0;return{change:o,prior:t,feedbackRound:a?.round??n?.packet.round,carried:l,label:o?.kind==="added"?"New component":o?.kind==="changed"?"Review again":l?"Approval kept":t?.action==="revise"?"Changes still requested":"Awaiting review"}}function cn(e,n,o){let a=n.decisions[e.id],t=a?.revision===e.revision?a:void 0,l=wi(e.id,o);if(t?.action==="approve")return{kind:"approved",label:l.carried?"Approval kept":"Approved",priority:3};if(t?.action==="revise")return{kind:"feedback",label:"Feedback ready",priority:2};return{kind:"pending",label:l.change?.kind==="changed"?"Review again":l.change?.kind==="added"?"New · review needed":"Not reviewed",priority:l.change?.kind==="changed"||l.change?.kind==="added"?0:1}}function fe(e){return{packetRevision:e.revision,decisions:{},missing:[],inventoryConfirmed:!1}}function Wi(e){return Object.values(e).every(Number.isFinite)&&e.x>=0&&e.y>=0&&e.w>0&&e.h>0&&e.x+e.w<=1.00001&&e.y+e.h<=1.00001}function Fn(e,n){let o=e.components.map((x)=>n.decisions[x.id]?.revision===x.revision?n.decisions[x.id]:void 0),a=o.filter((x)=>x?.action==="approve").length,t=o.filter((x)=>x?.action==="revise").length,l=o.length-a-t,y=t>0||n.missing.length>0;return{approved:a,revisions:t,pending:l,hasFeedback:y,canSubmit:n.packetRevision===e.revision&&n.missing.every((x)=>x.name.trim()&&Wi(x.box))&&(y||!l&&n.inventoryConfirmed)}}function we(e,n){let o={...n.decisions};for(let a of e.components)if(!o[a.id]||o[a.id].revision!==a.revision)o[a.id]={revision:a.revision,action:"approve",feedback:"",split:!1};return{...n,decisions:o}}function me(e,n){if(!Fn(e,n).canSubmit)throw Error("Review is incomplete or stale");return{schemaVersion:1,requestId:e.id,...structuredClone(n)}}function Rn(e){let n=e.preview.kind==="page"||e.preview.sourceKind==="page",o=e.preview.sourceKind==="page";return{code:n,captured:o,label:n?e.medium.match(/html|css|svg/i)?e.medium:"HTML / CSS / SVG":"Raster",caption:n?o?e.preview.isolation?"Component only":"Region capture":"Live component":"Produced asset",fileLabel:o?"Open captured preview":"Open source image"}}function ye(e,n,o){let a=e.components.findIndex((t)=>t.id===o);for(let t=1;t<=e.components.length;t++){let l=e.components[(a+t)%e.components.length];if(cn(l,n).kind==="pending")return l.id}}function mi(e,n){if(!n.reviewGroup||!Rn(n).code)return[n];return e.components.filter((o)=>o.reviewGroup===n.reviewGroup&&Rn(o).code)}function pi(e,n,o,a,t=[]){let l=a?mi(e,o):[o];if(l.length===1)return[o];return l.filter((y)=>cn(y,n).kind==="pending"&&(y.id===o.id||!t.includes(y.id)))}function ze(e,n,o){let a=new Set;return e.components.flatMap((t)=>{if(a.has(t.id))return[];let l=mi(e,t);l.forEach((g)=>a.add(g.id));let y=l.filter((g)=>cn(g,n,o).kind==="pending"),x=l.filter((g)=>cn(g,n,o).kind==="feedback"),f=y[0]??x[0]??t,z=y.length?"pending":x.length?"feedback":"approved";return[{id:t.id,members:l,representative:f,pending:y.length,kind:z,label:l.length>1?t.reviewGroup.replace(/[-_]+/g," ").replace(/^./,(g)=>g.toUpperCase()):t.name,box:{x:Math.min(...l.map((g)=>g.box.x)),y:Math.min(...l.map((g)=>g.box.y)),w:Math.max(...l.map((g)=>g.box.x+g.box.w))-Math.min(...l.map((g)=>g.box.x)),h:Math.max(...l.map((g)=>g.box.y+g.box.h))-Math.min(...l.map((g)=>g.box.y))},stateLabel:y.length?l.length>1?`${y.length} to review`:cn(f,n,o).label:x.length?l.length>1?`${x.length} ${x.length===1?"needs":"need"} work`:"Feedback ready":"Approved"}]})}function yi(e,n){let o=new Set(n.preview.isolation?.excludedComponents??[]),a=n.box,t=e.components.filter((l)=>{if(l.id===n.id)return!1;if(o.has(l.id))return!0;let y=l.box,x=Math.min(a.x+a.w,y.x+y.w)-Math.max(a.x,y.x),f=Math.min(a.y+a.h,y.y+y.h)-Math.max(a.y,y.y);return y.w*y.h<a.w*a.h&&x*e.comp.width>1&&f*e.comp.height>1});return{description:n.note.trim(),related:t,excluded:t.filter((l)=>o.has(l.id))}}function Ii(e,n,o,a,t){let l=t==="fit"?Math.min(1,o/e,a/n):t;return{scale:l,width:e*l,height:n*l}}function Oi(e,n,o,a){if(o<=0||a<=o)return 0;return Math.max(0,Math.min(1,((e-n)/o-0.08)/0.84))*(a-o)}var je=`
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
`;var Me=`/* VENDORED from impeccable-site/site/styles/kinpaku-tokens.css (the source of truth).
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
`,Te=`/* VENDORED from impeccable-site/site/styles/kinpaku-kit.css (buttons, tabs, select, icon button, instrument strip, grain, switch, paper strip, thumb) (the source of truth).
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
`,qe=`/* VENDORED from impeccable-site/site/styles/docs-kinpaku.css (the command rail list: the site's selected-row pattern) (the source of truth).
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
`;var Ve=(e)=>e.replace(/^:root\s*\{/gm,":root, :host {"),zi=Ve(Me)+`
`+Ve(Te)+`
`+qe,Bn='<span class="ks-button-arrow" aria-hidden="true"><svg viewBox="0 0 16 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M0 4h14M10 0l4 4-4 4"/></svg></span>';var Ee=`
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
`+je+`
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
`;var ir={chevronDown:'<path d="m6 9 6 6 6-6"/>',code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',compact:'<path d="M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',hideTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12 3 3 2 3-2"/>',showTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12-4 3-3 3 3"/>',next:'<path d="M5 12h14m-6-6 6 6-6 6"/>',mark:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5M8 12h8m-4-4v8"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',undo:'<path d="M4 10h9a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" transform="translate(0 -2)"/>',external:'<path d="M14 3h7v7m0-7L10 14m0-10H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',zoom:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'};function zn(e){return`<svg class="utility-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ir[e]}</svg>`}var Di=[{kind:"plate",label:"Illustration / plate",hint:"Painted or drawn artwork"},{kind:"image",label:"Photo / image",hint:"A photograph"},{kind:"texture",label:"Texture",hint:"A surface or material"}];function Mi(e){let n=e;return!!n&&n.schemaVersion===3&&n.stage==="components"}function Ri(e){return e.role==="plan"&&(!!e.flags?.length||!!e.codeDrawn)}function Fi(e){let n=(o)=>Ri(o)?0:o.role==="asset"?1:2;return e.components.map((o,a)=>({c:o,i:a})).sort((o,a)=>n(o.c)-n(a.c)||o.i-a.i).map((o)=>o.c)}function Ti(e){let n=new Set(e.components.map((o)=>o.id));return(e.codeRegions??[]).filter((o)=>!n.has(o.id))}function Mn(e,n){let o=n.decisions[e.id];return o?.revision===e.revision?o:void 0}function jn(e,n){let o=Mn(e,n);return o?o.action==="approve"?"approved":o.action:"pending"}function qi(e,n){return e.reclassify?.find((o)=>o.id===n)}function Ci(e){let n=[e.name,e.note,...(e.flags??[]).map((o)=>o.message)].join(" ");if(/\b(textures?|surfaces?|grain|grainy|brushed|metal(lic)?|steel|brass|copper|paper|linen|canvas|fabric|cloth|wood(en)?|stone|marble|concrete|plaster|leather|noise|pattern(ed)?|weave|patina)\b/i.test(n))return"texture";if(/\b(photo|photos|photograph|photographs|photographic|photography)\b/i.test(n)&&!/\bphotographic shading\b/i.test(n))return"image";return"plate"}function Xe(e){return`Drawn in code (${e.kind})`}function Pi(e){return e.message}function Cn(e,n){let o=e.components.map((w)=>jn(w,n)),a=o.filter((w)=>w==="approved").length,t=o.filter((w)=>w==="revise").length,l=new Set(Ti(e).map((w)=>w.id)),y=(n.reclassify??[]).filter((w)=>l.has(w.id)).length,x=o.filter((w)=>w==="reclassify").length+y,f=o.filter((w)=>w==="pending").length,z=n.missing.length,g=t+x+z>0,m=n.packetRevision===e.revision,M=n.missing.every((w)=>w.name.trim()&&Wi(w.box)),u=m&&!g&&f===0;return{total:o.length,approved:a,revise:t,reclassify:x,pending:f,missing:z,hasChanges:g,canApprove:u,mode:g?"changes":"approve",canSubmit:m&&M&&(g||u)}}function Si(e,n,o,a={}){if(a.split&&!(o==="revise"&&n.role==="asset"))throw Error("Only a generated asset can be split into layers");if(o==="revise"&&n.role!=="asset"&&!(a.feedback??"").trim())throw Error("Revising a plan item needs feedback");if(o==="reclassify"&&n.role!=="plan")throw Error("Only planned code can become an image");let t={revision:n.revision,action:o,feedback:o==="approve"?"":(a.feedback??"").trim(),split:!!a.split};if(o==="reclassify")t.kind=a.kind??Ci(n);return{...e,inventoryConfirmed:!1,decisions:{...e.decisions,[n.id]:t}}}function Je(e,n){let o={...e.decisions};return delete o[n],{...e,inventoryConfirmed:!1,decisions:o}}function ne(e,n,o){let a=(e.reclassify??[]).filter((t)=>t.id!==n);return{...e,inventoryConfirmed:!1,reclassify:o?[...a,{id:n,kind:o.kind,feedback:(o.feedback??"").trim()}]:a}}function $e(e,n){let o=Cn(e,n);if(!o.canSubmit)throw Error("Review is incomplete or stale");let a={};for(let y of e.components){let x=Mn(y,n);if(x)a[y.id]=structuredClone(x)}let t=new Set(Ti(e).map((y)=>y.id)),l=(n.reclassify??[]).filter((y)=>t.has(y.id)).map((y)=>({...y}));return{schemaVersion:1,requestId:e.id,packetRevision:n.packetRevision,decisions:a,missing:structuredClone(n.missing),inventoryConfirmed:o.mode==="approve",...l.length?{reclassify:l}:{}}}function Ge(e){return{packetRevision:e.revision,decisions:{},missing:[],inventoryConfirmed:!1,reclassify:[]}}function Qe(e,n,o,a,t=0.02){let l=Math.max(0,Math.floor((a.x-t)*n)),y=Math.min(n-1,Math.ceil((a.x+a.w+t)*n)),x=Math.max(0,Math.floor((a.y-t)*o)),f=Math.min(o-1,Math.ceil((a.y+a.h+t)*o)),z=Math.floor(a.x*n),g=Math.ceil((a.x+a.w)*n),m=Math.floor(a.y*o),M=Math.ceil((a.y+a.h)*o),u=[],w=Math.max(1,Math.round(Math.max(y-l,f-x)/80));for(let Q=x;Q<=f;Q+=w)for(let Z=l;Z<=y;Z+=w){if(Z>=z&&Z<g&&Q>=m&&Q<M)continue;let dn=(Q*n+Z)*4;if(e[dn+3]<200)continue;u.push([e[dn],e[dn+1],e[dn+2]])}return u}function Ze(e){if(!e.length)return;let n=(o)=>{let a=e.map((t)=>t[o]).sort((t,l)=>t-l);return a[a.length>>1]};return"#"+[0,1,2].map((o)=>n(o).toString(16).padStart(2,"0")).join("")}function ie(e,n,o,a,t,l=4,y=24){let x=e.w*n,f=e.h*o,z=Math.min(24,Math.max(8,0.04*Math.max(x,f))),g=Math.min(n,x+z*2),m=Math.min(o,f+z*2),M=Math.min(l,a/g,t/m);if(f*M<y&&f>0)M=Math.min(l,y/f,t/m),g=Math.min(g,a/M);let u=(e.x+e.w/2)*n,w=(e.y+e.h/2)*o,Q=Math.max(0,Math.min(n-g,u-g/2)),Z=Math.max(0,Math.min(o-m,w-m/2));return{scale:M,width:g*M,height:m*M,view:{x:Q/n,y:Z/o,w:g/n,h:m/o}}}var er=["no","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"],ji=(e)=>er[e]??String(e),Ye=(e)=>e[0].toUpperCase()+e.slice(1);function Ue(e,n,o){let a=e.components.filter((l)=>jn(l,n)==="pending").length;if(o&&e.round>1){let l=e.components.filter((x)=>["changed","added"].includes(o.changes[x.id]?.kind??"")||o.feedback?.[x.id]).length,y=e.components.filter((x)=>jn(x,n)==="approved").length;return`The agent worked on your notes for ${ji(l)} ${l===1?"item":"items"}. ${Ye(ji(y))} ${y===1?"approval is":"approvals are"} kept.`}let t=Math.max(1,Math.round(a*15/60));return`${Ye(ji(a))} ${a===1?"thing":"things"} to check before any page code is written. About ${ji(t)} ${t===1?"minute":"minutes"}.`}var Ae="Frame, view and moving parts as separate pieces, e.g. the shutters.";function ee(e){return e.role==="asset"?e.flags??[]:[]}var re=(e)=>ee(e).some((n)=>n.id==="baked-composite"),ae=(e)=>e?.action==="revise"&&e.split===!0;function Vi(e,n){if(!n)return null;let o=n.feedback?.[e]?void 0:Object.entries(n.feedback??{}).filter(([x,f])=>f.decision.action==="revise"&&f.decision.split&&e.startsWith(`${x}-`)).sort((x,f)=>f[0].length-x[0].length)[0];if(o){let[x,f]=o;return{round:f.round,action:"split",words:(f.decision.feedback??"").trim(),splitFrom:n.packet.components.find((z)=>z.id===x)?.name??x,beforeUrl:void 0,wasCode:!1,wasKind:void 0,wasNote:""}}let a=n.feedback?.[e],t=n.packet.components.find((x)=>x.id===e),l=n.packet.codeRegions?.find((x)=>x.id===e),y=n.changes[e]?.kind;if(!a&&y!=="changed")return null;return{round:a?.round??n.packet.round,action:a?.decision.action,words:(a?.decision.feedback??"").trim(),beforeUrl:t?.role==="asset"?t.preview.url:void 0,wasCode:t?.role==="plan"||!t&&!!l,wasKind:t?.kind??l?.kind,wasNote:t?.note??l?.note??"",splitFrom:void 0}}function Le(e,n,o,a,t,l=4,y){let x=e.length,f=Math.max(0,Math.min(o-t,(n-a*(x-1))/e.reduce((M,u)=>M+u,0))),z=Math.max(0,Math.min(n,(o-x*t-a*(x-1))/e.reduce((M,u)=>M+1/u,0)));if(y)f=Math.min(f,y.h*l),z=Math.min(z,y.w*l);let g=e.reduce((M,u)=>M+u*f*f,0),m=e.reduce((M,u)=>M+z*z/u,0);return g>=m?{direction:"row",sizes:e.map((M)=>({w:M*f,h:f}))}:{direction:"column",sizes:e.map((M)=>({w:z,h:z/M}))}}function Ne(e,n,o,a,t,l){return{x:t-e*o*l,y:t-n*a*l}}function _e(e,n,o){return Fi(e).map((a)=>({id:a.id,name:a.name,state:jn(a,n),current:a.id===o}))}function Ke(e,n){let o=Cn(e,n);if(o.mode==="approve")return"Approve plan and assets";let a=e.components.filter((y)=>ae(Mn(y,n))).length,t=o.revise-a;return`Send notes (${[t?`${t} ${t===1?"note":"notes"}`:"",a?`${a} to split`:"",o.reclassify?`${o.reclassify} to become ${o.reclassify===1?"an image":"images"}`:"",o.missing?`${o.missing} missing`:""].filter(Boolean).join(", ")})`}var Be=zi+`
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
`;var He=new Map;function Ei(e){let n=e.querySelector('.ks-instrument-key:is(.is-active, [aria-selected="true"], [aria-pressed="true"])');if(!n){if(e.classList.contains("has-thumb"))e.classList.remove("has-thumb");return}let o=e.getBoundingClientRect(),a=n.getBoundingClientRect();if(!o.width)return;let t=getComputedStyle(e),l=o.width/parseFloat(t.width)||1,y=parseFloat(t.borderLeftWidth)||0,x=Math.round(((a.left-o.left)/l-y+e.scrollLeft)*100)/100,f=Math.round(a.width/l*100)/100,z=e.querySelector(":scope > .ks-thumb"),g=e.dataset.ksStrip;if(!z){z=document.createElement("span"),z.className="ks-thumb",z.setAttribute("aria-hidden","true"),e.appendChild(z);let M=g?He.get(g):void 0;if(M&&(M.x!==x||M.w!==f))z.style.transition="none",z.style.width=`${M.w}px`,z.style.transform=`translateX(${M.x}px)`,z.offsetWidth,z.style.transition=""}if(g)He.set(g,{x,w:f});if(z.style.width!==`${f}px`)z.style.width=`${f}px`;let m=`translateX(${x}px)`;if(z.style.transform!==m)z.style.transform=m;if(!e.classList.contains("has-thumb"))e.classList.add("has-thumb")}function rr(e,n,o){if(e.dataset.thumb)return;e.dataset.thumb="1",Ei(e);let a=new MutationObserver((M)=>{if(M.some((u)=>u.target!==e&&!u.target.classList?.contains("ks-thumb")))Ei(e)});a.observe(e,{subtree:!0,attributes:!0,attributeFilter:["class","aria-selected","aria-pressed"],childList:!0});let t=new ResizeObserver(()=>Ei(e));t.observe(e);let l=null,y=!1,x=0,f=null,z=(M,u)=>n.elementFromPoint(M,u)?.closest(".ks-instrument-key")??null;e.addEventListener("pointerdown",(M)=>{if(!["mouse","pen"].includes(M.pointerType)||!M.isPrimary||M.button!==0||l!==null)return;l=M.pointerId,y=!1,x=M.clientX,f=z(M.clientX,M.clientY)}),e.addEventListener("pointermove",(M)=>{if(M.pointerId!==l)return;if(!y&&Math.abs(M.clientX-x)<6)return;y=!0;let u=z(M.clientX,M.clientY);if(u&&u!==f&&e.contains(u))f=u,u.click()});let g=()=>{l=null,y=!1,f=null},m=(M)=>{if(M.pointerId===l)g()};window.addEventListener("pointerup",m),window.addEventListener("pointercancel",m),window.addEventListener("blur",g),o.push(()=>{a.disconnect(),t.disconnect(),window.removeEventListener("pointerup",m),window.removeEventListener("pointercancel",m),window.removeEventListener("blur",g)})}function Yi(e){let n=[];return e.querySelectorAll(".ks-instrument-strip").forEach((o)=>rr(o,e,n)),document.fonts?.ready.then(()=>e.querySelectorAll(".ks-instrument-strip").forEach(Ei)),()=>n.forEach((o)=>o())}var Y=(e)=>e.replace(/[&<>"']/g,(n)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]),Xi=(e)=>`${e*100}%`,Hn=(e)=>{let n=new URL(e,location.href);if(!["http:","https:"].includes(n.protocol))throw Error("Unsupported preview URL");return Y(n.href)},Pn=(e)=>`left:${Xi(e.x)};top:${Xi(e.y)};width:${Xi(e.w)};height:${Xi(e.h)}`,We=(e)=>`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${e}</svg>`,Ji={check:We('<path d="m3 8.5 3 3 7-7"/>'),alert:We('<path d="M8 2 1.5 13.5h13L8 2Z"/><path d="M8 6.5v3.2M8 11.6v.1"/>')},Tn=(e)=>`<kbd class="cap">${e}</kbd>`,An={plate:"illustration",image:"photo",texture:"texture"};function ar(e){let n=e.match(/^review is stale:\s*(.+?)\s+changed\b/i);if(n)return`${n[1]} changed after this round was prepared.`;let o=e.replace(/;?\s*prepare a new round\.?\s*$/i,"").trim();return o?`${o[0].toUpperCase()}${o.slice(1)}${/[.!?]$/.test(o)?"":"."}`:""}var Ie={get(e){try{return localStorage.getItem(e)}catch{return null}},set(e,n){try{localStorage.setItem(e,n)}catch{}}};function Oe(e,n,o){let a=e.shadowRoot??e.attachShadow({mode:"open"}),t={...Ge(n),...structuredClone(o.initialDraft??{})};t.reclassify??=[];let l=Fi(n),y=Ti(n),x=o.history??null,f=new URLSearchParams(location.search),z=!!o.completed,g=z?"summary":["intro","stage","summary"].includes(f.get("view")??"")?f.get("view"):"intro",m=(f.get("item")&&l.some((r)=>r.id===f.get("item"))?f.get("item"):void 0)??l.find((r)=>jn(r,t)==="pending")?.id??l[0]?.id,M=null,u=null,w=null,Q=!1,Z=!1,dn=!1,xn={},U=!1,Qn=!1,Jn="",D=null,C=Ie.get("impeccable.review.flipHint")==="1",bn=null,W=null,Nn=new Map,hn=new Map,fn=null,pn=()=>matchMedia("(prefers-reduced-motion: reduce)").matches,I=(r)=>n.components.find((s)=>s.id===r),Zn=(r)=>y.find((s)=>s.id===r),R=()=>z||U||!!o.status,kn=(r)=>r.w*n.comp.width/(r.h*n.comp.height),an=new Image;an.onload=()=>{try{let r=Math.min(1,480/an.naturalWidth),s=document.createElement("canvas");s.width=Math.max(1,Math.round(an.naturalWidth*r)),s.height=Math.max(1,Math.round(an.naturalHeight*r));let p=s.getContext("2d",{willReadFrequently:!0});if(p.drawImage(an,0,0,s.width,s.height),fn={data:p.getImageData(0,0,s.width,s.height).data,width:s.width,height:s.height},g==="stage")A()}catch{}},an.src=new URL(n.comp.url,location.href).href;function wn(r){if(!hn.has(r.id)&&fn)hn.set(r.id,Ze(Qe(fn.data,fn.width,fn.height,r.box))??"");return hn.get(r.id)||n.comp.background||"var(--ks-paper-deep)"}function Wn(r,s){if(r.material?.alpha==="transparent")return!0;if(r.material?.alpha==="opaque")return!1;if(Nn.has(s))return Nn.get(s);if(Nn.set(s,!1),!/\.(png|webp)(\?|$)/i.test(s))return!1;let p=new Image;return p.onload=()=>{try{let k=Math.min(1,160/Math.max(p.naturalWidth,p.naturalHeight)),b=document.createElement("canvas");b.width=Math.max(1,Math.round(p.naturalWidth*k)),b.height=Math.max(1,Math.round(p.naturalHeight*k));let h=b.getContext("2d",{willReadFrequently:!0});h.drawImage(p,0,0,b.width,b.height);let c=h.getImageData(0,0,b.width,b.height).data;for(let v=3;v<c.length;v+=4)if(c[v]<250){if(Nn.set(s,!0),g==="stage")A();break}}catch{}},p.src=new URL(s,location.href).href,!1}function rn(r,s,p="fade"){if(s)m=s;if(M=pn()?null:p,g=r,u=null,dn=!1,Z=!1,r!=="summary")w=null,Q=!1;A();let k=r==="intro"?"start":r==="stage"?"decide-yes":"send";a.getElementById(k)?.focus({preventScroll:!0})}function _n(r){if(g!=="stage"||!l.length)return;let s=l.findIndex((p)=>p.id===m)+r;if(s>=l.length)return rn("summary",void 0,"next");if(s<0)return;rn("stage",l[s].id,r>0?"next":"prev")}function li(r,s){if(D)clearTimeout(D.timer);D={label:r,before:s,view:g,current:m,timer:window.setTimeout(()=>{D=null,a.querySelector(".toast")?.classList.add("gone")},6000)}}function Vn(r,s){let p=t;t=r,u=null,Jn="",li(s,p)}function Sn(){let r=l.findIndex((p)=>p.id===m),s=[...l.slice(r+1),...l.slice(0,r+1)].find((p)=>jn(p,t)==="pending");if(s)rn("stage",s.id,"next");else rn("summary",void 0,"next")}function $n(){let r=I(m);if(g!=="stage"||!r||R()||u)return;Vn(Si(t,r,"approve"),`${r.role==="asset"?"Approved":"Kept in code"}: ${r.name}.`),Sn()}function Un(r,s,p=!1){if(R())return;let k=s?Zn(s):void 0,b=k?void 0:I(m),h=b??k;if(!h||b&&r==="reclassify"&&b.role!=="plan")return;let c=b?Mn(b,t):void 0,v=k?qi(t,k.id):void 0,q=c?.action===r&&!!c.split===p;u={type:r,split:p,id:h.id,region:!!k,text:q?c.feedback:p?Ae:v?.feedback??"",kind:c?.kind??v?.kind??Ci({name:h.name,note:h.note??"",flags:b?.flags})},A(),a.getElementById("form-text")?.focus()}function ni(){if(!u||R())return;let r=u;if(r.region){let p=Zn(r.id);Vn(ne(t,p.id,{kind:r.kind,feedback:r.text}),`${p.name} will become ${An[r.kind]}.`),A();return}let s=I(r.id);if(r.type==="revise"&&s.role==="plan"&&!r.text.trim()){a.getElementById("form-text")?.focus();return}Vn(Si(t,s,r.type,{feedback:r.text,kind:r.kind,split:r.split}),r.split?`Split into layers: ${s.name}.`:r.type==="revise"?`Noted: ${s.name}.`:`${s.name} will become ${An[r.kind]}.`),Sn()}function In(){if(!D||R())return;let r=D;clearTimeout(r.timer),D=null,t=r.before,rn(r.view,r.current,"prev")}async function di(){let r=Cn(n,t);if(U||z||u||!r.canSubmit||o.status)return;U=!0,Jn="",A();try{await o.onSubmit($e(n,t)),z=!0,Qn=!0,Q=!1,D=null}catch(s){Jn=s instanceof Error?s.message:"The review could not be saved."}finally{U=!1,A()}}function xi(r){let s=`missing-${crypto.randomUUID()}`;t={...t,inventoryConfirmed:!1,missing:[...t.missing,{id:s,name:"",feedback:"",box:r}]},Q=!1,w={type:"missing",id:s},A(),a.getElementById("missing-name")?.focus()}let J=(r)=>{let s=jn(r,t);if(s==="approved")return r.role==="asset"?"Looks good":"Code is fine";if(s==="revise")return ae(Mn(r,t))?"Split into layers":"Needs work";if(s==="reclassify")return`Becomes ${An[Mn(r,t).kind]}`;return z?"Not decided":"To decide"},X=(r,s="")=>`<span class="pic crop ${s}"><img src="${Hn(n.comp.url)}" alt="" draggable="false" style="width:${100/r.w}%;left:${-100*r.x/r.w}%;top:${-100*r.y/r.h}%"></span>`,$=(r,s,p="gen")=>{let k=Wn(r,s),b=xn[r.id]??"comp",h=!k?"":b==="light"?"var(--ks-paper-raised)":b==="dark"?"var(--ks-instrument)":wn(r);return`<span class="pic ${p}" style="${h?`background:${Y(h)}`:""}"><img src="${Hn(s)}" alt="" draggable="false"></span>`};function N(r){return[...r.code?y.map((p)=>({kind:"region",id:p.id,name:p.name,box:p.box,cls:`code ${qi(t,p.id)?"reclassify":""}`})):[],...n.components.map((p)=>({kind:"item",id:p.id,name:p.name,box:p.box,cls:`is-${p.role} ${Ri(p)||re(p)?"flagged":""} ${jn(p,t)}`})),...t.missing.map((p)=>({kind:"missing",id:p.id,name:p.name||"Missing",box:p.box,cls:"missing"}))].sort((p,k)=>k.box.w*k.box.h-p.box.w*p.box.h).map((p)=>{let k=w?.id===p.id||Z&&g==="stage"&&p.id===m,b=`<span class="tag">${Y(p.name)}</span>`;return r.interactive?`<button type="button" class="region ${p.cls} ${k?"selected":""} ${p.box.y<0.06?"tag-below":""} ${p.box.x>0.7?"tag-right":""}" style="${Pn(p.box)}" data-${p.kind}="${Y(p.id)}" aria-label="${Y(p.name)}">${b}</button>`:`<span class="region ${p.cls}" style="${Pn(p.box)}"></span>`}).join("")}function H(){let r=_e(n,t,g==="stage"?m:void 0),s=r.filter((p)=>p.state!=="pending").length;return`<header class="bar">
      <div class="bar-title"><span class="bar-name">${Y(n.title)}</span><span class="bar-round">Round ${n.round}</span></div>
      ${l.length?`<nav class="lights ${r.length>20?"dense":""}" aria-label="Progress, ${s} of ${r.length} decided">${r.map((p,k)=>`<button type="button" class="light ${p.state==="pending"?"":"decided"} ${p.current?"current":""}" data-go="${Y(p.id)}" aria-label="${Y(`${k+1}. ${p.name}: ${J(I(p.id))}`)}" ${p.current?'aria-current="step"':""}><span class="tip">${Y(p.name)}${p.state==="pending"?"":`<span class="tip-state"> · ${Y(J(I(p.id)))}</span>`}</span></button>`).join("")}<button type="button" class="lights-summary ${g==="summary"?"current":""}" id="to-summary">Summary</button></nav>`:""}
      ${g==="stage"?`<button type="button" class="bar-locator" id="open-map-bar" aria-label="Open the comp">${X({x:0,y:0,w:1,h:1})}</button>`:""}
    </header>`}function F(){if(o.status)return`<div class="banner stale" role="alert">${Ji.alert}<div><strong>This review is out of date.</strong><p>${Y(ar(o.status))} Ask the agent to prepare a new round, then reload this page.</p></div><button id="reload" class="ks-button ks-button-secondary">Reload</button></div>`;if(Jn)return`<div class="banner error" role="alert">${Ji.alert}<div><strong>Your decisions were not sent.</strong><p>${Y(Jn)}</p></div><button id="retry" class="ks-button ks-button-secondary">Try again</button></div>`;return""}function Gn(){let r=!!x&&n.round>1;return`<div class="intro ${M?`enter-${M}`:""}">
      <div class="intro-copy">
        <p class="eyebrow">${r?`Round ${n.round}`:"Before any page code"}</p>
        <h1>${r?"Check what changed.":"Review the plan and assets."}</h1>
        <p class="lead">${Y(Ue(n,t,x))}</p>
        <dl class="kinds-explained">
          <div><dt><i class="swatch asset"></i>A generated image</dt><dd>Does it match the comp?</dd></div>
          <div><dt><i class="swatch plan"></i>A region drawn in code</dt><dd>Can code do it justice, or should it be an image?</dd></div>
        </dl>
        <button type="button" class="ks-button ks-button-primary" id="start">Start${Tn("↵")}${Bn}</button>
      </div>
      <figure class="intro-comp"><div class="map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img class="comp" src="${Hn(n.comp.url)}" alt="The approved comp" draggable="false">${N({code:!1,interactive:!1})}</div></figure>
    </div>`}function P(r){let s=Vi(r.id,x),p=kn(r.box),k=`${r.box.w*n.comp.width}x${r.box.h*n.comp.height}`;if(r.role==="asset"&&r.preview.url){let b=r.preview.url,h=Wn(r,b),c=xn[r.id]??"comp",v=h?`<button type="button" class="ks-switch backdrop-switch" id="backdrop" aria-pressed="${c!=="comp"}" title="Backdrop behind the transparent image"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">${c==="comp"?"On comp colour":c==="light"?"On light":"On dark"}</span></button>`:"",q=`<figure class="fig" data-role="generated"><figcaption><span class="eyebrow">${dn?"In the comp":s?.beforeUrl?"After":"Generated"}</span>${v}</figcaption><div class="frame ${dn?"flipped":""}">${$(r,b)}${X(r.box,"flip")}</div></figure>`,L=`<figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${X(r.box)}</div></figure>`;if(s?.beforeUrl){let B=`<figure class="fig"><figcaption><span class="eyebrow">Before · round ${s.round}</span></figcaption><div class="frame">${$(r,s.beforeUrl,"gen before")}</div></figure>`;return`<div class="figures" data-ratios="${p},${p},${p}" data-natural="${k}">${B}${q}${L}</div>`}return`<div class="figures" data-ratios="${p},${p}" data-natural="${k}">${L}${q}</div>`}if(r.role==="asset")return'<div class="figures empty"><p>This image has no generated file.</p></div>';return`<div class="figures single" data-box="${Y(JSON.stringify(r.box))}"><figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${X(r.box)}<span class="focus-box"></span></div></figure></div>`}function ii(r){if(z)return`<div class="decide-bar"><p class="record">${Y(J(r))}${Mn(r,t)?.feedback?`: “${Y(Mn(r,t).feedback)}”`:"."}</p></div>`;if(u&&!u.region){let k=u.type==="reclassify",b=!k&&r.role==="plan",h=!!u.split;return`<form class="decide-bar form" id="decision-form">
        ${k?`<div class="form-row"><span class="eyebrow" id="kinds-label">Make it</span><div class="ks-instrument-strip is-paper" data-ks-strip="kind" role="group" aria-labelledby="kinds-label">${Di.map((c)=>`<button type="button" class="ks-instrument-key" data-kind="${c.kind}" aria-pressed="${u.kind===c.kind}">${c.label}</button>`).join("")}</div></div>`:""}
        <label class="field"><span class="eyebrow">${k?"Anything the image should keep? Optional":h?"How should it come apart? Edit or keep":b?"What should change?":"What needs to change? Optional"}</span><textarea id="form-text" rows="2" placeholder="${k?"For example: keep the brushed direction horizontal.":b?"For example: extend the hero photo under the nav.":"For example: the figure should face the sea."}">${Y(u.text)}</textarea></label>
        <div class="form-actions"><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel${Tn("Esc")}</button><button type="submit" class="ks-button ks-button-primary">${k?"Make it an image":h?"Split into layers":"Save note"}${Tn("⌘↵")}</button></div>
      </form>`}let s=Mn(r,t),p=r.role==="asset";return`<div class="decide-bar">
      ${s?`<p class="current-decision">${s.action==="approve"?Ji.check:""}<span>${Y(J(r))}${s.feedback?`: “${Y(s.feedback)}”`:"."}</span><button type="button" class="text-action" id="decision-clear">Clear</button></p>`:""}
      <div class="decisions">
        <button type="button" id="decide-yes" class="ks-button ks-button-primary">${p?"Looks good":"Code is fine"}${Tn("A")}</button>
        <button type="button" id="decide-no" class="ks-button ks-button-secondary">${p?"Needs work":"Make it an image"}${Tn("N")}</button>
        ${p?`<button type="button" id="decide-split" class="ks-button ${re(r)?"ks-button-secondary":"ks-button-ghost"}">Split into layers${Tn("S")}</button>`:`<button type="button" id="decide-other" class="ks-button ks-button-ghost">Something else…${Tn("F")}</button>`}
      </div>
    </div>`}function $i(){let r=I(m);if(!r)return'<div class="stage"><p>Nothing to review.</p></div>';let s=l.findIndex((c)=>c.id===r.id)+1,p=Vi(r.id,x),k=r.role==="plan"?[...(r.flags??[]).map(Pi),...r.codeDrawn?["The plan draws this artwork in code."]:[]]:ee(r).map(Pi),b=(r.note??"").trim(),h=r.role==="plan"?`<p class="sentence"><strong>Will be drawn in code:</strong> ${Y(b||Xe(r).toLowerCase())}</p>`:p?.wasCode?`<p class="sentence"><s>Was going to be drawn in code: ${Y(p.wasNote)}</s> Now a generated ${Y(An[r.kind]??r.kind)}.</p>`:b?`<p class="sentence muted">${Y(b)}</p>`:"";return`<div class="stage ${r.role==="plan"?"is-single":""} ${M?`enter-${M}`:""}">
      <div class="stage-head">
        <p class="eyebrow">${r.role==="asset"?`Generated ${Y(An[r.kind]??r.kind)}`:`Drawn in code · ${Y(r.kind)}`} · ${s} of ${l.length}</p>
        <h1>${Y(r.name)}</h1>
        ${p?.splitFrom?`<blockquote class="asked"><span class="eyebrow">A layer of ${Y(p.splitFrom)} · you asked to split it in round ${p.round}</span>${p.words?`<p>“${Y(p.words)}”</p>`:""}</blockquote>`:p?.words?`<blockquote class="asked"><span class="eyebrow">You asked in round ${p.round}</span><p>“${Y(p.words)}”</p></blockquote>`:""}
      </div>
      ${P(r)}
      <div class="stage-foot">
        ${h}
        ${k.map((c)=>`<p class="flag">${Y(c)}</p>`).join("")}
        ${r.role==="asset"&&!C&&!z?`<p class="hint">Hold ${Tn("Space")} to flip to the comp. Hover to magnify both.</p>`:""}
      </div>
      <button type="button" class="locator" id="open-map" aria-label="Open the comp"><span class="locator-map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img src="${Hn(n.comp.url)}" alt="" draggable="false"><span class="locator-box" style="${Pn(r.box)}"></span></span><span class="locator-label">Comp ${Tn("C")}</span></button>
    </div>
    ${ii(r)}`}function Gi(){if(w?.type==="missing"){let r=t.missing.find((s)=>s.id===w.id);if(!r)return"";return`<div class="side-panel"><p class="eyebrow missing">Missing from the review</p>
        <label class="field"><span class="eyebrow">Name</span><input id="missing-name" value="${Y(r.name)}" placeholder="For example: harbour boat" ${R()?"disabled":""}></label>
        <label class="field"><span class="eyebrow">What is missing? Optional</span><textarea id="missing-feedback" rows="2" ${R()?"disabled":""}>${Y(r.feedback)}</textarea></label>
        <div class="form-actions start"><button type="button" id="panel-done" class="ks-button ks-button-secondary">Done</button>${R()?"":'<button type="button" id="missing-remove" class="ks-button ks-button-ghost">Remove</button>'}</div></div>`}if(w?.type==="region"){let r=Zn(w.id);if(!r)return"";let s=qi(t,r.id),p=u?.region&&u.id===r.id;return`<div class="side-panel"><p class="eyebrow">Set in code · ${Y(r.kind)}</p><h3>${Y(r.name)}</h3>
        <div class="panel-crop" style="aspect-ratio:${Math.max(0.5,Math.min(6,kn(r.box)))}">${X(r.box)}</div>
        ${p?`<form id="decision-form" class="panel-form"><div class="ks-instrument-strip is-paper" data-ks-strip="region-kind" role="group" aria-label="Make it">${Di.map((k)=>`<button type="button" class="ks-instrument-key" data-kind="${k.kind}" aria-pressed="${u.kind===k.kind}">${An[k.kind][0].toUpperCase()+An[k.kind].slice(1)}</button>`).join("")}</div><textarea id="form-text" rows="2" placeholder="Anything the image should keep? Optional">${Y(u.text)}</textarea><div class="form-actions start"><button type="submit" class="ks-button ks-button-primary">Make it an image</button><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel</button></div></form>`:s?`<p class="current-decision"><span>Becomes ${Y(An[s.kind])}${s.feedback?`: “${Y(s.feedback)}”`:"."}</span>${R()?"":'<button type="button" class="text-action" id="region-keep">Keep in code</button>'}</p>`:`<p class="muted">Checked in the first-viewport review, once the page is built.</p><div class="form-actions start">${R()?"":'<button type="button" class="ks-button ks-button-secondary" id="region-image">Make it an image</button>'}<button type="button" id="panel-done" class="ks-button ks-button-ghost">Close</button></div>`}
      </div>`}return`<div class="side-panel quiet"><p>Every outlined region above was on your list. Hover the comp to see what is set in code; click a region to make it an image.</p>${R()?"":`<button type="button" class="ks-button ks-button-secondary" id="mark" aria-pressed="${Q}">${Q?"Cancel marking":"Mark missing"}</button>`}${Q?'<p class="marking-hint">Drag on the comp around what is missing.</p>':""}${t.missing.length?`<ul class="missing-list">${t.missing.map((r)=>`<li><button type="button" class="text-action" data-missing="${Y(r.id)}">${Y(r.name||"Unnamed missing piece")}</button></li>`).join("")}</ul>`:""}</div>`}function Qi(){let r=Cn(n,t),s=o.status?"This round can no longer be sent.":r.pending&&!r.hasChanges?`${r.pending} still to decide.`:r.mode==="approve"?"Approval confirms nothing is missing from the comp.":`${r.pending?`${r.pending} undecided stay open. `:""}The agent applies your notes and opens a new round.`,p=(k)=>{let b=Mn(k,t),h=jn(k,t),c;if(k.role==="asset"&&k.preview.url){let v=kn(k.box);c=`<span class="card-pic" style="aspect-ratio:${v};width:min(100%, ${Math.round(118*v)}px)">${$(k,k.preview.url)}</span>`}else{let v=ie(k.box,n.comp.width,n.comp.height,220,118),q=v.view;c=`<span class="card-pic" style="width:${Math.floor(v.width)}px;height:${Math.floor(v.height)}px"><span class="pic crop"><img src="${Hn(n.comp.url)}" alt="" draggable="false" style="width:${100/q.w}%;left:${-100*q.x/q.w}%;top:${-100*q.y/q.h}%"></span><span class="focus-box" style="${Pn({x:(k.box.x-q.x)/q.w,y:(k.box.y-q.y)/q.h,w:k.box.w/q.w,h:k.box.h/q.h})}"></span></span>`}return`<button type="button" class="card ${h}" data-go="${Y(k.id)}"><span class="card-thumb">${c}</span><span class="card-text"><span class="card-name">${Y(k.name)}</span><span class="card-state">${h==="approved"?Ji.check:""}${Y(J(k))}</span>${b?.feedback?`<span class="card-note">“${Y(b.feedback)}”</span>`:""}</span></button>`};return`<div class="summary ${M?`enter-${M}`:""}">
      <div class="summary-head">
        <p class="eyebrow">${z?`Round ${n.round} · sent`:"Summary"}</p>
        <h1>${z?r.hasChanges?"Notes sent.":"Plan and assets approved.":r.pending?"Almost there.":"Your decisions."}</h1>
        ${z?`<p class="lead">${r.hasChanges?"The agent applies them and opens a new round for anything that changed.":"The agent continues to the first viewport."}${Qn?"":" This round is read-only."}</p>`:""}
      </div>
      <div class="sheet">${l.map(p).join("")}</div>
      <section class="coverage" aria-label="Coverage">
        <h2>Anything on the comp we didn't cover?</h2>
        <div class="coverage-grid">
          <div class="map-space"><div class="map ${Q?"marking":""} ${w?"has-selection":""}" id="summary-map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img class="comp" src="${Hn(n.comp.url)}" alt="The approved comp" draggable="false">${N({code:!0,interactive:!0})}<div class="draw-box" hidden></div></div></div>
          ${Gi()}
        </div>
      </section>
    </div>
    ${z?"":`<div class="send-row"><div class="send-inner"><p>${Y(s)}</p><button type="button" class="ks-button ks-button-primary" id="send" ${!r.canSubmit||!!u||U||!!o.status?"disabled":""}>${U?"Sending…":Y(Ke(n,t))}${U?"":Bn}</button></div></div>`}`}function hi(){if(!Z)return"";return`<div class="overlay" role="dialog" aria-modal="true" aria-label="The comp"><div class="overlay-head"><span class="eyebrow">The comp · click a region to go to it</span><button type="button" class="ks-button ks-button-ghost" id="close-map">Close${Tn("Esc")}</button></div>
      <div class="overlay-body"><div class="map has-selection" id="overlay-map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img class="comp" src="${Hn(n.comp.url)}" alt="The approved comp" draggable="false">${N({code:!0,interactive:!0})}</div></div></div>`}function A(){bn?.disconnect(),W?.();let s=a.activeElement?.id,p=g==="summary"?a.querySelector(".view-summary .screen")?.scrollTop??0:0;a.innerHTML=`<style>${Be}</style><section class="rv view-${g} ${z?"is-submitted":""}" aria-label="Plan and asset review">
      ${H()}${F()}
      <main class="screen">${g==="intro"?Gn():g==="stage"?$i():Qi()}</main>
      ${D?`<div class="toast" role="status"><span>${Y(D.label)}</span><button type="button" class="text-action" id="undo">Undo${Tn("⌘Z")}</button></div>`:""}
      ${hi()}
    </section>`,M=null;let k=a.querySelector(".screen");if(k&&p)k.scrollTop=p;if(s)a.getElementById(s)?.focus({preventScroll:!0});if(on(),ki(),bn=new ResizeObserver(ki),bn.observe(a.querySelector(".screen")),W=Yi(a),!z)o.onDraftChange?.(structuredClone(t))}function ki(){let r=matchMedia("(max-width: 760px)").matches,s=a.querySelector(".figures[data-ratios]");if(s&&s.clientWidth){let k=s.dataset.ratios.split(",").map(Number),[b,h]=(s.dataset.natural??"0x0").split("x").map(Number),c=r?{direction:"column",sizes:k.map((v)=>({w:Math.min(s.clientWidth,360*v),h:Math.min(s.clientWidth,360*v)/v}))}:Le(k,s.clientWidth,s.clientHeight,28,30,4,{w:b,h});s.dataset.direction=c.direction,s.querySelectorAll(":scope > .fig > .frame").forEach((v,q)=>{v.style.width=`${Math.floor(c.sizes[q].w)}px`,v.style.height=`${Math.floor(c.sizes[q].h)}px`}),O(s)}let p=a.querySelector(".figures.single");if(p?.clientWidth){let k=JSON.parse(p.dataset.box),b=p.closest(".stage"),h=b.clientHeight-36-28-(b.querySelector(".stage-head")?.offsetHeight??0)-(b.querySelector(".stage-foot")?.offsetHeight??0)-30-80,c=ie(k,n.comp.width,n.comp.height,Math.min(p.clientWidth,1120),r?320:Math.max(80,h)),v=p.querySelector(".frame"),q=v.querySelector("img"),L=v.querySelector(".focus-box"),B=c.view;v.style.width=`${Math.floor(c.width)}px`,v.style.height=`${Math.floor(c.height)}px`,q.style.cssText=`width:${100/B.w}%;left:${-100*B.x/B.w}%;top:${-100*B.y/B.h}%`,L.style.cssText=Pn({x:(k.x-B.x)/B.w,y:(k.y-B.y)/B.h,w:k.w/B.w,h:k.h/B.h}),O(p)}for(let k of a.querySelectorAll(".overlay-body .map, .intro-comp .map")){let b=k.parentElement,h=getComputedStyle(b),c=b.clientWidth-parseFloat(h.paddingLeft)-parseFloat(h.paddingRight),v=b.clientHeight-parseFloat(h.paddingTop)-parseFloat(h.paddingBottom);if(!c||!v)continue;let q=Math.min(c/n.comp.width,v/n.comp.height);k.style.width=`${n.comp.width*q}px`,k.style.height=`${n.comp.height*q}px`}}let ei=78,G=3;function O(r){r.querySelectorAll(".frame").forEach((s)=>{s.querySelector(".lens")?.remove();let p=document.createElement("span");p.className="lens",p.setAttribute("aria-hidden","true");let k=document.createElement("span");k.className="lens-inner",k.style.width=`${s.clientWidth}px`,k.style.height=`${s.clientHeight}px`,s.querySelectorAll(":scope > .pic, :scope > .focus-box").forEach((b)=>k.append(b.cloneNode(!0))),p.append(k),s.append(p)})}function S(r,s){a.querySelectorAll(".figures .frame").forEach((p)=>{let k=p.querySelector(".lens"),b=k?.querySelector(".lens-inner");if(!k||!b)return;let{clientWidth:h,clientHeight:c}=p;k.style.transform=`translate(${r*h-ei}px, ${s*c-ei}px)`;let v=Ne(r,s,h,c,ei,G);b.style.transform=`translate(${v.x}px, ${v.y}px) scale(${G})`})}function on(){let r=(h,c)=>a.getElementById(h)?.addEventListener("click",c);r("start",()=>{let h=l.find((c)=>jn(c,t)==="pending")??l[0];if(h)rn("stage",h.id,"next");else rn("summary")}),a.querySelectorAll("[data-go]").forEach((h)=>h.addEventListener("click",()=>{let c=h.dataset.go,v=l.findIndex((q)=>q.id===m);rn("stage",c,g!=="stage"?"fade":l.findIndex((q)=>q.id===c)>=v?"next":"prev")})),r("to-summary",()=>rn("summary",void 0,"next")),r("decide-yes",$n),r("decide-no",()=>Un(I(m)?.role==="asset"?"revise":"reclassify")),r("decide-other",()=>Un("revise")),r("decide-split",()=>Un("revise",void 0,!0)),r("decision-clear",()=>{let h=I(m);if(h&&!R())Vn(Je(t,h.id),`Cleared: ${h.name}.`),A()}),r("form-cancel",()=>{u=null,A()}),a.getElementById("decision-form")?.addEventListener("submit",(h)=>{h.preventDefault(),ni()}),a.getElementById("form-text")?.addEventListener("input",(h)=>{if(u)u.text=h.target.value}),a.querySelectorAll("[data-kind]").forEach((h)=>h.addEventListener("click",()=>{if(!u)return;u.kind=h.dataset.kind,a.querySelectorAll("[data-kind]").forEach((c)=>c.setAttribute("aria-pressed",String(c===h)))})),r("backdrop",()=>{let h=I(m);if(!h)return;let c=["comp","light","dark"];xn[h.id]=c[(c.indexOf(xn[h.id]??"comp")+1)%3],A()}),r("undo",In),r("send",()=>void di()),r("retry",()=>void di()),r("reload",()=>location.reload());let s=()=>{Z=!0,A(),a.getElementById("close-map")?.focus()};if(r("open-map",s),r("open-map-bar",s),r("close-map",()=>{Z=!1,A()}),r("mark",()=>{if(R())return;Q=!Q,w=null,u=null,A()}),r("panel-done",()=>{w=null,u=null,A()}),r("region-image",()=>{if(w?.type==="region")Un("reclassify",w.id)}),r("region-keep",()=>{let h=w?.type==="region"?Zn(w.id):void 0;if(h&&!R())Vn(ne(t,h.id,null),`${h.name} stays in code.`),A()}),r("missing-remove",()=>{if(w?.type!=="missing")return;let h=w.id;t={...t,missing:t.missing.filter((c)=>c.id!==h)},w=null,A()}),a.getElementById("missing-name")?.addEventListener("input",(h)=>{let c=t.missing.find((v)=>v.id===w?.id);if(c){c.name=h.target.value;let v=a.getElementById("send");if(v)v.disabled=!Cn(n,t).canSubmit||U||!!o.status;o.onDraftChange?.(structuredClone(t))}}),a.getElementById("missing-feedback")?.addEventListener("input",(h)=>{let c=t.missing.find((v)=>v.id===w?.id);if(c)c.feedback=h.target.value,o.onDraftChange?.(structuredClone(t))}),R())a.querySelectorAll("#decide-yes,#decide-no,#decide-other,#decide-split,#decision-clear,#mark,#region-image").forEach((h)=>h.disabled=!0);a.querySelectorAll(".map [data-item]").forEach((h)=>h.addEventListener("click",()=>{if(!Q)rn("stage",h.dataset.item,"fade")}));let p=(h)=>{if(Q)return;if(w=h,u=null,g!=="summary")g="summary",Z=!1,M=pn()?null:"fade";A(),a.querySelector(".coverage")?.scrollIntoView({block:"start"})};a.querySelectorAll("[data-region]").forEach((h)=>h.addEventListener("click",()=>p({type:"region",id:h.dataset.region}))),a.querySelectorAll("[data-missing]").forEach((h)=>h.addEventListener("click",()=>p({type:"missing",id:h.dataset.missing})));let k=a.querySelector(".figures");k?.querySelectorAll(":scope > .fig > .frame").forEach((h)=>{h.addEventListener("pointerenter",(c)=>{if(c.pointerType==="mouse")k.classList.add("looking")}),h.addEventListener("pointerleave",()=>k.classList.remove("looking")),h.addEventListener("pointermove",(c)=>{let v=h.getBoundingClientRect();S((c.clientX-v.left)/v.width,(c.clientY-v.top)/v.height)})});let b=a.getElementById("summary-map");if(b){let h=(q)=>{let L=b.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(q.clientX-L.left)/L.width)),y:Math.max(0,Math.min(1,(q.clientY-L.top)/L.height))}},c=null,v=null;b.addEventListener("pointerdown",(q)=>{if(!Q)return;c=h(q),v=null,b.setPointerCapture(q.pointerId),q.preventDefault()}),b.addEventListener("pointermove",(q)=>{if(!c)return;let L=h(q);v={x:Math.min(c.x,L.x),y:Math.min(c.y,L.y),w:Math.abs(L.x-c.x),h:Math.abs(L.y-c.y)};let B=a.querySelector(".draw-box");B.hidden=!1,B.style.cssText=Pn(v)}),b.addEventListener("pointerup",()=>{if(v&&v.w>0.01&&v.h>0.01)xi(v);c=null,v=null}),b.addEventListener("pointercancel",()=>{c=null,v=null,A()})}}function tn(r){if(dn===r)return;dn=r,a.querySelectorAll('[data-role="generated"] .frame').forEach((p)=>p.classList.toggle("flipped",r));let s=a.querySelector('[data-role="generated"] figcaption .eyebrow');if(s)s.textContent=r?"In the comp":Vi(m??"",x)?.beforeUrl?"After":"Generated";if(r&&!C)C=!0,Ie.set("impeccable.review.flipHint","1"),a.querySelector(".hint")?.classList.add("gone")}let ri=(r)=>{let s=r;if(!e.isConnected||s.defaultPrevented)return;let p=s.composedPath()[0],k=p instanceof HTMLTextAreaElement||p instanceof HTMLInputElement;if(s.key==="Escape"){if(Z)s.preventDefault(),Z=!1,A();else if(u)s.preventDefault(),u=null,A();else if(Q)s.preventDefault(),Q=!1,A();else if(w)s.preventDefault(),w=null,A();return}if(s.key==="Enter"&&(s.metaKey||s.ctrlKey)&&u){s.preventDefault(),ni();return}if(k||s.altKey||s.isComposing)return;if((s.metaKey||s.ctrlKey)&&s.key.toLowerCase()==="z"){if(D)s.preventDefault(),In();return}if(s.metaKey||s.ctrlKey)return;if(g==="intro"&&s.key==="Enter"&&p?.tagName!=="BUTTON"){s.preventDefault(),a.getElementById("start")?.click();return}if(Z||u)return;let b=s.key.toLowerCase();if(s.key===" "&&g==="stage"&&I(m)?.role==="asset"&&p?.tagName!=="BUTTON"&&p?.tagName!=="A"){if(s.preventDefault(),!s.repeat)tn(!0);return}if(s.key===" "&&g==="stage"&&I(m)?.role==="asset"){if(s.preventDefault(),!s.repeat)tn(!0);return}if(b==="c"&&g!=="intro"){s.preventDefault(),Z=!0,A();return}if(g!=="stage"||R()){if(g==="summary"&&(b==="k"||s.key==="ArrowLeft")&&l.length&&!R())s.preventDefault(),rn("stage",l[l.length-1].id,"prev");return}if(b==="a")s.preventDefault(),$n();else if(b==="n")s.preventDefault(),a.getElementById("decide-no")?.click();else if(b==="f"&&I(m)?.role==="plan")s.preventDefault(),Un("revise");else if(b==="s"&&I(m)?.role==="asset")s.preventDefault(),Un("revise",void 0,!0);else if(b==="j"||s.key==="ArrowRight")s.preventDefault(),_n(1);else if(b==="k"||s.key==="ArrowLeft")s.preventDefault(),_n(-1)},ai=(r)=>{if(r.key===" "&&dn)r.preventDefault(),tn(!1)},oi=()=>tn(!1);return document.addEventListener("keydown",ri),document.addEventListener("keyup",ai),window.addEventListener("blur",oi),A(),{destroy(){bn?.disconnect(),W?.(),document.removeEventListener("keydown",ri),document.removeEventListener("keyup",ai),window.removeEventListener("blur",oi),a.replaceChildren()},getDraft(){return structuredClone(t)}}}var T=(e)=>e.replace(/[&<>"']/g,(n)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]),Ln=(e)=>`${e*100}%`,qn=(e)=>{let n=new URL(e,location.href);if(!["http:","https:"].includes(n.protocol))throw Error("Unsupported preview URL");return T(n.href)};function De(e,n,o){if(Mi(n))return Oe(e,n,{...o,history:o.history,initialDraft:o.initialDraft,onDraftChange:o.onDraftChange,onSubmit:o.onSubmit});let a=e.attachShadow({mode:"open"}),t=structuredClone(o.initialDraft??fe(n)),l=n.stage==="hero"&&n.components.length===1&&!t.missing.length,y=()=>[...n.components].sort((X,$)=>cn(X,t,o.history).priority-cn($,t,o.history).priority),x=y().find((X)=>cn(X,t,o.history).kind!=="approved")?.id??n.components[0]?.id,f=Fn(n,t).pending?"pending":"reviewed",z=!1,g=!1,m=o.completed??!1,M="",u={},w=!!o.completed||!Fn(n,t).pending,Q=null,Z=!0,dn=/Mac|iPhone|iPad/.test(navigator.platform)?"⌘Enter":"Ctrl+Enter",xn=!1,U=!1,Qn=!1,Jn=null,D=!1,C=!0,bn=!1,W="comp",Nn=W,hn="fit",fn="checker",pn=!1,I="isolated",Zn,R="fit",kn=null,an=null,wn=null,Wn=null,rn='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>',_n='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11 1 2 2-1 7-7-3-3-7 7v2Z"/></svg>',li=(X,$)=>{if(X.stage==="hero")return"";let N=yi(X,$);if(!N.related.length)return"";let H=N.related.map((F)=>T(F.name)).join(" · ");return`<div class="review-scope" aria-label="Review scope"><p><strong>Reviewing</strong> ${T(N.description||$.name)}</p><p class="separate-reviews"><strong>Outlined · reviewed separately</strong> ${H}</p>${N.excluded.length?`<p class="scope-excluded">Hidden in this preview: ${N.excluded.map((F)=>T(F.name)).join(" · ")}</p>`:""}</div>`},Vn=(X)=>`left:${Ln(X.x)};top:${Ln(X.y)};width:${Ln(X.w)};height:${Ln(X.h)}`,Sn=(X,$)=>X.stage==="hero"?"":yi(X,$).related.map((N)=>{let H=$.box,F=N.box,Gn=Math.max(H.x,F.x),P=Math.max(H.y,F.y),ii={x:(Gn-H.x)/H.w,y:(P-H.y)/H.h,w:Math.max(0,Math.min(H.x+H.w,F.x+F.w)-Gn)/H.w,h:Math.max(0,Math.min(H.y+H.h,F.y+F.h)-P)/H.h};return`<span class="reference-layer" style="${Vn(ii)}" title="Reviewed separately: ${T(N.name)}" aria-label="Reviewed separately: ${T(N.name)}"><span>${T(N.name)}</span></span>`}).join("");function $n(X){a.getElementById(X)?.focus({preventScroll:!0})}function Un(X){let $=ye(n,t,X);if(w=!$,$)x=$;W="component",pn=!1,xn=!1,hn="fit",I="isolated",Z=!0,f=w?"reviewed":"pending";let N=()=>{J(),$n(w?"review-summary":u[x]?"feedback":"approve")};if(w&&U&&Jn)Jn(N);else N()}async function ni(){if(g||m||pn||Object.keys(u).length)return;g=!0,M="",J();try{await o.onSubmit(me(n,t)),m=!0,w=!0,z=!1,f="reviewed"}catch(X){M=X instanceof Error?X.message:"Could not save. Try again."}finally{g=!1,J()}}function In(X){if(g||m||pn||Qn)return;let $=n.components.find((P)=>P.id===x);if(!$||!pi(n,t,$,Z,Object.keys(u)).length)return;let N=t.decisions[$.id],H=N?.revision===$.revision?N:void 0,F=pi(n,t,$,Z,Object.keys(u));Q={id:$.id,name:F.length>1?`${$.reviewGroup} · ${F.length} instances`:$.name,action:X,previous:Object.fromEntries(F.map((P)=>[P.id,t.decisions[P.id]?{...t.decisions[P.id]}:void 0]))};let Gn=u[$.id]??H;for(let P of F)t.decisions[P.id]={revision:P.revision,action:X,feedback:X==="revise"?Gn?.feedback??"":"",split:X==="revise"&&(Gn?.split??!1)};if(delete u[$.id],bn)C=!0,bn=!1;if(l)t.inventoryConfirmed=X==="approve",Q=null,ni();else Un($.id)}function di(){if(g||m||pn||Qn)return;let X=n.components.find((H)=>H.id===x);if(!X||!pi(n,t,X,Z,Object.keys(u)).length)return;let $=t.decisions[X.id],N=$?.revision===X.revision?$:void 0;if(u[X.id]??={feedback:N?.feedback??"",split:N?.split??!1},C&&(a.querySelector(".workbench")?.clientHeight??0)<420)bn=!0,C=!1;w=!1,J(),$n("feedback")}function xi(X){let $=`missing-${crypto.randomUUID()}`;t.missing.push({id:$,name:"Missing component",feedback:"",box:X}),t.inventoryConfirmed=!1,w=!1,x=$,W="component",z=!1,kn=null,an=null,J(),a.querySelector("#missing-name")?.focus()}function J(){if(wn?.disconnect(),Wn?.(),m||w&&!l)U=!1;let X=a.activeElement,$=X?.id,N=X?.dataset.select,H=window.scrollX,F=window.scrollY,Gn=a.querySelector(".inventory")?.scrollLeft??0,P=Zn===x,ii=W==="component"&&(!P||Nn!==W);Nn=W;let $i=P?a.querySelector(".inspection-content")?.scrollTop??0:0,Gi=P&&(a.querySelector(".changed-files")?.open??!1),Qi=a.querySelector(".comparison-slot")?.clientHeight??200,hi=a.querySelector(".pan-viewport"),A=Zn===x&&R===hn,ki=A?hi?.scrollLeft??0:0,ei=A?hi?.scrollTop??0:0;Zn=x,R=hn;let G=n.components.find((i)=>i.id===x),O=t.missing.find((i)=>i.id===x),S=ze(n,t,o.history),on=S.find((i)=>i.members.some((d)=>d.id===x)),tn=!!on&&on.members.length>1&&Z,ri=tn?on.box:G?.box??O?.box,ai=on?S.indexOf(on)+1:S.length+t.missing.findIndex((i)=>i.id===x)+1,oi=G?t.decisions[G.id]:void 0,r=oi?.revision===G?.revision?oi:void 0,s=G?u[G.id]:void 0,p=Object.keys(u).length>0,k=G?mi(n,G):[],b=G?pi(n,t,G,Z,Object.keys(u)):[],h=G?!n.components.some((i)=>!b.some((d)=>d.id===i.id)&&cn(i,t).kind==="pending"):!1,c=Q&&!m?`<div class="decision-notice"><span role="status">${T(Q.name)} ${Q.action==="approve"?"approved":"flagged for repair"}.</span><button id="undo-decision" class="text-action">Undo</button></div>`:"",v=Fn(n,t),q=o.history,L=G?wi(G.id,q):void 0,B=q?.packet.components.find((i)=>i.id===G?.id),En=pn&&!!B,V=En?B:G,ln=En?q.packet:n,oe=Object.values(q?.changes??{}),te=oe.filter((i)=>i.kind==="changed").length,se=oe.filter((i)=>i.kind==="added").length,Zi=n.components.filter((i)=>cn(i,t,q).kind==="approved"&&wi(i.id,q).carried).length,Ui=(i)=>{let d=cn(i,t,q);return m&&d.kind==="feedback"?{...d,label:"Changes requested"}:d},ti=S.filter((i)=>i.kind==="pending").length,Re=S.length-ti+t.missing.length,pe=S.filter((i)=>f==="all"||i.kind==="pending"===(f==="pending")).map((i)=>i.representative),Fe=(i)=>S.find((d)=>d.members.some((j)=>j.id===i))?.label??i,Ce=[v.revisions+t.missing.length?`${v.revisions+t.missing.length} feedback ready`:"",Zi?`${Zi} ${Zi===1?"approval":"approvals"} kept`:"",te?`${te} changed`:"",se?`${se} added`:"",q?.removed.length?`${q.removed.length} removed`:""].filter(Boolean).join(" · "),Pe=M||(p?"Save or cancel your open feedback before sending.":m?o.preview?"Preview submitted. No run changed.":"Review submitted.":v.hasFeedback?"Ready to send for corrections.":v.pending?`${ti} left to review`:!t.inventoryConfirmed?"Confirm the map is complete.":"Ready to continue."),Yn=V?Rn(V):null,Ai=V?.preview.kind==="image"&&!Yn?.code,Li=Ai||V?.material?.alpha==="transparent",mn=!!(V?.context&&I==="context"),le=V&&(mn?V.context?.kind!=="image":V.preview.kind==="page"),Ni=mn&&V?.context?V.context.url:V?.preview.url,de=V?yi(ln,V):null,Se=Yn?.code?`${Yn.label} · ${Yn.captured?"captured from code":"live preview"}`:V?.material?`${V.material.alpha==="transparent"?"Transparent":V.material.alpha==="opaque"?"Opaque":"Transparency unverified"} ${V.material.format}`:"Raster · transparency unverified";a.innerHTML=`<style>${Ee}</style><section class="review ${l?"assembled-review":""}" aria-label="${l?"Assembled page review":"Component review"}" style="--comp-background:${/^#[0-9a-f]{6}$/i.test(n.comp.background??"")?n.comp.background:"#eeeeee"}">
      <header><div><h1>${m?"Review record.":l?"Review the assembled page.":"Review the components."}</h1><p>${T(n.title)} <span>· Round ${n.round}</span></p></div>${m?'<span class="badge">Submitted · read-only</span>':o.preview?'<span class="badge">Interactive preview</span>':""}</header>
      ${o.preview?'<p class="preview-note">Historical hotel artwork for testing this interface. Decisions stay in this preview; no run is changed.</p>':""}
      ${q&&!l?`<section class="round-summary" aria-label="Changes since previous round"><p><strong>${ti} ${ti===1?"item":"items"} to review</strong><span>${Ce}</span></p>${v.pending?`<button id="review-changes" class="ks-icon-button" aria-label="Next to review" title="Next to review">${zn("next")}</button>`:""}${q.removed.length?`<details><summary>Removed from the map</summary><p>${q.removed.map((i)=>T(i.name)).join(" · ")}. Confirm these omissions are intentional before accepting the map.</p></details>`:""}</section>`:""}
      ${!l?`<div class="mobile-panes"><div class="ks-instrument-strip is-paper" data-ks-strip="pane" role="group" aria-label="Inspection view"><button type="button" class="ks-instrument-key" id="show-comp" aria-pressed="${W==="comp"}">Approved comp</button><button type="button" class="ks-instrument-key" id="show-component" aria-pressed="${W==="component"}">Component ${ai}</button></div></div>`:""}
      <div class="workbench" data-mobile-pane="${W}">${!l?`<svg class="connector" aria-hidden="true"><path /></svg>
        <section class="reference" aria-label="Approved composition">
          <div class="section-head"><h2>Approved comp</h2>${!m?`<button id="mark" class="ks-button ks-button-ghost" aria-pressed="${z}">${z?"Cancel":"Mark missing"}</button>`:""}</div>
          <div class="map-space"><div class="map ${z?"marking":""}" style="aspect-ratio:${n.comp.width}/${n.comp.height}">
            <img class="comp" src="${qn(n.comp.url)}" alt="Approved composition for ${T(n.title)}" draggable="false">
            ${ri&&!w?`<div class="region" style="${Vn(ri)}"></div>`:""}
            ${S.map((i,d)=>{let j=i.representative,E={kind:i.kind,label:i.stateLabel},un=!w&&on?.id===i.id;return`<button class="pin ${E.kind} ${un?"selected":""}" data-select="${T(j.id)}" style="left:${Ln(Math.min(0.96,i.box.x+i.box.w/2))};top:${Ln(Math.max(0.035,i.box.y))}" aria-label="Inspect ${T(i.label)}${i.members.length>1?` · ${i.members.length} instances`:""} — ${T(E.label)}" title="${d+1}. ${T(i.label)} · ${T(E.label)}" aria-pressed="${un}">${E.kind==="approved"?rn:E.kind==="feedback"?_n:""}<span>${d+1}</span>${i.members.length>1?`<small>×${i.members.length}</small>`:""}</button>`}).join("")}
            ${tn&&!w?on.members.map((i)=>`<div class="region instance-region" style="${Vn(i.box)}"></div>`).join(""):""}
            ${t.missing.map((i,d)=>`<button class="pin feedback ${!w&&x===i.id?"selected":""}" data-select="${T(i.id)}" style="left:${Ln(i.box.x+i.box.w/2)};top:${Ln(i.box.y)}" aria-label="Inspect missing ${T(i.name)}" title="Missing: ${T(i.name)}">${_n}<span>${S.length+d+1}</span></button>`).join("")}

            <div class="draw-box" hidden></div>
          </div></div>
          <div class="map-legend" aria-label="Map status legend"><span><i class="legend-pending">#</i> To review</span><span><i class="legend-feedback">${_n}</i> ${m?"Changes requested":"Feedback ready"}</span><span><i class="legend-approved">${rn}</i> Approved</span></div>
          ${z?'<div class="map-caption">Draw around the missing piece.<button id="add-box">Add an adjustable box</button></div>':""}
        </section>`:""}
        <section class="inspector" aria-label="${l?"Page comparison":"Selected component"}">
          ${!l?`<div class="section-head"><h2>${w?"Review summary":`<span class="number">${ai}</span> ${T(tn?on.label:G?.name??O?.name??"Component")}`}</h2></div>`:""}<div class="inspection-content" role="region" aria-label="${l?"Page comparison":"Component comparison"}" tabindex="0">
          ${w&&!l?`<section class="review-summary" id="review-summary" tabindex="-1"><div class="completion-mark" aria-hidden="true">${rn}</div><h2>${m?"Review sent.":"All components reviewed."}</h2><p>${v.approved} approved · ${v.revisions} flagged for repair${t.missing.length?` · ${t.missing.length} missing`:""}</p><p>${m?"Your decisions are saved.":v.hasFeedback?"Send your feedback to start the next repair round.":"Confirm nothing is missing, then approve and continue."}</p><div class="summary-decisions">${S.map((i)=>{let d=i.representative,j=t.decisions[d.id],E=Ui(d);return`<button data-select="${T(d.id)}"><strong>${T(i.label)}</strong><span>${i.kind==="pending"?"Not reviewed":E.kind==="feedback"?"Needs work":"Approved"}</span>${j?.action==="revise"?`<small>${T(j.feedback||"No note — agent will diagnose.")}</small>`:""}</button>`}).join("")}${t.missing.map((i)=>`<button data-select="${T(i.id)}"><strong>${T(i.name)}</strong><span>Missing</span><small>${T(i.feedback)}</small></button>`).join("")}</div></section></div>${c?`<div class="review-form">${c}</div>`:""}`:G?`
          ${q?`<div class="repair-context">
            ${En&&L?.prior?.action==="revise"?`<section class="previous-feedback" aria-label="Previous feedback"><h3>Previous feedback <span>· Round ${L.feedbackRound}</span></h3><blockquote>${T(L.prior.feedback||"No written feedback was supplied.")}</blockquote>${L.prior.split?"<p>Requested: split into separately reviewable components.</p>":""}</section>`:L?.carried?'<p class="kept-approval">Unchanged · approval kept</p>':""}
            ${L?.change?.kind==="changed"?`<details class="changed-files" ${Gi?"open":""}><summary>${L.change.files.length?`${L.change.files.length} changed ${L.change.files.length===1?"file":"files"}`:L.change.reasons.includes("region")?"Region changed":B?.note!==G.note?"Description changed · files unchanged":"Component definition changed · files unchanged"}</summary>${L.change.files.length?`<ul>${L.change.files.map((i)=>`<li>${T(i)}</li>`).join("")}</ul>`:""}${B&&B.note!==G.note?`<dl class="description-diff"><dt>Previous description</dt><dd>${T(B.note)}</dd><dt>Current description</dt><dd>${T(G.note)}</dd></dl>`:""}</details>`:""}
          </div>`:""}

          <div class="comparison-slot"><div class="comparison-panel ${tn?"group-overview":""}"><h2 class="expanded-title">${T(tn?on.label:V.name)}</h2>${k.length>1?`<div class="review-peers"><strong>${k.length} instances</strong>${!tn?'<button id="all-instances" class="quiet">All instances</button>':'<span class="group-hint">Select to inspect</span>'}</div>`:""}<div class="compare-toolbar">${B?`<div class="round-switch ks-instrument-strip is-paper" data-ks-strip="round" role="group" aria-label="Preview version"><button type="button" class="ks-instrument-key" id="current-round" aria-label="Current · round ${n.round}" title="Current · round ${n.round}" aria-pressed="${!En}">Current</button><button type="button" class="ks-instrument-key" id="previous-round" aria-label="Previous · round ${q.packet.round}" title="Previous · round ${q.packet.round}" aria-pressed="${En}">Previous</button></div>`:""}<div class="ks-instrument-strip is-paper zoom-strip" data-ks-strip="zoom" role="group" aria-label="Comparison zoom">${[["fit","Fit"],["1","100%"],["2","200%"],["4","400%"]].map(([i,d])=>`<button type="button" class="ks-instrument-key" data-zoom="${i}" aria-pressed="${String(hn)===i}">${d}</button>`).join("")}</div><button id="overlay" type="button" class="ks-switch" title="Overlay the approved comp" aria-pressed="${xn}"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">Overlay</span></button><div class="comparison-actions" role="group" aria-label="Comparison view actions"><button id="expand-comparison" class="ks-icon-button" aria-label="${U?"Restore comparison":"Enlarge comparison"}" title="${U?"Restore comparison (Esc)":"Enlarge comparison"}" aria-expanded="${U}">${zn(U?"compact":"expand")}</button>${V?.preview.kind==="image"?`<a class="ks-icon-button source-link" href="${qn(Ni)}" target="_blank" rel="noopener" aria-label="${mn?"Open context capture":Yn.fileLabel}" title="${mn?"Open context capture":Yn.fileLabel}">${zn("external")}</a>`:""}</div></div>
          ${tn?`<div class="instance-grid" aria-label="All instances of ${T(on.label)}"><div class="instance-grid-labels"><span>Full comp crop</span><span>Component preview</span></div>${on.members.map((i,d)=>{let j=Ui(i);return`<button class="instance-row ${j.kind}" data-instance="${T(i.id)}" aria-label="Inspect instance ${d+1}: ${T(i.name)} — ${T(j.label)}"><span class="instance-caption"><strong>${T(i.name)}</strong><span>${T(j.label)}</span></span><span class="instance-pair"><span class="instance-reference" style="width:min(100%,${i.box.w*n.comp.width}px,${180*i.box.w*n.comp.width/(i.box.h*n.comp.height)}px);aspect-ratio:${i.box.w*n.comp.width}/${i.box.h*n.comp.height}"><img src="${qn(n.comp.url)}" alt="Comp: ${T(i.name)}" loading="lazy" style="width:${100/i.box.w}%;left:${-100*i.box.x/i.box.w}%;top:${-100*i.box.y/i.box.h}%">${Sn(n,i)}</span><span class="instance-produced" style="width:min(100%,${i.box.w*n.comp.width}px,${180*i.box.w*n.comp.width/(i.box.h*n.comp.height)}px);aspect-ratio:${i.box.w*n.comp.width}/${i.box.h*n.comp.height}">${i.preview.kind==="image"?`<img src="${qn(i.preview.url)}" alt="Produced: ${T(i.name)}" loading="lazy">`:i.thumbnail?`<img src="${qn(i.thumbnail.url)}" alt="Preview: ${T(i.name)}" loading="lazy">`:"Open live component"}</span></span>${li(n,i)}</button>`}).join("")}</div>`:""}
          ${!tn&&V?li(ln,V):""}<div class="compare">
            <figure><figcaption>${En?`Comp · Round ${q.packet.round}`:l?"Approved comp":de?.related.length?"Full comp crop":"In the comp"}</figcaption><div class="pan-viewport" aria-label="Reference comparison canvas" tabindex="0"><div class="crop-stage"><img class="crop-image" src="${qn(ln.comp.url)}" alt="Reference region for ${T(V.name)}" style="width:${100/V.box.w}%;left:${-100*V.box.x/V.box.w}%;top:${-100*V.box.y/V.box.h}%">${Sn(ln,V)}</div></div></figure>
            <figure><figcaption>${En?`Previous · Round ${q.packet.round}`:l?"Assembled page":mn?"In context":q?`${Yn.caption} · Round ${n.round}`:Yn.caption}</figcaption><div class="pan-viewport" aria-label="Produced comparison canvas" tabindex="0"><div class="output crop-stage ${Li&&!mn&&!le&&fn==="checker"?"checker":""}">${!le?`<img class="asset" src="${qn(Ni)}" alt="Produced ${T(V.name)}" style="object-position:${T(V.preview.position??"center")}">`:`<iframe aria-hidden="true" title="Rendered ${T(V.name)}" src="${qn(Ni)}" sandbox="" tabindex="-1" width="${ln.comp.width}" height="${ln.comp.height}"></iframe>`}${xn?`<img class="crop-image overlay-image" src="${qn(ln.comp.url)}" alt="Reference overlay" style="width:${100/V.box.w}%;left:${-100*V.box.x/V.box.w}%;top:${-100*V.box.y/V.box.h}%">`:""}</div></div></figure>
          </div>
          ${Li||V.context?`<div class="view-controls">${V.context?`<div class="ks-instrument-strip is-paper" data-ks-strip="view" role="group" aria-label="Component view"><button type="button" class="ks-instrument-key" id="isolated" aria-pressed="${!mn}">${Ai?"Asset only":"Component only"}</button><button type="button" class="ks-instrument-key" id="context" aria-pressed="${mn}">In context</button></div>`:""}${Li?`<div class="background-options ks-instrument-strip is-paper" data-ks-strip="background" role="group" aria-label="Asset preview background"><button type="button" id="background-checker" class="ks-instrument-key" aria-label="Checkerboard background" title="Checkerboard background" aria-pressed="${fn==="checker"}" ${mn?"disabled":""}>Checker</button><button type="button" id="background-page" class="ks-instrument-key" aria-label="${ln.comp.background?"Page color":"Neutral"} background" title="${ln.comp.background?"Page color":"Neutral"} background" aria-pressed="${fn==="page"}" ${mn?"disabled":""}>Page</button></div>`:""}</div>`:""}
          </div></div>${!l&&!tn?`<div class="component-details"><div class="material">${zn(Yn.code?"code":"image")}<strong>${T(Se)}</strong><span>${V?.material?`${V.material.width} × ${V.material.height} px`:""}</span></div>${ln.stage==="components"&&Yn?.captured&&!V?.preview.isolation?'<p class="layering">Legacy region capture · may include overlapping components.</p>':""}${V?.context?.layering&&(Ai||mn)?`<p class="layering">${T(V.context.layering)}</p>`:""}
          <p class="component-note">${!de?.related.length?T(V.note):""}</p>
          </div>`:""}</div><div class="review-form">${c}${En?'<p class="previous-notice">Viewing the previous round. Return to Current to make a decision.</p>':""}${m?`<div class="record-verdict"><strong>${r?.action==="approve"?"Approved":r?.action==="revise"?"Changes requested":"Not reviewed"}</strong><span>Submitted in round ${n.round} · read-only</span></div>`:`<div class="decisions" role="group" aria-label="Decision for ${T(G.name)}">${!l?`<div class="decision-title"><strong>Your review <span>Round ${n.round}</span></strong>${En?"<p>Return to Current to review this round.</p>":""}</div>`:""}<button id="approve" ${!b.length?"disabled":""} class="ks-button ks-button-primary decision-approve ${r?.action==="approve"?"approved":""}" aria-pressed="${r?.action==="approve"}">${l?g?"Sending…":`Approve & continue${Bn}`:b.length>1?`Approve ${b.length} instances`:"Looks good"}</button><button id="revise" ${!b.length?"disabled":""} class="ks-button ks-button-secondary decision-revise ${r?.action==="revise"?"revise":""}" aria-pressed="${r?.action==="revise"}">${b.length>1?`Revise ${b.length} instances`:"Needs work"}</button>${r&&!l&&!tn?`<button id="clear" class="ks-icon-button" aria-label="Clear decision" title="Clear decision">${zn("undo")}</button>`:""}</div>`}
          ${s?`<form id="feedback-form"><div class="feedback-fields"><label class="feedback-field">What needs to change?<textarea id="feedback" aria-describedby="feedback-hint">${T(s.feedback)}</textarea></label><p id="feedback-hint" class="feedback-hint">Optional — leave blank for the agent to diagnose.</p>${!l?`<label class="check"><input id="split" type="checkbox" ${s.split?"checked":""}> Split into separately reviewable components</label>`:""}</div><div class="feedback-actions"><button id="cancel-feedback" type="button" class="ks-button ks-button-ghost">Cancel</button><button id="save-feedback" type="submit" class="ks-button ks-button-primary">${l?"Send feedback":h?"Save & finish review":"Save & next"}${Bn}</button><span class="shortcut-hint">${dn}</span></div></form>`:r?.action==="revise"?`<p class="saved-feedback">${T(r.feedback||"No note — agent will diagnose.")}</p>`:""}
          ${l?`<p class="page-review-status" role="status">${T(M||(m?"Your decision is saved.":g?"Sending…":s?"":"Approval confirms the composition and that nothing is missing."))}</p>`:""}</div>`:O?`<p>This piece will be added to the unresolved inventory.</p><label class="feedback-field">Name<input id="missing-name" value="${T(O.name)}"></label><label class="feedback-field">What is missing?<textarea id="missing-feedback">${T(O.feedback)}</textarea></label><div class="coordinates">${["x","y","w","h"].map((i)=>`<label>${{x:"Left",y:"Top",w:"Width",h:"Height"}[i]} %<input type="number" data-coordinate="${i}" value="${Math.round(O.box[i]*1000)/10}" min="0" max="100" step="0.1"></label>`).join("")}</div><button id="remove-missing">Remove this mark</button></div>`:"<p>No components supplied.</p></div>"}
        </section>
      </div>
      ${!l?`<section class="inventory-section ${C?"":"tray-collapsed"} ${D&&C?"tray-expanded":""}" aria-label="Component inventory"><div class="section-head"><h2>Components</h2><div class="inventory-filters ks-instrument-strip is-paper" data-ks-strip="filter" role="group" aria-label="Filter components"><button type="button" class="ks-instrument-key" data-filter="pending" aria-pressed="${f==="pending"}">To review <b>${ti}</b></button><button type="button" class="ks-instrument-key" data-filter="reviewed" aria-pressed="${f==="reviewed"}">Reviewed <b>${Re}</b></button><button type="button" class="ks-instrument-key" data-filter="all" aria-pressed="${f==="all"}">All <b>${S.length+t.missing.length}</b></button></div><div class="tray-actions"><button id="show-all" class="ks-icon-button" aria-pressed="${D}" aria-controls="component-tray" aria-label="${D?"Compact":"Expand"} tray" title="${D?"Compact":"Expand"} tray">${zn(D?"compact":"expand")}</button><button id="toggle-tray" class="ks-icon-button" aria-expanded="${C}" aria-controls="component-tray" aria-label="${C?"Hide":"Show"} component tray" title="${C?"Hide":"Show"} component tray">${zn(C?"hideTray":"showTray")}</button></div></div>
      <div id="component-tray" class="inventory ${D?"all":""}">${pe.map((i)=>{let d=S.find((un)=>un.members.some((gn)=>gn.id===i.id)),j=S.indexOf(d),E={kind:d.kind,label:d.stateLabel};return`<button class="item ${E.kind} ${!w&&on?.id===d.id?"active":""}" data-select="${T(i.id)}" aria-pressed="${!w&&on?.id===d.id}">${i.thumbnail?`<span class="item-thumb">${i.thumbnail.box?`<span class="thumb-crop" style="width:min(100%,${76*i.thumbnail.box.w*n.comp.width/(i.thumbnail.box.h*n.comp.height)}px);aspect-ratio:${i.thumbnail.box.w*n.comp.width}/${i.thumbnail.box.h*n.comp.height}"><img alt="" loading="lazy" src="${qn(i.thumbnail.url)}" style="position:absolute;width:${100/i.thumbnail.box.w}%;max-width:none;left:${-100*i.thumbnail.box.x/i.thumbnail.box.w}%;top:${-100*i.thumbnail.box.y/i.thumbnail.box.h}%;"></span>`:`<img alt="" loading="lazy" src="${qn(i.thumbnail.url)}">`}</span>`:""}<span class="item-number">${E.kind==="approved"?rn:E.kind==="feedback"?_n:""}${j+1}<span class="item-medium">${zn(Rn(i).code?"code":"image")}${T(Rn(i).label)}</span></span><strong>${T(Fe(i.id))}${d.members.length>1?` <small>×${d.members.length}</small>`:""}</strong><span class="state ${E.kind}">${T(E.label)}</span></button>`}).join("")}${(f==="pending"?[]:t.missing).map((i,d)=>`<button class="item feedback ${x===i.id?"active":""}" data-select="${T(i.id)}"><span class="item-number">${S.length+d+1}</span><strong>${T(i.name)}</strong><span class="state revise">Missing</span></button>`).join("")}${!pe.length&&(f==="pending"||!t.missing.length)?`<p class="inventory-empty">${f==="pending"?"Nothing left to review. Your decisions are ready.":"No components reviewed yet."}</p>`:""}</div></section>`:""}
      ${l?"":m?`<footer class="record-footer"><span>Round ${n.round} submitted · read-only</span><span>${v.approved} approved · ${v.revisions} changes requested</span></footer>`:`<footer class="${!v.pending&&!p?"queue-complete":""}"><div>${!v.pending&&!p?`<button id="show-summary" class="completion-link">${rn}${m?"Review sent":"All components reviewed"}</button>`:""}<button id="approve-rest" class="ks-button ks-button-secondary" ${!v.pending?"hidden":""} ${!v.pending||p?"disabled":""}>Approve ${v.approved||v.revisions?"remaining":"all"}</button><label class="check ks-checkbox"><input id="inventory-confirm" type="checkbox" ${t.inventoryConfirmed?"checked":""}> Nothing missing from the comp</label></div><div class="submit-area"><p role="status">${T(Pe)}</p><button id="submit" class="ks-button ks-button-primary" ${!v.canSubmit||p||g||m?"disabled":""}>${g?"Sending…":m?"Review sent":v.hasFeedback?"Send feedback":"Approve & continue"}${g||m?"":Bn}</button></div></footer>`}
    </section><dialog id="comparison-dialog" aria-label="${l?"Enlarged page comparison":"Enlarged component comparison"}"></dialog>`;let sn=a.querySelector("#comparison-dialog"),vn=a.querySelector(".comparison-panel"),Kn=a.querySelector(".comparison-slot"),Xn=a.querySelector(".inspector > .review-form"),nr=a.querySelector(".inspector"),xe=()=>{if(sn.append(vn),Xn)sn.append(Xn)};if(U&&vn&&Kn)Kn.style.height=`${Qi}px`,xe(),sn.showModal();if(En)a.querySelectorAll(".decisions button,#feedback,#split,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#submit,#inventory-confirm").forEach((i)=>i.disabled=!0);if(a.querySelector(".inspection-content").scrollTop=$i,m||g)a.querySelectorAll(".decisions button,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#mark,#inventory-confirm,#missing-name,#missing-feedback,#feedback,#split,#remove-missing,[data-coordinate]").forEach((i)=>i.disabled=!0);let he=a.querySelector(".inventory");if(he)he.scrollLeft=Gn;if(!P&&C)Array.from(a.querySelectorAll(".inventory [data-select]")).find((i)=>i.dataset.select===x)?.scrollIntoView({block:"nearest",inline:"nearest"});if($)a.getElementById($)?.focus({preventScroll:!0});else if(N)Array.from(a.querySelectorAll(".item[data-select]")).find((i)=>i.dataset.select===N)?.focus({preventScroll:!0});let K=(i,d)=>a.querySelector(`#${i}`)?.addEventListener("click",d);function _i(i,d=!1,j=!1){if(z)return;if(!j)i=S.find((E)=>E.members.some((un)=>un.id===i))?.representative.id??i;if(Z=!j,w=!1,x=i,W="component",xn=!1,hn="fit",I="isolated",pn=!1,J(),d)a.querySelector("#expand-comparison")?.click()}a.querySelectorAll("[data-select]").forEach((i)=>i.onclick=()=>_i(i.dataset.select,i.classList.contains("pin")&&n.components.some((d)=>d.id===i.dataset.select))),K("previous-round",()=>{pn=!0,J()}),K("current-round",()=>{pn=!1,J()}),K("review-changes",()=>{let i=y().filter((E)=>Ui(E).kind==="pending"),d=i.findIndex((E)=>E.id===x),j=i[(d+1)%i.length];if(j)Z=!0,w=!1,x=j.id,W="component",f="pending",pn=!1,hn="fit",xn=!1,I="isolated",J()}),a.querySelectorAll("[data-filter]").forEach((i)=>i.onclick=()=>{f=i.dataset.filter,w=!v.pending&&f==="pending";let d=S.filter((E)=>f==="all"||E.kind==="pending"===(f==="pending")).map((E)=>E.representative);if(!(f!=="pending"&&t.missing.some((E)=>E.id===x))&&!d.some((E)=>E.id===x)&&d.length)Z=!0,x=d[0].id,W="component",pn=!1,hn="fit",xn=!1,I="isolated";J()}),K("show-summary",()=>{w=!0,W="component",f="reviewed",J(),$n("review-summary")}),K("approve",()=>In("approve")),K("revise",di),K("clear",()=>{if(G)delete t.decisions[G.id],delete u[G.id];Q=null,w=!1,f="pending",J()}),K("cancel-feedback",()=>{if(G)delete u[G.id];if(bn)C=!0,bn=!1;J(),$n("revise")}),a.querySelector("#feedback-form")?.addEventListener("submit",(i)=>{i.preventDefault(),In("revise")}),a.querySelector("#feedback")?.addEventListener("keydown",(i)=>{let d=i;if(d.key==="Enter"&&(d.metaKey||d.ctrlKey)&&!d.isComposing)d.preventDefault(),d.stopPropagation(),In("revise")}),K("undo-decision",()=>{if(!Q||g||m)return;let i=Q;for(let[d,j]of Object.entries(i.previous))if(j)t.decisions[d]=j;else delete t.decisions[d];delete u[i.id],x=i.id,w=!1,pn=!1,W="component",f="all",Q=null,J(),$n("approve")}),K("all-instances",()=>{Z=!0,x=on.representative.id,pn=!1,J()}),a.querySelectorAll("[data-instance]").forEach((i)=>i.onclick=()=>_i(i.dataset.instance,!1,!0)),K("overlay",()=>{xn=!xn,J()}),K("isolated",()=>{I="isolated",J()}),K("context",()=>{I="context",J()}),a.querySelectorAll("[data-zoom]").forEach((i)=>i.addEventListener("click",()=>{let d=i.dataset.zoom;hn=d==="fit"?"fit":Number(d),J()})),K("background-checker",()=>{fn="checker",J()}),K("background-page",()=>{fn="page",J()}),K("show-all",()=>{D=!D,C=!0,J()}),K("toggle-tray",()=>{bn=!1,C=!C,J()}),K("show-comp",()=>{W="comp",J()}),K("show-component",()=>{W="component",J()}),K("mark",()=>{z=!z,J()}),K("add-box",()=>xi({x:0.35,y:0.35,w:0.2,h:0.2})),K("remove-missing",()=>{t.missing=t.missing.filter((i)=>i.id!==x),x=n.components[0]?.id,J()}),K("approve-rest",()=>{if(p)return;t=we(n,t),Q=null,w=!0,f="reviewed",W="component",J(),$n("review-summary")}),a.querySelector("#inventory-confirm")?.addEventListener("change",(i)=>{t.inventoryConfirmed=i.target.checked,J()}),a.querySelector("#feedback")?.addEventListener("input",(i)=>{if(G&&u[G.id])u[G.id].feedback=i.target.value}),a.querySelector("#split")?.addEventListener("change",(i)=>{if(G&&u[G.id])u[G.id].split=i.target.checked}),a.querySelector("#missing-name")?.addEventListener("input",(i)=>{if(O)O.name=i.target.value;let d=a.querySelector("#submit");if(d)d.disabled=p||g||m||!Fn(n,t).canSubmit}),a.querySelector("#missing-feedback")?.addEventListener("input",(i)=>{if(O)O.feedback=i.target.value}),a.querySelectorAll("[data-coordinate]").forEach((i)=>i.addEventListener("change",()=>{if(!O)return;let d=i.dataset.coordinate,j=Number(i.value)/100;if(Number.isFinite(j))O.box[d]=Math.max(d==="w"||d==="h"?0.001:0,Math.min(1,j));O.box.w=Math.min(O.box.w,1-O.box.x),O.box.h=Math.min(O.box.h,1-O.box.y),J()})),K("submit",()=>{ni()});let yn=a.querySelector(".map");function Ki(i){let d=yn.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(i.clientX-d.left)/d.width)),y:Math.max(0,Math.min(1,(i.clientY-d.top)/d.height))}}function ke(i){let d=Ki(i);return n.components.filter(({box:j})=>d.x>=j.x&&d.x<=j.x+j.w&&d.y>=j.y&&d.y<=j.y+j.h).sort((j,E)=>j.box.w*j.box.h-E.box.w*E.box.h)[0]}yn?.addEventListener("click",(i)=>{if(z||i.target.closest("[data-select]"))return;let d=ke(i);if(d)_i(d.id,!0)}),yn?.addEventListener("pointermove",(i)=>{if(!z)yn.style.cursor=ke(i)?"zoom-in":""}),yn?.addEventListener("pointerdown",(i)=>{if(!z)return;kn=Ki(i),yn.setPointerCapture(i.pointerId),i.preventDefault()}),yn?.addEventListener("pointermove",(i)=>{if(!kn)return;let d=Ki(i);an={x:Math.min(kn.x,d.x),y:Math.min(kn.y,d.y),w:Math.abs(d.x-kn.x),h:Math.abs(d.y-kn.y)};let j=a.querySelector(".draw-box");j.hidden=!1,j.style.cssText=Vn(an)}),yn?.addEventListener("pointerup",()=>{if(an&&an.w>0.01&&an.h>0.01)xi(an);else kn=null,an=null}),yn?.addEventListener("pointercancel",()=>{kn=null,an=null,J()});let ge=a.querySelector(".output"),gi=a.querySelector("iframe"),ve=a.querySelector(".workbench"),On=a.querySelector(".inspection-content"),Bi=a.querySelector(".inspector");function Hi(){if(!On||!Bi)return;Bi.dataset.scrollAbove=String(On.scrollTop>1),Bi.dataset.scrollBelow=String(On.scrollHeight-On.clientHeight-On.scrollTop>1)}On?.addEventListener("scroll",Hi,{passive:!0});function vi(){let i=a.querySelector(".map-space");if(i&&i.clientWidth&&i.clientHeight){let _=Ii(n.comp.width,n.comp.height,Math.max(1,i.clientWidth-32),Math.max(1,i.clientHeight-32),"fit");yn.style.width=`${_.width}px`,yn.style.height=`${_.height}px`}let d=a.querySelector(".inspection-content"),j=Array.from(a.querySelectorAll(".pan-viewport"));if(d?.clientHeight){let _=U?Math.max(100,sn.clientHeight-(vn?.querySelector(".compare-toolbar")?.clientHeight??0)-(vn?.querySelector(".expanded-title")?.clientHeight??0)-(vn?.querySelector(".view-controls")?.clientHeight??0)-(Xn?.getBoundingClientRect().height??0)-124):Math.min(l?Number.POSITIVE_INFINITY:248,Math.max(100,d.clientHeight-((j[0]?.getBoundingClientRect().top??d.getBoundingClientRect().top)-d.getBoundingClientRect().top+d.scrollTop)-(vn?.querySelector(".view-controls")?.clientHeight??0)-12));j.forEach((nn)=>nn.style.height=`${_}px`)}if(V&&j.length&&!tn){let _=Ii(V.box.w*ln.comp.width,V.box.h*ln.comp.height,Math.min(...j.map((nn)=>nn.clientWidth)),Math.min(...j.map((nn)=>nn.clientHeight)),hn);a.querySelectorAll(".crop-stage").forEach((nn)=>{nn.style.width=`${_.width}px`,nn.style.height=`${_.height}px`})}if(j.forEach((_)=>{let nn=_.scrollWidth>_.clientWidth+1||_.scrollHeight>_.clientHeight+1;_.classList.toggle("pannable",nn),_.style.cursor=U?"":"zoom-in",_.setAttribute("role",U?"region":"button"),_.title=U?nn?"Move your pointer to pan. You can also scroll, swipe, or use arrow keys.":"":"Click to enlarge comparison"}),ge&&gi&&V){let _=ge.clientWidth/(V.box.w*ln.comp.width);gi.style.transform=`scale(${_})`,gi.style.left=`${-V.box.x*ln.comp.width*_}px`,gi.style.top=`${-V.box.y*ln.comp.height*_}px`}let E=ve.getBoundingClientRect(),un=a.querySelector(".region"),gn=a.querySelector(".number"),ci=a.querySelector(".connector path");if(un&&gn&&ci){let _=un.getBoundingClientRect(),nn=gn.getBoundingClientRect(),bi=_.right-E.left,en=_.top+_.height/2-E.top,si=nn.left-E.left-8,fi=nn.top+nn.height/2-E.top;ci.setAttribute("d",`M ${bi} ${en} H ${si-14} V ${fi} H ${si}`)}}function Dn(i,d){if(!vn||!Kn||i===U)return;let j=a.querySelector("#expand-comparison"),E=(U?sn:vn).getBoundingClientRect(),un=window.matchMedia("(prefers-reduced-motion: reduce)").matches,gn=vn.querySelector(".pan-viewport"),ci=gn?gn.scrollLeft/Math.max(1,gn.scrollWidth-gn.clientWidth):0,_=gn?gn.scrollTop/Math.max(1,gn.scrollHeight-gn.clientHeight):0,nn=()=>vn.querySelectorAll(".pan-viewport").forEach((en)=>{en.scrollLeft=ci*Math.max(0,en.scrollWidth-en.clientWidth),en.scrollTop=_*Math.max(0,en.scrollHeight-en.clientHeight)}),bi=()=>{if(Kn.append(vn),Xn)nr.append(Xn),Xn.inert=!1;sn.close(),Kn.style.height="",Qn=!1,U=!1,j.innerHTML=zn("expand"),j.setAttribute("aria-label","Enlarge comparison"),j.title="Enlarge comparison",j.setAttribute("aria-expanded","false"),vi(),nn(),j.focus({preventScroll:!0}),d?.()};if(i){Kn.style.height=`${E.height}px`,xe(),sn.showModal(),U=!0,j.innerHTML=zn("compact"),j.setAttribute("aria-label","Restore comparison"),j.title="Restore comparison (Esc)",j.setAttribute("aria-expanded","true"),vi(),nn(),j.focus({preventScroll:!0});let en=sn.getBoundingClientRect();if(!un)sn.animate([{transform:`translate(${E.x-en.x}px,${E.y-en.y}px) scale(${E.width/en.width},${E.height/en.height})`,opacity:0.6},{transform:"none",opacity:1}],{duration:240,easing:"cubic-bezier(.2,.8,.2,1)"})}else{if(j.disabled)return;let en=Kn.getBoundingClientRect();if(un){bi();return}if(j.disabled=!0,Qn=!0,Xn)Xn.inert=!0;let si=sn.animate([{transform:"none",opacity:1},{transform:`translate(${en.x-E.x}px,${en.y-E.y}px) scale(${en.width/E.width},${en.height/E.height})`,opacity:0.6}],{duration:200,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});sn.inert=!0;let fi=()=>{if(si.cancel(),j.disabled=!1,sn.inert=!1,sn.isConnected)bi();else Qn=!1,U=!1,J(),d?.()};si.finished.then(fi,fi)}}if(Jn=(i)=>Dn(!1,i),K("expand-comparison",()=>Dn(!U)),sn.addEventListener("cancel",(i)=>{i.preventDefault(),i.stopPropagation(),Dn(!1)}),sn.addEventListener("keydown",(i)=>{if(i.key==="Escape")i.preventDefault(),i.stopPropagation(),Dn(!1)}),Wn=Yi(a),wn=new ResizeObserver(()=>{vi(),Hi()}),wn.observe(ve),wn.observe(sn),Xn)wn.observe(Xn);let ue=a.querySelector(".inspection-content");if(ue)wn.observe(ue);let ce=a.querySelector(".repair-context");if(ce)wn.observe(ce);let be=vn?.querySelector(".compare-toolbar");if(be)wn.observe(be);vi();let ui=Array.from(a.querySelectorAll(".pan-viewport"));if(ui.forEach((i)=>{i.scrollLeft=ki,i.scrollTop=ei}),ui.forEach((i)=>{i.querySelectorAll("img").forEach((d)=>d.draggable=!1),i.addEventListener("click",()=>{if(!U)Dn(!0)}),i.addEventListener("pointermove",(d)=>{if(d.pointerType!=="mouse"||d.buttons||!i.classList.contains("pannable"))return;let j=i.getBoundingClientRect();i.scrollLeft=Oi(d.clientX,j.left,i.clientWidth,i.scrollWidth),i.scrollTop=Oi(d.clientY,j.top,i.clientHeight,i.scrollHeight)}),i.addEventListener("keydown",(d)=>{if(!U&&(d.key==="Enter"||d.key===" ")){d.preventDefault(),d.stopPropagation(),Dn(!0);return}let E={ArrowLeft:[-48,0],ArrowRight:[48,0],ArrowUp:[0,-48],ArrowDown:[0,48]}[d.key];if(!E)return;d.preventDefault(),d.stopPropagation(),i.scrollLeft+=E[0],i.scrollTop+=E[1]})}),ui.forEach((i)=>i.addEventListener("scroll",()=>{for(let d of ui)if(d!==i){if(d.scrollLeft!==i.scrollLeft)d.scrollLeft=i.scrollLeft;if(d.scrollTop!==i.scrollTop)d.scrollTop=i.scrollTop}})),ii&&window.matchMedia("(max-width:800px)").matches){let i=a.querySelector(".inspection-content"),d=a.querySelector(".compare");if(i&&d)i.scrollTop+=d.getBoundingClientRect().top-i.getBoundingClientRect().top}if(Hi(),window.scrollTo(H,F),!m)o.onDraftChange?.(structuredClone(t))}return J(),{destroy(){wn?.disconnect(),Wn?.(),a.replaceChildren()},getDraft(){return structuredClone(t)}}}function or(){let e=document.createElement("style");e.textContent=[["Albert Sans","albertsans"],["Alumni Sans","alumnisans"],["JetBrains Mono","jetbrainsmono"]].map(([n,o])=>`@font-face{font-family:"${n}";src:url(/fonts/${o}.ttf);font-weight:100 900}`).join(""),document.head.append(e)}function tr(e){let n=document.createElement("div");n.setAttribute("role","alert"),n.style.cssText="max-width:560px;margin:18vh auto 0;padding:0 0 0 18px;border-left:2px solid oklch(52% 0.16 35);color:oklch(22% 0 0);font:400 15px/1.55 var(--font-sans,Arial,sans-serif)";let o=document.createElement("p");o.textContent="Review unavailable",o.style.cssText="margin:0 0 8px;font:400 11px/1.3 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:oklch(46% 0 0)";let a=document.createElement("strong");a.textContent="The review could not be opened.",a.style.cssText="display:block;font-weight:500;color:oklch(13% 0 0)";let t=document.createElement("p");t.style.cssText="margin:4px 0 18px;color:oklch(46% 0 0)",t.textContent=`${e} If the review server stopped, ask the agent to serve the review again, then reload.`;let l=document.createElement("button");return l.textContent="Reload",l.style.cssText="font:500 15px/1 var(--font-sans,Arial,sans-serif);min-height:44px;padding:0 22px;border:1px solid oklch(13% 0 0);border-radius:3px;background:oklch(13% 0 0);color:oklch(99.5% 0 0);cursor:pointer",l.onclick=()=>location.reload(),n.append(o,a,t,l),n}async function sr(){or(),document.body.style.background="oklch(97.8% 0 0)";let e=document.getElementById("review"),n=await fetch("/packet",{cache:"no-store"});if(!n.ok)throw Error("The review packet could not be loaded.");let o=await n.json(),a=Mi(o.packet);if(o.sourceStatus&&!a){let t=document.createElement("p");t.textContent=o.sourceStatus,e.before(t)}De(e,o.packet,{initialDraft:o.draft,history:o.history,completed:!!o.receipt,status:a?o.sourceStatus:null,onSubmit:async(t)=>{let l=await fetch("/decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)}),y=await l.json().catch(()=>({}));if(!l.ok)throw Error(y.error??"The review could not be saved. Try again.")}})}sr().catch((e)=>{document.getElementById("review")?.replaceChildren(tr(e instanceof Error?e.message:String(e)))});})();
