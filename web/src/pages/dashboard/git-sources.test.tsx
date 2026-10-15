/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), sync: vi.fn(), update: vi.fn(), remove: vi.fn(), webhookSecret: vi.fn() }))
vi.mock('@/api/client', () => ({ gitSourcesApi: mocks, buildApiUrl: (path: string) => path }))
vi.mock('react-i18next', async () => ({ ...await vi.importActual<typeof import('react-i18next')>('react-i18next'), useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/features/publish/git-import-api', () => ({ useGitImportOptions: () => ({ data: { automaticSyncEnabled: false, providers: [{host: 'github.com'}], credentials: [{id:'team',repository:'https://gitlab.com/team/skills'}] } }) }))
vi.mock('@/shared/hooks/use-namespace-queries', () => ({ useMyNamespaces: () => ({ data: [{ slug: 'team', displayName: 'Team' }] }) }))
import { GitSourcesPage } from './git-sources'
const source={id:'source-1',repository:'https://github.com/a/b',ref:'main',subdir:'.',namespace:'team',visibility:'PUBLIC',enabled:true,autoSync:false,lastStatus:'UNCHANGED'}
function setup() { const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return render(<QueryClientProvider client={client}><GitSourcesPage /></QueryClientProvider>) }
describe('GitSourcesPage', () => {
 afterEach(cleanup)
 beforeEach(() => { for(const mock of Object.values(mocks))mock.mockReset();mocks.list.mockResolvedValue([source]);mocks.create.mockResolvedValue(source);mocks.sync.mockResolvedValue({...source,lastStatus:'SCANNING'});mocks.update.mockResolvedValue(source);mocks.remove.mockResolvedValue(undefined);mocks.webhookSecret.mockResolvedValue({url:'/api/v1/git-source-hooks/source-1',header:'X-Gitlab-Token',secret:'one-time-secret'}) })
 it('creates without publishing and keeps disabled automatic checking explicit', async () => {
  setup();await screen.findByText(source.repository)
  expect(screen.getAllByRole('checkbox').every(input=>input.hasAttribute('disabled'))).toBe(true)
  fireEvent.change(screen.getByLabelText('publish.git.repository'),{target:{value:'https://gitlab.com/team/skills'}})
  fireEvent.change(screen.getByLabelText('publish.namespace'),{target:{value:'team'}})
  fireEvent.change(screen.getByLabelText('gitSources.credential'),{target:{value:'team'}})
  fireEvent.click(screen.getByRole('button',{name:'gitSources.save'}))
  await waitFor(()=>expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({namespace:'team',credentialId:'team',autoSync:false})))
  expect(mocks.sync).not.toHaveBeenCalled()
 })
 it('syncs a saved source and can pause without deleting published versions', async () => {
  setup();fireEvent.click(await screen.findByRole('button',{name:'gitSources.sync'}))
  await waitFor(()=>expect(mocks.sync).toHaveBeenCalledWith('source-1'))
  await screen.findByText('gitSources.syncFinished')
  fireEvent.click(screen.getByRole('button',{name:'gitSources.pause'}))
  await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith('source-1',{enabled:false,autoSync:false}))
  expect(mocks.remove).not.toHaveBeenCalled()
 })
 it('requires confirmation before rotating a webhook and keeps the secret out of the list', async () => {
  setup();await screen.findByText(source.repository)
  expect(screen.queryByText('one-time-secret')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'gitSources.webhook'}))
  expect(mocks.webhookSecret).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'gitSources.generateSecret'}))
  await screen.findByText('one-time-secret')
  fireEvent.click(screen.getByRole('button',{name:'gitSources.hideSecret'}))
  expect(screen.queryByText('one-time-secret')).toBeNull()
 })
 it('shows a recoverable source load error', async () => {
  mocks.list.mockRejectedValueOnce(new Error('offline'));setup()
  await screen.findByText('gitSources.loadFailed')
  mocks.list.mockResolvedValue([source]);fireEvent.click(screen.getByRole('button',{name:'gitSources.retry'}))
  await screen.findByText(source.repository)
 })
})
