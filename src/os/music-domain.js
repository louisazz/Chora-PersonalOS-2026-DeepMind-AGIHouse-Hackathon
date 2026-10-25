// Playlists, a sing-along cue, shared memories and discovery. People and listening history are synthetic.
const friends=[{id:'mia',name:'Mia',likes:['missyou','lucky','slow']},{id:'alex',name:'Alex',likes:['missyou','sunny','slow']},{id:'rui',name:'Rui',likes:['love','sunny']}];
const songs=[
 {id:'missyou',title:'Miss You 3000',artist:'831'},
 {id:'lucky',title:'A Little Happiness',artist:'Hebe Tien'},
 {id:'slow',title:'Growing Fond of You',artist:'Karen Mok'},
 {id:'sunny',title:'Sunny Day',artist:'Jay Chou'},
 {id:'love',title:'Love Story',artist:'Taylor Swift'}
];

// Example playlists and listening cues; no microphone or listening history is accessed.
export const playlists=[
 {id:'psyche',title:'Psychedelic electronic',art:'m-cover-psyche',tracks:[['Let It Happen','Tame Impala','m-rose'],['Breathe','Télépopmusik','m-olive'],['Kerala','Bonobo','m-blue']]},
 {id:'walk',title:'Evening walk',art:'m-cover-walk',tracks:[['Time (You and I)','Khruangbin','m-olive'],['No One Noticed','The Marías','m-blue'],['Show Me How','Men I Trust','m-rose']]},
 {id:'sunset',title:'Sunset Rollercoaster mix',art:'m-cover-sunset',tracks:[['My Jinji','Sunset Rollercoaster','m-rose'],['Summum Bonum','Sunset Rollercoaster','m-olive'],['Candlelight','Sunset Rollercoaster','m-blue']]}
];
function playlistGrid(ctx){return `<div class="m-playlists">${playlists.map(p=>`<button class="m-playlist" data-action="music-open" data-id="playlist:${p.id}" aria-label="Open playlist: ${ctx.escape(p.title)}"><span class="m-cover ${p.art}" aria-hidden="true"></span><strong>${ctx.escape(p.title)}</strong></button>`).join('')}</div>`;}
const brand=(ctx,id,size=22)=>ctx.appIcon?.(id,size)||'';
function serviceLink(ctx,id,label,context,url){return `<a class="secondary-button m-service-link" href="${ctx.escape(url)}" target="_blank" rel="noopener noreferrer" data-action="handoff" data-id="${id}" data-context="${context}">${brand(ctx,id)}<span>${ctx.escape(label)}</span></a>`;}
function singingSuggestion(ctx){return `<section class="m-listening-cue" aria-label="A song to sing along to"><p>You always sing along to “No One Noticed.”</p><h3>Want to record your take?</h3>${serviceLink(ctx,'tiktok','Open TikTok','music-sing','https://www.tiktok.com/')}</section>`;}

