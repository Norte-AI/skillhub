import { spawn } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { CliError } from '../shared/errors'
import { EXIT } from '../shared/constants'

// Reserve one registry package entry for the generated provenance file.
const MAX_FILES = 499
const MAX_FILE_BYTES = 10 * 1024 * 1024
// Reserve space for the bounded generated source JSON in the 100 MiB package.
const MAX_TOTAL_BYTES = 100 * 1024 * 1024 - 8192
const MAX_REPOSITORY_BYTES = 256 * 1024 * 1024
const MAX_TREE_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 60_000

export interface GitSourceInput { repository: string; ref?: string; subdir?: string }
export interface GitSourceProvenance { repository: string; requestedRef: string; commit: string; subdir: string }
export interface GitSourceSnapshot { directory: string; source: GitSourceProvenance; cleanup: () => Promise<void> }

export function validateGitSource(input: GitSourceInput): Omit<GitSourceProvenance, 'commit'> {
  if (input.repository.length > 2048) throw new CliError('Git repository URL exceeds 2048 characters', EXIT.usage)
  let url: URL
  try { url = new URL(input.repository) } catch { throw new CliError('Git repository must be a public HTTPS URL', EXIT.usage) }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port && url.port !== '443') throw new CliError('Use a public HTTPS Git URL without credentials, query, fragment, or custom port', EXIT.usage)
  const host = url.hostname.toLowerCase()
  if (!host.includes('.') || isIP(host) || host.includes(':') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || /^\d+(?:\.\d+)*$/.test(host)) throw new CliError('Local and private Git repository hosts are not supported', EXIT.usage)
  if (url.href.length > 2048 || !url.pathname || url.pathname === '/' || (containsControl(input.repository) || /[\s\\]/.test(input.repository))) throw new CliError('Invalid Git repository URL', EXIT.usage)
  const requestedRef = input.ref ?? 'HEAD'
  if (!requestedRef || requestedRef.length > 255 || requestedRef.startsWith('-') || !/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(requestedRef) || requestedRef.includes('..') || requestedRef.includes('//') || requestedRef.endsWith('/') || requestedRef.endsWith('.') || requestedRef.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) throw new CliError('Git ref must be a branch, tag, or full commit SHA', EXIT.usage)
  const subdir = normalizeSubdir(input.subdir ?? '.')
  return { repository: url.href, requestedRef, subdir }
}

function containsControl(value: string): boolean { return Array.from(value).some(char => { const code = char.charCodeAt(0); return code < 32 || code === 127 }) }
function normalizeSubdir(value: string): string {
  if (value === '.') return value
  if (!value || value.length > 1024 || value.startsWith('/') || (containsControl(value) || /[\\:]/.test(value)) || value.split('/').some(part => !part || part === '.' || part === '..' || protectedPart(part))) throw new CliError('Git subdirectory must be a safe relative POSIX path', EXIT.usage)
  return value
}
function protectedPart(part: string): boolean { return part.toLowerCase().replace(/[ .]+$/g, '') === '.git' }
function safeEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: 'C', LC_ALL: 'C',
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0', GIT_ALLOW_PROTOCOL: 'https',
  }
}
const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'init.templateDir=', '-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'http.followRedirects=false', '-c', 'fetch.recurseSubmodules=false', '-c', 'submodule.recurse=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false']

