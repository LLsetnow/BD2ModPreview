export type SpineSource =
  | { type: "folder"; path: string }
  | { type: "url"; skeletonUrl: string; atlasUrl: string, skeletonUrlFallback?: string; atlasUrlFallback?: string };

export const FULL_SKILL_SEQUENCE = "__bd2_full_skill_sequence__";

export interface AudioAsset {
  relativePath: string;
  fileName: string;
}
