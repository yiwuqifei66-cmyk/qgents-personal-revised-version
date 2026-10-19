import { useNavigate } from 'react-router-dom'
import { Typography, Row, Col, Card, Button, Space } from 'antd'
import { PlusOutlined, LoginOutlined } from '@ant-design/icons'
import { PATHS } from '@/routes/paths'

const { Title, Paragraph } = Typography

/**
 * 登录后引导页 —— 需在 MainLayout 外单独铺深色背景
 */
export default function WelcomePage() {
  const navigate = useNavigate()

  return (
    <div className="qg-page-dark qg-page-welcome">
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 24px' }}>
        <header style={{ textAlign: 'center', marginBottom: 40 }}>
          {/* clamp(min, ideal, max)：ideal 用正斜率 vw，大屏取大值、小屏取小值，区间内平滑插值 */}
          <Title
            level={2}
            style={{
              color: '#f3f4f6',
              marginTop: 0,
              fontSize: 'clamp(22px, 1vw + 14px, 30px)',
              lineHeight: 1.3,
            }}
          >
            欢迎来到 Qgents
          </Title>
          <Paragraph
            style={{
              color: '#9aa3b5',
              marginBottom: 0,
              fontSize: 'clamp(13px, 0.4vw + 12px, 15px)',
            }}
          >
            你还未加入任何团队，请选择创建或加入团队
          </Paragraph>
        </header>

        <Row gutter={[24, 24]}>
          <Col xs={24} md={12}>
            <Card hoverable style={{ height: '100%', textAlign: 'center' }} styles={{ body: { padding: 32 } }}>
              <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: '#3b82f6',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 20,
                  }}
                >
                  <PlusOutlined />
                </div>
                <Title
                  level={4}
                  style={{ margin: 0, fontSize: 'clamp(16px, 0.5vw + 12px, 20px)' }}
                >
                  创建团队
                </Title>
                <Paragraph
                  type="secondary"
                  style={{ fontSize: 'clamp(13px, 0.3vw + 12px, 14px)' }}
                >
                  自建工作室，生成邀请码，通过 Github 邮箱邀请成员协作
                </Paragraph>
                <Button type="primary" size="large" onClick={() => navigate(PATHS.CREATE_TEAM)}>
                  立即创建
                </Button>
              </Space>
            </Card>
          </Col>

          <Col xs={24} md={12}>
            <Card hoverable style={{ height: '100%', textAlign: 'center' }} styles={{ body: { padding: 32 } }}>
              <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: '#22c55e',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 20,
                  }}
                >
                  <LoginOutlined />
                </div>
                <Title
                  level={4}
                  style={{ margin: 0, fontSize: 'clamp(16px, 0.5vw + 12px, 20px)' }}
                >
                  加入已有团队
                </Title>
                <Paragraph
                  type="secondary"
                  style={{ fontSize: 'clamp(13px, 0.3vw + 12px, 14px)' }}
                >
                  填写邀请码加入，或处理别人发送给你的团队邀请
                </Paragraph>
                <Button
                  size="large"
                  style={{ background: '#22c55e', borderColor: '#22c55e', color: '#fff' }}
                  onClick={() => navigate(PATHS.JOIN_TEAM)}
                >
                  加入团队
                </Button>
              </Space>
            </Card>
          </Col>
        </Row>
      </div>
    </div>
  )
}
