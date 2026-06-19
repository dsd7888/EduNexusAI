export interface MiniProjectStep {
  step: number
  title: string
  description: string
  resource_url: string | null
  resource_label: string | null
  estimated_hours: number
}

export interface MiniProject {
  id: string
  title: string
  tagline: string
  discipline: string[]        // ['engineering'] or ['commerce'] etc.
  branch_tags: string[]       // ['CSE', 'IT'] or ['All']
  difficulty: 'beginner' | 'intermediate'
  estimated_days: number      // realistic, for a college student
  tech_stack: string[]

  // What student gets
  objective: string
  what_youll_build: string    // one concrete sentence

  // Prerequisites — links to their subjects
  prerequisite_subjects: string[]   // must match subject names in DB
  prerequisite_concepts: string[]   // specific concepts needed

  // Steps
  steps: MiniProjectStep[]

  // Resume output
  resume_bullet_template: string    // template with [X] placeholders
  skills_to_add: string[]          // exact strings to add to resume skills

  // External resources
  reference_resources: Array<{
    label: string
    url: string
    type: 'tutorial' | 'docs' | 'video' | 'course'
  }>
}

export const MINI_PROJECTS: MiniProject[] = [
  {
    id: 'personal-portfolio',
    title: 'Personal Portfolio Website',
    tagline: 'Build a professional portfolio to showcase your projects',
    discipline: ['engineering'],
    branch_tags: ['CSE', 'IT', 'All'],
    difficulty: 'beginner',
    estimated_days: 7,
    tech_stack: ['HTML', 'CSS', 'JavaScript'],
    objective: 'Build a responsive personal portfolio website that you can link on your resume and share with recruiters.',
    what_youll_build: 'A multi-page portfolio site with About, Projects, Skills, and Contact sections, deployed live on GitHub Pages.',
    prerequisite_subjects: ['Introduction to Web Technologies', 'Basic Programming'],
    prerequisite_concepts: ['HTML structure', 'CSS styling', 'Basic JavaScript'],
    steps: [
      { step: 1, title: 'Set up project structure', description: 'Create index.html, style.css, script.js. Set up a GitHub repository.', resource_url: 'https://docs.github.com/en/get-started/quickstart/create-a-repo', resource_label: 'GitHub: Create a repository', estimated_hours: 1 },
      { step: 2, title: 'Build the HTML structure', description: 'Create semantic HTML for all sections: nav, hero, about, projects, skills, contact. Use proper heading hierarchy.', resource_url: 'https://www.w3schools.com/html/html5_semantic_elements.asp', resource_label: 'W3Schools: HTML Semantic Elements', estimated_hours: 2 },
      { step: 3, title: 'Style with CSS', description: 'Add responsive CSS using Flexbox for layout. Make it work on mobile. Use a consistent color scheme.', resource_url: 'https://css-tricks.com/snippets/css/a-guide-to-flexbox/', resource_label: 'CSS-Tricks: Flexbox Guide', estimated_hours: 3 },
      { step: 4, title: 'Add interactivity', description: 'Smooth scrolling, active nav highlighting, simple project card hover effects using JavaScript.', resource_url: 'https://www.w3schools.com/js/js_htmldom.asp', resource_label: 'W3Schools: JavaScript DOM', estimated_hours: 2 },
      { step: 5, title: 'Add your content', description: 'Fill in real information: your photo, bio, actual projects (even college assignments), skills, and contact links.', resource_url: null, resource_label: null, estimated_hours: 1 },
      { step: 6, title: 'Deploy on GitHub Pages', description: 'Push to GitHub, enable GitHub Pages in repository settings. Your site goes live at username.github.io/portfolio.', resource_url: 'https://pages.github.com/', resource_label: 'GitHub Pages: Getting Started', estimated_hours: 0.5 }
    ],
    resume_bullet_template: 'Built responsive personal portfolio with [N] project showcases, deployed on GitHub Pages',
    skills_to_add: ['HTML5', 'CSS3', 'JavaScript', 'Git', 'GitHub Pages'],
    reference_resources: [
      { label: 'freeCodeCamp Responsive Web Design', url: 'https://www.freecodecamp.org/learn/2022/responsive-web-design/', type: 'course' },
      { label: 'W3Schools HTML Tutorial', url: 'https://www.w3schools.com/html/', type: 'tutorial' },
      { label: 'Traversy Media Portfolio Tutorial (YouTube)', url: 'https://www.youtube.com/watch?v=ldwlOzRvYOU', type: 'video' }
    ]
  },
  {
    id: 'rest-api-crud',
    title: 'REST API with CRUD Operations',
    tagline: 'Build a backend API — the most asked-about project in IT interviews',
    discipline: ['engineering'],
    branch_tags: ['CSE', 'IT'],
    difficulty: 'intermediate',
    estimated_days: 10,
    tech_stack: ['Node.js', 'Express', 'MySQL'],
    objective: 'Build a RESTful API with full CRUD operations, connecting your DBMS knowledge to real backend development.',
    what_youll_build: 'A Student Management API with endpoints for Create, Read, Update, Delete — connected to a MySQL database.',
    prerequisite_subjects: ['Database Management System', 'Object Oriented Programming with Java'],
    prerequisite_concepts: ['SQL queries', 'HTTP methods', 'JSON format'],
    steps: [
      { step: 1, title: 'Install Node.js and set up project', description: 'Install Node.js, run npm init, install express and mysql2 packages.', resource_url: 'https://nodejs.org/en/download/', resource_label: 'Node.js Download', estimated_hours: 0.5 },
      { step: 2, title: 'Set up MySQL database', description: 'Create a database and students table with: id, name, email, branch, cgpa columns. This uses your DBMS knowledge directly.', resource_url: 'https://www.w3schools.com/mysql/mysql_create_table.asp', resource_label: 'W3Schools: MySQL CREATE TABLE', estimated_hours: 1 },
      { step: 3, title: 'Connect Express to MySQL', description: 'Create db.js with mysql2 connection pool. Test the connection.', resource_url: 'https://www.npmjs.com/package/mysql2', resource_label: 'mysql2 npm documentation', estimated_hours: 1 },
      { step: 4, title: 'Build CRUD routes', description: 'Create 5 API endpoints: GET /students (all), GET /students/:id (one), POST /students (create), PUT /students/:id (update), DELETE /students/:id (delete).', resource_url: 'https://expressjs.com/en/guide/routing.html', resource_label: 'Express.js Routing Guide', estimated_hours: 3 },
      { step: 5, title: 'Test with Postman', description: 'Download Postman, test each endpoint. Verify all 5 operations work. Take a screenshot for your portfolio.', resource_url: 'https://www.postman.com/downloads/', resource_label: 'Postman Download', estimated_hours: 1 },
      { step: 6, title: 'Add input validation and error handling', description: 'Add checks for missing fields, invalid IDs, duplicate emails. Return proper HTTP status codes (200, 201, 400, 404, 500).', resource_url: null, resource_label: null, estimated_hours: 1.5 },
      { step: 7, title: 'Push to GitHub with README', description: 'Write a README explaining what the API does, endpoints, and how to run it locally. This is what interviewers read.', resource_url: 'https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes', resource_label: 'GitHub: About READMEs', estimated_hours: 1 }
    ],
    resume_bullet_template: 'Developed REST API with 5 CRUD endpoints using Node.js and Express, connected to MySQL database',
    skills_to_add: ['Node.js', 'Express.js', 'REST APIs', 'MySQL', 'Postman'],
    reference_resources: [
      { label: 'Express.js Official Docs', url: 'https://expressjs.com/', type: 'docs' },
      { label: 'Traversy Media Node.js Crash Course', url: 'https://www.youtube.com/watch?v=fBNz5xF-Kx4', type: 'video' },
      { label: 'freeCodeCamp Back End APIs', url: 'https://www.freecodecamp.org/learn/back-end-development-and-apis/', type: 'course' }
    ]
  },
  {
    id: 'todo-app-react',
    title: 'Full-Stack Todo App',
    tagline: 'Classic project that covers frontend + backend + database',
    discipline: ['engineering'],
    branch_tags: ['CSE', 'IT'],
    difficulty: 'intermediate',
    estimated_days: 12,
    tech_stack: ['React', 'Node.js', 'Express', 'PostgreSQL'],
    objective: 'Build a complete full-stack application with a React frontend, Express backend, and PostgreSQL database.',
    what_youll_build: 'A Todo application with user authentication, CRUD operations on tasks, and a React UI — demonstrating the full web stack.',
    prerequisite_subjects: ['Database Management System', 'Introduction to Web Technologies'],
    prerequisite_concepts: ['SQL queries', 'HTML/CSS basics', 'JavaScript fundamentals'],
    steps: [
      { step: 1, title: 'Set up backend (Express + PostgreSQL)', description: 'Create Express server, connect to PostgreSQL, create users and todos tables.', resource_url: 'https://node-postgres.com/', resource_label: 'node-postgres documentation', estimated_hours: 2 },
      { step: 2, title: 'Build authentication routes', description: 'POST /register and POST /login using bcrypt for password hashing and JWT for tokens.', resource_url: 'https://jwt.io/introduction/', resource_label: 'JWT Introduction', estimated_hours: 2 },
      { step: 3, title: 'Build todo CRUD routes', description: 'Protected routes: GET/POST/PUT/DELETE /todos. Verify JWT on each request.', resource_url: null, resource_label: null, estimated_hours: 2 },
      { step: 4, title: 'Create React frontend', description: 'npx create-react-app or Vite. Build Login, Register, and Dashboard components.', resource_url: 'https://vitejs.dev/guide/', resource_label: 'Vite Getting Started', estimated_hours: 3 },
      { step: 5, title: 'Connect frontend to backend', description: 'Use fetch or axios to call your API. Store JWT in localStorage. Handle loading and error states.', resource_url: 'https://axios-http.com/docs/intro', resource_label: 'Axios Documentation', estimated_hours: 2 },
      { step: 6, title: 'Deploy both parts', description: 'Backend on Render (free tier), frontend on Vercel (free tier). Update API URL in frontend.', resource_url: 'https://render.com/docs/deploy-node-express-app', resource_label: 'Render: Deploy Express App', estimated_hours: 1 }
    ],
    resume_bullet_template: 'Built full-stack Todo application using React, Node.js, and PostgreSQL with JWT authentication',
    skills_to_add: ['React', 'Node.js', 'PostgreSQL', 'JWT', 'REST APIs', 'Vercel'],
    reference_resources: [
      { label: 'React Official Documentation', url: 'https://react.dev/', type: 'docs' },
      { label: 'Full Stack Open Course (Free)', url: 'https://fullstackopen.com/en/', type: 'course' },
      { label: 'Traversy Media MERN Stack Tutorial', url: 'https://www.youtube.com/watch?v=ktjafK4SgWM', type: 'video' }
    ]
  },
  {
    id: 'ml-classification',
    title: 'ML Classification Model',
    tagline: 'Entry-level machine learning project for data-focused roles',
    discipline: ['engineering'],
    branch_tags: ['CSE', 'IT'],
    difficulty: 'intermediate',
    estimated_days: 8,
    tech_stack: ['Python', 'scikit-learn', 'pandas', 'Jupyter Notebook'],
    objective: 'Build a classification model using a real dataset, covering data cleaning, training, evaluation, and interpretation.',
    what_youll_build: 'A model that predicts student placement outcomes using a Kaggle dataset, with a Jupyter notebook showing your process.',
    prerequisite_subjects: ['Mathematics', 'Programming in Python'],
    prerequisite_concepts: ['Basic statistics', 'Python basics', 'Loops and functions'],
    steps: [
      { step: 1, title: 'Set up environment', description: 'Install Anaconda or use Google Colab (no installation). Open a new Jupyter notebook.', resource_url: 'https://colab.research.google.com/', resource_label: 'Google Colab (free)', estimated_hours: 0.5 },
      { step: 2, title: 'Download and explore dataset', description: 'Use the Campus Recruitment Dataset from Kaggle. Load with pandas, run df.head(), df.info(), df.describe().', resource_url: 'https://www.kaggle.com/datasets/benroshan/factors-affecting-campus-placement', resource_label: 'Kaggle: Campus Recruitment Dataset', estimated_hours: 1 },
      { step: 3, title: 'Clean and preprocess data', description: 'Handle missing values, encode categorical columns (gender, stream) using LabelEncoder, split into train/test.', resource_url: 'https://scikit-learn.org/stable/modules/preprocessing.html', resource_label: 'scikit-learn: Preprocessing', estimated_hours: 1.5 },
      { step: 4, title: 'Train classification models', description: 'Train Logistic Regression, Decision Tree, and Random Forest. Compare accuracy scores.', resource_url: 'https://scikit-learn.org/stable/supervised_learning.html', resource_label: 'scikit-learn: Supervised Learning', estimated_hours: 2 },
      { step: 5, title: 'Evaluate and interpret', description: 'Generate confusion matrix and classification report. Identify which features matter most (feature importance).', resource_url: null, resource_label: null, estimated_hours: 1 },
      { step: 6, title: 'Document in notebook', description: 'Add markdown cells explaining each step, your findings, and accuracy achieved. This is what interviewers read.', resource_url: 'https://www.kaggle.com/code/dansbecker/your-first-machine-learning-model', resource_label: 'Kaggle: Your First ML Model', estimated_hours: 1 }
    ],
    resume_bullet_template: 'Built classification model achieving [X]% accuracy on Campus Recruitment dataset using scikit-learn',
    skills_to_add: ['Python', 'scikit-learn', 'pandas', 'Machine Learning', 'Jupyter Notebook'],
    reference_resources: [
      { label: 'Kaggle Learn: Intro to ML', url: 'https://www.kaggle.com/learn/intro-to-machine-learning', type: 'course' },
      { label: 'scikit-learn Documentation', url: 'https://scikit-learn.org/stable/', type: 'docs' },
      { label: 'Sentdex ML Tutorial (YouTube)', url: 'https://www.youtube.com/watch?v=OGxgnH8y2NM', type: 'video' }
    ]
  }
]

