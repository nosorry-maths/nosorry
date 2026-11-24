# Veille : physique (et autres domaines) formalisés en Lean 4 pour nosorry

*Date : 2026-11-23. Les points marqués **[à vérifier]** n'ont pas été confirmés sur une source primaire pendant cette veille.*

## 1) Résumé

- **Physlib** (ex-HepLean, puis PhysLean, aujourd'hui `leanprover-community/physlib`) est la référence. Il a fusionné avec **Lean-QuantumInfo** (Alex Meiburg). Licence Apache-2.0 **[à vérifier]**, dépend de Mathlib à une version épinglée.
- Physlib reste volontairement *sans sorry*. Les problèmes ouverts se trouvent dans la **TODO list** générée à partir des tags `/-! TODO ... -/` (physlean.com/TODOList), dans les **informal lemmas/defs** et dans les déclarations `sorryful` proposées en 2025.
- Trois bancs d'essai « physique en Lean 4 » existent, tous composés d'énoncés résolus ou résolubles (de niveau exercice) : **LeanPhysBench** (200 énoncés, arXiv 2510.26094, ICLR 2026), **PhysLeanData/PhysProver** (~5 000 énoncés d'entraînement + ~250 de test, arXiv 2601.15737), **FormalPhysics/FormalScience** (200 énoncés avec preuves, arXiv 2604.23002).
- Le dossier formal-conjectures contient `OpenQuantumProblems` **[à vérifier : chemin exact et nombre de fichiers]**. Il s'importe avec le pipeline actuel de la plateforme, sans changement.
- Lean vérifie bien la physique mathématique : algèbre, analyse réelle, opérateurs et théorie quantique de l'information. Il vérifie mal la modélisation, les unités (support partiel seulement), le numérique et les ordres de grandeur.
- Recommandation : (1) importer OpenQuantumProblems, (2) importer LeanPhysBench et PhysLeanData en catégorie « exercice », (3) transformer la TODO list de Physlib en problèmes ouverts, après traduction manuelle. Pour le numérique, ajouter une seconde voie de vérification qui n'utilise pas Lean (interval arithmetic, CAS, tests).

## 2) Tableau des sources

| Nom | Domaine | Taille | Ouvert/résolu | Vérifiable Lean 4 tel quel ? | Licence | Lien |
|---|---|---|---|---|---|---|
| Physlib (ex-PhysLean/HepLean) | HEP, QFT (Wick), mécanique classique et quantique, EM, relativité, thermo, info quantique | Grande bibliothèque (plusieurs milliers de déclarations) | Résolu, plus une TODO list ouverte | Oui. Lake avec un Mathlib épinglé, sans sorry dans la branche principale | Apache-2.0 [à vérifier] | github.com/leanprover-community/physlib |
| Lean-QuantumInfo (fusionné dans Physlib) | Entropies, canaux, états, Stein quantique | Moyenne | Résolu, avec quelques sorry historiques [à vérifier] | Oui, via Physlib | Apache-2.0 [à vérifier] | github.com/Timeroot/Lean-QuantumInfo |
| formal-conjectures / OpenQuantumProblems | Problèmes ouverts d'info quantique (liste IQOQI) | Dizaines [à vérifier] | **Ouvert** | Oui (énoncés avec `sorry`, même format que l'existant) | Apache-2.0 | github.com/google-deepmind/formal-conjectures |
| LeanPhysBench / Lean4PHYS (avec PhysLib, à ne pas confondre avec Physlib) | Physique universitaire (manuels, compétitions) | 200 énoncés | Résolu (énoncés seuls) | Oui, mais dépend de la bibliothèque PhysLib du papier (unités et dimensions) | À vérifier sur le dépôt | arxiv.org/abs/2510.26094 |
| PhysLeanData (PhysProver) | Lemmes Physlib et lemmes synthétiques générés par Claude | ~5 000 (train) + ~250 (test) | Résolu | Oui, contre Physlib à une version précise. Énoncés synthétiques : vérifier le sens physique | À vérifier | github.com/hanningzhang/PhysProver ; arxiv.org/abs/2601.15737 |
| FormalPhysics (FormalScience) | Physique, autoformalisation | 200 énoncés avec preuves LaTeX et Lean | Résolu | Oui [version à vérifier] | À vérifier | arxiv.org/abs/2604.23002 |
| HF `phanerozoic/Lean4-PhysLean` | Extraction des déclarations de PhysLean | Inconnue | Résolu | Dérivé (prendre plutôt la source) | À vérifier | huggingface.co/datasets/phanerozoic/Lean4-PhysLean |
| Mathlib (ODE, mesure/probabilités, analyse, `InnerProductSpace`, Picard–Lindelöf) | Fondations mathématiques | Très grande | Résolu | Oui | Apache-2.0 | github.com/leanprover-community/mathlib4 |
| Optlib (Li et al.) | Optimisation convexe, convergence de la descente de gradient et de méthodes proximales | Moyenne | Résolu | Oui, avec un Mathlib épinglé (souvent ancien) | Apache-2.0 [à vérifier] | github.com/optsuite/optlib |
| Formalisations de learning theory (bornes de Rademacher, PAC, VC) | IA/ML théorie | Petites | Résolu | Oui [dépôts épars, à vérifier] | Variable | ex. travaux 2025 « generalization bounds in Lean 4 » [à vérifier] |
| SciLean (Tomáš Skřivan) | Calcul scientifique et différentiation automatique en Lean | Moyenne | N/A (outil) | Non adapté : contient des axiomes et `sorry` assumés (calcul, pas preuve) | Apache-2.0 [à vérifier] | github.com/lecopivo/SciLean |
| Isabelle AFP `Physical_Quantities` (Foster) et HOL-Analysis | Unités/dimensions typées, analyse | Moyenne | Résolu | Non (Isabelle) | BSD (AFP) | isa-afp.org |

## 3) Par cas d'usage, avec des exemples concrets

- **IA / ML théorie.** Convergence de la descente de gradient pour une fonction L-lisse et convexe en O(1/k) (Optlib). Borne de généralisation par complexité de Rademacher. Lemme de Hoeffding et inégalités de concentration (Mathlib dispose de briques sur les sous-gaussiennes, **[à vérifier]**). Problèmes ouverts possibles : taux exacts de SGD sous des hypothèses non standard, à formaliser nous-mêmes et en petit nombre.
- **Mécanique.** Conservation de l'énergie pour un oscillateur harmonique (Physlib `ClassicalMechanics.HarmonicOscillator`). Équations d'Euler–Lagrange. Existence et unicité d'une trajectoire (Picard–Lindelöf dans Mathlib). Exercices LeanPhysBench du type « une masse en chute libre atteint une vitesse v = √(2gh) ».
- **Quantique / info quantique.** Spectre de l'oscillateur harmonique quantique (Physlib). Monotonie de l'entropie relative quantique sous un canal (Lean-QuantumInfo). Problèmes **ouverts** issus de la liste IQOQI (formal-conjectures), par exemple des conjectures sur les MUB (mutually unbiased bases) en dimension 6 et l'additivité de certaines capacités **[contenu exact à vérifier]**.
- **Thermo / stat-mech.** La couverture est faible. Physlib a des débuts (ensembles canoniques, fonction de partition **[à vérifier]**). Exemple d'exercice : « l'entropie de Gibbs est maximale pour la distribution uniforme ». Mathlib apporte la partie probabilités.
- **Électromagnétisme.** Équations de Maxwell sous forme tensorielle et invariance de jauge (Physlib `Electromagnetism`). Exercice : vérifier qu'une onde plane satisfait les équations dans le vide.
- **Relativité.** Groupe de Lorentz, espace de Minkowski, composition des vitesses (Physlib `Relativity`). Exercice : invariance de l'intervalle sous un boost.
- **HEP / QFT.** Théorème de Wick (arXiv 2505.07939), annulation des anomalies du modèle standard, champs de Higgs. Ce sont les points forts historiques d'HepLean.
- **Éducation.** LeanPhysBench (manuels universitaires et compétitions) et FormalPhysics. Ils se prêtent à un parcours « exercices » noté, distinct des problèmes ouverts.

## 4) Ce que Lean/Physlib peut et ne peut pas vérifier

**Peut vérifier :** toute affirmation mathématique bien posée sur ℝ, ℂ, des espaces de Hilbert de dimension finie, des groupes de Lie matriciels, des EDO (existence), des inégalités et des identités tensorielles. Le noyau garantit la preuve. L'audit d'axiomes (`propext`, `Classical.choice`, `Quot.sound`) suffit.

**Limites :**
- **Unités et dimensions.** Le support est partiel. LeanPhysBench utilise sa propre couche d'unités, Physlib a des travaux en cours. Souvent, les énoncés se réduisent à des réels « sans dimension ». Une erreur d'unité dans la formalisation passe alors inaperçue.
- **Modélisation.** Lean prouve l'énoncé formel, pas sa fidélité au phénomène physique. Le risque de *statement mismatch* est plus élevé qu'en mathématiques. Les énoncés synthétiques de PhysLeanData sont particulièrement exposés.
- **Numérique.** Un calcul flottant ne constitue pas une preuve. `norm_num` et `interval_cases` couvrent les rationnels. Pour les bornes sur des transcendantes, il existe des tactiques d'intervalle expérimentales **[à vérifier]**.
- **Physique heuristique.** Intégrales de chemin, renormalisation et limites non rigoureuses ne sont pas formalisables sans axiomes ad hoc. Il faut les refuser ou les étiqueter.
- **Dérive de versions.** Chaque source épingle une version de Mathlib ou Physlib différente. La plateforme doit fixer un toolchain par catégorie.

## 5) Alternatives par type de problème et vérification automatique

| Type | Outil | Vérification automatique |
|---|---|---|
| Bornes numériques certifiées (constantes, intégrales) | Lean avec arithmétique d'intervalles et certificats rationnels. Rocq/Coq `Interval` et `CoqInterval`. Isabelle `Approximation` | Vérification du certificat par le noyau du prouveur |
| Arithmétique réelle non linéaire (inégalités, équilibres) | z3 et cvc5 (polynômes), **dReal** (δ-complet, fonctions transcendantes), certificats SOS/Positivstellensatz rejoués en Lean (`polyrith`, `linear_combination`) | Rejouer le certificat dans Lean. Une sortie dReal « δ-sat » ne suffit pas comme preuve |
| Gros calculs (style Flyspeck) | Certificats générés hors ligne et vérifiés par un checker formel (HOL Light, Isabelle) | Checker déterministe et code de vérification signé |
| Réponse analytique (« donner l'expression de T ») | CAS (SymPy, Mathematica) : simplifier `soumis − référence` jusqu'à 0, et tester l'égalité en des points aléatoires | Équivalence symbolique, plus des tests numériques et un contrôle dimensionnel (Pint, `sympy.physics.units`) |
| Réponse numérique (benchmarks type PhysicsEval, OlympiadBench, SciBench) | Comparaison avec une tolérance relative et conversion d'unités | Autograder avec tolérance. Pas de preuve, donc catégorie « non certifié » |
| Simulation | Tests unitaires et propriétés (conservation de l'énergie, symétries, convergence en h), dans un bac à sable | Suite de tests cachée |
| Unités typées | Isabelle AFP `Physical_Quantities`, F#, Pint | Vérification de types |
| Chimie | Quasi absente en Lean. Quelques prototypes (stœchiométrie, équilibrage de réactions) **[aucun dépôt « Chem-Lean » de référence trouvé]** | Équilibrage = algèbre linéaire entière, vérifiable en Lean (`decide`/`norm_num`). Le reste passe par RDKit et des réponses numériques |

## 6) Recommandation d'intégration

1. **Phase 1 (immédiat, coût faible).** Importer `OpenQuantumProblems` depuis formal-conjectures avec le pipeline existant (même toolchain, même audit). Catégorie `physics.quantum-info.open`.
2. **Phase 2 (exercices).** Importer LeanPhysBench, le split test de PhysLeanData et FormalPhysics, avec un tag `exercise` séparé des problèmes ouverts. Chaque import se fait dans un projet Lake dédié qui épingle Physlib et Mathlib aux versions des papiers, ou bien ses énoncés sont réécrits pour le toolchain courant. Les solutions de référence restent privées pour éviter que les agents les récupèrent.
3. **Phase 3 (vrais problèmes ouverts physiques).** Parser la TODO list de Physlib, les informal lemmas et les déclarations `sorryful`. Un humain formalise ensuite chaque énoncé et le relit (statement match). Il faut prendre contact avec les mainteneurs de Physlib pour que les preuves acceptées remontent en PR.
4. **Taxonomie.** `physics.mechanics`, `physics.em`, `physics.relativity`, `physics.quantum`, `physics.quantum-info`, `physics.statmech`, `physics.hep`, `ml.theory`, `ml.optimization`, `chem.*`. Chaque problème porte en plus un niveau de vérification : `lean-kernel` / `certificate` / `cas` / `numeric-tolerance`.
5. **Garde-fous.**
   - Interdire `axiom`, `sorry`, `native_decide` (ou le signaler) et `implemented_by` dans les soumissions.
   - Refuser les dépendances SciLean, qui contiennent des axiomes.
   - Figer l'énoncé par hash.
   - Faire relire par un physicien les énoncés qui touchent à la modélisation.
   - Afficher clairement « non certifié formellement » pour les voies CAS et numérique.
   - Timeouts et bac à sable pour les solveurs externes.
   - Ne jamais accepter un résultat dReal ou SMT sans certificat rejoué.

## 7) Sources

- Physlib : https://github.com/leanprover-community/physlib ; Reservoir : https://reservoir.lean-lang.org/@HEPLean/PhysLean ; Zulip (sorryful) : https://leanprover-community.github.io/archive/stream/479953-PhysLean/topic/sorryful_lemma.3F.html ; nLab : https://ncatlab.org/nlab/show/PhysLean
- Wick en Lean : https://arxiv.org/pdf/2505.07939
- Lean4Physics / LeanPhysBench : https://arxiv.org/abs/2510.26094 ; https://iclr.cc/virtual/2026/poster/10006731
- PhysProver : https://arxiv.org/abs/2601.15737 ; https://github.com/hanningzhang/PhysProver
- FormalScience : https://arxiv.org/pdf/2604.23002
- HF : https://huggingface.co/datasets/phanerozoic/Lean4-PhysLean
- formal-conjectures : https://github.com/google-deepmind/formal-conjectures
- Lean-QuantumInfo : https://github.com/Timeroot/Lean-QuantumInfo [lien à vérifier]
- Optlib : https://github.com/optsuite/optlib [à vérifier] ; SciLean : https://github.com/lecopivo/SciLean ; dReal : https://github.com/dreal/dreal4 ; AFP : https://www.isa-afp.org
