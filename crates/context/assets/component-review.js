(()=>{function we(i,n){let o=n?.changes[i],a=n?.feedback?.[i],t=a?.decision??(n?.submitted?n.draft.decisions[i]:void 0),p=o?.kind==="unchanged"&&(o.carried??(n?.submitted&&t?.action==="approve"))===!0;return{change:o,prior:t,feedbackRound:a?.round??n?.packet.round,carried:p,label:o?.kind==="added"?"New component":o?.kind==="changed"?"Review again":p?"Approval kept":t?.action==="revise"?"Changes still requested":"Awaiting review"}}function bn(i,n,o){let a=n.decisions[i.id],t=a?.revision===i.revision?a:void 0,p=we(i.id,o);if(t?.action==="approve")return{kind:"approved",label:p.carried?"Approval kept":"Approved",priority:3};if(t?.action==="revise")return{kind:"feedback",label:"Feedback ready",priority:2};return{kind:"pending",label:p.change?.kind==="changed"?"Review again":p.change?.kind==="added"?"New · review needed":"Not reviewed",priority:p.change?.kind==="changed"||p.change?.kind==="added"?0:1}}function mi(i){return{packetRevision:i.revision,decisions:{},missing:[],inventoryConfirmed:!1}}function We(i){return Object.values(i).every(Number.isFinite)&&i.x>=0&&i.y>=0&&i.w>0&&i.h>0&&i.x+i.w<=1.00001&&i.y+i.h<=1.00001}function Cn(i,n){let o=i.components.map((g)=>n.decisions[g.id]?.revision===g.revision?n.decisions[g.id]:void 0),a=o.filter((g)=>g?.action==="approve").length,t=o.filter((g)=>g?.action==="revise").length,p=o.length-a-t,y=t>0||n.missing.length>0;return{approved:a,revisions:t,pending:p,hasFeedback:y,canSubmit:n.packetRevision===i.revision&&n.missing.every((g)=>g.name.trim()&&We(g.box))&&(y||!p&&n.inventoryConfirmed)}}function wi(i,n){let o={...n.decisions};for(let a of i.components)if(!o[a.id]||o[a.id].revision!==a.revision)o[a.id]={revision:a.revision,action:"approve",feedback:"",split:!1};return{...n,decisions:o}}function fi(i,n){if(!Cn(i,n).canSubmit)throw Error("Review is incomplete or stale");return{schemaVersion:1,requestId:i.id,...structuredClone(n)}}function Fn(i){let n=i.preview.kind==="page"||i.preview.sourceKind==="page",o=i.preview.sourceKind==="page";return{code:n,captured:o,label:n?i.medium.match(/html|css|svg/i)?i.medium:"HTML / CSS / SVG":"Raster",caption:n?o?i.preview.isolation?"Component only":"Region capture":"Live component":"Produced asset",fileLabel:o?"Open captured preview":"Open source image"}}function yi(i,n,o){let a=i.components.findIndex((t)=>t.id===o);for(let t=1;t<=i.components.length;t++){let p=i.components[(a+t)%i.components.length];if(bn(p,n).kind==="pending")return p.id}}function fe(i,n){if(!n.reviewGroup||!Fn(n).code)return[n];return i.components.filter((o)=>o.reviewGroup===n.reviewGroup&&Fn(o).code)}function pe(i,n,o,a,t=[]){let p=a?fe(i,o):[o];if(p.length===1)return[o];return p.filter((y)=>bn(y,n).kind==="pending"&&(y.id===o.id||!t.includes(y.id)))}function zi(i,n,o){let a=new Set;return i.components.flatMap((t)=>{if(a.has(t.id))return[];let p=fe(i,t);p.forEach((v)=>a.add(v.id));let y=p.filter((v)=>bn(v,n,o).kind==="pending"),g=p.filter((v)=>bn(v,n,o).kind==="feedback"),b=y[0]??g[0]??t,z=y.length?"pending":g.length?"feedback":"approved";return[{id:t.id,members:p,representative:b,pending:y.length,kind:z,label:p.length>1?t.reviewGroup.replace(/[-_]+/g," ").replace(/^./,(v)=>v.toUpperCase()):t.name,box:{x:Math.min(...p.map((v)=>v.box.x)),y:Math.min(...p.map((v)=>v.box.y)),w:Math.max(...p.map((v)=>v.box.x+v.box.w))-Math.min(...p.map((v)=>v.box.x)),h:Math.max(...p.map((v)=>v.box.y+v.box.h))-Math.min(...p.map((v)=>v.box.y))},stateLabel:y.length?p.length>1?`${y.length} to review`:bn(b,n,o).label:g.length?p.length>1?`${g.length} ${g.length===1?"needs":"need"} work`:"Feedback ready":"Approved"}]})}function ye(i,n){let o=new Set(n.preview.isolation?.excludedComponents??[]),a=n.box,t=i.components.filter((p)=>{if(p.id===n.id)return!1;if(o.has(p.id))return!0;let y=p.box,g=Math.min(a.x+a.w,y.x+y.w)-Math.max(a.x,y.x),b=Math.min(a.y+a.h,y.y+y.h)-Math.max(a.y,y.y);return y.w*y.h<a.w*a.h&&g*i.comp.width>1&&b*i.comp.height>1});return{description:n.note.trim(),related:t,excluded:t.filter((p)=>o.has(p.id))}}function Ie(i,n,o,a,t){let p=t==="fit"?Math.min(1,o/i,a/n):t;return{scale:p,width:i*p,height:n*p}}function Oe(i,n,o,a){if(o<=0||a<=o)return 0;return Math.max(0,Math.min(1,((i-n)/o-0.08)/0.84))*(a-o)}var ji=`
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
`;var Mi=`/* VENDORED from impeccable-site/site/styles/kinpaku-tokens.css (the source of truth).
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
`,Ti=`/* VENDORED from impeccable-site/site/styles/kinpaku-kit.css (buttons, tabs, select, icon button, instrument strip, grain, switch, paper strip, thumb) (the source of truth).
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
`,qi=`/* VENDORED from impeccable-site/site/styles/docs-kinpaku.css (the command rail list: the site's selected-row pattern) (the source of truth).
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
`;var Vi=`/* Local review chrome. Keep the vendored site kit and inspected artwork independent. */
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
`;var Ei=(i)=>i.replace(/^:root\s*\{/gm,":root, :host {"),ze=Ei(Mi)+`
`+Ei(Ti)+`
`+qi+`
`+Vi,Bn='<span class="ks-button-arrow" aria-hidden="true"><svg viewBox="0 0 16 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M0 4h14M10 0l4 4-4 4"/></svg></span>';var Yi=`
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
`+ji+`
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
`+ze+`
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
`;var rr={chevronDown:'<path d="m6 9 6 6 6-6"/>',code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',compact:'<path d="M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',hideTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12 3 3 2 3-2"/>',showTray:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18m-12-4 3-3 3 3"/>',next:'<path d="M5 12h14m-6-6 6 6-6 6"/>',mark:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5M8 12h8m-4-4v8"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',undo:'<path d="M4 10h9a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" transform="translate(0 -2)"/>',external:'<path d="M14 3h7v7m0-7L10 14m0-10H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',zoom:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'};function fn(i){return`<svg class="utility-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${rr[i]}</svg>`}var De=[{kind:"plate",label:"Illustration / plate",hint:"Painted or drawn artwork"},{kind:"image",label:"Photo / image",hint:"A photograph"},{kind:"texture",label:"Texture",hint:"A surface or material"}];function Me(i){let n=i;return!!n&&n.schemaVersion===3&&n.stage==="components"}function Re(i){return i.role==="plan"&&(!!i.flags?.length||!!i.codeDrawn)}function Fe(i){let n=(o)=>Re(o)?0:o.role==="asset"?1:2;return i.components.map((o,a)=>({c:o,i:a})).sort((o,a)=>n(o.c)-n(a.c)||o.i-a.i).map((o)=>o.c)}function Te(i){let n=new Set(i.components.map((o)=>o.id));return(i.codeRegions??[]).filter((o)=>!n.has(o.id))}function zn(i,n){let o=n.decisions[i.id];return o?.revision===i.revision?o:void 0}function yn(i,n){let o=zn(i,n);return o?o.action==="approve"?"approved":o.action:"pending"}function qe(i,n){return i.reclassify?.find((o)=>o.id===n)}function Ce(i){let n=[i.name,i.note,...(i.flags??[]).map((o)=>o.message)].join(" ");if(/\b(textures?|surfaces?|grain|grainy|brushed|metal(lic)?|steel|brass|copper|paper|linen|canvas|fabric|cloth|wood(en)?|stone|marble|concrete|plaster|leather|noise|pattern(ed)?|weave|patina)\b/i.test(n))return"texture";if(/\b(photo|photos|photograph|photographs|photographic|photography)\b/i.test(n)&&!/\bphotographic shading\b/i.test(n))return"image";return"plate"}function Ji(i){return`Drawn in code (${i.kind})`}function Pe(i){return i.message}function Pn(i,n){let o=i.components.map((m)=>yn(m,n)),a=o.filter((m)=>m==="approved").length,t=o.filter((m)=>m==="revise").length,p=new Set(Te(i).map((m)=>m.id)),y=(n.reclassify??[]).filter((m)=>p.has(m.id)).length,g=o.filter((m)=>m==="reclassify").length+y,b=o.filter((m)=>m==="pending").length,z=n.missing.length,v=t+g+z>0,w=n.packetRevision===i.revision,M=n.missing.every((m)=>m.name.trim()&&We(m.box)),u=w&&!v&&b===0;return{total:o.length,approved:a,revise:t,reclassify:g,pending:b,missing:z,hasChanges:v,canApprove:u,mode:v?"changes":"approve",canSubmit:w&&M&&(v||u)}}function Se(i,n,o,a={}){if(a.split&&!(o==="revise"&&n.role==="asset"))throw Error("Only a generated asset can be split into layers");if(o==="revise"&&n.role!=="asset"&&!(a.feedback??"").trim())throw Error("Revising a plan item needs feedback");if(o==="reclassify"&&n.role!=="plan")throw Error("Only planned code can become an image");let t={revision:n.revision,action:o,feedback:o==="approve"?"":(a.feedback??"").trim(),split:!!a.split};if(o==="reclassify")t.kind=a.kind??Ce(n);return{...i,inventoryConfirmed:!1,decisions:{...i.decisions,[n.id]:t}}}function $i(i,n){let o={...i.decisions};return delete o[n],{...i,inventoryConfirmed:!1,decisions:o}}function ni(i,n,o){let a=(i.reclassify??[]).filter((t)=>t.id!==n);return{...i,inventoryConfirmed:!1,reclassify:o?[...a,{id:n,kind:o.kind,feedback:(o.feedback??"").trim()}]:a}}function Gi(i,n){let o=Pn(i,n);if(!o.canSubmit)throw Error("Review is incomplete or stale");let a={};for(let y of i.components){let g=zn(y,n);if(g)a[y.id]=structuredClone(g)}let t=new Set(Te(i).map((y)=>y.id)),p=(n.reclassify??[]).filter((y)=>t.has(y.id)).map((y)=>({...y}));return{schemaVersion:1,requestId:i.id,packetRevision:n.packetRevision,decisions:a,missing:structuredClone(n.missing),inventoryConfirmed:o.mode==="approve",...p.length?{reclassify:p}:{}}}function Qi(i){return{packetRevision:i.revision,decisions:{},missing:[],inventoryConfirmed:!1,reclassify:[]}}function Zi(i,n,o,a,t=0.02){let p=Math.max(0,Math.floor((a.x-t)*n)),y=Math.min(n-1,Math.ceil((a.x+a.w+t)*n)),g=Math.max(0,Math.floor((a.y-t)*o)),b=Math.min(o-1,Math.ceil((a.y+a.h+t)*o)),z=Math.floor(a.x*n),v=Math.ceil((a.x+a.w)*n),w=Math.floor(a.y*o),M=Math.ceil((a.y+a.h)*o),u=[],m=Math.max(1,Math.round(Math.max(y-p,b-g)/80));for(let Q=g;Q<=b;Q+=m)for(let Z=p;Z<=y;Z+=m){if(Z>=z&&Z<v&&Q>=w&&Q<M)continue;let dn=(Q*n+Z)*4;if(i[dn+3]<200)continue;u.push([i[dn],i[dn+1],i[dn+2]])}return u}function Ui(i){if(!i.length)return;let n=(o)=>{let a=i.map((t)=>t[o]).sort((t,p)=>t-p);return a[a.length>>1]};return"#"+[0,1,2].map((o)=>n(o).toString(16).padStart(2,"0")).join("")}function ei(i,n,o,a,t,p=4,y=24){let g=i.w*n,b=i.h*o,z=Math.min(24,Math.max(8,0.04*Math.max(g,b))),v=Math.min(n,g+z*2),w=Math.min(o,b+z*2),M=Math.min(p,a/v,t/w);if(b*M<y&&b>0)M=Math.min(p,y/b,t/w),v=Math.min(v,a/M);let u=(i.x+i.w/2)*n,m=(i.y+i.h/2)*o,Q=Math.max(0,Math.min(n-v,u-v/2)),Z=Math.max(0,Math.min(o-w,m-w/2));return{scale:M,width:v*M,height:w*M,view:{x:Q/n,y:Z/o,w:v/n,h:w/o}}}var ar=["no","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"],je=(i)=>ar[i]??String(i),Xi=(i)=>i[0].toUpperCase()+i.slice(1);function Ai(i,n,o){let a=i.components.filter((p)=>yn(p,n)==="pending").length;if(o&&i.round>1){let p=i.components.filter((g)=>["changed","added"].includes(o.changes[g.id]?.kind??"")||o.feedback?.[g.id]).length,y=i.components.filter((g)=>yn(g,n)==="approved").length;return`The agent worked on your notes for ${je(p)} ${p===1?"item":"items"}. ${Xi(je(y))} ${y===1?"approval is":"approvals are"} kept.`}let t=Math.max(1,Math.round(a*15/60));return`${Xi(je(a))} ${a===1?"thing":"things"} to check before any page code is written. About ${je(t)} ${t===1?"minute":"minutes"}.`}var Li="Frame, view and moving parts as separate pieces, e.g. the shutters.";function ii(i){return i.role==="asset"?i.flags??[]:[]}var ri=(i)=>ii(i).some((n)=>n.id==="baked-composite"),ai=(i)=>i?.action==="revise"&&i.split===!0;function Ve(i,n){if(!n)return null;let o=n.feedback?.[i]?void 0:Object.entries(n.feedback??{}).filter(([g,b])=>b.decision.action==="revise"&&b.decision.split&&i.startsWith(`${g}-`)).sort((g,b)=>b[0].length-g[0].length)[0];if(o){let[g,b]=o;return{round:b.round,action:"split",words:(b.decision.feedback??"").trim(),splitFrom:n.packet.components.find((z)=>z.id===g)?.name??g,beforeUrl:void 0,wasCode:!1,wasKind:void 0,wasNote:""}}let a=n.feedback?.[i],t=n.packet.components.find((g)=>g.id===i),p=n.packet.codeRegions?.find((g)=>g.id===i),y=n.changes[i]?.kind;if(!a&&y!=="changed")return null;return{round:a?.round??n.packet.round,action:a?.decision.action,words:(a?.decision.feedback??"").trim(),beforeUrl:t?.role==="asset"?t.preview.url:void 0,wasCode:t?.role==="plan"||!t&&!!p,wasKind:t?.kind??p?.kind,wasNote:t?.note??p?.note??"",splitFrom:void 0}}function Ni(i,n,o,a,t,p=4,y){let g=i.length,b=Math.max(0,Math.min(o-t,(n-a*(g-1))/i.reduce((M,u)=>M+u,0))),z=Math.max(0,Math.min(n,(o-g*t-a*(g-1))/i.reduce((M,u)=>M+1/u,0)));if(y)b=Math.min(b,y.h*p),z=Math.min(z,y.w*p);let v=i.reduce((M,u)=>M+u*b*b,0),w=i.reduce((M,u)=>M+z*z/u,0);return v>=w?{direction:"row",sizes:i.map((M)=>({w:M*b,h:b}))}:{direction:"column",sizes:i.map((M)=>({w:z,h:z/M}))}}function Ki(i,n,o,a,t,p){return{x:t-i*o*p,y:t-n*a*p}}function _i(i,n,o){return Fe(i).map((a)=>({id:a.id,name:a.name,state:yn(a,n),current:a.id===o}))}function Bi(i,n){let o=Pn(i,n);if(o.mode==="approve")return"Approve plan and assets";let a=i.components.filter((y)=>ai(zn(y,n))).length,t=o.revise-a;return`Send notes (${[t?`${t} ${t===1?"note":"notes"}`:"",a?`${a} to split`:"",o.reclassify?`${o.reclassify} to become ${o.reclassify===1?"an image":"images"}`:"",o.missing?`${o.missing} missing`:""].filter(Boolean).join(", ")})`}var Hi=ze+`
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
`;var Wi=new Map;function Ee(i){let n=i.querySelector('.ks-instrument-key:is(.is-active, [aria-selected="true"], [aria-pressed="true"])');if(!n){if(i.classList.contains("has-thumb"))i.classList.remove("has-thumb");return}let o=i.getBoundingClientRect(),a=n.getBoundingClientRect();if(!o.width)return;let t=getComputedStyle(i),p=o.width/parseFloat(t.width)||1,y=parseFloat(t.borderLeftWidth)||0,g=Math.round(((a.left-o.left)/p-y+i.scrollLeft)*100)/100,b=Math.round(a.width/p*100)/100,z=i.querySelector(":scope > .ks-thumb"),v=i.dataset.ksStrip;if(!z){z=document.createElement("span"),z.className="ks-thumb",z.setAttribute("aria-hidden","true"),i.appendChild(z);let M=v?Wi.get(v):void 0;if(M&&(M.x!==g||M.w!==b))z.style.transition="none",z.style.width=`${M.w}px`,z.style.transform=`translateX(${M.x}px)`,z.offsetWidth,z.style.transition=""}if(v)Wi.set(v,{x:g,w:b});if(z.style.width!==`${b}px`)z.style.width=`${b}px`;let w=`translateX(${g}px)`;if(z.style.transform!==w)z.style.transform=w;if(!i.classList.contains("has-thumb"))i.classList.add("has-thumb")}function or(i,n,o){if(i.dataset.thumb)return;i.dataset.thumb="1",Ee(i);let a=new MutationObserver((M)=>{if(M.some((u)=>u.target!==i&&!u.target.classList?.contains("ks-thumb")))Ee(i)});a.observe(i,{subtree:!0,attributes:!0,attributeFilter:["class","aria-selected","aria-pressed"],childList:!0});let t=new ResizeObserver(()=>Ee(i));t.observe(i);let p=null,y=!1,g=0,b=null,z=(M,u)=>n.elementFromPoint(M,u)?.closest(".ks-instrument-key")??null;i.addEventListener("pointerdown",(M)=>{if(!["mouse","pen"].includes(M.pointerType)||!M.isPrimary||M.button!==0||p!==null)return;p=M.pointerId,y=!1,g=M.clientX,b=z(M.clientX,M.clientY)}),i.addEventListener("pointermove",(M)=>{if(M.pointerId!==p)return;if(!y&&Math.abs(M.clientX-g)<6)return;y=!0;let u=z(M.clientX,M.clientY);if(u&&u!==b&&i.contains(u))b=u,u.click()});let v=()=>{p=null,y=!1,b=null},w=(M)=>{if(M.pointerId===p)v()};window.addEventListener("pointerup",w),window.addEventListener("pointercancel",w),window.addEventListener("blur",v),o.push(()=>{a.disconnect(),t.disconnect(),window.removeEventListener("pointerup",w),window.removeEventListener("pointercancel",w),window.removeEventListener("blur",v)})}function Ye(i){let n=[];return i.querySelectorAll(".ks-instrument-strip").forEach((o)=>or(o,i,n)),document.fonts?.ready.then(()=>i.querySelectorAll(".ks-instrument-strip").forEach(Ee)),()=>n.forEach((o)=>o())}var Y=(i)=>i.replace(/[&<>"']/g,(n)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]),Xe=(i)=>`${i*100}%`,Hn=(i)=>{let n=new URL(i,location.href);if(!["http:","https:"].includes(n.protocol))throw Error("Unsupported preview URL");return Y(n.href)},Sn=(i)=>`left:${Xe(i.x)};top:${Xe(i.y)};width:${Xe(i.w)};height:${Xe(i.h)}`,Ii=(i)=>`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${i}</svg>`,Je={check:Ii('<path d="m3 8.5 3 3 7-7"/>'),alert:Ii('<path d="M8 2 1.5 13.5h13L8 2Z"/><path d="M8 6.5v3.2M8 11.6v.1"/>')},jn=(i)=>`<kbd class="cap">${i}</kbd>`,An={plate:"illustration",image:"photo",texture:"texture"};function tr(i){let n=i.match(/^review is stale:\s*(.+?)\s+changed\b/i);if(n)return`${n[1]} changed after this round was prepared.`;let o=i.replace(/;?\s*prepare a new round\.?\s*$/i,"").trim();return o?`${o[0].toUpperCase()}${o.slice(1)}${/[.!?]$/.test(o)?"":"."}`:""}var Oi={get(i){try{return localStorage.getItem(i)}catch{return null}},set(i,n){try{localStorage.setItem(i,n)}catch{}}};function Di(i,n,o){let a=i.shadowRoot??i.attachShadow({mode:"open"}),t={...Qi(n),...structuredClone(o.initialDraft??{})};t.reclassify??=[];let p=Fe(n),y=Te(n),g=o.history??null,b=new URLSearchParams(location.search),z=!!o.completed,v=z?"summary":["intro","stage","summary"].includes(b.get("view")??"")?b.get("view"):"intro",w=(b.get("item")&&p.some((r)=>r.id===b.get("item"))?b.get("item"):void 0)??p.find((r)=>yn(r,t)==="pending")?.id??p[0]?.id,M=null,u=null,m=null,Q=!1,Z=!1,dn=!1,xn={},U=!1,Qn=!1,Yn="",W=null,en=()=>W?`<p class="hint undo-line" role="status">${Y(W.label)} <button type="button" class="text-action" id="undo">Undo${jn("⌘Z")}</button></p>`:"",Tn=Oi.get("impeccable.review.flipHint")==="1",I=null,Wn=null,ln=new Map,Xn=new Map,C=null,qn=()=>matchMedia("(prefers-reduced-motion: reduce)").matches,rn=(r)=>n.components.find((s)=>s.id===r),Nn=(r)=>y.find((s)=>s.id===r),N=()=>z||U||!!o.status,hn=(r)=>r.w*n.comp.width/(r.h*n.comp.height),an=new Image;an.onload=()=>{try{let r=Math.min(1,480/an.naturalWidth),s=document.createElement("canvas");s.width=Math.max(1,Math.round(an.naturalWidth*r)),s.height=Math.max(1,Math.round(an.naturalHeight*r));let l=s.getContext("2d",{willReadFrequently:!0});if(l.drawImage(an,0,0,s.width,s.height),C={data:l.getImageData(0,0,s.width,s.height).data,width:s.width,height:s.height},v==="stage")A()}catch{}},an.src=new URL(n.comp.url,location.href).href;function ne(r){if(!Xn.has(r.id)&&C)Xn.set(r.id,Ui(Zi(C.data,C.width,C.height,r.box))??"");return Xn.get(r.id)||n.comp.background||"var(--review-media-deep)"}function Zn(r,s){if(r.material?.alpha==="transparent")return!0;if(r.material?.alpha==="opaque")return!1;if(ln.has(s))return ln.get(s);if(ln.set(s,!1),!/\.(png|webp)(\?|$)/i.test(s))return!1;let l=new Image;return l.onload=()=>{try{let h=Math.min(1,160/Math.max(l.naturalWidth,l.naturalHeight)),f=document.createElement("canvas");f.width=Math.max(1,Math.round(l.naturalWidth*h)),f.height=Math.max(1,Math.round(l.naturalHeight*h));let k=f.getContext("2d",{willReadFrequently:!0});k.drawImage(l,0,0,f.width,f.height);let x=k.getImageData(0,0,f.width,f.height).data;for(let c=3;c<x.length;c+=4)if(x[c]<250){if(ln.set(s,!0),v==="stage")A();break}}catch{}},l.src=new URL(s,location.href).href,!1}function on(r,s,l="fade"){if(s)w=s;if(M=qn()?null:l,v=r,u=null,dn=!1,Z=!1,r!=="summary")m=null,Q=!1;A();let h=r==="intro"?"start":r==="stage"?"decide-yes":"send";a.getElementById(h)?.focus({preventScroll:!0})}function ee(r){if(v!=="stage"||!p.length)return;let s=p.findIndex((l)=>l.id===w)+r;if(s>=p.length)return on("summary",void 0,"next");if(s<0)return;on("stage",p[s].id,r>0?"next":"prev")}function In(r,s){if(W)clearTimeout(W.timer);W={label:r,before:s,view:v,current:w,timer:window.setTimeout(()=>{W=null,a.querySelector(".undo-line")?.classList.add("gone")},6000)}}function Un(r,s){let l=t;t=r,u=null,Yn="",In(s,l)}function Jn(){let r=p.findIndex((l)=>l.id===w),s=[...p.slice(r+1),...p.slice(0,r+1)].find((l)=>yn(l,t)==="pending");if(s)on("stage",s.id,"next");else on("summary",void 0,"next")}function le(){let r=rn(w);if(v!=="stage"||!r||N()||u)return;Un(Se(t,r,"approve"),`${r.role==="asset"?"Approved":"Kept in code"}: ${r.name}.`),Jn()}function $n(r,s,l=!1){if(N())return;let h=s?Nn(s):void 0,f=h?void 0:rn(w),k=f??h;if(!k||f&&r==="reclassify"&&f.role!=="plan")return;let x=f?zn(f,t):void 0,c=h?qe(t,h.id):void 0,V=x?.action===r&&!!x.split===l;u={type:r,split:l,id:k.id,region:!!h,text:V?x.feedback:l?Li:c?.feedback??"",kind:x?.kind??c?.kind??Ce({name:k.name,note:k.note??"",flags:f?.flags})},A(),a.getElementById("form-text")?.focus()}function On(){if(!u||N())return;let r=u;if(r.region){let l=Nn(r.id);Un(ni(t,l.id,{kind:r.kind,feedback:r.text}),`${l.name} will become ${An[r.kind]}.`),A();return}let s=rn(r.id);if(r.type==="revise"&&s.role==="plan"&&!r.text.trim()){a.getElementById("form-text")?.focus();return}Un(Se(t,s,r.type,{feedback:r.text,kind:r.kind,split:r.split}),r.split?`Split into layers: ${s.name}.`:r.type==="revise"?`Noted: ${s.name}.`:`${s.name} will become ${An[r.kind]}.`),Jn()}function de(){if(!W||N())return;let r=W;clearTimeout(r.timer),W=null,t=r.before,on(r.view,r.current,"prev")}async function ie(){let r=Pn(n,t);if(U||z||u||!r.canSubmit||o.status)return;U=!0,Yn="",A();try{await o.onSubmit(Gi(n,t)),z=!0,Qn=!0,Q=!1,W=null}catch(s){Yn=s instanceof Error?s.message:"The review could not be saved."}finally{U=!1,A()}}function G(r){let s=`missing-${crypto.randomUUID()}`;t={...t,inventoryConfirmed:!1,missing:[...t.missing,{id:s,name:"",feedback:"",box:r}]},Q=!1,m={type:"missing",id:s},A(),a.getElementById("missing-name")?.focus()}let X=(r)=>{let s=yn(r,t);if(s==="approved")return r.role==="asset"?"Looks good":"Code is fine";if(s==="revise")return ai(zn(r,t))?"Split into layers":"Needs work";if(s==="reclassify")return`Becomes ${An[zn(r,t).kind]}`;return z?"Not decided":"To decide"},J=(r,s="")=>`<span class="pic crop ${s}"><img src="${Hn(n.comp.url)}" alt="" draggable="false" style="width:${100/r.w}%;left:${-100*r.x/r.w}%;top:${-100*r.y/r.h}%"></span>`,K=(r,s,l="gen")=>{let h=Zn(r,s),f=xn[r.id]??"comp",k=!h?"":f==="light"?"var(--review-media-raised)":f==="dark"?"var(--ks-instrument)":ne(r);return`<span class="pic ${l}" style="${k?`background:${Y(k)}`:""}"><img src="${Hn(s)}" alt="" draggable="false"></span>`};function H(r){return[...r.code?y.map((l)=>({kind:"region",id:l.id,name:l.name,box:l.box,cls:`code ${qe(t,l.id)?"reclassify":""}`})):[],...n.components.map((l)=>({kind:"item",id:l.id,name:l.name,box:l.box,cls:`is-${l.role} ${Re(l)||ri(l)?"flagged":""} ${yn(l,t)}`})),...t.missing.map((l)=>({kind:"missing",id:l.id,name:l.name||"Missing",box:l.box,cls:"missing"}))].sort((l,h)=>h.box.w*h.box.h-l.box.w*l.box.h).map((l)=>{let h=m?.id===l.id||Z&&v==="stage"&&l.id===w,f=`<span class="tag">${Y(l.name)}</span>`;return r.interactive?`<button type="button" class="region ${l.cls} ${h?"selected":""} ${l.box.y<0.06?"tag-below":""} ${l.box.x>0.7?"tag-right":""}" style="${Sn(l.box)}" data-${l.kind}="${Y(l.id)}" aria-label="${Y(l.name)}">${f}</button>`:`<span class="region ${l.cls}" style="${Sn(l.box)}"></span>`}).join("")}function R(){let r=_i(n,t,v==="stage"?w:void 0),s=r.filter((l)=>l.state!=="pending").length;return`<header class="bar">
      <div class="bar-title"><span class="bar-name">${Y(n.title)}</span><span class="bar-round">Round ${n.round}</span></div>
      ${p.length?`<nav class="lights ${r.length>20?"dense":""}" aria-label="Progress, ${s} of ${r.length} decided">${r.map((l,h)=>`<button type="button" class="light ${l.state==="pending"?"":"decided"} ${l.current?"current":""}" data-go="${Y(l.id)}" aria-label="${Y(`${h+1}. ${l.name}: ${X(rn(l.id))}`)}" ${l.current?'aria-current="step"':""}><span class="tip">${Y(l.name)}${l.state==="pending"?"":`<span class="tip-state"> · ${Y(X(rn(l.id)))}</span>`}</span></button>`).join("")}<button type="button" class="lights-summary ${v==="summary"?"current":""}" id="to-summary">Summary</button></nav>`:""}
      ${v==="stage"?`<button type="button" class="bar-locator" id="open-map-bar" aria-label="Open the comp">${J({x:0,y:0,w:1,h:1})}</button>`:""}
    </header>`}function Gn(){if(o.status)return`<div class="banner stale" role="alert">${Je.alert}<div><strong>This review is out of date.</strong><p>${Y(tr(o.status))} Ask the agent to prepare a new round, then reload this page.</p></div><button id="reload" class="ks-button ks-button-secondary">Reload</button></div>`;if(Yn)return`<div class="banner error" role="alert">${Je.alert}<div><strong>Your decisions were not sent.</strong><p>${Y(Yn)}</p></div><button id="retry" class="ks-button ks-button-secondary">Try again</button></div>`;return""}function P(){let r=!!g&&n.round>1;return`<div class="intro ${M?`enter-${M}`:""}">
      <div class="intro-copy">
        <p class="eyebrow">${r?`Round ${n.round}`:"Before any page code"}</p>
        <h1>${r?"Check what changed.":"Review the plan and assets."}</h1>
        <p class="lead">${Y(Ai(n,t,g))}</p>
        <dl class="kinds-explained">
          <div><dt><i class="swatch asset"></i>A generated image</dt><dd>Does it match the comp?</dd></div>
          <div><dt><i class="swatch plan"></i>A region drawn in code</dt><dd>Can code do it justice, or should it be an image?</dd></div>
        </dl>
        <button type="button" class="ks-button ks-button-primary" id="start">Start${jn("↵")}${Bn}</button>
      </div>
      <figure class="intro-comp"><div class="map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img class="comp" src="${Hn(n.comp.url)}" alt="The approved comp" draggable="false">${H({code:!1,interactive:!1})}</div></figure>
    </div>`}function re(r){let s=Ve(r.id,g),l=hn(r.box),h=`${r.box.w*n.comp.width}x${r.box.h*n.comp.height}`;if(r.role==="asset"&&r.preview.url){let f=r.preview.url,k=Zn(r,f),x=xn[r.id]??"comp",c=k?`<button type="button" class="ks-switch backdrop-switch" id="backdrop" aria-pressed="${x!=="comp"}" title="Backdrop behind the transparent image"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">${x==="comp"?"On comp colour":x==="light"?"On light":"On dark"}</span></button>`:"",V=`<figure class="fig" data-role="generated"><figcaption><span class="eyebrow">${dn?"In the comp":s?.beforeUrl?"After":"Generated"}</span>${c}</figcaption><div class="frame ${dn?"flipped":""}">${K(r,f)}${J(r.box,"flip")}</div></figure>`,O=`<figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${J(r.box)}</div></figure>`;if(s?.beforeUrl){let L=`<figure class="fig"><figcaption><span class="eyebrow">Before · round ${s.round}</span></figcaption><div class="frame">${K(r,s.beforeUrl,"gen before")}</div></figure>`;return`<div class="figures" data-ratios="${l},${l},${l}" data-natural="${h}">${L}${V}${O}</div>`}return`<div class="figures" data-ratios="${l},${l}" data-natural="${h}">${O}${V}</div>`}if(r.role==="asset")return'<div class="figures empty"><p>This image has no generated file.</p></div>';return`<div class="figures single" data-box="${Y(JSON.stringify(r.box))}"><figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${J(r.box)}<span class="focus-box"></span></div></figure></div>`}function $e(r){if(z)return`<div class="decide-bar"><p class="record">${Y(X(r))}${zn(r,t)?.feedback?`: “${Y(zn(r,t).feedback)}”`:"."}</p></div>`;if(u&&!u.region){let h=u.type==="reclassify",f=!h&&r.role==="plan",k=!!u.split;return`<form class="decide-bar form" id="decision-form">
        ${h?`<div class="form-row"><span class="eyebrow" id="kinds-label">Make it</span><div class="ks-instrument-strip is-paper" data-ks-strip="kind" role="group" aria-labelledby="kinds-label">${De.map((x)=>`<button type="button" class="ks-instrument-key" data-kind="${x.kind}" aria-pressed="${u.kind===x.kind}">${x.label}</button>`).join("")}</div></div>`:""}
        <label class="field"><span class="eyebrow">${h?"Anything the image should keep? Optional":k?"How should it come apart? Edit or keep":f?"What should change?":"What needs to change? Optional"}</span><textarea id="form-text" rows="2" placeholder="${h?"For example: keep the brushed direction horizontal.":f?"For example: extend the hero photo under the nav.":"For example: the figure should face the sea."}">${Y(u.text)}</textarea></label>
        <div class="form-actions"><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel${jn("Esc")}</button><button type="submit" class="ks-button ks-button-primary">${h?"Make it an image":k?"Split into layers":"Save note"}${jn("⌘↵")}</button></div>
      </form>`}let s=zn(r,t),l=r.role==="asset";return`<div class="decide-bar">
      ${s?`<p class="current-decision">${s.action==="approve"?Je.check:""}<span>${Y(X(r))}${s.feedback?`: “${Y(s.feedback)}”`:"."}</span><button type="button" class="text-action" id="decision-clear">Clear</button></p>`:""}
      <div class="decisions">
        <button type="button" id="decide-yes" class="ks-button ks-button-primary">${l?"Looks good":"Code is fine"}${jn("A")}</button>
        <button type="button" id="decide-no" class="ks-button ks-button-secondary">${l?"Needs work":"Make it an image"}${jn("N")}</button>
        ${l?`<button type="button" id="decide-split" class="ks-button ${ri(r)?"ks-button-secondary":"ks-button-ghost"}">Split into layers${jn("S")}</button>`:`<button type="button" id="decide-other" class="ks-button ks-button-ghost">Something else…${jn("F")}</button>`}
      </div>
    </div>`}function Ge(){let r=rn(w);if(!r)return'<div class="stage"><p>Nothing to review.</p></div>';let s=p.findIndex((x)=>x.id===r.id)+1,l=Ve(r.id,g),h=r.role==="plan"?[...(r.flags??[]).map(Pe),...r.codeDrawn?["The plan draws this artwork in code."]:[]]:ii(r).map(Pe),f=(r.note??"").trim(),k=r.role==="plan"?`<p class="sentence"><strong>Will be drawn in code:</strong> ${Y(f||Ji(r).toLowerCase())}</p>`:l?.wasCode?`<p class="sentence"><s>Was going to be drawn in code: ${Y(l.wasNote)}</s> Now a generated ${Y(An[r.kind]??r.kind)}.</p>`:f?`<p class="sentence muted">${Y(f)}</p>`:"";return`<div class="stage ${r.role==="plan"?"is-single":""} ${M?`enter-${M}`:""}">
      <div class="stage-head">
        <p class="eyebrow">${r.role==="asset"?`Generated ${Y(An[r.kind]??r.kind)}`:`Drawn in code · ${Y(r.kind)}`} · ${s} of ${p.length}</p>
        <h1>${Y(r.name)}</h1>
        ${l?.splitFrom?`<blockquote class="asked"><span class="eyebrow">A layer of ${Y(l.splitFrom)} · you asked to split it in round ${l.round}</span>${l.words?`<p>“${Y(l.words)}”</p>`:""}</blockquote>`:l?.words?`<blockquote class="asked"><span class="eyebrow">You asked in round ${l.round}</span><p>“${Y(l.words)}”</p></blockquote>`:""}
      </div>
      ${re(r)}
      <div class="stage-foot">
        ${k}
        ${h.map((x)=>`<p class="flag">${Y(x)}</p>`).join("")}
        ${W?en():r.role==="asset"&&!Tn&&!z?`<p class="hint">Hold ${jn("Space")} to flip to the comp. Hover to magnify both.</p>`:""}
      </div>
      <button type="button" class="locator" id="open-map" aria-label="Open the comp"><span class="locator-map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img src="${Hn(n.comp.url)}" alt="" draggable="false"><span class="locator-box" style="${Sn(r.box)}"></span></span><span class="locator-label">Comp ${jn("C")}</span></button>
    </div>
    ${$e(r)}`}function Qe(){if(m?.type==="missing"){let r=t.missing.find((s)=>s.id===m.id);if(!r)return"";return`<div class="side-panel"><p class="eyebrow missing">Missing from the review</p>
        <label class="field"><span class="eyebrow">Name</span><input id="missing-name" value="${Y(r.name)}" placeholder="For example: harbour boat" ${N()?"disabled":""}></label>
        <label class="field"><span class="eyebrow">What is missing? Optional</span><textarea id="missing-feedback" rows="2" ${N()?"disabled":""}>${Y(r.feedback)}</textarea></label>
        <div class="form-actions start"><button type="button" id="panel-done" class="ks-button ks-button-secondary">Done</button>${N()?"":'<button type="button" id="missing-remove" class="ks-button ks-button-ghost">Remove</button>'}</div></div>`}if(m?.type==="region"){let r=Nn(m.id);if(!r)return"";let s=qe(t,r.id),l=u?.region&&u.id===r.id;return`<div class="side-panel"><p class="eyebrow">Set in code · ${Y(r.kind)}</p><h3>${Y(r.name)}</h3>
        <div class="panel-crop" style="aspect-ratio:${Math.max(0.5,Math.min(6,hn(r.box)))}">${J(r.box)}</div>
        ${l?`<form id="decision-form" class="panel-form"><div class="ks-instrument-strip is-paper" data-ks-strip="region-kind" role="group" aria-label="Make it">${De.map((h)=>`<button type="button" class="ks-instrument-key" data-kind="${h.kind}" aria-pressed="${u.kind===h.kind}">${An[h.kind][0].toUpperCase()+An[h.kind].slice(1)}</button>`).join("")}</div><textarea id="form-text" rows="2" placeholder="Anything the image should keep? Optional">${Y(u.text)}</textarea><div class="form-actions start"><button type="submit" class="ks-button ks-button-primary">Make it an image</button><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel</button></div></form>`:s?`<p class="current-decision"><span>Becomes ${Y(An[s.kind])}${s.feedback?`: “${Y(s.feedback)}”`:"."}</span>${N()?"":'<button type="button" class="text-action" id="region-keep">Keep in code</button>'}</p>`:`<p class="muted">Checked in the first-viewport review, once the page is built.</p><div class="form-actions start">${N()?"":'<button type="button" class="ks-button ks-button-secondary" id="region-image">Make it an image</button>'}<button type="button" id="panel-done" class="ks-button ks-button-ghost">Close</button></div>`}
      </div>`}return`<div class="side-panel quiet"><p>Every outlined region above was on your list. Hover the comp to see what is set in code; click a region to make it an image.</p>${N()?"":`<button type="button" class="ks-button ks-button-secondary" id="mark" aria-pressed="${Q}">${Q?"Cancel marking":"Mark missing"}</button>`}${Q?'<p class="marking-hint">Drag on the comp around what is missing.</p>':""}${t.missing.length?`<ul class="missing-list">${t.missing.map((r)=>`<li><button type="button" class="text-action" data-missing="${Y(r.id)}">${Y(r.name||"Unnamed missing piece")}</button></li>`).join("")}</ul>`:""}</div>`}function xe(){let r=Pn(n,t),s=o.status?"This round can no longer be sent.":r.pending&&!r.hasChanges?`${r.pending} still to decide.`:r.mode==="approve"?"Approval confirms nothing is missing from the comp.":`${r.pending?`${r.pending} undecided stay open. `:""}The agent applies your notes and opens a new round.`,l=(h)=>{let f=zn(h,t),k=yn(h,t),x;if(h.role==="asset"&&h.preview.url){let c=hn(h.box);x=`<span class="card-pic" style="aspect-ratio:${c};width:min(100%, ${Math.round(118*c)}px)">${K(h,h.preview.url)}</span>`}else{let c=ei(h.box,n.comp.width,n.comp.height,220,118),V=c.view;x=`<span class="card-pic" style="width:${Math.floor(c.width)}px;height:${Math.floor(c.height)}px"><span class="pic crop"><img src="${Hn(n.comp.url)}" alt="" draggable="false" style="width:${100/V.w}%;left:${-100*V.x/V.w}%;top:${-100*V.y/V.h}%"></span><span class="focus-box" style="${Sn({x:(h.box.x-V.x)/V.w,y:(h.box.y-V.y)/V.h,w:h.box.w/V.w,h:h.box.h/V.h})}"></span></span>`}return`<button type="button" class="card ${k}" data-go="${Y(h.id)}"><span class="card-thumb">${x}</span><span class="card-text"><span class="card-name">${Y(h.name)}</span><span class="card-state">${k==="approved"?Je.check:""}${Y(X(h))}</span>${f?.feedback?`<span class="card-note">“${Y(f.feedback)}”</span>`:""}</span></button>`};return`<div class="summary ${M?`enter-${M}`:""}">
      <div class="summary-head">
        <p class="eyebrow">${z?`Round ${n.round} · sent`:"Summary"}</p>
        <h1>${z?r.hasChanges?"Notes sent.":"Plan and assets approved.":r.pending?"Almost there.":"Your decisions."}</h1>
        ${z?`<p class="lead">${r.hasChanges?"The agent applies them and opens a new round for anything that changed.":"The agent continues to the first viewport."}${Qn?"":" This round is read-only."}</p>`:""}
      </div>
      <div class="sheet">${p.map(l).join("")}</div>
      <section class="coverage" aria-label="Coverage">
        <h2>Anything on the comp we didn't cover?</h2>
        <div class="coverage-grid">
          <div class="map-space"><div class="map ${Q?"marking":""} ${m?"has-selection":""}" id="summary-map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img class="comp" src="${Hn(n.comp.url)}" alt="The approved comp" draggable="false">${H({code:!0,interactive:!0})}<div class="draw-box" hidden></div></div></div>
          ${Qe()}
        </div>
      </section>
    </div>
    ${z?"":`<div class="send-row"><div class="send-inner">${W?en():`<p>${Y(s)}</p>`}<button type="button" class="ks-button ks-button-primary" id="send" ${!r.canSubmit||!!u||U||!!o.status?"disabled":""}>${U?"Sending…":Y(Bi(n,t))}${U?"":Bn}</button></div></div>`}`}function he(){if(!Z)return"";return`<div class="overlay" role="dialog" aria-modal="true" aria-label="The comp"><div class="overlay-head"><span class="eyebrow">The comp · click a region to go to it</span><button type="button" class="ks-button ks-button-ghost" id="close-map">Close${jn("Esc")}</button></div>
      <div class="overlay-body"><div class="map has-selection" id="overlay-map" style="aspect-ratio:${n.comp.width}/${n.comp.height}"><img class="comp" src="${Hn(n.comp.url)}" alt="The approved comp" draggable="false">${H({code:!0,interactive:!0})}</div></div></div>`}function A(){I?.disconnect(),Wn?.();let s=a.activeElement?.id,l=v==="summary"?a.querySelector(".view-summary .screen")?.scrollTop??0:0;a.innerHTML=`<style>${Hi}</style><section class="rv view-${v} ${z?"is-submitted":""}" aria-label="Plan and asset review">
      ${R()}${Gn()}
      <main class="screen">${v==="intro"?P():v==="stage"?Ge():xe()}</main>
      ${he()}
    </section>`,M=null;let h=a.querySelector(".screen");if(h&&l)h.scrollTop=l;if(s)a.getElementById(s)?.focus({preventScroll:!0});if(kn(),ke(),I=new ResizeObserver(ke),I.observe(a.querySelector(".screen")),Wn=Ye(a),!z)o.onDraftChange?.(structuredClone(t))}function ke(){let r=matchMedia("(max-width: 760px)").matches,s=a.querySelector(".figures[data-ratios]");if(s&&s.clientWidth){let h=s.dataset.ratios.split(",").map(Number),[f,k]=(s.dataset.natural??"0x0").split("x").map(Number),x=r?{direction:"column",sizes:h.map((c)=>({w:Math.min(s.clientWidth,360*c),h:Math.min(s.clientWidth,360*c)/c}))}:Ni(h,s.clientWidth,s.clientHeight,28,30,4,{w:f,h:k});s.dataset.direction=x.direction,s.querySelectorAll(":scope > .fig > .frame").forEach((c,V)=>{c.style.width=`${Math.floor(x.sizes[V].w)}px`,c.style.height=`${Math.floor(x.sizes[V].h)}px`}),F(s)}let l=a.querySelector(".figures.single");if(l?.clientWidth){let h=JSON.parse(l.dataset.box),f=l.closest(".stage"),k=f.clientHeight-36-28-(f.querySelector(".stage-head")?.offsetHeight??0)-(f.querySelector(".stage-foot")?.offsetHeight??0)-30-80,x=ei(h,n.comp.width,n.comp.height,Math.min(l.clientWidth,1120),r?320:Math.max(80,k)),c=l.querySelector(".frame"),V=c.querySelector("img"),O=c.querySelector(".focus-box"),L=x.view;c.style.width=`${Math.floor(x.width)}px`,c.style.height=`${Math.floor(x.height)}px`,V.style.cssText=`width:${100/L.w}%;left:${-100*L.x/L.w}%;top:${-100*L.y/L.h}%`,O.style.cssText=Sn({x:(h.x-L.x)/L.w,y:(h.y-L.y)/L.h,w:h.w/L.w,h:h.h/L.h}),F(l)}for(let h of a.querySelectorAll(".overlay-body .map, .intro-comp .map")){let f=h.parentElement,k=getComputedStyle(f),x=f.clientWidth-parseFloat(k.paddingLeft)-parseFloat(k.paddingRight),c=f.clientHeight-parseFloat(k.paddingTop)-parseFloat(k.paddingBottom);if(!x||!c)continue;let V=Math.min(x/n.comp.width,c/n.comp.height);h.style.width=`${n.comp.width*V}px`,h.style.height=`${n.comp.height*V}px`}}let $=78,D=3;function F(r){r.querySelectorAll(".frame").forEach((s)=>{s.querySelector(".lens")?.remove();let l=document.createElement("span");l.className="lens",l.setAttribute("aria-hidden","true");let h=document.createElement("span");h.className="lens-inner",h.style.width=`${s.clientWidth}px`,h.style.height=`${s.clientHeight}px`,s.querySelectorAll(":scope > .pic, :scope > .focus-box").forEach((f)=>h.append(f.cloneNode(!0))),l.append(h),s.append(l)})}function tn(r,s){a.querySelectorAll(".figures .frame").forEach((l)=>{let h=l.querySelector(".lens"),f=h?.querySelector(".lens-inner");if(!h||!f)return;let{clientWidth:k,clientHeight:x}=l;h.style.transform=`translate(${r*k-$}px, ${s*x-$}px)`;let c=Ki(r,s,k,x,$,D);f.style.transform=`translate(${c.x}px, ${c.y}px) scale(${D})`})}function kn(){let r=(k,x)=>a.getElementById(k)?.addEventListener("click",x);r("start",()=>{let k=p.find((x)=>yn(x,t)==="pending")??p[0];if(k)on("stage",k.id,"next");else on("summary")}),a.querySelectorAll("[data-go]").forEach((k)=>k.addEventListener("click",()=>{let x=k.dataset.go,c=p.findIndex((V)=>V.id===w);on("stage",x,v!=="stage"?"fade":p.findIndex((V)=>V.id===x)>=c?"next":"prev")})),r("to-summary",()=>on("summary",void 0,"next")),r("decide-yes",le),r("decide-no",()=>$n(rn(w)?.role==="asset"?"revise":"reclassify")),r("decide-other",()=>$n("revise")),r("decide-split",()=>$n("revise",void 0,!0)),r("decision-clear",()=>{let k=rn(w);if(k&&!N())Un($i(t,k.id),`Cleared: ${k.name}.`),A()}),r("form-cancel",()=>{u=null,A()}),a.getElementById("decision-form")?.addEventListener("submit",(k)=>{k.preventDefault(),On()}),a.getElementById("form-text")?.addEventListener("input",(k)=>{if(u)u.text=k.target.value}),a.querySelectorAll("[data-kind]").forEach((k)=>k.addEventListener("click",()=>{if(!u)return;u.kind=k.dataset.kind,a.querySelectorAll("[data-kind]").forEach((x)=>x.setAttribute("aria-pressed",String(x===k)))})),r("backdrop",()=>{let k=rn(w);if(!k)return;let x=["comp","light","dark"];xn[k.id]=x[(x.indexOf(xn[k.id]??"comp")+1)%3],A()}),r("undo",de),r("send",()=>void ie()),r("retry",()=>void ie()),r("reload",()=>location.reload());let s=()=>{Z=!0,A(),a.getElementById("close-map")?.focus()};if(r("open-map",s),r("open-map-bar",s),r("close-map",()=>{Z=!1,A()}),r("mark",()=>{if(N())return;Q=!Q,m=null,u=null,A()}),r("panel-done",()=>{m=null,u=null,A()}),r("region-image",()=>{if(m?.type==="region")$n("reclassify",m.id)}),r("region-keep",()=>{let k=m?.type==="region"?Nn(m.id):void 0;if(k&&!N())Un(ni(t,k.id,null),`${k.name} stays in code.`),A()}),r("missing-remove",()=>{if(m?.type!=="missing")return;let k=m.id;t={...t,missing:t.missing.filter((x)=>x.id!==k)},m=null,A()}),a.getElementById("missing-name")?.addEventListener("input",(k)=>{let x=t.missing.find((c)=>c.id===m?.id);if(x){x.name=k.target.value;let c=a.getElementById("send");if(c)c.disabled=!Pn(n,t).canSubmit||U||!!o.status;o.onDraftChange?.(structuredClone(t))}}),a.getElementById("missing-feedback")?.addEventListener("input",(k)=>{let x=t.missing.find((c)=>c.id===m?.id);if(x)x.feedback=k.target.value,o.onDraftChange?.(structuredClone(t))}),N())a.querySelectorAll("#decide-yes,#decide-no,#decide-other,#decide-split,#decision-clear,#mark,#region-image").forEach((k)=>k.disabled=!0);a.querySelectorAll(".map [data-item]").forEach((k)=>k.addEventListener("click",()=>{if(!Q)on("stage",k.dataset.item,"fade")}));let l=(k)=>{if(Q)return;if(m=k,u=null,v!=="summary")v="summary",Z=!1,M=qn()?null:"fade";A(),a.querySelector(".coverage")?.scrollIntoView({block:"start"})};a.querySelectorAll("[data-region]").forEach((k)=>k.addEventListener("click",()=>l({type:"region",id:k.dataset.region}))),a.querySelectorAll("[data-missing]").forEach((k)=>k.addEventListener("click",()=>l({type:"missing",id:k.dataset.missing})));let h=a.querySelector(".figures");h?.querySelectorAll(":scope > .fig > .frame").forEach((k)=>{k.addEventListener("pointerenter",(x)=>{if(x.pointerType==="mouse")h.classList.add("looking")}),k.addEventListener("pointerleave",()=>h.classList.remove("looking")),k.addEventListener("pointermove",(x)=>{let c=k.getBoundingClientRect();tn((x.clientX-c.left)/c.width,(x.clientY-c.top)/c.height)})});let f=a.getElementById("summary-map");if(f){let k=(V)=>{let O=f.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(V.clientX-O.left)/O.width)),y:Math.max(0,Math.min(1,(V.clientY-O.top)/O.height))}},x=null,c=null;f.addEventListener("pointerdown",(V)=>{if(!Q)return;x=k(V),c=null,f.setPointerCapture(V.pointerId),V.preventDefault()}),f.addEventListener("pointermove",(V)=>{if(!x)return;let O=k(V);c={x:Math.min(x.x,O.x),y:Math.min(x.y,O.y),w:Math.abs(O.x-x.x),h:Math.abs(O.y-x.y)};let L=a.querySelector(".draw-box");L.hidden=!1,L.style.cssText=Sn(c)}),f.addEventListener("pointerup",()=>{if(c&&c.w>0.01&&c.h>0.01)G(c);x=null,c=null}),f.addEventListener("pointercancel",()=>{x=null,c=null,A()})}}function Kn(r){if(dn===r)return;dn=r,a.querySelectorAll('[data-role="generated"] .frame').forEach((l)=>l.classList.toggle("flipped",r));let s=a.querySelector('[data-role="generated"] figcaption .eyebrow');if(s)s.textContent=r?"In the comp":Ve(w??"",g)?.beforeUrl?"After":"Generated";if(r&&!Tn)Tn=!0,Oi.set("impeccable.review.flipHint","1"),a.querySelector(".hint")?.classList.add("gone")}let ae=(r)=>{let s=r;if(!i.isConnected||s.defaultPrevented)return;let l=s.composedPath()[0],h=l instanceof HTMLTextAreaElement||l instanceof HTMLInputElement;if(s.key==="Escape"){if(Z)s.preventDefault(),Z=!1,A();else if(u)s.preventDefault(),u=null,A();else if(Q)s.preventDefault(),Q=!1,A();else if(m)s.preventDefault(),m=null,A();return}if(s.key==="Enter"&&(s.metaKey||s.ctrlKey)&&u){s.preventDefault(),On();return}if(h||s.altKey||s.isComposing)return;if((s.metaKey||s.ctrlKey)&&s.key.toLowerCase()==="z"){if(W)s.preventDefault(),de();return}if(s.metaKey||s.ctrlKey)return;if(v==="intro"&&s.key==="Enter"&&l?.tagName!=="BUTTON"){s.preventDefault(),a.getElementById("start")?.click();return}if(Z||u)return;let f=s.key.toLowerCase();if(s.key===" "&&v==="stage"&&rn(w)?.role==="asset"&&l?.tagName!=="BUTTON"&&l?.tagName!=="A"){if(s.preventDefault(),!s.repeat)Kn(!0);return}if(s.key===" "&&v==="stage"&&rn(w)?.role==="asset"){if(s.preventDefault(),!s.repeat)Kn(!0);return}if(f==="c"&&v!=="intro"){s.preventDefault(),Z=!0,A();return}if(v!=="stage"||N()){if(v==="summary"&&(f==="k"||s.key==="ArrowLeft")&&p.length&&!N())s.preventDefault(),on("stage",p[p.length-1].id,"prev");return}if(f==="a")s.preventDefault(),le();else if(f==="n")s.preventDefault(),a.getElementById("decide-no")?.click();else if(f==="f"&&rn(w)?.role==="plan")s.preventDefault(),$n("revise");else if(f==="s"&&rn(w)?.role==="asset")s.preventDefault(),$n("revise",void 0,!0);else if(f==="j"||s.key==="ArrowRight")s.preventDefault(),ee(1);else if(f==="k"||s.key==="ArrowLeft")s.preventDefault(),ee(-1)},oe=(r)=>{if(r.key===" "&&dn)r.preventDefault(),Kn(!1)},vn=()=>Kn(!1);return document.addEventListener("keydown",ae),document.addEventListener("keyup",oe),window.addEventListener("blur",vn),A(),{destroy(){I?.disconnect(),Wn?.(),document.removeEventListener("keydown",ae),document.removeEventListener("keyup",oe),window.removeEventListener("blur",vn),a.replaceChildren()},getDraft(){return structuredClone(t)}}}var T=(i)=>i.replace(/[&<>"']/g,(n)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]),Ln=(i)=>`${i*100}%`,Mn=(i)=>{let n=new URL(i,location.href);if(!["http:","https:"].includes(n.protocol))throw Error("Unsupported preview URL");return T(n.href)};function Ri(i,n,o){if(Me(n))return Di(i,n,{...o,history:o.history,initialDraft:o.initialDraft,onDraftChange:o.onDraftChange,onSubmit:o.onSubmit});let a=i.attachShadow({mode:"open"}),t=structuredClone(o.initialDraft??mi(n)),p=n.stage==="hero"&&n.components.length===1&&!t.missing.length,y=()=>[...n.components].sort((X,J)=>bn(X,t,o.history).priority-bn(J,t,o.history).priority),g=y().find((X)=>bn(X,t,o.history).kind!=="approved")?.id??n.components[0]?.id,b=Cn(n,t).pending?"pending":"reviewed",z=!1,v=!1,w=o.completed??!1,M="",u={},m=!!o.completed||!Cn(n,t).pending,Q=null,Z=!0,dn=/Mac|iPhone|iPad/.test(navigator.platform)?"⌘Enter":"Ctrl+Enter",xn=!1,U=!1,Qn=!1,Yn=null,W=!1,en=!0,Tn=!1,I="comp",Wn=I,ln="fit",Xn="checker",C=!1,qn="isolated",rn,Nn="fit",N=null,hn=null,an=null,ne=null,Zn='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>',on='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11 1 2 2-1 7-7-3-3-7 7v2Z"/></svg>',ee=(X,J)=>{if(X.stage==="hero")return"";let K=ye(X,J);if(!K.related.length)return"";let H=K.related.map((R)=>T(R.name)).join(" · ");return`<div class="review-scope" aria-label="Review scope"><p><strong>Reviewing</strong> ${T(K.description||J.name)}</p><p class="separate-reviews"><strong>Outlined · reviewed separately</strong> ${H}</p>${K.excluded.length?`<p class="scope-excluded">Hidden in this preview: ${K.excluded.map((R)=>T(R.name)).join(" · ")}</p>`:""}</div>`},In=(X)=>`left:${Ln(X.x)};top:${Ln(X.y)};width:${Ln(X.w)};height:${Ln(X.h)}`,Un=(X,J)=>X.stage==="hero"?"":ye(X,J).related.map((K)=>{let H=J.box,R=K.box,Gn=Math.max(H.x,R.x),P=Math.max(H.y,R.y),re={x:(Gn-H.x)/H.w,y:(P-H.y)/H.h,w:Math.max(0,Math.min(H.x+H.w,R.x+R.w)-Gn)/H.w,h:Math.max(0,Math.min(H.y+H.h,R.y+R.h)-P)/H.h};return`<span class="reference-layer" style="${In(re)}" title="Reviewed separately: ${T(K.name)}" aria-label="Reviewed separately: ${T(K.name)}"><span>${T(K.name)}</span></span>`}).join("");function Jn(X){a.getElementById(X)?.focus({preventScroll:!0})}function le(X){let J=yi(n,t,X);if(m=!J,J)g=J;I="component",C=!1,xn=!1,ln="fit",qn="isolated",Z=!0,b=m?"reviewed":"pending";let K=()=>{G(),Jn(m?"review-summary":u[g]?"feedback":"approve")};if(m&&U&&Yn)Yn(K);else K()}async function $n(){if(v||w||C||Object.keys(u).length)return;v=!0,M="",G();try{await o.onSubmit(fi(n,t)),w=!0,m=!0,z=!1,b="reviewed"}catch(X){M=X instanceof Error?X.message:"Could not save. Try again."}finally{v=!1,G()}}function On(X){if(v||w||C||Qn)return;let J=n.components.find((P)=>P.id===g);if(!J||!pe(n,t,J,Z,Object.keys(u)).length)return;let K=t.decisions[J.id],H=K?.revision===J.revision?K:void 0,R=pe(n,t,J,Z,Object.keys(u));Q={id:J.id,name:R.length>1?`${J.reviewGroup} · ${R.length} instances`:J.name,action:X,previous:Object.fromEntries(R.map((P)=>[P.id,t.decisions[P.id]?{...t.decisions[P.id]}:void 0]))};let Gn=u[J.id]??H;for(let P of R)t.decisions[P.id]={revision:P.revision,action:X,feedback:X==="revise"?Gn?.feedback??"":"",split:X==="revise"&&(Gn?.split??!1)};if(delete u[J.id],Tn)en=!0,Tn=!1;if(p)t.inventoryConfirmed=X==="approve",Q=null,$n();else le(J.id)}function de(){if(v||w||C||Qn)return;let X=n.components.find((H)=>H.id===g);if(!X||!pe(n,t,X,Z,Object.keys(u)).length)return;let J=t.decisions[X.id],K=J?.revision===X.revision?J:void 0;if(u[X.id]??={feedback:K?.feedback??"",split:K?.split??!1},en&&(a.querySelector(".workbench")?.clientHeight??0)<420)Tn=!0,en=!1;m=!1,G(),Jn("feedback")}function ie(X){let J=`missing-${crypto.randomUUID()}`;t.missing.push({id:J,name:"Missing component",feedback:"",box:X}),t.inventoryConfirmed=!1,m=!1,g=J,I="component",z=!1,N=null,hn=null,G(),a.querySelector("#missing-name")?.focus()}function G(){if(an?.disconnect(),ne?.(),w||m&&!p)U=!1;let X=a.activeElement,J=X?.id,K=X?.dataset.select,H=window.scrollX,R=window.scrollY,Gn=a.querySelector(".inventory")?.scrollLeft??0,P=rn===g,re=I==="component"&&(!P||Wn!==I);Wn=I;let $e=P?a.querySelector(".inspection-content")?.scrollTop??0:0,Ge=P&&(a.querySelector(".changed-files")?.open??!1),Qe=a.querySelector(".comparison-slot")?.clientHeight??200,xe=a.querySelector(".pan-viewport"),he=rn===g&&Nn===ln,A=he?xe?.scrollLeft??0:0,ke=he?xe?.scrollTop??0:0;rn=g,Nn=ln;let $=n.components.find((e)=>e.id===g),D=t.missing.find((e)=>e.id===g),F=zi(n,t,o.history),tn=F.find((e)=>e.members.some((d)=>d.id===g)),kn=!!tn&&tn.members.length>1&&Z,Kn=kn?tn.box:$?.box??D?.box,ae=tn?F.indexOf(tn)+1:F.length+t.missing.findIndex((e)=>e.id===g)+1,oe=$?t.decisions[$.id]:void 0,vn=oe?.revision===$?.revision?oe:void 0,r=$?u[$.id]:void 0,s=Object.keys(u).length>0,l=$?fe(n,$):[],h=$?pe(n,t,$,Z,Object.keys(u)):[],f=$?!n.components.some((e)=>!h.some((d)=>d.id===e.id)&&bn(e,t).kind==="pending"):!1,k=Q&&!w?`<div class="decision-notice"><span role="status">${T(Q.name)} ${Q.action==="approve"?"approved":"flagged for repair"}.</span><button id="undo-decision" class="text-action">Undo</button></div>`:"",x=Cn(n,t),c=o.history,V=$?we($.id,c):void 0,O=c?.packet.components.find((e)=>e.id===$?.id),L=C&&!!O,q=L?O:$,pn=L?c.packet:n,oi=Object.values(c?.changes??{}),ti=oi.filter((e)=>e.kind==="changed").length,si=oi.filter((e)=>e.kind==="added").length,Ze=n.components.filter((e)=>bn(e,t,c).kind==="approved"&&we(e.id,c).carried).length,Ue=(e)=>{let d=bn(e,t,c);return w&&d.kind==="feedback"?{...d,label:"Changes requested"}:d},te=F.filter((e)=>e.kind==="pending").length,Fi=F.length-te+t.missing.length,pi=F.filter((e)=>b==="all"||e.kind==="pending"===(b==="pending")).map((e)=>e.representative),Ci=(e)=>F.find((d)=>d.members.some((j)=>j.id===e))?.label??e,Pi=[x.revisions+t.missing.length?`${x.revisions+t.missing.length} feedback ready`:"",Ze?`${Ze} ${Ze===1?"approval":"approvals"} kept`:"",ti?`${ti} changed`:"",si?`${si} added`:"",c?.removed.length?`${c.removed.length} removed`:""].filter(Boolean).join(" · "),Si=M||(s?"Save or cancel your open feedback before sending.":w?o.preview?"Preview submitted. No run changed.":"Review submitted.":x.hasFeedback?"Ready to send for corrections.":x.pending?`${te} left to review`:!t.inventoryConfirmed?"Confirm the map is complete.":"Ready to continue."),Vn=q?Fn(q):null,Ae=q?.preview.kind==="image"&&!Vn?.code,Le=Ae||q?.material?.alpha==="transparent",mn=!!(q?.context&&qn==="context"),li=q&&(mn?q.context?.kind!=="image":q.preview.kind==="page"),Ne=mn&&q?.context?q.context.url:q?.preview.url,di=q?ye(pn,q):null,nr=Vn?.code?`${Vn.label} · ${Vn.captured?"captured from code":"live preview"}`:q?.material?`${q.material.alpha==="transparent"?"Transparent":q.material.alpha==="opaque"?"Opaque":"Transparency unverified"} ${q.material.format}`:"Raster · transparency unverified";a.innerHTML=`<style>${Yi}</style><section class="review ${p?"assembled-review":""}" aria-label="${p?"Assembled page review":"Component review"}" style="--comp-background:${/^#[0-9a-f]{6}$/i.test(n.comp.background??"")?n.comp.background:"#eeeeee"}">
      <header><div><h1>${w?"Review record.":p?"Review the assembled page.":"Review the components."}</h1><p>${T(n.title)} <span>· Round ${n.round}</span></p></div>${w?'<span class="badge">Submitted · read-only</span>':o.preview?'<span class="badge">Interactive preview</span>':""}</header>
      ${o.preview?'<p class="preview-note">Historical hotel artwork for testing this interface. Decisions stay in this preview; no run is changed.</p>':""}
      ${c&&!p?`<section class="round-summary" aria-label="Changes since previous round"><p><strong>${te} ${te===1?"item":"items"} to review</strong><span>${Pi}</span></p>${x.pending?`<button id="review-changes" class="ks-icon-button" aria-label="Next to review" title="Next to review">${fn("next")}</button>`:""}${c.removed.length?`<details><summary>Removed from the map</summary><p>${c.removed.map((e)=>T(e.name)).join(" · ")}. Confirm these omissions are intentional before accepting the map.</p></details>`:""}</section>`:""}
      ${!p?`<div class="mobile-panes"><div class="ks-instrument-strip is-paper" data-ks-strip="pane" role="group" aria-label="Inspection view"><button type="button" class="ks-instrument-key" id="show-comp" aria-pressed="${I==="comp"}">Approved comp</button><button type="button" class="ks-instrument-key" id="show-component" aria-pressed="${I==="component"}">Component ${ae}</button></div></div>`:""}
      <div class="workbench" data-mobile-pane="${I}">${!p?`<svg class="connector" aria-hidden="true"><path /></svg>
        <section class="reference" aria-label="Approved composition">
          <div class="section-head"><h2>Approved comp</h2>${!w?`<button id="mark" class="ks-button ks-button-ghost" aria-pressed="${z}">${z?"Cancel":"Mark missing"}</button>`:""}</div>
          <div class="map-space"><div class="map ${z?"marking":""}" style="aspect-ratio:${n.comp.width}/${n.comp.height}">
            <img class="comp" src="${Mn(n.comp.url)}" alt="Approved composition for ${T(n.title)}" draggable="false">
            ${Kn&&!m?`<div class="region" style="${In(Kn)}"></div>`:""}
            ${F.map((e,d)=>{let j=e.representative,E={kind:e.kind,label:e.stateLabel},cn=!m&&tn?.id===e.id;return`<button class="pin ${E.kind} ${cn?"selected":""}" data-select="${T(j.id)}" style="left:${Ln(Math.min(0.96,e.box.x+e.box.w/2))};top:${Ln(Math.max(0.035,e.box.y))}" aria-label="Inspect ${T(e.label)}${e.members.length>1?` · ${e.members.length} instances`:""} — ${T(E.label)}" title="${d+1}. ${T(e.label)} · ${T(E.label)}" aria-pressed="${cn}">${E.kind==="approved"?Zn:E.kind==="feedback"?on:""}<span>${d+1}</span>${e.members.length>1?`<small>×${e.members.length}</small>`:""}</button>`}).join("")}
            ${kn&&!m?tn.members.map((e)=>`<div class="region instance-region" style="${In(e.box)}"></div>`).join(""):""}
            ${t.missing.map((e,d)=>`<button class="pin feedback ${!m&&g===e.id?"selected":""}" data-select="${T(e.id)}" style="left:${Ln(e.box.x+e.box.w/2)};top:${Ln(e.box.y)}" aria-label="Inspect missing ${T(e.name)}" title="Missing: ${T(e.name)}">${on}<span>${F.length+d+1}</span></button>`).join("")}

            <div class="draw-box" hidden></div>
          </div></div>
          <div class="map-legend" aria-label="Map status legend"><span><i class="legend-pending">#</i> To review</span><span><i class="legend-feedback">${on}</i> ${w?"Changes requested":"Feedback ready"}</span><span><i class="legend-approved">${Zn}</i> Approved</span></div>
          ${z?'<div class="map-caption">Draw around the missing piece.<button id="add-box">Add an adjustable box</button></div>':""}
        </section>`:""}
        <section class="inspector" aria-label="${p?"Page comparison":"Selected component"}">
          ${!p?`<div class="section-head"><h2>${m?"Review summary":`<span class="number">${ae}</span> ${T(kn?tn.label:$?.name??D?.name??"Component")}`}</h2></div>`:""}<div class="inspection-content" role="region" aria-label="${p?"Page comparison":"Component comparison"}" tabindex="0">
          ${m&&!p?`<section class="review-summary" id="review-summary" tabindex="-1"><div class="completion-mark" aria-hidden="true">${Zn}</div><h2>${w?"Review sent.":"All components reviewed."}</h2><p>${x.approved} approved · ${x.revisions} flagged for repair${t.missing.length?` · ${t.missing.length} missing`:""}</p><p>${w?"Your decisions are saved.":x.hasFeedback?"Send your feedback to start the next repair round.":"Confirm nothing is missing, then approve and continue."}</p><div class="summary-decisions">${F.map((e)=>{let d=e.representative,j=t.decisions[d.id],E=Ue(d);return`<button data-select="${T(d.id)}"><strong>${T(e.label)}</strong><span>${e.kind==="pending"?"Not reviewed":E.kind==="feedback"?"Needs work":"Approved"}</span>${j?.action==="revise"?`<small>${T(j.feedback||"No note — agent will diagnose.")}</small>`:""}</button>`}).join("")}${t.missing.map((e)=>`<button data-select="${T(e.id)}"><strong>${T(e.name)}</strong><span>Missing</span><small>${T(e.feedback)}</small></button>`).join("")}</div></section></div>${k?`<div class="review-form">${k}</div>`:""}`:$?`
          ${c?`<div class="repair-context">
            ${L&&V?.prior?.action==="revise"?`<section class="previous-feedback" aria-label="Previous feedback"><h3>Previous feedback <span>· Round ${V.feedbackRound}</span></h3><blockquote>${T(V.prior.feedback||"No written feedback was supplied.")}</blockquote>${V.prior.split?"<p>Requested: split into separately reviewable components.</p>":""}</section>`:V?.carried?'<p class="kept-approval">Unchanged · approval kept</p>':""}
            ${V?.change?.kind==="changed"?`<details class="changed-files" ${Ge?"open":""}><summary>${V.change.files.length?`${V.change.files.length} changed ${V.change.files.length===1?"file":"files"}`:V.change.reasons.includes("region")?"Region changed":O?.note!==$.note?"Description changed · files unchanged":"Component definition changed · files unchanged"}</summary>${V.change.files.length?`<ul>${V.change.files.map((e)=>`<li>${T(e)}</li>`).join("")}</ul>`:""}${O&&O.note!==$.note?`<dl class="description-diff"><dt>Previous description</dt><dd>${T(O.note)}</dd><dt>Current description</dt><dd>${T($.note)}</dd></dl>`:""}</details>`:""}
          </div>`:""}

          <div class="comparison-slot"><div class="comparison-panel ${kn?"group-overview":""}"><h2 class="expanded-title">${T(kn?tn.label:q.name)}</h2>${l.length>1?`<div class="review-peers"><strong>${l.length} instances</strong>${!kn?'<button id="all-instances" class="quiet">All instances</button>':'<span class="group-hint">Select to inspect</span>'}</div>`:""}<div class="compare-toolbar">${O?`<div class="round-switch ks-instrument-strip is-paper" data-ks-strip="round" role="group" aria-label="Preview version"><button type="button" class="ks-instrument-key" id="current-round" aria-label="Current · round ${n.round}" title="Current · round ${n.round}" aria-pressed="${!L}">Current</button><button type="button" class="ks-instrument-key" id="previous-round" aria-label="Previous · round ${c.packet.round}" title="Previous · round ${c.packet.round}" aria-pressed="${L}">Previous</button></div>`:""}<div class="ks-instrument-strip is-paper zoom-strip" data-ks-strip="zoom" role="group" aria-label="Comparison zoom">${[["fit","Fit"],["1","100%"],["2","200%"],["4","400%"]].map(([e,d])=>`<button type="button" class="ks-instrument-key" data-zoom="${e}" aria-pressed="${String(ln)===e}">${d}</button>`).join("")}</div><button id="overlay" type="button" class="ks-switch" title="Overlay the approved comp" aria-pressed="${xn}"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">Overlay</span></button><div class="comparison-actions" role="group" aria-label="Comparison view actions"><button id="expand-comparison" class="ks-icon-button" aria-label="${U?"Restore comparison":"Enlarge comparison"}" title="${U?"Restore comparison (Esc)":"Enlarge comparison"}" aria-expanded="${U}">${fn(U?"compact":"expand")}</button>${q?.preview.kind==="image"?`<a class="ks-icon-button source-link" href="${Mn(Ne)}" target="_blank" rel="noopener" aria-label="${mn?"Open context capture":Vn.fileLabel}" title="${mn?"Open context capture":Vn.fileLabel}">${fn("external")}</a>`:""}</div></div>
          ${kn?`<div class="instance-grid" aria-label="All instances of ${T(tn.label)}"><div class="instance-grid-labels"><span>Full comp crop</span><span>Component preview</span></div>${tn.members.map((e,d)=>{let j=Ue(e);return`<button class="instance-row ${j.kind}" data-instance="${T(e.id)}" aria-label="Inspect instance ${d+1}: ${T(e.name)} — ${T(j.label)}"><span class="instance-caption"><strong>${T(e.name)}</strong><span>${T(j.label)}</span></span><span class="instance-pair"><span class="instance-reference" style="width:min(100%,${e.box.w*n.comp.width}px,${180*e.box.w*n.comp.width/(e.box.h*n.comp.height)}px);aspect-ratio:${e.box.w*n.comp.width}/${e.box.h*n.comp.height}"><img src="${Mn(n.comp.url)}" alt="Comp: ${T(e.name)}" loading="lazy" style="width:${100/e.box.w}%;left:${-100*e.box.x/e.box.w}%;top:${-100*e.box.y/e.box.h}%">${Un(n,e)}</span><span class="instance-produced" style="width:min(100%,${e.box.w*n.comp.width}px,${180*e.box.w*n.comp.width/(e.box.h*n.comp.height)}px);aspect-ratio:${e.box.w*n.comp.width}/${e.box.h*n.comp.height}">${e.preview.kind==="image"?`<img src="${Mn(e.preview.url)}" alt="Produced: ${T(e.name)}" loading="lazy">`:e.thumbnail?`<img src="${Mn(e.thumbnail.url)}" alt="Preview: ${T(e.name)}" loading="lazy">`:"Open live component"}</span></span>${ee(n,e)}</button>`}).join("")}</div>`:""}
          ${!kn&&q?ee(pn,q):""}<div class="compare">
            <figure><figcaption>${L?`Comp · Round ${c.packet.round}`:p?"Approved comp":di?.related.length?"Full comp crop":"In the comp"}</figcaption><div class="pan-viewport" aria-label="Reference comparison canvas" tabindex="0"><div class="crop-stage"><img class="crop-image" src="${Mn(pn.comp.url)}" alt="Reference region for ${T(q.name)}" style="width:${100/q.box.w}%;left:${-100*q.box.x/q.box.w}%;top:${-100*q.box.y/q.box.h}%">${Un(pn,q)}</div></div></figure>
            <figure><figcaption>${L?`Previous · Round ${c.packet.round}`:p?"Assembled page":mn?"In context":c?`${Vn.caption} · Round ${n.round}`:Vn.caption}</figcaption><div class="pan-viewport" aria-label="Produced comparison canvas" tabindex="0"><div class="output crop-stage ${Le&&!mn&&!li&&Xn==="checker"?"checker":""}">${!li?`<img class="asset" src="${Mn(Ne)}" alt="Produced ${T(q.name)}" style="object-position:${T(q.preview.position??"center")}">`:`<iframe aria-hidden="true" title="Rendered ${T(q.name)}" src="${Mn(Ne)}" sandbox="" tabindex="-1" width="${pn.comp.width}" height="${pn.comp.height}"></iframe>`}${xn?`<img class="crop-image overlay-image" src="${Mn(pn.comp.url)}" alt="Reference overlay" style="width:${100/q.box.w}%;left:${-100*q.box.x/q.box.w}%;top:${-100*q.box.y/q.box.h}%">`:""}</div></div></figure>
          </div>
          ${Le||q.context?`<div class="view-controls">${q.context?`<div class="ks-instrument-strip is-paper" data-ks-strip="view" role="group" aria-label="Component view"><button type="button" class="ks-instrument-key" id="isolated" aria-pressed="${!mn}">${Ae?"Asset only":"Component only"}</button><button type="button" class="ks-instrument-key" id="context" aria-pressed="${mn}">In context</button></div>`:""}${Le?`<div class="background-options ks-instrument-strip is-paper" data-ks-strip="background" role="group" aria-label="Asset preview background"><button type="button" id="background-checker" class="ks-instrument-key" aria-label="Checkerboard background" title="Checkerboard background" aria-pressed="${Xn==="checker"}" ${mn?"disabled":""}>Checker</button><button type="button" id="background-page" class="ks-instrument-key" aria-label="${pn.comp.background?"Page color":"Neutral"} background" title="${pn.comp.background?"Page color":"Neutral"} background" aria-pressed="${Xn==="page"}" ${mn?"disabled":""}>Page</button></div>`:""}</div>`:""}
          </div></div>${!p&&!kn?`<div class="component-details"><div class="material">${fn(Vn.code?"code":"image")}<strong>${T(nr)}</strong><span>${q?.material?`${q.material.width} × ${q.material.height} px`:""}</span></div>${pn.stage==="components"&&Vn?.captured&&!q?.preview.isolation?'<p class="layering">Legacy region capture · may include overlapping components.</p>':""}${q?.context?.layering&&(Ae||mn)?`<p class="layering">${T(q.context.layering)}</p>`:""}
          <p class="component-note">${!di?.related.length?T(q.note):""}</p>
          </div>`:""}</div><div class="review-form">${k}${L?'<p class="previous-notice">Viewing the previous round. Return to Current to make a decision.</p>':""}${w?`<div class="record-verdict"><strong>${vn?.action==="approve"?"Approved":vn?.action==="revise"?"Changes requested":"Not reviewed"}</strong><span>Submitted in round ${n.round} · read-only</span></div>`:`<div class="decisions" role="group" aria-label="Decision for ${T($.name)}">${!p?`<div class="decision-title"><strong>Your review <span>Round ${n.round}</span></strong>${L?"<p>Return to Current to review this round.</p>":""}</div>`:""}<button id="approve" ${!h.length?"disabled":""} class="ks-button ks-button-primary decision-approve ${vn?.action==="approve"?"approved":""}" aria-pressed="${vn?.action==="approve"}">${p?v?"Sending…":`Approve & continue${Bn}`:h.length>1?`Approve ${h.length} instances`:"Looks good"}</button><button id="revise" ${!h.length?"disabled":""} class="ks-button ks-button-secondary decision-revise ${vn?.action==="revise"?"revise":""}" aria-pressed="${vn?.action==="revise"}">${h.length>1?`Revise ${h.length} instances`:"Needs work"}</button>${vn&&!p&&!kn?`<button id="clear" class="ks-icon-button" aria-label="Clear decision" title="Clear decision">${fn("undo")}</button>`:""}</div>`}
          ${r?`<form id="feedback-form"><div class="feedback-fields"><label class="feedback-field">What needs to change?<textarea id="feedback" aria-describedby="feedback-hint">${T(r.feedback)}</textarea></label><p id="feedback-hint" class="feedback-hint">Optional — leave blank for the agent to diagnose.</p>${!p?`<label class="check"><input id="split" type="checkbox" ${r.split?"checked":""}> Split into separately reviewable components</label>`:""}</div><div class="feedback-actions"><button id="cancel-feedback" type="button" class="ks-button ks-button-ghost">Cancel</button><button id="save-feedback" type="submit" class="ks-button ks-button-primary">${p?"Send feedback":f?"Save & finish review":"Save & next"}${Bn}</button><span class="shortcut-hint">${dn}</span></div></form>`:vn?.action==="revise"?`<p class="saved-feedback">${T(vn.feedback||"No note — agent will diagnose.")}</p>`:""}
          ${p?`<p class="page-review-status" role="status">${T(M||(w?"Your decision is saved.":v?"Sending…":r?"":"Approval confirms the composition and that nothing is missing."))}</p>`:""}</div>`:D?`<p>This piece will be added to the unresolved inventory.</p><label class="feedback-field">Name<input id="missing-name" value="${T(D.name)}"></label><label class="feedback-field">What is missing?<textarea id="missing-feedback">${T(D.feedback)}</textarea></label><div class="coordinates">${["x","y","w","h"].map((e)=>`<label>${{x:"Left",y:"Top",w:"Width",h:"Height"}[e]} %<input type="number" data-coordinate="${e}" value="${Math.round(D.box[e]*1000)/10}" min="0" max="100" step="0.1"></label>`).join("")}</div><button id="remove-missing">Remove this mark</button></div>`:"<p>No components supplied.</p></div>"}
        </section>
      </div>
      ${!p?`<section class="inventory-section ${en?"":"tray-collapsed"} ${W&&en?"tray-expanded":""}" aria-label="Component inventory"><div class="section-head"><h2>Components</h2><div class="inventory-filters ks-instrument-strip is-paper" data-ks-strip="filter" role="group" aria-label="Filter components"><button type="button" class="ks-instrument-key" data-filter="pending" aria-pressed="${b==="pending"}">To review <b>${te}</b></button><button type="button" class="ks-instrument-key" data-filter="reviewed" aria-pressed="${b==="reviewed"}">Reviewed <b>${Fi}</b></button><button type="button" class="ks-instrument-key" data-filter="all" aria-pressed="${b==="all"}">All <b>${F.length+t.missing.length}</b></button></div><div class="tray-actions"><button id="show-all" class="ks-icon-button" aria-pressed="${W}" aria-controls="component-tray" aria-label="${W?"Compact":"Expand"} tray" title="${W?"Compact":"Expand"} tray">${fn(W?"compact":"expand")}</button><button id="toggle-tray" class="ks-icon-button" aria-expanded="${en}" aria-controls="component-tray" aria-label="${en?"Hide":"Show"} component tray" title="${en?"Hide":"Show"} component tray">${fn(en?"hideTray":"showTray")}</button></div></div>
      <div id="component-tray" class="inventory ${W?"all":""}">${pi.map((e)=>{let d=F.find((cn)=>cn.members.some((gn)=>gn.id===e.id)),j=F.indexOf(d),E={kind:d.kind,label:d.stateLabel};return`<button class="item ${E.kind} ${!m&&tn?.id===d.id?"active":""}" data-select="${T(e.id)}" aria-pressed="${!m&&tn?.id===d.id}">${e.thumbnail?`<span class="item-thumb">${e.thumbnail.box?`<span class="thumb-crop" style="width:min(100%,${76*e.thumbnail.box.w*n.comp.width/(e.thumbnail.box.h*n.comp.height)}px);aspect-ratio:${e.thumbnail.box.w*n.comp.width}/${e.thumbnail.box.h*n.comp.height}"><img alt="" loading="lazy" src="${Mn(e.thumbnail.url)}" style="position:absolute;width:${100/e.thumbnail.box.w}%;max-width:none;left:${-100*e.thumbnail.box.x/e.thumbnail.box.w}%;top:${-100*e.thumbnail.box.y/e.thumbnail.box.h}%;"></span>`:`<img alt="" loading="lazy" src="${Mn(e.thumbnail.url)}">`}</span>`:""}<span class="item-number">${E.kind==="approved"?Zn:E.kind==="feedback"?on:""}${j+1}<span class="item-medium">${fn(Fn(e).code?"code":"image")}${T(Fn(e).label)}</span></span><strong>${T(Ci(e.id))}${d.members.length>1?` <small>×${d.members.length}</small>`:""}</strong><span class="state ${E.kind}">${T(E.label)}</span></button>`}).join("")}${(b==="pending"?[]:t.missing).map((e,d)=>`<button class="item feedback ${g===e.id?"active":""}" data-select="${T(e.id)}"><span class="item-number">${F.length+d+1}</span><strong>${T(e.name)}</strong><span class="state revise">Missing</span></button>`).join("")}${!pi.length&&(b==="pending"||!t.missing.length)?`<p class="inventory-empty">${b==="pending"?"Nothing left to review. Your decisions are ready.":"No components reviewed yet."}</p>`:""}</div></section>`:""}
      ${p?"":w?`<footer class="record-footer"><span>Round ${n.round} submitted · read-only</span><span>${x.approved} approved · ${x.revisions} changes requested</span></footer>`:`<footer class="${!x.pending&&!s?"queue-complete":""}"><div>${!x.pending&&!s?`<button id="show-summary" class="completion-link">${Zn}${w?"Review sent":"All components reviewed"}</button>`:""}<button id="approve-rest" class="ks-button ks-button-secondary" ${!x.pending?"hidden":""} ${!x.pending||s?"disabled":""}>Approve ${x.approved||x.revisions?"remaining":"all"}</button><label class="check ks-checkbox"><input id="inventory-confirm" type="checkbox" ${t.inventoryConfirmed?"checked":""}> Nothing missing from the comp</label></div><div class="submit-area"><p role="status">${T(Si)}</p><button id="submit" class="ks-button ks-button-primary" ${!x.canSubmit||s||v||w?"disabled":""}>${v?"Sending…":w?"Review sent":x.hasFeedback?"Send feedback":"Approve & continue"}${v||w?"":Bn}</button></div></footer>`}
    </section><dialog id="comparison-dialog" aria-label="${p?"Enlarged page comparison":"Enlarged component comparison"}"></dialog>`;let sn=a.querySelector("#comparison-dialog"),un=a.querySelector(".comparison-panel"),_n=a.querySelector(".comparison-slot"),En=a.querySelector(".inspector > .review-form"),er=a.querySelector(".inspector"),xi=()=>{if(sn.append(un),En)sn.append(En)};if(U&&un&&_n)_n.style.height=`${Qe}px`,xi(),sn.showModal();if(L)a.querySelectorAll(".decisions button,#feedback,#split,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#submit,#inventory-confirm").forEach((e)=>e.disabled=!0);if(a.querySelector(".inspection-content").scrollTop=$e,w||v)a.querySelectorAll(".decisions button,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#mark,#inventory-confirm,#missing-name,#missing-feedback,#feedback,#split,#remove-missing,[data-coordinate]").forEach((e)=>e.disabled=!0);let hi=a.querySelector(".inventory");if(hi)hi.scrollLeft=Gn;if(!P&&en)Array.from(a.querySelectorAll(".inventory [data-select]")).find((e)=>e.dataset.select===g)?.scrollIntoView({block:"nearest",inline:"nearest"});if(J)a.getElementById(J)?.focus({preventScroll:!0});else if(K)Array.from(a.querySelectorAll(".item[data-select]")).find((e)=>e.dataset.select===K)?.focus({preventScroll:!0});let B=(e,d)=>a.querySelector(`#${e}`)?.addEventListener("click",d);function Ke(e,d=!1,j=!1){if(z)return;if(!j)e=F.find((E)=>E.members.some((cn)=>cn.id===e))?.representative.id??e;if(Z=!j,m=!1,g=e,I="component",xn=!1,ln="fit",qn="isolated",C=!1,G(),d)a.querySelector("#expand-comparison")?.click()}a.querySelectorAll("[data-select]").forEach((e)=>e.onclick=()=>Ke(e.dataset.select,e.classList.contains("pin")&&n.components.some((d)=>d.id===e.dataset.select))),B("previous-round",()=>{C=!0,G()}),B("current-round",()=>{C=!1,G()}),B("review-changes",()=>{let e=y().filter((E)=>Ue(E).kind==="pending"),d=e.findIndex((E)=>E.id===g),j=e[(d+1)%e.length];if(j)Z=!0,m=!1,g=j.id,I="component",b="pending",C=!1,ln="fit",xn=!1,qn="isolated",G()}),a.querySelectorAll("[data-filter]").forEach((e)=>e.onclick=()=>{b=e.dataset.filter,m=!x.pending&&b==="pending";let d=F.filter((E)=>b==="all"||E.kind==="pending"===(b==="pending")).map((E)=>E.representative);if(!(b!=="pending"&&t.missing.some((E)=>E.id===g))&&!d.some((E)=>E.id===g)&&d.length)Z=!0,g=d[0].id,I="component",C=!1,ln="fit",xn=!1,qn="isolated";G()}),B("show-summary",()=>{m=!0,I="component",b="reviewed",G(),Jn("review-summary")}),B("approve",()=>On("approve")),B("revise",de),B("clear",()=>{if($)delete t.decisions[$.id],delete u[$.id];Q=null,m=!1,b="pending",G()}),B("cancel-feedback",()=>{if($)delete u[$.id];if(Tn)en=!0,Tn=!1;G(),Jn("revise")}),a.querySelector("#feedback-form")?.addEventListener("submit",(e)=>{e.preventDefault(),On("revise")}),a.querySelector("#feedback")?.addEventListener("keydown",(e)=>{let d=e;if(d.key==="Enter"&&(d.metaKey||d.ctrlKey)&&!d.isComposing)d.preventDefault(),d.stopPropagation(),On("revise")}),B("undo-decision",()=>{if(!Q||v||w)return;let e=Q;for(let[d,j]of Object.entries(e.previous))if(j)t.decisions[d]=j;else delete t.decisions[d];delete u[e.id],g=e.id,m=!1,C=!1,I="component",b="all",Q=null,G(),Jn("approve")}),B("all-instances",()=>{Z=!0,g=tn.representative.id,C=!1,G()}),a.querySelectorAll("[data-instance]").forEach((e)=>e.onclick=()=>Ke(e.dataset.instance,!1,!0)),B("overlay",()=>{xn=!xn,G()}),B("isolated",()=>{qn="isolated",G()}),B("context",()=>{qn="context",G()}),a.querySelectorAll("[data-zoom]").forEach((e)=>e.addEventListener("click",()=>{let d=e.dataset.zoom;ln=d==="fit"?"fit":Number(d),G()})),B("background-checker",()=>{Xn="checker",G()}),B("background-page",()=>{Xn="page",G()}),B("show-all",()=>{W=!W,en=!0,G()}),B("toggle-tray",()=>{Tn=!1,en=!en,G()}),B("show-comp",()=>{I="comp",G()}),B("show-component",()=>{I="component",G()}),B("mark",()=>{z=!z,G()}),B("add-box",()=>ie({x:0.35,y:0.35,w:0.2,h:0.2})),B("remove-missing",()=>{t.missing=t.missing.filter((e)=>e.id!==g),g=n.components[0]?.id,G()}),B("approve-rest",()=>{if(s)return;t=wi(n,t),Q=null,m=!0,b="reviewed",I="component",G(),Jn("review-summary")}),a.querySelector("#inventory-confirm")?.addEventListener("change",(e)=>{t.inventoryConfirmed=e.target.checked,G()}),a.querySelector("#feedback")?.addEventListener("input",(e)=>{if($&&u[$.id])u[$.id].feedback=e.target.value}),a.querySelector("#split")?.addEventListener("change",(e)=>{if($&&u[$.id])u[$.id].split=e.target.checked}),a.querySelector("#missing-name")?.addEventListener("input",(e)=>{if(D)D.name=e.target.value;let d=a.querySelector("#submit");if(d)d.disabled=s||v||w||!Cn(n,t).canSubmit}),a.querySelector("#missing-feedback")?.addEventListener("input",(e)=>{if(D)D.feedback=e.target.value}),a.querySelectorAll("[data-coordinate]").forEach((e)=>e.addEventListener("change",()=>{if(!D)return;let d=e.dataset.coordinate,j=Number(e.value)/100;if(Number.isFinite(j))D.box[d]=Math.max(d==="w"||d==="h"?0.001:0,Math.min(1,j));D.box.w=Math.min(D.box.w,1-D.box.x),D.box.h=Math.min(D.box.h,1-D.box.y),G()})),B("submit",()=>{$n()});let wn=a.querySelector(".map");function _e(e){let d=wn.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-d.left)/d.width)),y:Math.max(0,Math.min(1,(e.clientY-d.top)/d.height))}}function ki(e){let d=_e(e);return n.components.filter(({box:j})=>d.x>=j.x&&d.x<=j.x+j.w&&d.y>=j.y&&d.y<=j.y+j.h).sort((j,E)=>j.box.w*j.box.h-E.box.w*E.box.h)[0]}wn?.addEventListener("click",(e)=>{if(z||e.target.closest("[data-select]"))return;let d=ki(e);if(d)Ke(d.id,!0)}),wn?.addEventListener("pointermove",(e)=>{if(!z)wn.style.cursor=ki(e)?"zoom-in":""}),wn?.addEventListener("pointerdown",(e)=>{if(!z)return;N=_e(e),wn.setPointerCapture(e.pointerId),e.preventDefault()}),wn?.addEventListener("pointermove",(e)=>{if(!N)return;let d=_e(e);hn={x:Math.min(N.x,d.x),y:Math.min(N.y,d.y),w:Math.abs(d.x-N.x),h:Math.abs(d.y-N.y)};let j=a.querySelector(".draw-box");j.hidden=!1,j.style.cssText=In(hn)}),wn?.addEventListener("pointerup",()=>{if(hn&&hn.w>0.01&&hn.h>0.01)ie(hn);else N=null,hn=null}),wn?.addEventListener("pointercancel",()=>{N=null,hn=null,G()});let gi=a.querySelector(".output"),ge=a.querySelector("iframe"),vi=a.querySelector(".workbench"),Dn=a.querySelector(".inspection-content"),Be=a.querySelector(".inspector");function He(){if(!Dn||!Be)return;Be.dataset.scrollAbove=String(Dn.scrollTop>1),Be.dataset.scrollBelow=String(Dn.scrollHeight-Dn.clientHeight-Dn.scrollTop>1)}Dn?.addEventListener("scroll",He,{passive:!0});function ve(){let e=a.querySelector(".map-space");if(e&&e.clientWidth&&e.clientHeight){let _=Ie(n.comp.width,n.comp.height,Math.max(1,e.clientWidth-32),Math.max(1,e.clientHeight-32),"fit");wn.style.width=`${_.width}px`,wn.style.height=`${_.height}px`}let d=a.querySelector(".inspection-content"),j=Array.from(a.querySelectorAll(".pan-viewport"));if(d?.clientHeight){let _=U?Math.max(100,sn.clientHeight-(un?.querySelector(".compare-toolbar")?.clientHeight??0)-(un?.querySelector(".expanded-title")?.clientHeight??0)-(un?.querySelector(".view-controls")?.clientHeight??0)-(En?.getBoundingClientRect().height??0)-124):Math.min(p?Number.POSITIVE_INFINITY:248,Math.max(100,d.clientHeight-((j[0]?.getBoundingClientRect().top??d.getBoundingClientRect().top)-d.getBoundingClientRect().top+d.scrollTop)-(un?.querySelector(".view-controls")?.clientHeight??0)-12));j.forEach((S)=>S.style.height=`${_}px`)}if(q&&j.length&&!kn){let _=Ie(q.box.w*pn.comp.width,q.box.h*pn.comp.height,Math.min(...j.map((S)=>S.clientWidth)),Math.min(...j.map((S)=>S.clientHeight)),ln);a.querySelectorAll(".crop-stage").forEach((S)=>{S.style.width=`${_.width}px`,S.style.height=`${_.height}px`})}if(j.forEach((_)=>{let S=_.scrollWidth>_.clientWidth+1||_.scrollHeight>_.clientHeight+1;_.classList.toggle("pannable",S),_.style.cursor=U?"":"zoom-in",_.setAttribute("role",U?"region":"button"),_.title=U?S?"Move your pointer to pan. You can also scroll, swipe, or use arrow keys.":"":"Click to enlarge comparison"}),gi&&ge&&q){let _=gi.clientWidth/(q.box.w*pn.comp.width);ge.style.transform=`scale(${_})`,ge.style.left=`${-q.box.x*pn.comp.width*_}px`,ge.style.top=`${-q.box.y*pn.comp.height*_}px`}let E=vi.getBoundingClientRect(),cn=a.querySelector(".region"),gn=a.querySelector(".number"),ce=a.querySelector(".connector path");if(cn&&gn&&ce){let _=cn.getBoundingClientRect(),S=gn.getBoundingClientRect(),be=_.right-E.left,nn=_.top+_.height/2-E.top,se=S.left-E.left-8,me=S.top+S.height/2-E.top;ce.setAttribute("d",`M ${be} ${nn} H ${se-14} V ${me} H ${se}`)}}function Rn(e,d){if(!un||!_n||e===U)return;let j=a.querySelector("#expand-comparison"),E=(U?sn:un).getBoundingClientRect(),cn=window.matchMedia("(prefers-reduced-motion: reduce)").matches,gn=un.querySelector(".pan-viewport"),ce=gn?gn.scrollLeft/Math.max(1,gn.scrollWidth-gn.clientWidth):0,_=gn?gn.scrollTop/Math.max(1,gn.scrollHeight-gn.clientHeight):0,S=()=>un.querySelectorAll(".pan-viewport").forEach((nn)=>{nn.scrollLeft=ce*Math.max(0,nn.scrollWidth-nn.clientWidth),nn.scrollTop=_*Math.max(0,nn.scrollHeight-nn.clientHeight)}),be=()=>{if(_n.append(un),En)er.append(En),En.inert=!1;sn.close(),_n.style.height="",Qn=!1,U=!1,j.innerHTML=fn("expand"),j.setAttribute("aria-label","Enlarge comparison"),j.title="Enlarge comparison",j.setAttribute("aria-expanded","false"),ve(),S(),j.focus({preventScroll:!0}),d?.()};if(e){_n.style.height=`${E.height}px`,xi(),sn.showModal(),U=!0,j.innerHTML=fn("compact"),j.setAttribute("aria-label","Restore comparison"),j.title="Restore comparison (Esc)",j.setAttribute("aria-expanded","true"),ve(),S(),j.focus({preventScroll:!0});let nn=sn.getBoundingClientRect();if(!cn)sn.animate([{transform:`translate(${E.x-nn.x}px,${E.y-nn.y}px) scale(${E.width/nn.width},${E.height/nn.height})`,opacity:0.6},{transform:"none",opacity:1}],{duration:240,easing:"cubic-bezier(.2,.8,.2,1)"})}else{if(j.disabled)return;let nn=_n.getBoundingClientRect();if(cn){be();return}if(j.disabled=!0,Qn=!0,En)En.inert=!0;let se=sn.animate([{transform:"none",opacity:1},{transform:`translate(${nn.x-E.x}px,${nn.y-E.y}px) scale(${nn.width/E.width},${nn.height/E.height})`,opacity:0.6}],{duration:200,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});sn.inert=!0;let me=()=>{if(se.cancel(),j.disabled=!1,sn.inert=!1,sn.isConnected)be();else Qn=!1,U=!1,G(),d?.()};se.finished.then(me,me)}}if(Yn=(e)=>Rn(!1,e),B("expand-comparison",()=>Rn(!U)),sn.addEventListener("cancel",(e)=>{e.preventDefault(),e.stopPropagation(),Rn(!1)}),sn.addEventListener("keydown",(e)=>{if(e.key==="Escape")e.preventDefault(),e.stopPropagation(),Rn(!1)}),ne=Ye(a),an=new ResizeObserver(()=>{ve(),He()}),an.observe(vi),an.observe(sn),En)an.observe(En);let ui=a.querySelector(".inspection-content");if(ui)an.observe(ui);let ci=a.querySelector(".repair-context");if(ci)an.observe(ci);let bi=un?.querySelector(".compare-toolbar");if(bi)an.observe(bi);ve();let ue=Array.from(a.querySelectorAll(".pan-viewport"));if(ue.forEach((e)=>{e.scrollLeft=A,e.scrollTop=ke}),ue.forEach((e)=>{e.querySelectorAll("img").forEach((d)=>d.draggable=!1),e.addEventListener("click",()=>{if(!U)Rn(!0)}),e.addEventListener("pointermove",(d)=>{if(d.pointerType!=="mouse"||d.buttons||!e.classList.contains("pannable"))return;let j=e.getBoundingClientRect();e.scrollLeft=Oe(d.clientX,j.left,e.clientWidth,e.scrollWidth),e.scrollTop=Oe(d.clientY,j.top,e.clientHeight,e.scrollHeight)}),e.addEventListener("keydown",(d)=>{if(!U&&(d.key==="Enter"||d.key===" ")){d.preventDefault(),d.stopPropagation(),Rn(!0);return}let E={ArrowLeft:[-48,0],ArrowRight:[48,0],ArrowUp:[0,-48],ArrowDown:[0,48]}[d.key];if(!E)return;d.preventDefault(),d.stopPropagation(),e.scrollLeft+=E[0],e.scrollTop+=E[1]})}),ue.forEach((e)=>e.addEventListener("scroll",()=>{for(let d of ue)if(d!==e){if(d.scrollLeft!==e.scrollLeft)d.scrollLeft=e.scrollLeft;if(d.scrollTop!==e.scrollTop)d.scrollTop=e.scrollTop}})),re&&window.matchMedia("(max-width:800px)").matches){let e=a.querySelector(".inspection-content"),d=a.querySelector(".compare");if(e&&d)e.scrollTop+=d.getBoundingClientRect().top-e.getBoundingClientRect().top}if(He(),window.scrollTo(H,R),!w)o.onDraftChange?.(structuredClone(t))}return G(),{destroy(){an?.disconnect(),ne?.(),a.replaceChildren()},getDraft(){return structuredClone(t)}}}function sr(){let i=document.createElement("style");i.textContent=[["Albert Sans","albertsans"],["Alumni Sans","alumnisans"],["JetBrains Mono","jetbrainsmono"]].map(([n,o])=>`@font-face{font-family:"${n}";src:url(/fonts/${o}.ttf);font-weight:100 900}`).join(""),document.head.append(i)}function pr(i){let n=document.createElement("div");n.setAttribute("role","alert"),n.style.cssText="max-width:560px;margin:18vh auto 0;padding:0 0 0 18px;border-left:2px solid var(--ks-vermilion,oklch(52% 0.16 35));color:var(--ks-text,oklch(22% 0 0));font:400 15px/1.55 var(--font-sans,Arial,sans-serif)";let o=document.createElement("p");o.textContent="Review unavailable",o.style.cssText="margin:0 0 8px;font:400 11px/1.3 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:var(--ks-text-muted,oklch(46% 0 0))";let a=document.createElement("strong");a.textContent="The review could not be opened.",a.style.cssText="display:block;font-weight:500;color:var(--ks-ink,oklch(13% 0 0))";let t=document.createElement("p");t.style.cssText="margin:4px 0 18px;color:var(--ks-text-muted,oklch(46% 0 0))",t.textContent=`${i} If the review server stopped, ask the agent to serve the review again, then reload.`;let p=document.createElement("button");return p.textContent="Reload",p.style.cssText="font:500 15px/1 var(--font-sans,Arial,sans-serif);min-height:44px;padding:0 22px;border:1px solid oklch(13% 0 0);border-radius:3px;background:oklch(13% 0 0);color:oklch(99.5% 0 0);cursor:pointer",p.onclick=()=>location.reload(),n.append(o,a,t,p),n}async function lr(){sr();let i=document.getElementById("review"),n=await fetch("/packet",{cache:"no-store"});if(!n.ok)throw Error("The review packet could not be loaded.");let o=await n.json(),a=Me(o.packet);if(o.sourceStatus&&!a){let t=document.createElement("p");t.textContent=o.sourceStatus,i.before(t)}Ri(i,o.packet,{initialDraft:o.draft,history:o.history,completed:!!o.receipt,status:a?o.sourceStatus:null,onSubmit:async(t)=>{let p=await fetch("/decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)}),y=await p.json().catch(()=>({}));if(!p.ok)throw Error(y.error??"The review could not be saved. Try again.")}})}lr().catch((i)=>{document.getElementById("review")?.replaceChildren(pr(i instanceof Error?i.message:String(i)))});})();
