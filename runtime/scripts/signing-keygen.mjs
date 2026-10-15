import { mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateSigningKeyPair } from '../packages/signing/index.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out' || !args[1] || args[1].startsWith('--')) throw new Error('Usage: node scripts/signing-keygen.mjs --out <new-directory>');
  const directory = resolve(args[1]);
  // Require a new directory so existing keys and symlink destinations are never reused.
  try { await lstat(directory); throw new Error('Output directory already exists; choose a new directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(directory, { mode: 0o700 });
  const key = generateSigningKeyPair();
  await writeFile(join(directory, 'private.pem'), key.privateKey, { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'public.pem'), key.publicKey, { flag: 'wx', mode: 0o644 });
  await writeFile(join(directory, 'trusted-keys.json'), JSON.stringify({ [key.keyId]: key.publicKey }, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
  console.log(JSON.stringify({ keyId: key.keyId, directory, privateKey: join(directory, 'private.pem'), trustedKeys: join(directory, 'trusted-keys.json') }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
