import type { CSSProperties, ReactNode } from 'react'

type SyntaxKind = 'javascript' | 'typescript' | 'vue' | 'html' | 'css' | 'json' | 'markdown' | 'shell' | 'python' | 'java' | 'plain'
type TokenKind = 'comment' | 'string' | 'keyword' | 'number'

const LANGUAGE_LABELS: Record<SyntaxKind, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  vue: 'Vue',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  markdown: 'Markdown',
  shell: 'Shell',
  python: 'Python',
  java: 'Java',
  plain: '文本',
}

const KEYWORDS = new Set([
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'final', 'finally', 'for',
  'from', 'function', 'if', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'private',
  'protected', 'public', 'return', 'static', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof',
  'undefined', 'var', 'void', 'while', 'with', 'yield',
])

const TOKEN_PATTERN = /\/\/.*$|#.*$|\/\*[\s\S]*?\*\/|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?\b/gm
const TOKEN_STYLES: Record<TokenKind, CSSProperties> = {
  comment: { color: '#8290a8', fontStyle: 'italic' },
  string: { color: '#a3436d' },
  keyword: { color: '#7556b5', fontWeight: 600 },
  number: { color: '#0c7b70' },
}

export function syntaxKindForPath(path: string): SyntaxKind {
  const extension = path.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'javascript'
    case 'ts': case 'tsx': return 'typescript'
    case 'vue': return 'vue'
    case 'html': case 'htm': return 'html'
    case 'css': case 'scss': case 'sass': case 'less': return 'css'
    case 'json': return 'json'
    case 'md': case 'mdx': return 'markdown'
    case 'sh': case 'bash': case 'zsh': return 'shell'
    case 'py': return 'python'
    case 'java': return 'java'
    default: return 'plain'
  }
}

export function syntaxLanguageLabel(path: string): string {
  return LANGUAGE_LABELS[syntaxKindForPath(path)]
}

/** Diff 服务有时会把代码内容作为 HTML 实体返回；React 仍会负责最终文本转义。 */
export function decodeDiffText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function tokenKind(token: string): TokenKind | null {
  if (token.startsWith('//') || token.startsWith('#') || token.startsWith('/*')) return 'comment'
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) return 'string'
  if (KEYWORDS.has(token)) return 'keyword'
  if (/^\d/.test(token)) return 'number'
  return null
}

/** Lightweight highlighting for diff lines. It deliberately avoids a heavy editor dependency. */
export function highlightDiffCode(text: string, path: string): ReactNode {
  const decodedText = decodeDiffText(text)
  if (syntaxKindForPath(path) === 'plain') return decodedText

  const nodes: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  TOKEN_PATTERN.lastIndex = 0
  while ((match = TOKEN_PATTERN.exec(decodedText)) !== null) {
    const token = match[0]
    if (match.index > cursor) nodes.push(decodedText.slice(cursor, match.index))
    const kind = tokenKind(token)
    nodes.push(kind ? <span data-syntax-token={kind} key={`${match.index}-${token}`} style={TOKEN_STYLES[kind]}>{token}</span> : token)
    cursor = match.index + token.length
  }
  if (cursor < decodedText.length) nodes.push(decodedText.slice(cursor))
  return nodes
}
