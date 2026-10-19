/** 代码与 Branch 在 +/- 均为 0 且尚无真实 Diff 快照时，用此前缀进入空 Diff 页。 */
export const EMPTY_BRANCH_DIFF_PREFIX = 'empty-branch:'

export function toEmptyBranchDiffId(branchId: string): string {
  return `${EMPTY_BRANCH_DIFF_PREFIX}${branchId}`
}

export function isEmptyBranchDiffId(diffId: string): boolean {
  return diffId.startsWith(EMPTY_BRANCH_DIFF_PREFIX)
}
