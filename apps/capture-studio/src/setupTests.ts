import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// This project does not enable Vitest's `test.globals` (matching the core
// engine's own explicit-import test convention), so React Testing
// Library's auto-cleanup -- which detects a global `afterEach` -- never
// registers on its own. Without this, DOM nodes from one test's render()
// leak into the next test in the same file.
afterEach(() => {
  cleanup();
});
