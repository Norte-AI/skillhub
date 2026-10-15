import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { runtimeApi } from '@/api/client'
import { Button } from '@/shared/ui/button'

export function ImportToRuntimeButton({ namespace, slug, version }: { namespace: string; slug: string; version: string }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [contentId, setContentId] = useState('')
  const [error, setError] = useState('')
  const importSkill = async () => {
    if (pending) return
    setPending(true); setError('')
    try { const result = await runtimeApi.importSkill({ namespace, slug, version }); if (!result.contentId) throw new Error(t('runtime.importFailed')); setContentId(result.contentId) }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('runtime.importFailed')) }
    finally { setPending(false) }
  }
  return <div className="space-y-2">
    <Button className="w-full" variant="outline" onClick={importSkill} disabled={pending || !version}>{t(pending ? 'runtime.importing' : 'runtime.import')}</Button>
    {contentId && <div role="status" className="space-y-1 text-sm text-muted-foreground"><p>{t('runtime.imported')}: <code className="break-all">{contentId}</code></p><Link to="/dashboard/runtime" className="text-primary underline underline-offset-4">{t('runtime.importHelp')}</Link></div>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
  </div>
}
