/**
 * RSA 公钥配置 —— 对齐接口文档 v1.1.4 §4.1
 *
 * 当前演示环境没有可用域名，公钥不再通过接口动态拉取，
 * 而是硬编码在前端代码中（也可通过构建环境变量注入）。
 */
import { JSEncrypt } from 'jsencrypt'

/** RSA 公钥 keyId —— 与后端私钥配对 */
export const RSA_KEY_ID = 'rsa-2026-08'

/** RSA 加密算法 */
export const RSA_ALGORITHM = 'RSA/ECB/PKCS1Padding'

/** 平台固定 RSA 公钥（PEM 格式） */
export const RSA_PUBLIC_KEY_PEM = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAttIDG9u/Ag+1odUe5brC+54CFdFfHrjuC15piR73qx2tOquiRboE
UB2Zsq681ABEtaUS2bk1ihjm2kjoHOCwAZgXM2WSS+pAl5yTcfpGY33mpqQGKwgD
erUEhMgEReXD6JSoGRR3vV6CDVmrGbrw4Jhvjbi3WW3bKsEtFtwtF79wbHOp5Huz
IIMY7l7yRljUF7wl1Hnwsc+VfYPnd1KNT0pR7b4z8xOHM7F6rq/jQ1ByEsA4Stnt
x8WJE67C4seMyTOxY5EbVriR4x0lstULjzw8Qkuqu4fOAbVn4+JpfH9CjqvBNecH
Pwyg+E3scliNZYXywo7eMWS1RjkHPcXnnwIDAQAB
-----END RSA PUBLIC KEY-----`

/**
 * 使用 RSA 公钥加密密码。
 *
 * 采用 RSA/ECB/PKCS1Padding（PKCS#1 v1.5），对齐接口文档 §4.1。
 * 浏览器原生 Web Crypto 的 RSA 加密仅支持 OAEP、不支持 PKCS#1 v1.5，
 * 故用 jsencrypt 实现。
 */
export async function encryptPassword(plainPassword: string): Promise<string> {
  const jsEncrypt = new JSEncrypt()
  jsEncrypt.setPublicKey(RSA_PUBLIC_KEY_PEM)
  const cipher = jsEncrypt.encrypt(plainPassword)
  if (!cipher) throw new Error('RSA 加密失败：公钥无效或格式不受支持')
  return cipher
}
