import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { gitPreviewFile, importGitSkill, type GitImportPreview } from './git-import-api'

interface GitImportPanelProps {
  disabled: boolean
  onFileSelect: (file: File | null) => void
  onBusyChange: (busy: boolean) => void
}

/** Editing the source invalidates the package; publishing always uses the previewed bytes. */
export function GitImportPanel({ disabled, onFileSelect, onBusyChange }: GitImportPanelProps) {
  const { t } = useTranslation()
  const [repository, setRepository] = useState('')
  const [ref, setRef] = useState('HEAD')
  const [subdir, setSubdir] = useState('.')
  const [preview, setPreview] = useState<GitImportPreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inFlight = useRef(false)

  const edit = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPreview(null)
    setError('')
    onFileSelect(null)
  }

  const prepare = async () => {
    if (inFlight.current || disabled) return
    inFlight.current = true
    setLoading(true)
    onBusyChange(true)
    setPreview(null)
    setError('')
    onFileSelect(null)
    try {
      const result = await importGitSkill({ repository: repository.trim(), ref: ref.trim() || 'HEAD', subdir: subdir.trim() || '.' })
      const file = gitPreviewFile(result)
      setPreview(result)
      onFileSelect(file)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('publish.git.failed'))
    } finally {
      inFlight.current = false
      setLoading(false)
      onBusyChange(false)
    }
  }

  return (
    <div className="space-y-4">
      <p id="git-import-help" className="text-sm text-muted-foreground">{t('publish.git.help')}</p>
      <div className="space-y-2">
        <Label htmlFor="git-repository">{t('publish.git.repository')}</Label>
        <Input id="git-repository" type="url" maxLength={2048} value={repository} placeholder="https://github.com/owner/repository"
          disabled={disabled || loading} aria-describedby="git-import-help" autoComplete="off" spellCheck={false}
          onChange={event => edit(setRepository, event.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="git-ref">{t('publish.git.ref')}</Label>
          <Input id="git-ref" maxLength={256} value={ref} disabled={disabled || loading} placeholder="HEAD" autoComplete="off" spellCheck={false}
            onChange={event => edit(setRef, event.target.value)} />
          <p className="text-xs text-muted-foreground">{t('publish.git.refHelp')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="git-subdir">{t('publish.git.subdir')}</Label>
          <Input id="git-subdir" maxLength={1024} value={subdir} disabled={disabled || loading} placeholder="skills/weather" autoComplete="off" spellCheck={false}
            onChange={event => edit(setSubdir, event.target.value)} />
          <p className="text-xs text-muted-foreground">{t('publish.git.subdirHelp')}</p>
        </div>
      </div>
      <Button type="button" variant="outline" onClick={prepare} disabled={disabled || loading || !repository.trim()}>
        {t(loading ? 'publish.git.preparing' : 'publish.git.prepare')}
      </Button>
      {loading && <p role="status" className="text-sm text-muted-foreground">{t('publish.git.wait')}</p>}
      {error && <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive">{error}</p>}
      {preview && (
        <section aria-label={t('publish.git.preview')} className="space-y-3 border-t border-border/60 pt-4">
          <div role="status">
            <h3 className="font-semibold text-foreground">{preview.name} <span className="font-normal text-muted-foreground">{preview.version || t('publish.git.defaultVersion')}</span></h3>
            <p className="mt-1 text-sm text-muted-foreground">{preview.description}</p>
          </div>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-muted-foreground">{t('publish.git.commit')}</dt><dd className="mt-1 break-all font-mono text-xs">{preview.source?.commit}</dd></div>
            <div><dt className="text-muted-foreground">{t('publish.git.contents')}</dt><dd>{t('publish.git.summary', { count: preview.files?.length ?? 0, size: ((preview.totalSize ?? 0) / 1024).toFixed(1) })}</dd></div>
          </dl>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t('publish.git.fileList')}</summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-auto pl-4">
              {preview.files?.map(path => <li key={path} className="break-all font-mono text-xs">{path}</li>)}
            </ul>
          </details>
          {!!preview.warnings?.length && <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          <p className="text-sm text-muted-foreground">{t('publish.git.ready')}</p>
        </section>
      )}
    </div>
  )
}
