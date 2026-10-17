import { db } from './db.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run make-admin -- user@example.com');
  process.exitCode = 1;
} else {
  const result = db.prepare("update profiles set role = 'admin', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where email = ?").run(email);
  if (!result.changes) {
    console.error(`No Emberly account found for ${email}.`);
    process.exitCode = 1;
  } else {
    console.log(`Admin role granted to ${email}.`);
  }
}
