import { describe, expect, it } from 'vitest';
import { asAssetId, asAssetRelationshipId } from '../../src/domain/ids.js';
import { createAssetRelationship } from '../../src/domain/assetRelationship.js';
import {
  detectLineageCycle,
  getAncestorAssetIds,
  getDescendantAssetIds,
  isAncestorOf,
} from '../../src/provenance/lineage.js';

describe('asset lineage', () => {
  const take = asAssetId('take');
  const comp = asAssetId('comp');
  const stem = asAssetId('stem');
  const mix = asAssetId('mix');
  const master = asAssetId('master');

  const relationships = [
    createAssetRelationship({
      id: asAssetRelationshipId('r1'),
      fromAssetId: take,
      toAssetId: comp,
      relationshipType: 'edited_from',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    createAssetRelationship({
      id: asAssetRelationshipId('r2'),
      fromAssetId: comp,
      toAssetId: stem,
      relationshipType: 'exported_from',
      createdAt: '2026-01-01T00:01:00.000Z',
    }),
    createAssetRelationship({
      id: asAssetRelationshipId('r3'),
      fromAssetId: stem,
      toAssetId: mix,
      relationshipType: 'mixed_into',
      createdAt: '2026-01-01T00:02:00.000Z',
    }),
    createAssetRelationship({
      id: asAssetRelationshipId('r4'),
      fromAssetId: mix,
      toAssetId: master,
      relationshipType: 'mastered_from',
      createdAt: '2026-01-01T00:03:00.000Z',
    }),
  ];

  it('traces the full ancestor chain for the final master back to the original take', () => {
    const ancestors = getAncestorAssetIds(master, relationships);
    expect(ancestors).toEqual(expect.arrayContaining([mix, stem, comp, take]));
    expect(ancestors).toHaveLength(4);
  });

  it('traces descendants forward from the original take to the final master', () => {
    const descendants = getDescendantAssetIds(take, relationships);
    expect(descendants).toEqual(expect.arrayContaining([comp, stem, mix, master]));
  });

  it('confirms an ancestor/descendant relationship end to end', () => {
    expect(isAncestorOf(take, master, relationships)).toBe(true);
    expect(isAncestorOf(master, take, relationships)).toBe(false);
  });

  it('returns no ancestors for an asset with no incoming relationships', () => {
    expect(getAncestorAssetIds(take, relationships)).toEqual([]);
  });

  it('rejects a relationship that relates an asset to itself', () => {
    expect(() =>
      createAssetRelationship({
        id: asAssetRelationshipId('r5'),
        fromAssetId: take,
        toAssetId: take,
        relationshipType: 'derived_from',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('finds no cycle in a valid, acyclic lineage graph', () => {
    expect(detectLineageCycle(relationships)).toBeNull();
  });
});

describe('asset lineage — cycle safety', () => {
  // A malformed A -> B -> C -> A chain: three individually valid two-asset
  // relationships that together form a cycle no single edge could reject.
  const a = asAssetId('a');
  const b = asAssetId('b');
  const c = asAssetId('c');

  const cyclicRelationships = [
    createAssetRelationship({
      id: asAssetRelationshipId('cycle-a-to-b'),
      fromAssetId: a,
      toAssetId: b,
      relationshipType: 'derived_from',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    createAssetRelationship({
      id: asAssetRelationshipId('cycle-b-to-c'),
      fromAssetId: b,
      toAssetId: c,
      relationshipType: 'derived_from',
      createdAt: '2026-01-01T00:01:00.000Z',
    }),
    createAssetRelationship({
      id: asAssetRelationshipId('cycle-c-to-a'),
      fromAssetId: c,
      toAssetId: a,
      relationshipType: 'derived_from',
      createdAt: '2026-01-01T00:02:00.000Z',
    }),
  ];

  it('terminates instead of looping forever when tracing ancestors around a cycle', () => {
    // If traversal ever regressed to re-expanding visited nodes, this call
    // would hang and the test would fail on timeout rather than assertion.
    const ancestors = getAncestorAssetIds(a, cyclicRelationships);
    expect(ancestors).toHaveLength(3);
    expect(new Set(ancestors)).toEqual(new Set([a, b, c]));
  });

  it('terminates instead of looping forever when tracing descendants around a cycle', () => {
    const descendants = getDescendantAssetIds(a, cyclicRelationships);
    expect(descendants).toHaveLength(3);
    expect(new Set(descendants)).toEqual(new Set([a, b, c]));
  });

  it('produces a deterministic traversal result across repeated calls on the same cyclic graph', () => {
    const first = getAncestorAssetIds(a, cyclicRelationships);
    const second = getAncestorAssetIds(a, cyclicRelationships);
    expect(second).toEqual(first);
  });

  it('signals corruption: an asset on a cycle appears as its own ancestor and descendant', () => {
    expect(getAncestorAssetIds(a, cyclicRelationships)).toContain(a);
    expect(getDescendantAssetIds(a, cyclicRelationships)).toContain(a);
    expect(isAncestorOf(a, a, cyclicRelationships)).toBe(true);
  });

  it('explicitly detects the cycle and reports it as a concrete path', () => {
    const cycle = detectLineageCycle(cyclicRelationships);
    expect(cycle).not.toBeNull();
    expect(cycle).toHaveLength(3);
    expect(new Set(cycle)).toEqual(new Set([a, b, c]));
  });

  it('detects a cycle even when it is only reachable from an otherwise-unrelated acyclic branch', () => {
    const unrelated = asAssetId('unrelated');
    const mixed = [
      ...cyclicRelationships,
      createAssetRelationship({
        id: asAssetRelationshipId('unrelated-edge'),
        fromAssetId: unrelated,
        toAssetId: a,
        relationshipType: 'derived_from',
        createdAt: '2026-01-01T00:03:00.000Z',
      }),
    ];
    expect(detectLineageCycle(mixed)).not.toBeNull();
  });
});
