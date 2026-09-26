import { mountComponentReview } from './review';
import type { Draft, ReviewPacket, ReviewHistory } from './model';
import { isPlanPacket } from './plan-model';

/** A load failure replaces the review, so it carries its own styling and a next step. */
function failure(message: string) {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'max-width:560px;margin:15vh auto 0;padding:20px 22px;border:1px solid #ecc3ba;border-radius:6px;background:#fbebe7;color:#62200f;font:14px/1.5 var(--font-sans,Arial,sans-serif)';
  const title = document.createElement('strong');
  title.textContent = 'The review could not be opened.';
  const detail = document.createElement('p');
  detail.style.margin = '4px 0 14px';
  detail.textContent = `${message} If the review server stopped, ask the agent to serve the review again, then reload.`;
  const retry = document.createElement('button');
  retry.textContent = 'Reload';
  retry.style.cssText = 'font:inherit;padding:7px 14px;border:1px solid #9d3423;border-radius:5px;background:#fff;color:#62200f;cursor:pointer';
  retry.onclick = () => location.reload();
  box.append(title, detail, retry);
  return box;
}

async function start() {
  const host=document.getElementById('review')!;
  const response=await fetch('/packet',{cache:'no-store'});
  if(!response.ok)throw new Error('The review packet could not be loaded.');
  const state=await response.json() as {packet:ReviewPacket;draft:Draft;receipt:unknown;history:ReviewHistory|null;sourceStatus:string|null};
  // The plan review shows its own out-of-date banner; earlier stages keep the plain notice.
  const plan=isPlanPacket(state.packet);
  if(state.sourceStatus&&!plan){const notice=document.createElement('p');notice.textContent=state.sourceStatus;host.before(notice);}
  mountComponentReview(host,state.packet,{
    initialDraft:state.draft,
    history:state.history,
    completed:!!state.receipt,
    status:plan?state.sourceStatus:null,
    onSubmit:async(value)=>{
      const response=await fetch('/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error??'The review could not be saved. Try again.');
    },
  });
}
start().catch(error=>{document.getElementById('review')?.replaceChildren(failure(error instanceof Error?error.message:String(error)));});