async function directoryBytes(directory: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) total += await directoryBytes(path)
    else if (entry.isFile()) total += (await stat(path)).size
    if (total > MAX_REPOSITORY_BYTES) return total
  }
  return total
}
async function runGit(args: string[], cwd: string, maxBytes = MAX_TREE_BYTES, monitor = false): Promise<Buffer> {
  return new Promise((resolveResult, reject) => {
    const child = spawn('git', [...gitOptions, ...args], { cwd, env: safeEnvironment(cwd), shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let size = 0; let errorSize = 0; let failure: Error | undefined
    const abort = (message: string, exitCode: number = EXIT.validation) => {
      failure ??= new CliError(message, exitCode)
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      } else child.kill('SIGKILL')
    }
    const timeout = setTimeout(() => abort('Git operation timed out', EXIT.network), TIMEOUT_MS)
    let checking = false
    const timer = monitor ? setInterval(() => {
      if (checking) return
      checking = true
      void directoryBytes(cwd).then(bytes => { if (bytes > MAX_REPOSITORY_BYTES) abort('Git repository exceeds the download size limit') }).catch(() => {}).finally(() => { checking = false })
    }, 100) : undefined
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) abort('Git output exceeds the allowed size')
      else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => { errorSize += chunk.length; if (errorSize > MAX_TREE_BYTES) abort('Git diagnostic output exceeds the allowed size') })
    const clear = () => { clearTimeout(timeout); if (timer) clearInterval(timer) }
    child.once('error', () => { clear(); reject(new CliError('Cannot execute Git; install Git and retry', EXIT.filesystem)) })
    child.once('close', code => {
      clear()
      if (failure) reject(failure)
      else if (code !== 0) reject(new CliError('Git operation failed; verify the public repository URL and ref', EXIT.network))
      else resolveResult(Buffer.concat(chunks))
    })
  })
}

function privateAddress(address: string): boolean {
  if (address.includes(':')) {
    const value = address.toLowerCase()
    // Be conservative about non-global IPv6, including IPv4 mapped addresses.
    return !/^[23][0-9a-f]{3}:/.test(value) || value.startsWith('2001:db8:')
  }
  const parts = address.split('.').map(Number)
  const a = parts[0] ?? 0; const b = parts[1] ?? 0
  return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0
}

/** Trusted hosted providers may be routed through a local VPN fake-IP range.
 * TLS hostname verification stays enabled; this client exception is deliberately
 * unavailable to arbitrary hosts or server-side imports.
 */
export function allowedGitAddress(hostname: string, address: string): boolean {
  const trustedProvider = ['github.com', 'gitlab.com'].includes(hostname.toLowerCase())
  const octets = address.split('.').map(Number)
  const syntheticProviderAddress = trustedProvider && octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255) && octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)
  return syntheticProviderAddress || !privateAddress(address)
}

/** Export raw tracked Git blobs. Checkout filters, hooks, Git LFS and submodules are never run. */
export async function exportTrackedGitSnapshot(options: { gitDirectory: string; commit: string; subdir?: string; outputDirectory: string }): Promise<void> {
  const { gitDirectory, commit, outputDirectory } = options
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit)) throw new CliError('A full immutable Git commit is required', EXIT.validation)
  const subdir = normalizeSubdir(options.subdir ?? '.')
  const raw = await runGit(['ls-tree', '-r', '-z', '-l', '--full-tree', commit, '--', ...(subdir === '.' ? [] : [subdir])], gitDirectory)
  if (!Buffer.from(raw.toString('utf8'), 'utf8').equals(raw)) throw new CliError('Git paths must use valid UTF-8', EXIT.validation)
  const entries = raw.toString('utf8').split('\0').filter(Boolean)
  if (entries.length > MAX_FILES) throw new CliError(`Git skill exceeds ${MAX_FILES} tracked files`, EXIT.validation)
  let total = 0
  const seen = new Set<string>()
  const files = entries.map(entry => {
    const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40,64}) +([0-9]+|-)\t([\s\S]+)$/.exec(entry)
    if (!match) throw new CliError('Invalid Git tree entry', EXIT.validation)
    const [, mode, type, oid, sizeText, treePath] = match
    if (type !== 'blob' || !['100644', '100755'].includes(mode ?? '')) throw new CliError('Git skills cannot contain symlinks or submodules', EXIT.validation)
    if (!treePath) throw new CliError('Invalid Git file path', EXIT.validation)
    const relative = subdir === '.' ? treePath : treePath.startsWith(subdir + '/') ? treePath.slice(subdir.length + 1) : ''
    if (!relative || (containsControl(relative) || /[\\:]/.test(relative)) || relative.split('/').some(part => !part || part === '.' || part === '..' || protectedPart(part))) throw new CliError('Unsafe tracked Git file path', EXIT.validation)
    if (relative.toLowerCase() === '.skillhub-source.json') throw new CliError('Repository contains reserved .skillhub-source.json provenance', EXIT.validation)
    const key = relative.normalize('NFC').toLowerCase()
    if (seen.has(key)) throw new CliError('Git files collide on case-insensitive filesystems', EXIT.validation)
    seen.add(key)
    const size = Number(sizeText)
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new CliError('Git skill file exceeds 10 MiB', EXIT.validation)
    total += size
    if (total > MAX_TOTAL_BYTES) throw new CliError('Git skill exceeds 100 MiB total content', EXIT.validation)
    return { relative, oid: oid as string, size }
  })
  if (!files.some(file => file.relative === 'SKILL.md')) throw new CliError('Selected Git directory must contain a tracked root SKILL.md', EXIT.validation)
  // Preflight all tree entries before writing; destination must not already exist.
  await mkdir(outputDirectory, { recursive: false, mode: 0o700 })
  try {
    for (const file of files) {
      const destination = resolve(outputDirectory, file.relative)
      if (!destination.startsWith(resolve(outputDirectory) + sep)) throw new CliError('Unsafe Git snapshot destination', EXIT.validation)
      const body = await runGit(['cat-file', 'blob', file.oid], gitDirectory, Math.max(file.size, 1))
      if (body.length !== file.size) throw new CliError('Git blob size differs from locked tree', EXIT.validation)
      const prefix = body.subarray(0, 80).toString('utf8')
      if (prefix.startsWith('version https://git-lfs.github.com/spec/v1\n') || prefix.startsWith('version https://git-lfs.github.com/spec/v1\r\n')) throw new CliError('Git LFS pointer files are not supported; publish a local directory containing the actual resource bytes', EXIT.validation)
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await writeFile(destination, body, { flag: 'wx', mode: 0o600 })
    }
  } catch (error) { await rm(outputDirectory, { recursive: true, force: true }); throw error }
}

