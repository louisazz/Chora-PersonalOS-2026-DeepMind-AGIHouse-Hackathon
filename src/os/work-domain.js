// Work: a persistent task state projected into the controls each stage needs.
const projects=[
 {id:'interviews',name:'User interviews',conversations:5},
 {id:'product',name:'Explore product concepts',conversations:4},
 {id:'build',name:'New features for Lazy',conversations:1}
];
const questions=[
 ['q1','Last time your plans changed, what did you open first?'],
 ['q2','When would you rather your agent stay quiet?'],
 ['q3','What can your agent do for you, and what needs your approval?']
];
const followups=[['f1','Test ticket booking with a spending limit'],['f2','Decide which changes need an update']];
const buildSteps=[['scope','Define the task scope and success criteria'],['action','Connect execution, recovery and cancellation'],['restore','Check task resumption and supporting history']];
const materials=[['letter','Recommendation letters'],['portfolio','Projects and portfolio'],['history','Employment records']];
const options=[
 {id:'life',name:'Life home screen',description:'Keep ongoing activities in stable life areas',fit:'For the things you return to every day',next:'Test ticket booking from delegation to recovery and cancellation'},
 {id:'overlay',name:'Floating assistant',description:'Handle quick requests within the current app',fit:'Stay with what you are doing',next:'Test opening and returning from an email'},
 {id:'canvas',name:'Task canvas',description:'Bring research, comparisons and decisions together',fit:'For complex work that needs side-by-side thinking',next:'Compare product concepts to test the information layout'}
];

export const initialWork=()=>({focus:'interviews',interviewPhase:'prepare',interviewNotes:'',noteError:false,questions:['q1','q2','q3'],asked:[],followups:[],productChoice:null,productTested:false,buildStarted:false,buildChecks:[],todos:[],materials:[],plannedNext:null,plannedNextDone:false});
const toggle=(items,id)=>items.includes(id)?items.filter(x=>x!==id):[...items,id];
const normalize=(state)=>{
 const next={...initialWork(),...state};
 return next;
};
export function workNextStep(notes){
 const text=String(notes||'').trim();
 if(!text)return null;
 if(/cancel|undo|permission|approval|budget|limit/i.test(text))return 'Test delegation limits and cancellation with a ticket-booking task';
 if(/interrupt|remind|ignore|proactive|quiet/i.test(text))return 'Compare proactive and quiet handling to test when an interruption helps';
 if(/time|schedule|travel|leav|map/i.test(text))return 'Test how information follows a change of plans across apps';
 if(/home.?screen|layout|interface/i.test(text))return 'Test home-screen information and actions with a real daily task';
 return 'Review the interview notes and list questions still to test';
}

export function reduceWork(state,action){
 const next=structuredClone(normalize(state));
 const {type,id}=action;
 if(type==='work-focus'&&projects.some(p=>p.id===id))next.focus=id;
 if(type==='work-question'&&questions.some(([key])=>key===id))next.questions=toggle(next.questions,id);
 if(type==='work-asked'&&next.questions.includes(id)&&questions.some(([key])=>key===id))next.asked=toggle(next.asked,id);
 if(type==='work-note'&&typeof action.value==='string'){next.interviewNotes=action.value.slice(0,12000);next.noteError=false;}
 if(type==='work-start'&&next.interviewPhase==='prepare'&&next.questions.length>0){next.focus='interviews';next.interviewPhase='live';}
 if(type==='work-finish'&&next.interviewPhase==='live')next.interviewPhase='review';
 if(type==='work-followup'&&followups.some(([key])=>key===id))next.followups=toggle(next.followups,id);
 if(type==='work-review-done'&&next.interviewPhase==='review'){if(next.interviewNotes.trim()){next.interviewPhase='done';next.noteError=false;}else next.noteError=true;}
 if(type==='work-reopen-interview'&&next.interviewPhase==='done')next.interviewPhase='review';
 if(type==='work-product-choice'&&options.some(o=>o.id===id)){next.productChoice=id;next.productTested=false;}
 if(type==='work-product-tested'&&next.productChoice)next.productTested=!next.productTested;
 if(type==='work-build-start')next.buildStarted=true;
 if(type==='work-build-check'&&buildSteps.some(([key])=>key===id)){next.buildStarted=true;next.buildChecks=toggle(next.buildChecks,id);}
 if(type==='work-todo'&&['parcel','snack'].includes(id))next.todos=toggle(next.todos,id);
 if(type==='work-material'&&materials.some(([key])=>key===id))next.materials=toggle(next.materials,id);
 if(type==='work-use-next'&&next.interviewPhase==='done'&&next.interviewNotes.trim()){next.plannedNext=workNextStep(next.interviewNotes);next.plannedNextDone=false;}
 if(type==='work-next-done'&&next.plannedNext)next.plannedNextDone=!next.plannedNextDone;
 return next;
}

