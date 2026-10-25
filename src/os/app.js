import { renderLearning, learningSheet, learningStatus, learningNotification } from './learning-domain.js';
import { agentSheet, agentStatus, renderAgentHub, renderTripPlan } from './agent-domain.js';
import { renderWork, workSheet } from './work-domain.js';
import { renderFitness, renderHealth, healthSheet } from './health-domain.js';
import { renderMusic, musicSheet, invitationText, memoryText } from './music-domain.js';
import { icon, appIcon, providerMeta } from './icons.js';
import { domains, load, save, transition, suggestions, links, saveSuggestedAction, homeActivity } from './state.js';
import { live, onLive } from './live';

const escape=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let storage;try{storage=window.localStorage}catch{storage={getItem(){return null},setItem(){throw Error('Unavailable')}}}
let state=load(storage);
const ui={view:'home',sheet:null,filter:'all',why:'concert',query:'',toast:null,image:null};
let toastTimer,focusBefore,gestureStart,laneDrag,suppressClickUntil=0;
const root=window.__personosOsStudio||document.querySelector('#studio');
const D=root.getRootNode();
const embedded=!!window.__personosOsStudio;
const extras={tiktok:{id:'tiktok',name:'TikTok',kind:'app'},arxiv:{id:'arxiv',name:'arXiv',kind:'web'},liveweb:{id:'liveweb',name:'Event website',kind:'web'},instagram:{id:'instagram',name:'Instagram',kind:'app'},clock:{id:'clock',name:'Clock',kind:'app'},editor:{id:'editor',name:'Snapseed',kind:'app'},gemma:{id:'gemma',name:'Gemma',kind:'ai'},ticket:{id:'ticket',name:'Ticket agent',kind:'agent'},travelAgent:{id:'travelAgent',name:'Travel agent',kind:'agent'},reading:{id:'reading',name:'Research agent',kind:'agent'}};
const providers={...providerMeta,...extras};
const provider=(id)=>providers[id]||providers.web;
const logo=(id,size=28)=>id==='arxiv'?`<span class="arxiv-logo" style="width:${size}px;height:${size}px" aria-hidden="true">a<span>χ</span></span>`:id==='instagram'?`<span class="instagram-logo" style="width:${size}px;height:${size}px">${icon('camera',size-4)}</span>`:id==='clock'?`<span class="custom-app-logo clock-logo" style="width:${size}px;height:${size}px">${icon('clock',size)}</span>`:id==='editor'?`<span class="custom-app-logo editor-logo" style="width:${size}px;height:${size}px">${icon('leaf',size-6)}</span>`:id==='gemma'?`<span class="gemma-logo" style="width:${size}px;height:${size}px">${icon('sparkle',size)}</span>`:['ticket','travelAgent','reading'].includes(id)?appIcon('agent',size):appIcon(id,size);
const button=(text,action,id='',cls='text-link',symbol='')=>`<button class="${cls}" data-action="${action}"${id?` data-id="${escape(id)}"`:''}>${escape(text)}</button>`;
const section=(title,side='')=>`<div class="section-head"><h2>${title}</h2>${side}</div>`;
const receiptFor=(id)=>state.receipts.find(r=>r.id===id);
const savedTimeFor=(id)=>receiptFor(id)?.savedTime||receiptFor(id)?.detail?.match(/\b\d{2}:\d{2}\b/)?.[0]||(id==='morning'?state.alarmTime:state.reminderTime);
const activeAgent=(id)=>state.agents.includes(id);
const safeLink=(id,label,context='',url=links[id]||links.web)=>`<a class="secondary-button" href="${escape(url)}" target="_blank" rel="noopener noreferrer" data-action="handoff" data-id="${id}" data-context="${context}">${logo(['gym','cusco','bart'].includes(id)?'maps':id,20)}${escape(label)}</a>`;

const musicUrl=(name='Sunset Rollercoaster')=>{const artist={Khruangbin:'Khruangbin','The Marías':'The Marías'}[name]||'Sunset Rollercoaster';return state.musicProvider==='music'?`https://music.youtube.com/search?q=${encodeURIComponent(artist)}`:`https://www.google.com/search?q=${encodeURIComponent(artist+' official')}`};
const launchUrl=(id)=>id==='music'?'https://music.youtube.com/':id==='maps'?'https://www.google.com/maps/':links[id];