/** Materialize a public HTTPS Git ref into a fixed tracked-file snapshot.
 * DNS filtering protects this client import from obvious private hosts; it is not
 * a server SSRF boundary. Server reuse requires DNS pinning and an egress policy.
 */
export async function materializeGitSource(input: GitSourceInput): Promise<GitSourceSnapshot> {
  const source = validateGitSource(input)
  const addresses = await lookup(new URL(source.repository).hostname, { all: true }).catch(() => { throw new CliError('Cannot resolve the Git repository host', EXIT.network) })
  if (!addresses.length || addresses.some(item => !allowedGitAddress(new URL(source.repository).hostname, item.address))) throw new CliError('Git repository must resolve only to public network addresses', EXIT.validation)
  const temporary = await mkdtemp(join(tmpdir(), 'skillhub-git-')).catch(() => { throw new CliError('Cannot create the temporary Git snapshot directory', EXIT.filesystem) })
  const gitDirectory = join(temporary, 'repository.git')
  const directory = join(temporary, 'snapshot')
  const cleanup = () => rm(temporary, { recursive: true, force: true })
  try {
    await mkdir(gitDirectory, { mode: 0o700 })
    await runGit(['init', '--bare', '--template=', '.'], gitDirectory)
    await runGit(['fetch', '--depth=1', '--no-tags', '--no-recurse-submodules', '--', source.repository, source.requestedRef], gitDirectory, MAX_TREE_BYTES, true)
    if (await directoryBytes(gitDirectory) > MAX_REPOSITORY_BYTES) throw new CliError('Git repository exceeds the download size limit', EXIT.validation)
    const commit = (await runGit(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], gitDirectory)).toString('ascii').trim()
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit)) throw new CliError('Cannot resolve Git ref to a full commit', EXIT.validation)
    await exportTrackedGitSnapshot({ gitDirectory, commit, subdir: source.subdir, outputDirectory: directory })
    return { directory, source: { ...source, commit }, cleanup }
  } catch (error) {
    await cleanup().catch(() => {})
    if (error instanceof CliError) throw error
    throw new CliError('Cannot materialize the Git snapshot; check temporary filesystem access', EXIT.filesystem)
  }
}
