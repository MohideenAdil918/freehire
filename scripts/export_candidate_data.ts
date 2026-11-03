import { SQL } from 'bun';
import fs from 'fs';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://hire:hire@localhost:5432/hire';
const sql = new SQL(DATABASE_URL);

async function main() {
  console.log('Exporting user 1 profile and CV data from PostgreSQL...');

  const users = await sql`SELECT id, email, role, pro_until_granted, ultra_until_granted FROM users WHERE id = 1`;
  const profiles = await sql`SELECT * FROM user_profiles WHERE user_id = 1`;
  const employments = await sql`SELECT * FROM experience_employments WHERE user_id = 1 ORDER BY period_start_year DESC NULLS LAST`;
  const atoms = await sql`SELECT * FROM experience_atoms WHERE user_id = 1 ORDER BY employment_id, id`;
  const answerBank = await sql`SELECT * FROM screening_answer_bank WHERE user_id = 1 ORDER BY topic`;
  const answers = await sql`SELECT * FROM screening_answers WHERE user_id = 1`;
  
  // Master CVs
  const masterCVIds = [
    'f0c66849-c6a4-4419-b4e1-755f011127d4', // base
    '473a578d-2d2c-4f8e-afbe-d42ab9a3df4a', // fullstack
    '9c23481f-bc06-46b3-8702-3077f97f1ac0', // backend
    '0cb87198-c79f-430d-acaa-b5c2e4ea4320', // rails
    '3bddb723-de76-4899-a70c-c6ddae57b875', // frontend
  ];

  const masterCVArrayStr = '{' + masterCVIds.join(',') + '}';
  const cvRows = await sql`SELECT id, user_id, title, template_id, is_tailored, data, created_at, updated_at FROM cvs WHERE id = ANY(${masterCVArrayStr}::uuid[])`;

  const exportData = {
    user: users[0] || null,
    profile: profiles[0] || null,
    employments,
    experience_atoms: atoms,
    screening_answer_bank: answerBank,
    screening_answers: answers[0] || null,
    master_cvs: cvRows.map(cv => ({
      ...cv,
      data: typeof cv.data === 'string' ? JSON.parse(cv.data) : cv.data
    }))
  };

  const outputDir = path.join(process.cwd(), 'cv_variants');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonPath = path.join(outputDir, 'candidate_database_export.json');
  fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2), 'utf-8');
  console.log(`Saved JSON export to ${jsonPath}`);

  // Generate SQL seed file
  let sqlContent = `-- Database Seed: Candidate Profile, Experience Bank, Screening Answers, and CV Variants
-- Candidate: Mohideen Adil (mohideenadil918@gmail.com)
-- Exported on: ${new Date().toISOString()}

BEGIN;

-- 1. Ensure user exists and has Ultra plan
INSERT INTO users (id, email, role, pro_until_granted, ultra_until_granted)
VALUES (
  1, 
  '${exportData.user.email}', 
  '${exportData.user.role || 'candidate'}', 
  now() + interval '10 years', 
  now() + interval '10 years'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  pro_until_granted = EXCLUDED.pro_until_granted,
  ultra_until_granted = EXCLUDED.ultra_until_granted;

-- 2. User profile
INSERT INTO user_profiles (user_id, skills, specializations, location_preferences, excluded_skills, seniorities, excluded_sources, excluded_companies)
VALUES (
  1,
  ARRAY[${(exportData.profile?.skills || []).map((s: string) => `'${s.replace(/'/g, "''")}'`).join(', ')}],
  ARRAY[${(exportData.profile?.specializations || ['fullstack']).map((s: string) => `'${s.replace(/'/g, "''")}'`).join(', ')}],
  '${JSON.stringify(exportData.profile?.location_preferences || {})}'::jsonb,
  ARRAY[${(exportData.profile?.excluded_skills || []).map((s: string) => `'${s.replace(/'/g, "''")}'`).join(', ')}],
  ARRAY[${(exportData.profile?.seniorities || []).map((s: string) => `'${s.replace(/'/g, "''")}'`).join(', ')}],
  ARRAY[${(exportData.profile?.excluded_sources || []).map((s: string) => `'${s.replace(/'/g, "''")}'`).join(', ')}],
  ARRAY[${(exportData.profile?.excluded_companies || []).map((s: string) => `'${s.replace(/'/g, "''")}'`).join(', ')}]
)
ON CONFLICT (user_id) DO UPDATE SET
  skills = EXCLUDED.skills,
  specializations = EXCLUDED.specializations,
  location_preferences = EXCLUDED.location_preferences;

-- 3. Experience employments
DELETE FROM experience_atoms WHERE user_id = 1;
DELETE FROM experience_employments WHERE user_id = 1;

`;

  for (const emp of employments) {
    const stackSql = emp.stack && emp.stack.length > 0 ? `ARRAY[${emp.stack.map((s: string) => `'${s.replace(/'/g, "''")}'`).join(', ')}]` : `'{}'::text[]`;
    sqlContent += `INSERT INTO experience_employments (id, user_id, kind, company, role, location, period_start, period_end, is_current, summary, stack, link, period_start_year, period_start_month, period_end_year, period_end_month)
