/** Lightweight inline vectors for the OS home screen.
 * Brand marks are schematic UI representations, not official downloadable assets.
 */

const lineArt = {
  lens: '<path d="M8 3H6a3 3 0 0 0-3 3v2m13-5h2a3 3 0 0 1 3 3v2M3 16v2a3 3 0 0 0 3 3h2m13-5v2a3 3 0 0 1-3 3h-2"/><circle cx="12" cy="12" r="4"/><circle cx="19" cy="19" r="1.5" fill="currentColor" stroke="none"/>',
  leaf: '<path d="M20 3C9 2 3 7 4 14c1 5 7 7 11 4 4-3 4-8 5-15Z"/><path d="M4 21 16 8M9 16l-1-5m5 1 4 1"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  sparkle: '<path d="M12 3c1.5 5.5 3.5 7.5 9 9-5.5 1.5-7.5 3.5-9 9-1.5-5.5-3.5-7.5-9-9 5.5-1.5 7.5-3.5 9-9Z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>',
  wifi: '<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/>',
  signal: '<path d="M4 19v2m5-7v7m5-12v12m5-18v18"/>',
  battery: '<rect x="2" y="6" width="18" height="12" rx="3"/><path d="M22 10v4"/><rect x="5" y="9" width="12" height="6" rx="1" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  play: '<path d="m8 4 13 8-13 8Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18M7 14h2m6 0h2M7 17h2"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16"/>',
  mail: '<rect x="2" y="5" width="20" height="15" rx="3"/><path d="m3 7 9 6 9-6"/>',
  music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  fitness: '<path d="m6 4 14 14M4 6l2-2m12 16 2-2M3 9l6-6m6 18 6-6M9 15l6-6"/>',
  photo: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 5 5 3-3 4 4"/>',
  plane: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="m11 13 5-5"/>',
  briefcase: '<rect x="3" y="6" width="18" height="15" rx="3"/><path d="M8 6V3h8v3M3 12a25 25 0 0 0 18 0M10 13h4"/>',
  heart: '<path d="M20.5 4.5a5 5 0 0 0-7 0L12 6l-1.5-1.5a5 5 0 0 0-7 7L12 20l8.5-8.5a5 5 0 0 0 0-7Z"/>',
  settings: '<path d="m10 3-.5 2-2 .9-1.8-1-2 3.4L5.2 10v2L3.7 14l2 3.4 1.8-1 2 .9.5 2h4l.5-2 2-.9 1.8 1 2-3.4-1.5-2v-2l1.5-1.7-2-3.4-1.8 1-2-.9-.5-2Z"/><circle cx="12" cy="11.5" r="3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  link: '<path d="m9 15 6-6M7 14l-2 2a3 3 0 0 0 4 4l4-4a3 3 0 0 0 0-4M17 10l2-2a3 3 0 0 0-4-4l-4 4a3 3 0 0 0 0 4"/>',
  external: '<path d="M14 3h7v7m0-7-11 11M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  route: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h7a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h7"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  undo: '<path d="M3 4v6h6M3 10a9 9 0 1 1 0 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  agent: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/><path d="M6 5c5-4 12 8 10 14"/>',
  phone: '<path d="m8 3 3 5-3 3c2 3 3 4 6 5l3-3 4 3c-1 5-4 6-8 3C7 16 3 11 3 7c0-3 2-4 5-4Z"/>',
  camera: '<path d="M7 6 9 3h6l2 3h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>',
  store: '<path d="M3 9 5 3h14l2 6M4 11v10h16V11M9 21v-7h6v7"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
  headphones: '<path d="M3 13v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="12" width="4" height="9" rx="2"/><rect x="17" y="12" width="4" height="9" rx="2"/>',
  run: '<circle cx="15" cy="4" r="2"/><path d="m12 8 4 4 5 1M5 10l4-3 4 2-4 7 5 2 1 4M9 16l-4 5H2"/>',
  send: '<path d="m3 3 19 9-19 9 4-9Z"/><path d="M7 12h15"/>',
  sliders: '<path d="M4 6h4m4 0h8M4 12h10m4 0h2M4 18h2m4 0h10"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v16c3-2 7-1 10 1 3-2 7-3 10-1V4c-3-1-6-2-10 1Zm0 0v16"/>',
  game: '<path d="M7 7h10c3 0 6 11 3 13-2 1-4-3-5-3H9c-1 0-3 4-5 3C1 18 4 7 7 7Z"/><path d="M7 10v5m-2.5-2.5h5M16 11h.01M18 14h.01"/>',
  wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v12H5a3 3 0 0 1-3-3V6"/><path d="M21 12h-5v5h5M17 14.5h.01"/>',
};

const dimension = (size) => Number.isFinite(Number(size)) ? Math.min(512, Math.max(1, Number(size))) : 24;

export function icon(name, size = 24) {
  const s = dimension(size);
  return `<svg class="ui-icon" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${lineArt[name] || lineArt.sparkle}</svg>`;
}

