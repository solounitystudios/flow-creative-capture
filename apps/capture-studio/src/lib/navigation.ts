export const NAV_SECTIONS = [
  { key: 'capture', label: 'Capture' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'assets', label: 'Assets' },
  { key: 'contributors', label: 'Contributors' },
  { key: 'provenance', label: 'Provenance' },
  { key: 'documents', label: 'Documents' },
  { key: 'delivery', label: 'Delivery' },
] as const;

export type NavKey = (typeof NAV_SECTIONS)[number]['key'];
