// scripts/run-permit-type-migration.js
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

async function runSql(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/execute_sql`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return res.json().catch(() => null);
}

const sqls = [
  `ALTER TABLE permits ADD COLUMN IF NOT EXISTS permit_type text`,
  `UPDATE permits SET status = 'beviljat' WHERE status IS NULL AND kommun IN ('Danderyd','Ekerö','Huddinge','Knivsta','Nacka','Sollentuna','Upplands-Bro','Upplands Väsby')`,
  `UPDATE permits SET permit_type = 'rivningslov' WHERE permit_type IS NULL AND (atgard ILIKE '%rivningslov%' OR atgard ILIKE '%rivning av%')`,
  `UPDATE permits SET permit_type = 'marklov' WHERE permit_type IS NULL AND (atgard ILIKE '%marklov%' OR atgard ILIKE '%marknivå%')`,
  `UPDATE permits SET permit_type = 'förhandsbesked' WHERE permit_type IS NULL AND atgard ILIKE '%förhandsbesked%'`,
  `UPDATE permits SET permit_type = 'strandskyddsdispens' WHERE permit_type IS NULL AND atgard ILIKE '%strandskydd%'`,
  `UPDATE permits SET permit_type = 'anmälan' WHERE permit_type IS NULL AND atgard ILIKE '%anmälan%'`,
  `UPDATE permits SET permit_type = 'bygglov' WHERE permit_type IS NULL`,
];

async function main() {
  console.log('Kör migration...');
  for (const sql of sqls) {
    console.log('SQL:', sql.slice(0, 80) + '...');
    try {
      await runSql(sql);
      console.log('  OK');
    } catch (err) {
      console.log('  FEL (execute_sql RPC kanske saknas):', err.message.slice(0, 120));
    }
  }
  console.log('Klar.');
}

main().catch(console.error);