function stateLabel(s,id){
 if(id==='interviews')return {prepare:'Ready to interview',live:'Interview in progress',review:'Ready to review',done:'Notes saved'}[s.interviewPhase]||'Ready to interview';
 if(id==='product')return s.productTested?'Tested':s.productChoice?'To test':'To compare';
 return s.buildChecks.length===buildSteps.length?'Checks complete':s.buildStarted?'In progress':'Not started';
}
function checklist(ctx,items,selected,action){
 const {escape,icon}=ctx;
 return `<div class="w-checklist">${items.map(([id,text])=>`<button class="w-check-row ${selected.includes(id)?'is-checked':''}" data-action="${action}" data-id="${id}" aria-pressed="${selected.includes(id)}"><span class="w-check" aria-hidden="true">${selected.includes(id)?icon('check',12):''}</span><span>${escape(text)}</span></button>`).join('')}</div>`;
}
function noteEditor(ctx,compact){
 const s=normalize(ctx.state);
 return `<label class="w-note-label">Interview notes<textarea class="w-notes ${compact?'is-compact':''}" data-work-note aria-label="Interview notes" placeholder="Capture quotes, observations and open questions" maxlength="12000">${ctx.escape(s.interviewNotes)}</textarea></label>${s.noteError?'<p class="w-note-error" role="alert">Add some notes before saving.</p>':''}`;
}
function interview(ctx,compact=false){
 const s=normalize(ctx.state),{button,escape}=ctx;
 const selected=questions.filter(([id])=>s.questions.includes(id));
 if(s.interviewPhase==='prepare')return `<div class="w-stage-heading"><h3>Your interview outline is ready</h3><span>${selected.length}/3</span></div><p class="w-agent-context">Building on your earlier discussions, focus on what people want an agent to handle.</p><div class="w-question-picker">${checklist(ctx,questions,s.questions,'work-question')}</div><div class="w-actions">${selected.length?button('Start interview','work-start','','w-primary'):button('Choose at least one question','work-start','','w-primary').replace('<button','<button disabled aria-disabled="true"')}${compact?button('View outline and context','work-open','interviews','w-link'):''}</div>`;
 if(s.interviewPhase==='live')return `<div class="w-stage-heading"><h3>Interview in progress</h3><span>${s.asked.filter(id=>s.questions.includes(id)).length}/${selected.length}</span></div>${checklist(ctx,selected,s.asked,'work-asked')}${noteEditor(ctx,compact)}<div class="w-actions">${button('Finish interview','work-finish','','w-primary')}</div>`;
 if(s.interviewPhase==='done')return `<div class="w-stage-heading"><h3>Notes saved</h3></div><p class="w-note-preview ${compact?'is-compact':''}">${escape(s.interviewNotes)}</p><div class="w-proposed-next"><span>Based on these notes, test next</span><p>${escape(workNextStep(s.interviewNotes))}</p>${s.plannedNext===workNextStep(s.interviewNotes)?'<span>Added to your tasks</span>':button('Add to tasks','work-use-next','','w-link')}</div><div class="w-actions">${button('Add more notes','work-reopen-interview','','w-primary')}${compact?button('View notes','work-open','interviews','w-link'):''}</div>${compact?'':`<h4 class="w-subheading">Earlier questions to test</h4>${checklist(ctx,followups,s.followups,'work-followup')}`}`;
 return `<div class="w-stage-heading"><h3>${s.interviewNotes.trim()?'Review this interview':'No interview notes yet'}</h3></div>${noteEditor(ctx,compact)}<div class="w-actions">${button('Save notes','work-review-done','','w-primary')}${compact?button('Open review','work-open','interviews','w-link'):''}</div>${compact?'':`<h4 class="w-subheading">Earlier questions to test</h4>${checklist(ctx,followups,s.followups,'work-followup')}`}`;
}
function product(ctx,compact=false){
 const s=normalize(ctx.state),{button,escape,icon}=ctx,selected=options.find(o=>o.id===s.productChoice);
 if(selected&&compact)return `<div class="w-stage-heading"><h3>${selected.name}</h3><span>${s.productTested?'Tested':'To test'}</span></div><p class="w-body">${escape(selected.next)}</p><div class="w-actions">${button(s.productTested?'Compare again':'Compare and test','work-open','product','w-primary')}</div>`;
 return `<div class="w-stage-heading"><h3>${selected?'Compare product concepts':'Test the life home screen first'}</h3></div>${selected?'':'<p class="w-agent-context">Your goal is continuity. Start with a home screen for ongoing activities and compare it with the other two concepts.</p>'}<div class="w-options" role="group" aria-label="Product concept">${options.map(o=>`<button class="w-option ${s.productChoice===o.id?'is-selected':''}" data-action="work-product-choice" data-id="${o.id}" aria-pressed="${s.productChoice===o.id}"><span class="w-option-title">${o.name}${s.productChoice===o.id?`<span aria-hidden="true">${icon('check',15)}</span>`:''}</span><span>${compact?o.fit:o.description}</span>${compact?'':`<small>${o.fit}</small>`}</button>`).join('')}</div>${selected?`<div class="w-next-note">Next · ${selected.next}</div><div class="w-actions">${button(s.productTested?'Mark as untested':'Mark as tested','work-product-tested','','w-primary')}</div>`:`<div class="w-actions">${button('Test this direction','work-product-choice','life','w-primary')}</div>`}`;
}
function development(ctx,compact=false){
 const s=normalize(ctx.state),{button}=ctx;
 return `<div class="w-stage-heading"><h3>${s.buildChecks.length===3?'All feature checks passed':'Acceptance checks are ready'}</h3><span>${s.buildChecks.length}/3</span></div>${!s.buildStarted?'<p class="w-agent-context">Check these three parts of the delegation flow.</p>':''}${checklist(ctx,buildSteps,s.buildChecks,'work-build-check')}<div class="w-actions">${!s.buildStarted?button('Start with this scope','work-build-start','','w-primary'):compact?button('View acceptance checks','work-open','build','w-link'):''}</div>`;
}
function workspace(ctx,compact){
 const s=normalize(ctx.state);
 return s.focus==='product'?product(ctx,compact):s.focus==='build'?development(ctx,compact):interview(ctx,compact);
}

