// Synthetic events, prices, locations and photos.
// A configured goal is a saved local mandate, never evidence of a live booking or payment.
const ticketDefaults = () => ({ budget: '180', quantity: '2', resale: false });
const travelDefaults = () => ({ adaptiveDeparture: true, confirmChanges: true });
const originalTrip = () => ({ wake: '06:30', depart: '07:10', meet: '07:30', place: 'Plaza de Armas' });
const revisedTrip = () => ({ wake: '07:00', depart: '07:40', meet: '08:00', place: 'Plaza de Armas' });
const photoChoices = [
  { id: 'ridge', name: 'Light on the trail', reason: 'The sharpest shot in this group', art: 'ridge' },
  { id: 'town', name: 'Evening in the old town', reason: 'The streets and sunset in one frame', art: 'town' },
  { id: 'friends', name: 'Along the way together', reason: 'Everyone is looking at the camera', art: 'friends' },
  { id: 'valley', name: 'The valley beyond', reason: 'Similar to the trail photos', art: 'valley' },
];

export const initialAgent = () => ({
  concert: { status: 'draft', draft: ticketDefaults(), terms: null, error: '', scenario: null, decision: null, completion: null },
  travel: { status: 'draft', draft: travelDefaults(), terms: null, plan: originalTrip(), proposed: null, scenario: null },
  photos: { selected: ['ridge', 'town', 'friends'], saved: null, status: 'review' },
});

function normalized(current) {
  const base = initialAgent(), s = current || {};
  const concert = { ...s.concert };
  return {
    concert: { ...base.concert, ...concert, draft: { ...base.concert.draft, ...s.concert?.draft } },
    travel: { ...base.travel, ...s.travel, draft: { ...base.travel.draft, ...s.travel?.draft }, plan: { ...base.travel.plan, ...s.travel?.plan } },
    photos: { ...base.photos, ...s.photos },
  };
}
function ticketTerms(draft) {
  const budget = Number(draft.budget), quantity = Number(draft.quantity);
  if (!Number.isFinite(budget) || budget < 10 || budget > 2000) return { error: 'Enter a total budget of $10–2,000, including fees.' };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 4) return { error: 'Choose 1–4 tickets.' };
  return { budget, quantity, resale: draft.resale === true };
}
const isActive = status => ['scheduled', 'ready', 'needs-decision'].includes(status);
const canComplete = c => c.status === 'ready' && c.terms && c.decision && Number.isFinite(c.decision.total) && c.decision.total > 0 && c.decision.total <= c.terms.budget && Number.isInteger(c.decision.quantity) && c.decision.quantity >= 1 && c.decision.quantity <= 4 && c.decision.quantity === c.terms.quantity;

