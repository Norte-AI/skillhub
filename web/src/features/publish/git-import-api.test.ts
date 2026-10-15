/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { importGitSkill } from './git-import-api'

vi.mock('@/i18n/config', () => ({ default: { resolvedLanguage: 'en', exists: () => false } }))

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; Path=/'
})

describe('Git import API', () => {
  it('submits the source using the session CSRF token', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-proof; Path=/'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { name: 'weather' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await importGitSkill({ repository: 'https://github.com/a/b', ref: 'main', subdir: '.' })).toEqual({ name: 'weather' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/web/skills/git-import')
    expect(new Headers(init.headers).get('X-XSRF-TOKEN')).toBe('csrf-proof')
    expect(JSON.parse(init.body)).toEqual({ repository: 'https://github.com/a/b', ref: 'main', subdir: '.' })
  })

  it('surfaces server validation failures for an actionable inline error', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-proof; Path=/'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 400, msg: 'No SKILL.md found' }), { status: 400 })))
    await expect(importGitSkill({ repository: 'https://github.com/a/b' })).rejects.toThrow('No SKILL.md found')
  })
})
