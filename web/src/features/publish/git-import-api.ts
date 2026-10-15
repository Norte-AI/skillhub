import { useQuery } from '@tanstack/react-query'
import { gitImportApi } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type GitImportPreview = components['schemas']['GitImportResponse']
export type GitImportInput = components['schemas']['GitImportRequest']

export async function importGitSkill(input: GitImportInput): Promise<GitImportPreview> {
  return gitImportApi.prepare(input)
}

export function gitPreviewFile(preview: GitImportPreview): File {
  const bytes = Uint8Array.from(atob(preview.packageBase64!), char => char.charCodeAt(0))
  return new File([bytes], `${preview.name || 'git-skill'}.zip`, { type: 'application/zip' })
}

export function useGitImportOptions() {
  return useQuery({ queryKey: ['git-import-options'], queryFn: gitImportApi.options, staleTime: 60_000 })
}
