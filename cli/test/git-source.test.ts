import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { access, chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowedGitAddress, exportTrackedGitSnapshot, validateGitSource } from '../src/services/git-source'
const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'skillhub-git-test-')); temporary.push(root)
  const directory = join(root, 'repository'); await mkdir(directory)
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=SkillHub Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: directory, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '--quiet', '--template=')
  return { directory, output: join(root, 'snapshot'), git }
}
async function commitFile(f: Awaited<ReturnType<typeof fixture>>, path: string, body: string) {
  const file = join(f.directory, path); await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, body)
  f.git('add', '--', path); f.git('commit', '--quiet', '-m', 'fixture'); return f.git('rev-parse', 'HEAD')
}
describe('public Git source validation', () => {
  test('accepts HTTPS branches tags commits and safe selected directory', () => {
    expect(validateGitSource({ repository: 'https://github.com/example/skills.git' })).toEqual({ repository: 'https://github.com/example/skills.git', requestedRef: 'HEAD', subdir: '.' })
    expect(validateGitSource({ repository: 'https://gitlab.com/team/skills', ref: 'release/v1.0.0', subdir: 'skills/writing' }).subdir).toBe('skills/writing')
    expect(validateGitSource({ repository: 'https://example.com/repo.git', ref: 'a'.repeat(40) }).requestedRef).toBe('a'.repeat(40))
  })
  test('allows provider VPN fake-IP routing only for exact trusted HTTPS hosts', () => {
    expect(allowedGitAddress('github.com', '198.18.0.156')).toBe(true)
    expect(allowedGitAddress('gitlab.com', '198.19.255.254')).toBe(true)
    for (const host of ['example.com', 'github.com.attacker.example', 'raw.githubusercontent.com']) expect(allowedGitAddress(host, '198.18.0.156')).toBe(false)
    for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.2', '198.51.100.1']) expect(allowedGitAddress('github.com', address)).toBe(false)
    expect(allowedGitAddress('github.com', '140.82.112.3')).toBe(true)
  })
  test('rejects credentials local/private transports unsafe refs and traversal', () => {
    for (const repository of ['file:///tmp/repo', 'ssh://git@github.com/x/y', 'https://user:secret@github.com/x/y', 'https://github.com/x/y?token=secret', 'https://github.com/x/y#ref', 'https://127.0.0.1/repo', 'https://10.0.0.1/repo', 'https://[::1]/repo', 'https://localhost/repo', 'https://server.internal/repo', 'https://example.com:8443/repo']) expect(() => validateGitSource({ repository })).toThrow()
    for (const ref of ['--upload-pack=evil', 'HEAD~1', 'main:other', '../branch', 'refs//heads/main', 'main\narg', 'tag.lock']) expect(() => validateGitSource({ repository: 'https://github.com/a/b', ref })).toThrow()
    for (const subdir of ['../outside', '/absolute', 'a/../b', 'a\\b', '.git', 'a/.GIT./b', 'a//b', 'a/./b']) expect(() => validateGitSource({ repository: 'https://github.com/a/b', subdir })).toThrow()
  })
})
describe('tracked immutable Git snapshot export', () => {
  test('selected tracked files stay pinned and never run checkout hooks', async () => {
    const f = await fixture(); await commitFile(f, 'README.md', 'not selected')
    const commit = await commitFile(f, 'skills/demo/SKILL.md', 'pinned instructions')
    await writeFile(join(f.directory, 'skills/demo/untracked.txt'), 'untracked secret')
    await writeFile(join(f.directory, 'skills/demo/SKILL.md'), 'working tree changed')
    const marker = join(f.directory, 'executed')
    await mkdir(join(f.directory, '.git/hooks'), { recursive: true })
    await writeFile(join(f.directory, '.git/hooks/post-checkout'), `#!/bin/sh\ntouch '${marker}'\n`)
    await chmod(join(f.directory, '.git/hooks/post-checkout'), 0o755)
    f.git('config', 'filter.evil.smudge', `touch '${marker}'`)
    await exportTrackedGitSnapshot({ gitDirectory: f.directory, commit, subdir: 'skills/demo', outputDirectory: f.output })
    expect(await readFile(join(f.output, 'SKILL.md'), 'utf8')).toBe('pinned instructions')
    for (const path of ['untracked.txt', 'README.md', '.git']) await expect(access(join(f.output, path))).rejects.toThrow()
    await expect(access(marker)).rejects.toThrow()
  })
  test('rejects symlinks and gitlinks before writing output', async () => {
    const linked = await fixture(); await commitFile(linked, 'SKILL.md', 'instructions')
    await symlink('/etc/passwd', join(linked.directory, 'link.txt')); linked.git('add', 'link.txt'); linked.git('commit', '--quiet', '-m', 'symlink')
    await expect(exportTrackedGitSnapshot({ gitDirectory: linked.directory, commit: linked.git('rev-parse', 'HEAD'), outputDirectory: linked.output })).rejects.toThrow('symlinks or submodules')
    await expect(access(linked.output)).rejects.toThrow()
    const submodule = await fixture(); const first = await commitFile(submodule, 'SKILL.md', 'instructions')
    submodule.git('update-index', '--add', '--cacheinfo', `160000,${first},nested`); submodule.git('commit', '--quiet', '-m', 'gitlink')
    await expect(exportTrackedGitSnapshot({ gitDirectory: submodule.directory, commit: submodule.git('rev-parse', 'HEAD'), outputDirectory: submodule.output })).rejects.toThrow('symlinks or submodules')
  })
  test('rejects missing SKILL.md provenance injection and oversize files', async () => {
    const f = await fixture(); await commitFile(f, 'README.md', 'no skill')
    await expect(exportTrackedGitSnapshot({ gitDirectory: f.directory, commit: f.git('rev-parse', 'HEAD'), outputDirectory: f.output })).rejects.toThrow('root SKILL.md')
    await commitFile(f, 'SKILL.md', 'instructions'); const injected = await commitFile(f, '.skillhub-source.json', '{"commit":"untrusted"}')
    await expect(exportTrackedGitSnapshot({ gitDirectory: f.directory, commit: injected, outputDirectory: f.output })).rejects.toThrow('reserved')
    f.git('rm', '.skillhub-source.json'); f.git('commit', '--quiet', '-m', 'remove provenance')
    await writeFile(join(f.directory, 'big.txt'), Buffer.alloc(10 * 1024 * 1024 + 1)); f.git('add', 'big.txt'); f.git('commit', '--quiet', '-m', 'oversized')
    await expect(exportTrackedGitSnapshot({ gitDirectory: f.directory, commit: f.git('rev-parse', 'HEAD'), outputDirectory: f.output })).rejects.toThrow('10 MiB')
  })
  test('rejects case collisions and unsafe commit selectors', async () => {
    const f = await fixture(); const commit = await commitFile(f, 'SKILL.md', 'instructions'); const blob = f.git('rev-parse', 'HEAD:SKILL.md')
    f.git('update-index', '--add', '--cacheinfo', `100644,${blob},case.md`); f.git('update-index', '--add', '--cacheinfo', `100644,${blob},CASE.md`); f.git('commit', '--quiet', '-m', 'case collision')
    await expect(exportTrackedGitSnapshot({ gitDirectory: f.directory, commit: f.git('rev-parse', 'HEAD'), outputDirectory: f.output })).rejects.toThrow('collide')
    await expect(exportTrackedGitSnapshot({ gitDirectory: f.directory, commit: 'HEAD; touch /tmp/evil', outputDirectory: f.output })).rejects.toThrow('full immutable')
    expect(commit).toMatch(/^[a-f0-9]{40}$/)
  })
  test('enforces tracked file count and aggregate content limits before export', async () => {
    const many = await fixture(); await commitFile(many, 'SKILL.md', 'instructions')
    const smallBlob = many.git('rev-parse', 'HEAD:SKILL.md')
    execFileSync('git', ['update-index', '--add', '--index-info'], { cwd: many.directory, input: Array.from({ length: 499 }, (_, n) => `100644 ${smallBlob}\tfile-${n}.md\n`).join('') })
    many.git('commit', '--quiet', '-m', 'file count limit')
    await expect(exportTrackedGitSnapshot({ gitDirectory: many.directory, commit: many.git('rev-parse', 'HEAD'), outputDirectory: many.output })).rejects.toThrow('499 tracked files')
    const aggregate = await fixture(); await commitFile(aggregate, 'SKILL.md', 'instructions')
    const largeBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: aggregate.directory, input: Buffer.alloc(10 * 1024 * 1024), encoding: 'utf8' }).trim()
    execFileSync('git', ['update-index', '--add', '--index-info'], { cwd: aggregate.directory, input: Array.from({ length: 11 }, (_, n) => `100644 ${largeBlob}\tlarge-${n}.txt\n`).join('') })
    aggregate.git('commit', '--quiet', '-m', 'aggregate limit')
    await expect(exportTrackedGitSnapshot({ gitDirectory: aggregate.directory, commit: aggregate.git('rev-parse', 'HEAD'), outputDirectory: aggregate.output })).rejects.toThrow('100 MiB total')
    await expect(access(aggregate.output)).rejects.toThrow()
  })

  test('rejects tracked Git LFS pointers and removes the partial snapshot', async () => {
    const f = await fixture(); await commitFile(f, 'SKILL.md', 'instructions')
    const commit = await commitFile(f, 'resource.txt', 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 123\n')
    await expect(exportTrackedGitSnapshot({ gitDirectory: f.directory, commit, outputDirectory: f.output })).rejects.toThrow('Git LFS pointer files are not supported')
    await expect(access(f.output)).rejects.toThrow()
  })

})
