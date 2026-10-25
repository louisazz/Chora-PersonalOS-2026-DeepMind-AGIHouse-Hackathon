/** Synthetic sleep and training fixtures. */
export const initialHealth = () => ({ trainingMode: 'light', trainingOrigin: 'automatic', autoPlanVersion: 1, energy: null, planEnergy: null, sleepDay: 6 });

// Adopt the lighter plan once; a later explicit choice always wins.
export function hydrateHealth(current) {
  const state = { ...initialHealth(), ...current };
  if (current && current.autoPlanVersion !== 1) return { ...state, trainingMode: 'light', trainingOrigin: 'automatic', autoPlanVersion: 1, planEnergy: current.energy ?? null };
  return state;
}

const nights = [
  { day: 'Sun', date: 'Oct 18', minutes: 435 },
  { day: 'Mon', date: 'Oct 19', minutes: 450 },
  { day: 'Tue', date: 'Oct 20', minutes: 430 },
  { day: 'Wed', date: 'Oct 21', minutes: 445 },
  { day: 'Thu', date: 'Oct 22', minutes: 440 },
  { day: 'Fri', date: 'Oct 23', minutes: 440 },
  { day: 'Last night', date: 'Oct 24', minutes: 340 },
];
const energyOptions = [['tired', 'Tired'], ['okay', 'Okay'], ['good', 'Energized']];
const duration = minutes => `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
const plans = {
  regular: [['Warm-up', 10], ['Technique and combinations', 40], ['Cooldown', 10]],
  light: [['Warm-up', 10], ['Light technique', 25], ['Cooldown', 10]],
};
export function proposedTraining(state){
  if(state.energy==='tired')return {reason:'Feeling tired today? Swap combinations for footwork and add five minutes of stretching.',steps:[['Warm-up',10],['Light footwork',20],['Stretch and cool down',15]]};
  if(state.energy==='good')return {reason:'You feel good, but slept less last night. Keep the technique work light today.',steps:plans.light};
  return {reason:'You slept 1 hr 40 min less than usual. Try 25 minutes of light technique, plus a warm-up and cooldown.',steps:plans.light};
}

export function reduceHealth(current, action) {
  const state = hydrateHealth(current);
  if (action.type === 'health-mode' && ['regular', 'light'].includes(action.id)) return { ...state, trainingMode: action.id, trainingOrigin: 'user', planEnergy: action.id==='light'?state.energy:null };
  if (action.type === 'health-energy' && energyOptions.some(([id]) => id === action.id)) return { ...state, energy: action.id };
  if (action.type === 'health-day' && /^\d$/.test(String(action.id)) && Number(action.id) < nights.length) return { ...state, sleepDay: Number(action.id) };
  return state;
}

function readState(ctx) {
  return hydrateHealth(ctx.state);
}

function energyChoice(ctx) {
  const s = readState(ctx);
  return `<div class="h-energy" role="group" aria-label="Energy today">${energyOptions.map(([id, label]) => `<button class="h-energy-choice${s.energy === id ? ' selected' : ''}" data-action="health-energy" data-id="${id}" aria-pressed="${s.energy === id}">${label}</button>`).join('')}</div>`;
}

function sleepSignal(ctx, compact = false) {
  const s = readState(ctx), light = s.trainingMode === 'light';
  return `<section class="h-recovery${compact ? ' compact' : ''}">
    <div class="h-sleep-top"><span>Last night’s sleep</span>${ctx.button('View sleep', 'domain', 'health', 'h-inline-link')}</div>
    <div class="h-sleep-number">5<span>hr</span>40<span>min</span></div>
    <p class="h-baseline">1 hr 40 min below your previous six-night average</p>
    <div class="h-recovery-action"><p>${light ? s.trainingOrigin==='automatic'?'Tonight’s session was automatically shortened from 60 to 45 minutes.':'Tonight’s plan is a lighter 45-minute session.' : proposedTraining(s).reason}</p>${ctx.button(light ? 'Restore regular plan' : 'Use lighter plan', 'health-mode', light ? 'regular' : 'light', light ? 'h-quiet-button' : 'h-action-button')}</div>
  </section>`;
}

function currentPlan(ctx, { full = false } = {}) {
  const s = readState(ctx), light = s.trainingMode === 'light';
  const steps = light ? proposedTraining({...s,energy:s.planEnergy}).steps : plans.regular;
  return `<section class="h-plan">
    <div class="h-plan-heading"><div><h3>Boxing · Tonight, 7 PM</h3><p>${light ? 'Light session · 45 min' : 'Regular session · 60 min'}</p></div>${full ? '' : ctx.button('Adjust', 'health-open', 'plan', 'h-inline-link')}</div>
    <ol class="h-plan-steps${full ? ' expanded' : ''}">${steps.map(([label, minutes]) => `<li><span>${label}</span><strong>${minutes}<span> min</span></strong></li>`).join('')}</ol>
  </section>`;
}

function trainingWeek(ctx) {
  const rows = [['Mon', 'Strength', 40], ['Wed', 'Boxing', 45], ['Fri', 'Run', 43]];
  return `<section class="h-training-week"><div class="h-week-heading"><span>3 sessions this week</span><strong>128 <span>min</span></strong></div>${rows.map(([day, name, minutes]) => `<div class="h-training-row"><span>${day}</span><span>${name}</span><div class="h-training-meter"><i style="width:${Math.round(minutes / 60 * 100)}%"></i></div><strong>${minutes}<span> min</span></strong></div>`).join('')}</section>`;
}

export function renderFitness(ctx) {
  return `<div class="h-fitness">${sleepSignal(ctx)}${ctx.section('Today’s plan')}${currentPlan(ctx)}${ctx.section('Bring with you')}${ctx.gearList()}${ctx.section('This week')}${trainingWeek(ctx)}</div>`;
}

function sleepChart(ctx) {
  const s = readState(ctx), chosen = nights[s.sleepDay] || nights[6];
  return `<section class="h-chart-card">
    <div class="h-chart-heading"><div><h3>Past 7 nights</h3><p>Average: 7 hr 6 min</p></div><div class="h-chart-selection" aria-live="polite"><strong>${duration(chosen.minutes)}</strong><span>${chosen.date}</span></div></div>
    <div class="h-sleep-chart" role="group" aria-label="Choose a night to view sleep duration">${nights.map((night, i) => `<button class="h-night${s.sleepDay === i ? ' selected' : ''}${i === 6 ? ' latest' : ''}" data-action="health-day" data-id="${i}" aria-pressed="${s.sleepDay === i}" aria-label="${night.date}, slept ${duration(night.minutes)}"><span class="h-night-track"><span style="height:${night.minutes / 540 * 100}%"></span></span><span class="h-night-label">${night.day}</span></button>`).join('')}</div>
  </section>`;
}

export function renderHealth(ctx) {
  const s = readState(ctx), light = s.trainingMode === 'light';
  return `<div class="h-health">
    <section class="h-sleep-detail"><div class="h-sleep-top"><span>Last night’s sleep</span><span>01:10 — 06:50</span></div><div class="h-sleep-number">5<span>hr</span>40<span>min</span></div><p class="h-baseline">Previous six-night average: 7 hr 20 min</p></section>
    ${sleepChart(ctx)}
    ${ctx.section('How are you feeling?')}${energyChoice(ctx)}
    ${ctx.section('Tonight')}
    <section class="h-health-action"><div><h3>${light ? 'Boxing · Light session' : 'A lighter plan for tonight'}</h3><p>${light ? s.planEnergy==='tired'?'45 min · Warm-up, light footwork, stretching':'45 min · Warm-up, technique, cooldown' : proposedTraining(s).reason}</p></div><div class="h-action-row">${light ? ctx.button('View training plan', 'domain', 'fitness', 'h-action-button') : ctx.button('Use this plan', 'health-mode', 'light', 'h-action-button')}${light ? ctx.button('Restore regular', 'health-mode', 'regular', 'h-quiet-button') : ctx.button('Adjust plan', 'health-open', 'plan', 'h-quiet-button')}</div>${light&&s.planEnergy!==s.energy?`<p class="h-changed-energy">Your energy level has changed.${ctx.button('Update plan to match','health-mode','light','h-inline-link')}</p>`:''}</section>
  </div>`;
}

export function healthSheet(ctx, id) {
  if (id !== 'plan') return { title: 'Sleep history', body: sleepChart(ctx) };
  const s = readState(ctx), light = s.trainingMode === 'light';
  return { title: 'Tonight’s training plan', body: `<p class="h-plan-context">${light&&s.trainingOrigin==='automatic'&&s.energy===s.planEnergy?'You slept less last night, so tonight’s session was shortened from 60 to 45 minutes.':proposedTraining(s).reason}</p>${energyChoice(ctx)}<div class="h-mode-choices" role="group" aria-label="Today’s training plan"><button class="h-mode-choice${light ? '' : ' selected'}" data-action="health-mode" data-id="regular" aria-pressed="${!light}"><strong>Regular session</strong><span>60 min</span></button><button class="h-mode-choice${light ? ' selected' : ''}" data-action="health-mode" data-id="light" aria-pressed="${light}"><strong>Light session</strong><span>45 min</span></button></div>${currentPlan(ctx, { full: true })}` };
}
