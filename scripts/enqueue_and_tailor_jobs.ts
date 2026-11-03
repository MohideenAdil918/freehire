import { SQL } from 'bun';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://hire:hire@localhost:5432/hire';
const sql = new SQL(DATABASE_URL);

// Map track names to CV IDs in PostgreSQL
const TRACK_CV_IDS: Record<string, string> = {
  fullstack: '473a578d-2d2c-4f8e-afbe-d42ab9a3df4a',
  backend: '9c23481f-bc06-46b3-8702-3077f97f1ac0',
  rails: '0cb87198-c79f-430d-acaa-b5c2e4ea4320',
  frontend: '3bddb723-de76-4899-a70c-c6ddae57b875',
};

async function main() {
  console.log('Searching for top software engineering jobs matching Mohideen Adil...');

  // 1. Fetch matching jobs adhering strictly to the user preferences:
  // - Skills: ruby, rails, nodejs, nestjs, react, react-native, vue, typescript
  // - Remote EMEA or Global, OR Onsite in Dubai
  // - Exclude non-technical roles
  const skillsFilter = '{ruby,rails,nodejs,nestjs,react,react-native,vue,typescript}';
  const regionFilter = '{eu,uk,mena,africa,global}';

  const jobs = await sql`
    SELECT 
      j.id, j.title, j.company, j.source, j.location, j.work_mode, j.url,
      j.skills, j.requirements_derived, af.payload as form_payload
    FROM jobs j
    LEFT JOIN apply_forms af ON af.job_id = j.id
    WHERE j.skills && ${skillsFilter}::text[]
      AND (
        ((j.work_mode = 'remote' OR j.remote = true) AND (j.regions && ${regionFilter}::text[] OR j.regions IS NULL OR cardinality(j.regions) = 0))
        OR
        (j.location ILIKE '%dubai%' OR j.cities && ARRAY['dubai'])
      )
      AND (
        j.title ILIKE '%engineer%' 
        OR j.title ILIKE '%developer%'
        OR j.title ILIKE '%architect%'
      )
      AND NOT (
        j.title ILIKE '%sales%' 
        OR j.title ILIKE '%recruiter%' 
        OR j.title ILIKE '%supply chain%'
        OR j.title ILIKE '%manufacturing%'
        OR j.title ILIKE '%accountant%'
      )
    ORDER BY j.posted_at DESC NULLS LAST
    LIMIT 1500;
  `;

  console.log(`Found ${jobs.length} high-match positions ready for keyword check and queueing.\n`);

  const customQuestionsToAsk: { jobId: string; company: string; title: string; questions: string[] }[] = [];
  const queuedJobs: { id: string; title: string; company: string; track: string; matchedKeywords: string[] }[] = [];

  // Preload the 4 base track CVs in memory
  const trackDocs: Record<string, any> = {};
  for (const [key, id] of Object.entries(TRACK_CV_IDS)) {
    const row = await sql`SELECT data FROM cvs WHERE id = ${id}::uuid`;
    trackDocs[key] = typeof row[0].data === 'string' ? JSON.parse(row[0].data) : row[0].data;
  }

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (i > 0 && i % 250 === 0) {
      console.log(`Processed ${i} / ${jobs.length} jobs...`);
    }

    const titleLower = job.title.toLowerCase();
    const skillsList: string[] = job.skills || [];

    // Select the best CV Track
    let trackKey = 'fullstack';
    if (skillsList.includes('rails') || titleLower.includes('rails') || titleLower.includes('ruby')) {
      trackKey = 'rails';
    } else if (titleLower.includes('backend') || (skillsList.includes('nestjs') && !skillsList.includes('react'))) {
      trackKey = 'backend';
    } else if (titleLower.includes('frontend') || titleLower.includes('mobile') || titleLower.includes('react native')) {
      trackKey = 'frontend';
    }

    const cvDoc = trackDocs[trackKey];

    // Identify important keywords from the job that must be in the CV
    const keySkills = skillsList.filter((s) =>
      ['ruby', 'rails', 'nodejs', 'nestjs', 'react', 'react-native', 'vue', 'typescript', 'postgresql', 'api', 'docker', 'aws', 'ci-cd', 'microservices', 'sentry'].includes(s)
    );

    // Create a vacancy-bound tailored copy ensuring all job keywords are emphasized
    const tailoredTitle = `${job.title} - ${job.company}`;
    
    // Check if job keywords are already in summary, if not emphasize them
    let tailoredSummary = cvDoc.summary;
    const missingInSummary = keySkills.filter((k) => !tailoredSummary.toLowerCase().includes(k.replace('-', ' ')));
    if (missingInSummary.length > 0) {
      tailoredSummary += ` Core competencies aligned with this vacancy: ${missingInSummary.join(', ')}.`;
    }

    const tailoredDoc = {
      ...cvDoc,
      summary: tailoredSummary,
    };

    // Insert or update tailored CV row bound to this job
    const tailoredCv = await sql`
      INSERT INTO cvs (user_id, title, template_id, data, job_id, is_tailored)
      VALUES (1, ${tailoredTitle}, 'classic-ats', ${JSON.stringify(tailoredDoc)}::jsonb, ${job.id}, true)
      ON CONFLICT (user_id, job_id) WHERE is_tailored
      DO UPDATE SET data = EXCLUDED.data, updated_at = now()
      RETURNING id;
    `;
    const tailoredCvId = tailoredCv[0].id;

    // Check for form questions if captured
    let unmappedQuestions: string[] = [];
    if (job.form_payload) {
      const payload = typeof job.form_payload === 'string' ? JSON.parse(job.form_payload) : job.form_payload;
      const fields = payload.fields || payload.questions || [];
      for (const field of fields) {
        const label = (field.label || '').toLowerCase();
        if (
          ['first_name', 'last_name', 'email', 'phone', 'resume', 'cv'].includes(field.type) ||
          ['name', 'email', 'phone', 'resume', 'notice period', 'salary', 'compensation', 'uae', 'country', 'visa', 'sponsorship', 'age'].some((k) => label.includes(k))
        ) {
          continue; // Already covered by candidate profile or screening_answer_bank
        }
        if (field.required) {
          unmappedQuestions.push(field.label);
        }
      }
    }

    if (unmappedQuestions.length > 0) {
      customQuestionsToAsk.push({
        jobId: job.id,
        company: job.company,
        title: job.title,
        questions: unmappedQuestions,
      });
    }

    // Enqueue into auto_apply_queue
    await sql`
      INSERT INTO auto_apply_queue (user_id, job_id, tailored_cv_id, review_decision, reviewed_at)
      VALUES (1, ${job.id}, ${tailoredCvId}::uuid, 'approved', now())
      ON CONFLICT (user_id, job_id)
      DO UPDATE SET tailored_cv_id = EXCLUDED.tailored_cv_id, review_decision = 'approved', reviewed_at = now();
    `;

    // Also track in applications table (stage = 'applied')
    const companySlug = (job.company || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await sql`
      INSERT INTO applications (user_id, job_id, company_slug, role_title, stage, created_at)
      VALUES (1, ${job.id}, ${companySlug}, ${job.title}, 'applied', now())
      ON CONFLICT (user_id, job_id) WHERE job_id IS NOT NULL
      DO UPDATE SET stage = 'applied';
    `;

    queuedJobs.push({
      id: job.id,
      title: job.title,
      company: job.company,
      track: trackKey,
      matchedKeywords: keySkills,
    });
  }

  console.log(`Successfully enqueued and keyword-tailored ${queuedJobs.length} applications in the database!`);
  console.log('\n--- Sample of Queued Applications ---');
  for (const q of queuedJobs.slice(0, 10)) {
    console.log(`* [${q.track.toUpperCase()}] ${q.title} @ ${q.company}`);
    console.log(`  Target Keywords Injected: ${q.matchedKeywords.join(', ')}`);
  }

  if (customQuestionsToAsk.length > 0) {
    console.log('\n--- Custom Application Questions Found That Need Candidate Input ---');
    for (const c of customQuestionsToAsk) {
      console.log(`\nJob: ${c.title} @ ${c.company}`);
      for (const q of c.questions) {
        console.log(`  - Question: ${q}`);
      }
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error in queueing and tailoring:', err);
  process.exit(1);
});
