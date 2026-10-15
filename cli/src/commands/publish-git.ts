import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { materializeGitSource } from '../services/git-source'
import { publishCommand, type PublishCommandOptions } from './publish'

export interface PublishGitCommandOptions extends PublishCommandOptions {
  ref?: string
  subdir?: string
}

export interface PublishGitCommandDeps {
  materialize?: typeof materializeGitSource
  publish?: typeof publishCommand
}

/** Git is an input source: publication still uses the ordinary registry workflow. */
export async function publishGitCommand(
  repository: string,
  options: PublishGitCommandOptions,
  deps: PublishGitCommandDeps = {}
): Promise<string> {
  const materialize = deps.materialize ?? materializeGitSource
  const publish = deps.publish ?? publishCommand
  const { ref, subdir, ...publishOptions } = options
  const snapshot = await materialize({
    repository,
    ...(ref === undefined ? {} : { ref }),
    ...(subdir === undefined ? {} : { subdir })
  })
  try {
    const source = { schemaVersion: 1, ...snapshot.source }
    // Never overwrite repository-authored provenance, including a racing file creation.
    await writeFile(join(snapshot.directory, '.skillhub-source.json'), JSON.stringify(source, null, 2) + '\n', { flag: 'wx' })
    const result = await publish(snapshot.directory, publishOptions)
    if (options.json) {
      const response: unknown = JSON.parse(result)
      if (!response || typeof response !== 'object' || Array.isArray(response)) {
        throw new Error('Invalid registry publication response')
      }
      return JSON.stringify({ ...response, source })
    }
    return [result, `Source: ${source.repository}`, `Commit: ${source.commit}`, `Ref: ${source.requestedRef}`, `Subdirectory: ${source.subdir}`].join('\n')
  } finally {
    await snapshot.cleanup()
  }
}
