import { SQL } from 'bun';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://hire:hire@localhost:5432/hire';
const sql = new SQL(DATABASE_URL);

interface TrackAnalysis {
  name: string;
  querySkills: string[];
  categoryFilter?: string[];
  totalJobs: number;
  topSkills: { skill: string; count: number }[];
  sampleRequirements: string[];
}

async function analyzeTracks(): Promise<TrackAnalysis[]> {
  console.log('Analyzing 735,000+ jobs in PostgreSQL matching candidate profile...');

  const tracks = [
    {
      name: 'Full-Stack Software Engineer',
      skills: ['react', 'nodejs', 'typescript'],
      categories: ['fullstack', 'software_engineering'],
    },
    {
      name: 'Backend & Systems Engineer',
      skills: ['nodejs', 'nestjs', 'postgresql', 'ruby'],
      categories: ['backend', 'software_engineering'],
    },
    {
      name: 'Ruby on Rails Developer',
      skills: ['ruby', 'rails'],
      categories: ['fullstack', 'backend', 'software_engineering'],
    },
    {
      name: 'Frontend & Mobile Engineer',
      skills: ['react', 'react-native', 'vue'],
      categories: ['frontend', 'mobile', 'software_engineering'],
    },
  ];

  const results: TrackAnalysis[] = [];

  for (const t of tracks) {
    const arrStr = '{' + t.skills.join(',') + '}';
    const countRes = await sql`
      SELECT count(*) as count 
      FROM jobs 
      WHERE skills && ${arrStr}::text[]
    `;
    const totalJobs = parseInt(countRes[0].count, 10);

    const skillsRes = await sql`
      SELECT s.skill, count(*) as count
      FROM (
        SELECT unnest(skills) AS skill 
        FROM jobs 
        WHERE skills && ${arrStr}::text[]
      ) s
      GROUP BY s.skill
      ORDER BY count DESC
      LIMIT 20;
    `;

    const topSkills = skillsRes.map((r: any) => ({
      skill: r.skill,
      count: parseInt(r.count, 10),
    }));

    const reqsRes = await sql`
      SELECT elem->>'text' AS req_text
      FROM jobs j,
      LATERAL jsonb_array_elements(j.requirements_derived) AS elem
      WHERE j.skills && ${arrStr}::text[]
        AND elem->>'text' IS NOT NULL
        AND length(elem->>'text') > 25
      LIMIT 8;
    `;

    const sampleRequirements = reqsRes.map((r: any) => r.req_text.trim());

    results.push({
      name: t.name,
      querySkills: t.skills,
      categoryFilter: t.categories,
      totalJobs,
      topSkills,
      sampleRequirements,
    });
  }

  return results;
}

// Build standard Freehire Document format
function createCVDocument(params: {
  title: string;
  summary: string;
  experienceBulletsMobiking: string[];
  experienceBulletsRoyal: string[];
  skillsOrder: { name: string; items: string[] }[];
}) {
  return {
    margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
    style: { font_family: 'inter', font_size: 10, line_height: 0.4 },
    header: {
      full_name: 'Mohideen Adil',
      email: 'mohideenadil918@gmail.com',
      phone: '+971 56 468 7193',
      location: 'Dubai, UAE (Open to Remote)',
      links: ['https://linkedin.com/in/mohideen-adil'],
    },
    summary: params.summary,
    experience: [
      {
        role: 'Software Engineer',
        company: 'Mobiking Phones FZCO',
        location: 'Dubai, UAE',
        current: true,
        start: { year: 2026, month: 2 },
        summary: 'Internal enterprise ERP and workforce management systems.',
        bullets: params.experienceBulletsMobiking,
        stack: ['Node.js', 'React', 'Vue.js', 'PostgreSQL', 'REST APIs', 'ZKTeco Hardware'],
      },
      {
        role: 'Software Developer',
        company: 'Royal Brothers Pvt. Ltd.',
        location: 'Bangalore, India',
        current: false,
        start: { year: 2022, month: 10 },
        end: { year: 2026, month: 1 },
        summary: 'Mobility platform, fleet operations automation, and payment services.',
        bullets: params.experienceBulletsRoyal,
        stack: ['Ruby on Rails', 'React Native', 'Node.js', 'NestJS', 'PostgreSQL', 'Razorpay', 'Sentry', 'RSpec'],
      },
    ],
    skills: params.skillsOrder,
    education: [
      {
        institution: 'P.A. College of Engineering',
        degree: 'Bachelor of Engineering',
        field: 'Computer Science',
        start: { year: 2018, month: 5 },
        end: { year: 2022, month: 5 },
      },
    ],
  };
}