const marks = {
  tiktok: '<rect x="1" y="1" width="46" height="46" rx="12" fill="#101114"/><path d="M27 10v21a7 7 0 1 1-6-6v6a2 2 0 1 0 1 2V10h5c0 4 3 7 7 7v5c-3 0-5-1-7-3" fill="#25F4EE" transform="translate(-1 1)"/><path d="M27 10v21a7 7 0 1 1-6-6v6a2 2 0 1 0 1 2V10h5c0 4 3 7 7 7v5c-3 0-5-1-7-3" fill="#FE2C55" transform="translate(1 -1)"/><path d="M27 10v21a7 7 0 1 1-6-6v6a2 2 0 1 0 1 2V10h5c0 4 3 7 7 7v5c-3 0-5-1-7-3" fill="white"/>',
  music: '<circle cx="24" cy="24" r="23" fill="#FF0033"/><circle cx="24" cy="24" r="15" fill="none" stroke="white" stroke-width="2"/><path d="m20 15 13 9-13 9Z" fill="white"/>',
  youtube: '<rect x="2" y="8" width="44" height="32" rx="10" fill="#FF0033"/><path d="m20 16 13 8-13 8Z" fill="white"/>',
  calendar: '<path d="M7 3h34a4 4 0 0 1 4 4v27L34 45H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4" fill="#4285F4"/><path d="M3 13V7a4 4 0 0 1 4-4h6v10Z" fill="#1A73E8"/><path d="M35 3h6a4 4 0 0 1 4 4v6H35Z" fill="#188038"/><path d="M13 35H3v6a4 4 0 0 0 4 4h6Z" fill="#EA4335"/><path d="M35 13h10v21L34 45H13V35h22Z" fill="#FBBC04"/><path d="M34 34h11L34 45Z" fill="#EA4335"/><path d="M13 13h22v22H13Z" fill="white"/><text x="24" y="29" fill="#1A73E8" font-family="Arial,sans-serif" font-size="17" font-weight="600" text-anchor="middle">31</text>',
  maps: '<path d="M24 2A16 16 0 0 0 8 18c0 11 12 20 14 26a2 2 0 0 0 4 0c2-6 14-15 14-26A16 16 0 0 0 24 2Z" fill="#34A853"/><path d="M24 2a16 16 0 0 0-16 16c0 3 1 6 3 9L33 5a16 16 0 0 0-9-3Z" fill="#4285F4"/><path d="M11 27c2 3 5 6 7 9L40 16a16 16 0 0 0-7-11Z" fill="#FBBC04"/><path d="M8 18c0-5 2-9 6-12l9 10-11 12a20 20 0 0 1-4-10Z" fill="#EA4335"/><circle cx="24" cy="18" r="6" fill="#F8F9FA"/>',
  gmail: '<path d="M4 10h40v29H4Z" fill="#F5F5F5"/><path d="M4 39V11l8 6v22Z" fill="#4285F4"/><path d="M36 39V17l8-6v28Z" fill="#34A853"/><path d="M4 11V8a3 3 0 0 1 5-2l15 11L39 6a3 3 0 0 1 5 2v3L24 26Z" fill="#EA4335"/><path d="m4 11 8 6v9L4 20Z" fill="#C5221F"/><path d="m36 17 8-6v9l-8 6Z" fill="#FBBC04"/>',
  photos: '<path d="M24 24V4a10 10 0 0 1 0 20Z" fill="#EA4335"/><path d="M24 24h20a10 10 0 0 1-20 0Z" fill="#4285F4"/><path d="M24 24v20a10 10 0 0 1 0-20Z" fill="#34A853"/><path d="M24 24H4a10 10 0 0 1 20 0Z" fill="#FBBC04"/>',
  chrome: '<circle cx="24" cy="24" r="23" fill="#EA4335"/><path d="M24 24H47a23 23 0 0 1-34.5 19.9Z" fill="#FBBC04"/><path d="M24 24 12.5 43.9A23 23 0 0 1 4.1 12.5Z" fill="#34A853"/><circle cx="24" cy="24" r="10.5" fill="#4285F4" stroke="white" stroke-width="2"/>',
  agent: '<circle cx="24" cy="24" r="23" fill="#E6F7F3"/><ellipse cx="24" cy="24" rx="19" ry="8" transform="rotate(-35 24 24)" fill="none" stroke="#137F8A" stroke-width="2.7"/><ellipse cx="24" cy="24" rx="8" ry="19" transform="rotate(-35 24 24)" fill="none" stroke="#4285F4" stroke-width="2.7"/><circle cx="24" cy="24" r="4.5" fill="#137F8A"/>',
  playstore: '<path d="M6 4v40l23-20Z" fill="#34A853"/><path d="m6 4 29 16-6 4Z" fill="#4285F4"/><path d="m29 24 6-4 9 4-9 5Z" fill="#FBBC04"/><path d="m6 44 29-15-6-5Z" fill="#EA4335"/>',
  health: '<rect x="1" y="1" width="46" height="46" rx="14" fill="#D8F6EE"/><path d="M36 14a8 8 0 0 0-11 0l-1 1-1-1a8 8 0 0 0-11 11l12 12 12-12a8 8 0 0 0 0-11Z" fill="#008577"/><path d="M11 24h7l3-6 5 12 3-6h8" fill="none" stroke="white" stroke-width="2.5" stroke-linejoin="round"/>',
  fit: '<path d="M24 13 17 6a9 9 0 0 0-13 13l20 23 20-23A9 9 0 0 0 31 6Z" fill="#EA4335"/><path d="m24 13-7-7A9 9 0 0 0 4 19l8 9 12-15Z" fill="#FBBC04"/><path d="M24 13v29L12 28Z" fill="#34A853"/><path d="m24 13 7-7a9 9 0 0 1 13 13L24 42Z" fill="#4285F4"/><path d="m13 20 11 12 11-12" fill="none" stroke="white" stroke-width="3"/>',
  keep: '<path d="M9 2h23l9 9v33H9Z" fill="#FBBC04"/><path d="M32 2v9h9Z" fill="#FFE082"/><path d="M31 21a7 7 0 1 0-12 5c2 2 2 3 2 5h6c0-2 0-3 2-5a7 7 0 0 0 2-5Z" fill="white"/><path d="M21 34h6" stroke="white" stroke-width="3"/>',
  uber: '<rect x="1" y="1" width="46" height="46" rx="13" fill="#050505"/><text x="24" y="29" fill="white" font-family="Arial,sans-serif" font-size="14" font-weight="500" text-anchor="middle">Uber</text>',
  web: '<rect x="1" y="1" width="46" height="46" rx="14" fill="#EDF0F8"/><g fill="none" stroke="#64709B" stroke-width="2"><circle cx="24" cy="24" r="16"/><ellipse cx="24" cy="24" rx="7" ry="16"/><path d="M8 24h32M11 15h26M11 33h26"/></g>',
  phone: '<rect x="1" y="1" width="46" height="46" rx="14" fill="#D3E3FD"/><path d="m16 10 5 8-4 4c3 5 5 7 10 9l4-4 7 4c-2 8-6 9-13 5C15 31 9 23 9 17c0-5 3-7 7-7Z" fill="#185ABC"/>',
  camera: '<rect x="1" y="1" width="46" height="46" rx="14" fill="#E4E7ED"/><path d="m16 14 3-5h10l3 5h7v25H9V14Z" fill="#31353D"/><circle cx="24" cy="26" r="9" fill="#181B20"/><circle cx="24" cy="26" r="5" fill="#7293A5"/><circle cx="22" cy="24" r="2" fill="#BCD5E2"/>',
};