function commit(action,{message,keep=true}={}){const next=transition(state,action);if(!save(next,storage)){toast('Could not save. Try again.');return false;}state=next;render(keep);if(message)toast(message);return true;}
function domainContext(key){return {state:state[key],scene:state.scene,button,section,escape,icon,appIcon:logo,safeLink,gearList,musicProvider:state.musicProvider,agentTicket:state.agentLife.concert,agentTicketStatus:agentStatus(state.agentLife,'concert'),reminder:{done:receiptFor('concert')?.status==='demo-saved',time:savedTimeFor('concert')},event:live.snapshot?.event};}
function render(keep=true){
 const active=D.activeElement;const focusKey=active?.dataset?.action?{key:active.dataset.focusKey,action:active.dataset.action,id:active.dataset.id,label:active.getAttribute('aria-label')}:null;
 const scroll=D.querySelector('.phone-scroll')?.scrollTop||0;
 const sheetScroll=D.querySelector('.sheet-scroll')?.scrollTop||0;
 const laneScroll=[...D.querySelectorAll('[data-suggestion-row]')].map(el=>[el.dataset.suggestionRow,el.scrollLeft]);
 const phoneHTML=`<div id="phone" class="phone" data-theme="${state.theme}" data-view="${ui.view}"><div class="wallpaper"></div><div class="status-bar" aria-label="Demo status bar"><span>${live.snapshot?.timeLabel||(state.scene==='daily'?'17:41':'21:16')}</span><span class="camera-dot" aria-hidden="true"></span><span class="status-right">${icon('signal',16)}${icon('wifi',16)}${icon('battery',23)}</span></div><main class="phone-scroll" id="phone-content">${ui.view==='home'?homeView():domainView(ui.view)}</main>${dock()}<button class="gesture-bar" aria-label="Back to home" data-action="home"></button><div id="sheet-root">${ui.sheet?sheetView():''}</div><div id="toast-root">${ui.toast?toastHTML():''}</div></div>`;
 root.innerHTML=embedded?phoneHTML:`<header class="studio-header"><div class="studio-brand"><strong>chora</strong><span>PERSONAL OS / 02</span></div><div class="studio-controls"><div class="studio-segment" aria-label="Demo scene"><button data-action="scene" data-id="daily" class="${state.scene==='daily'?'selected':''}">San Francisco · Everyday</button><button data-action="scene" data-id="travel" class="${state.scene==='travel'?'selected':''}">South America · Travel</button></div><div class="studio-divider"></div><div class="studio-segment" aria-label="Theme"><button data-action="theme" data-id="light" class="${state.theme==='light'?'selected':''}" aria-label="Light theme">${icon('sun',16)}</button><button data-action="theme" data-id="dark" class="${state.theme==='dark'?'selected':''}" aria-label="Dark theme">${icon('moon',16)}</button></div></div></header>
 <div class="stage"><div class="device-holder"><div class="device">${phoneHTML}</div></div><div class="studio-caption"><span>Pixel 10 · 396 × 889 canvas</span><span>Interactive prototype · Sample data</span></div></div>`;
 if(keep){D.querySelector('.phone-scroll').scrollTop=scroll;const sh=D.querySelector('.sheet-scroll');if(sh)sh.scrollTop=sheetScroll;for(const [row,left] of laneScroll){const lane=D.querySelector(`[data-suggestion-row="${row}"]`);if(lane)lane.scrollLeft=left;}}
 const content=D.querySelector('#phone-content');content.inert=!!ui.sheet;D.querySelector('.system-dock').inert=!!ui.sheet;
 fitDevice();
 if(focusKey){const next=[...D.querySelectorAll('[data-action]')].find(el=>(focusKey.key?el.dataset.focusKey===focusKey.key:el.dataset.action===focusKey.action&&el.dataset.id===focusKey.id&&el.getAttribute('aria-label')===focusKey.label)&&!el.closest('[inert]'));next?.focus({preventScroll:true});}
}
function fitDevice(){if(embedded)return;document.documentElement.style.setProperty('--scale',String(window.innerWidth>480?Math.min(1,(window.innerWidth-42)/410,Math.max(.4,(window.innerHeight-(window.innerWidth<=700?60:120))/903)):1));}
function dock(){return `<div class="system-dock"><div class="command-row"><button class="command-open" data-action="assistant" aria-label="Ask Chora or search">${icon('search',21)}<span>Ask Chora</span></button><button class="command-tool" data-action="voice" aria-label="Voice input" title="Voice input">${icon('mic',22)}</button><button class="command-tool" data-action="image-input" aria-label="Add an image" title="Add an image">${icon('lens',22)}</button></div><div class="dock-apps">${['phone','music','calendar','maps'].map(id=>launchUrl(id)?`<a class="dock-app" aria-label="Open ${provider(id).name}" href="${launchUrl(id)}" target="_blank" rel="noopener noreferrer" data-action="handoff" data-id="${id}" data-context="dock">${logo(id,29)}</a>`:`<button class="dock-app" aria-label="Open ${provider(id).name}" data-action="provider" data-id="${id}">${logo(id,29)}</button>`).join('')}<button class="dock-app app-grid-icon" aria-label="All apps and agents" data-action="library">${icon('grid',27)}</button></div></div>`;}
function homeView(){return `<header class="home-header"><div><h1>Life</h1><p>${state.scene==='daily'?(live.snapshot?.dateLabel||'Sat, Oct 24 · San Francisco'):'Sat, Oct 24 · Cusco'}</p></div><button class="profile-button" data-action="settings" aria-label="Settings and demo controls"><span>L</span></button></header><div class="home-content">${section('For now')}${suggestionLanes(suggestions(state))}${section('My life')}<div class="life-list ${state.layout}">${domains.map(d=>{const activity=homeActivity(state,d.id);const sources=activity?.sources||[];return `<button class="life-row" data-action="domain" data-id="${d.id}"><span class="domain-icon ${d.color}" aria-hidden="true">${icon(d.icon,20)}</span><span class="life-name">${d.name}</span><span class="life-update"><span class="life-status">${escape(domainStatus(d))}</span>${sources.length?`<span class="life-apps" role="img" aria-label="Update from: ${sources.map(id=>provider(id).name).join(', ')}">${sources.map(id=>`<span aria-hidden="true">${logo(id,18)}</span>`).join('')}</span>`:''}</span></button>`}).join('')}</div></div>`;}
function domainStatus(d){
 const liveStatus=live.snapshot?.status?.[d.id];if(liveStatus)return liveStatus;
 if(d.id==='learning')return learningStatus(state.learning);
 if(d.id==='travel'&&state.scene==='travel')return agentStatus(state.agentLife,'photos').label;
 if(d.id==='music')return state.agentLife.concert.status==='draft'?(state.scene==='travel'?'Sunset Rollercoaster in SF':'Sunset Rollercoaster nearby'):agentStatus(state.agentLife,'concert').label;
 if(['games','finance','family'].includes(d.id))return state.personalGoals?.[d.id]?'Your priorities, saved':'';
 if(d.id==='health')return '5h 40m of sleep last night';
 if(d.id==='fitness')return state.health.trainingMode==='light'?'7 PM · Light boxing':'7 PM · Boxing';
 if(d.id==='work')return state.work.focus==='interviews'?({prepare:'Interview outline ready',live:'Interview in progress',review:'Interview notes to review',done:'Interview notes ready'}[state.work.interviewPhase]):state.work.focus==='product'?'Compare product concepts':'Release checklist';
 return d.status;
}
function suggestionLanes(cards){if(!cards.length)return `<div class="empty">You’re all caught up${button('Restore suggestions','restore-all')}</div>`;return `<div class="suggestion-lanes">${[0,1].map(row=>{const items=cards.filter(c=>c.row===row);return items.length?`<div class="suggestion-lane" data-suggestion-row="${row}" role="group" aria-label="Suggestion row ${row+1}; swipe for more">${items.map(suggestionCard).join('')}</div>`:''}).join('')}</div>`;}
function suggestionArtwork(c){
 if(c.live){const f=c.live.kind==='ask'?'ask':c.live.flavor;if(f==='concert'||(c.live.domain==='music'&&f!=='ask'))return '<span class="cover sunset suggestion-visual" aria-hidden="true"><span>SUNSET</span></span>';const m={boxing:['boxing','fitness'],commute:['commute','clock'],request:['paper','mail'],change:['paper','calendar'],due:['paper','run'],ask:['paper','mail']};const [color,symbol]=m[f]||['paper','book'];return `<span class="cover ${color} suggestion-visual" aria-hidden="true">${icon(symbol,32)}</span>`;}
 if(['concert','travel-music'].includes(c.id))return '<span class="cover sunset suggestion-visual" aria-hidden="true"><span>SUNSET</span></span>';
 const images={boxing:['boxing','fitness'],papers:['paper','book'],commute:['commute','clock'],photos:['mountain','camera'],morning:['sunrise','sun'],'meeting-map':['mountain','map']};
 const [color,symbol]=images[c.id]||['paper','book'];return `<span class="cover ${color} suggestion-visual" aria-hidden="true">${icon(symbol,32)}</span>`;
}
function suggestionCard(c){
 const action=c.live?(c.live.kind==='ask'?'live-ask':'live-open'):c.intent==='goal'?'goal-open':c.intent==='learning'?'learning-open':c.done?'plan':c.quick?'quick-save':c.intent==='project'?'project':'plan';
 const sub=c.done?`${savedTimeFor(c.id)} ${c.id==='morning'?'alarm set':'reminder added'} · Tap to edit`:c.sub;
 const body=`${suggestionArtwork(c)}<span class="suggestion-text"><strong>${escape(c.title)}</strong><span class="suggestion-sub">${escape(sub)}</span><span class="suggestion-action${c.emphasis?' primary':''}">${escape(c.cta||'View')}${icon('arrow',14)}</span></span>`;
 const cls=`suggestion${c.done?' is-done':''}`;
 if(c.intent==='music'||c.intent==='link'){const id=c.intent==='music'?state.musicProvider:c.kind;return `<a class="${cls}" data-focus-key="suggestion-${c.id}" href="${escape(c.intent==='music'?musicUrl():links[id])}" target="_blank" rel="noopener noreferrer" data-action="handoff" data-id="${id}" data-context="${c.id}">${body}</a>`;}
 return `<button class="${cls}" data-focus-key="suggestion-${c.id}" data-action="${action}" data-id="${c.kind}" aria-label="${escape([c.title,sub,c.cta].map(text=>text.replace(/[.!?]+$/,'')).join('. '))}">${body}</button>`;
}
function domainView(id){const d=domains.find(x=>x.id===id);if(!d)return homeView();return `<header class="domain-header"><div class="back-row"><button class="back-button" data-action="home" aria-label="Back to home">${icon('back',22)}</button><button class="back-button" data-action="settings" aria-label="Settings">${icon('more',22)}</button></div><h1>${d.name}</h1></header><div class="domain-content">${id==='music'?musicDomain():id==='work'?workDomain():id==='fitness'?fitnessDomain():id==='travel'?travelDomain():otherDomain(d)}</div>`;}
function musicDomain(){return liveShows()+renderMusic(domainContext('musicLife'));}
function liveShows(){const ms=(live.snapshot?.matters||[]).filter(m=>m.domain==='music');if(!ms.length)return '';return `${section('Shows')}<div class="todo-list live-shows">${ms.map(m=>`<button class="todo-row live-show" data-action="live-matter" data-id="${escape(m.id)}"><span class="live-show-main"><strong>${escape(m.short)}</strong><span>${escape([m.whenLabel,m.people.length?'with '+m.people.join(', '):''].filter(Boolean).join(' · '))}</span></span><span class="live-show-state${m.changed?' changed':''}">${escape(m.changed||(m.messages.length?m.messages.length+(m.messages.length===1?' message':' messages'):''))}</span></button>`).join('')}</div>`;}
function workDomain(){return renderWork(domainContext('work'));}
const gearItems=[['gloves','Gloves','Tonight’s boxing session'],['wraps','Hand wraps','From your coach'],['water','Water bottle','Fill up before leaving']];
function gearList(){return `<div class="todo-list">${gearItems.map(([id,name])=>`<button class="todo-row" data-action="gear" data-id="${id}" aria-pressed="${state.gear.includes(id)}"><span class="check-circle ${state.gear.includes(id)?'checked':''}">${state.gear.includes(id)?icon('check',13):''}</span><span>${name}</span></button>`).join('')}</div>`;}
function fitnessDomain(){return renderFitness(domainContext('health'));}
function travelDomain(){return `<div class="travel-hero"><h2>Cusco</h2><p>South America · Day 4</p></div>${section('For now')}${suggestionLanes(suggestions({...state,scene:'travel',dismissed:[]}))}${section('Tomorrow',button('Let Chora handle changes','goal-open','travel'))}${renderTripPlan(state.agentLife)}${button(receiptFor('morning')?.status==='demo-saved'&&savedTimeFor('morning')!==state.agentLife.travel.plan.wake?`Alarm ${savedTimeFor('morning')} · Review your itinerary`:'Set wake-up alarm','plan','morning')}`;}
function otherDomain(d){
 if(d.id==='learning')return renderLearning(domainContext('learning'));
 if(d.id==='health')return renderHealth(domainContext('health'));
 const prompts={games:'Who do you play with, and what do you enjoy?',finance:'Which bills, subscriptions or expenses should I keep track of?',family:'What would you like to plan with your family?'};
 const goal=state.personalGoals?.[d.id]||'';
 return `<div class="personal-focus"><h2>${goal?'What matters to you':'Start with what matters'}</h2>${goal?`<p>${escape(goal)}</p>`:`<p>${prompts[d.id]}</p>`}${button(goal?'Edit':'Tell Chora','personal-open',d.id,'secondary-button')}</div>`;
}
function personalSheet({id}){const d=domains.find(x=>x.id===id)||domains[0];return {title:`What matters to you in ${d.name.toLowerCase()}?`,body:`<form id="personal-goal" data-domain-id="${id}"><textarea class="personal-note" name="goal" aria-label="What to keep in mind" placeholder="A goal, a preference, or something to remember…" maxlength="1000" required>${escape(state.personalGoals?.[id]||'')}</textarea><button class="primary-button" type="submit">Keep this in mind</button></form>${state.personalGoals?.[id]?button('Stop following this','personal-clear',id,'text-link'):''}<p class="fine-print">Saved here. Connect relevant apps to keep following this.</p>`};}

