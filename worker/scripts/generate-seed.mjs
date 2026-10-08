import { randomBytes } from 'node:crypto';

const names = process.argv.slice(2);
if (!names.length) {
  console.error('Uso: node worker/scripts/generate-seed.mjs Ana Chintia Fabiano');
  process.exit(1);
}
for (const name of names) {
  const token = randomBytes(24).toString('base64url');
  const escaped = name.replaceAll("'", "''");
  console.log(`INSERT OR IGNORE INTO participants(name, access_token) VALUES ('${escaped}', '${token}');`);
}
