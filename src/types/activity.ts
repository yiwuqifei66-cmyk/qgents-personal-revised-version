/**
 * 最近动态类型 —— 对齐「前端对接文档_团队邀请收件人视角与最近动态_后端1.md」。
 * 用于团队首页右侧「最近动态」面板，聚合团队内各类操作记录。
 */

/** 动态类型（本期后端仅产出 6 类，覆盖最近 24 小时） */
export type ActivityType =
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'DIFF_CREATED'
  | 'MR_CREATED'
  | 'MR_MERGED'
  | 'TEST_RUN_FAILED'

/** 动态目标类型 */
export type ActivityTargetType = 'TASK' | 'DIFF' | 'MR' | 'PROJECT'

export interface ActivityActor {
  id: string
  displayName: string
  /** 本期后端恒为 null（无头像来源） */
  avatar?: string | null
}

export interface ActivityTarget {
  type: ActivityTargetType
  id: string
  title?: string
}

export interface Activity {
  id: string
  type: ActivityType
  /** 后端已生成的展示文案，前端当文本展示，勿解析 */
  title: string
  /** 本期恒为 null */
  summary?: string | null
  /** 部分事件（MR / 无任务关联的测试失败）为 null */
  actor: ActivityActor | null
  target: ActivityTarget
  /** 本期恒为 null，前端按 target.type + id 用 PATHS 拼前端路由 */
  link?: string | null
  /**
   * 所属项目 id。§19.4 当前响应未下发（TASK/DIFF/MR 目标无法拼项目路由）；
   * 后端补齐后前端即可跳转，缺省时仅 PROJECT 目标可跳。
   */
  projectId?: string | null
  createdAt: string
}
