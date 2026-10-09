import { db } from '../lib/db';
import { seed } from '../lib/seed';
seed(db());
console.log('Seeded. Logins: admin@example.com/admin123, manager@example.com/manager123, amina@example.com/employee123');
