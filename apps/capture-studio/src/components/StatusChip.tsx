import type { TrustTone } from '../lib/viewModels.js';

/**
 * The one place a "trust color" gets painted. Every caller passes an
 * explicit, precise label -- this component never invents wording, and
 * never uses a bare green checkmark that could be misread as broader
 * verification than the label actually states.
 */
export function StatusChip({ label, tone }: { readonly label: string; readonly tone: TrustTone }) {
  return (
    <span className={`chip chip--${tone}`}>
      <span className="chip__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
