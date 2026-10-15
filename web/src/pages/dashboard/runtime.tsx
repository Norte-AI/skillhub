import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { buildApiUrl } from '@/api/client'
import { DashboardPageHeader } from '@/shared/components/dashboard-page-header'
import { Button } from '@/shared/ui/button'

/** Runtime is a first-party module behind the same session and platform authorization. */
export function RuntimePage() {
  const { t } = useTranslation()
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  return <div className="space-y-5">
    <DashboardPageHeader title={t('runtime.title')} subtitle={t('runtime.subtitle')} actions={<Button variant="outline" onClick={() => { setLoading(true); setRevision(value => value + 1) }}>{t('runtime.reload')}</Button>} />
    {loading && <p role="status" className="text-sm text-muted-foreground">{t('runtime.loading')}</p>}
    <p className="text-sm text-muted-foreground">{t('runtime.help')}</p>
    <iframe key={revision} src={buildApiUrl('/api/web/runtime/')} title={t('runtime.title')} onLoad={() => setLoading(false)}
      className="min-h-[900px] w-full rounded-xl border border-border bg-background" sandbox="allow-scripts allow-same-origin allow-downloads" />
  </div>
}
