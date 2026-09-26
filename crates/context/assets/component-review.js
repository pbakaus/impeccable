(()=>{function me(i,e){let o=e?.changes[i],a=e?.feedback?.[i],t=a?.decision??(e?.submitted?e.draft.decisions[i]:void 0),d=o?.kind==="unchanged"&&(o.carried??(e?.submitted&&t?.action==="approve"))===!0;return{change:o,prior:t,feedbackRound:a?.round??e?.packet.round,carried:d,label:o?.kind==="added"?"New component":o?.kind==="changed"?"Review again":d?"Approval kept":t?.action==="revise"?"Changes still requested":"Awaiting review"}}function gn(i,e,o){let a=e.decisions[i.id],t=a?.revision===i.revision?a:void 0,d=me(i.id,o);if(t?.action==="approve")return{kind:"approved",label:d.carried?"Approval kept":"Approved",priority:3};if(t?.action==="revise")return{kind:"feedback",label:"Feedback ready",priority:2};return{kind:"pending",label:d.change?.kind==="changed"?"Review again":d.change?.kind==="added"?"New · review needed":"Not reviewed",priority:d.change?.kind==="changed"||d.change?.kind==="added"?0:1}}function ki(i){return{packetRevision:i.revision,decisions:{},missing:[],inventoryConfirmed:!1}}function Ae(i){return Object.values(i).every(Number.isFinite)&&i.x>=0&&i.y>=0&&i.w>0&&i.h>0&&i.x+i.w<=1.00001&&i.y+i.h<=1.00001}function Sn(i,e){let o=i.components.map((g)=>e.decisions[g.id]?.revision===g.revision?e.decisions[g.id]:void 0),a=o.filter((g)=>g?.action==="approve").length,t=o.filter((g)=>g?.action==="revise").length,d=o.length-a-t,f=t>0||e.missing.length>0;return{approved:a,revisions:t,pending:d,hasFeedback:f,canSubmit:e.packetRevision===i.revision&&e.missing.every((g)=>g.name.trim()&&Ae(g.box))&&(f||!d&&e.inventoryConfirmed)}}function gi(i,e){let o={...e.decisions};for(let a of i.components)if(!o[a.id]||o[a.id].revision!==a.revision)o[a.id]={revision:a.revision,action:"approve",feedback:"",split:!1};return{...e,decisions:o}}function vi(i,e){if(!Sn(i,e).canSubmit)throw Error("Review is incomplete or stale");return{schemaVersion:1,requestId:i.id,...structuredClone(e)}}function Cn(i){let e=i.preview.kind==="page"||i.preview.sourceKind==="page",o=i.preview.sourceKind==="page";return{code:e,captured:o,label:e?i.medium.match(/html|css|svg/i)?i.medium:"HTML / CSS / SVG":"Raster",caption:e?o?i.preview.isolation?"Component only":"Region capture":"Live component":"Produced asset",fileLabel:o?"Open captured preview":"Open source image"}}function ui(i,e,o){let a=i.components.findIndex((t)=>t.id===o);for(let t=1;t<=i.components.length;t++){let d=i.components[(a+t)%i.components.length];if(gn(d,e).kind==="pending")return d.id}}function ye(i,e){if(!e.reviewGroup||!Cn(e).code)return[e];return i.components.filter((o)=>o.reviewGroup===e.reviewGroup&&Cn(o).code)}function de(i,e,o,a,t=[]){let d=a?ye(i,o):[o];if(d.length===1)return[o];return d.filter((f)=>gn(f,e).kind==="pending"&&(f.id===o.id||!t.includes(f.id)))}function fi(i,e,o){let a=new Set;return i.components.flatMap((t)=>{if(a.has(t.id))return[];let d=ye(i,t);d.forEach((k)=>a.add(k.id));let f=d.filter((k)=>gn(k,e,o).kind==="pending"),g=d.filter((k)=>gn(k,e,o).kind==="feedback"),v=f[0]??g[0]??t,h=f.length?"pending":g.length?"feedback":"approved";return[{id:t.id,members:d,representative:v,pending:f.length,kind:h,label:d.length>1?t.reviewGroup.replace(/[-_]+/g," ").replace(/^./,(k)=>k.toUpperCase()):t.name,box:{x:Math.min(...d.map((k)=>k.box.x)),y:Math.min(...d.map((k)=>k.box.y)),w:Math.max(...d.map((k)=>k.box.x+k.box.w))-Math.min(...d.map((k)=>k.box.x)),h:Math.max(...d.map((k)=>k.box.y+k.box.h))-Math.min(...d.map((k)=>k.box.y))},stateLabel:f.length?d.length>1?`${f.length} to review`:gn(v,e,o).label:g.length?d.length>1?`${g.length} ${g.length===1?"needs":"need"} work`:"Feedback ready":"Approved"}]})}function ze(i,e){let o=new Set(e.preview.isolation?.excludedComponents??[]),a=e.box,t=i.components.filter((d)=>{if(d.id===e.id)return!1;if(o.has(d.id))return!0;let f=d.box,g=Math.min(a.x+a.w,f.x+f.w)-Math.max(a.x,f.x),v=Math.min(a.y+a.h,f.y+f.h)-Math.max(a.y,f.y);return f.w*f.h<a.w*a.h&&g*i.comp.width>1&&v*i.comp.height>1});return{description:e.note.trim(),related:t,excluded:t.filter((d)=>o.has(d.id))}}function We(i,e,o,a,t){let d=t==="fit"?Math.min(1,o/i,a/e):t;return{scale:d,width:i*d,height:e*d}}function Ke(i,e,o,a){if(o<=0||a<=o)return 0;return Math.max(0,Math.min(1,((i-e)/o-0.08)/0.84))*(a-o)}var ci=`
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
`;var bi=`/* VENDORED from impeccable-site/site/styles/kinpaku-tokens.css (the source of truth).
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
`,wi=`/* VENDORED from impeccable-site/site/styles/kinpaku-kit.css (buttons, tabs, select, icon button, instrument strip, grain, switch, paper strip, thumb) (the source of truth).
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
`,mi=`/* VENDORED from impeccable-site/site/styles/docs-kinpaku.css (the command rail list: the site's selected-row pattern) (the source of truth).
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
`;var yi=(i)=>i.replace(/^:root\s*\{/gm,":root, :host {"),je=yi(bi)+`
`+yi(wi)+`
`+mi,An='<span class="ks-button-arrow" aria-hidden="true"><svg viewBox="0 0 16 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M0 4h14M10 0l4 4-4 4"/></svg></span>';var zi=`
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
`+ci+`
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
`+je+`
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
`;var Wi={chevronDown:'<path d="m6 9 6 6 6-6"/>',code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',compact:'<path d="M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',hideTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12 3 3 2 3-2"/>',showTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12-4 3-3 3 3"/>',next:'<path d="M5 12h14m-6-6 6 6-6 6"/>',mark:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5M8 12h8m-4-4v8"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',undo:'<path d="M4 10h9a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" transform="translate(0 -2)"/>',external:'<path d="M14 3h7v7m0-7L10 14m0-10H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',zoom:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'};function wn(i){return`<svg class="utility-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${Wi[i]}</svg>`}var xe=[{kind:"plate",label:"Illustration / plate",hint:"Painted or drawn artwork"},{kind:"image",label:"Photo / image",hint:"A photograph"},{kind:"texture",label:"Texture",hint:"A surface or material"}],Pn=(i)=>xe.find((e)=>e.kind===i).label;function qe(i){let e=i;return!!e&&e.schemaVersion===3&&e.stage==="components"}function ne(i){return i.role==="plan"&&(!!i.flags?.length||!!i.codeDrawn)}function He(i){let e=(o)=>ne(o)?0:o.role==="asset"?1:2;return i.components.map((o,a)=>({c:o,i:a})).sort((o,a)=>e(o.c)-e(a.c)||o.i-a.i).map((o)=>o.c)}function Te(i){let e=new Set(i.components.map((o)=>o.id));return(i.codeRegions??[]).filter((o)=>!e.has(o.id))}function Wn(i,e){let o=e.decisions[i.id];return o?.revision===i.revision?o:void 0}function Yn(i,e){let o=Wn(i,e);return o?o.action==="approve"?"approved":o.action:"pending"}function Kn(i,e){return i.reclassify?.find((o)=>o.id===e)}function Oe(i){let e=[i.name,i.note,...(i.flags??[]).map((o)=>o.message)].join(" ");if(/\b(textures?|surfaces?|grain|grainy|brushed|metal(lic)?|steel|brass|copper|paper|linen|canvas|fabric|cloth|wood(en)?|stone|marble|concrete|plaster|leather|noise|pattern(ed)?|weave|patina)\b/i.test(e))return"texture";if(/\b(photo|photos|photograph|photographs|photographic|photography)\b/i.test(e)&&!/\bphotographic shading\b/i.test(e))return"image";return"plate"}function De(i){return`Drawn in code (${i.kind})`}function ji(i){return i.message}function Hn(i,e){let o=i.components.map((z)=>Yn(z,e)),a=o.filter((z)=>z==="approved").length,t=o.filter((z)=>z==="revise").length,d=new Set(Te(i).map((z)=>z.id)),f=(e.reclassify??[]).filter((z)=>d.has(z.id)).length,g=o.filter((z)=>z==="reclassify").length+f,v=o.filter((z)=>z==="pending").length,h=e.missing.length,k=t+g+h>0,m=e.packetRevision===i.revision,j=e.missing.every((z)=>z.name.trim()&&Ae(z.box)),V=m&&!k&&v===0;return{total:o.length,approved:a,revise:t,reclassify:g,pending:v,missing:h,hasChanges:k,canApprove:V,mode:k?"changes":"approve",canSubmit:m&&j&&(k||V)}}function Ie(i,e,o,a={}){if(o==="revise"&&e.role!=="asset"&&!(a.feedback??"").trim())throw Error("Revising a plan item needs feedback");if(o==="reclassify"&&e.role!=="plan")throw Error("Only planned code can become an image");let t={revision:e.revision,action:o,feedback:o==="approve"?"":(a.feedback??"").trim(),split:!1};if(o==="reclassify")t.kind=a.kind??Oe(e);return{...i,inventoryConfirmed:!1,decisions:{...i.decisions,[e.id]:t}}}function qi(i,e){let o={...i.decisions};return delete o[e],{...i,inventoryConfirmed:!1,decisions:o}}function Re(i,e,o){let a=(i.reclassify??[]).filter((t)=>t.id!==e);return{...i,inventoryConfirmed:!1,reclassify:o?[...a,{id:e,kind:o.kind,feedback:(o.feedback??"").trim()}]:a}}function Fe(i,e,o){let a=He(i),t=a.findIndex((d)=>d.id===o);for(let d=1;d<=a.length;d++){let f=a[(t+d)%a.length];if(Yn(f,e)==="pending")return f.id}}function Ti(i,e){let o=Hn(i,e);if(!o.canSubmit)throw Error("Review is incomplete or stale");let a={};for(let f of i.components){let g=Wn(f,e);if(g)a[f.id]=structuredClone(g)}let t=new Set(Te(i).map((f)=>f.id)),d=(e.reclassify??[]).filter((f)=>t.has(f.id)).map((f)=>({...f}));return{schemaVersion:1,requestId:i.id,packetRevision:e.packetRevision,decisions:a,missing:structuredClone(e.missing),inventoryConfirmed:o.mode==="approve",...d.length?{reclassify:d}:{}}}function Ei(i){return{packetRevision:i.revision,decisions:{},missing:[],inventoryConfirmed:!1,reclassify:[]}}function Vi(i,e,o,a,t=0.02){let d=Math.max(0,Math.floor((a.x-t)*e)),f=Math.min(e-1,Math.ceil((a.x+a.w+t)*e)),g=Math.max(0,Math.floor((a.y-t)*o)),v=Math.min(o-1,Math.ceil((a.y+a.h+t)*o)),h=Math.floor(a.x*e),k=Math.ceil((a.x+a.w)*e),m=Math.floor(a.y*o),j=Math.ceil((a.y+a.h)*o),V=[],z=Math.max(1,Math.round(Math.max(f-d,v-g)/80));for(let Q=g;Q<=v;Q+=z)for(let X=d;X<=f;X+=z){if(X>=h&&X<k&&Q>=m&&Q<j)continue;let En=(Q*e+X)*4;if(i[En+3]<200)continue;V.push([i[En],i[En+1],i[En+2]])}return V}function Mi(i){if(!i.length)return;let e=(o)=>{let a=i.map((t)=>t[o]).sort((t,d)=>t-d);return a[a.length>>1]};return"#"+[0,1,2].map((o)=>e(o).toString(16).padStart(2,"0")).join("")}function Ji(i,e,o,a,t,d=4,f=24){let g=i.w*e,v=i.h*o,h=Math.min(24,Math.max(8,0.04*Math.max(g,v))),k=Math.min(e,g+h*2),m=Math.min(o,v+h*2),j=Math.min(d,a/k,t/m);if(v*j<f&&v>0)j=Math.min(d,f/v,t/m),k=Math.min(k,a/j);let V=(i.x+i.w/2)*e,z=(i.y+i.h/2)*o,Q=Math.max(0,Math.min(e-k,V-k/2)),X=Math.max(0,Math.min(o-m,z-m/2));return{scale:j,width:k*j,height:m*j,view:{x:Q/e,y:X/o,w:k/e,h:m/o}}}function Yi(i,e,o,a,t,d=1/0,f){let g=(k,m)=>{let j=Math.max(0,k),V=j/i;if(V>m)V=Math.max(0,m),j=V*i;if(f&&j>f.w*d)j=f.w*d,V=j/i;return{w:j,h:V}},v=g((e-a)/2,o-t),h=g(e,(o-a)/2-t);return v.w*v.h>=h.w*h.h?{direction:"row",...v}:{direction:"column",...h}}var $i=je+`
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
`;var Xi=new Map;function Ee(i){let e=i.querySelector('.ks-instrument-key:is(.is-active, [aria-selected="true"], [aria-pressed="true"])');if(!e){if(i.classList.contains("has-thumb"))i.classList.remove("has-thumb");return}let o=i.getBoundingClientRect(),a=e.getBoundingClientRect();if(!o.width)return;let t=getComputedStyle(i),d=o.width/parseFloat(t.width)||1,f=parseFloat(t.borderLeftWidth)||0,g=Math.round(((a.left-o.left)/d-f+i.scrollLeft)*100)/100,v=Math.round(a.width/d*100)/100,h=i.querySelector(":scope > .ks-thumb"),k=i.dataset.ksStrip;if(!h){h=document.createElement("span"),h.className="ks-thumb",h.setAttribute("aria-hidden","true"),i.appendChild(h);let j=k?Xi.get(k):void 0;if(j&&(j.x!==g||j.w!==v))h.style.transition="none",h.style.width=`${j.w}px`,h.style.transform=`translateX(${j.x}px)`,h.offsetWidth,h.style.transition=""}if(k)Xi.set(k,{x:g,w:v});if(h.style.width!==`${v}px`)h.style.width=`${v}px`;let m=`translateX(${g}px)`;if(h.style.transform!==m)h.style.transform=m;if(!i.classList.contains("has-thumb"))i.classList.add("has-thumb")}function Ki(i,e,o){if(i.dataset.thumb)return;i.dataset.thumb="1",Ee(i);let a=new MutationObserver((j)=>{if(j.some((V)=>V.target!==i&&!V.target.classList?.contains("ks-thumb")))Ee(i)});a.observe(i,{subtree:!0,attributes:!0,attributeFilter:["class","aria-selected","aria-pressed"],childList:!0});let t=new ResizeObserver(()=>Ee(i));t.observe(i);let d=null,f=!1,g=0,v=null,h=(j,V)=>e.elementFromPoint(j,V)?.closest(".ks-instrument-key")??null;i.addEventListener("pointerdown",(j)=>{if(!["mouse","pen"].includes(j.pointerType)||!j.isPrimary||j.button!==0||d!==null)return;d=j.pointerId,f=!1,g=j.clientX,v=h(j.clientX,j.clientY)}),i.addEventListener("pointermove",(j)=>{if(j.pointerId!==d)return;if(!f&&Math.abs(j.clientX-g)<6)return;f=!0;let V=h(j.clientX,j.clientY);if(V&&V!==v&&i.contains(V))v=V,V.click()});let k=()=>{d=null,f=!1,v=null},m=(j)=>{if(j.pointerId===d)k()};window.addEventListener("pointerup",m),window.addEventListener("pointercancel",m),window.addEventListener("blur",k),o.push(()=>{a.disconnect(),t.disconnect(),window.removeEventListener("pointerup",m),window.removeEventListener("pointercancel",m),window.removeEventListener("blur",k)})}function Ve(i){let e=[];return i.querySelectorAll(".ks-instrument-strip").forEach((o)=>Ki(o,i,e)),document.fonts?.ready.then(()=>i.querySelectorAll(".ks-instrument-strip").forEach(Ee)),()=>e.forEach((o)=>o())}var M=(i)=>i.replace(/[&<>"']/g,(e)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e]),Me=(i)=>`${i*100}%`,Je=(i)=>{let e=new URL(i,location.href);if(!["http:","https:"].includes(e.protocol))throw Error("Unsupported preview URL");return M(e.href)},Ce=(i)=>`left:${Me(i.x)};top:${Me(i.y)};width:${Me(i.w)};height:${Me(i.h)}`,On=(i)=>`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${i}</svg>`,Gn={check:On('<path d="m3 8.5 3 3 7-7"/>'),pencil:On('<path d="m3 11 1 2 2-1 7-7-3-3-7 7v2Z"/>'),image:On('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="m2.5 11.5 3.5-3.5 3 3 2-2 2.5 2.5"/>'),mark:On('<path d="M6 2.5H2.5V6M10 2.5h3.5V6M2.5 10v3.5H6M13.5 10v3.5H10M8 5.5v5M5.5 8h5"/>'),close:On('<path d="m4 4 8 8M4 12l8-8"/>'),chevron:On('<path d="m4 6 4 4 4-4"/>'),arrow:'<svg class="arrow" viewBox="0 0 16 8" aria-hidden="true" focusable="false"><path d="M0 4h14M10 0l4 4-4 4"/></svg>',alert:On('<path d="M8 2 1.5 13.5h13L8 2Z"/><path d="M8 6.5v3.2M8 11.6v.1"/>')};function Hi(i){let e=i.match(/^review is stale:\s*(.+?)\s+changed\b/i);if(e)return`${e[1]} changed after this round was prepared.`;let o=i.replace(/;?\s*prepare a new round\.?\s*$/i,"").trim();return o?`${o[0].toUpperCase()}${o.slice(1)}${/[.!?]$/.test(o)?"":"."}`:""}function Gi(i,e,o){let a=i.shadowRoot??i.attachShadow({mode:"open"}),t={...Ei(e),...structuredClone(o.initialDraft??{})};t.reclassify??=[];let d=He(e),f=Te(e),g=o.history??null,v=(()=>{let r=Fe(e,t)??d[0]?.id;return r?{type:"item",id:r}:f[0]?{type:"region",id:f[0].id}:null})(),h=null,k=!1,m=null,j=!1,V="comp",z=!1,Q=!1,X=!!o.completed,En=!1,on="",G=null,yn=null,Zn=null,Vn=/Mac|iPhone|iPad/.test(navigator.platform),K=new Map,zn=new Map,B=null,Dn=(r)=>e.components.find((s)=>s.id===r),pn=(r)=>f.find((s)=>s.id===r),en=()=>v?.type==="item"?Dn(v.id):void 0,D=()=>v?.type==="region"?pn(v.id):void 0,ln=()=>v?.type==="missing"?t.missing.find((r)=>r.id===v.id):void 0,S=()=>X||Q||!!o.status,Mn=new Image;Mn.onload=()=>{try{let r=Math.min(1,480/Mn.naturalWidth),s=document.createElement("canvas");s.width=Math.max(1,Math.round(Mn.naturalWidth*r)),s.height=Math.max(1,Math.round(Mn.naturalHeight*r));let p=s.getContext("2d",{willReadFrequently:!0});p.drawImage(Mn,0,0,s.width,s.height),B={data:p.getImageData(0,0,s.width,s.height).data,width:s.width,height:s.height},N()}catch{}},Mn.src=new URL(e.comp.url,location.href).href;function vn(r){if(!zn.has(r.id)&&B)zn.set(r.id,Mi(Vi(B.data,B.width,B.height,r.box))??"");return zn.get(r.id)||e.comp.background||"#e9ebe7"}function un(r,s){if(r.material?.alpha==="transparent")return!0;if(r.material?.alpha==="opaque")return!1;if(K.has(s))return K.get(s);if(K.set(s,!1),!/\.(png|webp)(\?|$)/i.test(s))return!1;let p=new Image;return p.onload=()=>{try{let c=Math.min(1,160/Math.max(p.naturalWidth,p.naturalHeight)),u=document.createElement("canvas");u.width=Math.max(1,Math.round(p.naturalWidth*c)),u.height=Math.max(1,Math.round(p.naturalHeight*c));let x=u.getContext("2d",{willReadFrequently:!0});x.drawImage(p,0,0,u.width,u.height);let y=x.getImageData(0,0,u.width,u.height).data,T=!1;for(let L=3;L<y.length;L+=4)if(y[L]<250){T=!0;break}if(T)K.set(s,!0),N()}catch{}},p.src=new URL(s,location.href).href,!1}function rn(r,s){G={label:s,before:t,select:v},t=r,h=null,on=""}function In(r){let s=Fe(e,t,r);if(s)v={type:"item",id:s};z=!1,N(),a.getElementById(s?"decide-yes":"submit")?.focus({preventScroll:!0})}function $n(){let r=en();if(!r||S()||h)return;rn(Ie(t,r,"approve"),`${r.role==="asset"?"Approved":"Kept in code"}: ${r.name}.`),In(r.id)}function dn(r){if(S())return;let s=en(),p=D(),c=s??p;if(!c)return;if(s&&r==="reclassify"&&s.role!=="plan")return;let u=s?Wn(s,t):void 0,x=p?Kn(t,p.id):void 0;h={type:r,id:c.id,region:!!p,text:u?.action===r?u.feedback:x?.feedback??"",kind:u?.kind??x?.kind??Oe({name:c.name,note:c.note??"",flags:s?.flags})},N(),a.getElementById("form-text")?.focus(),a.getElementById("decision-form")?.scrollIntoView({block:"nearest"})}function ee(){if(!h||S())return;let r=h;if(r.region){let p=pn(r.id);rn(Re(t,p.id,{kind:r.kind,feedback:r.text}),`${p.name} will become ${Pn(r.kind).toLowerCase()}.`),N(),a.getElementById("submit")?.focus({preventScroll:!0});return}let s=Dn(r.id);if(r.type==="revise"&&s.role==="plan"&&!r.text.trim()){a.getElementById("form-text")?.focus();return}rn(Ie(t,s,r.type,{feedback:r.text,kind:r.kind}),r.type==="revise"?`Needs work: ${s.name}.`:`${s.name} will become ${Pn(r.kind).toLowerCase()}.`),In(s.id)}function Nn(){if(!h)return;h=null,N(),(a.getElementById("decide-no")??a.getElementById("decide-image"))?.focus({preventScroll:!0})}function ie(){if(!G||S())return;t=G.before,v=G.select,G=null,h=null,N()}function fn(r){if(k)return;if(h&&h.id!==r.id)h=null;v=r,z=!1,N()}function he(r){let s=d.map((c)=>({type:"item",id:c.id}));if(!s.length)return;let p=s.findIndex((c)=>c.id===v?.id&&c.type===v?.type);fn(s[(p+r+s.length)%s.length])}async function re(){let r=Hn(e,t);if(Q||X||h||!r.canSubmit||o.status)return;Q=!0,on="",N();try{await o.onSubmit(Ti(e,t)),X=!0,En=!0,k=!1,G=null}catch(s){on=s instanceof Error?s.message:"The review could not be saved."}finally{Q=!1,N()}}function ae(r){let s=`missing-${crypto.randomUUID()}`;t={...t,inventoryConfirmed:!1,missing:[...t.missing,{id:s,name:"",feedback:"",box:r}]},k=!1,m=null,h=null,v={type:"missing",id:s},N(),a.getElementById("missing-name")?.focus()}let Xn=(r)=>{let s=Yn(r,t);if(s==="approved")return r.role==="asset"?"Looks good":"Code is fine";if(s==="revise")return"Needs work";if(s==="reclassify")return`Make it ${Pn(Wn(r,t).kind).toLowerCase()}`;if(X)return"Not decided";let p=g?.changes[r.id]?.kind;return p==="changed"?"Changed · review again":p==="added"?"New":"To decide"},oe=(r)=>r==="approved"?Gn.check:r==="revise"?Gn.pencil:r==="reclassify"?Gn.image:"",Y=(r)=>ne(r)?`Flagged · ${r.kind}`:r.role==="asset"?`Asset · ${r.kind}`:`Code · ${r.kind}`,J=(r,s=64)=>{let p=r.w*e.comp.width/(r.h*e.comp.height),c=40,u=Math.max(28,Math.min(s,40*p)),x=p>u/40?{w:u,h:u/p}:{w:40*p,h:40};return`<span class="thumb" style="width:${u}px;height:40px"><span class="crop" style="width:${x.w}px;height:${x.h}px">${$(r)}</span></span>`},$=(r,s="")=>`<img src="${Je(e.comp.url)}" alt="${M(s)}" draggable="false" style="width:${100/r.w}%;left:${-100*r.x/r.w}%;top:${-100*r.y/r.h}%">`;function U(){let r=d.map((p)=>{let c=Yn(p,t),u=v?.type==="item"&&v.id===p.id;return`<button class="chip ${c} ${ne(p)?"flagged":""} is-${p.role}" data-item="${M(p.id)}" role="tab" aria-selected="${u}" aria-label="${M(`${p.name}, ${Y(p)}, ${Xn(p)}`)}">${J(p.box)}<span class="chip-text"><strong>${M(p.name)}</strong><span>${M(Y(p))}</span></span><span class="chip-state" title="${M(Xn(p))}">${oe(c)}</span></button>`}).join(""),s=f.filter((p)=>Kn(t,p.id)).length;return`<nav class="queue" aria-label="Items to decide">
      <div class="queue-head"><h2>To decide</h2><span>${(()=>{let p=Hn(e,t).pending;return X?"Read-only":p?`${p} left`:d.length?"All decided":""})()}</span></div>
      <div class="queue-list">${r||'<p class="queue-empty">Nothing needs a decision. Check the comp for anything missing.</p>'}</div>
      ${f.length?`<button id="regions-toggle" class="disclosure" aria-expanded="${j}" aria-controls="region-list">${Gn.chevron}<span><strong>${f.length} more ${f.length===1?"region":"regions"} set in code${s?` · ${s} changing`:""}</strong><span>Checked in the first-viewport review</span></span></button>`:""}
    </nav>
    ${f.length&&j?`<div id="region-list" class="region-list ks-tab-list" role="tablist" aria-label="Regions set in code">${f.map((p)=>{let c=Kn(t,p.id),u=v?.type==="region"&&v.id===p.id;return`<button role="tab" data-region="${M(p.id)}" aria-selected="${u}" class="${c?"reclassify":""}">${M(p.name)}<small>${M(c?`to ${Pn(c.kind).toLowerCase()}`:p.kind)}</small></button>`}).join("")}</div>`:""}`}function A(){return[...f.map((s)=>({key:`r:${s.id}`,kind:"region",id:s.id,name:s.name,box:s.box,cls:`code ${Kn(t,s.id)?"reclassify":""}`,label:`${s.name}, set in code (${s.kind})`})),...e.components.map((s)=>({key:`i:${s.id}`,kind:"item",id:s.id,name:s.name,box:s.box,cls:`is-${s.role} ${ne(s)?"flagged":""} ${Yn(s,t)}`,label:`${s.name}, ${Y(s)}, ${Xn(s)}`})),...t.missing.map((s)=>({key:`m:${s.id}`,kind:"missing",id:s.id,name:s.name||"Missing",box:s.box,cls:"missing",label:`Missing: ${s.name||"unnamed"}`}))].sort((s,p)=>p.box.w*p.box.h-s.box.w*s.box.h).map((s)=>{let p=v?.type===s.kind&&v.id===s.id;return`<button class="region ${s.cls} ${p?"selected":""} ${s.box.y<0.06?"tag-below":""} ${s.box.x>0.7?"tag-right":""}" style="${Ce(s.box)}" data-${s.kind}="${M(s.id)}" aria-label="${M(s.label)}" aria-pressed="${p}"><span class="tag">${M(s.name)}</span></button>`}).join("")}function W(r,s){if(r?.role==="asset"){let c=g?.changes[r.id]?.kind==="changed"?g.packet.components.find((T)=>T.id===r.id)?.preview.url:void 0,u=z&&c?c:r.preview.url;if(!u)return'<div class="stage"><p class="stage-empty">This asset has no generated file.</p></div>';let x=un(r,u),y=V==="light"?"#f6f6f3":V==="dark"?"#1d201e":vn(r);return`<div class="stage pair" data-ratio="${r.box.w*e.comp.width/(r.box.h*e.comp.height)}" data-natural="${r.box.w*e.comp.width}x${r.box.h*e.comp.height}">
        <figure><figcaption>In the comp</figcaption><div class="frame crop">${$(r.box,`Comp region for ${r.name}`)}</div></figure>
        <figure><figcaption>${z&&c?`Previous version · round ${g.packet.round}`:"Generated asset"}</figcaption><div class="frame asset ${x?"clear":""}" style="${x?`background:${M(y)}`:""}"><img src="${Je(u)}" alt="Generated ${M(r.name)}" draggable="false"></div></figure>
      </div>
      ${x||c?`<div class="stage-tools">${c?`<div class="ks-instrument-strip is-paper" data-ks-strip="version" role="group" aria-label="Asset version"><button type="button" class="ks-instrument-key" id="ver-current" aria-pressed="${!z}">Current</button><button type="button" class="ks-instrument-key" id="ver-previous" aria-pressed="${z}">Previous</button></div>`:"<span></span>"}${x?`<div class="tool"><span class="tool-label">Backdrop</span><div class="ks-instrument-strip is-paper" data-ks-strip="backdrop" role="group" aria-label="Backdrop behind the transparent asset">${["comp","light","dark"].map((T)=>`<button type="button" class="ks-instrument-key" data-backdrop="${T}" aria-pressed="${V===T}">${T==="comp"?"Comp":T==="light"?"Light":"Dark"}</button>`).join("")}</div></div>`:""}</div>`:""}`}let p=r??s;if(!p)return"";return`<div class="stage single" data-box="${M(JSON.stringify(p.box))}">
      <figure><figcaption>In the comp</figcaption><div class="frame crop"><img src="${Je(e.comp.url)}" alt="Comp around ${M(p.name)}" draggable="false"><span class="focus-box"></span></div></figure>
    </div>`}function Jn(r,s){let p=(T)=>`<kbd>${T}</kbd>`;if(h){let T=h.type==="reclassify",L=!T&&Dn(h.id)?.role==="plan";return`<form id="decision-form" class="decision-form">
        ${T?`<div class="kinds"><span class="tool-label" id="kinds-label">Make it an image as</span><div class="ks-instrument-strip is-paper" data-ks-strip="kind" role="group" aria-labelledby="kinds-label">${xe.map((H)=>`<button type="button" class="ks-instrument-key" data-kind="${H.kind}" aria-pressed="${h.kind===H.kind}">${H.label}</button>`).join("")}</div><p class="kind-hint" id="kind-hint">${M(xe.find((H)=>H.kind===h.kind).hint)}.</p></div>`:""}
        <label class="field">${T?"Anything the image should keep? <span>Optional</span>":L?"What should change?":"What needs to change? <span>Optional</span>"}<textarea id="form-text" rows="3" ${L?"required":""} placeholder="${T?"For example: keep the brushed direction horizontal.":L?"For example: extend the hero photo under the nav.":"For example: the figure should face the sea."}">${M(h.text)}</textarea></label>
        <div class="form-actions"><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel</button><button type="submit" class="ks-button ks-button-primary">${T?"Make it an image":"Save feedback"}${An}</button></div>
      </form>`}if(s){let T=Kn(t,s.id);if(T)return`<div class="verdict reclassify"><p><strong>Will become ${M(Pn(T.kind).toLowerCase())}.</strong>${T.feedback?` ${M(T.feedback)}`:""}</p>${X?"":'<div class="verdict-actions"><button id="region-edit" class="text-action">Edit</button><button id="region-keep" class="text-action">Keep in code</button></div>'}</div>`;return`<div class="region-note"><p>No decision needed. Text, controls and layout are judged in the first-viewport review, once the page is built.</p>${X?"":'<button id="decide-image" class="ks-button ks-button-secondary">Make it an image</button>'}</div>`}if(!r)return"";let c=Wn(r,t);if(X)return`<div class="verdict ${c?Yn(r,t):"pending"}"><p><strong>${c?M(Xn(r)):"Not decided"}.</strong>${c?.feedback?` ${M(c.feedback)}`:""}</p></div>`;let u=r.role==="asset"?"Looks good":"Code is fine",x=r.role==="asset"?"Needs work":"Make it an image",y=Yn(r,t);return`<div class="decisions" role="group" aria-label="Decision for ${M(r.name)}">
        <button id="decide-yes" class="ks-button ks-button-primary">${u}</button>
        <button id="decide-no" class="ks-button ks-button-secondary">${x}</button>
      </div>
      ${r.role==="plan"?'<p class="other-action">Neither fits? <button id="decide-other" class="text-action">Something else…</button></p>':""}
      ${c?`<div class="verdict ${y}"><p><strong>${M(Xn(r))}.</strong>${c.feedback?` ${M(c.feedback)}`:c.action==="approve"?"":" No note; the agent will diagnose."}</p><div class="verdict-actions">${c.action==="approve"?"":'<button id="decision-edit" class="text-action">Edit</button>'}<button id="decision-clear" class="text-action">Clear</button></div></div>`:""}`}function I(){let r=en(),s=D(),p=ln();if(p)return`<div class="detail-head"><div><p class="eyebrow missing">Missing from the comp</p><h2>${M(p.name||"Name the missing piece")}</h2></div></div>
      ${W(void 0,{id:p.id,name:p.name||"the missing piece",kind:"missing",box:p.box})}
      <div class="missing-form"><label class="field">Name<input id="missing-name" value="${M(p.name)}" placeholder="For example: harbour boat" ${S()?"disabled":""}></label>
      <label class="field">What is missing? <span>Optional</span><textarea id="missing-feedback" rows="3" ${S()?"disabled":""}>${M(p.feedback)}</textarea></label>
      ${S()?"":'<button id="missing-remove" class="ks-button ks-button-ghost">Remove this mark</button>'}</div>`;if(!r&&!s)return'<div class="detail-empty"><p>Select a region on the comp.</p></div>';let c=r?.role==="plan"?[...(r.flags??[]).map(ji),...r.codeDrawn?["The plan draws this artwork in code. Painted work drawn in code usually reads as a stand-in."]:[]]:[],u=r?r.role==="asset"?`Generated asset · ${r.kind}`:`Planned in code · ${r.kind}`:`Set in code · ${s.kind}`,x=r?Yn(r,t):Kn(t,s.id)?"reclassify":"code",y=r?`<span class="pill ${x}">${oe(x)}${M(Xn(r))}</span>`:"",T=r&&g?.changes[r.id],L=(r?.note??s?.note??"").trim();return`<div class="detail-head"><div><p class="eyebrow ${r&&ne(r)?"flagged":""}">${M(u)}</p><h2>${M((r??s).name)}</h2></div>${y}</div>
      ${c.length?`<div class="flag" role="note">${Gn.alert}<div>${c.map((H)=>`<p>${M(H)}</p>`).join("")}</div></div>`:""}
      ${T?.kind==="changed"?`<p class="change-note">Changed since round ${g.packet.round}${T.files.length?`: ${M(T.files.join(", "))}`:""}.</p>`:""}
      ${W(r,s)}
      <div class="plan-copy">${r?.role==="asset"?L?`<p class="note">${M(L)}</p>`:"":`<p class="statement">${r?`<strong>Planned:</strong> ${M(De(r).replace(/^D/,"d"))}`:`<strong>${M(De(s))}</strong>`}</p>${L?`<p class="note">${M(L)}</p>`:""}`}</div>
      <div class="decide">${Jn(r,s)}</div>`}function te(){if(o.status)return`<div class="banner stale" role="alert">${Gn.alert}<div><strong>This review is out of date.</strong><p>${M(Hi(o.status))} Ask the agent to prepare a new round, then reload this page.</p></div><button id="reload" class="ks-button ks-button-secondary">Reload</button></div>`;if(on)return`<div class="banner error" role="alert">${Gn.alert}<div><strong>Your decisions were not sent.</strong><p>${M(on)}</p></div><button id="retry" class="ks-button ks-button-secondary">Try again</button></div>`;if(X){let r=Hn(e,t);return`<div class="banner done" role="status">${Gn.check}<div><strong>${r.hasChanges?"Changes sent.":"Plan and assets approved."}</strong><p>${r.hasChanges?"The agent applies them and opens a new round for anything that changed.":"The agent continues to the first viewport."}${En?"":" This round is read-only."}</p></div></div>`}return""}function Ye(){let r=Hn(e,t);if(X)return`<footer><span class="progress">Round ${e.round} · read-only</span><span class="progress">${r.approved} approved${r.revise?` · ${r.revise} need${r.revise===1?"s":""} work`:""}${r.reclassify?` · ${r.reclassify} to become images`:""}${r.missing?` · ${r.missing} missing`:""}</span></footer>`;let s=[r.revise?`${r.revise} need${r.revise===1?"s":""} work`:"",r.reclassify?`${r.reclassify} to become ${r.reclassify===1?"an image":"images"}`:"",r.missing?`${r.missing} missing`:""].filter(Boolean),p=h?"Save or cancel the open note first.":o.status?"This round can no longer be sent.":r.mode==="changes"?`${s.join(" · ")}.${r.pending?` ${r.pending} undecided stay open.`:""}`:r.pending?`${r.pending} left to decide. Approval confirms nothing is missing from the comp.`:"Approval confirms nothing is missing from the comp.",c=!r.canSubmit||!!h||Q||!!o.status;return`<footer>
      <button id="mark" class="ks-button ks-button-ghost mark" aria-pressed="${k}">${k?"Cancel marking":"Mark missing"}</button>
      <div class="progress" role="status">${G?`<span>${M(G.label)}</span><button id="undo" class="text-action">Undo</button>`:o.status?"":'<span class="keys"><kbd>A</kbd> approve <kbd>N</kbd> change <kbd>F</kbd> feedback <kbd>J</kbd><kbd>K</kbd> move</span>'}</div>
      <div class="submit"><p>${M(p)}</p><button id="submit" class="ks-button ks-button-primary" ${c?"disabled":""}>${Q?"Sending…":r.mode==="changes"?"Send changes":"Approve plan and assets"}${Q?"":An}</button></div>
    </footer>`}function N(){yn?.disconnect(),Zn?.();let r=a.activeElement,s=r?.id,p=r?.dataset.item??r?.dataset.region,c=a.querySelector(".queue-list")?.scrollLeft??0,u=r instanceof HTMLTextAreaElement||r instanceof HTMLInputElement?[r.selectionStart,r.selectionEnd]:null;a.innerHTML=`<style>${$i}</style><section class="plan-review ${X?"is-submitted":""}" aria-label="Plan and asset review">
      <header><div class="titles"><h1>${X?"Plan and asset review.":"Review the plan and assets."}</h1><p>Generated images, and what will be drawn in code, before any page code is written.</p></div>
        <div class="meta"><span class="surface">${M(e.title)}</span><span>Round ${e.round}</span>${X?'<span class="badge">Submitted · read-only</span>':o.preview?'<span class="badge">Preview</span>':""}</div></header>
      ${te()}
      ${U()}
      <div class="work">
        <section class="map-pane" aria-label="Approved comp">
          <div class="map-space"><div class="map ${k?"marking":""} ${v?"has-selection":""}"><img class="comp" src="${Je(e.comp.url)}" alt="Approved comp for ${M(e.title)}" draggable="false">${A()}<div class="draw-box" hidden></div></div></div>
          <div class="legend">${k?'<span class="marking-hint">Drag on the comp around what is missing.</span>':`<span><i class="lg asset"></i>Generated asset</span><span><i class="lg plan"></i>Planned in code</span><span><i class="lg flagged"></i>Flagged</span>${f.length?'<span><i class="lg code"></i>Set in code (hover)</span>':""}${t.missing.length?'<span><i class="lg missing"></i>Missing</span>':""}`}</div>
        </section>
        <section class="detail" aria-label="Selected item">${I()}</section>
      </div>
      ${Ye()}
    </section>`;let x=a.querySelector(".queue-list");if(x)x.scrollLeft=c;if(s){let T=a.getElementById(s);if(T?.focus({preventScroll:!0}),u&&(T instanceof HTMLTextAreaElement||T instanceof HTMLInputElement))try{T.setSelectionRange(u[0],u[1])}catch{}}else if(p)a.querySelector(`[data-item="${CSS.escape(p)}"],[data-region="${CSS.escape(p)}"]`)?.focus({preventScroll:!0});a.querySelector('.chip[aria-selected="true"]')?.scrollIntoView({block:"nearest",inline:"nearest"}),ge(),ke();let y=a.querySelector(".work");if(yn=new ResizeObserver(ke),yn.observe(y),Zn=Ve(a),!X)o.onDraftChange?.(structuredClone(t))}function ke(){let r=a.querySelector(".map-space"),s=a.querySelector(".map");if(r&&s){let y=matchMedia("(max-width: 820px)").matches,T=r.clientWidth,L=y?1/0:r.clientHeight,H=Math.min(T/e.comp.width,L/e.comp.height);s.style.width=`${e.comp.width*H}px`,s.style.height=`${e.comp.height*H}px`}let p=26,c=16,u=a.querySelector(".stage.pair");if(u){let y=Number(u.dataset.ratio),[T,L]=(u.dataset.natural??"0x0").split("x").map(Number),H=Yi(y,u.clientWidth,u.clientHeight,c,p,4,{w:T,h:L});u.dataset.direction=H.direction,u.querySelectorAll(".frame").forEach((tn)=>{tn.style.width=`${Math.floor(H.w)}px`,tn.style.height=`${Math.floor(H.h)}px`})}let x=a.querySelector(".stage.single");if(x?.clientWidth){let y=JSON.parse(x.dataset.box),T=Ji(y,e.comp.width,e.comp.height,x.clientWidth,Math.max(60,x.clientHeight-p)),L=x.querySelector(".frame"),H=L.querySelector("img"),tn=L.querySelector(".focus-box"),P=T.view;L.style.width=`${Math.floor(T.width)}px`,L.style.height=`${Math.floor(T.height)}px`,H.style.cssText=`width:${100/P.w}%;left:${-100*P.x/P.w}%;top:${-100*P.y/P.h}%`,tn.style.cssText=Ce({x:(y.x-P.x)/P.w,y:(y.y-P.y)/P.h,w:y.w/P.w,h:y.h/P.h})}}function ge(){let r=(x,y)=>a.getElementById(x)?.addEventListener("click",y);a.querySelectorAll("[data-item]").forEach((x)=>x.addEventListener("click",()=>fn({type:"item",id:x.dataset.item}))),a.querySelectorAll("[data-region]").forEach((x)=>x.addEventListener("click",()=>fn({type:"region",id:x.dataset.region}))),a.querySelectorAll("[data-missing]").forEach((x)=>x.addEventListener("click",()=>fn({type:"missing",id:x.dataset.missing}))),r("regions-toggle",()=>{j=!j,N()}),r("decide-yes",$n),r("decide-no",()=>dn(en()?.role==="asset"?"revise":"reclassify")),r("decide-image",()=>dn("reclassify")),r("decide-other",()=>dn("revise")),r("decision-edit",()=>{let x=en();dn(x&&Wn(x,t)?.action==="reclassify"?"reclassify":"revise")}),r("decision-clear",()=>{let x=en();if(x&&!S())rn(qi(t,x.id),`Cleared: ${x.name}.`),N()}),r("region-edit",()=>dn("reclassify")),r("region-keep",()=>{let x=D();if(x&&!S())rn(Re(t,x.id,null),`${x.name} stays in code.`),N()}),r("form-cancel",Nn),a.getElementById("decision-form")?.addEventListener("submit",(x)=>{x.preventDefault(),ee()}),a.getElementById("form-text")?.addEventListener("input",(x)=>{if(h)h.text=x.target.value}),a.querySelectorAll("[data-kind]").forEach((x)=>x.addEventListener("click",()=>{if(!h)return;h.kind=x.dataset.kind,a.querySelectorAll("[data-kind]").forEach((T)=>T.setAttribute("aria-pressed",String(T===x)));let y=a.getElementById("kind-hint");if(y)y.textContent=`${xe.find((T)=>T.kind===h.kind).hint}.`})),a.querySelectorAll("[data-backdrop]").forEach((x)=>x.addEventListener("click",()=>{V=x.dataset.backdrop,N()})),r("ver-current",()=>{z=!1,N()}),r("ver-previous",()=>{z=!0,N()}),r("undo",ie),r("submit",()=>void re()),r("retry",()=>void re()),r("reload",()=>location.reload()),r("mark",()=>{if(S())return;k=!k,h=null,N()}),r("missing-remove",()=>{let x=ln();if(!x)return;t={...t,missing:t.missing.filter((y)=>y.id!==x.id)},v=d[0]?{type:"item",id:d[0].id}:null,N()});let s=()=>{let x=a.getElementById("submit");if(x)x.disabled=!Hn(e,t).canSubmit||!!h||Q||!!o.status};if(a.getElementById("missing-name")?.addEventListener("input",(x)=>{let y=ln();if(y)y.name=x.target.value,s(),o.onDraftChange?.(structuredClone(t))}),a.getElementById("missing-name")?.addEventListener("change",()=>N()),a.getElementById("missing-feedback")?.addEventListener("input",(x)=>{let y=ln();if(y)y.feedback=x.target.value,o.onDraftChange?.(structuredClone(t))}),S())a.querySelectorAll("#mark,#decide-yes,#decide-no,#decide-other,#decide-image,#decision-edit,#decision-clear,#region-edit,#region-keep").forEach((x)=>x.disabled=!0);let p=a.querySelector(".map");if(!p)return;let c=(x)=>{let y=p.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(x.clientX-y.left)/y.width)),y:Math.max(0,Math.min(1,(x.clientY-y.top)/y.height))}},u=null;p.addEventListener("pointerdown",(x)=>{if(!k)return;m=c(x),u=null,p.setPointerCapture(x.pointerId),x.preventDefault()}),p.addEventListener("pointermove",(x)=>{if(!m)return;let y=c(x);u={x:Math.min(m.x,y.x),y:Math.min(m.y,y.y),w:Math.abs(y.x-m.x),h:Math.abs(y.y-m.y)};let T=a.querySelector(".draw-box");T.hidden=!1,T.style.cssText=Ce(u)}),p.addEventListener("pointerup",()=>{if(u&&u.w>0.01&&u.h>0.01)ae(u);else m=null,u=null}),p.addEventListener("pointercancel",()=>{m=null,u=null,N()})}let se=(r)=>{let s=r;if(!i.isConnected||s.defaultPrevented)return;let p=s.composedPath()[0],c=p instanceof HTMLTextAreaElement||p instanceof HTMLInputElement&&p.type!=="radio";if(s.key==="Escape"){if(h)s.preventDefault(),Nn();else if(k)s.preventDefault(),k=!1,N();return}if(s.key==="Enter"&&(s.metaKey||s.ctrlKey)&&h){s.preventDefault(),ee();return}if(c||s.altKey||s.isComposing||S())return;if((s.metaKey||s.ctrlKey)&&s.key.toLowerCase()==="z"){if(G)s.preventDefault(),ie();return}if(s.metaKey||s.ctrlKey||h)return;let u=s.key.toLowerCase();if(u==="a"&&en())s.preventDefault(),$n();else if(u==="f"&&en())s.preventDefault(),dn("revise");else if(u==="n"&&(en()||D()))if(s.preventDefault(),D())dn("reclassify");else a.getElementById("decide-no")?.click();else if(u==="j"||s.key==="ArrowRight"&&!(p instanceof HTMLInputElement))s.preventDefault(),he(1);else if(u==="k"||s.key==="ArrowLeft"&&!(p instanceof HTMLInputElement))s.preventDefault(),he(-1)};return document.addEventListener("keydown",se),N(),{destroy(){yn?.disconnect(),Zn?.(),document.removeEventListener("keydown",se),a.replaceChildren()},getDraft(){return structuredClone(t)}}}var w=(i)=>i.replace(/[&<>"']/g,(e)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e]),Qn=(i)=>`${i*100}%`,mn=(i)=>{let e=new URL(i,location.href);if(!["http:","https:"].includes(e.protocol))throw Error("Unsupported preview URL");return w(e.href)};function Qi(i,e,o){if(qe(e))return Gi(i,e,{...o,history:o.history,initialDraft:o.initialDraft,onDraftChange:o.onDraftChange,onSubmit:o.onSubmit});let a=i.attachShadow({mode:"open"}),t=structuredClone(o.initialDraft??ki(e)),d=e.stage==="hero"&&e.components.length===1&&!t.missing.length,f=()=>[...e.components].sort((J,$)=>gn(J,t,o.history).priority-gn($,t,o.history).priority),g=f().find((J)=>gn(J,t,o.history).kind!=="approved")?.id??e.components[0]?.id,v=Sn(e,t).pending?"pending":"reviewed",h=!1,k=!1,m=o.completed??!1,j="",V={},z=!!o.completed||!Sn(e,t).pending,Q=null,X=!0,En=/Mac|iPhone|iPad/.test(navigator.platform)?"⌘Enter":"Ctrl+Enter",on=!1,G=!1,yn=!1,Zn=null,Vn=!1,K=!0,zn=!1,B="comp",Dn=B,pn="fit",en="checker",D=!1,ln="isolated",S,Mn="fit",vn=null,un=null,rn=null,In=null,$n='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>',dn='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11 1 2 2-1 7-7-3-3-7 7v2Z"/></svg>',ee=(J,$)=>{if(J.stage==="hero")return"";let U=ze(J,$);if(!U.related.length)return"";let A=U.related.map((W)=>w(W.name)).join(" · ");return`<div class="review-scope" aria-label="Review scope"><p><strong>Reviewing</strong> ${w(U.description||$.name)}</p><p class="separate-reviews"><strong>Outlined · reviewed separately</strong> ${A}</p>${U.excluded.length?`<p class="scope-excluded">Hidden in this preview: ${U.excluded.map((W)=>w(W.name)).join(" · ")}</p>`:""}</div>`},Nn=(J)=>`left:${Qn(J.x)};top:${Qn(J.y)};width:${Qn(J.w)};height:${Qn(J.h)}`,ie=(J,$)=>J.stage==="hero"?"":ze(J,$).related.map((U)=>{let A=$.box,W=U.box,Jn=Math.max(A.x,W.x),I=Math.max(A.y,W.y),te={x:(Jn-A.x)/A.w,y:(I-A.y)/A.h,w:Math.max(0,Math.min(A.x+A.w,W.x+W.w)-Jn)/A.w,h:Math.max(0,Math.min(A.y+A.h,W.y+W.h)-I)/A.h};return`<span class="reference-layer" style="${Nn(te)}" title="Reviewed separately: ${w(U.name)}" aria-label="Reviewed separately: ${w(U.name)}"><span>${w(U.name)}</span></span>`}).join("");function fn(J){a.getElementById(J)?.focus({preventScroll:!0})}function he(J){let $=ui(e,t,J);if(z=!$,$)g=$;B="component",D=!1,on=!1,pn="fit",ln="isolated",X=!0,v=z?"reviewed":"pending";let U=()=>{Y(),fn(z?"review-summary":V[g]?"feedback":"approve")};if(z&&G&&Zn)Zn(U);else U()}async function re(){if(k||m||D||Object.keys(V).length)return;k=!0,j="",Y();try{await o.onSubmit(vi(e,t)),m=!0,z=!0,h=!1,v="reviewed"}catch(J){j=J instanceof Error?J.message:"Could not save. Try again."}finally{k=!1,Y()}}function ae(J){if(k||m||D||yn)return;let $=e.components.find((I)=>I.id===g);if(!$||!de(e,t,$,X,Object.keys(V)).length)return;let U=t.decisions[$.id],A=U?.revision===$.revision?U:void 0,W=de(e,t,$,X,Object.keys(V));Q={id:$.id,name:W.length>1?`${$.reviewGroup} · ${W.length} instances`:$.name,action:J,previous:Object.fromEntries(W.map((I)=>[I.id,t.decisions[I.id]?{...t.decisions[I.id]}:void 0]))};let Jn=V[$.id]??A;for(let I of W)t.decisions[I.id]={revision:I.revision,action:J,feedback:J==="revise"?Jn?.feedback??"":"",split:J==="revise"&&(Jn?.split??!1)};if(delete V[$.id],zn)K=!0,zn=!1;if(d)t.inventoryConfirmed=J==="approve",Q=null,re();else he($.id)}function Xn(){if(k||m||D||yn)return;let J=e.components.find((A)=>A.id===g);if(!J||!de(e,t,J,X,Object.keys(V)).length)return;let $=t.decisions[J.id],U=$?.revision===J.revision?$:void 0;if(V[J.id]??={feedback:U?.feedback??"",split:U?.split??!1},K&&(a.querySelector(".workbench")?.clientHeight??0)<420)zn=!0,K=!1;z=!1,Y(),fn("feedback")}function oe(J){let $=`missing-${crypto.randomUUID()}`;t.missing.push({id:$,name:"Missing component",feedback:"",box:J}),t.inventoryConfirmed=!1,z=!1,g=$,B="component",h=!1,vn=null,un=null,Y(),a.querySelector("#missing-name")?.focus()}function Y(){if(rn?.disconnect(),In?.(),m||z&&!d)G=!1;let J=a.activeElement,$=J?.id,U=J?.dataset.select,A=window.scrollX,W=window.scrollY,Jn=a.querySelector(".inventory")?.scrollLeft??0,I=S===g,te=B==="component"&&(!I||Dn!==B);Dn=B;let Ye=I?a.querySelector(".inspection-content")?.scrollTop??0:0,N=I&&(a.querySelector(".changed-files")?.open??!1),ke=a.querySelector(".comparison-slot")?.clientHeight??200,ge=a.querySelector(".pan-viewport"),se=S===g&&Mn===pn,r=se?ge?.scrollLeft??0:0,s=se?ge?.scrollTop??0:0;S=g,Mn=pn;let p=e.components.find((n)=>n.id===g),c=t.missing.find((n)=>n.id===g),u=fi(e,t,o.history),x=u.find((n)=>n.members.some((l)=>l.id===g)),y=!!x&&x.members.length>1&&X,T=y?x.box:p?.box??c?.box,L=x?u.indexOf(x)+1:u.length+t.missing.findIndex((n)=>n.id===g)+1,H=p?t.decisions[p.id]:void 0,tn=H?.revision===p?.revision?H:void 0,P=p?V[p.id]:void 0,_n=Object.keys(V).length>0,Se=p?ye(e,p):[],Un=p?de(e,t,p,X,Object.keys(V)):[],Zi=p?!e.components.some((n)=>!Un.some((l)=>l.id===n.id)&&gn(n,t).kind==="pending"):!1,$e=Q&&!m?`<div class="decision-notice"><span role="status">${w(Q.name)} ${Q.action==="approve"?"approved":"flagged for repair"}.</span><button id="undo-decision" class="text-action">Undo</button></div>`:"",O=Sn(e,t),R=o.history,xn=p?me(p.id,R):void 0,Ln=R?.packet.components.find((n)=>n.id===p?.id),jn=D&&!!Ln,q=jn?Ln:p,an=jn?R.packet:e,Pe=Object.values(R?.changes??{}),ni=Pe.filter((n)=>n.kind==="changed").length,ei=Pe.filter((n)=>n.kind==="added").length,Xe=e.components.filter((n)=>gn(n,t,R).kind==="approved"&&me(n.id,R).carried).length,Ge=(n)=>{let l=gn(n,t,R);return m&&l.kind==="feedback"?{...l,label:"Changes requested"}:l},pe=u.filter((n)=>n.kind==="pending").length,Ni=u.length-pe+t.missing.length,ii=u.filter((n)=>v==="all"||n.kind==="pending"===(v==="pending")).map((n)=>n.representative),_i=(n)=>u.find((l)=>l.members.some((b)=>b.id===n))?.label??n,Ui=[O.revisions+t.missing.length?`${O.revisions+t.missing.length} feedback ready`:"",Xe?`${Xe} ${Xe===1?"approval":"approvals"} kept`:"",ni?`${ni} changed`:"",ei?`${ei} added`:"",R?.removed.length?`${R.removed.length} removed`:""].filter(Boolean).join(" · "),Li=j||(_n?"Save or cancel your open feedback before sending.":m?o.preview?"Preview submitted. No run changed.":"Review submitted.":O.hasFeedback?"Ready to send for corrections.":O.pending?`${pe} left to review`:!t.inventoryConfirmed?"Confirm the map is complete.":"Ready to continue."),qn=q?Cn(q):null,Qe=q?.preview.kind==="image"&&!qn?.code,Ze=Qe||q?.material?.alpha==="transparent",cn=!!(q?.context&&ln==="context"),ri=q&&(cn?q.context?.kind!=="image":q.preview.kind==="page"),Ne=cn&&q?.context?q.context.url:q?.preview.url,ai=q?ze(an,q):null,Bi=qn?.code?`${qn.label} · ${qn.captured?"captured from code":"live preview"}`:q?.material?`${q.material.alpha==="transparent"?"Transparent":q.material.alpha==="opaque"?"Opaque":"Transparency unverified"} ${q.material.format}`:"Raster · transparency unverified";a.innerHTML=`<style>${zi}</style><section class="review ${d?"assembled-review":""}" aria-label="${d?"Assembled page review":"Component review"}" style="--comp-background:${/^#[0-9a-f]{6}$/i.test(e.comp.background??"")?e.comp.background:"#eeeeee"}">
      <header><div><h1>${m?"Review record.":d?"Review the assembled page.":"Review the components."}</h1><p>${w(e.title)} <span>· Round ${e.round}</span></p></div>${m?'<span class="badge">Submitted · read-only</span>':o.preview?'<span class="badge">Interactive preview</span>':""}</header>
      ${o.preview?'<p class="preview-note">Historical hotel artwork for testing this interface. Decisions stay in this preview; no run is changed.</p>':""}
      ${R&&!d?`<section class="round-summary" aria-label="Changes since previous round"><p><strong>${pe} ${pe===1?"item":"items"} to review</strong><span>${Ui}</span></p>${O.pending?`<button id="review-changes" class="ks-icon-button" aria-label="Next to review" title="Next to review">${wn("next")}</button>`:""}${R.removed.length?`<details><summary>Removed from the map</summary><p>${R.removed.map((n)=>w(n.name)).join(" · ")}. Confirm these omissions are intentional before accepting the map.</p></details>`:""}</section>`:""}
      ${!d?`<div class="mobile-panes"><div class="ks-instrument-strip is-paper" data-ks-strip="pane" role="group" aria-label="Inspection view"><button type="button" class="ks-instrument-key" id="show-comp" aria-pressed="${B==="comp"}">Approved comp</button><button type="button" class="ks-instrument-key" id="show-component" aria-pressed="${B==="component"}">Component ${L}</button></div></div>`:""}
      <div class="workbench" data-mobile-pane="${B}">${!d?`<svg class="connector" aria-hidden="true"><path /></svg>
        <section class="reference" aria-label="Approved composition">
          <div class="section-head"><h2>Approved comp</h2>${!m?`<button id="mark" class="ks-button ks-button-ghost" aria-pressed="${h}">${h?"Cancel":"Mark missing"}</button>`:""}</div>
          <div class="map-space"><div class="map ${h?"marking":""}" style="aspect-ratio:${e.comp.width}/${e.comp.height}">
            <img class="comp" src="${mn(e.comp.url)}" alt="Approved composition for ${w(e.title)}" draggable="false">
            ${T&&!z?`<div class="region" style="${Nn(T)}"></div>`:""}
            ${u.map((n,l)=>{let b=n.representative,E={kind:n.kind,label:n.stateLabel},kn=!z&&x?.id===n.id;return`<button class="pin ${E.kind} ${kn?"selected":""}" data-select="${w(b.id)}" style="left:${Qn(Math.min(0.96,n.box.x+n.box.w/2))};top:${Qn(Math.max(0.035,n.box.y))}" aria-label="Inspect ${w(n.label)}${n.members.length>1?` · ${n.members.length} instances`:""} — ${w(E.label)}" title="${l+1}. ${w(n.label)} · ${w(E.label)}" aria-pressed="${kn}">${E.kind==="approved"?$n:E.kind==="feedback"?dn:""}<span>${l+1}</span>${n.members.length>1?`<small>×${n.members.length}</small>`:""}</button>`}).join("")}
            ${y&&!z?x.members.map((n)=>`<div class="region instance-region" style="${Nn(n.box)}"></div>`).join(""):""}
            ${t.missing.map((n,l)=>`<button class="pin feedback ${!z&&g===n.id?"selected":""}" data-select="${w(n.id)}" style="left:${Qn(n.box.x+n.box.w/2)};top:${Qn(n.box.y)}" aria-label="Inspect missing ${w(n.name)}" title="Missing: ${w(n.name)}">${dn}<span>${u.length+l+1}</span></button>`).join("")}

            <div class="draw-box" hidden></div>
          </div></div>
          <div class="map-legend" aria-label="Map status legend"><span><i class="legend-pending">#</i> To review</span><span><i class="legend-feedback">${dn}</i> ${m?"Changes requested":"Feedback ready"}</span><span><i class="legend-approved">${$n}</i> Approved</span></div>
          ${h?'<div class="map-caption">Draw around the missing piece.<button id="add-box">Add an adjustable box</button></div>':""}
        </section>`:""}
        <section class="inspector" aria-label="${d?"Page comparison":"Selected component"}">
          ${!d?`<div class="section-head"><h2>${z?"Review summary":`<span class="number">${L}</span> ${w(y?x.label:p?.name??c?.name??"Component")}`}</h2></div>`:""}<div class="inspection-content" role="region" aria-label="${d?"Page comparison":"Component comparison"}" tabindex="0">
          ${z&&!d?`<section class="review-summary" id="review-summary" tabindex="-1"><div class="completion-mark" aria-hidden="true">${$n}</div><h2>${m?"Review sent.":"All components reviewed."}</h2><p>${O.approved} approved · ${O.revisions} flagged for repair${t.missing.length?` · ${t.missing.length} missing`:""}</p><p>${m?"Your decisions are saved.":O.hasFeedback?"Send your feedback to start the next repair round.":"Confirm nothing is missing, then approve and continue."}</p><div class="summary-decisions">${u.map((n)=>{let l=n.representative,b=t.decisions[l.id],E=Ge(l);return`<button data-select="${w(l.id)}"><strong>${w(n.label)}</strong><span>${n.kind==="pending"?"Not reviewed":E.kind==="feedback"?"Needs work":"Approved"}</span>${b?.action==="revise"?`<small>${w(b.feedback||"No note — agent will diagnose.")}</small>`:""}</button>`}).join("")}${t.missing.map((n)=>`<button data-select="${w(n.id)}"><strong>${w(n.name)}</strong><span>Missing</span><small>${w(n.feedback)}</small></button>`).join("")}</div></section></div>${$e?`<div class="review-form">${$e}</div>`:""}`:p?`
          ${R?`<div class="repair-context">
            ${jn&&xn?.prior?.action==="revise"?`<section class="previous-feedback" aria-label="Previous feedback"><h3>Previous feedback <span>· Round ${xn.feedbackRound}</span></h3><blockquote>${w(xn.prior.feedback||"No written feedback was supplied.")}</blockquote>${xn.prior.split?"<p>Requested: split into separately reviewable components.</p>":""}</section>`:xn?.carried?'<p class="kept-approval">Unchanged · approval kept</p>':""}
            ${xn?.change?.kind==="changed"?`<details class="changed-files" ${N?"open":""}><summary>${xn.change.files.length?`${xn.change.files.length} changed ${xn.change.files.length===1?"file":"files"}`:xn.change.reasons.includes("region")?"Region changed":Ln?.note!==p.note?"Description changed · files unchanged":"Component definition changed · files unchanged"}</summary>${xn.change.files.length?`<ul>${xn.change.files.map((n)=>`<li>${w(n)}</li>`).join("")}</ul>`:""}${Ln&&Ln.note!==p.note?`<dl class="description-diff"><dt>Previous description</dt><dd>${w(Ln.note)}</dd><dt>Current description</dt><dd>${w(p.note)}</dd></dl>`:""}</details>`:""}
          </div>`:""}

          <div class="comparison-slot"><div class="comparison-panel ${y?"group-overview":""}"><h2 class="expanded-title">${w(y?x.label:q.name)}</h2>${Se.length>1?`<div class="review-peers"><strong>${Se.length} instances</strong>${!y?'<button id="all-instances" class="quiet">All instances</button>':'<span class="group-hint">Select to inspect</span>'}</div>`:""}<div class="compare-toolbar">${Ln?`<div class="round-switch ks-instrument-strip is-paper" data-ks-strip="round" role="group" aria-label="Preview version"><button type="button" class="ks-instrument-key" id="current-round" aria-label="Current · round ${e.round}" title="Current · round ${e.round}" aria-pressed="${!jn}">Current</button><button type="button" class="ks-instrument-key" id="previous-round" aria-label="Previous · round ${R.packet.round}" title="Previous · round ${R.packet.round}" aria-pressed="${jn}">Previous</button></div>`:""}<div class="ks-instrument-strip is-paper zoom-strip" data-ks-strip="zoom" role="group" aria-label="Comparison zoom">${[["fit","Fit"],["1","100%"],["2","200%"],["4","400%"]].map(([n,l])=>`<button type="button" class="ks-instrument-key" data-zoom="${n}" aria-pressed="${String(pn)===n}">${l}</button>`).join("")}</div><button id="overlay" type="button" class="ks-switch" title="Overlay the approved comp" aria-pressed="${on}"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">Overlay</span></button><div class="comparison-actions" role="group" aria-label="Comparison view actions"><button id="expand-comparison" class="ks-icon-button" aria-label="${G?"Restore comparison":"Enlarge comparison"}" title="${G?"Restore comparison (Esc)":"Enlarge comparison"}" aria-expanded="${G}">${wn(G?"compact":"expand")}</button>${q?.preview.kind==="image"?`<a class="ks-icon-button source-link" href="${mn(Ne)}" target="_blank" rel="noopener" aria-label="${cn?"Open context capture":qn.fileLabel}" title="${cn?"Open context capture":qn.fileLabel}">${wn("external")}</a>`:""}</div></div>
          ${y?`<div class="instance-grid" aria-label="All instances of ${w(x.label)}"><div class="instance-grid-labels"><span>Full comp crop</span><span>Component preview</span></div>${x.members.map((n,l)=>{let b=Ge(n);return`<button class="instance-row ${b.kind}" data-instance="${w(n.id)}" aria-label="Inspect instance ${l+1}: ${w(n.name)} — ${w(b.label)}"><span class="instance-caption"><strong>${w(n.name)}</strong><span>${w(b.label)}</span></span><span class="instance-pair"><span class="instance-reference" style="width:min(100%,${n.box.w*e.comp.width}px,${180*n.box.w*e.comp.width/(n.box.h*e.comp.height)}px);aspect-ratio:${n.box.w*e.comp.width}/${n.box.h*e.comp.height}"><img src="${mn(e.comp.url)}" alt="Comp: ${w(n.name)}" loading="lazy" style="width:${100/n.box.w}%;left:${-100*n.box.x/n.box.w}%;top:${-100*n.box.y/n.box.h}%">${ie(e,n)}</span><span class="instance-produced" style="width:min(100%,${n.box.w*e.comp.width}px,${180*n.box.w*e.comp.width/(n.box.h*e.comp.height)}px);aspect-ratio:${n.box.w*e.comp.width}/${n.box.h*e.comp.height}">${n.preview.kind==="image"?`<img src="${mn(n.preview.url)}" alt="Produced: ${w(n.name)}" loading="lazy">`:n.thumbnail?`<img src="${mn(n.thumbnail.url)}" alt="Preview: ${w(n.name)}" loading="lazy">`:"Open live component"}</span></span>${ee(e,n)}</button>`}).join("")}</div>`:""}
          ${!y&&q?ee(an,q):""}<div class="compare">
            <figure><figcaption>${jn?`Comp · Round ${R.packet.round}`:d?"Approved comp":ai?.related.length?"Full comp crop":"In the comp"}</figcaption><div class="pan-viewport" aria-label="Reference comparison canvas" tabindex="0"><div class="crop-stage"><img class="crop-image" src="${mn(an.comp.url)}" alt="Reference region for ${w(q.name)}" style="width:${100/q.box.w}%;left:${-100*q.box.x/q.box.w}%;top:${-100*q.box.y/q.box.h}%">${ie(an,q)}</div></div></figure>
            <figure><figcaption>${jn?`Previous · Round ${R.packet.round}`:d?"Assembled page":cn?"In context":R?`${qn.caption} · Round ${e.round}`:qn.caption}</figcaption><div class="pan-viewport" aria-label="Produced comparison canvas" tabindex="0"><div class="output crop-stage ${Ze&&!cn&&!ri&&en==="checker"?"checker":""}">${!ri?`<img class="asset" src="${mn(Ne)}" alt="Produced ${w(q.name)}" style="object-position:${w(q.preview.position??"center")}">`:`<iframe aria-hidden="true" title="Rendered ${w(q.name)}" src="${mn(Ne)}" sandbox="" tabindex="-1" width="${an.comp.width}" height="${an.comp.height}"></iframe>`}${on?`<img class="crop-image overlay-image" src="${mn(an.comp.url)}" alt="Reference overlay" style="width:${100/q.box.w}%;left:${-100*q.box.x/q.box.w}%;top:${-100*q.box.y/q.box.h}%">`:""}</div></div></figure>
          </div>
          ${Ze||q.context?`<div class="view-controls">${q.context?`<div class="ks-instrument-strip is-paper" data-ks-strip="view" role="group" aria-label="Component view"><button type="button" class="ks-instrument-key" id="isolated" aria-pressed="${!cn}">${Qe?"Asset only":"Component only"}</button><button type="button" class="ks-instrument-key" id="context" aria-pressed="${cn}">In context</button></div>`:""}${Ze?`<div class="background-options ks-instrument-strip is-paper" data-ks-strip="background" role="group" aria-label="Asset preview background"><button type="button" id="background-checker" class="ks-instrument-key" aria-label="Checkerboard background" title="Checkerboard background" aria-pressed="${en==="checker"}" ${cn?"disabled":""}>Checker</button><button type="button" id="background-page" class="ks-instrument-key" aria-label="${an.comp.background?"Page color":"Neutral"} background" title="${an.comp.background?"Page color":"Neutral"} background" aria-pressed="${en==="page"}" ${cn?"disabled":""}>Page</button></div>`:""}</div>`:""}
          </div></div>${!d&&!y?`<div class="component-details"><div class="material">${wn(qn.code?"code":"image")}<strong>${w(Bi)}</strong><span>${q?.material?`${q.material.width} × ${q.material.height} px`:""}</span></div>${an.stage==="components"&&qn?.captured&&!q?.preview.isolation?'<p class="layering">Legacy region capture · may include overlapping components.</p>':""}${q?.context?.layering&&(Qe||cn)?`<p class="layering">${w(q.context.layering)}</p>`:""}
          <p class="component-note">${!ai?.related.length?w(q.note):""}</p>
          </div>`:""}</div><div class="review-form">${$e}${jn?'<p class="previous-notice">Viewing the previous round. Return to Current to make a decision.</p>':""}${m?`<div class="record-verdict"><strong>${tn?.action==="approve"?"Approved":tn?.action==="revise"?"Changes requested":"Not reviewed"}</strong><span>Submitted in round ${e.round} · read-only</span></div>`:`<div class="decisions" role="group" aria-label="Decision for ${w(p.name)}">${!d?`<div class="decision-title"><strong>Your review <span>Round ${e.round}</span></strong>${jn?"<p>Return to Current to review this round.</p>":""}</div>`:""}<button id="approve" ${!Un.length?"disabled":""} class="ks-button ks-button-primary decision-approve ${tn?.action==="approve"?"approved":""}" aria-pressed="${tn?.action==="approve"}">${d?k?"Sending…":`Approve & continue${An}`:Un.length>1?`Approve ${Un.length} instances`:"Looks good"}</button><button id="revise" ${!Un.length?"disabled":""} class="ks-button ks-button-secondary decision-revise ${tn?.action==="revise"?"revise":""}" aria-pressed="${tn?.action==="revise"}">${Un.length>1?`Revise ${Un.length} instances`:"Needs work"}</button>${tn&&!d&&!y?`<button id="clear" class="ks-icon-button" aria-label="Clear decision" title="Clear decision">${wn("undo")}</button>`:""}</div>`}
          ${P?`<form id="feedback-form"><div class="feedback-fields"><label class="feedback-field">What needs to change?<textarea id="feedback" aria-describedby="feedback-hint">${w(P.feedback)}</textarea></label><p id="feedback-hint" class="feedback-hint">Optional — leave blank for the agent to diagnose.</p>${!d?`<label class="check"><input id="split" type="checkbox" ${P.split?"checked":""}> Split into separately reviewable components</label>`:""}</div><div class="feedback-actions"><button id="cancel-feedback" type="button" class="ks-button ks-button-ghost">Cancel</button><button id="save-feedback" type="submit" class="ks-button ks-button-primary">${d?"Send feedback":Zi?"Save & finish review":"Save & next"}${An}</button><span class="shortcut-hint">${En}</span></div></form>`:tn?.action==="revise"?`<p class="saved-feedback">${w(tn.feedback||"No note — agent will diagnose.")}</p>`:""}
          ${d?`<p class="page-review-status" role="status">${w(j||(m?"Your decision is saved.":k?"Sending…":P?"":"Approval confirms the composition and that nothing is missing."))}</p>`:""}</div>`:c?`<p>This piece will be added to the unresolved inventory.</p><label class="feedback-field">Name<input id="missing-name" value="${w(c.name)}"></label><label class="feedback-field">What is missing?<textarea id="missing-feedback">${w(c.feedback)}</textarea></label><div class="coordinates">${["x","y","w","h"].map((n)=>`<label>${{x:"Left",y:"Top",w:"Width",h:"Height"}[n]} %<input type="number" data-coordinate="${n}" value="${Math.round(c.box[n]*1000)/10}" min="0" max="100" step="0.1"></label>`).join("")}</div><button id="remove-missing">Remove this mark</button></div>`:"<p>No components supplied.</p></div>"}
        </section>
      </div>
      ${!d?`<section class="inventory-section ${K?"":"tray-collapsed"} ${Vn&&K?"tray-expanded":""}" aria-label="Component inventory"><div class="section-head"><h2>Components</h2><div class="inventory-filters ks-instrument-strip is-paper" data-ks-strip="filter" role="group" aria-label="Filter components"><button type="button" class="ks-instrument-key" data-filter="pending" aria-pressed="${v==="pending"}">To review <b>${pe}</b></button><button type="button" class="ks-instrument-key" data-filter="reviewed" aria-pressed="${v==="reviewed"}">Reviewed <b>${Ni}</b></button><button type="button" class="ks-instrument-key" data-filter="all" aria-pressed="${v==="all"}">All <b>${u.length+t.missing.length}</b></button></div><div class="tray-actions"><button id="show-all" class="ks-icon-button" aria-pressed="${Vn}" aria-controls="component-tray" aria-label="${Vn?"Compact":"Expand"} tray" title="${Vn?"Compact":"Expand"} tray">${wn(Vn?"compact":"expand")}</button><button id="toggle-tray" class="ks-icon-button" aria-expanded="${K}" aria-controls="component-tray" aria-label="${K?"Hide":"Show"} component tray" title="${K?"Hide":"Show"} component tray">${wn(K?"hideTray":"showTray")}</button></div></div>
      <div id="component-tray" class="inventory ${Vn?"all":""}">${ii.map((n)=>{let l=u.find((kn)=>kn.members.some((sn)=>sn.id===n.id)),b=u.indexOf(l),E={kind:l.kind,label:l.stateLabel};return`<button class="item ${E.kind} ${!z&&x?.id===l.id?"active":""}" data-select="${w(n.id)}" aria-pressed="${!z&&x?.id===l.id}">${n.thumbnail?`<span class="item-thumb">${n.thumbnail.box?`<span class="thumb-crop" style="width:min(100%,${76*n.thumbnail.box.w*e.comp.width/(n.thumbnail.box.h*e.comp.height)}px);aspect-ratio:${n.thumbnail.box.w*e.comp.width}/${n.thumbnail.box.h*e.comp.height}"><img alt="" loading="lazy" src="${mn(n.thumbnail.url)}" style="position:absolute;width:${100/n.thumbnail.box.w}%;max-width:none;left:${-100*n.thumbnail.box.x/n.thumbnail.box.w}%;top:${-100*n.thumbnail.box.y/n.thumbnail.box.h}%;"></span>`:`<img alt="" loading="lazy" src="${mn(n.thumbnail.url)}">`}</span>`:""}<span class="item-number">${E.kind==="approved"?$n:E.kind==="feedback"?dn:""}${b+1}<span class="item-medium">${wn(Cn(n).code?"code":"image")}${w(Cn(n).label)}</span></span><strong>${w(_i(n.id))}${l.members.length>1?` <small>×${l.members.length}</small>`:""}</strong><span class="state ${E.kind}">${w(E.label)}</span></button>`}).join("")}${(v==="pending"?[]:t.missing).map((n,l)=>`<button class="item feedback ${g===n.id?"active":""}" data-select="${w(n.id)}"><span class="item-number">${u.length+l+1}</span><strong>${w(n.name)}</strong><span class="state revise">Missing</span></button>`).join("")}${!ii.length&&(v==="pending"||!t.missing.length)?`<p class="inventory-empty">${v==="pending"?"Nothing left to review. Your decisions are ready.":"No components reviewed yet."}</p>`:""}</div></section>`:""}
      ${d?"":m?`<footer class="record-footer"><span>Round ${e.round} submitted · read-only</span><span>${O.approved} approved · ${O.revisions} changes requested</span></footer>`:`<footer class="${!O.pending&&!_n?"queue-complete":""}"><div>${!O.pending&&!_n?`<button id="show-summary" class="completion-link">${$n}${m?"Review sent":"All components reviewed"}</button>`:""}<button id="approve-rest" class="ks-button ks-button-secondary" ${!O.pending?"hidden":""} ${!O.pending||_n?"disabled":""}>Approve ${O.approved||O.revisions?"remaining":"all"}</button><label class="check ks-checkbox"><input id="inventory-confirm" type="checkbox" ${t.inventoryConfirmed?"checked":""}> Nothing missing from the comp</label></div><div class="submit-area"><p role="status">${w(Li)}</p><button id="submit" class="ks-button ks-button-primary" ${!O.canSubmit||_n||k||m?"disabled":""}>${k?"Sending…":m?"Review sent":O.hasFeedback?"Send feedback":"Approve & continue"}${k||m?"":An}</button></div></footer>`}
    </section><dialog id="comparison-dialog" aria-label="${d?"Enlarged page comparison":"Enlarged component comparison"}"></dialog>`;let nn=a.querySelector("#comparison-dialog"),hn=a.querySelector(".comparison-panel"),Bn=a.querySelector(".comparison-slot"),Tn=a.querySelector(".inspector > .review-form"),Ai=a.querySelector(".inspector"),oi=()=>{if(nn.append(hn),Tn)nn.append(Tn)};if(G&&hn&&Bn)Bn.style.height=`${ke}px`,oi(),nn.showModal();if(jn)a.querySelectorAll(".decisions button,#feedback,#split,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#submit,#inventory-confirm").forEach((n)=>n.disabled=!0);if(a.querySelector(".inspection-content").scrollTop=Ye,m||k)a.querySelectorAll(".decisions button,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#mark,#inventory-confirm,#missing-name,#missing-feedback,#feedback,#split,#remove-missing,[data-coordinate]").forEach((n)=>n.disabled=!0);let ti=a.querySelector(".inventory");if(ti)ti.scrollLeft=Jn;if(!I&&K)Array.from(a.querySelectorAll(".inventory [data-select]")).find((n)=>n.dataset.select===g)?.scrollIntoView({block:"nearest",inline:"nearest"});if($)a.getElementById($)?.focus({preventScroll:!0});else if(U)Array.from(a.querySelectorAll(".item[data-select]")).find((n)=>n.dataset.select===U)?.focus({preventScroll:!0});let _=(n,l)=>a.querySelector(`#${n}`)?.addEventListener("click",l);function _e(n,l=!1,b=!1){if(h)return;if(!b)n=u.find((E)=>E.members.some((kn)=>kn.id===n))?.representative.id??n;if(X=!b,z=!1,g=n,B="component",on=!1,pn="fit",ln="isolated",D=!1,Y(),l)a.querySelector("#expand-comparison")?.click()}a.querySelectorAll("[data-select]").forEach((n)=>n.onclick=()=>_e(n.dataset.select,n.classList.contains("pin")&&e.components.some((l)=>l.id===n.dataset.select))),_("previous-round",()=>{D=!0,Y()}),_("current-round",()=>{D=!1,Y()}),_("review-changes",()=>{let n=f().filter((E)=>Ge(E).kind==="pending"),l=n.findIndex((E)=>E.id===g),b=n[(l+1)%n.length];if(b)X=!0,z=!1,g=b.id,B="component",v="pending",D=!1,pn="fit",on=!1,ln="isolated",Y()}),a.querySelectorAll("[data-filter]").forEach((n)=>n.onclick=()=>{v=n.dataset.filter,z=!O.pending&&v==="pending";let l=u.filter((E)=>v==="all"||E.kind==="pending"===(v==="pending")).map((E)=>E.representative);if(!(v!=="pending"&&t.missing.some((E)=>E.id===g))&&!l.some((E)=>E.id===g)&&l.length)X=!0,g=l[0].id,B="component",D=!1,pn="fit",on=!1,ln="isolated";Y()}),_("show-summary",()=>{z=!0,B="component",v="reviewed",Y(),fn("review-summary")}),_("approve",()=>ae("approve")),_("revise",Xn),_("clear",()=>{if(p)delete t.decisions[p.id],delete V[p.id];Q=null,z=!1,v="pending",Y()}),_("cancel-feedback",()=>{if(p)delete V[p.id];if(zn)K=!0,zn=!1;Y(),fn("revise")}),a.querySelector("#feedback-form")?.addEventListener("submit",(n)=>{n.preventDefault(),ae("revise")}),a.querySelector("#feedback")?.addEventListener("keydown",(n)=>{let l=n;if(l.key==="Enter"&&(l.metaKey||l.ctrlKey)&&!l.isComposing)l.preventDefault(),l.stopPropagation(),ae("revise")}),_("undo-decision",()=>{if(!Q||k||m)return;let n=Q;for(let[l,b]of Object.entries(n.previous))if(b)t.decisions[l]=b;else delete t.decisions[l];delete V[n.id],g=n.id,z=!1,D=!1,B="component",v="all",Q=null,Y(),fn("approve")}),_("all-instances",()=>{X=!0,g=x.representative.id,D=!1,Y()}),a.querySelectorAll("[data-instance]").forEach((n)=>n.onclick=()=>_e(n.dataset.instance,!1,!0)),_("overlay",()=>{on=!on,Y()}),_("isolated",()=>{ln="isolated",Y()}),_("context",()=>{ln="context",Y()}),a.querySelectorAll("[data-zoom]").forEach((n)=>n.addEventListener("click",()=>{let l=n.dataset.zoom;pn=l==="fit"?"fit":Number(l),Y()})),_("background-checker",()=>{en="checker",Y()}),_("background-page",()=>{en="page",Y()}),_("show-all",()=>{Vn=!Vn,K=!0,Y()}),_("toggle-tray",()=>{zn=!1,K=!K,Y()}),_("show-comp",()=>{B="comp",Y()}),_("show-component",()=>{B="component",Y()}),_("mark",()=>{h=!h,Y()}),_("add-box",()=>oe({x:0.35,y:0.35,w:0.2,h:0.2})),_("remove-missing",()=>{t.missing=t.missing.filter((n)=>n.id!==g),g=e.components[0]?.id,Y()}),_("approve-rest",()=>{if(_n)return;t=gi(e,t),Q=null,z=!0,v="reviewed",B="component",Y(),fn("review-summary")}),a.querySelector("#inventory-confirm")?.addEventListener("change",(n)=>{t.inventoryConfirmed=n.target.checked,Y()}),a.querySelector("#feedback")?.addEventListener("input",(n)=>{if(p&&V[p.id])V[p.id].feedback=n.target.value}),a.querySelector("#split")?.addEventListener("change",(n)=>{if(p&&V[p.id])V[p.id].split=n.target.checked}),a.querySelector("#missing-name")?.addEventListener("input",(n)=>{if(c)c.name=n.target.value;let l=a.querySelector("#submit");if(l)l.disabled=_n||k||m||!Sn(e,t).canSubmit}),a.querySelector("#missing-feedback")?.addEventListener("input",(n)=>{if(c)c.feedback=n.target.value}),a.querySelectorAll("[data-coordinate]").forEach((n)=>n.addEventListener("change",()=>{if(!c)return;let l=n.dataset.coordinate,b=Number(n.value)/100;if(Number.isFinite(b))c.box[l]=Math.max(l==="w"||l==="h"?0.001:0,Math.min(1,b));c.box.w=Math.min(c.box.w,1-c.box.x),c.box.h=Math.min(c.box.h,1-c.box.y),Y()})),_("submit",()=>{re()});let bn=a.querySelector(".map");function Ue(n){let l=bn.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(n.clientX-l.left)/l.width)),y:Math.max(0,Math.min(1,(n.clientY-l.top)/l.height))}}function si(n){let l=Ue(n);return e.components.filter(({box:b})=>l.x>=b.x&&l.x<=b.x+b.w&&l.y>=b.y&&l.y<=b.y+b.h).sort((b,E)=>b.box.w*b.box.h-E.box.w*E.box.h)[0]}bn?.addEventListener("click",(n)=>{if(h||n.target.closest("[data-select]"))return;let l=si(n);if(l)_e(l.id,!0)}),bn?.addEventListener("pointermove",(n)=>{if(!h)bn.style.cursor=si(n)?"zoom-in":""}),bn?.addEventListener("pointerdown",(n)=>{if(!h)return;vn=Ue(n),bn.setPointerCapture(n.pointerId),n.preventDefault()}),bn?.addEventListener("pointermove",(n)=>{if(!vn)return;let l=Ue(n);un={x:Math.min(vn.x,l.x),y:Math.min(vn.y,l.y),w:Math.abs(l.x-vn.x),h:Math.abs(l.y-vn.y)};let b=a.querySelector(".draw-box");b.hidden=!1,b.style.cssText=Nn(un)}),bn?.addEventListener("pointerup",()=>{if(un&&un.w>0.01&&un.h>0.01)oe(un);else vn=null,un=null}),bn?.addEventListener("pointercancel",()=>{vn=null,un=null,Y()});let pi=a.querySelector(".output"),ve=a.querySelector("iframe"),li=a.querySelector(".workbench"),Rn=a.querySelector(".inspection-content"),Le=a.querySelector(".inspector");function Be(){if(!Rn||!Le)return;Le.dataset.scrollAbove=String(Rn.scrollTop>1),Le.dataset.scrollBelow=String(Rn.scrollHeight-Rn.clientHeight-Rn.scrollTop>1)}Rn?.addEventListener("scroll",Be,{passive:!0});function ue(){let n=a.querySelector(".map-space");if(n&&n.clientWidth&&n.clientHeight){let Z=We(e.comp.width,e.comp.height,Math.max(1,n.clientWidth-32),Math.max(1,n.clientHeight-32),"fit");bn.style.width=`${Z.width}px`,bn.style.height=`${Z.height}px`}let l=a.querySelector(".inspection-content"),b=Array.from(a.querySelectorAll(".pan-viewport"));if(l?.clientHeight){let Z=G?Math.max(100,nn.clientHeight-(hn?.querySelector(".compare-toolbar")?.clientHeight??0)-(hn?.querySelector(".expanded-title")?.clientHeight??0)-(hn?.querySelector(".view-controls")?.clientHeight??0)-(Tn?.getBoundingClientRect().height??0)-124):Math.min(d?Number.POSITIVE_INFINITY:248,Math.max(100,l.clientHeight-((b[0]?.getBoundingClientRect().top??l.getBoundingClientRect().top)-l.getBoundingClientRect().top+l.scrollTop)-(hn?.querySelector(".view-controls")?.clientHeight??0)-12));b.forEach((F)=>F.style.height=`${Z}px`)}if(q&&b.length&&!y){let Z=We(q.box.w*an.comp.width,q.box.h*an.comp.height,Math.min(...b.map((F)=>F.clientWidth)),Math.min(...b.map((F)=>F.clientHeight)),pn);a.querySelectorAll(".crop-stage").forEach((F)=>{F.style.width=`${Z.width}px`,F.style.height=`${Z.height}px`})}if(b.forEach((Z)=>{let F=Z.scrollWidth>Z.clientWidth+1||Z.scrollHeight>Z.clientHeight+1;Z.classList.toggle("pannable",F),Z.style.cursor=G?"":"zoom-in",Z.setAttribute("role",G?"region":"button"),Z.title=G?F?"Move your pointer to pan. You can also scroll, swipe, or use arrow keys.":"":"Click to enlarge comparison"}),pi&&ve&&q){let Z=pi.clientWidth/(q.box.w*an.comp.width);ve.style.transform=`scale(${Z})`,ve.style.left=`${-q.box.x*an.comp.width*Z}px`,ve.style.top=`${-q.box.y*an.comp.height*Z}px`}let E=li.getBoundingClientRect(),kn=a.querySelector(".region"),sn=a.querySelector(".number"),ce=a.querySelector(".connector path");if(kn&&sn&&ce){let Z=kn.getBoundingClientRect(),F=sn.getBoundingClientRect(),be=Z.right-E.left,C=Z.top+Z.height/2-E.top,le=F.left-E.left-8,we=F.top+F.height/2-E.top;ce.setAttribute("d",`M ${be} ${C} H ${le-14} V ${we} H ${le}`)}}function Fn(n,l){if(!hn||!Bn||n===G)return;let b=a.querySelector("#expand-comparison"),E=(G?nn:hn).getBoundingClientRect(),kn=window.matchMedia("(prefers-reduced-motion: reduce)").matches,sn=hn.querySelector(".pan-viewport"),ce=sn?sn.scrollLeft/Math.max(1,sn.scrollWidth-sn.clientWidth):0,Z=sn?sn.scrollTop/Math.max(1,sn.scrollHeight-sn.clientHeight):0,F=()=>hn.querySelectorAll(".pan-viewport").forEach((C)=>{C.scrollLeft=ce*Math.max(0,C.scrollWidth-C.clientWidth),C.scrollTop=Z*Math.max(0,C.scrollHeight-C.clientHeight)}),be=()=>{if(Bn.append(hn),Tn)Ai.append(Tn),Tn.inert=!1;nn.close(),Bn.style.height="",yn=!1,G=!1,b.innerHTML=wn("expand"),b.setAttribute("aria-label","Enlarge comparison"),b.title="Enlarge comparison",b.setAttribute("aria-expanded","false"),ue(),F(),b.focus({preventScroll:!0}),l?.()};if(n){Bn.style.height=`${E.height}px`,oi(),nn.showModal(),G=!0,b.innerHTML=wn("compact"),b.setAttribute("aria-label","Restore comparison"),b.title="Restore comparison (Esc)",b.setAttribute("aria-expanded","true"),ue(),F(),b.focus({preventScroll:!0});let C=nn.getBoundingClientRect();if(!kn)nn.animate([{transform:`translate(${E.x-C.x}px,${E.y-C.y}px) scale(${E.width/C.width},${E.height/C.height})`,opacity:0.6},{transform:"none",opacity:1}],{duration:240,easing:"cubic-bezier(.2,.8,.2,1)"})}else{if(b.disabled)return;let C=Bn.getBoundingClientRect();if(kn){be();return}if(b.disabled=!0,yn=!0,Tn)Tn.inert=!0;let le=nn.animate([{transform:"none",opacity:1},{transform:`translate(${C.x-E.x}px,${C.y-E.y}px) scale(${C.width/E.width},${C.height/E.height})`,opacity:0.6}],{duration:200,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});nn.inert=!0;let we=()=>{if(le.cancel(),b.disabled=!1,nn.inert=!1,nn.isConnected)be();else yn=!1,G=!1,Y(),l?.()};le.finished.then(we,we)}}if(Zn=(n)=>Fn(!1,n),_("expand-comparison",()=>Fn(!G)),nn.addEventListener("cancel",(n)=>{n.preventDefault(),n.stopPropagation(),Fn(!1)}),nn.addEventListener("keydown",(n)=>{if(n.key==="Escape")n.preventDefault(),n.stopPropagation(),Fn(!1)}),In=Ve(a),rn=new ResizeObserver(()=>{ue(),Be()}),rn.observe(li),rn.observe(nn),Tn)rn.observe(Tn);let di=a.querySelector(".inspection-content");if(di)rn.observe(di);let xi=a.querySelector(".repair-context");if(xi)rn.observe(xi);let hi=hn?.querySelector(".compare-toolbar");if(hi)rn.observe(hi);ue();let fe=Array.from(a.querySelectorAll(".pan-viewport"));if(fe.forEach((n)=>{n.scrollLeft=r,n.scrollTop=s}),fe.forEach((n)=>{n.querySelectorAll("img").forEach((l)=>l.draggable=!1),n.addEventListener("click",()=>{if(!G)Fn(!0)}),n.addEventListener("pointermove",(l)=>{if(l.pointerType!=="mouse"||l.buttons||!n.classList.contains("pannable"))return;let b=n.getBoundingClientRect();n.scrollLeft=Ke(l.clientX,b.left,n.clientWidth,n.scrollWidth),n.scrollTop=Ke(l.clientY,b.top,n.clientHeight,n.scrollHeight)}),n.addEventListener("keydown",(l)=>{if(!G&&(l.key==="Enter"||l.key===" ")){l.preventDefault(),l.stopPropagation(),Fn(!0);return}let E={ArrowLeft:[-48,0],ArrowRight:[48,0],ArrowUp:[0,-48],ArrowDown:[0,48]}[l.key];if(!E)return;l.preventDefault(),l.stopPropagation(),n.scrollLeft+=E[0],n.scrollTop+=E[1]})}),fe.forEach((n)=>n.addEventListener("scroll",()=>{for(let l of fe)if(l!==n){if(l.scrollLeft!==n.scrollLeft)l.scrollLeft=n.scrollLeft;if(l.scrollTop!==n.scrollTop)l.scrollTop=n.scrollTop}})),te&&window.matchMedia("(max-width:800px)").matches){let n=a.querySelector(".inspection-content"),l=a.querySelector(".compare");if(n&&l)n.scrollTop+=l.getBoundingClientRect().top-n.getBoundingClientRect().top}if(Be(),window.scrollTo(A,W),!m)o.onDraftChange?.(structuredClone(t))}return Y(),{destroy(){rn?.disconnect(),In?.(),a.replaceChildren()},getDraft(){return structuredClone(t)}}}function Oi(){let i=document.createElement("style");i.textContent=[["Albert Sans","albertsans"],["Alumni Sans","alumnisans"],["JetBrains Mono","jetbrainsmono"]].map(([e,o])=>`@font-face{font-family:"${e}";src:url(/fonts/${o}.ttf);font-weight:100 900}`).join(""),document.head.append(i)}function Di(i){let e=document.createElement("div");e.setAttribute("role","alert"),e.style.cssText="max-width:560px;margin:18vh auto 0;padding:0 0 0 18px;border-left:2px solid oklch(52% 0.16 35);color:oklch(22% 0 0);font:400 15px/1.55 var(--font-sans,Arial,sans-serif)";let o=document.createElement("p");o.textContent="Review unavailable",o.style.cssText="margin:0 0 8px;font:400 11px/1.3 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:oklch(46% 0 0)";let a=document.createElement("strong");a.textContent="The review could not be opened.",a.style.cssText="display:block;font-weight:500;color:oklch(13% 0 0)";let t=document.createElement("p");t.style.cssText="margin:4px 0 18px;color:oklch(46% 0 0)",t.textContent=`${i} If the review server stopped, ask the agent to serve the review again, then reload.`;let d=document.createElement("button");return d.textContent="Reload",d.style.cssText="font:500 15px/1 var(--font-sans,Arial,sans-serif);min-height:44px;padding:0 22px;border:1px solid oklch(13% 0 0);border-radius:3px;background:oklch(13% 0 0);color:oklch(99.5% 0 0);cursor:pointer",d.onclick=()=>location.reload(),e.append(o,a,t,d),e}async function Ii(){Oi(),document.body.style.background="oklch(97.8% 0 0)";let i=document.getElementById("review"),e=await fetch("/packet",{cache:"no-store"});if(!e.ok)throw Error("The review packet could not be loaded.");let o=await e.json(),a=qe(o.packet);if(o.sourceStatus&&!a){let t=document.createElement("p");t.textContent=o.sourceStatus,i.before(t)}Qi(i,o.packet,{initialDraft:o.draft,history:o.history,completed:!!o.receipt,status:a?o.sourceStatus:null,onSubmit:async(t)=>{let d=await fetch("/decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)}),f=await d.json().catch(()=>({}));if(!d.ok)throw Error(f.error??"The review could not be saved. Try again.")}})}Ii().catch((i)=>{document.getElementById("review")?.replaceChildren(Di(i instanceof Error?i.message:String(i)))});})();
