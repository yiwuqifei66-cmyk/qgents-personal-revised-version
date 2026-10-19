/**
 * 项目需求列表占位
 * TODO[后端联调]: GET /projects/:id/requirements —— 每个需求对应独立群聊路由
 */
export const PROJECT_REQUIREMENTS = [
  { id: 'login', title: '登录功能', ref: 'feat/login' },
  { id: 'pay', title: '支付回调', ref: 'feat/payment-hook' },
  { id: 'dashboard', title: '数据看板', ref: 'feat/dashboard' },
] as const

export type RequirementId = (typeof PROJECT_REQUIREMENTS)[number]['id']

export function getRequirement(id: string | undefined) {
  return PROJECT_REQUIREMENTS.find((r) => r.id === id) ?? PROJECT_REQUIREMENTS[0]
}