export function renderWork(ctx){
 const s=normalize(ctx.state),{section,button,escape,icon}=ctx;
 return `${section('For now')}<div class="w-suggestion-rail suggestion-lane" data-suggestion-row="work" role="group" aria-label="Work suggestions, swipe for more"><a class="w-now" href="https://www.google.com/maps/dir/?api=1&destination=Montgomery%20Street%20Station%20San%20Francisco&travelmode=walking" target="_blank" rel="noopener noreferrer" data-action="handoff" data-id="maps" data-context="work-commute"><strong>Leave by 6:26 PM</strong><span>6:42 PM BART · View route</span></a><button class="w-now" data-action="work-open" data-id="parcel"><strong>${s.todos.includes('parcel')?'Package collected':'Pick up your package downstairs'}</strong><span>${s.todos.includes('parcel')?'View pickup details':'Lobby · Pickup code 075514'}</span></button></div>${section('Projects')}<div class="w-projects" role="group" aria-label="Current projects">${projects.map(p=>`<button class="w-project ${s.focus===p.id?'is-current':''}" data-action="work-focus" data-id="${p.id}" aria-pressed="${s.focus===p.id}"><strong>${p.name}</strong><span>${stateLabel(s,p.id)}</span></button>`).join('')}</div><section class="w-workspace" aria-label="${escape(projects.find(p=>p.id===s.focus)?.name||'User interviews')}">${workspace({...ctx,state:s},true)}</section>${section('To-dos')}<div class="w-todos">${s.plannedNext?`<button class="w-todo ${s.plannedNextDone?'is-checked':''}" data-action="work-next-done" aria-pressed="${s.plannedNextDone}"><span class="w-check" aria-hidden="true">${s.plannedNextDone?icon('check',12):''}</span><span>${escape(s.plannedNext)}</span></button>`:''}<button class="w-todo w-todo-open" data-action="work-open" data-id="documents"><span>Organize O-1A documents</span><small>${s.materials.length===3?'Ready':(3-s.materials.length)+' left'}</small></button>${[['parcel','Collect your office package'],['snack','Bring snacks for the team']].map(([id,label])=>`<button class="w-todo ${s.todos.includes(id)?'is-checked':''}" data-action="work-todo" data-id="${id}" aria-pressed="${s.todos.includes(id)}"><span class="w-check" aria-hidden="true">${s.todos.includes(id)?icon('check',12):''}</span><span>${label}</span></button>`).join('')}</div>`;
}

