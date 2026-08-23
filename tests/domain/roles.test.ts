import { describe, expect, it } from 'vitest';
import { asContributionClaimId, asProfileId, asProjectId } from '../../src/domain/ids.js';
import { createContributorReference } from '../../src/domain/contributorReference.js';
import { isValidSubrole } from '../../src/domain/roles.js';

const CLAIMED_AT = '2026-01-01T00:00:00.000Z';

function baseInput() {
  return {
    id: asContributionClaimId('claim-1'),
    projectId: asProjectId('project-1'),
    profileId: asProfileId('p1'),
    claimedAt: CLAIMED_AT,
  };
}

describe('contributor roles', () => {
  it('accepts a valid role/subrole pair', () => {
    expect(isValidSubrole('musician', 'lead_guitar')).toBe(true);
    const ref = createContributorReference({ ...baseInput(), role: 'musician', subrole: 'lead_guitar' });
    expect(ref.role).toBe('musician');
    expect(ref.subrole).toBe('lead_guitar');
  });

  it('rejects a subrole that does not belong to the given role', () => {
    expect(isValidSubrole('musician', 'lyrics')).toBe(false);
    expect(() =>
      createContributorReference({ ...baseInput(), role: 'musician', subrole: 'lyrics' }),
    ).toThrow();
  });

  it('allows a free-text description alongside a canonical role, never in place of one', () => {
    const ref = createContributorReference({
      ...baseInput(),
      role: 'sound_designer',
      description: 'Designed the intro riser and the vinyl-crackle bed',
    });
    expect(ref.role).toBe('sound_designer');
    expect(ref.description).toContain('riser');
  });
});
