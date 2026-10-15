import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { components } from '@/api/generated/schema'
import { buildApiUrl, gitSourcesApi } from '@/api/client'
import { useGitImportOptions } from '@/features/publish/git-import-api'
import { useMyNamespaces } from '@/shared/hooks/use-namespace-queries'
import { DashboardPageHeader } from '@/shared/components/dashboard-page-header'
import { ConfirmDialog } from '@/shared/components/confirm-dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

type Source = components['schemas']['GitSourceResponse']
type Hook = components['schemas']['GitWebhookSecretResponse']
const selectClass = 'h-10 w-full rounded-md border border-border bg-background px-3 text-sm disabled:opacity-50'

export function GitSourcesPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const options = useGitImportOptions()
  const namespaces = useMyNamespaces()
  const sources = useQuery({ queryKey: ['git-sources'], queryFn: gitSourcesApi.list })
  const [repository, setRepository] = useState('')
  const [ref, setRef] = useState('HEAD')
  const [subdir, setSubdir] = useState('.')
  const [credentialId, setCredentialId] = useState('')
  const [namespace, setNamespace] = useState('')
  const [visibility, setVisibility] = useState('PUBLIC')
  const [autoSync, setAutoSync] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState<Source | null>(null)
  const [secret, setSecret] = useState<{ id: string; hook: Hook } | null>(null)
  const [rotating, setRotating] = useState<Source | null>(null)

  const action = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onMutate: () => { setError(''); setNotice('') },
    onSuccess: () => client.invalidateQueries({ queryKey: ['git-sources'] }),
    onError: cause => setError(cause instanceof Error ? cause.message : t('gitSources.failed')),
  })
  const busy = action.isPending
  const run = (operation: () => Promise<unknown>) => action.mutate(operation)
  const create = (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !repository.trim() || !namespace) return
    run(async () => {
      await gitSourcesApi.create({ repository: repository.trim(), ref: ref.trim() || 'HEAD', subdir: subdir.trim() || '.',
        namespace, visibility, autoSync, ...(credentialId ? { credentialId } : {}) })
      setRepository('')
      setNotice(t('gitSources.created'))
    })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 animate-fade-up">
      <DashboardPageHeader title={t('gitSources.title')} subtitle={t('gitSources.subtitle')}
        actions={<Link to="/dashboard/publish" className="shrink-0 whitespace-nowrap text-sm text-primary underline underline-offset-4">{t('gitSources.publishOnce')}</Link>} />
      <form onSubmit={create} className="space-y-5 rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold">{t('gitSources.add')}</h2>
        <p className="text-sm text-muted-foreground">{t('gitSources.createHelp')}</p>
        <fieldset disabled={busy} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="source-repository">{t('publish.git.repository')}</Label>
            <Input id="source-repository" type="url" maxLength={2048} required autoComplete="off" spellCheck={false}
              value={repository} onChange={event => setRepository(event.target.value)} placeholder="https://gitlab.com/team/skills" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="source-ref">{t('publish.git.ref')}</Label>
              <Input id="source-ref" maxLength={256} value={ref} onChange={event => setRef(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="source-subdir">{t('publish.git.subdir')}</Label>
              <Input id="source-subdir" maxLength={1024} value={subdir} onChange={event => setSubdir(event.target.value)} /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="source-namespace">{t('publish.namespace')}</Label>
              <select id="source-namespace" className={selectClass} required value={namespace} onChange={event => setNamespace(event.target.value)}>
                <option value="">{t('publish.selectNamespace')}</option>
                {namespaces.data?.map(item => <option key={item.slug} value={item.slug}>{item.displayName} (@{item.slug})</option>)}
              </select></div>
            <div className="space-y-2"><Label htmlFor="source-visibility">{t('publish.visibility')}</Label>
              <select id="source-visibility" className={selectClass} value={visibility} onChange={event => setVisibility(event.target.value)}>
                <option value="PUBLIC">{t('publish.visibilityOptions.public')}</option>
                <option value="PRIVATE">{t('publish.visibilityOptions.private')}</option>
                <option value="NAMESPACE_ONLY">{t('publish.visibilityOptions.namespaceOnly')}</option>
              </select></div>
          </div>
          <div className="space-y-2"><Label htmlFor="source-credential">{t('gitSources.credential')}</Label>
            <select id="source-credential" className={selectClass} value={credentialId} onChange={event => setCredentialId(event.target.value)}>
              <option value="">{t('gitSources.anonymous')}</option>
              {options.data?.credentials?.map(item => <option key={item.id} value={item.id}>{item.id} — {item.repository}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">{t('gitSources.credentialHelp')}</p>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoSync}
            disabled={!options.data?.automaticSyncEnabled} onChange={event => setAutoSync(event.target.checked)} />{t('gitSources.autoSync')}</label>
          {!options.data?.automaticSyncEnabled && <p className="text-xs text-muted-foreground">{t('gitSources.autoDisabled')}</p>}
          {options.data?.providers && <p className="text-xs text-muted-foreground">{t('gitSources.hosts')}: {options.data.providers.map(item => item.host).join(', ')}</p>}
          <Button type="submit" disabled={busy || !repository.trim() || !namespace}>{t(busy ? 'gitSources.working' : 'gitSources.save')}</Button>
        </fieldset>
      </form>
      {error && <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      <section aria-label={t('gitSources.saved')} className="space-y-4">
        <h2 className="text-lg font-semibold">{t('gitSources.saved')}</h2>
        {sources.isLoading && <p role="status" className="text-sm text-muted-foreground">{t('gitSources.loading')}</p>}
        {sources.isError && <div role="alert"><p className="text-sm text-destructive">{t('gitSources.loadFailed')}</p><Button variant="outline" onClick={() => sources.refetch()}>{t('gitSources.retry')}</Button></div>}
        {sources.data?.length === 0 && <p className="py-8 text-sm text-muted-foreground">{t('gitSources.empty')}</p>}
        {sources.data?.map(source => (
          <article key={source.id} className="space-y-4 border-t border-border py-5">
            <div className="space-y-1">
              <h3 className="break-all font-semibold">{source.repository}</h3>
              <p className="break-words text-sm text-muted-foreground">@{source.namespace} · {source.ref} · {source.subdir}</p>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">{t('gitSources.status')}</dt><dd>{source.lastStatus ? t(`gitSources.states.${source.lastStatus}`, { defaultValue: source.lastStatus }) : t('gitSources.neverSynced')}</dd></div>
              <div><dt className="text-muted-foreground">{t('gitSources.lastVersion')}</dt><dd>{source.lastVersion || '—'}</dd></div>
              {source.lastCommit && <div className="sm:col-span-2"><dt className="text-muted-foreground">{t('publish.git.commit')}</dt><dd className="break-all font-mono text-xs">{source.lastCommit}</dd></div>}
              <div><dt className="text-muted-foreground">{t('gitSources.checked')}</dt><dd>{source.lastCheckedAt ? new Date(source.lastCheckedAt).toLocaleString() : '—'}</dd></div>
            </dl>
            {source.lastError && <p className="whitespace-pre-wrap break-words text-sm text-destructive">{source.lastError}</p>}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" disabled={busy || !source.enabled} onClick={() => run(async () => {
                const result = await gitSourcesApi.sync(source.id!)
                setNotice(result.lastStatus === 'FAILED' ? t('gitSources.syncFailed') : t('gitSources.syncFinished'))
              })}>{t('gitSources.sync')}</Button>
              <Button variant="outline" disabled={busy} onClick={() => run(() => gitSourcesApi.update(source.id!, { enabled: !source.enabled, autoSync: !!source.autoSync }))}>{t(source.enabled ? 'gitSources.pause' : 'gitSources.resume')}</Button>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!source.autoSync}
                disabled={busy || !options.data?.automaticSyncEnabled} onChange={event => run(() => gitSourcesApi.update(source.id!, { enabled: !!source.enabled, autoSync: event.target.checked }))} />{t('gitSources.autoSync')}</label>
              <Button variant="outline" disabled={busy} onClick={() => setRotating(source)}>{t('gitSources.webhook')}</Button>
              <Button variant="outline" disabled={busy} onClick={() => setDeleting(source)}>{t('gitSources.delete')}</Button>
            </div>
          </article>
        ))}
      </section>
      {secret && <section aria-label={t('gitSources.webhook')} className="space-y-3 rounded-xl border border-border p-5">
        <h2 className="font-semibold">{t('gitSources.webhook')}</h2>
        <p className="text-sm text-muted-foreground">{t('gitSources.secretHelp')}</p>
        <dl className="space-y-3 text-sm">
          <div><dt>{t('gitSources.hookUrl')}</dt><dd className="break-all font-mono text-xs">{new URL(buildApiUrl(secret.hook.url || '/'), window.location.origin).href}</dd></div>
          <div><dt>{t('gitSources.hookHeader')}</dt><dd className="break-all font-mono text-xs">{secret.hook.header}</dd></div>
          <div><dt>{t('gitSources.hookSecret')}</dt><dd className="break-all font-mono text-xs">{secret.hook.secret}</dd></div>
        </dl>
        <Button variant="outline" onClick={() => setSecret(null)}>{t('gitSources.hideSecret')}</Button>
      </section>}
      <p className="text-sm text-muted-foreground">{t('gitSources.versionHelp')}</p>
      <ConfirmDialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null) }} title={t('gitSources.delete')}
        description={t('gitSources.deleteHelp')} confirmText={t('gitSources.delete')} variant="destructive"
        onConfirm={() => { if (deleting?.id) run(async () => { await gitSourcesApi.remove(deleting.id!); if (secret?.id === deleting.id) setSecret(null); setDeleting(null) }) }} />
      <ConfirmDialog open={!!rotating} onOpenChange={open => { if (!open) setRotating(null) }} title={t('gitSources.webhook')}
        description={t('gitSources.rotateHelp')} confirmText={t('gitSources.generateSecret')}
        onConfirm={() => { if (rotating?.id) run(async () => { const hook = await gitSourcesApi.webhookSecret(rotating.id!); setSecret({ id: rotating.id!, hook }); setRotating(null) }) }} />
    </div>
  )
}
