export interface InternshipPlatform {
  id: string
  name: string
  url: string
  logo_emoji: string
  type: 'job_portal' | 'freelance' | 'company_direct' | 'community'
  best_for: string[]
  search_tips: string[]
  red_flags: string[]   // signs of a bad listing
  profile_tips: string[]
  typical_response_time: string
}

export const PLATFORMS: InternshipPlatform[] = [
  {
    id: 'linkedin',
    name: 'LinkedIn Jobs',
    url: 'https://www.linkedin.com/jobs/',
    logo_emoji: '💼',
    type: 'job_portal',
    best_for: [
      'IT service companies (TCS, Infosys, Wipro, Accenture)',
      'Product companies (Google, Microsoft, Atlassian)',
      'Startups and funded companies',
      'Remote internships'
    ],
    search_tips: [
      'Search: "Software Engineer Intern" + your city OR "Remote"',
      'Filter: Date Posted → Last 24 hours for fresh listings',
      'Filter: Experience Level → Internship',
      'Use: "Easy Apply" filter when starting — higher volume',
      'Set job alerts for "SDE Intern", "Developer Intern", "Tech Intern"',
      'Apply within 48 hours of posting — early applicants get noticed',
      'Check the "Alumni" filter — find PPSU alumni at companies you want'
    ],
    red_flags: [
      'No company logo or very low follower count',
      '"Stipend: As per industry standards" with no number',
      'Requires you to pay for training',
      'Job posted by an individual, not a company page',
      '"Work from home, flexible hours, earn ₹50,000/month" — almost always a scam'
    ],
    profile_tips: [
      'Profile photo: professional, plain background, face clearly visible',
      'Headline: "CSE Student at PPSU | Java | DBMS | Seeking SDE Internship"',
      'Connect with 50+ people in your field before applying',
      '500+ connections = "All-Star" profile = more visibility',
      'Turn on "Open to Work" with #OpenToWork frame'
    ],
    typical_response_time: '3–14 days'
  },
  {
    id: 'internshala',
    name: 'Internshala',
    url: 'https://internshala.com/',
    logo_emoji: '🎓',
    type: 'job_portal',
    best_for: [
      'College students specifically (built for this)',
      'Stipended internships (₹5,000–₹25,000/month range)',
      'Short-duration internships (1–3 months)',
      'Web development, Android, ML, Data Science roles',
      'Summer internships'
    ],
    search_tips: [
      'Search by category: Web Development, Android, Machine Learning',
      'Filter by duration: 2–3 months for summer',
      'Filter: "Part-time" if you need to attend college simultaneously',
      'Apply to 10–15 internships per week — numbers game',
      'Write a cover letter for each application — most students do not'
    ],
    red_flags: [
      'Companies asking for money to "process" your application',
      'No clear deliverables mentioned',
      '"Certificate only" internships with no learning description',
      'Stipend listed as "Performance-based" with no base'
    ],
    profile_tips: [
      'Complete all profile sections — Internshala ranks complete profiles higher',
      'Add academic projects even if small',
      'Take at least one Internshala training course — shows on profile'
    ],
    typical_response_time: '1–7 days'
  },
  {
    id: 'unstop',
    name: 'Unstop (formerly D2C)',
    url: 'https://unstop.com/',
    logo_emoji: '🏆',
    type: 'community',
    best_for: [
      'Hackathons and competitions (win = strong resume line)',
      'Case study competitions (good for non-CS roles)',
      'Campus ambassador programs',
      'Some internship listings from mid-size companies'
    ],
    search_tips: [
      'Filter: Competitions → by your domain (Tech, Business, Design)',
      'Apply to hackathons 2–3 weeks before deadline',
      'Team-based hackathons: form a team of mixed skills (CSE + MBA)',
      'Solo competitions: better for certifications and scholarships'
    ],
    red_flags: [
      'Competitions with registration fees over ₹200',
      'Vague prize descriptions'
    ],
    profile_tips: [
      'Add all competition participations — even non-wins count',
      'Connect your GitHub to show coding activity'
    ],
    typical_response_time: 'Competition results: 2–4 weeks after deadline'
  },
  {
    id: 'naukri',
    name: 'Naukri.com',
    url: 'https://www.naukri.com/',
    logo_emoji: '📋',
    type: 'job_portal',
    best_for: [
      'IT service companies',
      'Core engineering roles (Mech, Civil, EE)',
      'BFSI sector internships',
      'Searching for full-time roles (better for final year)'
    ],
    search_tips: [
      'Search: "Internship" + "Fresher" + your skill',
      'Upload resume in the Naukri format — their parser is specific',
      'Set "Job Alert" for your keywords',
      'Recruiter messages on Naukri are often from third-party agencies — verify the company directly'
    ],
    red_flags: [
      'Recruiter asks for personal documents before interview',
      'Salary/stipend not mentioned',
      '"Joining fee" or "security deposit" requests'
    ],
    profile_tips: [
      'Keep resume updated monthly — Naukri shows "last updated" to recruiters',
      'Add all skills from your resume as searchable keywords',
      'Headline matters: "B.Tech CSE | Java | SQL | 2026 Passout"'
    ],
    typical_response_time: '7–21 days'
  },
  {
    id: 'company_careers',
    name: 'Company Career Pages',
    url: '',
    logo_emoji: '🏢',
    type: 'company_direct',
    best_for: [
      'Product companies (Google, Microsoft, Amazon, Adobe)',
      'Direct applications with higher conversion rate',
      'Companies not posting on job portals'
    ],
    search_tips: [
      'Google: "[Company name] internship 2025 apply"',
      'Most companies: careers.[company].com',
      'Set calendar reminder to check quarterly — many open in Jan and July',
      'Google STEP, Microsoft Explore, Amazon Future Engineer — special programs for students'
    ],
    red_flags: [
      'Application portals that are not on the official company domain',
      'Third-party recruiters claiming to represent big companies without verification'
    ],
    profile_tips: [
      'Tailor your resume specifically for each company',
      'Research the team and role before applying',
      'Referrals dramatically increase chances — find alumni at the company'
    ],
    typical_response_time: '2–6 weeks for product companies'
  }
]

export interface ApplicationStrategy {
  phase: string
  timeline: string
  actions: string[]
}

export const APPLICATION_STRATEGY: ApplicationStrategy[] = [
  {
    phase: 'Month 1 — Prepare',
    timeline: 'Before applying to anything',
    actions: [
      'Complete your resume (use EduNexus Resume Builder)',
      'Build one project you can talk about confidently',
      'Set up LinkedIn with a photo and proper headline',
      'Practice "Tell me about yourself" until it sounds natural'
    ]
  },
  {
    phase: 'Month 2 — Apply widely',
    timeline: 'First application wave',
    actions: [
      'Apply to 10–15 roles per week across Internshala + LinkedIn',
      'Keep a spreadsheet: company, role, date applied, status',
      'Follow up after 1 week if no response',
      'Treat every rejection as data — note why (skills gap? resume?)'
    ]
  },
  {
    phase: 'Month 3 — Convert',
    timeline: 'Interviews and offers',
    actions: [
      'Prepare for each interview: research the company specifically',
      'Practice the project explanation 10+ times out loud',
      'Do not accept the first offer immediately — you have time',
      'Negotiate start date if needed for exams'
    ]
  }
]
