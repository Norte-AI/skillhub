/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ importGitSkill: vi.fn() }))
vi.mock('./git-import-api', async () => ({ ...await vi.importActual<typeof import('./git-import-api')>('./git-import-api'), importGitSkill: mocks.importGitSkill, useGitImportOptions: () => ({ data: { providers: [{host: 'github.com'}], credentials: [{id: 'team-gitlab', repository: 'https://gitlab.com/team/skills'}] } }) }))
vi.mock('react-i18next', async () => ({ ...await vi.importActual<typeof import('react-i18next')>('react-i18next'), useTranslation: () => ({ t: (key: string) => key }) }))
import { GitImportPanel } from './git-import-panel'
const preview = { source: { repository: 'https://github.com/a/b.git', requestedRef: 'main', commit: 'a'.repeat(40), subdir: '.' }, name: 'weather', version: '1.0.0', description: 'Weather', files: ['SKILL.md', '.skillhub-source.json'], totalSize: 123, warnings: [], packageBase64: btoa('exact immutable zip') }

describe('GitImportPanel', () => {
  afterEach(cleanup)
  beforeEach(() => mocks.importGitSkill.mockReset())
  function setup() {
    const select = vi.fn(), busy = vi.fn()
    render(<GitImportPanel disabled={false} onFileSelect={select} onBusyChange={busy} />)
    fireEvent.change(screen.getByLabelText('publish.git.repository'), { target: { value: 'https://github.com/a/b' } })
    return { select, busy }
  }
  it('previews a fixed commit and returns the exact prepared package', async () => {
    mocks.importGitSkill.mockResolvedValue(preview)
    const { select, busy } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'publish.git.prepare' }))
    await screen.findByText('a'.repeat(40))
    expect(mocks.importGitSkill).toHaveBeenCalledWith({ repository: 'https://github.com/a/b', ref: 'HEAD', subdir: '.' })
    const file = select.mock.calls.at(-1)?.[0] as File
    expect(file.name).toBe('weather.zip')
    expect(file.size).toBe('exact immutable zip'.length)
    expect(busy.mock.calls).toEqual([[true], [false]])
  })
  it('passes an authorized credential alias and invalidates a preview when it changes', async () => {
    mocks.importGitSkill.mockResolvedValue(preview)
    const { select } = setup()
    fireEvent.change(screen.getByLabelText('gitSources.credential'), { target: { value: 'team-gitlab' } })
    fireEvent.click(screen.getByRole('button', { name: 'publish.git.prepare' }))
    await screen.findByText('a'.repeat(40))
    expect(mocks.importGitSkill).toHaveBeenCalledWith(expect.objectContaining({ credentialId: 'team-gitlab' }))
    fireEvent.change(screen.getByLabelText('gitSources.credential'), { target: { value: '' } })
    expect(select).toHaveBeenLastCalledWith(null)
  })

  it('invalidates the package when any source field changes', async () => {
    mocks.importGitSkill.mockResolvedValue(preview)
    const { select } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'publish.git.prepare' }))
    await screen.findByText('a'.repeat(40))
    fireEvent.change(screen.getByLabelText('publish.git.ref'), { target: { value: 'v2' } })
    expect(screen.queryByText('a'.repeat(40))).toBeNull()
    expect(select).toHaveBeenLastCalledWith(null)
  })
  it('shows a recoverable error and does not leave a publishable file', async () => {
    mocks.importGitSkill.mockRejectedValueOnce(new Error('No SKILL.md found')).mockResolvedValueOnce(preview)
    const { select } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'publish.git.prepare' }))
    expect((await screen.findByRole('alert')).textContent).toContain('No SKILL.md')
    expect(select).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: 'publish.git.prepare' }))
    await screen.findByText('a'.repeat(40))
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('prevents duplicate import requests while preparing', async () => {
    let complete!: (value: typeof preview) => void
    mocks.importGitSkill.mockReturnValue(new Promise(resolve => { complete = resolve }))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'publish.git.prepare' }))
    fireEvent.click(screen.getByRole('button', { name: 'publish.git.preparing' }))
    expect(mocks.importGitSkill).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('publish.git.ref').hasAttribute('disabled')).toBe(true)
    complete(preview)
    await waitFor(() => expect(screen.queryByText('publish.git.wait')).toBeNull())
  })
})
