/**
 * Diff / CR 页展示辅助类型。
 * 文件/hunk/行与接口模型共用 src/types/task-model.ts，避免页面再维护一份结构。
 */

import type { DiffFile, DiffFileStatus } from './task-model'

export type { DiffFile, DiffFileStatus, DiffHunk, DiffLine, DiffLineKind } from './task-model'

export type DiffReviewStatus = 'PENDING_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED'

export type DiffCommentSide = 'LEFT' | 'RIGHT'

export interface DiffChangeStats {
  files: number
  additions: number
  deletions: number
}

export interface DiffComment {
  id: string
  authorName: string
  body: string
  createdAt: string
  path: string
  line: number
  side: DiffCommentSide
  resolved?: boolean//是否已解决
  replyToId?: string//回复的评论 ID
}

export interface DiffReviewView {
  id: string//这条 Diff 评审记录唯一 ID
  displayCode: string
  title: string//?
  status: DiffReviewStatus
  sourceBranch: string
  targetBranch: string
  repositoryName: string
  taskCode?: string//关联的任务编号
  taskTitle?: string//关联的任务标题
  requirementGroupId?: string//关联的需求组 ID
  requirementTitle?: string//关联的需求标题
  authorName: string//评审者名称
  headCommit?: string//提交的头部提交
  changeStats: DiffChangeStats//文件的统计信息
  files: DiffFile[]//文件列表
  comments: DiffComment[]//评论列表
}

export function diffStatusLabel(status: DiffReviewStatus): string {
  switch (status) {
    case 'PENDING_REVIEW':
      return '进行中'
    case 'ACCEPTED':
      return '已接受'
    case 'REJECTED':
      return '已拒绝'
    case 'SUPERSEDED':
      return '已被后续修改取代'
  }
}

export function diffFileStatusLabel(status: DiffFileStatus): string {
  switch (status) {
    case 'ADDED':
      return 'A'
    case 'MODIFIED':
      return 'M'
    case 'DELETED':
      return 'D'
  }
}
