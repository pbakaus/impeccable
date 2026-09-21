import { describe, expect, test } from 'bun:test';
import { reviewScope, reviewUnits, decisionTargets, nextUnreviewed, approveRemaining, newDraft, submission, summarize, validBox, type ReviewPacket } from './model';
const packet: ReviewPacket = { id:'review-1', revision:'packet-1', title:'Test', round:1, comp:{url:'/comp.png',width:100,height:100}, components:[{id:'art',revision:'art-1',name:'Art',medium:'Raster',note:'',box:{x:0,y:0,w:1,h:1},preview:{kind:'image',url:'/art.png'}},{id:'control',revision:'control-1',name:'Button',medium:'HTML',note:'',box:{x:0,y:0,w:.1,h:.1},preview:{kind:'page',url:'/page.html'}}] };
describe('component review drafts',()=>{
 test('bulk approval still requires explicit inventory confirmation',()=>{const draft=approveRemaining(packet,newDraft(packet));expect(summarize(packet,draft).canSubmit).toBe(false);draft.inventoryConfirmed=true;expect(submission(packet,draft).requestId).toBe(packet.id);});
 test('approve remaining preserves requests for repair and their feedback',()=>{const draft=newDraft(packet);draft.decisions.art={revision:'art-1',action:'revise',feedback:'Keep the original motif',split:true};const bulk=approveRemaining(packet,draft);expect(bulk.decisions.art).toEqual(draft.decisions.art);expect(summarize(packet,bulk)).toMatchObject({approved:1,revisions:1,canSubmit:true});});
 test('stale packet cannot submit',()=>{const draft=approveRemaining(packet,newDraft(packet));draft.inventoryConfirmed=true;expect(()=>submission({...packet,revision:'packet-2'},draft)).toThrow('stale');});
 test('changed component version invalidates only that decision',()=>{const draft=approveRemaining(packet,newDraft(packet));draft.inventoryConfirmed=true;const changed={...packet,components:packet.components.map(c=>c.id==='art'?{...c,revision:'art-2'}:c)};expect(summarize(changed,draft)).toMatchObject({approved:1,pending:1,canSubmit:false});});
 test('a missing item can be submitted without approving unrelated components',()=>{const draft=newDraft(packet);draft.missing.push({id:'missing-1',name:'Brushwork',box:{x:.2,y:.3,w:.2,h:.2},feedback:'Missing texture'});expect(summarize(packet,draft)).toMatchObject({pending:2,hasFeedback:true,canSubmit:true});draft.missing[0].name=' ';expect(summarize(packet,draft).canSubmit).toBe(false);});
 test('rejects invalid regions and does not share mutable submission state',()=>{expect(validBox({x:0,y:0,w:0,h:1})).toBe(false);expect(validBox({x:.9,y:0,w:.5,h:1})).toBe(false);expect(validBox({x:NaN,y:0,w:1,h:1})).toBe(false);const draft=approveRemaining(packet,newDraft(packet));draft.inventoryConfirmed=true;const receipt=submission(packet,draft);draft.decisions.art.feedback='Changed';expect(receipt.decisions.art.feedback).toBe('');});
});


test('draft-only or changed prior decisions never count as carried approval', async () => {
  const { repairStatus } = await import('./model');
  const history: any = {
    submitted: false, packet: { round: 1 },
    draft: { decisions: { art: { action: 'approve' } } },
    changes: { art: { kind: 'unchanged', files: [], reasons: [] } },
  };
  expect(repairStatus('art', history).carried).toBe(false);
  history.submitted = true;
  history.changes.art.carried = true;
  expect(repairStatus('art', history).carried).toBe(true);
  history.changes.art.kind = 'changed';
  expect(repairStatus('art', history).carried).toBe(false);
  expect(repairStatus('art', history).label).toBe('Review again');
});


test('attention states cannot hide a component behind a stale approval', async () => {
  const { componentState } = await import('./model');
  const draft=approveRemaining(packet,newDraft(packet));
  expect(componentState(packet.components[0],draft).kind).toBe('approved');
  expect(componentState({...packet.components[0],revision:'new'},draft).kind).toBe('pending');
  draft.decisions.art.action='revise';
  expect(componentState(packet.components[0],draft)).toMatchObject({kind:'feedback',label:'Feedback ready'});
});

test('captured code keeps its implementation identity without trusting medium as proof', async () => {
  const { componentPresentation } = await import('./model');
  const image = packet.components[0];
  expect(componentPresentation({...image, medium:'SVG'}).code).toBe(false);
  const captured = {...packet.components[1], preview:{kind:'image' as const, sourceKind:'page' as const, url:'/capture.png'}};
  expect(componentPresentation(captured)).toMatchObject({code:true,captured:true,label:'HTML',caption:'Region capture',fileLabel:'Open captured preview'});
  expect(componentPresentation(packet.components[1]).caption).toBe('Live component');
});


test('review progression skips decisions, wraps, and revisits stale components', () => {
  const draft = newDraft(packet);
  expect(nextUnreviewed(packet,draft)).toBe(packet.components[0].id);
  const first=packet.components[0],second=packet.components[1];
  draft.decisions[first.id]={revision:first.revision,action:'revise',feedback:'',split:false};
  expect(nextUnreviewed(packet,draft,first.id)).toBe(second.id);
  expect(nextUnreviewed(packet,draft,second.id)).toBe(second.id);
  draft.decisions[second.id]={revision:second.revision,action:'approve',feedback:'',split:false};
  expect(nextUnreviewed(packet,draft,second.id)).toBeUndefined();
  draft.decisions[first.id].revision='stale';
  expect(nextUnreviewed(packet,draft,second.id)).toBe(first.id);
  expect(nextUnreviewed({...packet,components:[]},draft)).toBeUndefined();
});

