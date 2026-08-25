import type { ColdNightsFixture } from '../data/fixtureTypes.js';
import type { DeliveryPackage } from '../../../../src/documents/deliveryPackage.js';
import { humanize } from '../lib/viewModels.js';

export function DeliveryView({ fixture }: { readonly fixture: ColdNightsFixture }) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Delivery</h1>
          <p className="page-header__subtitle">Real selective-disclosure examples for {fixture.project.title}</p>
        </div>
      </div>

      <div className="notice">
        A Delivery Package describes/packages selected project documentation. Raw creative files are not
        automatically transferred — sections are included only when explicitly requested, following the same
        privacy-by-default rule shown below for each example.
      </div>

      <div className="doc-grid" style={{ marginTop: 'var(--space-5)' }}>
        <PackageCard title="Collaborator review" pkg={fixture.deliveryPackages.collaboratorReview} />
        <PackageCard title="Label licensing" pkg={fixture.deliveryPackages.labelLicensing} />
      </div>
    </div>
  );
}

function PackageCard({ title, pkg }: { readonly title: string; readonly pkg: DeliveryPackage }) {
  return (
    <div className="card">
      <p className="card__title">{title}</p>
      <p className="helper-text" style={{ marginTop: 0 }}>
        Audience: {humanize(pkg.audience)} · Purpose: {humanize(pkg.purpose)}
      </p>
      <p className="session-field__label" style={{ marginTop: 'var(--space-3)' }}>
        Included sections
      </p>
      <div className="section-toggle-list">
        {pkg.includedSections.map((key) => (
          <span key={key} className="section-pill section-pill--included">
            {key}
          </span>
        ))}
      </div>
      <p className="session-field__label" style={{ marginTop: 'var(--space-3)' }}>
        Omitted sections
      </p>
      <div className="section-toggle-list">
        {pkg.omittedSections.map((key) => (
          <span key={key} className="section-pill section-pill--omitted">
            {key}
          </span>
        ))}
      </div>
    </div>
  );
}
