import { initialLearning, reduceLearning, learningNotification } from './learning-domain.js';
import { initialAgent, reduceAgent, agentStatus } from './agent-domain.js';
import { initialWork, reduceWork } from './work-domain.js';
import { initialHealth, reduceHealth, hydrateHealth } from './health-domain.js';
import { initialMusic, reduceMusic } from './music-domain.js';
import { live } from './live';
export const KEY='chora-os-home-v3';
export const domains=[
 {id:'learning',name:'Learning',icon:'book',color:'blue',status:'RSI papers, selected for you',detail:'Follow your curiosity'},
 {id:'fitness',name:'Fitness',icon:'fitness',color:'orange',status:'19:00 · Boxing',detail:'Training and recovery'},
 {id:'travel',name:'Travel',icon:'plane',color:'cyan',status:'South America',detail:'Life on the road'},
 {id:'health',name:'Health',icon:'heart',color:'pink',status:'Last night’s sleep',detail:'Your health over time'},
 {id:'work',name:'Work',icon:'briefcase',color:'purple',status:'1 new request',detail:'What you’re working on'},
 {id:'games',name:'Games',icon:'game',color:'indigo',status:'',detail:'Make time to play'},
 {id:'finance',name:'Finance',icon:'wallet',color:'green',status:'',detail:'Money in everyday life'},
 {id:'music',name:'Music',icon:'music',color:'red',status:'Your favorite band, nearby',detail:'The songs and the moments'},
 {id:'family',name:'Family',icon:'home',color:'yellow',status:'',detail:'Time with your people'},
];
export const freshState=()=>({version:2,layoutVersion:1,theme:'light',layout:'grid',scene:'daily',receipts:[],gear:[],agents:[],dismissed:[],reminderTime:'09:50',alarmTime:'06:30',musicProvider:'music',work:initialWork(),health:initialHealth(),musicLife:initialMusic(),seenActivities:[],learning:initialLearning(),agentLife:initialAgent(),personalGoals:{}});
export function load(storage){try{
 const s=JSON.parse(storage.getItem(KEY));
 if(!(s?.version===2&&['light','dark'].includes(s.theme)&&['list','grid'].includes(s.layout)&&['daily','travel'].includes(s.scene)&&['receipts','gear','agents','dismissed'].every(k=>Array.isArray(s[k]))))return freshState();
 return {...freshState(),...s,receipts:s.receipts,layout:s.layoutVersion===1?s.layout:'grid',layoutVersion:1,work:{...initialWork(),...s.work},health:hydrateHealth(s.health),musicLife:{...initialMusic(),...s.musicLife},learning:{...initialLearning(),...s.learning},agentLife:reduceAgent(s.agentLife,{type:'hydrate'})};
}catch{return freshState()}}
export function save(state,storage){try{storage.setItem(KEY,JSON.stringify(state));return true}catch{return false}}
export function transition(state,action){
 const s=structuredClone(state);
 if(action.type==='seen-activity'&&typeof action.id==='string')s.seenActivities=[...new Set([...(s.seenActivities||[]),action.id])];
 if(action.type.startsWith('learning-'))s.learning=reduceLearning(s.learning,action);
 if(action.type.startsWith('goal-'))s.agentLife=reduceAgent(s.agentLife,action);
 if(action.type==='personal-goal'&&['games','finance','family'].includes(action.id))s.personalGoals={...(s.personalGoals||{}),[action.id]:String(action.value||'').trim().slice(0,1000)};
 if(action.type.startsWith('work-'))s.work=reduceWork(s.work,action);
 if(action.type.startsWith('health-'))s.health=reduceHealth(s.health,action);
 if(action.type.startsWith('music-'))s.musicLife=reduceMusic(s.musicLife,action);
 if(action.type==='theme'&&['light','dark'].includes(action.value))s.theme=action.value;
 if(action.type==='layout'&&['list','grid'].includes(action.value))s.layout=action.value;
 if(action.type==='scene'&&['daily','travel'].includes(action.value))s.scene=action.value;
 if(action.type==='gear'){s.gear=s.gear.includes(action.id)?s.gear.filter(x=>x!==action.id):[...s.gear,action.id]}
 if(action.type==='agent'){s.agents=s.agents.includes(action.id)?s.agents.filter(x=>x!==action.id):[...s.agents,action.id]}
 if(action.type==='time'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(action.value)&&['reminderTime','alarmTime'].includes(action.id))s[action.id]=action.value;
 if(action.type==='music-provider'&&['music','web'].includes(action.value))s.musicProvider=action.value;
 if(action.type==='dismiss'&&!s.dismissed.includes(action.id))s.dismissed.push(action.id);
 if(action.type==='restore')s.dismissed=s.dismissed.filter(x=>x!==action.id);
 if(action.type==='receipt'){
  if(!['demo-saved','handed-off','cancelled'].includes(action.status))return state;
  const r={id:action.id,status:action.status,title:action.title,provider:action.provider,at:new Date().toISOString(),detail:action.detail||'',savedTime:action.savedTime||null};
  const idx=s.receipts.findIndex(x=>x.id===r.id);if(idx<0)s.receipts.unshift(r);else s.receipts[idx]=r;
 }
 if(action.type==='remove-receipt')s.receipts=s.receipts.filter(x=>x.id!==action.id);
 if(action.type==='reset')return freshState();
 return s;
}
export function homeActivity(state,id){
 if(live.snapshot&&['music','fitness','work'].includes(id)){const a=live.snapshot.activity?.[id];return a?{...a,unseen:!(state.seenActivities||[]).includes(a.id)}:null;}
 const events={learning:learningNotification(state.learning).hasUpdate?{id:'research-'+(state.learning?.goal||'rsi'),sources:['arxiv']}:null,fitness:{id:'sleep-oct24',sources:['calendar']},health:{id:'sleep-oct24',sources:['health']},music:{id:'concert-nov21',sources:['music']},work:null,travel:state.scene==='travel'?(state.agentLife?.travel?.status==='needs-decision'?{id:'trip-'+state.agentLife.travel.scenario,sources:[state.agentLife.travel.scenario==='traffic'?'maps':'gmail']}:{id:'photos-oct24',sources:['photos']}):null};
 const event=events[id];return event?{...event,unseen:!(state.seenActivities||[]).includes(event.id)}:null;
}
export function suggestions(state){
 const ticket=agentStatus(state.agentLife,'concert'),trip=agentStatus(state.agentLife,'travel'),photos=agentStatus(state.agentLife,'photos'),paper=learningNotification(state.learning);
 const ticketSet=state.agentLife?.concert?.status&&state.agentLife.concert.status!=='draft';
 const cards=state.scene==='daily'?[
  {id:'concert',row:0,domain:'Music',title:ticketSet?`Sunset Rollercoaster · ${ticket.label}`:'Sunset Rollercoaster, nearby',sub:ticketSet?ticket.sub:'Nov 21 · The Fillmore · 2.3 km',cta:ticketSet?(state.agentLife.concert.status==='completed'?'View tickets':'View task'):'Auto-book tickets',emphasis:true,kind:'concert',intent:'goal'},
  {id:'boxing',row:1,domain:'Fitness',title:'Boxing tonight. Gloves + wraps.',sub:state.health?.trainingMode==='regular'?'Regular training, as you chose.':state.health?.trainingOrigin==='user'?'Short on sleep. Your lighter plan is set.':'Short on sleep. Training lightened.',cta:'View training plan',kind:'boxing'},
  {id:'papers',row:0,domain:'Learning',title:paper.title,sub:paper.sub,cta:paper.paperId==='compare'?'Compare papers':'Read & discuss',kind:paper.paperId,intent:'learning'},
  {id:'commute',row:1,domain:'Work',title:'Leave at 6:26 for your BART train',sub:'Pick up your package on the way.',cta:'View your route',kind:'commute'}
 ]:[
  {id:'photos',row:0,domain:'South America',title:photos.label,sub:photos.sub,cta:'View highlights',kind:'photos',intent:'goal'},
  {id:'morning',row:1,domain:'South America',title:trip.label,sub:trip.sub,cta:'Follow your trip',kind:'travel',intent:'goal'},
  {id:'travel-music',row:0,domain:'Music',title:'Back at the hotel. Pick up your music.',sub:'Sunset Rollercoaster',cta:'Open music',kind:'music',intent:'music'},
  {id:'meeting-map',row:1,domain:'South America',title:'Tomorrow’s meeting point',sub:'Plaza de Armas',cta:'Open Maps',kind:'cusco',intent:'link'}
 ];
 let all=cards;
 if(live.snapshot&&state.scene==='daily'){
  const names={music:'Music',fitness:'Fitness',work:'Work',learning:'Learning',health:'Health',travel:'Travel'};
  const sleepSub=state.health?.trainingMode==='regular'?'Regular training, as you chose.':state.health?.trainingOrigin==='user'?'Short on sleep. Your lighter plan is set.':'Short on sleep. Training lightened.';
  const liveCards=live.snapshot.cards.map(card=>({id:'live:'+card.id,row:card.kind==='ask'||card.domain==='music'?0:1,domain:names[card.domain]||'Life',title:card.title,sub:card.sub||(card.flavor==='boxing'?sleepSub:''),cta:card.cta,emphasis:card.kind==='ask'||card.flavor==='concert'||card.urgency>=0.9,kind:card.id,live:card}));
  const has=(f)=>liveCards.some(x=>x.live.kind!=='ask'&&x.live.flavor===f);
  all=[...liveCards,...cards.filter(c=>c.id==='papers'||(c.id==='boxing'&&!has('boxing'))||(c.id==='commute'&&!has('commute')))];
 }
 return all.filter(x=>!state.dismissed.includes(x.id)).map(x=>({...x,done:false}));
}
export function saveSuggestedAction(state,id,storage){
 if(!['concert','morning'].includes(id))return {state,stored:false};
 const alarm=id==='morning';
 const savedTime=alarm?state.alarmTime:state.reminderTime;
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(savedTime))return {state,stored:false};
 const next=transition(state,{type:'receipt',id,status:'demo-saved',savedTime,provider:alarm?'clock':'calendar',title:alarm?'Meet your guide · Wake-up alarm':'Sunset Rollercoaster · Ticket reminder',detail:`Oct 25 · ${savedTime}`});
 const stored=save(next,storage);
 return {state:stored?next:state,stored};
}
export const links={
 instagram:'https://www.instagram.com/direct/inbox/',tiktok:'https://www.tiktok.com/',
 music:'https://music.youtube.com/search?q=Sunset%20Rollercoaster',youtube:'https://www.youtube.com/results?search_query=Sunset+Rollercoaster',
 calendar:'https://calendar.google.com/',maps:'https://www.google.com/maps/search/?api=1&query=San%20Francisco',
 gym:'https://www.google.com/maps/search/?api=1&query=boxing%20gym%20San%20Francisco',cusco:'https://www.google.com/maps/search/?api=1&query=Plaza%20de%20Armas%20Cusco',
 gmail:'https://mail.google.com/',photos:'https://photos.google.com/',chrome:'https://www.google.com/',gemini:'https://gemini.google.com/',
 playstore:'https://play.google.com/store/apps',keep:'https://keep.google.com/',health:'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata',
 fit:'https://play.google.com/store/apps/details?id=com.google.android.apps.fitness',uber:'https://m.uber.com/',web:'https://www.google.com/search?q=Sunset+Rollercoaster+official',
 paper:'https://arxiv.org/search/?query=recursive+self+improvement&searchtype=all',bart:'https://www.google.com/maps/dir/?api=1&destination=Montgomery%20Street%20Station%20San%20Francisco&travelmode=walking'
};