export const providerMeta = Object.freeze({
  tiktok: { id: 'tiktok', name: 'TikTok', kind: 'app', color: '#101114' },
  youtube: { id: 'youtube', name: 'YouTube', kind: 'app', color: '#FF0033' },
  music: { id: 'music', name: 'YouTube Music', kind: 'app', color: '#FF0033' },
  calendar: { id: 'calendar', name: 'Google Calendar', kind: 'app', color: '#4285F4' },
  maps: { id: 'maps', name: 'Google Maps', kind: 'app', color: '#34A853' },
  gmail: { id: 'gmail', name: 'Gmail', kind: 'app', color: '#EA4335' },
  photos: { id: 'photos', name: 'Google Photos', kind: 'app', color: '#FBBC04' },
  chrome: { id: 'chrome', name: 'Chrome', kind: 'app', color: '#4285F4' },
  gemini: { id: 'gemini', name: 'Gemini', kind: 'ai', color: '#748BF7' },
  agent: { id: 'agent', name: 'Chora Agent', kind: 'agent', color: '#137F8A' },
  playstore: { id: 'playstore', name: 'Google Play', kind: 'app', color: '#34A853' },
  health: { id: 'health', name: 'Health Connect', kind: 'app', color: '#008577' },
  fit: { id: 'fit', name: 'Google Fit', kind: 'app', color: '#34A853' },
  keep: { id: 'keep', name: 'Google Keep', kind: 'app', color: '#FBBC04' },
  uber: { id: 'uber', name: 'Uber', kind: 'app', color: '#111111' },
  web: { id: 'web', name: 'Web', kind: 'web', color: '#64709B' },
  phone: { id: 'phone', name: 'Phone', kind: 'app', color: '#185ABC' },
  camera: { id: 'camera', name: 'Camera', kind: 'app', color: '#31353D' },
});

let uniqueId = 0;
export function appIcon(id, size = 32) {
  const s = dimension(size);
  let content = marks[id] || marks.web;
  if (id === 'gemini') {
    const gradientId = `chora-gemini-${++uniqueId}`;
    content = `<defs><linearGradient id="${gradientId}" x1="0" x2="1" y1="1" y2="0"><stop offset="0" stop-color="#4890F6"/><stop offset=".48" stop-color="#8877D8"/><stop offset="1" stop-color="#D684B5"/></linearGradient></defs><path d="M24 1C28 16 32 20 47 24 32 28 28 32 24 47 20 32 16 28 1 24 16 20 20 16 24 1Z" fill="url(#${gradientId})"/>`;
  }
  return `<svg class="app-icon app-icon-${Object.hasOwn(providerMeta, id) ? id : 'web'}" width="${s}" height="${s}" viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="none">${content}</svg>`;
}
