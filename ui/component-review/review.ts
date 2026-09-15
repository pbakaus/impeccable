import { inReviewQueue, type InventoryFilter, componentPresentation, nextUnreviewed, approveRemaining, componentState, repairStatus, newDraft, submission, summarize, type Box, type Decision, type Draft, type ReviewPacket, type ReviewHistory } from './model';
import { comparisonSize, hoverPan } from './viewport';
import { styles } from './styles';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const pct = (n: number) => `${n * 100}%`;
// Only trusted adapter URLs may enter frames/images. Never accept javascript: or executable data URLs.
const url = (s: string) => {
  const parsed = new URL(s, location.href);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported preview URL');
  return esc(parsed.href);
};
export function mountComponentReview(host: HTMLElement, packet: ReviewPacket, options: {
  preview?: boolean; history?: ReviewHistory | null; initialDraft?: Draft; completed?: boolean; onDraftChange?: (draft: Draft) => void; onSubmit: (value: ReturnType<typeof submission>) => Promise<void>;
}) {
  const root = host.attachShadow({mode: 'open'});
  let draft = structuredClone(options.initialDraft ?? newDraft(packet));
  const orderedComponents = () => [...packet.components].sort((a,b)=>componentState(a,draft,options.history).priority-componentState(b,draft,options.history).priority);
  let selected = orderedComponents().find(c=>componentState(c,draft,options.history).kind!=='approved')?.id ?? packet.components[0]?.id;
  let inventoryFilter: InventoryFilter = summarize(packet,draft).pending ? 'pending' : 'reviewed';
  let marking = false;
  let sending = false;
  let submitted = options.completed ?? false;
  let error = '';
  const edits: Record<string, {feedback: string; split: boolean}> = {};
  let finished = !!options.completed || !summarize(packet,draft).pending;
  let lastDecision: {id: string; name: string; action: 'approve' | 'revise'; previous?: Decision} | null = null;
  const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘Enter' : 'Ctrl+Enter';
  let overlay = false;
  let expandedComparison = false;
  let showAll = false;
  let trayOpen = true;
  let restoreTrayAfterFeedback = false;
  let mobilePane: 'comp' | 'component' = 'comp';
  let renderedMobilePane = mobilePane as 'comp' | 'component';
  let zoom: 'fit' | number = 'fit';
  let backdrop: 'checker' | 'page' = 'checker';
  let previousRound = false;
  let outputMode: 'isolated' | 'context' = 'isolated';
  let renderedSelection: string | undefined;
  let renderedZoom: 'fit' | number = 'fit';
  let drag: { x: number; y: number } | null = null;
  let dragBox: Box | null = null;
  let resize: ResizeObserver | null = null;
  const checkIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';
  const feedbackIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11 1 2 2-1 7-7-3-3-7 7v2Z"/></svg>';
  const boxStyle = (b: Box) => `left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)}`;
  function focusReview(id: string) {
    root.getElementById(id)?.focus({preventScroll:true});
  }
  function advance(after: string) {
    const next = nextUnreviewed(packet, draft, after);
    finished = !next;
    if (next) selected = next;
    mobilePane='component'; previousRound=false; overlay=false; zoom='fit'; outputMode='isolated';
    inventoryFilter = finished ? 'reviewed' : 'pending';
    render();
    focusReview(finished ? 'review-summary' : edits[selected!] ? 'feedback' : 'approve');
  }
  function updateDecision(action: 'approve' | 'revise') {
    if (sending || submitted || previousRound) return;
    const c = packet.components.find(c => c.id === selected);
    if (!c) return;
    const saved = draft.decisions[c.id];
    const current = saved?.revision===c.revision ? saved : undefined;
    lastDecision = {id:c.id, name:c.name, action, previous:saved ? {...saved} : undefined};
    const note = edits[c.id] ?? current;
    draft.decisions[c.id] = {revision:c.revision, action, feedback:action==='revise' ? note?.feedback ?? '' : '', split:action==='revise' && (note?.split ?? false)};
    delete edits[c.id];
    if(restoreTrayAfterFeedback){trayOpen=true;restoreTrayAfterFeedback=false;}
    advance(c.id);
  }
  function beginFeedback() {
    if (sending || submitted || previousRound) return;
    const c = packet.components.find(c=>c.id===selected);
    if (!c) return;
    const saved = draft.decisions[c.id];
    const current = saved?.revision===c.revision ? saved : undefined;
    edits[c.id] ??= {feedback:current?.feedback ?? '',split:current?.split ?? false};
    if(trayOpen && (root.querySelector('.workbench')?.clientHeight ?? 0)<420){restoreTrayAfterFeedback=true;trayOpen=false;}
    finished=false;
    render();
    focusReview('feedback');
  }
  function addMissing(box: Box) {
    const id = `missing-${crypto.randomUUID()}`;
    draft.missing.push({ id, name:'Missing component', feedback:'', box });
    draft.inventoryConfirmed = false;
    finished=false; selected = id; mobilePane='component'; marking = false; drag = null; dragBox = null;
    render();
    root.querySelector<HTMLInputElement>('#missing-name')?.focus();
  }
  function render() {
    resize?.disconnect();
    const active = root.activeElement as HTMLElement | null;
    const focusId = active?.id;
    const focusSelection = active?.dataset.select;
    const scrollX = window.scrollX, scrollY = window.scrollY;
    const railLeft = root.querySelector('.inventory')?.scrollLeft ?? 0;
    const keepInspector=renderedSelection===selected;
    const focusMobileComparison=mobilePane==='component'&&(!keepInspector||renderedMobilePane!==mobilePane);
    renderedMobilePane=mobilePane;
    const inspectorTop=keepInspector?(root.querySelector('.inspection-content')?.scrollTop??0):0;
    const filesOpen=keepInspector&&(root.querySelector<HTMLDetailsElement>('.changed-files')?.open??false);
    const oldComparisonHeight=root.querySelector<HTMLElement>('.comparison-slot')?.clientHeight ?? 200;
    const oldPane=root.querySelector<HTMLElement>('.pan-viewport');
    const retainPan=renderedSelection===selected&&renderedZoom===zoom;
    const panLeft=retainPan?(oldPane?.scrollLeft??0):0, panTop=retainPan?(oldPane?.scrollTop??0):0;
    renderedSelection=selected;renderedZoom=zoom;
    const c = packet.components.find(c => c.id === selected);
    const missing = draft.missing.find(m => m.id === selected);
    const box = c?.box ?? missing?.box;
    const index = c ? packet.components.indexOf(c) + 1 : packet.components.length + draft.missing.findIndex(m => m.id === selected) + 1;
    const savedDecision = c ? draft.decisions[c.id] : undefined;
    const d = savedDecision?.revision === c?.revision ? savedDecision : undefined;
    const edit = c ? edits[c.id] : undefined;
    const uncommitted = Object.keys(edits).length > 0;
    const isLast = c ? !packet.components.some(item=>item.id!==c.id && componentState(item,draft).kind==='pending') : false;
    const notice = lastDecision && !submitted ? `<div class="decision-notice"><span role="status">${esc(lastDecision.name)} ${lastDecision.action==='approve'?'approved':'flagged for repair'}.</span><button id="undo-decision" class="quiet">Undo</button></div>` : '';
    const stats = summarize(packet, draft);
    const history = options.history;
    const repair = c ? repairStatus(c.id, history) : undefined;
    const priorComponent = history?.packet.components.find(item=>item.id===c?.id);
    const viewingPrevious = previousRound && !!priorComponent;
    const v = viewingPrevious ? priorComponent : c;
    const vp = viewingPrevious ? history!.packet : packet;
    const changes = Object.values(history?.changes??{});
    const changedCount = changes.filter(change=>change.kind==='changed').length;
    const addedCount = changes.filter(change=>change.kind==='added').length;
    const carriedCount = packet.components.filter(item=>componentState(item,draft,history).kind==='approved'&&repairStatus(item.id,history).carried).length;
    const stateFor = (item: typeof packet.components[number]) => {
      const state=componentState(item,draft,history);
      return submitted&&state.kind==='feedback'?{...state,label:'Changes requested'}:state;
    };
    const reviewedCount = stats.approved+stats.revisions+draft.missing.length;
    const shownComponents = (inventoryFilter==='pending'?orderedComponents():packet.components).filter(item=>inReviewQueue(item,draft,inventoryFilter));
    const summaryDetails = [
      stats.revisions+draft.missing.length ? `${stats.revisions+draft.missing.length} feedback ready` : '',
      carriedCount ? `${carriedCount} ${carriedCount===1?'approval':'approvals'} kept` : '',
      changedCount ? `${changedCount} changed` : '',
      addedCount ? `${addedCount} added` : '',
      history?.removed.length ? `${history.removed.length} removed` : '',
    ].filter(Boolean).join(' · ');
    const statusMessage = error || (uncommitted ? 'Save or cancel your open feedback before sending.' : submitted ? (options.preview ? 'Preview submitted. No run changed.' : 'Review submitted.') : stats.hasFeedback ? 'Ready to send for corrections.' : stats.pending ? `${stats.pending} left to review` : !draft.inventoryConfirmed ? 'Confirm the map is complete.' : 'Ready to continue.');
    const presentation = v ? componentPresentation(v) : null;
    const isRaster = v?.preview.kind === 'image' && !presentation?.code;
    const hasTransparency = isRaster || v?.material?.alpha === 'transparent';
    const useContext = !!(v?.context && outputMode === 'context');
    const useFrame = v && (useContext ? v.context?.kind !== 'image' : v.preview.kind === 'page');
    const sourceUrl = useContext && v?.context ? v.context.url : v?.preview.url;
    const materialLabel = presentation?.code ? `${presentation.label} · ${presentation.captured ? 'captured from code' : 'live preview'}` : v?.material ? `${v.material.alpha === 'transparent' ? 'Transparent' : v.material.alpha === 'opaque' ? 'Opaque' : 'Transparency unverified'} ${v.material.format}` : 'Raster · transparency unverified';
    root.innerHTML = `<style>${styles}</style><section class="review" aria-label="Component review" style="--comp-background:${/^#[0-9a-f]{6}$/i.test(packet.comp.background ?? '') ? packet.comp.background : '#eeeeee'}">
      <header><div><h1>${submitted?'Review record.':'Review the components.'}</h1><p>${esc(packet.title)} <span>· Round ${packet.round}</span></p></div>${submitted ? '<span class="badge">Submitted · read-only</span>' : options.preview ? '<span class="badge">Interactive preview</span>' : ''}</header>
      ${options.preview ? '<p class="preview-note">Historical hotel artwork for testing this interface. Decisions stay in this preview; no run is changed.</p>' : ''}
      ${history ? `<section class="round-summary" aria-label="Changes since previous round"><p><strong>${stats.pending} ${stats.pending===1?'component':'components'} to review</strong><span>${summaryDetails}</span></p>${stats.pending?`<button id="review-changes" class="icon-button" aria-label="Next to review" title="Next to review">${icon('next')}</button>`:''}${history.removed.length?`<details><summary>Removed from the map</summary><p>${history.removed.map(item=>esc(item.name)).join(' · ')}. Confirm these omissions are intentional before accepting the map.</p></details>`:''}</section>`:''}
      <div class="mobile-panes" role="group" aria-label="Inspection view"><button id="show-comp" aria-pressed="${mobilePane==='comp'}">Approved comp</button><button id="show-component" aria-pressed="${mobilePane==='component'}">Component ${index}</button></div>
      <div class="workbench" data-mobile-pane="${mobilePane}"><svg class="connector" aria-hidden="true"><path /></svg>
        <section class="reference" aria-label="Approved composition">
          <div class="section-head"><h2>Approved comp</h2>${!submitted?`<button id="mark" class="label-icon" aria-pressed="${marking}">${icon(marking?'close':'mark')}${marking ? 'Cancel' : 'Mark missing'}</button>`:''}</div>
          <div class="map-space"><div class="map ${marking ? 'marking' : ''}" style="aspect-ratio:${packet.comp.width}/${packet.comp.height}">
            <img class="comp" src="${url(packet.comp.url)}" alt="Approved composition for ${esc(packet.title)}" draggable="false">
            ${box && !finished ? `<div class="region" style="${boxStyle(box)}"></div>` : ''}
            ${packet.components.map((item,i) => {const state=stateFor(item);return `<button class="pin ${state.kind} ${!finished && selected === item.id ? 'selected' : ''}" data-select="${esc(item.id)}" style="left:${pct(Math.min(.96, item.box.x+item.box.w/2))};top:${pct(Math.max(.035,item.box.y))}" aria-label="Inspect ${esc(item.name)} — ${esc(state.label)}" title="${i+1}. ${esc(item.name)} · ${esc(state.label)}" aria-pressed="${!finished && selected === item.id}">${state.kind==='approved'?checkIcon:state.kind==='feedback'?feedbackIcon:''}<span>${i+1}</span></button>`}).join('')}
            ${draft.missing.map((item,i)=>`<button class="pin feedback ${!finished&&selected===item.id?'selected':''}" data-select="${esc(item.id)}" style="left:${pct(item.box.x+item.box.w/2)};top:${pct(item.box.y)}" aria-label="Inspect missing ${esc(item.name)}" title="Missing: ${esc(item.name)}">${feedbackIcon}<span>${packet.components.length+i+1}</span></button>`).join('')}

            <div class="draw-box" hidden></div>
          </div></div>
          <div class="map-legend" aria-label="Map status legend"><span><i class="legend-pending">#</i> To review</span><span><i class="legend-feedback">${feedbackIcon}</i> ${submitted?'Changes requested':'Feedback ready'}</span><span><i class="legend-approved">${checkIcon}</i> Approved</span></div>
          ${marking ? '<div class="map-caption">Draw around the missing piece.<button id="add-box">Add an adjustable box</button></div>' : ''}
        </section>
        <section class="inspector" aria-label="Selected component">
          <div class="section-head"><h2>${finished ? 'Review summary' : `<span class="number">${index}</span> ${esc(c?.name ?? missing?.name ?? 'Component')}`}</h2></div><div class="inspection-content" role="region" aria-label="Component comparison" tabindex="0">
          ${finished ? `<section class="review-summary" id="review-summary" tabindex="-1"><div class="completion-mark" aria-hidden="true">${checkIcon}</div><h2>${submitted ? 'Review sent.' : 'All components reviewed.'}</h2><p>${stats.approved} approved · ${stats.revisions} flagged for repair${draft.missing.length ? ` · ${draft.missing.length} missing` : ''}</p><p>${submitted ? 'Your decisions are saved.' : stats.hasFeedback ? 'Send your feedback to start the next repair round.' : 'Confirm nothing is missing, then approve and continue.'}</p><div class="summary-decisions">${packet.components.map(item=>{const decision=draft.decisions[item.id];const state=stateFor(item);return `<button data-select="${esc(item.id)}"><strong>${esc(item.name)}</strong><span>${state.kind==='pending' ? 'Not reviewed' : state.kind==='feedback' ? 'Needs work' : 'Approved'}</span>${decision?.action==='revise' ? `<small>${esc(decision.feedback || 'No note — agent will diagnose.')}</small>` : ''}</button>`;}).join('')}${draft.missing.map(item=>`<button data-select="${esc(item.id)}"><strong>${esc(item.name)}</strong><span>Missing</span><small>${esc(item.feedback)}</small></button>`).join('')}</div></section></div>${notice?`<div class="review-form">${notice}</div>`:''}` : c ? `<div class="material">${icon(presentation!.code ? 'code' : 'image')}<strong>${esc(materialLabel)}</strong><span>${v?.material ? `${v.material.width} × ${v.material.height} px` : ''}</span></div>
          ${history ? `<div class="repair-context">
            ${repair?.prior?.action==='revise'?`<section class="previous-feedback" aria-label="Previous feedback"><h3>Previous feedback <span>Round ${repair.feedbackRound}</span></h3><p class="previous-verdict">Needs work</p><blockquote>${esc(repair.prior.feedback || 'No written feedback was supplied.')}</blockquote>${repair.prior.split?'<p>Requested: split into separately reviewable components.</p>':''}</section>`:repair?.carried?`<p class="kept-approval">Unchanged · approval kept</p>`:''}
            ${repair?.change?.kind==='changed'?`<details class="changed-files" ${filesOpen?'open':''}><summary>${repair.change.files.length?`${repair.change.files.length} changed ${repair.change.files.length===1?'file':'files'}`:repair.change.reasons.includes('region')?'Region changed':priorComponent?.note!==c.note?'Description changed · files unchanged':'Component definition changed · files unchanged'}</summary>${repair.change.files.length?`<ul>${repair.change.files.map(path=>`<li>${esc(path)}</li>`).join('')}</ul>`:''}${priorComponent&&priorComponent.note!==c.note?`<dl class="description-diff"><dt>Previous description</dt><dd>${esc(priorComponent.note)}</dd><dt>Current description</dt><dd>${esc(c.note)}</dd></dl>`:''}</details>`:''}
          </div>`:''}
          ${priorComponent?`<div class="preview-round"><div class="round-switch" role="group" aria-label="Preview version"><button id="current-round" aria-pressed="${!viewingPrevious}">Current · round ${packet.round}</button><button id="previous-round" aria-pressed="${viewingPrevious}">Previous · round ${history!.packet.round}</button></div></div>`:''}
          <div class="comparison-slot"><div class="comparison-panel"><h2 class="expanded-title">${esc(v!.name)}</h2><div class="compare-toolbar"><label class="zoom-control" title="Comparison zoom · based on comp pixels">${icon('zoom')}<select id="zoom" aria-label="Comparison zoom">${[['fit','Fit'],['1','100%'],['2','200%'],['4','400%']].map(([value,label])=>`<option value="${value}" ${String(zoom)===value?'selected':''}>${label}</option>`).join('')}</select>${icon('chevronDown')}</label><button id="overlay" class="overlay-control" aria-label="Overlay comp" title="Overlay approved comp" aria-pressed="${overlay}"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="10" height="10"/><rect x="7" y="7" width="10" height="10"/></svg>Overlay</button><div class="comparison-actions" role="group" aria-label="Comparison view actions"><button id="expand-comparison" class="icon-button" aria-label="${expandedComparison?'Restore comparison':'Enlarge comparison'}" title="${expandedComparison?'Restore comparison (Esc)':'Enlarge comparison'}" aria-expanded="${expandedComparison}">${icon(expandedComparison?'compact':'expand')}</button>${v?.preview.kind==='image'?`<a class="icon-button source-link" href="${url(sourceUrl!)}" target="_blank" rel="noopener" aria-label="${useContext?'Open context capture':presentation!.fileLabel}" title="${useContext?'Open context capture':presentation!.fileLabel}">${icon('external')}</a>`:''}</div></div>
          <div class="compare">
            <figure><figcaption>${viewingPrevious ? `Comp · Round ${history!.packet.round}` : 'In the comp'}</figcaption><div class="pan-viewport" aria-label="Reference comparison canvas" tabindex="0"><div class="crop-stage"><img class="crop-image" src="${url(vp.comp.url)}" alt="Reference region for ${esc(v!.name)}" style="width:${100/v!.box.w}%;left:${-100*v!.box.x/v!.box.w}%;top:${-100*v!.box.y/v!.box.h}%"></div></div></figure>
            <figure><figcaption>${viewingPrevious ? `Previous · Round ${history!.packet.round}` : useContext ? 'In context' : history ? `${presentation!.caption} · Round ${packet.round}` : presentation!.caption}</figcaption><div class="pan-viewport" aria-label="Produced comparison canvas" tabindex="0"><div class="output crop-stage ${hasTransparency&&!useContext&&!useFrame&&backdrop==='checker'?'checker':''}">${!useFrame ? `<img class="asset" src="${url(sourceUrl!)}" alt="Produced ${esc(v!.name)}" style="object-position:${esc(v!.preview.position ?? 'center')}">` : `<iframe aria-hidden="true" title="Rendered ${esc(v!.name)}" src="${url(sourceUrl!)}" sandbox="" tabindex="-1" width="${vp.comp.width}" height="${vp.comp.height}"></iframe>`}${overlay ? `<img class="crop-image overlay-image" src="${url(vp.comp.url)}" alt="Reference overlay" style="width:${100/v!.box.w}%;left:${-100*v!.box.x/v!.box.w}%;top:${-100*v!.box.y/v!.box.h}%">` : ''}</div></div></figure>
          </div>
          ${hasTransparency || v!.context ? `<div class="view-controls">${v!.context ? `<div role="group" aria-label="Component view"><button id="isolated" aria-pressed="${!useContext}">${isRaster?'Asset only':'Component only'}</button><button id="context" aria-pressed="${useContext}">In context</button></div>` : ''}${hasTransparency?`<div class="background-options" role="group" aria-label="Asset preview background"><button id="background-checker" class="swatch-button" aria-label="Checkerboard background" title="Checkerboard background" aria-pressed="${backdrop==='checker'}" ${useContext?'disabled':''}><span class="background-swatch checker"></span></button><button id="background-page" class="swatch-button" aria-label="${vp.comp.background?'Page color':'Neutral'} background" title="${vp.comp.background?'Page color':'Neutral'} background" aria-pressed="${backdrop==='page'}" ${useContext?'disabled':''}><span class="background-swatch page-swatch"></span></button></div>`:''}</div>` : ''}
          </div></div><div class="component-details">${vp.stage==='components'&&presentation?.captured&&!v?.preview.isolation?'<p class="layering">Legacy region capture · may include overlapping components.</p>':''}${v?.context?.layering&&(isRaster||useContext)?`<p class="layering">${esc(v.context.layering)}</p>`:''}
          <p class="component-note">${esc(v!.note)}</p>
          </div></div><div class="review-form">${notice}${viewingPrevious?'<p class="previous-notice">Viewing the previous round. Return to Current to make a decision.</p>':''}${submitted?`<div class="record-verdict"><strong>${d?.action==='approve'?'Approved':d?.action==='revise'?'Changes requested':'Not reviewed'}</strong><span>Submitted in round ${packet.round} · read-only</span></div>`:`<div class="decisions" role="group" aria-label="Decision for ${esc(c.name)}"><div class="decision-title"><strong>Your review <span>Round ${packet.round}</span></strong>${viewingPrevious?'<p>Return to Current to review this round.</p>':''}</div><button id="approve" class="decision-approve ${d?.action === 'approve' ? 'approved' : ''}" aria-pressed="${d?.action === 'approve'}">Looks good</button><button id="revise" class="decision-revise ${d?.action === 'revise' ? 'revise' : ''}" aria-pressed="${d?.action === 'revise'}">Needs work</button>${d ? `<button id="clear" class="quiet icon-button" aria-label="Clear decision" title="Clear decision">${icon('undo')}</button>` : ''}</div>`}
          ${edit ? `<form id="feedback-form"><div class="feedback-fields"><label class="feedback-field">What needs to change?<textarea id="feedback" aria-describedby="feedback-hint">${esc(edit.feedback)}</textarea></label><p id="feedback-hint" class="feedback-hint">Optional — leave blank for the agent to diagnose.</p><label class="check"><input id="split" type="checkbox" ${edit.split ? 'checked' : ''}> Split into separately reviewable components</label></div><div class="feedback-actions"><button id="cancel-feedback" type="button" class="quiet">Cancel</button><button id="save-feedback" type="submit" class="primary">${isLast?'Save & finish review':'Save & next'} <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg></button><span class="shortcut-hint">${shortcutLabel}</span></div></form>` : d?.action==='revise' ? `<p class="saved-feedback">${esc(d.feedback || 'No note — agent will diagnose.')}</p>` : ''}
          </div>` : missing ? `<p>This piece will be added to the unresolved inventory.</p><label class="feedback-field">Name<input id="missing-name" value="${esc(missing.name)}"></label><label class="feedback-field">What is missing?<textarea id="missing-feedback">${esc(missing.feedback)}</textarea></label><div class="coordinates">${(['x','y','w','h'] as const).map(k=>`<label>${{x:'Left',y:'Top',w:'Width',h:'Height'}[k]} %<input type="number" data-coordinate="${k}" value="${Math.round(missing.box[k]*1000)/10}" min="0" max="100" step="0.1"></label>`).join('')}</div><button id="remove-missing">Remove this mark</button></div>` : '<p>No components supplied.</p></div>'}
        </section>
      </div>
      <section class="inventory-section ${trayOpen?'':'tray-collapsed'} ${showAll&&trayOpen?'tray-expanded':''}" aria-label="Component inventory"><div class="section-head"><h2>Components</h2><div class="inventory-filters" role="group" aria-label="Filter components"><button data-filter="pending" aria-pressed="${inventoryFilter==='pending'}">To review <b>${stats.pending}</b></button><button data-filter="reviewed" aria-pressed="${inventoryFilter==='reviewed'}">Reviewed <b>${reviewedCount}</b></button><button data-filter="all" aria-pressed="${inventoryFilter==='all'}">All <b>${packet.components.length+draft.missing.length}</b></button></div><div class="tray-actions"><button id="show-all" class="icon-button" aria-pressed="${showAll}" aria-controls="component-tray" aria-label="${showAll?'Compact':'Expand'} tray" title="${showAll?'Compact':'Expand'} tray">${icon(showAll?'compact':'expand')}</button><button id="toggle-tray" class="icon-button" aria-expanded="${trayOpen}" aria-controls="component-tray" aria-label="${trayOpen?'Hide':'Show'} component tray" title="${trayOpen?'Hide':'Show'} component tray">${icon(trayOpen?'hideTray':'showTray')}</button></div></div>
      <div id="component-tray" class="inventory ${showAll ? 'all' : ''}">${shownComponents.map(item=>{const i=packet.components.indexOf(item);const state=stateFor(item); return `<button class="item ${state.kind} ${!finished && selected === item.id ? 'active' : ''}" data-select="${esc(item.id)}" aria-pressed="${!finished && selected === item.id}">${item.thumbnail ? `<span class="item-thumb">${item.thumbnail.box ? `<span class="thumb-crop" style="width:min(100%,${76*item.thumbnail.box.w*packet.comp.width/(item.thumbnail.box.h*packet.comp.height)}px);aspect-ratio:${item.thumbnail.box.w*packet.comp.width}/${item.thumbnail.box.h*packet.comp.height}"><img alt="" loading="lazy" src="${url(item.thumbnail.url)}" style="position:absolute;width:${100/item.thumbnail.box.w}%;max-width:none;left:${-100*item.thumbnail.box.x/item.thumbnail.box.w}%;top:${-100*item.thumbnail.box.y/item.thumbnail.box.h}%;"></span>` : `<img alt="" loading="lazy" src="${url(item.thumbnail.url)}">`}</span>` : ''}<span class="item-number">${state.kind==='approved'?checkIcon:state.kind==='feedback'?feedbackIcon:''}${i+1}<span class="item-medium">${icon(componentPresentation(item).code ? 'code' : 'image')}${esc(componentPresentation(item).label)}</span></span><strong>${esc(item.name)}</strong><span class="state ${state.kind}">${esc(state.label)}</span></button>`}).join('')}${(inventoryFilter==='pending'?[]:draft.missing).map((m,i)=>`<button class="item feedback ${selected===m.id?'active':''}" data-select="${esc(m.id)}"><span class="item-number">${packet.components.length+i+1}</span><strong>${esc(m.name)}</strong><span class="state revise">Missing</span></button>`).join('')}${!shownComponents.length&&(inventoryFilter==='pending'||!draft.missing.length)?`<p class="inventory-empty">${inventoryFilter==='pending'?'Nothing left to review. Your decisions are ready.':'No components reviewed yet.'}</p>`:''}</div></section>
      ${submitted?`<footer class="record-footer"><span>Round ${packet.round} submitted · read-only</span><span>${stats.approved} approved · ${stats.revisions} changes requested</span></footer>`:`<footer class="${!stats.pending&&!uncommitted?'queue-complete':''}"><div>${!stats.pending&&!uncommitted ? `<button id="show-summary" class="completion-link">${checkIcon}${submitted?'Review sent':'All components reviewed'}</button>` : ''}<button id="approve-rest" ${!stats.pending?'hidden':''} ${!stats.pending || uncommitted ? 'disabled' : ''}>Approve ${stats.approved || stats.revisions ? 'remaining' : 'all'}</button><label class="check"><input id="inventory-confirm" type="checkbox" ${draft.inventoryConfirmed?'checked':''}> Nothing missing from the comp</label></div><div class="submit-area"><p role="status">${esc(statusMessage)}</p><button id="submit" class="primary" ${!stats.canSubmit || uncommitted || sending || submitted?'disabled':''}>${sending?'Sending…':submitted?'Review sent':stats.hasFeedback?'Send feedback':'Approve & continue'}</button></div></footer>`}
    </section><dialog id="comparison-dialog" aria-label="Enlarged component comparison"></dialog>`;
    const comparisonDialog=root.querySelector<HTMLDialogElement>('#comparison-dialog')!;
    const comparisonPanel=root.querySelector<HTMLElement>('.comparison-panel');
    const comparisonSlot=root.querySelector<HTMLElement>('.comparison-slot');
    if(expandedComparison && comparisonPanel && comparisonSlot){
      comparisonSlot.style.height=`${oldComparisonHeight}px`;
      comparisonDialog.append(comparisonPanel);comparisonDialog.showModal();
    }
    if(viewingPrevious)root.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLTextAreaElement>('.decisions button,#feedback,#split,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#submit,#inventory-confirm').forEach(el=>el.disabled=true);
    root.querySelector('.inspection-content')!.scrollTop=inspectorTop;
    if(submitted||sending)root.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLTextAreaElement>('.decisions button,#save-feedback,#cancel-feedback,#undo-decision,#approve-rest,#mark,#inventory-confirm,#missing-name,#missing-feedback,#feedback,#split,#remove-missing,[data-coordinate]').forEach(el=>el.disabled=true);
    root.querySelector('.inventory')!.scrollLeft = railLeft;
    if(!keepInspector&&trayOpen)Array.from(root.querySelectorAll<HTMLElement>('.inventory [data-select]')).find(el=>el.dataset.select===selected)?.scrollIntoView({block:'nearest',inline:'nearest'});
    if (focusId) root.getElementById(focusId)?.focus({preventScroll:true});
    else if(focusSelection) Array.from(root.querySelectorAll<HTMLElement>('.item[data-select]')).find(el=>el.dataset.select===focusSelection)?.focus({preventScroll:true});
    const on = (id:string, action:()=>void) => root.querySelector(`#${id}`)?.addEventListener('click', action);
    root.querySelectorAll<HTMLElement>('[data-select]').forEach(el => el.onclick = () => {if(marking)return; finished=false; selected=el.dataset.select!; mobilePane='component'; overlay=false; zoom='fit'; outputMode='isolated'; previousRound=false; render();});
    on('previous-round',()=>{previousRound=true;render();});
    on('current-round',()=>{previousRound=false;render();});
    on('review-changes',()=>{const pending=orderedComponents().filter(item=>stateFor(item).kind==='pending');const current=pending.findIndex(item=>item.id===selected);const next=pending[(current+1)%pending.length];if(next){finished=false;selected=next.id;mobilePane='component';inventoryFilter='pending';previousRound=false;zoom='fit';overlay=false;outputMode='isolated';render();}});
    root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button=>button.onclick=()=>{
      inventoryFilter=button.dataset.filter as InventoryFilter;finished=!stats.pending&&inventoryFilter==='pending';
      const matches=orderedComponents().filter(item=>inReviewQueue(item,draft,inventoryFilter));
      const selectedMissing=inventoryFilter!=='pending'&&draft.missing.some(item=>item.id===selected);
      if(!selectedMissing&&!matches.some(item=>item.id===selected)&&matches.length){selected=matches[0].id;mobilePane='component';previousRound=false;zoom='fit';overlay=false;outputMode='isolated';}
      render();
    });
    on('show-summary',()=>{finished=true;mobilePane='component';inventoryFilter='reviewed';render();focusReview('review-summary');});
    on('approve',()=>updateDecision('approve')); on('revise',beginFeedback);
    on('clear',()=>{if(c){delete draft.decisions[c.id];delete edits[c.id];}lastDecision=null;finished=false;inventoryFilter='pending';render();});
    on('cancel-feedback',()=>{if(c)delete edits[c.id];if(restoreTrayAfterFeedback){trayOpen=true;restoreTrayAfterFeedback=false;}render();focusReview('revise');});
    root.querySelector('#feedback-form')?.addEventListener('submit',e=>{e.preventDefault();updateDecision('revise');});
    root.querySelector('#feedback')?.addEventListener('keydown',e=>{
      const key=e as KeyboardEvent;
      if(key.key==='Enter'&&(key.metaKey||key.ctrlKey)&&!key.isComposing){key.preventDefault();key.stopPropagation();updateDecision('revise');}
    });
    on('undo-decision',()=>{
      if(!lastDecision||sending||submitted)return;
      const previous=lastDecision;
      if(previous.previous)draft.decisions[previous.id]=previous.previous;else delete draft.decisions[previous.id];
      delete edits[previous.id];selected=previous.id;finished=false;previousRound=false;mobilePane='component';inventoryFilter='all';lastDecision=null;render();focusReview('approve');
    });
    on('overlay',()=>{overlay=!overlay; render();});
    on('isolated',()=>{outputMode='isolated';render();});
    on('context',()=>{outputMode='context';render();});
    root.querySelector('#zoom')?.addEventListener('change',e=>{const value=(e.target as HTMLSelectElement).value;zoom=value==='fit'?'fit':Number(value);render();});
    on('background-checker',()=>{backdrop='checker';render();});
    on('background-page',()=>{backdrop='page';render();});
    on('show-all',()=>{showAll=!showAll;trayOpen=true;render();});
    on('toggle-tray',()=>{restoreTrayAfterFeedback=false;trayOpen=!trayOpen;render();});
    on('show-comp',()=>{mobilePane='comp';render();});
    on('show-component',()=>{mobilePane='component';render();});
    on('mark',()=>{marking=!marking;render();}); on('add-box',()=>addMissing({x:.35,y:.35,w:.2,h:.2}));
    on('remove-missing',()=>{draft.missing=draft.missing.filter(m=>m.id!==selected);selected=packet.components[0]?.id;render();});
    on('approve-rest',()=>{if(uncommitted)return;draft=approveRemaining(packet,draft);lastDecision=null;finished=true;inventoryFilter='reviewed';mobilePane='component';render();focusReview('review-summary');});
    root.querySelector('#inventory-confirm')?.addEventListener('change',e=>{draft.inventoryConfirmed=(e.target as HTMLInputElement).checked;render();});
    root.querySelector('#feedback')?.addEventListener('input',e=>{if(c&&edits[c.id])edits[c.id].feedback=(e.target as HTMLTextAreaElement).value;});
    root.querySelector('#split')?.addEventListener('change',e=>{if(c&&edits[c.id])edits[c.id].split=(e.target as HTMLInputElement).checked;});
    root.querySelector('#missing-name')?.addEventListener('input',e=>{if(missing)missing.name=(e.target as HTMLInputElement).value; const submit=root.querySelector<HTMLButtonElement>('#submit');if(submit)submit.disabled=uncommitted||sending||submitted||!summarize(packet,draft).canSubmit;});
    root.querySelector('#missing-feedback')?.addEventListener('input',e=>{if(missing)missing.feedback=(e.target as HTMLTextAreaElement).value;});
    root.querySelectorAll<HTMLInputElement>('[data-coordinate]').forEach(el=>el.addEventListener('change',()=>{
      if(!missing)return; const k=el.dataset.coordinate as keyof Box;
      const next=Number(el.value)/100;
      if(Number.isFinite(next)) missing.box[k]=Math.max(k==='w'||k==='h'?.001:0, Math.min(1,next));
      missing.box.w=Math.min(missing.box.w,1-missing.box.x);missing.box.h=Math.min(missing.box.h,1-missing.box.y);render();
    }));
    on('submit',async()=>{if(uncommitted||sending||submitted)return;sending=true;error='';render();try{await options.onSubmit(submission(packet,draft));submitted=true;finished=true;marking=false;inventoryFilter='reviewed';}catch(e){error=e instanceof Error?e.message:'Could not save. Try again.';}finally{sending=false;render();}});
    const map = root.querySelector<HTMLElement>('.map')!;
    function point(e: PointerEvent) {const r=map.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
    map.addEventListener('pointerdown',e=>{if(!marking)return;drag=point(e);map.setPointerCapture(e.pointerId);e.preventDefault();});
    map.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);dragBox={x:Math.min(drag.x,p.x),y:Math.min(drag.y,p.y),w:Math.abs(p.x-drag.x),h:Math.abs(p.y-drag.y)};const outline=root.querySelector<HTMLElement>('.draw-box')!;outline.hidden=false;outline.style.cssText=boxStyle(dragBox);});
    map.addEventListener('pointerup',()=>{if(dragBox&&dragBox.w>.01&&dragBox.h>.01)addMissing(dragBox);else{drag=null;dragBox=null;}});
    map.addEventListener('pointercancel',()=>{drag=null;dragBox=null;render();});
    const stage=root.querySelector<HTMLElement>('.output'); const frame=root.querySelector<HTMLIFrameElement>('iframe');
    const workbench=root.querySelector<HTMLElement>('.workbench')!;
    // Reflect native scroll position without re-rendering or resetting the inspector.
    const inspectionBody=root.querySelector<HTMLElement>('.inspection-content');
    const inspectionPanel=root.querySelector<HTMLElement>('.inspector');
    function updateScrollEdges() {
      if(!inspectionBody||!inspectionPanel)return;
      inspectionPanel.dataset.scrollAbove=String(inspectionBody.scrollTop>1);
      inspectionPanel.dataset.scrollBelow=String(inspectionBody.scrollHeight-inspectionBody.clientHeight-inspectionBody.scrollTop>1);
    }
    inspectionBody?.addEventListener('scroll',updateScrollEdges,{passive:true});
    function resizePreview() {
      const mapSpace=root.querySelector<HTMLElement>('.map-space');
      if(mapSpace&&mapSpace.clientWidth&&mapSpace.clientHeight){
        const fit=comparisonSize(packet.comp.width,packet.comp.height,Math.max(1,mapSpace.clientWidth-32),Math.max(1,mapSpace.clientHeight-32),'fit');
        map.style.width=`${fit.width}px`;map.style.height=`${fit.height}px`;
      }
      const content=root.querySelector<HTMLElement>('.inspection-content');
      const panes=Array.from(root.querySelectorAll<HTMLElement>('.pan-viewport'));
      if(content?.clientHeight){
        const height=expandedComparison
          ? Math.max(100,comparisonDialog.clientHeight-(comparisonPanel?.querySelector('.compare-toolbar')?.clientHeight??0)-(comparisonPanel?.querySelector('.expanded-title')?.clientHeight??0)-(comparisonPanel?.querySelector('.view-controls')?.clientHeight??0)-112)
          : Math.min(248,Math.max(100,content.clientHeight-40));
        panes.forEach(p=>p.style.height=`${height}px`);
      }
      if(v&&panes.length){const size=comparisonSize(v.box.w*vp.comp.width,v.box.h*vp.comp.height,Math.min(...panes.map(p=>p.clientWidth)),Math.min(...panes.map(p=>p.clientHeight)),zoom);root.querySelectorAll<HTMLElement>('.crop-stage').forEach(el=>{el.style.width=`${size.width}px`;el.style.height=`${size.height}px`;});}
      panes.forEach(p=>{const pannable=p.scrollWidth>p.clientWidth+1||p.scrollHeight>p.clientHeight+1;p.classList.toggle('pannable',pannable);p.title=pannable?'Move your pointer to pan. You can also scroll, swipe, or use arrow keys.':'';});
      if(stage&&frame&&v){const s=stage.clientWidth/(v.box.w*vp.comp.width);frame.style.transform=`scale(${s})`;frame.style.left=`${-v.box.x*vp.comp.width*s}px`;frame.style.top=`${-v.box.y*vp.comp.height*s}px`;}
      const bounds=workbench.getBoundingClientRect();const region=root.querySelector<HTMLElement>('.region');const end=root.querySelector<HTMLElement>('.number');
      const path=root.querySelector<SVGPathElement>('.connector path');
      if(region&&end&&path){const a=region.getBoundingClientRect(),b=end.getBoundingClientRect();const x1=a.right-bounds.left,y1=a.top+a.height/2-bounds.top,x2=b.left-bounds.left-8,y2=b.top+b.height/2-bounds.top;path.setAttribute('d',`M ${x1} ${y1} H ${x2-14} V ${y2} H ${x2}`);}
    }
    function setComparisonExpanded(open: boolean) {
      if(!comparisonPanel||!comparisonSlot||open===expandedComparison)return;
      const button=root.querySelector<HTMLButtonElement>('#expand-comparison')!;
      const before=(expandedComparison?comparisonDialog:comparisonPanel).getBoundingClientRect();
      const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const currentPane=comparisonPanel.querySelector<HTMLElement>('.pan-viewport');
      const px=currentPane ? currentPane.scrollLeft/Math.max(1,currentPane.scrollWidth-currentPane.clientWidth) : 0;
      const py=currentPane ? currentPane.scrollTop/Math.max(1,currentPane.scrollHeight-currentPane.clientHeight) : 0;
      const restorePan=()=>comparisonPanel.querySelectorAll<HTMLElement>('.pan-viewport').forEach(p=>{p.scrollLeft=px*Math.max(0,p.scrollWidth-p.clientWidth);p.scrollTop=py*Math.max(0,p.scrollHeight-p.clientHeight);});
      const restore=()=>{
        comparisonSlot.append(comparisonPanel);comparisonDialog.close();comparisonSlot.style.height='';
        expandedComparison=false;button.innerHTML=icon('expand');button.setAttribute('aria-label','Enlarge comparison');button.title='Enlarge comparison';button.setAttribute('aria-expanded','false');
        resizePreview();restorePan();button.focus({preventScroll:true});
      };
      if(open){
        comparisonSlot.style.height=`${before.height}px`;comparisonDialog.append(comparisonPanel);comparisonDialog.showModal();expandedComparison=true;
        button.innerHTML=icon('compact');button.setAttribute('aria-label','Restore comparison');button.title='Restore comparison (Esc)';button.setAttribute('aria-expanded','true');
        resizePreview();restorePan();button.focus({preventScroll:true});
        const after=comparisonDialog.getBoundingClientRect();
        if(!reduced)comparisonDialog.animate([{transform:`translate(${before.x-after.x}px,${before.y-after.y}px) scale(${before.width/after.width},${before.height/after.height})`,opacity:.6},{transform:'none',opacity:1}],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});
      }else{
        if(button.disabled)return;
        const target=comparisonSlot.getBoundingClientRect();
        if(reduced){restore();return;}
        button.disabled=true;
        const animation=comparisonDialog.animate([{transform:'none',opacity:1},{transform:`translate(${target.x-before.x}px,${target.y-before.y}px) scale(${target.width/before.width},${target.height/before.height})`,opacity:.6}],{duration:200,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
        animation.finished.then(()=>{if(comparisonDialog.isConnected){animation.cancel();button.disabled=false;restore();}}).catch(()=>{});
      }
    }
    on('expand-comparison',()=>setComparisonExpanded(!expandedComparison));
    comparisonDialog.addEventListener('cancel',e=>{e.preventDefault();e.stopPropagation();setComparisonExpanded(false);});
    comparisonDialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setComparisonExpanded(false);}});
    resize=new ResizeObserver(()=>{resizePreview();updateScrollEdges();});resize.observe(workbench);resize.observe(comparisonDialog);const content=root.querySelector('.inspection-content');if(content)resize.observe(content);resizePreview();
    const panes=Array.from(root.querySelectorAll<HTMLElement>('.pan-viewport'));
    panes.forEach(pane=>{pane.scrollLeft=panLeft;pane.scrollTop=panTop;});
    panes.forEach(pane=>{
      pane.querySelectorAll('img').forEach(img=>img.draggable=false);
      pane.addEventListener('pointermove',e=>{
        if(e.pointerType!=='mouse'||e.buttons||!pane.classList.contains('pannable'))return;
        const rect=pane.getBoundingClientRect();
        pane.scrollLeft=hoverPan(e.clientX,rect.left,pane.clientWidth,pane.scrollWidth);
        pane.scrollTop=hoverPan(e.clientY,rect.top,pane.clientHeight,pane.scrollHeight);
      });
      pane.addEventListener('keydown',e=>{
        const delta:Record<string,[number,number]>={ArrowLeft:[-48,0],ArrowRight:[48,0],ArrowUp:[0,-48],ArrowDown:[0,48]};
        const move=delta[e.key];if(!move)return;e.preventDefault();e.stopPropagation();pane.scrollLeft+=move[0];pane.scrollTop+=move[1];
      });
    });
    panes.forEach(pane=>pane.addEventListener('scroll',()=>{for(const other of panes)if(other!==pane){if(other.scrollLeft!==pane.scrollLeft)other.scrollLeft=pane.scrollLeft;if(other.scrollTop!==pane.scrollTop)other.scrollTop=pane.scrollTop;}}));
    if(focusMobileComparison&&window.matchMedia('(max-width:800px)').matches){const body=root.querySelector<HTMLElement>('.inspection-content');const comparison=root.querySelector<HTMLElement>('.compare');if(body&&comparison)body.scrollTop+=comparison.getBoundingClientRect().top-body.getBoundingClientRect().top;}
    updateScrollEdges();
    window.scrollTo(scrollX,scrollY);
    if(!submitted) options.onDraftChange?.(structuredClone(draft));
  }
  render();
  return {destroy(){resize?.disconnect();root.replaceChildren();},getDraft():Draft{return structuredClone(draft);}};
}
