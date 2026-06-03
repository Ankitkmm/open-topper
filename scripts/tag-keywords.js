/**
 * tag-keywords.js
 *
 * Enriches questions.json with UPSC keywords extracted from:
 * 1. Question text matching against a master keyword taxonomy
 * 2. Syllabus tag pattern recognition
 * 3. Category-based default keywords
 *
 * Outputs: updated questions.json + keyword-index.json
 */

const fs = require("fs");
const path = require("path");

const QUESTIONS_FILE = path.join(
  __dirname,
  "..",
  "public",
  "data",
  "questions.json",
);
const KEYWORD_INDEX_FILE = path.join(
  __dirname,
  "..",
  "public",
  "data",
  "keyword-index.json",
);

// ─── Master UPSC Keyword Taxonomy ─────────────────────────────────────────
const KEYWORDS = [
  // Polity & Governance
  "Accountability",
  "Amendments",
  "Article 19",
  "Article 21",
  "Basic Structure",
  "Cabinet System",
  "CAG",
  "Centre-State Relations",
  "Citizen Charter",
  "Civil Services",
  "Code of Conduct",
  "Code of Ethics",
  "Comparative Constitution",
  "Conflict of Interest",
  "Constitution",
  "Constitutional Bodies",
  "Conventions",
  "Corporate Governance",
  "Corruption",
  "DPSP",
  "Electoral Reforms",
  "Evolution Indian Constitution",
  "Executive",
  "Federalism",
  "FR",
  "Good Governance",
  "Governance",
  "Judicial Review Activism",
  "Judiciary",
  "Laws Rules Regulations",
  "Legal Aid",
  "Legislature",
  "Local Self Government",
  "Mission Karmayogi",
  "Non-Constitutional Bodies",
  "Parliamentary System",
  "PIL",
  "Planning",
  "Polity",
  "Preamble",
  "Pressure Groups",
  "Probity in Governance",
  "Reorganization of States",
  "RLBs",
  "RPA",
  "Salient Features",
  "Secularism",
  "Significant Provisions",
  "State Executive",
  "State Legislature",
  "Tribunals",
  "ULBs",
  "Union Executive",
  "Union Territories",
  "Citizenship",

  // Ethics & Values
  "Civil Service Values",
  "Conscience",
  "Dedication to Public Service",
  "Determinants of Ethics",
  "Digital Ethics",
  "Dimensions of Ethics",
  "Emotional Intelligence",
  "Environmental Ethics",
  "Ethical Relativism",
  "Ethics in IR",
  "Ethics in Public Administration",
  "Gender and Ethics",
  "Moral Thinkers",
  "Morals",
  "Values",
  "Work Culture",

  // Society & Social Issues
  "Caste",
  "Children",
  "Civil Society",
  "Communalism",
  "Demography",
  "Diversity of India",
  "Education",
  "Family",
  "Family System",
  "Gender Equality",
  "Health",
  "Hunger",
  "Inequality and Exclusion",
  "Marriage",
  "Middle Class",
  "Migration",
  "Population",
  "Poverty",
  "Regionalism",
  "Religion",
  "SHG",
  "Social Empowerment",
  "Social Justice",
  "Social Media",
  "Socialization",
  "Society",
  "Suicide",
  "Tribals",
  "Urbanization",
  "Vulnerable Sections",
  "Women",
  "Women Empowerment",

  // History & Culture
  "Ancient India",
  "Architecture",
  "Art and Culture",
  "Bhakti Movement",
  "Brahmo Samaj",
  "British Policies and Its Impact",
  "Cholas",
  "Civil Disobedience Movement",
  "Colonialism",
  "Delhi Sultanate",
  "EIC",
  "Freedom Struggle",
  "French Revolution",
  "Gupta Period",
  "History",
  "IVC",
  "Literature",
  "Mahatma Gandhi",
  "Medieval India",
  "Moderates",
  "Modern India",
  "Mughals",
  "Non-Cooperation Movement",
  "Pallavas",
  "Post-Independence",
  "Quit India Movement",
  "Sculptures",
  "Socio-Religious Reforms",
  "Temple",
  "Vedic Period",
  "World History",
  "World War I",
  "World War II",
  "Young Bengal",

  // Geography & Environment
  "Agriculture",
  "Air Pollution",
  "Bio Technology",
  "Carbon Capture",
  "Climate Change",
  "Climatology",
  "Cloudbursts",
  "Coastal Management",
  "Conservation",
  "Crops",
  "Cyclones",
  "Dam Failures",
  "Deccan Trap",
  "Disaster Management",
  "Disaster Risk Reduction",
  "Disasters",
  "Drainage System",
  "Earthquakes",
  "Environment",
  "Environment Law",
  "Environment vs Development",
  "Environmental Impact Assessment",
  "Environmental Institutions",
  "Fishing",
  "Fjords",
  "Food Security",
  "Freshwater",
  "Geography",
  "Geomorphology",
  "Geophysical",
  "Geophysical Phenomena",
  "Global Warming",
  "Green Technology",
  "Groundwater",
  "Himalayas",
  "Human Geography",
  "IMD",
  "IPCC",
  "Irrigation",
  "Island States",
  "Isthmus",
  "Land Reforms",
  "Land Use",
  "Landslides",
  "Monsoon",
  "Natural Resources",
  "Oceanography",
  "Pollution",
  "Rubber",
  "Solar Energy",
  "Space and Universe",
  "Straits",
  "Sustainable Development",
  "Troposphere",
  "Tsunami",
  "Twister",
  "Urban Flooding",
  "Water",
  "Water Pollution",
  "Weather Events",
  "Weather Phenomena",
  "Wetlands",
  "Wind Energy",
  "WLS",

  // Economy
  "Budget",
  "Buffer Stocks",
  "Care Economy",
  "Cryptocurrency",
  "Economic Trends",
  "Economy",
  "Employment",
  "Energy Security",
  "Fiscal Policy",
  "Food Processing Industries",
  "Gig Economy",
  "Globalisation",
  "Inclusive Growth",
  "Industry",
  "Inflation",
  "Infrastructure",
  "Integrated Farming System",
  "IPR",
  "Labour",
  "Macroeconomic Indicators",
  "Manufacturing Sector",
  "Marketing of Agriculture Produce",
  "Mining",
  "Monetary Policy",
  "Money Laundering",
  "PDS",
  "Planning",
  "PLI",
  "Poverty",
  "Railways",
  "Skill Training",
  "Subsidies",
  "Supply Chain Management",
  "Tariffs and Trade Barriers",

  // IR & Security
  "Bilateral Relations",
  "Border Management",
  "Central Asia",
  "Foreign Policy",
  "Global Order",
  "India and its Neighborhood",
  "India-Africa",
  "India-China",
  "India-Maldives",
  "India-Sri Lanka",
  "India-USA",
  "Indian Diaspora",
  "Integration",
  "Internal Security",
  "International Institutions",
  "International Relations",
  "J and K",
  "LWE",
  "Maritime Security",
  "Narco-Terrorism",
  "NATO",
  "Naxalism",
  "NIEO",
  "North-East Insurgency",
  "Organized Crimes",
  "SCO",
  "Security Challenges",
  "Security Forces and Agencies",
  "Terror Financing",
  "Terrorism",
  "UNFCCC",
  "United Nations",

  // S&T & Tech
  "Applications of Tech",
  "Artificial Intelligence",
  "Cyber Security",
  "Defence Technology",
  "Digitalization",
  "ICT",
  "Nano Technology",
  "Nuclear Technology",
  "S and T",
  "Semiconductors",
  "Space Technology",
  "Technology",
  "UAVs",

  // Government Schemes & Policy
  "DBT",
  "Government Policies",
  "Green Energy",

  // Misc
  "Case Study",
  "Charitable Trusts",
  "Famines",
  "Human Development",
  "Human Resources",
  "Misc",
  "People's Participation",
  "Personalities",
  "Public Health",
  "Quote",
  "Statute",
  "Theory",
  "Work from Home",
];

