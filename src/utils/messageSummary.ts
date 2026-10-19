import type { MessageSummary, MessageContentType } from '@/types'

/** 无文本消息类型的摘要占位（§7 latestMessage：text 仅含 $.text 的类型可取到） */
const TYPE_SUMMARIES: Partial<Record<MessageContentType, string>> = {
  IMAGE: '[图片]',
  FILE: '[文件]',
  DIFF: '[Diff 待验收]',
  TASK_STATUS: '[任务状态]',
  CODE: '[代码]',
  QUOTE: '[引用]',
  SYSTEM: '[系统消息]',
}

/**
 * 群列表最新消息摘要展示文本：text 可用时直接返回（前缀发送者名由调用方拼），
 * text 为空（IMAGE/FILE/DIFF 等类型）时按 type 返回占位文案。
 */
export function latestMessageText(summary: MessageSummary | undefined | null): string {
  if (!summary) return ''
  if (summary.text && summary.text.trim().length > 0) return summary.text
  if (summary.type && TYPE_SUMMARIES[summary.type]) return TYPE_SUMMARIES[summary.type] as string
  return ''
}
