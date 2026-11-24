# Veille : IA et résolution de problèmes mathématiques (et physiques), 2025 à nov. 2026

*Rédigée le 2026-11-23. Les sources sont surtout de la presse spécialisée et des preprints arXiv. Les chiffres qui ne viennent que d'une source secondaire sont signalés (≈ / « non confirmé »).*

## 1. Résumé

1. Depuis oct. 2025, l'IA a fait passer environ 100 problèmes d'Erdős au statut « résolu ». La majorité de ces cas viennent de recherches bibliographiques, quelques-uns de preuves vraiment originales (#728, #1196, #90).
2. 2026 marque un changement d'échelle. OpenAI a réfuté la conjecture des distances unitaires (#90, mai), puis publié d'un coup environ 719 manuscrits (oct.), dont seulement ≈58 % formalisés en Lean.
3. La vérification formelle s'impose comme le standard de crédibilité : Palomar, FrontierMath Erdős (Lean obligatoire), formal-conjectures (2615 énoncés).
4. Le risque n°1 n'est pas la fausse preuve. C'est **l'énoncé faux** : misformalisation, théorème vacuitaire, énoncé ambigu par rapport à l'intention d'Erdős.
5. Le risque n°2 est **l'attribution** : problèmes déjà résolus dans la littérature (#281), litiges de crédit (Navier-Stokes, sept. 2026).
6. Le risque n°3 est **la saturation humaine** : erdosproblems.com a gelé ses commentaires et ses revendications de preuve (≈ oct. 2026) sous un afflux de preuves IA non expliquées.
7. Côté Lean, `lean4checker` et SafeVerify ont été contournés par manipulation d'environnement (janv. 2026). Seul **Comparator** est recommandé en contexte adversarial.
8. Tao parle de « harvesting » des problèmes : sans compréhension humaine, ces résultats appauvrissent le domaine.
9. Les benchmarks fermés saturent (PutnamBench ≈99 % revendiqué). La valeur se déplace vers les problèmes ouverts et les énoncés de bonne qualité.
10. Physique : PhysLean sert surtout de corpus (PhysProver, janv. 2026). On n'a trouvé aucune « découverte » physique vérifiée en Lean.

## 2. Chronologie des faits marquants

| Date | Fait | Source |
|---|---|---|
| mai 2025 | DeepMind ouvre `formal-conjectures` (Lean 4 + Mathlib, Apache 2.0). | [GitHub](https://github.com/google-deepmind/formal-conjectures) |
| sept. 2025 | Math Inc / Gauss formalise le PNT fort (≈25 000 lignes) en ~3 semaines. Sur Zulip, on note que l'agent a parfois contourné ou utilisé des lemmes misformalisés. | [strongpnt](https://math-inc.github.io/strongpnt), [Zulip](https://leanprover-community.github.io/archive/stream/219941-Machine-Learning-for-Theorem-Proving/topic/Math.2C.20Inc.2C.20and.20Gauss.20discussion.html) |
| 12 nov. 2025 | AlphaProof publié dans *Nature* (niveau argent IMO 2024). | DOI 10.1038/s41586-025-09833-y |
| déc. 2025 | Aletheia (DeepMind, Gemini Deep Think) passé sur ~700 problèmes ouverts : solutions, solutions partielles, identifications bibliographiques. Bloom refuse d'ajouter des « améliorations IA » au site. | [arXiv 2601.22401](https://arxiv.org/abs/2601.22401) |
| janv. 2026 | **#728** : argument de GPT-5.2 Pro formalisé par Harmonic Aristotle. Énoncé initialement vague, d'abord requalifié en résultat partiel, puis adapté à la « vraie » version. **#281** : présenté comme « le cas le plus net » (Tao), puis déclassé quand on a trouvé la littérature de 1936/1966. | [arXiv 2601.07421](https://arxiv.org/abs/2601.07421), [the-decoder](https://the-decoder.com/gpt-5-2-pro-solves-another-erdos-problem-while-a-new-database-reveals-most-attempts-still-fail/) |
| janv. 2026 | Exploit sur le Zulip Lean : une déclaration malformée trompe lean4checker et SafeVerify, mais pas Comparator. | [Zulip](https://leanprover-community.github.io/archive/stream/270676-lean4/topic/SafeVerify-passing.20kernel.20soundness.20exploit.html) |
| mars 2026 | #650 : stratégie proposée par ChatGPT, preuve rendue rigoureuse en Lean par Aristotle. | [arXiv 2603.28636](https://arxiv.org/abs/2603.28636) |
| avr. 2026 | **#1196** : un amateur résout le problème avec GPT-5.4 Pro (~80 min). Preuve en Lean, puis réécrite par Lichtman et Tao. | [heise](https://heise.de/-11276442), [the-decoder](https://the-decoder.com/openais-gpt-5-4-pro-reportedly-solves-a-longstanding-open-erdos-math-problem-in-under-two-hours/) |
| mai 2026 | OpenAI réfute la conjecture des distances unitaires (#90). AlphaProof Nexus annonce 9/353 Erdős et 44/492 OEIS, et repère des énoncés misformalisés (#125, #741 : « densité » corrigée en densité inf./sup.). Le chiffre de « 9 » est contesté (au moins un résultat partiel). | [TechCrunch](https://techcrunch.com/2026/05/20/openai-claims-it-solved-an-80-year-old-math-problem-for-real-this-time/), [arXiv 2605.22763](https://arxiv.org/abs/2605.22763), [critique](https://buttondown.com/anatol/archive/deepminds-alphaproof-nexus/) |
| mai 2026 | Article « Formal Conjectures » : 2615 énoncés, dont 1029 conjectures ouvertes. Un audit ICML 2026 de benchmarks Lean relève 398 défauts certifiés (contre-exemples, théorèmes vacuitaires, axiomes non sains). | [arXiv 2605.13171](https://arxiv.org/abs/2605.13171), [ICML](https://icml.cc/virtual/2026/poster/62980) |
| août 2026 | Palomar, registre de preuves Lean, ouvre le 18 août. Il sépare vérification noyau et revue (LLM) de la correspondance entre énoncé formel et informel. OpenAI « Astra » : 3 nouveaux problèmes d'Erdős. Quanta revient sur la façon dont l'IA a bouleversé la communauté. | [Palomar](https://github.com/PalomarRegistry/PalomarDatabase), [Quanta](https://www.quantamagazine.org/how-ai-tore-through-a-mathematical-community-20260803/) |
| sept. 2026 | Litige Navier-Stokes : Buckmaster (NYU) et Alpöge (Anthropic) contre OpenAI sur le crédit. Lettre ouverte de 25 mathématiciens. Epoch lance **FrontierMath Erdős** : 68 problèmes ouverts, Lean obligatoire, 300 $ et 72 h par problème, statements dans `epoch-research/LeanOpenProblems`. | [TechCrunch](https://techcrunch.com/2026/09/08/openai-fought-dirty-on-career-making-math-problem-says-nyu-mathematician/), [Epoch](https://epoch.ai/benchmarks/frontiermath-erdos) |
| 6 oct. 2026 | OpenAI publie `github.com/openai/math` : **719 manuscrits** selon TechCrunch. Les chiffres divergent selon les sources : 372 « claims » ailleurs, « 300 » chez Huiberts, 23 problèmes d'Erdős selon Bloom. Seuls 10 manuscrits ont leur chaîne de pensée, et il n'y a pas de métadonnées liant preuve informelle et preuve formelle. Des écarts NL/Lean sont relevés (Cambridge/KCL). Tao parle de « harvesting ». | [TechCrunch](https://techcrunch.com/2026/10/08/openais-math-solutions-arent-meeting-the-fields-standards-yet/), [officechai](https://officechai.com/ai/openai-has-also-included-proofs-for-23-erdos-problems-in-its-latest-math-proof-drop/) |
| ≈ oct. 2026 | erdosproblems.com gèle les commentaires et les revendications, masque les statuts et abandonne le vocabulaire de « crédit ». Date exacte non confirmée : le billet primaire (blog:9) nous a été inaccessible (403). | [résumé](https://zeli.app/story/49977689), [primaire](https://www.erdosproblems.com/forum/thread/blog:9) |
| 2026 | Physique : PhysProver s'entraîne sur PhysLean. Agents de découverte d'équations (KeplerAgent), sans vérification formelle. | [arXiv 2601.15737](https://arxiv.org/abs/2601.15737) |

## 3. Risques à prévenir et mesures concrètes

| Risque | Cas réel | Mesure nosorry |
|---|---|---|
| Énoncé misformalisé | #125, #741, défauts relevés par l'audit ICML, lemmes de Gauss | Statut d'énoncé (`draft / reviewed / disputed / frozen`). Une preuve sur un énoncé ensuite jugé « disputed » est gelée et non comptée. Récompenser les findings de misformalisation au même niveau qu'une preuve. |
| Preuve vacuitaire | Hypothèses contradictoires, `False` dérivable | Test automatique : tenter `hyps → False` avec un budget borné. Exiger des « sanity lemmas » (instances non triviales) dans le fichier Challenge. Signaler aussi toute preuve anormalement courte. |
| Ambiguïté de l'intention | #728 (partiel, puis complet) | Plusieurs variantes formelles par problème (`_weak`, `_strong`, …), avec un lien vers la source informelle et la mention « variante X résolue » au lieu de « problème résolu ». |
| Déjà résolu dans la littérature | #281, l'essentiel des ~100 « solutions » | Champ obligatoire « recherche bibliographique effectuée », statut `literature-found` distinct de `novel`, et une prime pour le signalement de prior art. |
| Exploits Lean | `native_decide` (`Lean.trustCompiler`), `debug.skipKernelTC`, olean forgé, métaprogrammation | Pipeline **Comparator** : build en sandbox sans réseau, export lean4export, rejeu noyau hors sandbox, comparaison avec le Challenge de confiance. Liste blanche d'axiomes (`propext`, `Classical.choice`, `Quot.sound`). Rejet de `native_decide`, `implemented_by`, `extern` et des options `debug.*`. Toolchain et Mathlib épinglés. En option, une 2e vérification (LeanParanoia, rejeu `lean4checker --fresh`). |
| Altération de l'environnement | Exploit SafeVerify | Ne jamais faire confiance aux `.olean` soumis. Recompiler depuis les sources dans un conteneur jetable. |
| Plagiat / copie de preuves | Re-soumission de preuves publiques (openai/math, Palomar) | Empreinte des termes de preuve normalisés, détection de doublons, horodatage du commit, champ « dérivé de » obligatoire, recherche contre les dépôts publics connus. |
| Faux transcripts | Seulement 10/719 manuscrits OpenAI avec CoT | Transcripts capturés côté plateforme (agent connecté via API ou MCP, logs signés et horodatés) avec le badge « transcript vérifié ». Un transcript collé à la main reçoit le badge « déclaratif ». |
| Spam de soumissions IA | Gel d'erdosproblems.com | Quotas par compte et par problème, coût de soumission (réputation ou crédits), et file privée tant que la vérification n'a pas réussi : rien de non vérifié n'est public. Explication humaine courte exigée pour publier. |
| Surcharge des relecteurs | Bloom, Tao | Triage automatique (vérif + tests vacuité + doublons) avant tout humain. Revue humaine réservée aux énoncés et aux findings. Relecteurs rémunérés en réputation. |
| Litiges de crédit humain/IA | Navier-Stokes, priorité sur erdosproblems | Modèle CRediT-like : humain pilote, agent/modèle (version), outils, contributions antérieures. Horodatage immuable. Politique de priorité publiée **avant** le lancement. |
| « Harvesting » sans compréhension | Critique de Tao et Huiberts | Leaderboard pondéré par la qualité (exposé lisible, findings, réutilisabilité Mathlib) et pas seulement par le nombre de preuves. |

## 4. Points forts à exploiter et fonctionnalités concrètes

- **Comparator** (leanprover/Comparator) : c'est le standard officiel pour « proof marketplaces / high-reward competitions / unaligned AI ». En faire le cœur du badge « Vérifié ». SafeVerify et lean4checker peuvent servir de pré-filtre rapide, jamais de verdict final.
- **Modèle Palomar** : séparer explicitement 4 questions (Lean accepte ? axiomes permis ? bon théorème ? correspondance formel/informel ?). Les trois premières sont mécaniques, la 4e relève de la revue humaine assistée par LLM. Afficher 4 pastilles distinctes. Envisager l'export des preuves validées vers Palomar (snapshot du dépôt, métadonnées CC0).
- **formal-conjectures et FrontierMath Erdős** : importer les énoncés avec leur provenance et suivre leurs corrections en amont. Reprendre le protocole Epoch (budget et durée fixes, une tentative) pour un **leaderboard « protocole »** séparé du leaderboard « libre ».
- **Métadonnées de formalisation** : nous n'avons trouvé aucune trace publique d'un standard `formalization.yaml`. Proposer notre propre fichier de métadonnées par problème (source informelle, variantes, statut, liens NL↔Lean, auteurs), qui répond exactement à la demande AGMAI non satisfaite par OpenAI.
- **Communauté** : Zulip Lean (#Machine Learning for Theorem Proving) et le wiki de Tao (teorth/erdosproblems) servent de référence pour le statut et l'attribution. Synchroniser les statuts avec le wiki et lier les discussions. Prévoir une catégorie « échecs signalés », car Tao note que les échecs ne sont presque jamais publiés.
- **Benchmarks saturés** (PutnamBench, miniF2F) : utiles comme tests d'accueil des agents (« calibration »), pas comme vitrine.
- **Ce qui rend une contribution IA crédible** : preuve Lean vérifiée par Comparator, énoncé revu par des humains, recherche bibliographique documentée, exposé humain lisible, transcript complet, attribution claire. Ces éléments correspondent exactement aux manques reprochés à la publication d'OpenAI. En faire le score de crédibilité affiché.
- **Physique (PhysLean)** : démarrer par des « exercices » formels et des énoncés de lois. Imposer une revue humaine forte des définitions, car le risque de misformalisation y est encore plus élevé (unités, idéalisations).

## 5. Sources

- Quanta, *How AI tore through a mathematical community* (août 2026) : https://www.quantamagazine.org/how-ai-tore-through-a-mathematical-community-20260803/
- Aletheia / Erdős (arXiv 2601.22401) : https://arxiv.org/abs/2601.22401
- #728 Aristotle (arXiv 2601.07421) : https://arxiv.org/abs/2601.07421
- #650 (arXiv 2603.28636) : https://arxiv.org/abs/2603.28636
- #281 : https://the-decoder.com/gpt-5-2-pro-solves-another-erdos-problem-while-a-new-database-reveals-most-attempts-still-fail/
- #1196 : https://heise.de/-11276442
- AlphaProof Nexus (arXiv 2605.22763) : https://arxiv.org/abs/2605.22763 ; critique : https://buttondown.com/anatol/archive/deepminds-alphaproof-nexus/
- Formal Conjectures (arXiv 2605.13171) : https://arxiv.org/abs/2605.13171 ; dépôt : https://github.com/google-deepmind/formal-conjectures
- Audit des benchmarks Lean (ICML 2026) : https://icml.cc/virtual/2026/poster/62980
- Epoch FrontierMath Erdős : https://epoch.ai/benchmarks/frontiermath-erdos
- TechCrunch, publication OpenAI d'oct. 2026 : https://techcrunch.com/2026/10/08/openais-math-solutions-arent-meeting-the-fields-standards-yet/
- TechCrunch, litige Navier-Stokes : https://techcrunch.com/2026/09/08/openai-fought-dirty-on-career-making-math-problem-says-nyu-mathematician/
- Tao, « harvesting » : https://officechai.com/ai/terence-tao-hints-openai-wasnt-behaving-responsibly-by-simultaneously-releasing-300-math-proofs-says-its-making-math-less-fertile/
- Gel d'erdosproblems.com : https://www.erdosproblems.com/forum/thread/blog:9 (inaccessible, résumé : https://zeli.app/story/49977689)
- Lean Reference, *Validating Proofs* : https://lean-lang.org/doc/reference/4.29.0-rc6/ValidatingProofs/
- Exploit SafeVerify (Zulip) : https://leanprover-community.github.io/archive/stream/270676-lean4/topic/SafeVerify-passing.20kernel.20soundness.20exploit.html
- Comparator : https://reservoir.lean-lang.org/@leanprover/Comparator ; SafeVerify : https://reservoir.lean-lang.org/@GasStationManager/SafeVerify ; LeanParanoia : https://reservoir.lean-lang.org/@oOo0oOo/paranoia
- Palomar : https://github.com/PalomarRegistry/PalomarDatabase
- Math Inc, PNT fort : https://math-inc.github.io/strongpnt
- PhysProver (arXiv 2601.15737) : https://arxiv.org/abs/2601.15737
- Comparaison SafeVerify/Comparator, OEIS Open (arXiv 2608.11941) : https://arxiv.org/abs/2608.11941
