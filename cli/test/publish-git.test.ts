import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { unzipSync } from 'fflate'
import { createZip } from '../src/platform/archive'
import { publishGitCommand } from '../src/commands/publish-git'
import type { materializeGitSource } from '../src/services/git-source'

const repository = 'https://example.com/team/skills.git'
const commit = 'a'.repeat(40)
async function snapshot() {
  const directory = await mkdtemp(join(tmpdir(), 'publish-git-command-'))
  await writeFile(join(directory, 'SKILL.md'), '---\nname: demo\ndescription: Demo\nversion: 1.0.0\n---\nDemo instructions\n')
  let cleaned = false
  return {
    directory,
    source: { repository, requestedRef: 'v1.0.0', commit, subdir: 'skills/demo' },
    cleanup: async () => { cleaned = true; await rm(directory, { recursive: true, force: true }) },
    isCleaned: () => cleaned
  }
}

describe('publish-git command preserves registry publication workflow', () => {
  test('packages root skill and pinned provenance, preserves pending status and forwards publication options', async () => {
    const fixture = await snapshot()
    let packaged: ReturnType<typeof unzipSync> | undefined
    const result = await publishGitCommand(repository, {
      ref: 'v1.0.0', subdir: 'skills/demo', namespace: 'team', visibility: 'private', registry: 'https://registry.example.com', token: 'test-token', json: true
    }, {
      materialize: async input => { expect(input).toEqual({ repository, ref: 'v1.0.0', subdir: 'skills/demo' }); return fixture },
      publish: async (directory, options) => {
        expect(options).toEqual({ namespace: 'team', visibility: 'private', registry: 'https://registry.example.com', token: 'test-token', json: true })
        const blob = await createZip(directory)
        packaged = unzipSync(new Uint8Array(await blob.arrayBuffer()))
        return JSON.stringify({ ok: true, action: 'submitted', status: 'PENDING_REVIEW', slug: 'demo' })
      }
    })
    expect(fixture.isCleaned()).toBe(true)
    await expect(access(fixture.directory)).rejects.toThrow()
    expect(Object.keys(packaged ?? {}).sort()).toEqual(['.skillhub-source.json', 'SKILL.md'])
    const source = JSON.parse(new TextDecoder().decode(packaged?.['.skillhub-source.json']))
    expect(source).toEqual({ schemaVersion: 1, ...fixture.source })
    expect(JSON.parse(result)).toEqual({ ok: true, action: 'submitted', status: 'PENDING_REVIEW', slug: 'demo', source })
    expect(result).not.toContain('test-token')
  })

  test('publication failure propagates and cleans temporary materialization', async () => {
    const fixture = await snapshot()
    await expect(publishGitCommand(repository, {}, {
      materialize: async () => fixture,
      publish: async () => { throw new Error('registry rejected the submission') }
    })).rejects.toThrow('registry rejected the submission')
    expect(fixture.isCleaned()).toBe(true)
    await expect(access(fixture.directory)).rejects.toThrow()
  })

  test('refuses provenance collision and does not call publish', async () => {
    const fixture = await snapshot()
    await writeFile(join(fixture.directory, '.skillhub-source.json'), 'repository-authored')
    let published = false
    await expect(publishGitCommand(repository, {}, {
      materialize: async () => fixture,
      publish: async () => { published = true; return '{}' }
    })).rejects.toThrow()
    expect(published).toBe(false)
    expect(fixture.isCleaned()).toBe(true)
  })

  test('dry-run passes through unchanged validation response with provenance and cleanup', async () => {
    const fixture = await snapshot()
    const result = await publishGitCommand(repository, { json: true, dryRun: true }, {
      materialize: async () => fixture,
      publish: async (directory, options) => {
        expect(options).toEqual({ json: true, dryRun: true })
        expect(JSON.parse(await readFile(join(directory, '.skillhub-source.json'), 'utf8')).commit).toBe(commit)
        return JSON.stringify({ valid: true, warnings: ['needs review'], resolvedSlug: 'demo' })
      }
    })
    expect(JSON.parse(result).ok).toBeUndefined()
    expect(JSON.parse(result).valid).toBe(true)
    expect(fixture.isCleaned()).toBe(true)
  })

  test('does not turn a returned failure into a success and cleans invalid response failures', async () => {
    const failed = await snapshot()
    const result = await publishGitCommand(repository, { json: true }, {
      materialize: async () => failed,
      publish: async () => JSON.stringify({ ok: false, status: 'REJECTED', error: 'policy rejection' })
    })
    expect(JSON.parse(result).ok).toBe(false)
    expect(JSON.parse(result).status).toBe('REJECTED')
    expect(failed.isCleaned()).toBe(true)
    const invalid = await snapshot()
    await expect(publishGitCommand(repository, { json: true }, {
      materialize: async () => invalid,
      publish: async () => '[]'
    })).rejects.toThrow('Invalid registry publication response')
    expect(invalid.isCleaned()).toBe(true)
  })

  test('source fetch failure never starts publication', async () => {
    let published = false
    const materialize: typeof materializeGitSource = async () => { throw new Error('Git source could not be fetched') }
    await expect(publishGitCommand(repository, {}, { materialize, publish: async () => { published = true; return '{}' } })).rejects.toThrow('Git source could not be fetched')
    expect(published).toBe(false)
  })
})
