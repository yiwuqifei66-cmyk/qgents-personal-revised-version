import { theme, type ThemeConfig } from 'antd'

/**
 * 品牌字体栈。Plus Jakarta Sans 不含汉字，必须把中文无衬线字体写在 generic sans-serif 之前，
 * 否则 Windows 会把卡片/按钮/标签里的中文回退成宋体或 Times。
 */
export const QG_FONT_FAMILY =
  "'Plus Jakarta Sans', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"

/**
 * Qgents Ant Design 主题
 * 对齐现有深色 Navy + 绿色品牌色；全局通过 ConfigProvider 注入
 */
export const qgAntdTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#22c55e',
    colorBgBase: '#0b1424',
    colorBgContainer: '#161b22',
    colorBgElevated: '#1c2128',
    colorBorder: '#30363d',
    colorText: '#e6edf3',
    colorTextSecondary: '#8b949e',
    borderRadius: 8,
    fontFamily: QG_FONT_FAMILY,
  },
  components: {
    Layout: {
      headerBg: '#161b22',
      bodyBg: '#0b1424',
      siderBg: '#161b22',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      itemHeight: 40,
      itemMarginInline: 8,
      itemBorderRadius: 8,
    },
  },
}

/** 登录页右侧表单区：保持原型图的浅色卡片 */
export const qgLoginLightTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#0d9b8a',
    borderRadius: 10,
    fontFamily: QG_FONT_FAMILY,
  },
}

/**
 * 深色页面主题 —— 用于挂在 MainLayout 深色 navy 背景下的页面
 * （团队设置、GitHub 集成、已授权仓库、绑定项目等）。
 * 这些页面的内容直接透出 navy 底，需要 antd 深色算法把文字/卡片/表格统一转成浅色。
 */
export const qgDarkPageTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#0d9b8a',
    borderRadius: 10,
    fontFamily: QG_FONT_FAMILY,
  },
}