export function workSheet(ctx,id){
 const s=normalize(ctx.state),{button}=ctx;
 if(id==='interviews')return {title:'User interviews',body:`<div class="w-sheet-meta">${stateLabel(s,id)} · 5 related conversations</div><div class="w-detail">${interview({...ctx,state:s})}</div><details class="w-sources"><summary>Revisit 5 earlier conversations</summary><ol><li>Goal: understand how people switch between everyday tasks.</li><li>Scenario: plans change and the information is spread across apps.</li><li>Reminder preference: lead with the time and next action.</li><li>Action boundaries: allow changes and cancellation after setup.</li><li>Next round: test delegation permissions and cancellation.</li></ol></details>`};
 if(id==='product')return {title:'Explore product concepts',body:`<div class="w-sheet-meta">${stateLabel(s,id)} · 4 related conversations</div><div class="w-detail">${product({...ctx,state:s})}</div>`};
 if(id==='build')return {title:'New features for Lazy',body:`<div class="w-sheet-meta">${stateLabel(s,id)} · 1 related conversation</div><div class="w-detail">${development({...ctx,state:s})}</div>`};
 if(id==='documents')return {title:'O-1A documents',body:`<p class="w-body">${s.materials.length===3?'All three items are ready.':`${3-s.materials.length} items still to organize.`}</p>${checklist(ctx,materials,s.materials,'work-material')}`};
 if(id==='parcel')return {title:'Collect your office package',body:`<div class="w-pickup"><span>Lobby · Jasmine locker 01</span><strong>075514</strong></div><div class="w-actions">${button(s.todos.includes('parcel')?'Mark as not collected':'Collected','work-todo','parcel','w-primary')}</div>`};
 return {title:'Bring snacks for the team',body:`<p class="w-body">Bring them on your next office day.</p><div class="w-actions">${button(s.todos.includes('snack')?'Mark as not ready':'Ready to go','work-todo','snack','w-primary')}</div>`};
}