export function reduceAgent(current, action) {
  const s = structuredClone(normalized(current)), id = action.id;
  if (id === 'concert' && s.concert.status === 'completed') {
    if (action.type === 'goal-replay') s.concert = initialAgent().concert;
    return s;
  }
  if (action.type === 'goal-field' && id === 'concert' && ['budget', 'quantity'].includes(action.field)) {
    s.concert.draft[action.field] = String(action.value).slice(0, 10); s.concert.error = '';
  }
  if (action.type === 'goal-toggle' && id === 'concert' && action.field === 'resale') s.concert.draft.resale = !s.concert.draft.resale;
  if (action.type === 'goal-toggle' && id === 'travel' && ['adaptiveDeparture', 'confirmChanges'].includes(action.field)) s.travel.draft[action.field] = !s.travel.draft[action.field];
  if (action.type === 'goal-start' && id === 'concert') {
    const terms = ticketTerms(s.concert.draft);
    if (terms.error) { s.concert.error = terms.error; return s; }
    const previous = s.concert, quote = previous.decision?.quantity === terms.quantity ? previous.decision : null;
    const paused = previous.status === 'paused';
    s.concert = { ...previous, terms, status: paused ? 'paused' : quote ? (quote.total > terms.budget ? 'needs-decision' : 'ready') : 'scheduled', error: '', scenario: !paused && quote ? (quote.total > terms.budget ? 'over-budget' : 'match') : null, decision: paused ? null : quote };
  }
  if (action.type === 'goal-start' && id === 'travel') {
    const t = s.travel, terms = { ...t.draft }, automatic = t.scenario === 'traffic' ? terms.adaptiveDeparture : !terms.confirmChanges;
    if (t.status === 'paused') t.terms = terms;
    else if (t.proposed) { t.terms = terms; if (automatic) { t.plan = { ...t.proposed }; t.proposed = null; t.status = 'scheduled'; } }
    else s.travel = { ...t, terms, status: 'scheduled' };
  }
  if (action.type === 'goal-pause' && ['concert', 'travel'].includes(id) && isActive(s[id].status)) {
    s[id].status = 'paused';
    if (id === 'concert') { s[id].decision = null; s[id].scenario = null; }
    if (id === 'travel') { s[id].proposed = null; s[id].scenario = null; }
  }
  if (action.type === 'goal-resume' && ['concert', 'travel'].includes(id) && s[id].status === 'paused' && s[id].terms) s[id].status = 'scheduled';
  if (action.type === 'goal-cancel' && ['concert', 'travel'].includes(id)) {
    s[id].status = 'draft'; s[id].terms = null; s[id].scenario = null;
    if (id === 'concert') s[id].decision = null;
    if (id === 'travel') s[id].proposed = null;
  }
  // Explicit scenario previews demonstrate exception handling without claiming execution.
  if (action.type === 'goal-preview' && id === 'concert' && isActive(s.concert.status)) {
    const c = s.concert, quantity = c.terms.quantity;
    if (action.value === 'over-budget') {
      c.scenario = 'over-budget'; c.status = 'needs-decision';
      c.decision = { total: Math.round((c.terms.budget + 24) * 100) / 100, quantity };
    }
    if (action.value === 'match') {
      c.scenario = 'match'; c.status = 'ready';
      c.decision = { total: Math.max(10, Math.round((c.terms.budget - 12) * 100) / 100), quantity };
    }
    if (action.value === 'sold-out') { c.scenario = 'sold-out'; c.status = 'scheduled'; c.decision = null; }
    if (action.value === 'complete' && canComplete(c)) {
      c.completion = { synthetic: true, event: 'Sunset Rollercoaster', date: '2026-11-21', venue: 'The Fillmore', quantity: c.decision.quantity, total: c.decision.total, arrive: '19:30', start: '20:00' };
      c.status = 'completed'; c.scenario = 'completed';
    }
  }
  if (action.type === 'goal-keep-budget' && s.concert.status === 'needs-decision') {
    s.concert.status = 'scheduled'; s.concert.scenario = 'keep-budget'; s.concert.decision = null;
  }
  if (action.type === 'goal-raise-budget' && s.concert.status === 'needs-decision' && s.concert.decision) {
    const budget = s.concert.decision.total;
    if (budget <= 2000) {
      s.concert.terms.budget = budget; s.concert.draft.budget = String(budget);
      s.concert.status = 'ready'; s.concert.scenario = 'match';
    }
  }
  if (action.type === 'goal-preview' && id === 'travel' && s.travel.status === 'scheduled') {
    if (action.value === 'guide-change') {
      s.travel.scenario = 'guide-change';
      if (s.travel.terms.confirmChanges) { s.travel.proposed = revisedTrip(); s.travel.status = 'needs-decision'; }
      else { s.travel.plan = revisedTrip(); s.travel.proposed = null; }
    }
    if (action.value === 'traffic') {
      s.travel.scenario = 'traffic';
      const proposal = { ...s.travel.plan, depart: s.travel.plan.meet === '08:00' ? '07:30' : '07:00' };
      if (s.travel.terms.adaptiveDeparture) { s.travel.plan = proposal; s.travel.proposed = null; }
      else { s.travel.proposed = proposal; s.travel.status = 'needs-decision'; }
    }
  }
  if (action.type === 'goal-accept-trip' && s.travel.status === 'needs-decision' && s.travel.proposed) {
    s.travel.plan = { ...s.travel.proposed }; s.travel.proposed = null; s.travel.status = 'scheduled';
  }
  if (action.type === 'goal-keep-trip' && s.travel.status === 'needs-decision') { s.travel.proposed = null; s.travel.status = 'scheduled'; s.travel.scenario = 'keep-trip'; }
  if (action.type === 'goal-photo' && photoChoices.some(p => p.id === id)) {
    s.photos.selected = s.photos.selected.includes(id) ? s.photos.selected.filter(p => p !== id) : [...s.photos.selected, id];
    s.photos.status = 'review';
  }
  if (action.type === 'goal-photo-save' && s.photos.selected.length) { s.photos.saved = [...s.photos.selected]; s.photos.status = 'saved'; }
  return s;
}

