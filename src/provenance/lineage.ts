import type { AssetRelationship } from '../domain/assetRelationship.js';
import type { AssetId } from '../domain/ids.js';

/**
 * Lineage graph edges run fromAssetId (earlier) -> toAssetId (later),
 * e.g. guitar_take_07 --edited_from--> guitar_comp --mixed_into--> final_mix.
 * "Ancestors" of an asset are everything upstream of it; "descendants" are
 * everything downstream.
 *
 * CYCLE SAFETY: legitimate lineage is a DAG — an asset can never be its own
 * ancestor. `createAssetRelationship` already rejects the trivial one-edge
 * cycle (an asset related to itself). A longer cycle (A -> B -> C -> A) can
 * still be assembled from three otherwise-valid edges, so it cannot be
 * rejected at single-edge construction time; it has to be caught either by
 * traversal or by an explicit graph-level check:
 *
 *  - `traverse` (and therefore `getAncestorAssetIds`/`getDescendantAssetIds`)
 *    tracks visited nodes and only expands each node once, so a cycle can
 *    never cause an infinite loop — it terminates in O(V+E) regardless of
 *    how the relationships are ordered, and the result is deterministic.
 *    A cyclic graph shows up in the *result*: querying ancestors of any
 *    asset on the cycle will include that asset itself. That is a signal
 *    that the lineage data is corrupted, not a valid answer to "what did
 *    this asset derive from" — callers that need to reject cycles outright
 *    (e.g. before finalizing a checkpoint) should use `detectLineageCycle`.
 *  - `detectLineageCycle` runs a standard DFS with an explicit recursion
 *    stack to find and report a concrete cycle path, so a caller that wants
 *    to reject corrupted lineage before relying on it can do so with one
 *    call instead of inferring it from a self-referential ancestor result.
 */

function buildAdjacency(
  relationships: readonly AssetRelationship[],
  direction: 'forward' | 'backward',
): Map<AssetId, AssetId[]> {
  const adjacency = new Map<AssetId, AssetId[]>();
  for (const rel of relationships) {
    const [key, neighbor] = direction === 'forward' ? [rel.fromAssetId, rel.toAssetId] : [rel.toAssetId, rel.fromAssetId];
    const existing = adjacency.get(key);
    if (existing) {
      existing.push(neighbor);
    } else {
      adjacency.set(key, [neighbor]);
    }
  }
  return adjacency;
}

function traverse(start: AssetId, adjacency: Map<AssetId, AssetId[]>): AssetId[] {
  const visited = new Set<AssetId>();
  const result: AssetId[] = [];
  const stack = [...(adjacency.get(start) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);
    result.push(current);
    stack.push(...(adjacency.get(current) ?? []));
  }

  return result;
}

/** All assets upstream of `assetId` (things it was derived from, transitively). */
export function getAncestorAssetIds(assetId: AssetId, relationships: readonly AssetRelationship[]): AssetId[] {
  return traverse(assetId, buildAdjacency(relationships, 'backward'));
}

/** All assets downstream of `assetId` (things derived from it, transitively). */
export function getDescendantAssetIds(assetId: AssetId, relationships: readonly AssetRelationship[]): AssetId[] {
  return traverse(assetId, buildAdjacency(relationships, 'forward'));
}

/** True if `ancestorId` is somewhere upstream of `descendantId`. */
export function isAncestorOf(
  ancestorId: AssetId,
  descendantId: AssetId,
  relationships: readonly AssetRelationship[],
): boolean {
  return getAncestorAssetIds(descendantId, relationships).includes(ancestorId);
}

/**
 * Detects a cycle in the lineage graph, if one exists, and returns it as an
 * ordered path of asset ids (each related to the next) for diagnostics.
 * Returns null for a valid, acyclic (DAG) lineage graph.
 *
 * This is the explicit validator for "is this lineage data trustworthy" —
 * traversal functions above already terminate safely on a cyclic graph, but
 * they don't reject it. Callers that need to refuse corrupted lineage
 * outright (rather than silently traversing through it) should call this
 * first.
 */
export function detectLineageCycle(relationships: readonly AssetRelationship[]): readonly AssetId[] | null {
  const adjacency = buildAdjacency(relationships, 'forward');
  const allNodes = new Set<AssetId>();
  for (const rel of relationships) {
    allNodes.add(rel.fromAssetId);
    allNodes.add(rel.toAssetId);
  }

  const visited = new Set<AssetId>();
  const onPath = new Set<AssetId>();
  const path: AssetId[] = [];

  function visit(node: AssetId): readonly AssetId[] | null {
    visited.add(node);
    onPath.add(node);
    path.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (onPath.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        return path.slice(cycleStart);
      }
      if (!visited.has(neighbor)) {
        const found = visit(neighbor);
        if (found) {
          return found;
        }
      }
    }

    onPath.delete(node);
    path.pop();
    return null;
  }

  for (const node of allNodes) {
    if (!visited.has(node)) {
      const cycle = visit(node);
      if (cycle) {
        return cycle;
      }
    }
  }

  return null;
}
