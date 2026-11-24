// Three-level, arXiv-style subject tree:  field → archive category → MSC2020 class.
// Problems carry MSC codes (formal-conjectures' `AMS n` attribute); the category is derived from them.

export const FIELDS = [
  { code: "math", name: "Mathematics", active: true },
  { code: "physics", name: "Physics", active: true, note: "Mathematical physics in Lean: quantum information problems (formal-conjectures) and Physlib statements awaiting formalization" },
  { code: "ml", name: "Machine learning theory", active: false, note: "Learning theory and optimization — in preparation" },
  { code: "chem", name: "Chemistry", active: false, note: "Under study: hardly any Lean formalization exists yet" },
];

export const CATEGORIES = {
  "math.AC": "Commutative Algebra", "math.AG": "Algebraic Geometry", "math.AP": "Analysis of PDEs",
  "math.AT": "Algebraic Topology", "math.CA": "Classical Analysis and ODEs", "math.CO": "Combinatorics",
  "math.CT": "Category Theory", "math.CV": "Complex Variables", "math.DG": "Differential Geometry",
  "math.DS": "Dynamical Systems", "math.FA": "Functional Analysis", "math.GM": "General Mathematics",
  "math.GN": "General Topology", "math.GR": "Group Theory", "math.GT": "Geometric Topology",
  "math.HO": "History and Overview", "math.IT": "Information Theory", "math.KT": "K-Theory and Homology",
  "math.LO": "Logic", "math.MG": "Metric Geometry", "math.MP": "Mathematical Physics",
  "math.NA": "Numerical Analysis", "math.NT": "Number Theory", "math.OA": "Operator Algebras",
  "math.OC": "Optimization and Control", "math.PR": "Probability", "math.QA": "Quantum Algebra",
  "math.RA": "Rings and Algebras", "math.RT": "Representation Theory", "math.SP": "Spectral Theory",
  "math.ST": "Statistics Theory", "math.SG": "Symplectic Geometry",
  "physics.class-ph": "Classical Mechanics", "physics.em": "Electromagnetism and Optics",
  "physics.relativity": "Relativity and Cosmology", "physics.quant-ph": "Quantum Mechanics",
  "physics.quantum-info": "Quantum Information", "physics.stat-mech": "Statistical Mechanics and Thermodynamics",
  "physics.hep": "High Energy Physics and QFT", "physics.cond-mat": "Condensed Matter",
  "physics.math-ph": "Mathematical Physics",
  "ml.theory": "Learning Theory", "ml.optimization": "Optimization for ML",
  "chem.general": "Chemistry",
};

/** Physlib top-level directories → physics category. */
export const PHYSLIB_CATEGORY = {
  ClassicalMechanics: "physics.class-ph", ClassicalFieldTheory: "physics.class-ph", Mechanics: "physics.class-ph",
  Electromagnetism: "physics.em", Optics: "physics.em",
  Relativity: "physics.relativity", Cosmology: "physics.relativity", SpaceAndTime: "physics.relativity",
  QuantumMechanics: "physics.quant-ph", QuantumInfo: "physics.quantum-info",
  StatisticalMechanics: "physics.stat-mech", Thermodynamics: "physics.stat-mech",
  QFT: "physics.hep", Particles: "physics.hep", StringTheory: "physics.hep", Units: "physics.math-ph",
  CondensedMatter: "physics.cond-mat",
};

/** Collections whose problems belong to another field than their MSC codes suggest. */
export const COLLECTION_FIELD = { quantum: { field: "physics", primary: "physics.quantum-info" } };