function openSheet(type,data={}){clearTimeout(toastTimer);ui.toast=null;const seenDomain=type==='learningTask'?'learning':['concert','photos'].includes(type)?(type==='concert'?'music':'travel'):type==='goalTask'?({concert:'music',travel:'travel',photos:'travel'}[data.id]):null;if(seenDomain){const activity=homeActivity(state,seenDomain);if(activity?.unseen&&!(type==='goalTask'&&data.id==='travel'&&!activity.id.startsWith('trip-'))){const next=transition(state,{type:'seen-activity',id:activity.id});if(save(next,storage))state=next;}}if(!ui.sheet){const el=D.activeElement;focusBefore={key:el?.dataset?.focusKey,action:el?.dataset?.action,id:el?.dataset?.id,label:el?.getAttribute('aria-label')}}ui.sheet={type,...data};if(['concert','morning'].includes(type))ui.sheet.draftTime=type==='morning'?(receiptFor('morning')?.status==='demo-saved'?savedTimeFor('morning'):(state.agentLife.travel.plan.wake||state.alarmTime)):state.reminderTime;render();D.querySelector('.sheet-scroll').scrollTop=0;requestAnimationFrame(()=>D.querySelector(type==='assistant'&&data.inputMode!=='image'?'#assistant-input':'.close-button')?.focus({preventScroll:true}));}
function closeSheet(){ui.sheet=null;render();const target=[...D.querySelectorAll('[data-action]')].find(el=>focusBefore?.key?el.dataset.focusKey===focusBefore.key:el.dataset.action===focusBefore?.action&&el.dataset.id===focusBefore?.id&&el.getAttribute('aria-label')===focusBefore?.label);target?.focus({preventScroll:true});}
function goHome(){const activity=homeActivity(state,ui.view);if(activity?.unseen){const next=transition(state,{type:'seen-activity',id:activity.id});if(save(next,storage))state=next;}ui.sheet=null;ui.view='home';render(false);}
function sheetView(){const s=ui.sheet;let content;
 const map={liveCard:liveCardSheet,liveAsk:liveAskSheet,liveMatter:liveMatterSheet,memory:memorySheet,personal:personalSheet,learningTask:({id})=>learningSheet(domainContext('learning'),id),goalTask:({id})=>id==='concert'?concertSheet():agentSheet(domainContext('agentLife'),id),workTask:({id})=>workSheet(domainContext('work'),id),healthTask:({id})=>healthSheet(domainContext('health'),id),musicTask:({id})=>musicSheet(domainContext('musicLife'),id),concert:concertSheet,boxing:boxingSheet,photos:photosSheet,morning:morningSheet,commute:commuteSheet,library:librarySheet,provider:providerSheet,assistant:assistantSheet,settings:settingsSheet,receipt:receiptSheet,why:whySheet,project:projectSheet,records:recordsSheet,listen:listenSheet,route:routeSheet,photoMemory:photoMemorySheet,reset:resetSheet,about:aboutSheet};
 content=(map[s.type]||settingsSheet)(s);
 return `<div class="sheet-backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="sheet-scroll"><div class="sheet-heading"><h2 id="sheet-title">${content.title}</h2><button class="close-button" data-action="close" aria-label="Close">${icon('close',18)}</button></div>${content.body}</div></section></div>`;
}
function whyButton(id){return button('Why this suggestion','why',id,'why-line');}
function agentCard(id,title,desc){return `<div class="agent-card"><div><p>${title}</p><small>${desc}</small></div><button class="switch ${activeAgent(id)?'on':''}" role="switch" aria-checked="${activeAgent(id)}" aria-label="${activeAgent(id)?'Turn off ':'Turn on '}${title}" data-action="agent" data-id="${id}"></button></div>`;}
function concertSheet(){const sheet=agentSheet(domainContext('agentLife'),'concert');return state.agentLife.concert.status==='completed'?sheet:{...sheet,body:sheet.body+whyButton('concert')+button('Not now','dismiss','concert','text-link')};}
function boxingSheet(){const sheet=healthSheet(domainContext('health'),'plan');return {title:'Tonight’s training',body:sheet.body+`<details class="gear-checklist"><summary>${icon('check',16)}Packing checklist</summary>${gearList()}</details>`};}
function photosSheet(){return agentSheet(domainContext('agentLife'),'photos');}
function morningSheet(){const plan=state.agentLife.travel.plan;return {title:`Tomorrow at ${plan.meet} · Meet your guide`,body:`<p class="sheet-description">${escape(plan.place)} · Leave at ${plan.depart}</p><div class="plan-card"><label class="time-label" for="alarm-time">Wake-up alarm · Suggested ${plan.wake}</label><input id="alarm-time" class="time-input" type="time" data-time="alarmTime" aria-label="Wake-up time" required value="${ui.sheet.draftTime}">${ui.sheet.draftTime!==plan.wake?button(`Use suggested time: ${plan.wake}`,'use-trip-wake','','text-link'):''}</div><div class="sheet-footer">${button(receiptFor('morning')?.status==='demo-saved'?'Update alarm':'Set alarm','save-action','morning','primary-button glow')}${button('Let Chora handle itinerary changes','goal-open','travel','secondary-button')}</div>`};}
function commuteSheet(){return {title:'Before you head out',body:`<p class="sheet-description">Leave at 6:26 PM. A 12-minute walk gets you to the 6:42 PM BART.</p><div class="plan-card"><strong>Your parcel is at the front desk</strong><p class="sheet-description">Pickup code 075514</p>${button(state.work.todos.includes('parcel')?'Picked up · Undo':'Mark as picked up','work-todo','parcel','secondary-button')}</div><div class="sheet-footer">${safeLink('bart','Navigate','commute')}</div>`};}

