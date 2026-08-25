import { NAV_SECTIONS, type NavKey } from '../lib/navigation.js';

const NAV_ICON: Record<NavKey, string> = {
  capture: '◆',
  timeline: '≡',
  assets: '▦',
  contributors: '◐',
  provenance: '⛓',
  documents: '▤',
  delivery: '↗',
};

export function LeftNav({
  active,
  onSelect,
  collapsed,
  onToggleCollapsed,
  assetCount,
}: {
  readonly active: NavKey;
  readonly onSelect: (key: NavKey) => void;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly assetCount: number;
}) {
  return (
    <nav className="nav" aria-label="Primary">
      <ul className="nav__list">
        {NAV_SECTIONS.map((section) => (
          <li key={section.key}>
            <button
              type="button"
              className="nav__item"
              aria-current={active === section.key ? 'page' : undefined}
              onClick={() => onSelect(section.key)}
            >
              <span className="nav__icon" aria-hidden="true">
                {NAV_ICON[section.key]}
              </span>
              <span className="nav__label">{section.label}</span>
              {section.key === 'assets' && (
                <span className="nav__badge" aria-hidden="true">
                  {assetCount}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn--icon nav__collapse"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
      >
        {collapsed ? '»' : '«'}
      </button>
    </nav>
  );
}
