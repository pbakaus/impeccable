import { mountComponentReview } from './review';
import type { Draft, ReviewPacket, ReviewHistory } from './model';

async function start() {
  const host=document.getElementById('review')!;
  const response=await fetch('/packet',{cache:'no-store'});
  if(!response.ok)throw new Error('The review packet could not be loaded. Reload to retry.');
  const state=await response.json() as {packet:ReviewPacket;draft:Draft;receipt:unknown;history:ReviewHistory|null;sourceStatus:string|null};
  if(state.sourceStatus){const notice=document.createElement('p');notice.textContent=state.sourceStatus;host.before(notice);}
  mountComponentReview(host,state.packet,{
    initialDraft:state.draft,
    history:state.history,
    completed:!!state.receipt,
    onSubmit:async(value)=>{
      const response=await fetch('/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??'The review could not be saved. Try again.');
    },
  });
}
start().catch(error=>{const p=document.createElement('p');p.textContent=error instanceof Error?error.message:String(error);document.getElementById('review')?.replaceChildren(p);});