export const initialMusic=()=>({friends:['mia','alex'],songs:['missyou','lucky'],invitationDraft:null,memoryDraft:null});
const toggle=(items,id)=>items.includes(id)?items.filter(x=>x!==id):[...items,id];
const normalized=state=>({...initialMusic(),...state});
export function suggestedSongs(state){const s=normalized(state),people=friends.filter(f=>s.friends.includes(f.id));if(!people.length)return [];return songs.map((song,index)=>({...song,score:people.filter(f=>f.likes.includes(song.id)).length,index})).filter(song=>song.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,3);}
function recommendationReason(state,song){const s=normalized(state),people=friends.filter(f=>s.friends.includes(f.id)&&f.likes.includes(song.id));return people.length?`${people.map(f=>f.name).join(' and ')} ${people.length>1?'want':'wants'} to sing it`:'';}
export function invitationText(state){const s=normalized(state);return formatInvitation(s);}
function formatInvitation(s){const names=friends.filter(f=>s.friends.includes(f.id)).map(f=>f.name).join(' and ');const titles=songs.filter(t=>s.songs.includes(t.id)).map(t=>`“${t.title}”`).join(', ');return `${names}, want to go sing together? I picked ${titles} to start. What else would you like to sing, and when are you free?`;}
export const memoryText='That night seeing Sunset Rollercoaster with Alex.\nAugust 9, San Francisco. These songs still take me back.';
export function reduceMusic(current,action){
 const s=structuredClone(normalized(current));
 if(action.type==='music-friend'&&friends.some(x=>x.id===action.id)){s.friends=toggle(s.friends,action.id);s.invitationDraft=null;}
 if(action.type==='music-song'&&songs.some(x=>x.id===action.id)){s.songs=toggle(s.songs,action.id);s.invitationDraft=null;}
 if(action.type==='music-recommend'){const proposed=suggestedSongs(s).map(song=>song.id);if(proposed.length&&[...proposed].sort().join('|')!==[...s.songs].sort().join('|')){s.songs=proposed;s.invitationDraft=null;}}
 if(action.type==='music-prepare'&&s.friends.length&&s.songs.length&&s.invitationDraft===null)s.invitationDraft=invitationText(s);
 if(action.type==='music-draft'&&['invitationDraft','memoryDraft'].includes(action.id))s[action.id]=String(action.value).slice(0,2000);
 if(action.type==='music-memory-prepare'&&s.memoryDraft===null)s.memoryDraft=memoryText;
 return s;
}
const searchURL=(title,artist,provider='music')=>provider==='web'?`https://www.google.com/search?q=${encodeURIComponent(title+' '+artist)}`:`https://music.youtube.com/search?q=${encodeURIComponent(title+' '+artist)}`;
function trackLink(ctx,title,artist,art){return `<a class="m-track" href="${searchURL(title,artist,ctx.musicProvider)}" target="_blank" rel="noopener noreferrer" data-action="handoff" data-id="${ctx.musicProvider}" data-context="music-track" aria-label="Find ${ctx.escape(title)} by ${ctx.escape(artist)} on ${ctx.musicProvider==='web'?'the web':'YouTube Music'}"><span class="m-art ${art}" aria-hidden="true"></span><span class="m-track-copy"><strong>${ctx.escape(title)}</strong><span>${ctx.escape(artist)}</span></span><span class="m-play" aria-hidden="true">${brand(ctx,ctx.musicProvider||'music',25)}</span></a>`;}
export function renderMusic(ctx){
 return `<div class="m-domain">${ctx.section('Playlists')}${playlistGrid(ctx)}
 ${singingSuggestion(ctx)}
 ${ctx.section('Shared memories')}<button class="m-memory" data-action="music-open" data-id="memory"><span class="m-memory-source" aria-hidden="true">${brand(ctx,'photos',22)}</span><span>Aug 9 · With Alex</span><strong>Sunset Rollercoaster live</strong></button>
 ${musicDiscovery(ctx)}</div>`;
}
function musicDiscovery(ctx){return `<section class="m-discovery"><p>You have been listening to psychedelic electronic music.</p><h3>Want to explore the sound?</h3><div class="m-video-links">${musicVideos.map(v=>`<a href="${v.url}" target="_blank" rel="noopener noreferrer" data-action="handoff" data-id="youtube" data-context="music-learn-${v.id}" aria-label="Watch on YouTube: ${ctx.escape(v.title)}"><span><strong>${ctx.escape(v.label)}</strong><span>${ctx.escape(v.creator)}</span></span><span class="m-video-play" aria-hidden="true">${brand(ctx,'youtube',27)}</span></a>`).join('')}</div></section>`;}
const musicVideos=[
 {id:'history',label:'The early sounds of electronic music',title:'1969: What Is ELECTRONIC MUSIC? | Workshop | Radiophonic Workshop | BBC Archive',creator:'BBC Archive',url:'https://www.youtube.com/watch?v=yMvP-cxjPpo'},
 {id:'sound',label:'The synth behind “Nangs”',title:'Kurzweil K2700 Tutorial: Tame Impala - Nangs Synth',creator:'Kurzweil Music Systems',url:'https://www.youtube.com/watch?v=uBNVlZCanoA'}
];