VALUES (
  '${emp.id}'::uuid,
  1,
  '${emp.kind}',
  '${emp.company.replace(/'/g, "''")}',
  '${emp.role.replace(/'/g, "''")}',
  '${(emp.location || '').replace(/'/g, "''")}',
  '${emp.period_start}',
  '${emp.period_end}',
  ${emp.is_current},
  '${(emp.summary || '').replace(/'/g, "''")}',
  ${stackSql},
  '${(emp.link || '').replace(/'/g, "''")}',
  ${emp.period_start_year || 'NULL'},
  ${emp.period_start_month || 'NULL'},
  ${emp.period_end_year || 'NULL'},
  ${emp.period_end_month || 'NULL'}
);\n`;
  }

  sqlContent += '\n-- 4. Experience atoms\n';
  for (const atom of atoms) {
    const skillsSql = atom.skills && atom.skills.length > 0 ? `ARRAY[${atom.skills.map((s: string) => `'${s.replace(/'/g, "''")}'`).join(', ')}]` : `'{}'::text[]`;
    const metricsSql = atom.metrics && atom.metrics.length > 0 ? `ARRAY[${atom.metrics.map((s: string) => `'${s.replace(/'/g, "''")}'`).join(', ')}]` : `'{}'::text[]`;
    sqlContent += `INSERT INTO experience_atoms (id, user_id, employment_id, claim, claim_key, context, metrics, skills, provenance, source_ref)
VALUES (
  '${atom.id}'::uuid,
  1,
  '${atom.employment_id}'::uuid,
  '${atom.claim.replace(/'/g, "''")}',
  '${atom.claim_key.replace(/'/g, "''")}',
  '${(atom.context || '').replace(/'/g, "''")}',
  ${metricsSql},
  ${skillsSql},
  '${atom.provenance}',
  '${(atom.source_ref || '').replace(/'/g, "''")}'
);\n`;
  }

  sqlContent += '\n-- 5. Screening answers bank\n';
  sqlContent += 'DELETE FROM screening_answer_bank WHERE user_id = 1;\n';
  for (const item of answerBank) {
    sqlContent += `INSERT INTO screening_answer_bank (user_id, topic, question, answer, provenance)
VALUES (
  1,
  '${item.topic.replace(/'/g, "''")}',
  '${item.question.replace(/'/g, "''")}',
  '${item.answer.replace(/'/g, "''")}',
  '${item.provenance}'
);\n`;
  }

  if (exportData.screening_answers) {
    const sa = exportData.screening_answers;
    const authCountries = sa.authorized_countries ? `ARRAY[${sa.authorized_countries.map((c: string) => `'${c}'`).join(', ')}]` : 'NULL';
    sqlContent += `\n-- 6. Screening answers\nINSERT INTO screening_answers (user_id, authorized_countries, visa_sponsorship_needed, desired_salary_amount, desired_salary_currency, desired_salary_period, notice_period_days, willing_to_relocate, age_18_or_older)
VALUES (
  1,
  ${authCountries},
  ${sa.visa_sponsorship_needed},
  ${sa.desired_salary_amount || 'NULL'},
  ${sa.desired_salary_currency ? `'${sa.desired_salary_currency}'` : 'NULL'},
  ${sa.desired_salary_period ? `'${sa.desired_salary_period}'` : 'NULL'},
  ${sa.notice_period_days || 'NULL'},
  ${sa.willing_to_relocate},
  ${sa.age_18_or_older}
)
ON CONFLICT (user_id) DO UPDATE SET
  authorized_countries = EXCLUDED.authorized_countries,
  visa_sponsorship_needed = EXCLUDED.visa_sponsorship_needed,
  desired_salary_amount = EXCLUDED.desired_salary_amount,
  desired_salary_currency = EXCLUDED.desired_salary_currency,
  desired_salary_period = EXCLUDED.desired_salary_period,
  notice_period_days = EXCLUDED.notice_period_days,
  willing_to_relocate = EXCLUDED.willing_to_relocate,
  age_18_or_older = EXCLUDED.age_18_or_older;\n`;
  }

  sqlContent += '\n-- 7. Master CV Variants\n';
  for (const cv of cvRows) {
    const cvDataStr = typeof cv.data === 'string' ? cv.data : JSON.stringify(cv.data);
    sqlContent += `INSERT INTO cvs (id, user_id, title, template_id, is_tailored, data)
VALUES (
  '${cv.id}'::uuid,
  1,
  '${cv.title.replace(/'/g, "''")}',
  '${cv.template_id}',
  ${cv.is_tailored},
  '${cvDataStr.replace(/'/g, "''")}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  template_id = EXCLUDED.template_id,
  is_tailored = EXCLUDED.is_tailored,
  data = EXCLUDED.data;\n`;
  }

  sqlContent += '\nCOMMIT;\n';

  const sqlPath = path.join(outputDir, 'seed_candidate_data.sql');
  fs.writeFileSync(sqlPath, sqlContent, 'utf-8');
  console.log(`Saved SQL seed to ${sqlPath}`);
}

main().catch(console.error);