// ─── Keyword aliases (lowercase → canonical) ─────────────────────────────
const ALIASES = {
  accountability: "Accountability",
  agriculture: "Agriculture",
  "air pollution": "Air Pollution",
  amendments: "Amendments",
  amendment: "Amendments",
  "ancient india": "Ancient India",
  ancient: "Ancient India",
  architecture: "Architecture",
  "art and culture": "Art and Culture",
  art: "Art and Culture",
  culture: "Art and Culture",
  "article 19": "Article 19",
  "article nineteen": "Article 19",
  "article 21": "Article 21",
  "article twenty one": "Article 21",
  "artificial intelligence": "Artificial Intelligence",
  ai: "Artificial Intelligence",
  "basic structure": "Basic Structure",
  bhakti: "Bhakti Movement",
  "bhakti movement": "Bhakti Movement",
  bilateral: "Bilateral Relations",
  "bilateral relations": "Bilateral Relations",
  biotechnology: "Bio Technology",
  border: "Border Management",
  "border management": "Border Management",
  brahmo: "Brahmo Samaj",
  "brahmo samaj": "Brahmo Samaj",
  british: "British Policies and Its Impact",
  "british policies": "British Policies and Its Impact",
  budget: "Budget",
  "buffer stock": "Buffer Stocks",
  "buffer stocks": "Buffer Stocks",
  cabinet: "Cabinet System",
  cag: "CAG",
  "carbon capture": "Carbon Capture",
  "care economy": "Care Economy",
  "case study": "Case Study",
  caste: "Caste",
  "central asia": "Central Asia",
  "centre-state": "Centre-State Relations",
  "centre state": "Centre-State Relations",
  charitable: "Charitable Trusts",
  children: "Children",
  cholas: "Cholas",
  chola: "Cholas",
  "citizen charter": "Citizen Charter",
  "civil disobedience": "Civil Disobedience Movement",
  "civil service": "Civil Services",
  "civil services": "Civil Services",
  "civil society": "Civil Society",
  "climate change": "Climate Change",
  climate: "Climate Change",
  climatology: "Climatology",
  cloudburst: "Cloudbursts",
  coastal: "Coastal Management",
  "code of conduct": "Code of Conduct",
  "code of ethics": "Code of Ethics",
  colonial: "Colonialism",
  colonialism: "Colonialism",
  communal: "Communalism",
  communalism: "Communalism",
  comparative: "Comparative Constitution",
  "conflict of interest": "Conflict of Interest",
  conscience: "Conscience",
  conservation: "Conservation",
  constitution: "Constitution",
  constitutional: "Constitutional Bodies",
  conventions: "Conventions",
  "corporate governance": "Corporate Governance",
  corruption: "Corruption",
  crops: "Crops",
  cryptocurrency: "Cryptocurrency",
  cyber: "Cyber Security",
  "cyber security": "Cyber Security",
  cyclone: "Cyclones",
  dbt: "DBT",
  dam: "Dam Failures",
  deccan: "Deccan Trap",
  defence: "Defence Technology",
  defense: "Defence Technology",
  "delhi sultanate": "Delhi Sultanate",
  demography: "Demography",
  digital: "Digitalization",
  digitalization: "Digitalization",
  "digital ethics": "Digital Ethics",
  disaster: "Disaster Management",
  "disaster management": "Disaster Management",
  "disaster risk": "Disaster Risk Reduction",
  diversity: "Diversity of India",
  dpsp: "DPSP",
  drainage: "Drainage System",
  earthquake: "Earthquakes",
  economic: "Economy",
  economy: "Economy",
  education: "Education",
  eic: "EIC",
  electoral: "Electoral Reforms",
  "emotional intelligence": "Emotional Intelligence",
  employment: "Employment",
  energy: "Energy Security",
  environment: "Environment",
  environmental: "Environment",
  "environment law": "Environment Law",
  "environmental ethics": "Environmental Ethics",
  eia: "Environmental Impact Assessment",
  ethical: "Dimensions of Ethics",
  ethics: "Dimensions of Ethics",
  evolution: "Evolution Indian Constitution",
  executive: "Executive",
  family: "Family",
  famine: "Famines",
  federal: "Federalism",
  federalism: "Federalism",
  fiscal: "Fiscal Policy",
  "food processing": "Food Processing Industries",
  "food security": "Food Security",
  "foreign policy": "Foreign Policy",
  "freedom struggle": "Freedom Struggle",
  "french revolution": "French Revolution",
  freshwater: "Freshwater",
  gender: "Gender Equality",
  "gender equality": "Gender Equality",
  geography: "Geography",
  geomorphology: "Geomorphology",
  geophysical: "Geophysical Phenomena",
  "gig economy": "Gig Economy",
  "global order": "Global Order",
  "global warming": "Global Warming",
  globalisation: "Globalisation",
  globalization: "Globalisation",
  "good governance": "Good Governance",
  governance: "Governance",
  "government policy": "Government Policies",
  "green energy": "Green Energy",
  "green technology": "Green Technology",
  groundwater: "Groundwater",
  gupta: "Gupta Period",
  health: "Health",
  himalayas: "Himalayas",
  history: "History",
  "human development": "Human Development",
  "human geography": "Human Geography",
  "human resources": "Human Resources",
  hunger: "Hunger",
  ict: "ICT",
  imd: "IMD",
  "inclusive growth": "Inclusive Growth",
  "india-africa": "India-Africa",
  "india-china": "India-China",
  "india-usa": "India-USA",
  "indian diaspora": "Indian Diaspora",
  industrial: "Industry",
  "industrial revolution": "Industrial Revolution",
  industry: "Industry",
  inequality: "Inequality and Exclusion",
  inflation: "Inflation",
  infrastructure: "Infrastructure",
  "internal security": "Internal Security",
  international: "International Relations",
  "international relations": "International Relations",
  ipcc: "IPCC",
  ipr: "IPR",
  irrigation: "Irrigation",
  ivc: "IVC",
  "jammu and kashmir": "J and K",
  judicial: "Judiciary",
  judiciary: "Judiciary",
  labour: "Labour",
  labor: "Labour",
  "land reforms": "Land Reforms",
  "land use": "Land Use",
  landslide: "Landslides",
  "legal aid": "Legal Aid",
  legislature: "Legislature",
  literature: "Literature",
  "local self government": "Local Self Government",
  lwe: "LWE",
  macroeconomic: "Macroeconomic Indicators",
  "mahatma gandhi": "Mahatma Gandhi",
  gandhi: "Mahatma Gandhi",
  manufacturing: "Manufacturing Sector",
  maritime: "Maritime Security",
  marriage: "Marriage",
  medieval: "Medieval India",
  "middle class": "Middle Class",
  migration: "Migration",
  mining: "Mining",
  "mission karmayogi": "Mission Karmayogi",
  "modern india": "Modern India",
  monetary: "Monetary Policy",
  "money laundering": "Money Laundering",
  monsoon: "Monsoon",
  moral: "Moral Thinkers",
  mughal: "Mughals",
  nano: "Nano Technology",
  narco: "Narco-Terrorism",
  nato: "NATO",
  "natural resources": "Natural Resources",
  naxalism: "Naxalism",
  nieo: "NIEO",
  "non-cooperation": "Non-Cooperation Movement",
  "north east": "North-East Insurgency",
  nuclear: "Nuclear Technology",
  oceanography: "Oceanography",
  "organized crime": "Organized Crimes",
  pallava: "Pallavas",
  parliamentary: "Parliamentary System",
  pds: "PDS",
  pil: "PIL",
  planning: "Planning",
  pli: "PLI",
  polity: "Polity",
  pollution: "Pollution",
  population: "Population",
  "post-independence": "Post-Independence",
  poverty: "Poverty",
  preamble: "Preamble",
  "pressure groups": "Pressure Groups",
  probity: "Probity in Governance",
  "public health": "Public Health",
  "quit india": "Quit India Movement",
  railways: "Railways",
  regionalism: "Regionalism",
  religion: "Religion",
  reorganization: "Reorganization of States",
  rpa: "RPA",
  "s&t": "S and T",
  science: "S and T",
  sco: "SCO",
  sculpture: "Sculptures",
  secularism: "Secularism",
  security: "Internal Security",
  semiconductor: "Semiconductors",
  shg: "SHG",
  skill: "Skill Training",
  "social empowerment": "Social Empowerment",
  "social justice": "Social Justice",
  "social media": "Social Media",
  socialization: "Socialization",
  "socio-religious": "Socio-Religious Reforms",
  solar: "Solar Energy",
  space: "Space Technology",
  subsidies: "Subsidies",
  subsidy: "Subsidies",
  suicide: "Suicide",
  "supply chain": "Supply Chain Management",
  sustainable: "Sustainable Development",
  tariff: "Tariffs and Trade Barriers",
  technology: "Technology",
  temple: "Temple",
  terror: "Terrorism",
  terrorism: "Terrorism",
  "terror financing": "Terror Financing",
  tribal: "Tribals",
  tribunals: "Tribunals",
  tsunami: "Tsunami",
  uav: "UAVs",
  ulb: "ULBs",
  unfccc: "UNFCCC",
  "united nations": "United Nations",
  un: "United Nations",
  urban: "Urban Development",
  urbanization: "Urbanization",
  values: "Values",
  vedic: "Vedic Period",
  vulnerable: "Vulnerable Sections",
  water: "Water",
  wetlands: "Wetlands",
  "wind energy": "Wind Energy",
  women: "Women",
  "women empowerment": "Women Empowerment",
  "work culture": "Work Culture",
  "world history": "World History",
  "world war": "World War I",
  wwi: "World War I",
  wwii: "World War II",
  "young bengal": "Young Bengal",
};