// Helper: get projects relevant to a student's branch
export function getProjectsForBranch(branch: string): MiniProject[] {
  if (!branch) return MINI_PROJECTS
  const b = branch.toLowerCase()

  // Map long-form branch names to tags
  const isCSE = b.includes('computer') || b.includes('cse') ||
                b.includes('software') || b.includes('information')
  const isMech = b.includes('mechanical') || b.includes('mech')
  const isCivil = b.includes('civil')
  const isEE = b.includes('electrical') || b.includes('electronics')

  return MINI_PROJECTS.filter(p => {
    if (p.branch_tags.includes('All')) return true
    if (isCSE && (p.branch_tags.includes('CSE') ||
                  p.branch_tags.includes('IT'))) return true
    if (isMech && p.branch_tags.includes('Mech')) return true
    if (isCivil && p.branch_tags.includes('Civil')) return true
    if (isEE && p.branch_tags.includes('EE')) return true
    return false
  })
}

// Helper: get projects that teach a specific skill
export function getProjectsForSkill(skill: string): MiniProject[] {
  const s = skill.toLowerCase()
  return MINI_PROJECTS.filter(p =>
    p.tech_stack.some(t => t.toLowerCase().includes(s)) ||
    p.skills_to_add.some(sk => sk.toLowerCase().includes(s))
  )
}
