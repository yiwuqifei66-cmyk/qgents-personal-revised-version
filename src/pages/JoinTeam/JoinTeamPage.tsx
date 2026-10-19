import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Tag } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PATHS } from '@/routes/paths'
import { useAuth } from '@/context/AuthContext'
import { teamApi } from '@/api'
import type { MyTeamInvitation } from '@/types'
import './JoinTeamPage.css'

/**
 * 加入已有团队 —— 对齐接口文档 v1.1.4 §5.1
 *
 * 用户粘贴邮件邀请中的邀请令牌，调 POST /team-invitations/{token}/accept
 */
export default function JoinTeamPage() {
  const navigate = useNavigate()
  const { setHasTeam } = useAuth()
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // 待处理邀请列表（收件人视角，分页响应取 data）
  const { data: myInvitationsData } = useQuery({
    queryKey: ['team-invitations', 'mine'],
    queryFn: () => teamApi.listMyInvitations(),
  })
  const myInvitations = myInvitationsData?.data ?? []

  const acceptMutation = useMutation({
    mutationFn: (inv: MyTeamInvitation) => teamApi.acceptInvitation(inv.id),
    onSuccess: (_result, inv) => {
      setHasTeam(true)
      setSuccess(`已成功加入「${inv.teamName}」`)
      queryClient.invalidateQueries({ queryKey: ['team-invitations', 'mine'] })
      queryClient.invalidateQueries({ queryKey: ['teams', 'mine'] })
      queryClient.invalidateQueries({queryKey:['teams',inv.teamId,'projects']})
      setTimeout(() => {
        navigate(PATHS.teamDetail(inv.teamId), { replace: true })
      }, 1000)
    },
    onError: (err) => setError(err instanceof Error ? err.message : '接受邀请失败'),
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token.trim()) return
    setError(null)
    setSuccess(null)
    setSubmitting(true)

    try {
      await teamApi.acceptInvitation(token.trim())
      setHasTeam(true)
      setSuccess('已成功加入团队')
      // 延迟跳转，让用户看到成功提示（接受响应不含 teamId，回团队列表）
      setTimeout(() => {
        navigate(PATHS.MY_TEAMS, { replace: true })
      }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入失败，邀请令牌可能已过期')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="join-team">
      <Link to={PATHS.MY_TEAMS} className="join-team__back">
        ← 返回我的团队
      </Link>
      <h1>加入已有团队</h1>
      <p className="join-team__desc">
        输入团队邀请邮件中的邀请令牌，即可加入团队
      </p>

      <form className="join-team__card" onSubmit={handleSubmit}>
        {error && (
          <div className="join-team__error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="join-team__success" role="status">
            {success}
          </div>
        )}

        <label>
          <span>邀请令牌</span>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="粘贴邀请邮件中的令牌"
            required
          />
        </label>
        <button type="submit" disabled={submitting || !token.trim()}>
          {submitting ? '加入中…' : '加入团队'}
        </button>
      </form>

      {/* 待处理邀请列表 */}
      <section className="join-team__pending">
        <h2>待处理邀请</h2>
        {myInvitations.length === 0 ? (
          <p className="join-team__placeholder">暂无待处理邀请</p>
        ) : (
          <ul className="join-team__invite-list">
            {myInvitations.map((inv) => (
              <li key={inv.id} className="join-team__invite-item">
                <div className="join-team__invite-main">
                  <div className="join-team__invite-left">
                    <div className="join-team__invite-title">
                      <strong>{inv.teamName}</strong>
                      <Tag color={inv.role === 'TEAM_OWNER' ? 'gold' : 'default'}>
                        {inv.role === 'TEAM_OWNER' ? 'Owner' : 'Member'}
                      </Tag>
                    </div>
                    <div className="join-team__invite-meta">
                      <span>邀请人：{inv.inviterDisplayName}</span>
                      <span className="join-team__invite-dot">·</span>
                      <span>{inv.createdAt}</span>
                    </div>
                  </div>
                  <Button
                    type="primary"
                    size="middle"
                    loading={acceptMutation.isPending}
                    onClick={() => acceptMutation.mutate(inv)}
                  >
                    接受邀请
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
