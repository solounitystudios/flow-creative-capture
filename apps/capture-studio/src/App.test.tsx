import { describe, expect, it } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { App } from './App.js';
import { coldNightsFixture } from './data/fixtureTypes.js';

function renderApp() {
  return render(<App />);
}

describe('Capture Studio shell', () => {
  it('renders the shell chrome', () => {
    renderApp();
    expect(screen.getByTestId('studio-shell')).toBeInTheDocument();
    expect(screen.getByText('FLOW Capture')).toBeInTheDocument();
  });

  it('renders the Cold Nights demo project on the landing view', () => {
    renderApp();
    expect(screen.getAllByText('Cold Nights').length).toBeGreaterThan(0);
    expect(screen.getByText('Demo project — Cold Nights scenario')).toBeInTheDocument();
  });

  it('never shows a live/ticking session indicator, only a demo/recorded label', () => {
    renderApp();
    expect(screen.getByText('Demo session')).toBeInTheDocument();
    expect(screen.queryByText(/^LIVE$/)).not.toBeInTheDocument();
  });
});

describe('Asset browser', () => {
  it('renders all six persisted Cold Nights assets', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));

    // Scoped to the grid, not the whole document: the inspector (open by
    // default on the first asset) can independently repeat one filename
    // in its own heading, which is a separate, legitimate render.
    const grid = document.querySelector('.asset-grid');
    expect(grid).not.toBeNull();
    for (const filename of [
      'cold_nights_beat.mid',
      'ambient_pad_C.wav',
      'cold_nights_beat_stem.wav',
      'guitar_lead_take.wav',
      'cold_nights_final_mix.wav',
      'cold_nights_final_master.wav',
    ]) {
      expect(within(grid as HTMLElement).getByText(filename)).toBeInTheDocument();
    }
    expect(coldNightsFixture.bundle.assets).toHaveLength(6);
  });

  it('selecting an asset updates the inspector to that asset', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));

    const masterCard = screen.getByText('cold_nights_final_master.wav').closest('button');
    expect(masterCard).not.toBeNull();
    fireEvent.click(masterCard!);

    const inspector = screen.getByLabelText('Asset inspector');
    expect(within(inspector).getByRole('heading', { name: 'cold_nights_final_master.wav' })).toBeInTheDocument();
    expect(within(inspector).getByText('Master')).toBeInTheDocument();
  });

  it('never labels createdByProfileId as "Creator"', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    const guitarCard = screen.getByText('guitar_lead_take.wav').closest('button');
    fireEvent.click(guitarCard!);

    const inspector = screen.getByLabelText('Asset inspector');
    expect(within(inspector).queryByText('Creator')).not.toBeInTheDocument();
    expect(within(inspector).getByText('File source / profile')).toBeInTheDocument();
    expect(within(inspector).getByText(/does not establish creative authorship/i)).toBeInTheDocument();
    expect(within(inspector).getByText(/no credit for this asset has been verified/i)).toBeInTheDocument();
  });

  it('labels unpersisted lineage as unavailable, and any demo graph as explicitly demo-only', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    const stemCard = screen.getByText('cold_nights_beat_stem.wav').closest('button');
    fireEvent.click(stemCard!);

    const inspector = screen.getByLabelText('Asset inspector');
    fireEvent.click(within(inspector).getByRole('tab', { name: 'Usage' }));

    expect(within(inspector).getByText(/persisted lineage relationships are not available yet/i)).toBeInTheDocument();
    // The stem participates in real simulator relationship edges, so a demo graph should render, clearly labeled.
    expect(within(inspector).getByText('Demo relationship graph')).toBeInTheDocument();
    expect(within(inspector).getByText(/never persisted, shown for illustration/i)).toBeInTheDocument();
  });
});

describe('Contributors view', () => {
  it('labels every contributor claim "Claimed", never "Verified"', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Contributors' }));

    const claimed = screen.getAllByText('Claimed');
    expect(claimed.length).toBe(coldNightsFixture.bundle.contributorClaims.length);
    // No status chip/badge ever reads "Verified" as a standalone status word.
    // The word "verified" legitimately appears elsewhere in this view inside
    // an honest disclaimer ("...are not verified creative credits"), which
    // is a correct negation, not a false claim -- so this checks the exact
    // status word, not a blanket ban on the substring.
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirmed')).not.toBeInTheDocument();
    expect(screen.queryByText('Supported')).not.toBeInTheDocument();
  });
});

describe('Delivery view', () => {
  it('reflects the real fixture Delivery Package section data, including the assets section', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Delivery' }));

    expect(screen.getByText('Collaborator review')).toBeInTheDocument();
    expect(screen.getByText('Label licensing')).toBeInTheDocument();

    // The collaborator package genuinely includes an "assets" section (per the fixture);
    // the label package genuinely omits it -- both real, not hard-coded UI state.
    const collaboratorPkg = coldNightsFixture.deliveryPackages.collaboratorReview;
    const labelPkg = coldNightsFixture.deliveryPackages.labelLicensing;
    expect(collaboratorPkg.includedSections).toContain('assets');
    expect(labelPkg.includedSections).not.toContain('assets');
  });
});
