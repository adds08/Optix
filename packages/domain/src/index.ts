export {
  INITIAL_STATE,
  type AssetStateSnapshot,
  type EventEnvelope,
} from "./events.js";
export {
  foldAssetState,
  foldAllAssets,
  hasSnapshotEvidence,
  reconcileProjections,
  type DivergenceKind,
  type ProjectedAssetState,
  type ProjectionDivergence,
} from "./fold.js";
export {
  custodyOutcome,
  type CustodyOutcome,
  isIdleAsset,
} from "./rules.js";
export {
  adaptBambooEmployee,
  adaptBambooPage,
  normaliseBambooStatus,
  BAMBOO_OPTIONAL_FIELDS,
  type BambooEmployeeRecord,
  type AdaptedBambooPerson,
  type BambooAdaptFailure,
  type BambooAdaptResult,
  type BambooWritableFields,
  type BambooIdentityFields,
  type BambooObservations,
  type BambooContact,
} from "./bamboohr.js";
export {
  canAssignIntoTier,
  type TeamRoleAuthorityInput,
} from "./team-role-authority.js";
export {
  buildOrgForest,
  visibleEmployeeIds,
  descendantsOf,
  findCycle,
  findTierCycle,
  adjacentTiers,
  tiersAtOrBelow,
  tiersAbove,
  SYNTHETIC_PREFIX,
  type TierEdge,
  type ClaimableTier,
  type OrgMemberInput,
  type OrgNode,
} from "./org-chart.js";

export { branchEmployeeIds, removalBranch } from "./project-branch.js";

/* Title -> role/tier SUGGESTIONS. Never a decision — see the header on
   role-suggestion.ts for why this is a function and not the mapping table
   that was retired on 2026-09-09. */
export {
  normaliseJobTitle,
  canonicalKeyForTitle,
  suggestRoleId,
  suggestTierName,
} from "./role-suggestion.js";