function receiptSheet({id}){const r=receiptFor(id);if(!r)return {title:'No record yet',body:button('Back','close','','secondary-button')};const handed=r.status==='handed-off';return {title:escape(r.title),body:`<div class="plan-card"><div class="plan-heading">${escape(r.detail)}</div></div><p class="sheet-description">${handed?'App opened. Completion is not confirmed.':'Saved in this prototype. Not added to your device.'}</p><div class="sheet-footer">${!handed&&id==='morning'?button('Edit time','plan',id,'primary-button'):''}${button('Remove record','remove-receipt',r.id,'secondary-button')}</div>`};}
function whySheet({id}){
 if(String(id).startsWith('live:')){const card=liveCardById(id.slice(5));const sn=live.snapshot;return {title:'Why this suggestion',body:`${card?`<ul class="source-list">${card.because.length?card.because.map(t=>`<li><div><p>${escape(t)}</p></div></li>`).join(''):'<li><div><p>It is coming up and nothing newer has arrived about it.</p></div></li>'}</ul><p class="fine-print">Confidence ${Math.round(card.conf*100)}% · urgency ${Math.round(card.urgency*100)}% · context: ${escape(sn?.context||'')}</p>`:'<p class="sheet-description">This suggestion is no longer current.</p>'}${sn?.silences?.length?`<h3 class="live-subhead">Kept quiet</h3><ul class="source-list">${sn.silences.map(x=>`<li><div><p>${escape(x.title)}</p><small>${escape(x.reason)}</small></div></li>`).join('')}</ul>`:''}<div class="sheet-footer">${card&&!card.id.startsWith('matter:')?button('Not now','live-dismiss',card.id,'secondary-button'):''}${button('Back','close','','secondary-button')}</div>`};}
 const sources={concert:[['music','Your Sunset Rollercoaster playlist','Listening preferences'],['liveweb','The show’s official listing','Nov 21, 8 PM · The Fillmore. Tickets on sale Oct 25, 10 AM.'],['maps','Near you','The venue is 2.3 km away.']],boxing:[['calendar','Training schedule','Tonight, 7 PM · Boxing'],['keep','Your coach’s message','Bring gloves and hand wraps.']],morning:[['gmail','Your guide’s confirmation email','Tomorrow, 7:30 AM · Plaza de Armas'],['maps','Hotel to meeting point','About a 12-minute walk. Check the route before leaving.']],photos:[['photos','Today’s photos','Your trip photos are ready to sort.']]};return {title:'Why this suggestion',body:`<ul class="source-list">${(sources[id]||sources.concert).map(([p,title,desc])=>`<li>${logo(p,26)}<div><p>${title}</p><small>${desc}</small></div></li>`).join('')}</ul><p class="fine-print">Sample sources. No accounts are connected.</p><div class="sheet-footer">${button('Back to suggestion','plan',id,'primary-button')}${button('Hide for now','dismiss',id,'secondary-button')}</div>`};}
