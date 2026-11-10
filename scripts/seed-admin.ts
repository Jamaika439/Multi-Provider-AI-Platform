import { initUserTables, createUser } from '@/lib/db/users';

async function main() {
  console.log('Initialisiere Datenbank...');
  await initUserTables();
  console.log('Tabellen erstellt.');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@local.dev';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';
  const adminName = process.env.ADMIN_NAME || 'Admin';

  console.log(`Erstelle Admin: ${adminEmail}`);
  try {
    await createUser(adminEmail, adminPassword, adminName, 'admin');
    console.log('✅ Admin erfolgreich erstellt!');
    console.log(`   E-Mail: ${adminEmail}`);
    console.log(`   Passwort: ${adminPassword}`);
    console.log('');
    console.log('⚠️  Ändere das Passwort nach dem ersten Login!');
  } catch (e) {
    console.error('Fehler:', e);
  }
}

main().then(() => process.exit(0));