export function agentStatus(current, id) {
  const s = normalized(current), c = s.concert, t = s.travel;
  if (id === 'concert') return ({
    draft: { label: 'Let Chora get the tickets', sub: 'Nov 21 · The Fillmore · 2.3 km away' },
    scheduled: { label: 'Ticket agent is set', sub: `${c.terms?.quantity || 2} tickets · Up to $${c.terms?.budget || 180} total` },
    paused: { label: 'Ticket agent paused', sub: 'Resume with your saved preferences' },
    'needs-decision': { label: 'Your decision is needed', sub: `$${c.decision?.total || '—'} option exceeds your budget` },
    ready: { label: 'A match for your preferences', sub: `${c.terms?.quantity || 2} tickets · $${c.decision?.total || '—'} with fees` },
    completed: { label: 'Preview: tickets secured', sub: `Nov 21 · ${c.completion?.quantity || '—'} tickets · $${c.completion?.total || '—'} all-in` },
  })[c.status];
  if (id === 'travel') return ({
    draft: { label: 'Tomorrow morning is planned', sub: `Wake ${t.plan.wake} · Leave ${t.plan.depart}` },
    scheduled: { label: 'Trip agent is set', sub: `Meet ${t.plan.meet} · Leave ${t.plan.depart}` },
    paused: { label: 'Trip agent paused', sub: 'Your current plan is kept' },
    'needs-decision': { label: 'Tomorrow morning has changed', sub: t.scenario === 'traffic' ? 'Allow 10 more minutes for travel' : 'Your guide moved the meeting to 08:00' },
  })[t.status];
  return s.photos.status === 'saved' ? { label: `${s.photos.saved.length} photo picks saved`, sub: 'You can change these anytime' } : { label: `${s.photos.selected.length} picks from today`, sub: 'Review your shortlist' };
}