const capabilityInfo={
 music:['Listening history is not connected.','Open YouTube Music'],calendar:['Connect your calendar to read or create events.','Open Google Calendar'],maps:['Check the route in Google Maps.','Open Google Maps'],gmail:['Email is not connected.','Open Gmail'],photos:['Choose your photos in Google Photos.','Open Google Photos'],gemini:['Opens Gemini. Add your text or photos there.','Open Gemini'],gemma:['This prototype uses sample scenarios.',null],clock:['Device alarms are not connected.',null],editor:['Open Snapseed and choose a photo there.',null],health:['Sample data. Health records are not connected.','Open Health Connect'],phone:['Calls are not available in this prototype.',null],camera:['The camera is not connected.',null],playstore:['','Open Google Play'],keep:['Notes are not connected.','Open Google Keep'],web:['','Find ticket sources']
};
function providerSheet({id}){if(['ticket','agent','travelAgent'].includes(id))return agentSheet(domainContext('agentLife'),id==='travelAgent'?'travel':'concert');if(id==='reading')return learningSheet(domainContext('learning'),'goal');const p=provider(id),info=capabilityInfo[id]||['',links[id]?`Open ${p.name}`:null];const agent=['agent','ticket','travelAgent','reading'].includes(id);return {title:escape(p.name),body:`${info[0]?`<p class="sheet-description">${info[0]}</p>`:''}${agent?agentCard(id==='agent'?'ticket':id,id==='reading'?'Review selected papers':id==='travelAgent'?'Follow tomorrow’s meetup':'Watch for tickets','Demo task. Nothing runs in the background.'):''}<div class="sheet-footer">${info[1]?safeLink(id,info[1]):button('Back','return-context','','secondary-button')}</div>`};}
function librarySheet(){const all=['music','calendar','maps','gmail','photos','tiktok','youtube','instagram','keep','clock','editor','chrome','health','playstore','gemma','gemini','ticket','travelAgent','reading','web'];const shown=all.filter(id=>ui.filter==='all'||provider(id).kind===ui.filter);return {title:'Apps & agents',body:`<div class="filter-row" role="tablist" aria-label="App or agent type">${[['all','All'],['app','App'],['ai','AI'],['agent','Agent'],['web','Web']].map(([id,name])=>`<button role="tab" aria-selected="${ui.filter===id}" class="${ui.filter===id?'selected':''}" data-action="filter" data-id="${id}">${name}</button>`).join('')}</div><div class="app-library">${shown.map(id=>{const body=`<span class="app-icon-box">${logo(id,32)}</span><span>${escape(provider(id).name)}</span>`;return launchUrl(id)?`<a class="app-tile" href="${launchUrl(id)}" target="_blank" rel="noopener noreferrer" data-action="handoff" data-id="${id}" data-context="library">${body}</a>`:`<button class="app-tile" data-action="provider" data-id="${id}">${body}</button>`}).join('')}</div>${safeLink('playstore','Find apps on Google Play','library')}`};}
function listenSheet(){return {title:'Music app',body:`<div class="music-choices">${[['music','YouTube Music'],['web','Web']].map(([id,label])=>`<label class="music-choice"><span>${label}</span><input type="radio" name="music-provider" value="${id}" data-action="music-provider" data-id="${id}" ${state.musicProvider===id?'checked':''}></label>`).join('')}</div>`};}
function routeSheet({id}){const place=id==='cusco'?'Plaza de Armas':id==='bart'?'Montgomery Station':'Boxing gym';return {title:place,body:`<div class="sheet-footer">${safeLink(id,'Open Google Maps',id)}</div>`};}
function assistantSheet(){
 const imageMode=ui.sheet?.inputMode==='image';
 const prompts=[['goal-open','concert','Get tickets for Sunset Rollercoaster nearby'],['research-prompt',learningNotification(state.learning).paperId==='compare'?'dgm':learningNotification(state.learning).paperId,'How could this RSI paper help Chora?'],['plan','boxing','Adapt tonight’s training to how I feel'],['goal-open','travel','Handle any changes to tomorrow’s trip'],['goal-open','photos','Pick the best photos from today']];
 return {title:imageMode?'Ask with an image':'What can I take care of?',body:`${imageMode?imageAttachment():''}<form class="assistant-form" id="assistant-form"><label class="sr-only" for="assistant-input">${imageMode?'Ask about your image':'Tell Chora your goal'}</label><input class="search-field" id="assistant-input" name="query" autocomplete="off" placeholder="${imageMode?'What would you like to know?':'Tell me a goal, or pick up a conversation…'}" value="${escape(ui.query)}"><button aria-label="Submit goal" type="submit">${icon('arrow',19)}</button></form>${imageMode?'':`<div class="prompt-list">${prompts.map(([a,id,t])=>button(t,a,id,'prompt')).join('')}</div>${button('View my tasks','goal-open','hub','text-link')}`}`};
}
function imageAttachment(){return `<div class="image-composer">${ui.image?`<div class="image-preview"><img src="${escape(ui.image.url)}" alt="Selected image"><button class="image-remove" data-action="remove-image" aria-label="Remove image">${icon('close',16)}</button></div>`:''}<label class="image-picker" for="chora-image">${icon('photo',22)}<span>${ui.image?'Choose another image':'Choose an image'}</span><input id="chora-image" type="file" accept="image/*" data-image-input></label></div>`;}
D.addEventListener('change',event=>{if(!event.target.hasAttribute('data-image-input'))return;const file=event.target.files?.[0];if(!file)return;if(!file.type.startsWith('image/')){toast('Choose an image file.');return;}if(ui.image)URL.revokeObjectURL(ui.image.url);ui.image={url:URL.createObjectURL(file),name:file.name};render();});
function settingsSheet(){return {title:'Settings',body:`<div class="settings-row"><span>Appearance</span><div class="mini-segment">${['light','dark'].map(id=>`<button class="${state.theme===id?'selected':''}" data-action="theme" data-id="${id}">${id==='light'?'Light':'Dark'}</button>`).join('')}</div></div><div class="settings-row"><span>My life layout</span><div class="mini-segment">${['list','grid'].map(id=>`<button class="${state.layout===id?'selected':''}" data-action="layout" data-id="${id}">${id==='list'?'List':'Grid'}</button>`).join('')}</div></div><button class="settings-row settings-nav" data-action="library"><span>Apps & agents</span></button><button class="settings-row settings-nav" data-action="listen"><span>Music app</span></button><button class="settings-row settings-nav" data-action="records"><span>Chora’s tasks</span></button><button class="settings-row settings-nav" data-action="memory"><span>What Chora knows about me</span></button><div class="settings-row"><span>Demo scene</span><div class="mini-segment">${[['daily','Everyday'],['travel','Travel']].map(([id,t])=>`<button class="${state.scene===id?'selected':''}" data-action="scene" data-id="${id}">${t}</button>`).join('')}</div></div>${state.dismissed.length?`<button class="settings-row settings-nav" data-action="restore-all"><span>Restore hidden suggestions</span><span>${state.dismissed.length}</span></button>`:''}<button class="settings-row settings-nav" data-action="about"><span>About this prototype</span></button>${button('Reset demo data','reset-confirm','','text-link')}`};}
function aboutSheet(){return {title:'About this prototype',body:`<p class="sheet-description">People, trips, listening habits, training and health records are sample data. The concert image and wallpaper are AI-generated. No microphone, accounts or device permissions are connected.</p><p class="sheet-description">Explore how a personal agent prepares actions and handles changes. Paper sources are real; summaries and discussions are offline examples. Ticket, trip and photo actions are simulated locally. Nothing is purchased, sent or run in the background. Notes, preferences and tasks are saved in this browser.</p>`};}
function resetSheet(){return {kicker:'Demo controls',title:'Start fresh?',body:`<p class="sheet-description">Clear demo plans, checklists and tasks, and restore the light home screen.</p><div class="sheet-footer">${button('Reset demo','reset','','primary-button')}${button('Keep my progress','close','','secondary-button')}</div>`};}
function recordsSheet(){return {title:'Chora’s tasks',body:`${renderAgentHub(domainContext('agentLife'))}${state.learning.tracking?button('Following: '+learningStatus(state.learning),'learning-open','goal','secondary-button'):''}<div class="receipt-list">${state.receipts.length?state.receipts.map(r=>`<button class="receipt-row" data-action="receipt" data-id="${escape(r.id)}"><span><strong>${escape(r.title)}</strong><small>${r.status==='demo-saved'?'Saved locally':r.status==='handed-off'?'App opened · Awaiting result':'Cancelled'}</small></span></button>`).join(''):'<div class="empty">No actions yet</div>'}</div>`};}
function projectSheet({id}){const travel=id==='travel-memories',paper=id==='papers';const entries={'interviews':['User interviews','5 conversations · Time to confirm'],'product':['Explore product concepts','4 conversations · In progress'],'build':['Build a new Lazy feature','1 conversation · Not started'],'documents':['O-1A application','3 items remaining'],'snacks':['Snacks for the team','Choose snacks'],'parcel':['Pick up your parcel','Ground-floor reception']};const [title,detail]=travel?['Today’s travel photos','Oct 24 · Cusco']:paper?['How can models improve themselves?','3 RSI papers to read']:entries[id]||['Task','No updates yet'];return {title,body:`<p class="sheet-description">${detail}</p>${paper?agentCard('reading','Review selected papers','Original sources included · Demo'):''}<div class="sheet-footer">${travel?button('Choose a photo editor','plan','photos','primary-button'):paper?safeLink('paper','Find papers','learning'):id==='interviews'?safeLink('calendar','Schedule in Google Calendar','work'):''}</div>`};}
function photoMemorySheet(){return {title:'Sunset Rollercoaster live',body:`<p class="sheet-description">Aug 9 · With Alex</p><div class="memory-photo" style="height:230px"></div><p class="fine-print">Sample memory with an AI-generated photo.</p>${safeLink('photos','Open Google Photos','memory')}`};}