// ─── Syllabus tag → keyword mapping ───────────────────────────────────────
function syllabusToKeywords(syllabusTags) {
  const kw = new Set();
  for (const tag of syllabusTags) {
    const lower = tag.toLowerCase();
    // Paper-based extraction
    if (lower.includes("enlightenment")) {
      kw.add("World History");
      kw.add("French Revolution");
    }
    if (lower.includes("industrial revolution"))
      kw.add("Industrial Revolution");
    if (lower.includes("american revolution")) kw.add("World History");
    if (lower.includes("french revolution")) kw.add("French Revolution");
    if (lower.includes("nationalism")) kw.add("History");
    if (lower.includes("imperialism") || lower.includes("colonial"))
      kw.add("Colonialism");
    if (lower.includes("world war")) {
      kw.add("World War I");
      kw.add("World War II");
    }
    if (lower.includes("fascist") || lower.includes("fascism"))
      kw.add("World History");
    if (lower.includes("russian revolution")) kw.add("World History");
    if (lower.includes("chinese revolution")) kw.add("World History");
    if (lower.includes("cold war") || lower.includes("soviet"))
      kw.add("International Relations");
    if (lower.includes("european")) kw.add("International Relations");
    if (lower.includes("nato")) kw.add("NATO");
    if (lower.includes("european union") || lower.includes("eu"))
      kw.add("International Relations");
    if (lower.includes("apartheid")) kw.add("Africa");
    if (lower.includes("africa")) kw.add("Africa");
    if (lower.includes("latin america")) kw.add("World History");
    if (lower.includes("arab") || lower.includes("egypt"))
      kw.add("International Relations");
    if (lower.includes("uno") || lower.includes("united nations"))
      kw.add("United Nations");
    if (lower.includes("non-alignment") || lower.includes("nam"))
      kw.add("International Relations");
    if (lower.includes("british democratic") || lower.includes("chartis"))
      kw.add("British Policies and Its Impact");
    if (lower.includes("marx") || lower.includes("socialis")) {
      kw.add("Socio-Religious Reforms");
      kw.add("World History");
    }
  }
  return [...kw];
}

