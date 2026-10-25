import { useEffect } from 'react';
import { t as dict } from '@/contract/i18n';
import { fmtDate, fmtTime } from '@/core/util';
import { useController } from './hooks';
import { Renderer } from './Renderer';
import { ContextPanel, CorrectionDialog, FeedPanel, PerfPanel, RationalePanel, ReplayPanel, ScopePrompt } from './Panels';
import { OsHome } from './OsHome';

/** The OS home screen is the default surface; ?ui=classic keeps the three-page renderer (used by the e2e script). */
const OS_UI = new URLSearchParams(location.search).get('ui') !== 'classic';

export function App() {
  const c = useController();
  const d = dict(c.lang);
  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(location.search);
      const embed = params.get('embed');
      const infer = params.get('infer');
      // ?mode=phone: on a real phone the pages come first and the replay/context/feed controls stack below them.
      if (params.get('mode') === 'phone') document.documentElement.dataset.mode = 'phone';
      // Real embedding by default in the browser; the lexical one stays as the fallback (?embed=hashed).
      if (embed === 'litertlm') await c.useEmbedding('litertlm');
      else if (embed !== 'hashed') await c.useEmbedding('gemma');
      await c.loadFixture();
      await c.precompute();
      c.restorePersisted();
      if (infer === 'litertlm') void c.useInference('litertlm-e2b');
      else if (infer === 'llama') void c.useInference('llama');
    })();
  }, []);
  const view = c.view;
  const plan = c.plan(view);
  const title = view.kind === 'life' ? d.life : view.kind === 'work' ? d.work : view.kind === 'user-model' ? d.userModel : view.kind === 'domain' ? (c.graph.obj(view.organizingObjectId)?.domain ? d.domains[c.graph.obj(view.organizingObjectId)!.domain!] : c.objectName(view.organizingObjectId)) : c.objectName(view.organizingObjectId);
  const canBack = c.tab === 'life' && c.viewStack.length > 1;
  return (
    <div className="shell">
      <aside className="side-left">
        <ReplayPanel />
        <ContextPanel />
        <FeedPanel />
      </aside>
      <main className={OS_UI ? 'phone os' : 'phone'}>
        {OS_UI ? (
          <OsHome />
        ) : (
          <>
        <div className="statusbar">
          <span>{fmtTime(c.now)}</span>
          <span>
            {fmtDate(c.now, c.lang)} · {d.contexts[c.context.id]} · ✈︎
          </span>
        </div>
        <div className="screen">
          <div className="title">
            <div>
              {canBack && (
                <button className="backbtn" onClick={() => c.back()}>
                  ‹ {d.life}
                </button>
              )}
              <h1>{title}</h1>
            </div>
            <div className="avatar" title={c.fixture?.persona.name} />
          </div>
          <Renderer plan={plan} view={view} />
        </div>
        <nav className="tabs">
          <button className={c.tab === 'life' ? 'on' : ''} onClick={() => c.setTab('life')}>
            {d.life}
          </button>
          <button className={c.tab === 'work' ? 'on' : ''} onClick={() => c.setTab('work')}>
            {d.work}
          </button>
          <button className={c.tab === 'model' ? 'on' : ''} onClick={() => c.setTab('model')}>
            {d.userModel}
          </button>
        </nav>
          </>
        )}
        <ScopePrompt />
      </main>
      <aside className="side-right">
        <RationalePanel />
        <PerfPanel />
      </aside>
      <CorrectionDialog />
    </div>
  );
}
