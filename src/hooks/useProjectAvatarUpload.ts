import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { projectApi } from '@/api'

/**
 * 项目头像上传（签发直传凭证 → 直传 OSS → 确认返回公共 URL → PATCH /projects/{id} 回写）。
 * 供项目设置「基本信息」与「创建项目」弹窗复用（v2.0.6 从群聊设置栏迁出）。
 * @param teamId 项目所属团队 id（传了则在成功后同步失效团队项目列表缓存）
 */
export function useProjectAvatarUpload(teamId?: string) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)

  /**
   * 上传并回写项目头像。
   * @param projectId 已创建的项目 id（创建项目弹窗在 create 成功后调用）
   */
  async function uploadAvatar(projectId: string, file: File): Promise<boolean> {
    if (!projectId || uploading) return false
    setUploading(true)
    try {
      const credential = await projectApi.avatarCredential(projectId, {
        mediaType: file.type,
        sizeBytes: file.size,
      })
      const putRes = await fetch(credential.uploadUrl, { method: 'PUT', body: await file.arrayBuffer() })
      if (!putRes.ok) throw new Error(`头像上传失败（${putRes.status}）`)
      const result = await projectApi.avatarConfirm(projectId, credential.objectKey)
      // URL 追加版本参数：强制浏览器绕过缓存加载最新图（避免旧图缓存 2-3 分钟）
      const avatarUrl = withCacheBuster(result.avatarUrl)
      await projectApi.update(projectId, { avatarUrl })
      // 同步刷新所有展示项目头像的查询：项目详情/群聊、团队首页-项目列表（key 不同，需分别失效）
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      if (teamId) {
        queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'projects'] })
      }
      message.success('项目头像已更新')
      return true
    } catch (err) {
      message.error(err instanceof Error ? err.message : '头像上传失败，请重试')
      return false
    } finally {
      setUploading(false)
    }
  }

  return { uploading, uploadAvatar }
}

/** 给 OSS 公共读 URL 追加版本参数，强制浏览器绕过缓存加载最新图 */
function withCacheBuster(url: string): string {
  if (!url) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${Date.now()}`
}