function tagQuestions() {
  console.log("📖 Reading questions.json...");
  const questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, "utf-8"));

  // Build keyword index
  const keywordIndex = {}; // keyword → [{id, question}]
  let totalTags = 0;

  for (const q of questions) {
    const text = (
      q.question +
      " " +
      (q.syllabus_tags || []).join(" ")
    ).toLowerCase();
    const matched = new Set();

    // 1. Match from question text
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      if (text.includes(alias)) {
        matched.add(canonical);
      }
    }

    // 2. Match from syllabus tags
    for (const kw of syllabusToKeywords(q.syllabus_tags || [])) {
      matched.add(kw);
    }

    // 3. Category-based defaults
    const cat = q.category;
    if (cat === "GS 1" || cat === "History") matched.add("History");
    if (cat === "GS 2") {
      matched.add("Polity");
      matched.add("Governance");
    }
    if (cat === "GS 3") {
      matched.add("Economy");
      matched.add("Environment");
    }
    if (cat === "GS 4") {
      matched.add("Dimensions of Ethics");
    }
    if (cat === "Essay") matched.add("Essay");
    if (cat === "Geography") matched.add("Geography");
    if (cat === "Sociology") matched.add("Society");
    if (cat === "PSIR") matched.add("International Relations");
    if (cat === "Anthropology") matched.add("Society");

    // 4. Limit to top 8 most relevant
    const keywords = [...matched].slice(0, 8);
    q.keywords = keywords;
    totalTags += keywords.length;

    // Build index
    for (const kw of keywords) {
      if (!keywordIndex[kw]) keywordIndex[kw] = [];
      keywordIndex[kw].push({ id: q.id, question: q.question.slice(0, 100) });
    }
  }

  // Write enriched questions
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions));
  console.log(
    `✅ Tagged ${questions.length} questions with ${totalTags} keywords`,
  );

  // Write keyword index
  const sorted = Object.entries(keywordIndex)
    .map(([keyword, entries]) => ({
      keyword,
      count: entries.length,
      questions: entries,
    }))
    .sort((a, b) => b.count - a.count);

  fs.writeFileSync(KEYWORD_INDEX_FILE, JSON.stringify(sorted));
  console.log(`📋 Keyword index: ${sorted.length} keywords`);
  console.log(
    `   Top 10: ${sorted
      .slice(0, 10)
      .map((k) => `${k.keyword}(${k.count})`)
      .join(", ")}`,
  );

  // Also write lightweight keywords.json (just keyword + count) for browser
  const lightweight = sorted.map(({ keyword, count }) => ({ keyword, count }));
  const KEYWORDS_LIGHT_FILE = path.join(
    __dirname,
    "..",
    "public",
    "data",
    "keywords.json",
  );
  fs.writeFileSync(KEYWORDS_LIGHT_FILE, JSON.stringify(lightweight));
  console.log(
    `📋 Lightweight keywords: ${lightweight.length} entries (${(fs.statSync(KEYWORDS_LIGHT_FILE).size / 1024).toFixed(1)} KB)`,
  );
}

tagQuestions();
