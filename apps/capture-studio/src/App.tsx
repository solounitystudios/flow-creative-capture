import { useMemo, useState } from 'react';
import { coldNightsFixture } from './data/fixtureTypes.js';
import { buildActivityFeed } from './lib/viewModels.js';
import type { NavKey } from './lib/navigation.js';
import { TopBar } from './components/TopBar.js';
import { LeftNav } from './components/LeftNav.js';
import { CaptureView } from './components/CaptureView.js';
import { TimelineView } from './components/TimelineView.js';
import { AssetGrid } from './components/AssetGrid.js';
import { AssetInspector } from './components/AssetInspector.js';
import { ContributorsView } from './components/ContributorsView.js';
import { ProvenanceView } from './components/ProvenanceView.js';
import { DocumentsView } from './components/DocumentsView.js';
import { DeliveryView } from './components/DeliveryView.js';

export function App() {
  const [activeNav, setActiveNav] = useState<NavKey>('capture');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>(
    coldNightsFixture.bundle.assets[0]?.id,
  );

  const feed = useMemo(() => buildActivityFeed(coldNightsFixture), []);
  const inspectorOpen = activeNav === 'assets' && selectedAssetId !== undefined;

  return (
    <div className="shell" data-nav-collapsed={navCollapsed} data-testid="studio-shell">
      <div className="shell__topbar">
        <TopBar fixture={coldNightsFixture} />
      </div>
      <div className="shell__nav">
        <LeftNav
          active={activeNav}
          onSelect={setActiveNav}
          collapsed={navCollapsed}
          onToggleCollapsed={() => setNavCollapsed((v) => !v)}
          assetCount={coldNightsFixture.bundle.assets.length}
        />
      </div>
      <div className="shell__main" data-inspector-open={inspectorOpen}>
        <main className="shell__canvas">
          {activeNav === 'capture' && <CaptureView fixture={coldNightsFixture} feed={feed} />}
          {activeNav === 'timeline' && <TimelineView feed={feed} projectTitle={coldNightsFixture.project.title} />}
          {activeNav === 'assets' && (
            <div>
              <div className="page-header">
                <div>
                  <h1 className="page-header__title">Assets</h1>
                  <p className="page-header__subtitle">
                    {coldNightsFixture.bundle.assets.length} persisted assets for {coldNightsFixture.project.title}
                  </p>
                </div>
              </div>
              <AssetGrid
                assets={coldNightsFixture.bundle.assets}
                selectedId={selectedAssetId}
                onSelect={setSelectedAssetId}
              />
            </div>
          )}
          {activeNav === 'contributors' && <ContributorsView fixture={coldNightsFixture} />}
          {activeNav === 'provenance' && <ProvenanceView fixture={coldNightsFixture} />}
          {activeNav === 'documents' && <DocumentsView fixture={coldNightsFixture} />}
          {activeNav === 'delivery' && <DeliveryView fixture={coldNightsFixture} />}
        </main>
        {inspectorOpen && selectedAssetId !== undefined && (
          <aside className="shell__inspector" aria-label="Asset inspector">
            <AssetInspector fixture={coldNightsFixture} assetId={selectedAssetId} />
          </aside>
        )}
      </div>
    </div>
  );
}