const action = (ctx, label, type, id, cls = 'primary-button', extra = '') => `<button class="${cls}" data-action="${type}"${id ? ` data-id="${ctx.escape(id)}"` : ''}${extra}>${ctx.escape(label)}</button>`;
const preview = (ctx, label, id, value) => action(ctx, label, 'goal-preview', id, 'g-scenario', ` data-value="${value}"`);
const note = '<p class="g-demo-note">Demo: preferences are saved locally. Ticketing, travel, and photo services are not connected.</p>';
function policy(ctx, label, id, field, selected) {
  return action(ctx, label, 'goal-toggle', id, `g-policy ${selected ? 'selected' : ''}`, ` data-field="${field}" aria-pressed="${selected}"`);
}
function management(ctx, goal, id) {
  if (goal.status === 'draft') return '';
  return `<div class="g-manage">${action(ctx, goal.status === 'paused' ? 'Resume agent' : 'Pause agent', goal.status === 'paused' ? 'goal-resume' : 'goal-pause', id, 'text-link')}${action(ctx, 'Cancel task', 'goal-cancel', id, 'text-link')}</div>`;
}
function ticketSheet(ctx, s) {
  const c = s.concert, status = agentStatus(s, 'concert');
  const ev = { band: 'Sunset Rollercoaster', dateLong: 'November 21', time: '20:00', venue: 'The Fillmore', onSale: 'Oct 25 at 10:00', distance: '2.3 km', ...(ctx.event || {}) };
  if (c.status === 'completed') {
    const result = c.completion;
    return { title: 'Preview: tickets secured', body: `<section class="g-ticket-result"><span class="g-sample-label">Sample booking</span><h3>${ctx.escape(result?.event || 'Sunset Rollercoaster')}</h3><p>Nov 21 at 20:00 · ${ctx.escape(result?.venue || 'The Fillmore')}</p><dl><div><dt>Tickets</dt><dd>${result?.quantity || '—'}</dd></div><div><dt>Total with fees</dt><dd>$${result?.total || '—'}</dd></div></dl></section><h3 class="g-followup-heading">Your evening</h3><ol class="g-trip-plan"><li><time>19:30</time><span>Arrive and check in</span></li><li><time>20:00</time><span>Sunset Rollercoaster live<small>The Fillmore</small></span></li></ol><p class="g-result">Your draft itinerary is ready. It has not been added to your calendar.</p><div class="sheet-footer">${action(ctx, 'Replay demo', 'goal-replay', 'concert', 'secondary-button')}</div><p class="g-demo-note">This is a local completion preview. No tickets were purchased and no payment was made. Replaying clears this sample result.</p>` };
  }
  const terms = c.terms;
  const sample = c.scenario && c.status !== 'paused' ? `<div class="g-decision" aria-live="polite"><span class="g-sample-label">Scenario preview</span><h3>${c.status === 'needs-decision' ? `${c.decision.quantity} tickets for $${c.decision.total} total` : c.scenario === 'match' ? `Found ${c.decision.quantity} tickets for $${c.decision.total} total` : c.scenario === 'sold-out' ? 'Sold out for now. Watching for official releases.' : 'Keeping your budget and watching for a match.'}</h3><p>${c.status === 'needs-decision' ? `$${Math.round((c.decision.total - terms.budget) * 100) / 100} over your total budget. Your limit stays unchanged.` : c.scenario === 'match' ? 'Same show, fees included, within your preferences.' : 'Keeping the same date and avoiding marked-up tickets.'}</p>${c.status === 'needs-decision' ? `<div class="g-decision-actions">${action(ctx, 'Keep my budget', 'goal-keep-budget', 'concert', 'secondary-button')}${action(ctx, `Raise limit to $${c.decision.total}`, 'goal-raise-budget', 'concert', 'primary-button', c.decision.total > 2000 ? ' disabled' : '')}</div>` : ''}</div>` : '';
  return { title: `See ${ctx.escape(ev.band)}`, body: `<p class="g-intro">${ctx.escape(ev.band)}, one of your favorites, is playing ${ctx.scene==='travel'?'in San Francisco':'nearby'} on ${ctx.escape(ev.dateLong)}.</p><div class="g-event-detail"><strong>${ctx.escape(ev.time)} · ${ctx.escape(ev.venue)}</strong><span>${ctx.escape(ev.distance)} from ${ctx.scene==='travel'?'your SF home':'you'}${ev.onSale?' · On sale '+ctx.escape(ev.onSale):''}</span></div>${!['draft','needs-decision'].includes(c.status) ? `<div class="g-state"><strong>${ctx.escape(status.label)}</strong><span>${ctx.escape(status.sub)}</span></div>` : ''}${sample}<div class="g-fields"><label>Tickets<select data-goal-id="concert" data-goal-field="quantity" aria-label="Number of tickets">${[1, 2, 3, 4].map(n => `<option value="${n}"${Number(c.draft.quantity) === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label><label>Total budget, including fees<div class="g-budget"><span>$</span><input type="number" min="10" max="2000" step="1" inputmode="decimal" data-goal-id="concert" data-goal-field="budget" aria-label="Total ticket budget" value="${ctx.escape(c.draft.budget)}"></div></label></div><p class="g-policy-copy">This show only, one booking. Chora will ask if the price or conditions change.</p>${policy(ctx, 'Include face-value resale tickets', 'concert', 'resale', c.draft.resale)}${c.error ? `<p class="g-error" role="alert">${ctx.escape(c.error)}</p>` : ''}<div class="sheet-footer">${action(ctx, c.status === 'draft' ? 'Let Chora get the tickets' : 'Update preferences', 'goal-start', 'concert', 'primary-button glow')}</div>${management(ctx, c, 'concert')}${isActive(c.status) ? `<details class="g-preview"><summary>Preview what happens next</summary><div>${preview(ctx, 'Price exceeds budget', 'concert', 'over-budget')}${preview(ctx, 'Matching tickets found', 'concert', 'match')}${preview(ctx, 'Initial release sold out', 'concert', 'sold-out')}${canComplete(c)?preview(ctx, 'Preview completed booking', 'concert', 'complete'):''}</div></details>` : ''}${note}` };
}

export function renderTripPlan(current) {
  const { travel: { plan } } = normalized(current);
  return `<ol class="g-trip-plan"><li><time>${plan.wake}</time><span>Wake up and have breakfast</span></li><li><time>${plan.depart}</time><span>Leave your hotel</span></li><li><time>${plan.meet}</time><span>Meet your guide<small>${plan.place}</small></span></li></ol>`;
}
function travelSheet(ctx, s) {
  const t = s.travel, status = agentStatus(s, 'travel');
  return { title: 'Your morning, taken care of', body: `<p class="g-intro">Wake-up, breakfast, and travel fit together. If the meeting changes, the whole plan can adapt.</p>${renderTripPlan(s)}${!['draft','needs-decision'].includes(t.status) ? `<div class="g-state"><strong>${ctx.escape(status.label)}</strong><span>${ctx.escape(status.sub)}</span></div>` : ''}${t.proposed ? `<div class="g-decision"><span class="g-sample-label">Scenario preview</span><h3>${t.scenario === 'traffic' ? 'Allow 10 more minutes for travel' : 'Your guide moved the meeting to 08:00'}</h3><p>Wake at ${t.proposed.wake} and leave at ${t.proposed.depart}.</p><div class="g-decision-actions">${action(ctx, 'Use new plan', 'goal-accept-trip', 'travel', 'primary-button')}${action(ctx, 'Keep current plan', 'goal-keep-trip', 'travel', 'secondary-button')}</div></div>` : t.scenario && t.scenario !== 'keep-trip' ? `<p class="g-result" aria-live="polite">Scenario preview: ${t.scenario === 'traffic' ? 'Travel takes longer, so departure has moved earlier within your preferences.' : 'The meeting is later. Wake-up and departure have shifted together.'}</p>` : ''}<div class="g-policies">${policy(ctx, 'Move departure earlier when travel takes longer', 'travel', 'adaptiveDeparture', t.draft.adaptiveDeparture)}${policy(ctx, 'Ask me before changing the meeting time', 'travel', 'confirmChanges', t.draft.confirmChanges)}</div><div class="sheet-footer">${action(ctx, t.status === 'draft' ? 'Let Chora follow this trip' : 'Update preferences', 'goal-start', 'travel', 'primary-button glow')}</div>${management(ctx, t, 'travel')}${isActive(t.status) ? `<details class="g-preview"><summary>Preview a change of plan</summary><div>${preview(ctx, 'Guide changes the meeting time', 'travel', 'guide-change')}${preview(ctx, 'Travel takes 10 minutes longer', 'travel', 'traffic')}</div></details>` : ''}${note}` };
}

function photoSheet(ctx, s) {
  const p = s.photos;
  return { title: 'Your best moments today', body: `<p class="g-intro">Similar shots are grouped, with the clearest moments shortlisted. Choose the ones you want to keep.</p><div class="g-photo-grid">${photoChoices.map(photo => `<button class="g-photo ${p.selected.includes(photo.id) ? 'selected' : ''}" data-action="goal-photo" data-id="${photo.id}" aria-pressed="${p.selected.includes(photo.id)}" aria-label="${ctx.escape(photo.name)}, ${p.selected.includes(photo.id) ? 'Selected' : 'Not selected'}"><span class="g-photo-art g-photo-${photo.art}" aria-hidden="true"><span>${p.selected.includes(photo.id) ? ctx.icon('check', 15) : ctx.icon('plus', 15)}</span></span><strong>${photo.name}</strong><small>${photo.reason}</small></button>`).join('')}</div><div class="g-photo-summary" aria-live="polite">${p.status === 'saved' ? `${p.saved.length} photos saved as today’s picks` : `${p.selected.length} photos selected`}</div><div class="sheet-footer">${action(ctx, p.status === 'saved' ? 'Update picks' : 'Keep these', 'goal-photo-save', 'photos', 'primary-button glow', p.selected.length ? '' : ' disabled')}</div><p class="g-demo-note">Sample photos. Your picks are saved locally; original photos are not deleted.</p>` };
}

export function renderAgentHub(ctx) {
  const s = normalized(ctx.state), titles = { concert: 'See Sunset Rollercoaster', travel: 'Meet your guide tomorrow', photos: 'Today’s travel photos' };
  return `<div class="g-hub">${['concert', 'travel', 'photos'].map(id => { const status = agentStatus(s, id); return `<button class="g-goal" data-action="goal-open" data-id="${id}"><strong>${titles[id]}</strong><span>${ctx.escape(status.label)}</span><small>${ctx.escape(id==='concert'&&ctx.scene==='travel'?status.sub.replace('from you','from your SF home'):status.sub)}</small></button>`; }).join('')}</div>`;
}
export function agentSheet(ctx, id) {
  const s = normalized(ctx.state);
  if (id === 'concert') return ticketSheet(ctx, s);
  if (id === 'travel') return travelSheet(ctx, s);
  if (id === 'photos') return photoSheet(ctx, s);
  return { title: 'Your active agents', body: renderAgentHub(ctx) };
}
