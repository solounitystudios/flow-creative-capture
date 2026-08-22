/**
 * Normalized contributor role/subrole vocabulary. Roles are controlled;
 * subroles are controlled per-role. Free text is supported only as a
 * separate, non-canonical `description` field — never as a substitute
 * for a canonical role.
 */

export const CONTRIBUTION_ROLES = [
  'artist',
  'producer',
  'beatmaker',
  'songwriter',
  'composer',
  'arranger',
  'musician',
  'vocalist',
  'recording_engineer',
  'mix_engineer',
  'mastering_engineer',
  'editor',
  'sound_designer',
  'creative_director',
  'visual_artist',
  'other',
] as const;
export type ContributionRole = (typeof CONTRIBUTION_ROLES)[number];

export const SUBROLES_BY_ROLE: Readonly<Record<ContributionRole, readonly string[]>> = {
  artist: ['other'],
  producer: ['producer', 'co_producer', 'additional_producer', 'vocal_producer', 'drum_programming', 'arrangement'],
  beatmaker: ['other'],
  songwriter: ['lyrics', 'melody', 'topline', 'hook', 'verse', 'rewrite'],
  composer: ['other'],
  arranger: ['other'],
  musician: ['lead_guitar', 'rhythm_guitar', 'bass_guitar', 'piano', 'keyboard', 'drums', 'other'],
  vocalist: ['lead_vocal', 'backing_vocal', 'ad_libs', 'other'],
  recording_engineer: ['other'],
  mix_engineer: ['other'],
  mastering_engineer: ['other'],
  editor: ['other'],
  sound_designer: ['other'],
  creative_director: ['other'],
  visual_artist: ['other'],
  other: ['other'],
};

export function isValidSubrole(role: ContributionRole, subrole: string): boolean {
  return SUBROLES_BY_ROLE[role].includes(subrole);
}
