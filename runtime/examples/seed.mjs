import { resolve } from 'node:path';
import { createStore } from '../packages/storage/index.mjs';
const store = createStore({ databaseUrl: process.env.SKILLHUB_DATABASE_URL, dataDir: resolve(process.env.SKILLHUB_DATA_DIR || '.skillhub-data') });
await store.init();
try {
if ((await store.listReleases('personal')).some(item => item.version === '1.0.0')) {
  try { await store.getListing('personal'); }
  catch { await store.publishListing({ bundleId: 'personal', releaseId: 'personal@1.0.0' }); }
  console.log('personal 1.0.0 already exists; release preserved and listing initialized if missing');
} else {
  await store.saveContent({ id: 'collaboration.confirmation', kind: 'rule', title: '确认后的执行规则', body: '用户确认目标和步骤后，直接执行已确认范围内的工作。' });
  await store.saveContent({ id: 'review.summary', kind: 'skill', title: '方案审查', body: '检查目标、依赖、风险和验收条件，按用户要求给出简洁结论。' });
  await store.saveBundle({ id: 'personal', name: '个人协作规范', description: '用于本地验证的示例规则包，尚未验证真实客户端注入。', items: ['collaboration.confirmation', 'review.summary'], tags: ['协作'], targets: ['codex', 'kimi', 'zcode'] });
  const release = await store.buildRelease('personal', '1.0.0');
  await store.setChannel('personal', 'stable', release.id);
  await store.publishListing({ bundleId: 'personal', releaseId: release.id });
  console.log(`Published local example: ${release.id}`);
}

} finally { await store.close(); }