const liveCardById=(id)=>(live.snapshot?.cards||[]).find(c=>c.id===id);
const liveMatterById=(id)=>(live.snapshot?.matters||[]).find(m=>m.id===id);
function liveActions(card){const parts=[];if(card.action)parts.push(button(card.action.label,'live-execute',card.id,'secondary-button'));parts.push(button('Why this suggestion','why','live:'+card.id,'why-line'));parts.push(card.id.startsWith('matter:')?button('Not now','dismiss','live:'+card.id,'text-link'):button('Not now','live-dismiss',card.id,'text-link'));return `<div class="sheet-footer live-actions">${parts.join('')}</div>`;}
function liveCardSheet({id}){const card=liveCardById(id);if(!card)return {title:'Taken care of',body:`<p class="sheet-description">This suggestion is no longer current.</p>${button('Back','close','','secondary-button')}`};
 if(card.flavor==='concert'){const sheet=agentSheet(domainContext('agentLife'),'concert');return {...sheet,body:sheet.body+liveActions(card)};}
 if(card.flavor==='boxing'){const sheet=boxingSheet();return {...sheet,body:sheet.body+liveActions(card)};}
 if(card.flavor==='commute'){const sheet=commuteSheet();return {title:sheet.title,body:`<p class="sheet-description">${escape(card.title)}${card.sub?' · '+escape(card.sub):''}</p>`+sheet.body.replace(/<p class="sheet-description">Leave at[^<]*<\/p>/,'')+liveActions(card)};}
 const m=card.matterId?liveMatterById(card.matterId):null;
 return {title:escape(card.title),body:`${m?`<div class="plan-card"><strong>${escape(m.name)}</strong><p class="sheet-description">${escape([m.whenLabel,m.place].filter(Boolean).join(' · '))}</p></div>`:''}${card.because.length?`<ul class="source-list">${card.because.map(t=>`<li><div><p>${escape(t)}</p></div></li>`).join('')}</ul>`:''}${liveActions(card)}`};}
function liveAskSheet({id}){const card=liveCardById(id);if(!card)return {title:'Sorted',body:`<p class="sheet-description">This one has been filed.</p>${button('Back','close','','secondary-button')}`};
 return {title:'Which is this about?',body:`<div class="plan-card"><strong>${escape(card.sender||'Unknown number')}</strong><p class="sheet-description">${escape(card.text||'')}</p></div><div class="todo-list">${(card.candidates||[]).map(c=>`<button class="todo-row" data-action="live-resolve" data-id="${escape(card.propositionId+'|'+c.objectId)}"><span>${escape(c.name)}</span></button>`).join('')}</div><div class="sheet-footer">${button('Something else…','live-correct',card.propositionId,'secondary-button')}</div><p class="fine-print">Chora did not guess: the evidence fits more than one thing, or none well enough.</p>`};}
function liveMatterSheet({id}){const m=liveMatterById(id);if(!m)return {title:'Not found',body:button('Back','close','','secondary-button')};
 return {title:escape(m.name),body:`<div class="plan-card"><div class="plan-heading">${escape([m.whenLabel,m.place].filter(Boolean).join(' · '))}</div>${m.people.length?`<p class="sheet-description">With ${escape(m.people.join(', '))}</p>`:''}${m.changed?`<p class="sheet-description live-changed">${escape(m.changed)}</p>`:''}</div>${m.messages.length?`<h3 class="live-subhead">Messages filed here</h3><ul class="source-list">${m.messages.map(p=>`<li><div><p>${escape(p.sender?p.sender+': ':'')}${escape(p.text)}</p><small>${button('Not this one','live-correct',p.id,'text-link')}</small></div></li>`).join('')}</ul>`:''}${m.facts.length?`<h3 class="live-subhead">What Chora knows</h3><ul class="source-list">${m.facts.map(p=>`<li><div><p>${escape(p.text)}</p></div></li>`).join('')}</ul>`:''}`};}
function memorySheet(){const props=live.snapshot?.propositions||[];const groups=[['fact','Facts'],['habit','Habits'],['request','Requests']];
 return {title:'What Chora knows about you',body:`<p class="sheet-description">Forget anything here and every suggestion built on it goes with it.</p>${groups.map(([kind,label])=>{const items=props.filter(p=>p.kind===kind);return items.length?`<h3 class="live-subhead">${label}</h3><ul class="source-list live-memory">${items.map(p=>`<li><div><p${p.status==='frozen'?' class="is-frozen"':''}>${escape(p.text)}</p><small>${escape([p.about?'about '+p.about:'',p.sender||p.source,Math.round(p.conf*100)+'%'].filter(Boolean).join(' · '))}</small><small>${button(p.status==='frozen'?'Use again':'Stop using','live-freeze',p.id,'text-link')} ${button('Forget','live-forget',p.id,'text-link')}</small></div></li>`).join('')}</ul>`:''}).join('')}${props.length?'':'<div class="empty">Nothing learned yet</div>'}`};}

