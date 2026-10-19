import type { DiffComment, DiffFile, DiffHunk } from '@/types/task-model'

/**
 * 行级 hunk 示例（对齐后端 DiffFileResponse.hunks 原始形状：
 * header 为 {oldStart,newStart,oldLines,newLines} 对象、行用 type/oldLineNo/newLineNo/content；
 * 经 taskModelMap.mapDiffFile 二次映射为前端 DiffHunk {header:string, lines:[{kind,oldLine,newLine,text}]}）。
 */
const RAW_HUNKS_MODIFIED: Array<{
  header: { oldStart: number; newStart: number; oldLines: number; newLines: number }
  lines: Array<{ type: 'CONTEXT' | 'ADD' | 'DELETE'; oldLineNo: number | null; newLineNo: number | null; content: string }>
}> = [
  {
    header: { oldStart: 10, newStart: 10, oldLines: 4, newLines: 6 },
    lines: [
      { type: 'CONTEXT', oldLineNo: 10, newLineNo: 10, content: 'public class AuthController {' },
      { type: 'DELETE', oldLineNo: 11, newLineNo: null, content: '  String password = plainText(raw);' },
      { type: 'ADD', oldLineNo: null, newLineNo: 11, content: '  String password = bcrypt.hash(raw);' },
      { type: 'ADD', oldLineNo: null, newLineNo: 12, content: '  logger.info("login attempt");' },
      { type: 'CONTEXT', oldLineNo: 12, newLineNo: 13, content: '}' },
    ],
  },
]

/** 对齐 DiffFileResponse：id/sequence/path/changeType/additions/deletions/binary + hunks。 */
export function defaultMockDiffFiles(): DiffFile[] {
  return [
    {
      id: 'file-example',
      sequence: 1,
      path: 'src/example.ts',
      changeType: 'MODIFIED',
      status: 'MODIFIED',
      additions: 1,
      deletions: 1,
      binary: false,
      hunks: RAW_HUNKS_MODIFIED as unknown as DiffHunk[],
    },
  ]
}

export function loginApiDiffFiles(): DiffFile[] {
  return [
    {
      id: 'file-auth-controller',
      sequence: 1,
      path: 'src/auth/AuthController.ts',
      changeType: 'MODIFIED',
      status: 'MODIFIED',
      additions: 8,
      deletions: 2,
      binary: false,
      hunks: RAW_HUNKS_MODIFIED as unknown as DiffHunk[],
    },
    {
      id: 'file-jwt-middleware',
      sequence: 2,
      path: 'src/auth/JwtMiddleware.ts',
      changeType: 'ADDED',
      status: 'ADDED',
      additions: 18,
      deletions: 0,
      binary: false,
      hunks: [],
    },
    {
      id: 'file-auth-types',
      sequence: 3,
      path: 'src/auth/types.ts',
      changeType: 'ADDED',
      status: 'ADDED',
      additions: 12,
      deletions: 0,
      binary: false,
      hunks: [],
    },
    {
      id: 'file-auth-test',
      sequence: 4,
      path: 'test/auth/AuthController.test.ts',
      changeType: 'ADDED',
      status: 'ADDED',
      additions: 16,
      deletions: 0,
      binary: false,
      hunks: [],
    },
    {
      id: 'file-login-flow',
      sequence: 5,
      path: 'docs/login-flow.png',
      changeType: 'ADDED',
      status: 'ADDED',
      additions: 0,
      deletions: 0,
      binary: true,
      hunks: [],
    },
  ]
}

/** 对齐 DiffCommentResponse：authorUserId + authorAvatarUrl，无 authorName。 */
export function loginApiDiffComments(diffId: string): DiffComment[] {
  return [
    {
      id: `comment-${diffId}-1`,
      diffId,
      path: 'src/auth/AuthController.ts',
      side: 'RIGHT',
      line: 20,
      hunkId: null,
      commitSha: 'a1b2c3d',
      body: '密码有做哈希吗？还是明文比对？',
      authorUserId: 'user-002',
      authorName: null,
      authorAvatarUrl: 'https://cdn.example.com/avatars/user-002.png',
      createdAt: '2026-05-16T11:20:00Z',
    },
    {
      id: `comment-${diffId}-2`,
      diffId,
      path: 'src/auth/AuthController.ts',
      side: 'RIGHT',
      line: 20,
      hunkId: null,
      commitSha: 'a1b2c3d',
      body: 'AuthService 里 bcrypt.compare，下一提交补测试。',
      authorUserId: 'user-001',
      authorName: null,
      authorAvatarUrl: 'https://cdn.example.com/avatars/user-001.png',
      createdAt: '2026-05-16T11:35:00Z',
    },
  ]
}
