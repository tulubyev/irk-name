#!/usr/bin/env node
// Генерирует ADMIN_PASSWORD_HASH. Пароль вводится в терминале и нигде не сохраняется.
//   node hash-password.mjs            (спросит пароль)
//   docker compose run --rm admin node hash-password.mjs
import { scryptSync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
rl.stdoutMuted = true;
rl._writeToOutput = (s) => { if (!rl.stdoutMuted || s.includes('Пароль')) process.stderr.write(s); };
rl.question('Пароль администратора (не менее 12 символов): ', (password) => {
  rl.close();
  process.stderr.write('\n');
  if (password.length < 12) { console.error('Слишком короткий пароль.'); process.exit(1); }
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N, r, p });
  console.log(`ADMIN_PASSWORD_HASH=${['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join(':')}`);
});