function toast(text,undo){clearTimeout(toastTimer);ui.toast={text,undo};D.querySelector('#toast-root').innerHTML=toastHTML();toastTimer=setTimeout(()=>{ui.toast=null;const el=D.querySelector('#toast-root');if(el)el.innerHTML='';},undo?8000:4000);}
function toastHTML(){return `<div class="os-toast" role="status"><span>${escape(ui.toast.text)}</span>${ui.toast.undo?button('Undo','undo',ui.toast.undo,'') :''}</div>`;}
function saveAction(id){
 const previous=receiptFor(id);
 const editing=ui.sheet?.type===id;
 if(editing&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(ui.sheet.draftTime)){D.querySelector('.time-input')?.reportValidity();return;}
 const candidate=editing?transition(state,{type:'time',id:id==='morning'?'alarmTime':'reminderTime',value:ui.sheet.draftTime}):state;
 const result=saveSuggestedAction(candidate,id,storage);
 if(!result.stored){toast('Could not save. Try again.');return;}
 state=result.state;
 ui.undoReceipt={id,previous};
 const message=`${savedTimeFor(id)} ${id==='morning'?'alarm set':'reminder added'}`;
 if(ui.sheet)closeSheet();else render();
 toast(message,`save:${id}`);
}
function undoSavedAction(id){
 const undo=ui.undoReceipt;if(!undo||undo.id!==id)return;
 const next=transition(state,{type:'remove-receipt',id});if(undo.previous){next.receipts.unshift(undo.previous);next[id==='morning'?'alarmTime':'reminderTime']=undo.previous.savedTime||next[id==='morning'?'alarmTime':'reminderTime'];}
 if(!save(next,storage)){toast('Could not undo. Try again.');return;}
 state=next;ui.undoReceipt=null;ui.toast=null;render();toast('Undone');
}
function navigateDomain(id){const activity=homeActivity(state,id);if(activity?.unseen){const next=transition(state,{type:'seen-activity',id:activity.id});if(save(next,storage))state=next;}ui.view=id;ui.sheet=null;render(false);}
D.addEventListener('click',event=>{if(Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
D.addEventListener('click',event=>{
 if(event.target.classList.contains('sheet-backdrop')){closeSheet();return;}
 const el=event.target.closest('[data-action]');if(!el)return;const {action,id,context}=el.dataset;
 if(action==='live-open'){openSheet('liveCard',{id});return;}
 if(action==='live-ask'){openSheet('liveAsk',{id});return;}
 if(action==='live-matter'){openSheet('liveMatter',{id});return;}
 if(action==='memory'){openSheet('memory');return;}
 if(action==='live-execute'){const card=liveCardById(id);if(card?.action&&live.api){const providers={'calendar.reminder':'calendar','alarm.set':'clock','leave.by':'maps','check.gear':'keep','reply':'phone','open.link':'chrome','share':'instagram'};live.api.execute(card.action).then(r=>{state=transition(state,{type:'receipt',id:'live-'+card.id,status:'handed-off',title:card.action.label,provider:providers[card.action.intent]||'web',detail:r});save(state,storage);render();toast(r.length>90?r.slice(0,90)+'…':r);});}return;}
 if(action==='live-dismiss'){ui.sheet=null;live.api?.dismiss(id);render();toast('Suggestion hidden');return;}
 if(action==='live-resolve'){const [pid,oid]=id.split('|');ui.sheet=null;live.api?.resolveAsk(pid,oid);render();toast('Filed');return;}
 if(action==='live-correct'){ui.sheet=null;render();live.api?.openCorrection(id);return;}
 if(action==='live-forget'){live.api?.deleteProposition(id);toast('Forgotten. Suggestions built on it are gone.');return;}
 if(action==='live-freeze'){live.api?.freezeProposition(id);return;}
 if(action==='home')goHome();
 else if(action==='domain')navigateDomain(id);
 else if(action==='goal-open')openSheet('goalTask',{id});
 else if(action==='personal-open')openSheet('personal',{id});
 else if(action==='personal-clear'){if(commit({type:'personal-goal',id,value:''}))closeSheet();}
 else if(action==='learning-open')openSheet('learningTask',{id});
 else if(action==='research-prompt'){if(commit({type:'learning-ask',id,value:'How could this paper help Chora?'}))openSheet('learningTask',{id:`chat:${id}`});}
 else if(action==='learning-discuss')openSheet('learningTask',{id:`chat:${id}`});
 else if(action.startsWith('learning-'))commit({type:action,id});
 else if(action.startsWith('goal-'))commit({type:action,id,field:el.dataset.field,value:el.dataset.value});
 else if(action==='work-open')openSheet('workTask',{id});
 else if(action==='health-open')openSheet('healthTask',{id});
 else if(action==='music-open')openSheet('musicTask',{id});
 else if(action==='music-invite'){if(state.musicLife.friends.length&&state.musicLife.songs.length&&commit({type:'music-prepare'}))openSheet('musicTask',{id:'invite'});}
 else if(action==='music-share'){if(commit({type:'music-memory-prepare'}))openSheet('musicTask',{id:'memory-share'});}
 else if(action==='music-copy')copyMusicDraft(id);
 else if(action.startsWith('work-')||action.startsWith('health-')||action==='music-friend'||action==='music-song'||action==='music-recommend')commit({type:action,id});
 else if(action==='close')closeSheet();
 else if(action==='theme'||action==='layout'){commit({type:action,value:id});}
 else if(action==='scene'){ui.sheet=null;ui.view='home';commit({type:'scene',value:id},{keep:false});}
 else if(action==='plan')openSheet(id);
 else if(action==='quick-save')saveAction(id);
 else if(action==='settings')openSheet('settings');
 else if(action==='about')openSheet('about');
 else if(action==='library'){ui.filter='all';openSheet('library');}
 else if(action==='filter'){ui.filter=id;render();}
 else if(action==='provider')openSheet('provider',{id,origin:ui.sheet});
 else if(action==='return-context'){const previous=ui.sheet?.origin;if(previous){ui.sheet=previous;render();D.querySelector('.sheet-scroll').scrollTop=0;D.querySelector('.close-button')?.focus({preventScroll:true});}else closeSheet();}
 else if(action==='assistant')openSheet('assistant');
 else if(action==='image-input')openSheet('assistant',{inputMode:'image'});
 else if(action==='remove-image'){if(ui.image)URL.revokeObjectURL(ui.image.url);ui.image=null;render();}
 else if(action==='voice'){openSheet('assistant');toast('Voice input isn’t connected yet.');}
 else if(action==='receipt')openSheet('receipt',{id});
 else if(action==='why')openSheet('why',{id});
 else if(action==='project'){if(id==='papers')navigateDomain('learning');else if(['interviews','product','build','documents','parcel','snacks'].includes(id))openSheet('workTask',{id});else openSheet('goalTask',{id:'photos'});}
 else if(action==='route')openSheet('route',{id});
 else if(action==='records')openSheet('records');
 else if(action==='listen')openSheet('listen',{id:id||'Sunset Rollercoaster'});
 else if(action==='memory-photo')openSheet('photoMemory');
 else if(action==='gear')commit({type:'gear',id});
 else if(action==='agent'){const enabled=!activeAgent(id);commit({type:'agent',id},{message:enabled?'Demo task enabled':'Task stopped'});}
 else if(action==='use-trip-wake'){ui.sheet.draftTime=state.agentLife.travel.plan.wake;saveAction('morning');}
 else if(action==='save-action')saveAction(id);
 else if(action==='music-provider')commit({type:'music-provider',value:id},{message:'Music app updated'});
 else if(action==='dismiss'){ui.sheet=null;commit({type:'dismiss',id});toast('Suggestion hidden',id);}
 else if(action==='undo'){if(id.startsWith('save:'))undoSavedAction(id.slice(5));else{ui.toast=null;commit({type:'restore',id});toast('Suggestion restored');}}
 else if(action==='restore-all'){state={...state,dismissed:[]};save(state,storage);ui.sheet=null;render();toast('Suggestions restored.');}
 else if(action==='remove-receipt'){ui.sheet=null;commit({type:'remove-receipt',id},{message:'Local record removed.'});}
 else if(action==='handoff'){
   // A real link opens the external service; no completion is inferred from navigation.
   const rId=`handoff-${context||'app'}-${id}`;
   state=transition(state,{type:'receipt',id:rId,status:'handed-off',title:`Open ${provider(['gym','cusco','bart'].includes(id)?'maps':id).name}`,provider:['gym','cusco','bart'].includes(id)?'maps':id,detail:'External page opened. Completion is not confirmed.'});
   save(state,storage);toast('Opening app');
 }
 else if(action==='reset-confirm')openSheet('reset');
 else if(action==='reset'){ui.sheet=null;ui.view='home';ui.toast=null;commit({type:'reset'},{keep:false});}
});
function saveDraft(action){const next=transition(state,action);if(save(next,storage))state=next;else toast('Could not save the draft. Try again.');}
async function copyMusicDraft(id){const text=D.querySelector('.m-draft')?.value??(id==='invite'?(state.musicLife.invitationDraft??invitationText(state.musicLife)):(state.musicLife.memoryDraft??memoryText));try{await navigator.clipboard.writeText(text);toast(id==='invite'?'Invitation copied':'Caption copied');}catch{const field=D.querySelector('.m-draft');field?.focus();field?.select();toast('Copy the selected text');}}
D.addEventListener('input',event=>{const el=event.target;if(el.dataset.goalField)saveDraft({type:'goal-field',id:el.dataset.goalId,field:el.dataset.goalField,value:el.value});if(el.hasAttribute('data-work-note'))saveDraft({type:'work-note',value:el.value});if(el.dataset.musicDraft)saveDraft({type:'music-draft',id:el.dataset.musicDraft,value:el.value});});
D.addEventListener('change',event=>{const el=event.target;if(el.dataset.goalField)saveDraft({type:'goal-field',id:el.dataset.goalId,field:el.dataset.goalField,value:el.value});if(el.dataset.time&&['concert','morning'].includes(ui.sheet?.type))ui.sheet.draftTime=el.value;});
D.addEventListener('submit',event=>{
 const form=event.target;
 if(form.id==='learning-chat'){event.preventDefault();const value=String(new FormData(form).get('question')||'').trim();if(value&&commit({type:'learning-ask',id:form.dataset.paperId,value})){const input=D.querySelector('[data-learning-question]');input?.focus({preventScroll:true});input?.scrollIntoView({block:'nearest'});}return;}
 if(form.id==='personal-goal'){event.preventDefault();const value=String(new FormData(form).get('goal')||'').trim();if(value&&commit({type:'personal-goal',id:form.dataset.domainId,value})){closeSheet();toast('Saved');}return;}
 if(form.id!=='assistant-form')return;event.preventDefault();const query=String(new FormData(form).get('query')||'').trim();ui.query=query;
 if(ui.sheet?.inputMode==='image'){toast(ui.image?'Image attached locally. Visual analysis is not connected yet.':'Choose an image first.');return;}
 if(live.api&&query){const m=/^([^:：]{1,40})[:：]\s*(.+)$/.exec(query);const sender=m?m[1].trim():undefined,text=m?m[2].trim():query;ui.sheet=null;ui.query='';render();toast('Reading…');live.api.feed({text,sender,source:'message'}).then(r=>toast(r.length>90?r.slice(0,90)+'…':r)).catch(e=>toast('Could not process: '+e));return;}
 if(/paper|research|RSI|DGM|SEAL|Reflexion|self.improvement/i.test(query)){const paper=/seal/i.test(query)?'seal':/reflexion/i.test(query)?'reflexion':/dgm|darwin/i.test(query)?'dgm':learningNotification(state.learning).paperId;const id=['compare','goal'].includes(paper)?'dgm':paper;commit({type:'learning-ask',id,value:query});openSheet('learningTask',{id:`chat:${id}`});}
 else if(/boxing|fitness|training|workout|sleep|health|gear/i.test(query))openSheet('boxing');
 else if(/photo|picture/i.test(query))openSheet('goalTask',{id:'photos'});
 else if(/trip|travel|guide|itinerary|tomorrow/i.test(query))openSheet('goalTask',{id:'travel'});
 else if(/karaoke|sing.*together/i.test(query))openSheet('musicTask',{id:'karaoke'});
 else if(/sing|record|TikTok/i.test(query))openSheet('musicTask',{id:'record'});
 else if(/music history|music theory|genre|synth/i.test(query))openSheet('musicTask',{id:'discover'});
 else if(/playlist|music|listen/i.test(query))navigateDomain('music');
 else if(/ticket|concert|show|sunset/i.test(query))openSheet('goalTask',{id:'concert'});
 else if(/work|interview|product|develop/i.test(query))navigateDomain('work');
 else toast('Try one of the examples below. General chat is not connected yet.');
});
D.addEventListener('keydown',event=>{const lane=event.target.closest('.suggestion-lane');if(lane&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const cards=[...lane.children];const next=cards[cards.indexOf(event.target.closest('.suggestion, .w-now'))+(event.key==='ArrowRight'?1:-1)];next?.focus({preventScroll:true});next?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'});return;}if(event.key==='Escape'){ui.sheet?closeSheet():goHome();return;}if(event.key==='Tab'&&ui.sheet){const items=[...D.querySelectorAll('.sheet button:not(:disabled),.sheet a,.sheet input,.sheet textarea,.sheet select,.sheet summary')];const first=items[0],last=items.at(-1);if(event.shiftKey&&D.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&D.activeElement===last){event.preventDefault();first?.focus();}}});
D.addEventListener('pointerdown',event=>{const lane=event.target.closest('.suggestion-lane');if(lane&&event.pointerType==='mouse'&&event.button===0)laneDrag={lane,x:event.clientX,left:lane.scrollLeft,pointerId:event.pointerId,moved:false};if(event.target.closest('.system-dock'))gestureStart={x:event.clientX,y:event.clientY};});
D.addEventListener('pointermove',event=>{if(!laneDrag)return;const d=laneDrag;const delta=(event.clientX-d.x)/(window.innerWidth>480?parseFloat(document.documentElement.style.getPropertyValue('--scale'))||1:1);if(Math.abs(delta)>6&&!d.moved){d.moved=true;d.lane.setPointerCapture(d.pointerId);d.lane.classList.add('dragging');}if(d.moved){d.lane.scrollLeft=d.left-delta;event.preventDefault();}});
function finishLaneDrag(){if(laneDrag?.moved){suppressClickUntil=Date.now()+350;laneDrag.lane.classList.remove('dragging');}laneDrag=null;}
D.addEventListener('pointercancel',finishLaneDrag);
D.addEventListener('pointerup',event=>{finishLaneDrag();if(gestureStart&&gestureStart.y-event.clientY>45&&Math.abs(event.clientX-gestureStart.x)<80){ui.filter='all';openSheet('library');}gestureStart=null;});
window.addEventListener('resize',fitDevice);
window.addEventListener('storage',event=>{if(event.key==='chora-os-home-v3'){state=load(storage);render();}});
render(false);
onLive(()=>render());
