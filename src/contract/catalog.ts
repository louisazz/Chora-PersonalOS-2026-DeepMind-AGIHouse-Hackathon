/**
 * Component catalog (≈10 components), the view grammar, and the compatibility table.
 * A component is a type declaration: reusing it tells the user "these are the same kind of thing".
 * The compatibility table therefore constrains form by object type, not only by data type × intent.
 */
import type { ComponentId, Intent, ObjectType, ViewKind } from './types';

export interface ComponentSpec {
  id: ComponentId;
  /** What the repeated unit is. */
  unit: string;
  /** Object types this component may be the subject of. */
  allowedSubjects: ObjectType[];
  /** Intents the component serves; empty = any. */
  intents: Intent[];
  /** Default area weight. */
  area: 1 | 2 | 3;
}

export const CATALOG: Record<ComponentId, ComponentSpec> = {
  'suggestion-card': {
    id: 'suggestion-card',
    unit: 'a matter with an attached suggestion',
    allowedSubjects: ['matter', 'commitment'],
    intents: ['glance', 'plan-next'],
    area: 2,
  },
  'object-row': {
    id: 'object-row',
    unit: 'any object, compact',
    allowedSubjects: ['person', 'activity', 'goal', 'preference', 'experience', 'item', 'commitment', 'matter'],
    intents: [],
    area: 1,
  },
  'matter-header': {
    id: 'matter-header',
    unit: 'a matter: name, world state, when, where',
    allowedSubjects: ['matter'],
    intents: [],
    area: 3,
  },
  timeline: {
    id: 'timeline',
    unit: 'dated entries of one object',
    allowedSubjects: ['matter', 'activity', 'goal', 'experience'],
    intents: ['review-trend', 'recall', 'plan-next'],
    area: 2,
  },
  checklist: {
    id: 'checklist',
    unit: 'things to bring / do for a matter',
    allowedSubjects: ['matter', 'commitment', 'goal'],
    intents: ['plan-next', 'glance'],
    area: 1,
  },
  'map-card': {
    id: 'map-card',
    unit: 'a place of a matter',
    allowedSubjects: ['matter', 'experience'],
    intents: ['plan-next', 'glance'],
    area: 2,
  },
  'photo-wall': {
    id: 'photo-wall',
    unit: 'photos of an experience',
    allowedSubjects: ['experience'],
    intents: ['recall'],
    area: 3,
  },
  curve: {
    id: 'curve',
    unit: 'a measured series of an activity or goal',
    allowedSubjects: ['activity', 'goal'],
    intents: ['review-trend'],
    area: 2,
  },
  'action-button': {
    id: 'action-button',
    unit: 'one action on a matter',
    allowedSubjects: ['matter', 'commitment'],
    intents: ['plan-next', 'glance'],
    area: 1,
  },
  'silence-note': {
    id: 'silence-note',
    unit: 'why nothing is suggested',
    allowedSubjects: ['activity'],
    intents: [],
    area: 1,
  },
  'empty-state': {
    id: 'empty-state',
    unit: 'a typed empty',
    allowedSubjects: ['person', 'activity', 'goal', 'preference', 'experience', 'item', 'commitment', 'matter'],
    intents: [],
    area: 1,
  },
  'requirement-card': {
    id: 'requirement-card',
    unit: 'a work requirement (deliverable matter) with related conversations',
    allowedSubjects: ['matter'],
    intents: ['plan-next', 'glance'],
    area: 2,
  },
  'todo-row': {
    id: 'todo-row',
    unit: 'a commitment',
    allowedSubjects: ['commitment'],
    intents: ['plan-next', 'glance'],
    area: 1,
  },
  'conversation-ref': {
    id: 'conversation-ref',
    unit: 'a message that refers to an object',
    allowedSubjects: ['matter', 'person'],
    intents: ['recall', 'plan-next'],
    area: 1,
  },
  'ask-card': {
    id: 'ask-card',
    unit: 'a proposition the system will not guess about: the user answers',
    allowedSubjects: ['person', 'activity', 'goal', 'preference', 'experience', 'item', 'commitment', 'matter'],
    intents: [],
    area: 2,
  },
  'proposition-row': {
    id: 'proposition-row',
    unit: 'one proposition of the user model',
    allowedSubjects: ['person', 'activity', 'goal', 'preference', 'experience', 'item', 'commitment', 'matter'],
    intents: [],
    area: 1,
  },
};

/** View grammar: fixed regions per view kind. Policy only fills slots inside these regions. */
export const VIEW_GRAMMAR: Record<ViewKind, string[]> = {
  life: ['now', 'domains'],
  domain: ['now', 'upcoming', 'ongoing', 'memories', 'people'],
  matter: ['header', 'facts', 'people', 'actions', 'messages'],
  person: ['header', 'shared-matters', 'messages'],
  work: ['now', 'requirements', 'todos'],
  'user-model': ['propositions'],
};

/** Returns the component to render, or the fallback with a recorded conflict. */
export function compatible(component: ComponentId, subject: ObjectType): boolean {
  return CATALOG[component].allowedSubjects.includes(subject);
}

export const FALLBACK_COMPONENT: ComponentId = 'object-row';

/** Form mapping: (object type × intent) → preferred components, in order. Deterministic, no model. */
export function preferredComponents(subject: ObjectType, intent: Intent): ComponentId[] {
  const order: ComponentId[] = [];
  const push = (c: ComponentId) => {
    if (compatible(c, subject) && !order.includes(c)) order.push(c);
  };
  if (subject === 'matter') {
    if (intent === 'glance') push('suggestion-card');
    if (intent === 'plan-next') {
      push('checklist');
      push('map-card');
      push('action-button');
    }
    if (intent === 'recall') push('timeline');
    push('object-row');
  } else if (subject === 'experience') {
    if (intent === 'recall') push('photo-wall');
    push('timeline');
    push('object-row');
  } else if (subject === 'activity' || subject === 'goal') {
    if (intent === 'review-trend') push('curve');
    push('timeline');
    push('object-row');
  } else if (subject === 'commitment') {
    push('todo-row');
    push('object-row');
  } else {
    push('object-row');
  }
  return order;
}