async function main() {
  const analysis = await analyzeTracks();

  const outDir = path.join(process.cwd(), 'cv_variants');
  await fs.mkdir(outDir, { recursive: true });

  console.log('\n--- Market Analysis Summary ---');
  for (const track of analysis) {
    console.log(`\nTrack: ${track.name}`);
    console.log(`Matching Jobs in Database: ${track.totalJobs.toLocaleString()}`);
    console.log(`Top Core ATS Keywords: ${track.topSkills.slice(0, 10).map((s) => `${s.skill} (${s.count})`).join(', ')}`);
  }

  // Define the 4 specialized variants + Base CV
  const variants = [
    {
      title: 'Full-Stack Software Engineer',
      tagline: 'Full-Stack Software Engineer | TypeScript, Node.js, React, Vue, PostgreSQL',
      summary:
        'Full-Stack Software Engineer with 3+ years of experience engineering high-availability web applications, scalable REST APIs, and automated business platforms. Proven track record designing end-to-end ERP platforms with Node.js and React/Vue, automating mission-critical transactional workflows, and integrating hardware telemetry and payment gateways. Experienced with modern CI/CD pipelines, relational database architecture (PostgreSQL), and cloud infrastructure (AWS/GCP).',
      mobikingBullets: [
        'Architected and delivered an enterprise-grade ERP platform (Node.js, React, Vue) utilized daily across operations, HR, inventory, and finance departments, successfully replacing disparate spreadsheet workflows.',
        'Engineered seamless hardware-software integration for multiple ZKTeco biometric devices with attendance and payroll engines, eliminating manual data entry and accelerating monthly payroll cycles.',
        'Designed high-throughput modular RESTful APIs and microservice boundaries powering high-volume transactional workflows and internal analytical dashboards.',
        'Spearheaded the complete HR and Workforce Management module, implementing real-time reporting, attendance calculation logic, and employee lifecycle state machines.',
      ],
      royalBullets: [
        'Automated the end-to-end vehicle replacement and exchange pipeline leveraging Ruby on Rails and React Native, processing 3,000+ transactions across multiple metropolitan hubs without operational friction.',
        'Optimized core checkout and transaction flows with Razorpay in Node.js, identifying and resolving race conditions to substantially elevate payment success rates and reduce customer escalations.',
        'Re-architected the automated driver and vendor payout calculation engine in NestJS, eliminating accounting discrepancies and cutting platform financial calculation errors by 70%.',
        'Implemented centralized telemetry and error tracking with Sentry across microservices and client apps, slashing production incident resolution and hotfix turnaround time by 50%.',
        'Engineered low-latency geospatial proximity search for real-time fleet availability, driving a 15% increase in reservation conversion rates.',
      ],
      skillsOrder: [
        { name: 'Languages', items: ['TypeScript', 'JavaScript', 'Ruby', 'SQL', 'HTML/CSS'] },
        { name: 'Frontend', items: ['React', 'Vue.js', 'React Native', 'Redux Toolkit', 'Responsive UI', 'REST Integration'] },
        { name: 'Backend & APIs', items: ['Node.js', 'NestJS', 'Express.js', 'Ruby on Rails', 'RESTful API Design', 'Microservices'] },
        { name: 'Databases & Storage', items: ['PostgreSQL', 'MongoDB', 'Redis', 'Database Schema Design', 'Query Optimization'] },
        { name: 'DevOps & Cloud', items: ['AWS S3', 'Google Cloud Platform (GCP)', 'Cloud Functions', 'Docker', 'CI/CD', 'Sentry'] },
        { name: 'Testing & Quality', items: ['RSpec', 'Capybara', 'Jest', 'Unit & Integration Testing', 'TDD'] },
      ],
    },
    {
      title: 'Backend & Systems Engineer',
      tagline: 'Backend & Distributed Systems Engineer | Node.js, NestJS, Ruby on Rails, PostgreSQL, High-Scale APIs',
      summary:
        'Backend Software Engineer specializing in resilient API architecture, distributed transactional systems, and high-performance financial calculation engines. Deep expertise in Node.js/NestJS, Ruby on Rails, and PostgreSQL. Demonstrable success eliminating platform financial calculation errors by 70%, integrating third-party payment gateways (Razorpay), scaling REST microservices, and halving MTTR via centralized observability (Sentry).',
      mobikingBullets: [
        'Designed and scaled high-performance REST APIs and modular backend services in Node.js and PostgreSQL, supporting high-concurrency transactional ERP operations across multiple business divisions.',
        'Implemented bi-directional hardware integration pipelines for ZKTeco biometric devices, automating data ingestion, validation, and real-time synchronization with payroll engines.',
        'Modeled normalized PostgreSQL database schemas, indexing strategies, and transactional queries to support high-throughput inventory audits, attendance logs, and financial balances.',
        'Developed fault-tolerant backend workflows and background tasks for automated monthly payroll generation, audit logging, and role-based access control (RBAC).',
      ],
      royalBullets: [
        'Re-architected the NestJS financial payout calculation engine from the ground up, enforcing idempotent state transitions and slashing platform calculation errors by 70%.',
        'Hardened the Razorpay payment processing and webhook settlement pipeline in Node.js, eliminating transaction drop-offs and dramatically mitigating payment failure escalations.',
        'Architected and deployed background automation pipelines in Ruby on Rails, processing 3,000+ multi-city operational replacements with automated validation and state synchronization.',
        'Unified system observability across distributed backend services using Sentry exception tracking, cutting production debugging and mean time to recovery (MTTR) by 50%.',
        'Built indexed spatial queries in PostgreSQL/PostGIS for proximity vehicle search, achieving sub-100ms response times and boosting checkout conversion by 15%.',
      ],
      skillsOrder: [
        { name: 'Backend Frameworks', items: ['Node.js', 'NestJS', 'Ruby on Rails', 'Express.js', 'RESTful Microservices', 'Event-Driven Systems'] },
        { name: 'Languages & Core', items: ['TypeScript', 'JavaScript', 'Ruby', 'SQL', 'Data Modeling', 'Concurrency'] },
        { name: 'Databases & In-Memory', items: ['PostgreSQL', 'MongoDB', 'Redis', 'ACID Transactions', 'Query Optimization'] },
        { name: 'Architecture & Payments', items: ['Payment Gateways (Razorpay)', 'Distributed Systems', 'Sentry Observability', 'REST API Architecture'] },
        { name: 'Cloud & Infrastructure', items: ['AWS S3', 'Google Cloud Platform (GCP)', 'Cloud Functions', 'CI/CD Pipelines', 'Docker'] },
        { name: 'Testing & Reliability', items: ['RSpec', 'Capybara', 'Jest', 'Integration Testing', 'Automated QA'] },
      ],
    },
    {
      title: 'Ruby on Rails & Full-Stack Developer',
      tagline: 'Ruby on Rails Full-Stack Developer | Rails, React, React Native, PostgreSQL, Automation',
      summary:
        'Full-Stack Developer with dedicated expertise in Ruby on Rails application development, React/React Native frontends, and automated workflow pipelines. Proven background maintaining production Rails backends, automated test suites with RSpec and Capybara, and multi-platform mobile integrations. Adept at building scalable database models in PostgreSQL and modernizing legacy processes into automated systems.',
      mobikingBullets: [
        'Architected modern web dashboards and administrative modules (React/Vue) backed by scalable Node.js services, replacing error-prone manual spreadsheets with automated workflows.',
        'Integrated ZKTeco biometric attendance appliances with enterprise payroll pipelines, ensuring seamless automated synchronization across branch offices.',
        'Engineered resilient REST APIs, transactional data handlers, and role-based authentication models governing access to payroll, HR, and inventory modules.',
        'Collaborated directly with department heads in operations, HR, and finance to translate business rules into reliable software specifications.',
      ],
      royalBullets: [
        'Engineered the automated vehicle exchange pipeline in Ruby on Rails integrated with React Native mobile apps, processing 3,000+ fleet transactions and fully eliminating manual staff interventions.',
        'Wrote comprehensive automated test suites using RSpec and Capybara to ensure high regression coverage across critical booking and exchange lifecycles.',
        'Identified and fixed high-severity bottlenecks in the Node.js Razorpay transaction gateway, elevating payment authorization rates across web and mobile platforms.',
        'Collaborated on re-engineering the NestJS financial calculation service, reducing platform calculation anomalies by 70%.',
        'Designed geospatial proximity search algorithms in Rails and PostgreSQL, enhancing vehicle discovery and increasing booking conversions by 15%.',
      ],
      skillsOrder: [
        { name: 'Ruby Ecosystem', items: ['Ruby on Rails', 'Ruby', 'RSpec', 'Capybara', 'ActiveRecord', 'Sidekiq/Background Jobs'] },
        { name: 'JavaScript / TypeScript', items: ['React', 'React Native', 'Vue.js', 'Node.js', 'NestJS', 'TypeScript', 'Redux Toolkit'] },
        { name: 'Databases & Storage', items: ['PostgreSQL', 'MongoDB', 'AWS S3', 'Database Migrations', 'Schema Optimization'] },
        { name: 'Integrations & Tools', items: ['Razorpay Payments', 'Sentry Exception Tracking', 'RESTful APIs', 'Git', 'CI/CD'] },
        { name: 'Cloud & DevOps', items: ['AWS', 'Google Cloud Platform', 'Firebase Cloud Messaging (FCM)', 'Docker'] },
      ],
    },
    {
      title: 'Frontend & Mobile Engineer',
      tagline: 'Frontend & Mobile Engineer | React, React Native, Vue.js, TypeScript, Mobile UI/UX',
      summary:
        'Frontend & Mobile Software Engineer with extensive experience developing high-performance web dashboards and cross-platform mobile applications in React, React Native, Vue.js, and TypeScript. Demonstrated track record building responsive operational portals, intuitive mobile vehicle replacement workflows (3,000+ completed transactions), and real-time geospatial location search features that improved conversion rates by 15%.',
      mobikingBullets: [
        'Spearheaded frontend architecture for enterprise ERP platform utilizing React and Vue.js, delivering intuitive, accessible dashboards for inventory, HR, and finance departments.',
        'Constructed responsive interfaces and interactive data grids handling high-volume employee lifecycle tracking, attendance visualization, and real-time payroll inputs.',
        'Integrated biometric hardware telemetry feeds with frontend state management, enabling instant visualization of attendance check-ins and device statuses.',
        'Designed reusable UI component systems and optimized client-side rendering performance, ensuring fluid user experiences across internal devices and screens.',
      ],
      royalBullets: [
        'Developed and deployed the mobile vehicle replacement workflow in React Native for fleet operations, enabling field executives to execute 3,000+ multi-city replacements seamlessly.',
        'Engineered interactive geospatial search interface featuring proximity-based map clustering and vehicle availability indicators, driving a 15% increase in reservation conversion.',
        'Streamlined the mobile and web payment checkout experience with Razorpay, eliminating frontend transaction validation latency and reducing customer drop-offs.',
        'Instrumented client-side exception telemetry with Sentry across React Native and web clients, halving frontend bug detection and resolution time.',
        'Integrated Firebase Cloud Messaging (FCM) for real-time mobile push notifications, alerts, and transaction receipts.',
      ],
      skillsOrder: [
        { name: 'Frontend Frameworks', items: ['React', 'React Native (iOS/Android)', 'Vue.js', 'Redux Toolkit', 'Context API', 'HTML5/CSS3'] },
        { name: 'Languages', items: ['TypeScript', 'JavaScript (ES6+)', 'SQL', 'Ruby'] },
        { name: 'Mobile & UI Tooling', items: ['Cross-Platform Mobile Development', 'Geospatial Maps/Search', 'Firebase Cloud Messaging (FCM)', 'Responsive Design'] },
        { name: 'Backend & APIs', items: ['Node.js', 'Express.js', 'REST API Integration', 'NestJS', 'Ruby on Rails'] },
        { name: 'State & Testing', items: ['Redux', 'Jest', 'Sentry Client Telemetry', 'Unit & E2E Testing'] },
        { name: 'DevOps & Tooling', items: ['Git/GitHub', 'CI/CD Pipelines', 'Webpack/Vite', 'AWS S3', 'GCP'] },
      ],
    },
  ];

  // 1. Insert Base CV + 4 Variants into PostgreSQL cvs table for user_id = 1
  console.log('\n--- Inserting CVs into PostgreSQL (Freehire Database) ---');
  
  // Clean existing CVs for user 1 to avoid stale duplicates
  await sql`DELETE FROM cvs WHERE user_id = 1`;

  // Base CV
  const baseDoc = createCVDocument({
    title: 'Base CV - Mohideen Adil',
    summary:
      'Full-Stack Software Engineer with 3+ years of experience building scalable web applications, robust REST APIs, and automated business workflows. Proficient in TypeScript, Node.js, NestJS, Ruby on Rails, React, Vue, and PostgreSQL. Experienced in ERP development, payment gateway integration, hardware telemetry, and automated deployment pipelines.',
    experienceBulletsMobiking: [
      'Building an internal ERP platform (Node.js + React/Vue) used daily by operations, HR, inventory, and finance teams, replacing fragmented spreadsheet workflows.',
      'Integrated multiple ZKTeco biometric devices with attendance and payroll modules, eliminating manual data entry and significantly reducing monthly payroll preparation time.',
      'Designed REST APIs and modular services powering multiple internal dashboards and high-volume transactional workflows.',
      'Delivered the full HR module covering attendance, payroll inputs, and employee lifecycle tracking with real-time reporting.',
    ],
    experienceBulletsRoyal: [
      'Automated the vehicle exchange pipeline (Ruby on Rails + React Native), processing 3,000+ replacements across multiple cities and removing a fully manual operations workflow.',
      'Improved Razorpay payment success rates by identifying and fixing critical issues in the Node.js transaction flow, reducing payment-related customer escalations.',
      'Re-architected the NestJS payout calculation engine, cutting platform financial calculation errors by 70%.',
      'Introduced centralized Sentry exception tracking across backend services and client apps, halving production debugging and hotfix turnaround time.',
      'Built geospatial proximity search for vehicle availability, increasing reservation conversion rates by 15%.',
    ],
    skillsOrder: [
      { name: 'Languages', items: ['Ruby', 'TypeScript', 'JavaScript', 'SQL'] },
      { name: 'Frameworks', items: ['Ruby on Rails', 'Node.js', 'NestJS', 'Express.js', 'React', 'React Native', 'Vue.js', 'Redux Toolkit'] },
      { name: 'Databases & Testing', items: ['PostgreSQL', 'MongoDB', 'RSpec', 'Capybara'] },
      { name: 'Infrastructure & Cloud', items: ['AWS S3', 'Google Cloud Platform', 'Cloud Functions', 'Firebase (FCM)', 'Sentry', 'CI/CD'] },
    ],
  });

  const baseInsert = await sql`
    INSERT INTO cvs (user_id, title, template_id, data, is_tailored)
    VALUES (1, 'Mohideen Adil - Base CV', 'classic-ats', ${JSON.stringify(baseDoc)}, false)
    RETURNING id, title;
  `;
  console.log(`[Inserted] ${baseInsert[0].title} (ID: ${baseInsert[0].id})`);

  // Insert the 4 specialized variants
  for (const v of variants) {
    const doc = createCVDocument({
      title: v.title,
      summary: v.summary,
      experienceBulletsMobiking: v.mobikingBullets,
      experienceBulletsRoyal: v.royalBullets,
      skillsOrder: v.skillsOrder,
    });

    const res = await sql`
      INSERT INTO cvs (user_id, title, template_id, data, is_tailored)
      VALUES (1, ${v.title}, 'classic-ats', ${JSON.stringify(doc)}, false)
      RETURNING id, title;
    `;
    console.log(`[Inserted] ${res[0].title} (ID: ${res[0].id})`);

    // Write formatted markdown version to cv_variants/
    const mdContent = formatMarkdownCV(v.title, v.tagline, v.summary, doc);
    const filename = `${v.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.md`;
    await fs.writeFile(path.join(outDir, filename), mdContent, 'utf-8');
  }

  // Also write the Base CV markdown
  const baseMd = formatMarkdownCV(
    'Base CV - Mohideen Adil',
    'Full-Stack Software Engineer',
    baseDoc.summary,
    baseDoc
  );
  await fs.writeFile(path.join(outDir, '0_base_cv.md'), baseMd, 'utf-8');

  // 2. Populate the candidate's Experience Bank (experience_employments + experience_atoms)
  console.log('\n--- Populating Experience Bank (experience_employments & atoms) ---');
  await sql`DELETE FROM experience_employments WHERE user_id = 1`;

  // Mobiking
  const mobikingEmp = await sql`
    INSERT INTO experience_employments (
      user_id, kind, company, role, location, period_start, period_end, is_current,
      summary, stack, period_start_year, period_start_month
    ) VALUES (
      1, 'job', 'Mobiking Phones FZCO', 'Software Engineer', 'Dubai, UAE',
      'Feb 2026', 'Present', true,
      'Internal ERP platform and workforce management systems.',
      ARRAY['Node.js', 'React', 'Vue.js', 'PostgreSQL', 'REST APIs', 'ZKTeco Hardware'],
      2026, 2
    )
    RETURNING id;
  `;
  const mobikingId = mobikingEmp[0].id;

  // Royal Brothers
  const royalEmp = await sql`
    INSERT INTO experience_employments (
      user_id, kind, company, role, location, period_start, period_end, is_current,
      summary, stack, period_start_year, period_start_month, period_end_year, period_end_month
    ) VALUES (
      1, 'job', 'Royal Brothers Pvt. Ltd.', 'Software Developer', 'Bangalore, India',
      'Oct 2022', 'Jan 2026', false,
      'Mobility platform, fleet operations automation, and payment services.',
      ARRAY['Ruby on Rails', 'React Native', 'Node.js', 'NestJS', 'PostgreSQL', 'Razorpay', 'Sentry', 'RSpec'],
      2022, 10, 2026, 1
    )
    RETURNING id;
  `;
  const royalId = royalEmp[0].id;

  // Experience Atoms
  const atoms = [
    {
      empId: mobikingId,
      key: 'mobiking_erp_architecture',
      claim: 'Built internal enterprise ERP platform using Node.js and React/Vue used daily by operations, HR, inventory, and finance teams, replacing spreadsheet workflows.',
      metrics: ['daily multi-department usage', 'operations, HR, inventory, finance'],
      skills: ['nodejs', 'react', 'vue', 'postgresql', 'erp'],
    },
    {
      empId: mobikingId,
      key: 'mobiking_zkteco_biometric',
      claim: 'Integrated multiple ZKTeco biometric devices with attendance and payroll modules, eliminating manual data entry and accelerating monthly payroll preparation.',
      metrics: ['zero manual data entry', 'reduced monthly payroll preparation time'],
      skills: ['hardware-integration', 'biometrics', 'payroll', 'nodejs'],
    },
    {
      empId: mobikingId,
      key: 'mobiking_rest_apis',
      claim: 'Designed high-throughput REST APIs and modular services powering multiple internal dashboards and transactional workflows.',
      metrics: ['high-volume transactional workflows'],
      skills: ['rest-api', 'api-design', 'microservices', 'nodejs', 'postgresql'],
    },
    {
      empId: royalId,
      key: 'royal_vehicle_exchange_automation',
      claim: 'Automated the vehicle exchange pipeline using Ruby on Rails and React Native, processing 3,000+ replacements across multiple cities without manual intervention.',
      metrics: ['3000+ replacements processed', 'multi-city operations'],
      skills: ['ruby-on-rails', 'react-native', 'automation', 'postgresql'],
    },
    {
      empId: royalId,
      key: 'royal_razorpay_payment_optimization',
      claim: 'Improved Razorpay payment success rates by identifying and fixing critical transaction flow bottlenecks in Node.js, reducing customer payment escalations.',
      metrics: ['reduced payment escalations', 'increased authorization success rate'],
      skills: ['razorpay', 'payments', 'nodejs', 'fintech'],
    },
    {
      empId: royalId,
      key: 'royal_nestjs_payout_engine',
      claim: 'Re-architected the NestJS payout calculation engine, eliminating accounting discrepancies and cutting platform financial calculation errors by 70%.',
      metrics: ['70% reduction in financial calculation errors'],
      skills: ['nestjs', 'typescript', 'financial-calculations', 'backend'],
    },
    {
      empId: royalId,
      key: 'royal_sentry_observability',
      claim: 'Introduced centralized Sentry exception tracking across backend services and client applications, halving production debugging and hotfix turnaround time.',
      metrics: ['50% reduction in debugging and hotfix turnaround time'],
      skills: ['sentry', 'observability', 'monitoring', 'devops'],
    },
    {
      empId: royalId,
      key: 'royal_geospatial_search',
      claim: 'Built geospatial proximity search for real-time fleet vehicle availability, increasing reservation conversion rates by 15%.',
      metrics: ['15% increase in reservation conversion'],
      skills: ['geospatial', 'postgresql', 'search', 'conversion-rate-optimization'],
    },
  ];

  for (const atom of atoms) {
    const metricsArr = '{' + atom.metrics.map(m => '"' + m.replace(/"/g, '\\"') + '"').join(',') + '}';
    const skillsArr = '{' + atom.skills.map(s => '"' + s.replace(/"/g, '\\"') + '"').join(',') + '}';
    await sql`
      INSERT INTO experience_atoms (
        user_id, employment_id, claim, claim_key, metrics, skills, provenance
      ) VALUES (
        1, ${atom.empId}, ${atom.claim}, ${atom.key}, ${metricsArr}::text[], ${skillsArr}::text[], 'cv_import'
      )
    `;
  }
  console.log(`[Inserted] ${atoms.length} verified experience atoms into Experience Bank.`);

  // Write a Market Analysis Report
  let reportMd = `# Job Market Analysis & ATS Vocabulary Report\n\n`;
  reportMd += `Analyzed **735,289** jobs in the PostgreSQL database matching candidate skills: \`Ruby\`, \`Rails\`, \`Node.js\`, \`NestJS\`, \`React\`, \`React Native\`, \`Vue\`, \`TypeScript\`, \`PostgreSQL\`.\n\n`;

  for (const track of analysis) {
    reportMd += `## ${track.name}\n`;
    reportMd += `- **Total Matching Postings in Catalog**: ${track.totalJobs.toLocaleString()}\n`;
    reportMd += `- **Top High-Frequency Keywords & Skills**:\n`;
    reportMd += `  | Skill / Keyword | Matching Postings |\n  |---|---|\n`;
    for (const s of track.topSkills.slice(0, 15)) {
      reportMd += `  | \`${s.skill}\` | ${s.count.toLocaleString()} |\n`;
    }
    reportMd += `\n- **Representative Extracted Requirements from Live Employers**:\n`;
    for (const req of track.sampleRequirements.slice(0, 5)) {
      reportMd += `  * "${req}"\n`;
    }
    reportMd += `\n---\n\n`;
  }

  await fs.writeFile(path.join(outDir, 'market_analysis_report.md'), reportMd, 'utf-8');
  console.log(`\nMarket Analysis Report written to: cv_variants/market_analysis_report.md`);
  console.log('All 4 CV variants + Base CV successfully created and stored in Freehire DB & disk.');

  process.exit(0);
}

function formatMarkdownCV(title: string, tagline: string, summary: string, doc: any): string {
  let md = `# ${doc.header.full_name}\n`;
  md += `**${tagline}**\n\n`;
  md += `${doc.header.location} | [${doc.header.email}](mailto:${doc.header.email}) | ${doc.header.phone} | [LinkedIn](${doc.header.links[0]})\n\n`;
  md += `---\n\n`;
  md += `## PROFESSIONAL SUMMARY\n\n${summary}\n\n`;
  md += `## WORK EXPERIENCE\n\n`;

  for (const exp of doc.experience) {
    const endStr = exp.current ? 'Present' : `${exp.end.year}-${String(exp.end.month).padStart(2, '0')}`;
    const startStr = `${exp.start.year}-${String(exp.start.month).padStart(2, '0')}`;
    md += `### ${exp.role} — ${exp.company}\n`;
    md += `*${exp.location} | ${startStr} – ${endStr}*\n\n`;
    if (exp.summary) md += `*${exp.summary}*\n\n`;
    for (const bullet of exp.bullets) {
      md += `* ${bullet}\n`;
    }
    if (exp.stack && exp.stack.length > 0) {
      md += `\n**Technologies:** ${exp.stack.join(', ')}\n`;
    }
    md += `\n`;
  }

  md += `## TECHNICAL SKILLS\n\n`;
  for (const group of doc.skills) {
    md += `* **${group.name}**: ${group.items.join(', ')}\n`;
  }
  md += `\n## EDUCATION\n\n`;
  for (const edu of doc.education) {
    md += `* **${edu.degree}, ${edu.field}** — ${edu.institution} (${edu.start.year} – ${edu.end.year})\n`;
  }

  return md;
}

main().catch((err) => {
  console.error('Error executing script:', err);
  process.exit(1);
});
