import { mountComponentReview } from './review';
import type { Draft, ReviewPacket, ReviewHistory } from './model';
import { isPlanPacket } from './plan-model';

/** The served stylesheet declares the three variable fonts without weight ranges, so a
 * request for Alumni Sans 300 or Albert Sans 600 would be synthesized. Declare the ranges. */
function fontRanges() {
  const style = document.createElement('style');
  style.textContent = [['Albert Sans','albertsans'],['Alumni Sans','alumnisans'],['JetBrains Mono','jetbrainsmono']]
    .map(([family,file]) => `@font-face{font-family:"${family}";src:url(/fonts/${file}.ttf);font-weight:100 900}`).join('');
  document.head.append(style);
}

/** A load failure replaces the review, so it carries its own styling and a next step.
 * Values are the --ks-* tokens (see tokens.ts): paper, ink, vermilion mark, hairline rule. */
function failure(message: string) {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'max-width:560px;margin:18vh auto 0;padding:0 0 0 18px;border-left:2px solid oklch(52% 0.16 35);color:oklch(22% 0 0);font:400 15px/1.55 var(--font-sans,Arial,sans-serif)';
  const eyebrow = document.createElement('p');
  eyebrow.textContent = 'Review unavailable';
  eyebrow.style.cssText = 'margin:0 0 8px;font:400 11px/1.3 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:oklch(46% 0 0)';
  const title = document.createElement('strong');
  title.textContent = 'The review could not be opened.';
  title.style.cssText = 'display:block;font-weight:500;color:oklch(13% 0 0)';
  const detail = document.createElement('p');
  detail.style.cssText = 'margin:4px 0 18px;color:oklch(46% 0 0)';
  detail.textContent = `${message} If the review server stopped, ask the agent to serve the review again, then reload.`;
  const retry = document.createElement('button');
  retry.textContent = 'Reload';
  retry.style.cssText = 'font:500 15px/1 var(--font-sans,Arial,sans-serif);min-height:44px;padding:0 22px;border:1px solid oklch(13% 0 0);border-radius:3px;background:oklch(13% 0 0);color:oklch(99.5% 0 0);cursor:pointer';
  retry.onclick = () => location.reload();
  box.append(eyebrow, title, detail, retry);
  return box;
}

async function start() {
  fontRanges();
  document.body.style.background='oklch(97.8% 0 0)';
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