export const MSC = {
  "00": ["General and overarching topics", "math.GM"], "01": ["History and biography", "math.HO"],
  "03": ["Mathematical logic and foundations", "math.LO"], "05": ["Combinatorics", "math.CO"],
  "06": ["Order, lattices, ordered algebraic structures", "math.CO"], "08": ["General algebraic systems", "math.RA"],
  "11": ["Number theory", "math.NT"], "12": ["Field theory and polynomials", "math.AC"],
  "13": ["Commutative algebra", "math.AC"], "14": ["Algebraic geometry", "math.AG"],
  "15": ["Linear and multilinear algebra; matrix theory", "math.RA"], "16": ["Associative rings and algebras", "math.RA"],
  "17": ["Nonassociative rings and algebras", "math.RA"], "18": ["Category theory; homological algebra", "math.CT"],
  "19": ["K-theory", "math.KT"], "20": ["Group theory and generalizations", "math.GR"],
  "22": ["Topological groups, Lie groups", "math.GR"], "26": ["Real functions", "math.CA"],
  "28": ["Measure and integration", "math.CA"], "30": ["Functions of a complex variable", "math.CV"],
  "31": ["Potential theory", "math.CA"], "32": ["Several complex variables and analytic spaces", "math.CV"],
  "33": ["Special functions", "math.CA"], "34": ["Ordinary differential equations", "math.CA"],
  "35": ["Partial differential equations", "math.AP"], "37": ["Dynamical systems and ergodic theory", "math.DS"],
  "39": ["Difference and functional equations", "math.CA"], "40": ["Sequences, series, summability", "math.CA"],
  "41": ["Approximations and expansions", "math.CA"], "42": ["Harmonic analysis on Euclidean spaces", "math.CA"],
  "43": ["Abstract harmonic analysis", "math.FA"], "44": ["Integral transforms, operational calculus", "math.CA"],
  "45": ["Integral equations", "math.FA"], "46": ["Functional analysis", "math.FA"],
  "47": ["Operator theory", "math.FA"], "49": ["Calculus of variations and optimal control", "math.OC"],
  "51": ["Geometry", "math.MG"], "52": ["Convex and discrete geometry", "math.MG"],
  "53": ["Differential geometry", "math.DG"], "54": ["General topology", "math.GN"],
  "55": ["Algebraic topology", "math.AT"], "57": ["Manifolds and cell complexes", "math.GT"],
  "58": ["Global analysis, analysis on manifolds", "math.DG"], "60": ["Probability theory and stochastic processes", "math.PR"],
  "62": ["Statistics", "math.ST"], "65": ["Numerical analysis", "math.NA"],
  "68": ["Computer science", "math.CO"], "70": ["Mechanics of particles and systems", "math.MP"],
  "74": ["Mechanics of deformable solids", "math.MP"], "76": ["Fluid mechanics", "math.MP"],
  "78": ["Optics, electromagnetic theory", "math.MP"], "80": ["Classical thermodynamics, heat transfer", "math.MP"],
  "81": ["Quantum theory", "math.MP"], "82": ["Statistical mechanics, structure of matter", "math.MP"],
  "83": ["Relativity and gravitational theory", "math.MP"], "85": ["Astronomy and astrophysics", "math.MP"],
  "86": ["Geophysics", "math.MP"], "90": ["Operations research, mathematical programming", "math.OC"],
  "91": ["Game theory, economics, social sciences", "math.OC"], "92": ["Biology and other natural sciences", "math.GM"],
  "93": ["Systems theory; control", "math.OC"], "94": ["Information and communication theory", "math.IT"],
  "97": ["Mathematics education", "math.HO"],
};

export const COLLECTIONS = {
  ErdosProblems: ["erdos", "Erdős Problems", "https://www.erdosproblems.com"],
  OEIS: ["oeis", "OEIS conjectures", "https://oeis.org"],
  Wikipedia: ["wikipedia", "Wikipedia lists of open problems", "https://en.wikipedia.org"],
  Millennium: ["millennium", "Millennium Prize Problems", "https://www.claymath.org"],
  HilbertProblems: ["hilbert", "Hilbert's problems", null],
  Kourovka: ["kourovka", "Kourovka Notebook", null],
  GreensOpenProblems: ["green", "Ben Green's 100 open problems", null],
  Mathoverflow: ["mathoverflow", "MathOverflow", "https://mathoverflow.net"],
  Arxiv: ["arxiv", "Problems from arXiv papers", "https://arxiv.org"],
  Books: ["books", "Problems from books", null],
  LittProblems: ["litt", "Daniel Litt's problems", null],
  Paper: ["papers", "Problems from papers", null],
  OpenQuantumProblems: ["quantum", "Open quantum problems", null],
  OptimizationConstants: ["constants", "Optimization constants", null],
  Other: ["other", "Other sources", null],
  Subsets: ["subsets", "Subsets", null],
  WrittenOnTheWallII: ["wotw", "Written on the Wall II", null],
};

export const categoryForMsc = (code) => MSC[code]?.[1] ?? "math.GM";