test('reviewed queue includes feedback, pending queue includes stale decisions', async () => {
  const { inReviewQueue } = await import('./model');
  const draft=approveRemaining(packet,newDraft(packet));
  draft.decisions.art.action='revise';
  expect(packet.components.filter(c=>inReviewQueue(c,draft,'pending'))).toHaveLength(0);
  expect(packet.components.filter(c=>inReviewQueue(c,draft,'reviewed'))).toHaveLength(2);
  expect(summarize(packet,draft).pending).toBe(0);
  draft.decisions.art.revision='old';
  expect(packet.components.filter(c=>inReviewQueue(c,draft,'pending')).map(c=>c.id)).toEqual(['art']);
  expect(packet.components.filter(c=>inReviewQueue(c,draft,'reviewed')).map(c=>c.id)).toEqual(['control']);
});

test('explicit pattern decisions preserve prior decisions, raster reviews and open edits', async () => {
  const {reviewPeers,decisionTargets}=await import('./model');
  const pattern={...packet.components[1],reviewGroup:'Room labels'};
  const p={...packet,components:[{...packet.components[0],reviewGroup:'Room labels'},pattern,
    ...['b','c','d'].map(id=>({...pattern,id,revision:id}))]};
  const draft=newDraft(p);
  draft.decisions.b={revision:'b',action:'revise',feedback:'Keep this specific repair',split:false};
  expect(reviewPeers(p,pattern).map(c=>c.id)).toEqual(['control','b','c','d']);
  expect(decisionTargets(p,draft,pattern,false).map(c=>c.id)).toEqual(['control']);
  expect(decisionTargets(p,draft,pattern,true,['c']).map(c=>c.id)).toEqual(['control','d']);
  expect(draft.decisions.b.feedback).toBe('Keep this specific repair');
  expect(reviewPeers(p,packet.components[0])).toEqual([packet.components[0]]);
});


test('review units collapse explicit code groups while retaining individual raster assets',()=>{
 const p:ReviewPacket={...packet,components:[...Array.from({length:14},(_,i)=>({...packet.components[1],id:`room-${i}`,reviewGroup:'room-name'})),{...packet.components[0],reviewGroup:'room-name'}]};
 const draft=newDraft(p);const units=reviewUnits(p,draft);
 expect(units).toHaveLength(2);expect(units[0].members).toHaveLength(14);expect(units[1].members).toHaveLength(1);
 expect(units[0].label).toBe('Room name');expect(units[0].pending).toBe(14);
 draft.decisions['room-0']={revision:'control-1',action:'revise',feedback:'Fix this one',split:false};
 const group=reviewUnits(p,draft)[0];expect(group.id).toBe('room-0');expect(group.representative.id).toBe('room-1');
 for(const c of decisionTargets(p,draft,group.representative,true))draft.decisions[c.id]={revision:c.revision,action:'approve',feedback:'',split:false};
 expect(draft.decisions['room-0'].feedback).toBe('Fix this one');expect(reviewUnits(p,draft)[0]).toMatchObject({pending:0,kind:'feedback',stateLabel:'1 needs work'});
 expect(summarize(p,draft)).toMatchObject({approved:13,revisions:1,pending:1});
 p.components[2].revision='changed';expect(reviewUnits(p,draft)[0]).toMatchObject({pending:1,kind:'pending'});
});

test('group approval cannot overwrite a reviewed representative',()=>{
 const p=structuredClone(packet);
 p.components=p.components.slice(0,1);
 const original=p.components[0];
 original.reviewGroup='repeated'; original.preview={kind:'page',url:'/component.html'};
 p.components.push({...original,id:'second'});
 const draft=newDraft(p);
 draft.decisions[original.id]={revision:original.revision,action:'revise',feedback:'Preserve this exception',split:false};
 expect(decisionTargets(p,draft,original,true).map(c=>c.id)).toEqual(['second']);
 expect(decisionTargets(p,draft,original,false).map(c=>c.id)).toEqual([original.id]);
});

test('scope distinguishes other mapped pieces from explicit capture exclusions',()=>{
 const p=structuredClone(packet), card=p.components[0];
 card.note='Card outline';
 const child=p.components[1];
 child.box={x:.2,y:.2,w:.2,h:.2};
 p.components.push({...child,id:'background',box:{x:0,y:0,w:1,h:1}});
 expect(reviewScope(p,card).related.map(c=>c.id)).toEqual(['control']);
 expect(reviewScope(p,card).excluded).toEqual([]);
 card.preview.isolation={method:'dom-component-v1',selector:'#card',excludedComponents:['control']};
 expect(reviewScope(p,card).excluded.map(c=>c.id)).toEqual(['control']);
 expect(reviewScope(p,child).related).toEqual([]);
 expect(reviewScope(p,card).description).toBe('Card outline');
});

test('reference scope includes crossing foreground pieces but ignores adjacent pixel seams',()=>{
 const p=structuredClone(packet),photo=p.components[0];
 photo.box={x:0,y:0,w:.4,h:1};
 const other=p.components[1];other.box={x:.2,y:.2,w:.3,h:.1};
 p.components.push({...other,id:'neighbor',box:{x:.4,y:0,w:.4,h:1}});
 p.components.push({...other,id:'seam',box:{x:.39999,y:.3,w:.2,h:.1}});
 expect(reviewScope(p,photo).related.map(c=>c.id)).toEqual(['control']);
 expect(reviewScope(p,photo).excluded).toEqual([]);
});
