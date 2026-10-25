/**
 * Oracle inference adapter: answers from the fixture's ground-truth annotations.
 * Used ONLY for (a) eval upper bound and (b) proving the pipeline independent of model quality.
 * It is deliberately not the default adapter: a perfect confirmer never misattributes, so the correction
 */
import type {
  ConfirmRequest,
  ConfirmResponse,
  EventAnnotation,
  ExtractRequest,
  ExtractResponse,
  Fixture,
  InferenceAdapter,
  InferenceStats,
  MatterShape,
} from '@/contract/types';

export interface OracleNewObjectSpec {
  id: string;
  displayName: string;
  shape?: MatterShape;
  when?: string;
  place?: string;
  type: 'matter' | 'preference' | 'commitment';
}

export class OracleInference implements InferenceAdapter {
  readonly name = 'oracle';
  readonly kind = 'oracle' as const;
  private byEvent: Map<string, EventAnnotation>;
  private byText = new Map<string, EventAnnotation>();
  private calls = 0;
  constructor(
    fixture: Fixture,
    private newObjects: OracleNewObjectSpec[] = [],
  ) {
    this.byEvent = new Map(fixture.annotations.map((a) => [a.eventId, a]));
  }
  async ready(): Promise<void> {}
  stats(): InferenceStats {
    return { calls: this.calls, totalMs: 0, lastMs: 0, backend: 'fixture' };
  }
  async extract(req: ExtractRequest): Promise<ExtractResponse> {
    this.calls += 1;
    const a = this.byEvent.get(req.event.id);
    if (!a) return { propositions: [], verdict: 'drop' };
    for (const p of a.propositions) this.byText.set(p.text, a);
    const res: ExtractResponse = { propositions: a.propositions, verdict: a.propositions.length ? 'keep' : 'drop' };
    if (a.dateRef) res.dateRef = a.dateRef;
    if (a.worldState) res.worldState = a.worldState;
    return res;
  }
  async confirm(req: ConfirmRequest): Promise<ConfirmResponse> {
    this.calls += 1;
    const a = this.byText.get(req.proposition.text);
    const relation = req.proposition.source === 'message' ? 'refers-to' : 'evidence-for';
    // Hard constraints are honoured exactly like a model would.
    const hard = req.constraints.find((c) => c.scope !== 'instance');
    if (hard) return { objectId: hard.toObj, relation, conf: 0.95 };
    if (!a || !a.objectId) return { objectId: 'none', relation, conf: 0.9 };
    if (req.candidates.some((c) => c.objectId === a.objectId)) return { objectId: a.objectId, relation, conf: 0.95 };
    const spec = this.newObjects.find((n) => n.id === a.objectId);
    if (spec) {
      return {
        objectId: 'new',
        relation,
        conf: 0.9,
        newObject: { type: spec.type, displayName: spec.displayName, shape: spec.shape, when: spec.when, place: spec.place },
      };
    }
    return { objectId: 'none', relation, conf: 0.5 };
  }
}
