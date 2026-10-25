// Reading list grounded in the linked papers; ranking and replies are authored offline, not model output.
export const papers = [
  {
    id:'dgm', short:'Darwin Gödel Machine', year:'2025', route:'Changes agent code',
    url:'https://arxiv.org/abs/2505.22954',
    title:'Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents',
    question:'Can an agent rewrite itself and test the result?',
    summary:'DGM lets a coding agent modify its own code, evaluate new versions on coding tasks, and keep an archive of versions to explore. The base model weights stay fixed.',
    result:'The authors report gains on SWE-bench and Polyglot. The changes include tools and workflows.',
    limit:'The experiments focus on coding. Benchmark gains do not establish benefits for personal tasks or unlimited self-improvement.',
    fits:{
      rsi:'For your RSI research, this is a useful starting point: it puts modification, evaluation, and version history in one loop.',
      personal:'For Chora, user corrections could become candidate strategies, tested against past tasks before replacing the current strategy. This is a design inference.',
      device:'The version archive and offline evaluations are useful ideas. The paper does not establish that the full search can run in a phone background process.'
    }
  },
  {
    id:'seal', short:'SEAL', year:'2025', route:'Changes model weights',
    url:'https://arxiv.org/abs/2506.10943',
    title:'Self-Adapting Language Models',
    question:'Can a model learn how to absorb new knowledge?',
    summary:'SEAL trains a model to produce data and instructions for its own fine-tuning. Performance after the update guides it toward more effective self-edits.',
    result:'The authors test this mechanism on knowledge incorporation and few-shot learning. Adaptation here changes model weights.',
    limit:'The paper discusses forgetting, compute costs, and dependence on task evaluation. It is not a validated everyday personal memory system.',
    fits:{
      rsi:'SEAL changes weights; DGM changes agent code. Reading them together helps separate distinct approaches to self-improvement.',
      personal:'Turning preferences into model capabilities requires studying update costs and forgetting. For now, personal memory can remain inspectable, reversible data.',
      device:'Start with compute costs and forgetting. Suitability for Pixel needs separate tests of latency, power, and recovery after corrections.'
    }
  },
  {
    id:'reflexion', short:'Reflexion', year:'2023', route:'Changes memory for the next attempt',
    url:'https://arxiv.org/abs/2303.11366',
    title:'Reflexion: Language Agents with Verbal Reinforcement Learning',
    question:'What can an agent learn from failure without retraining?',
    summary:'Reflexion turns task feedback into written reflections stored in episodic memory for later attempts. It does not update model weights.',
    result:'The paper tests this feedback approach on decision-making, reasoning, and coding tasks. Its value depends on the quality of feedback and evaluation.',
    limit:'Incorrect self-evaluations can also enter memory. The paper provides no direct guarantee for long-term preferences, privacy, or cross-domain generalization.',
    fits:{
      rsi:'A useful comparison for RSI: memory can improve behavior, but this differs from rewriting code or updating weights.',
      personal:'Chora already has user corrections and ongoing tasks. Try turning failures into traceable lessons, then test whether using them reduces repeated mistakes.',
      device:'Avoiding fine-tuning after every correction makes this a practical on-device starting point. Memory size and reversing faulty lessons still need testing.'
    }
  }
];
const goals = [
  {id:'rsi', label:'Recursive self-improvement (RSI)', detail:'Compare changes to code, weights, and memory', order:['dgm','seal','reflexion']},
  {id:'personal', label:'RSI for a personal agent', detail:'Focus on traceable, reversible improvements', order:['reflexion','dgm','seal']},
  {id:'device', label:'RSI on a phone', detail:'Focus on compute, forgetting, and recovery', order:['reflexion','seal','dgm']}
];
const prompts={fit:'How does this fit my research?',method:'How does it improve?',limits:'What are its limitations?',compare:'Compare these three papers'};
export const initialLearning=()=>({goal:'rsi',read:[],saved:[],conversations:{},tracking:false});
const byId=id=>papers.find(p=>p.id===id);
function normalized(current){
  const s={...initialLearning(),...current};
  s.conversations=s.conversations||{};
  return s;
}
const toggle=(items,id)=>items.includes(id)?items.filter(x=>x!==id):[...items,id];
const goalFor=s=>goals.find(g=>g.id===s.goal)||goals[0];
const comparison='DGM changes agent code; SEAL changes model weights; Reflexion changes written memory for the next attempt. For Chora, a reasonable design sequence is traceable memory, measurable strategy changes, then weight updates only when the evidence justifies them.';
function reply(p,s,topic){
  if(topic==='personal')return p.fits.personal;
  if(topic==='device')return p.fits.device;
  if(topic==='fit')return p.fits[s.goal]||p.fits.rsi;
  if(topic==='method')return p.summary;
  if(topic==='limits')return p.limit;
  if(topic==='compare')return comparison;
  return 'This offline summary does not cover that question. Your question is saved; a fuller answer needs more source material or a connected research model.';
}
function topicFor(text){
  if(/compare|difference/i.test(text))return 'compare';
  if(/limit|risk|weakness/i.test(text))return 'limits';
  if(/Pixel|phone|device/i.test(text))return 'device';
  if(/Chora|Personal|project|apply|application/i.test(text))return 'personal';
  if(/my research|relevance|why/i.test(text))return 'fit';
  if(/method|how|mechanism|improv/i.test(text))return 'method';
  return null;
}
export function reduceLearning(current,action){
  const s=structuredClone(normalized(current));
  if(action.type==='learning-goal'&&goals.some(g=>g.id===action.id))s.goal=action.id;
  if(action.type==='learning-track')s.tracking=!s.tracking;
  if(action.type==='learning-read'&&byId(action.id))s.read=toggle(s.read,action.id);
  if(action.type==='learning-save'&&byId(action.id))s.saved=toggle(s.saved,action.id);
  if(action.type==='learning-question'){
    const [id,topic]=String(action.id).split(':'); const p=byId(id);
    if(p&&prompts[topic])s.conversations[id]=[...(s.conversations[id]||[]),{question:prompts[topic],answer:reply(p,s,topic),goal:s.goal}].slice(-12);
  }
  if(action.type==='learning-ask'&&byId(action.id)&&typeof action.value==='string'){
    const question=action.value.trim().slice(0,1000); if(question){const topic=topicFor(question);s.conversations[action.id]=[...(s.conversations[action.id]||[]),{question,answer:reply(byId(action.id),s,topic),goal:s.goal}].slice(-12);}
  }
  return s;
}
export function learningStatus(current){const s=normalized(current),remaining=papers.filter(p=>!s.read.includes(p.id)).length;return remaining?`${remaining} RSI ${remaining===1?'paper':'papers'} selected for you`:'You have read this RSI collection';}
export function learningNotification(current){const s=normalized(current),first=goalFor(s).order.find(id=>!s.read.includes(id));return first?{title:'RSI papers, selected for you',sub:`Auto-selected: ${byId(first).short}`,paperId:first,hasUpdate:true}:{title:'Your RSI papers, ready to compare',sub:'Compare code, weights, and memory',paperId:'compare',hasUpdate:false};}
function sourceLink(ctx,p){return `<a class="l-source" href="${p.url}" target="_blank" rel="noopener noreferrer" data-action="handoff" data-id="paper" data-context="learning-${p.id}">arXiv · ${p.year} ${ctx.icon('arrow',13)}</a>`;}
function paperRow(ctx,p,s,featured=false){return `<article class="l-paper${featured?' featured':''}"><button class="l-paper-open" data-action="learning-open" data-id="${p.id}"><span class="l-paper-title">${ctx.escape(p.short)}${s.read.includes(p.id)?'<span class="l-read-state">Read</span>':''}</span><strong>${ctx.escape(p.question)}</strong><span>${ctx.escape(featured?p.fits[s.goal]:p.route)}</span></button><div class="l-paper-footer">${sourceLink(ctx,p)}${featured?ctx.button('Read summary','learning-open',p.id,'l-primary'):ctx.button('Discuss','learning-discuss',p.id,'l-link')}</div></article>`;}
export function renderLearning(ctx){const s=normalized(ctx.state),goal=goalFor(s); const ordered=goal.order.map(byId);const first=ordered.find(p=>!s.read.includes(p.id))||ordered[0]; const rest=ordered.filter(p=>p.id!==first.id);return `<div class="l-domain"><button class="l-goal" data-action="learning-open" data-id="goal"><span>Your research</span><strong>${goal.label}</strong><span class="l-goal-edit">Edit focus</span></button>${ctx.section(s.read.includes(first.id)?'Revisit your research':'Start here')}${paperRow(ctx,first,s,true)}${ctx.section('Other approaches')}${rest.map(p=>paperRow(ctx,p,s)).join('')}<button class="l-compare" data-action="learning-open" data-id="compare"><strong>Compare all three</strong><span>When to change code, weights, or memory</span>${ctx.icon('chevron',16)}</button></div>`;}
function paperDetail(ctx,p,s){return {title:p.short,body:`<p class="l-full-title">${ctx.escape(p.title)}</p>${sourceLink(ctx,p)}<div class="l-summary"><h3>What it does</h3><p>${p.summary}</p><h3>What the authors found</h3><p>${p.result}</p><h3>Why it fits your research</h3><p>${p.fits[s.goal]}</p><h3>What remains unproven</h3><p>${p.limit}</p></div><div class="l-detail-actions">${ctx.button('Discuss with Chora','learning-discuss',p.id,'primary-button')}${ctx.button(s.read.includes(p.id)?'Mark unread':'Mark read','learning-read',p.id,'secondary-button')}${ctx.button(s.saved.includes(p.id)?'Saved · Remove':'Save','learning-save',p.id,'l-link')}</div>`};}
function discussion(ctx,p,s){const items=s.conversations[p.id]||[];return {title:`Discuss ${p.short}`,body:`<div class="l-chat-context"><strong>${p.route}</strong><span>${goalFor(s).label}</span></div><p class="l-discussion-note">Offline discussion based on the linked paper.</p><div class="l-conversation" aria-live="polite">${items.length?items.map(item=>`<p class="l-user-message">${ctx.escape(item.question)}</p><div class="l-agent-message"><p>${ctx.escape(item.answer)}</p></div>`).join(''):`<div class="l-agent-message"><p>${ctx.escape(p.fits[s.goal])}</p></div>`}</div><div class="l-question-chips">${['fit','method','limits','compare'].map(topic=>ctx.button(prompts[topic],'learning-question',`${p.id}:${topic}`,'l-question')).join('')}</div><form id="learning-chat" class="l-chat-form" data-paper-id="${p.id}"><input name="question" data-learning-question aria-label="Question about this paper" placeholder="Ask about this paper…" maxlength="1000" autocomplete="off" required><button class="l-send" type="submit" aria-label="Send question">${ctx.icon('arrow',18)}</button></form>${sourceLink(ctx,p)}`};}
export function learningSheet(ctx,id){const s=normalized(ctx.state);
 if(String(id).startsWith('chat:')){const p=byId(String(id).slice(5));return p?discussion(ctx,p,s):learningSheet(ctx,'compare');}
 if(id==='goal')return {title:'Choose your research focus',body:`<div class="l-goal-choices">${goals.map(g=>`<button class="l-goal-choice${s.goal===g.id?' selected':''}" data-action="learning-goal" data-id="${g.id}" aria-pressed="${s.goal===g.id}"><strong>${g.label}</strong><span>${g.detail}</span></button>`).join('')}</div><div class="l-follow"><div><strong>${s.tracking?'Research focus saved':'Keep finding research for me'}</strong><p>Bring me new evidence worth reading.</p></div><button class="l-follow-button${s.tracking?' selected':''}" data-action="learning-track" aria-pressed="${s.tracking}">${s.tracking?'Unfollow':'Follow'}</button></div><p class="l-discussion-note">This prototype saves your focus locally. Background search is not connected.</p>`};
 if(id==='compare')return {title:'Three approaches to improvement',body:`<div class="l-comparison">${papers.map(p=>`<button data-action="learning-open" data-id="${p.id}"><span>${p.short}</span><strong>${p.route}</strong><span>${p.id==='dgm'?'Evaluate each new version on tasks':p.id==='seal'?'Learn new knowledge; measure forgetting':'Keep lessons and make them correctable'}</span></button>`).join('')}</div><div class="l-summary"><h3>What this could mean for Chora</h3><p>Make lessons traceable and reversible, then evaluate strategy changes on past tasks. Consider costlier weight updates only when evidence supports the benefit.</p><p class="l-muted">This is a design inference for your project, not a conclusion directly established by these papers.</p></div>`};
 const p=byId(id)||byId('dgm');return paperDetail(ctx,p,s);
}