function choice(ctx,action,id,selected,label,secondary=''){return `<button class="m-song-choice${selected?' selected':''}" data-action="${action}" data-id="${id}" aria-pressed="${selected}"><span><strong>${ctx.escape(label)}</strong>${secondary?`<span>${ctx.escape(secondary)}</span>`:''}</span><span class="m-check" aria-hidden="true">${ctx.icon(selected?'check':'plus',16)}</span></button>`;}
const socialLink=(ctx)=>serviceLink(ctx,'instagram','Open Instagram','music-social','https://www.instagram.com/direct/inbox/');
export function musicSheet(ctx,id){
 const s=normalized(ctx.state);
 if(id.startsWith('playlist:')){const list=playlists.find(p=>p.id===id.slice(9));if(list)return {title:list.title,body:`<div class="m-listening">${list.tracks.map(t=>trackLink(ctx,...t)).join('')}</div>`};}
 if(id==='record')return {title:'Record this moment',body:singingSuggestion(ctx)};
 if(id==='discover')return {title:'Explore the sound',body:musicDiscovery(ctx)};
 if(id==='karaoke'){const recommended=suggestedSongs(s),recommendedIds=recommended.map(t=>t.id);return {title:'A playlist to sing together',body:`<div class="m-sheet-label">Who is coming?</div><div class="m-friends" role="group" aria-label="Friends to invite">${friends.map(f=>`<button data-action="music-friend" data-id="${f.id}" class="m-friend${s.friends.includes(f.id)?' selected':''}" aria-pressed="${s.friends.includes(f.id)}">${f.name}</button>`).join('')}</div>${recommended.length?`<div class="m-recommendation"><strong>Start with these ${recommended.length} songs</strong><p>${recommended.map(t=>ctx.escape(t.title)).join(' · ')}</p>${ctx.button('Use this playlist','music-recommend','','text-link')}<details><summary>Why these songs?</summary>${recommended.map(t=>`<p>${ctx.escape(t.title)} · ${ctx.escape(recommendationReason(s,t))}</p>`).join('')}<p>Based on your saved sing-along favorites</p></details></div>`:''}<div class="m-sheet-label">Songs to sing <span>${s.songs.length} selected</span></div><div class="m-song-list">${[...recommended,...songs.filter(t=>!recommendedIds.includes(t.id))].map(t=>choice(ctx,'music-song',t.id,s.songs.includes(t.id),t.title,t.artist)).join('')}</div><div class="sheet-footer"><button class="primary-button" data-action="music-invite" ${!s.songs.length||!s.friends.length?'disabled':''}>Draft an invite</button></div>`};}
 if(id==='invite')return {title:'Invite friends to sing',body:`<label class="m-sheet-label" for="music-invitation">Invitation draft</label><textarea id="music-invitation" class="m-draft" data-music-draft="invitationDraft" aria-label="Invitation draft" maxlength="2000">${ctx.escape(s.invitationDraft??invitationText(s))}</textarea><div class="sheet-footer">${ctx.button('Copy invite','music-copy','invite','primary-button')}${socialLink(ctx)}${ctx.button('Keep choosing songs','music-open','karaoke','text-link')}</div>`};
 if(id==='memory-share')return {title:'Share that night',body:`<div class="m-share-card"><div class="m-share-photo"></div><strong>That show with Alex</strong><span>Aug 9 · San Francisco</span></div><label class="m-sheet-label" for="music-memory-draft">Caption</label><textarea id="music-memory-draft" class="m-draft short" data-music-draft="memoryDraft" aria-label="Caption" maxlength="2000">${ctx.escape(s.memoryDraft??memoryText)}</textarea><div class="sheet-footer">${ctx.button('Copy caption','music-copy','memory','primary-button')}${socialLink(ctx)}</div>`};
 return {title:'That night with Alex',body:`<div class="m-memory-photo"></div><p class="m-memory-date">Aug 9 · Sunset Rollercoaster live · San Francisco</p>${trackLink(ctx,'My Jinji','Sunset Rollercoaster','m-rose')}<div class="sheet-footer">${ctx.button('Draft a caption','music-share','','primary-button')}${serviceLink(ctx,'photos','Open Google Photos','music-memory','https://photos.google.com/')}</div>`};
}
