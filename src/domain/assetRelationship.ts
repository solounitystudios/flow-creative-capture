import type { AssetId, AssetRelationshipId } from './ids.js';
import { ASSET_RELATIONSHIP_TYPES, type AssetRelationshipType } from './enums.js';

/**
 * A directed edge in the asset lineage graph, e.g.:
 *   guitar_take_07.wav --edited_from--> guitar_comp.wav
 *   guitar_comp.wav --mixed_into--> final_mix.wav
 *   final_mix.wav --mastered_from--> final_master.wav
 */
export interface AssetRelationship {
  readonly id: AssetRelationshipId;
  readonly fromAssetId: AssetId;
  readonly toAssetId: AssetId;
  readonly relationshipType: AssetRelationshipType;
  readonly createdAt: string;
}

export interface AssetRelationshipInput {
  id: AssetRelationshipId;
  fromAssetId: AssetId;
  toAssetId: AssetId;
  relationshipType: AssetRelationshipType;
  createdAt: string;
}

export function createAssetRelationship(input: AssetRelationshipInput): AssetRelationship {
  if (!ASSET_RELATIONSHIP_TYPES.includes(input.relationshipType)) {
    throw new Error(`AssetRelationship.relationshipType "${input.relationshipType}" is not recognized`);
  }
  if (input.fromAssetId === input.toAssetId) {
    throw new Error('AssetRelationship cannot relate an asset to itself');
  }

  return Object.freeze({
    id: input.id,
    fromAssetId: input.fromAssetId,
    toAssetId: input.toAssetId,
    relationshipType: input.relationshipType,
    createdAt: input.createdAt,
  });
}
