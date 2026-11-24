# Audit UX de nosorry — visite critique d'un nouveau venu

Date : 23 nov. 2026 · Site : http://localhost:3001 (dev local) · Navigateur intégré, desktop 1024 px et mobile 375 px.
Deux personas : **(M)** une mathématicienne qui connaît un peu Lean et veut contribuer ; **(D)** un développeur qui veut brancher son agent (Claude Code / Codex).
Parcours réalisés : accueil → math.NT → MSC 11 → collection Erdős + filtre « open » → /p/erdos-488 → /p/demo-even-add → recherches → /docs/verification, /docs/scoring, /docs/agents → /leaderboard, /queue, /recent → /s/s-s75y47d38k et /s/s-jfnxwvcsq9 → déconnexion du compte `demo-admin` (déjà connecté à l'arrivée) → inscription d'un compte neuf `lemma_lover_7q` → /account → création d'une clé API → /submit (preuve volontairement fausse sur demo-even-add) → critique sur /p/demo-even-add → /api/v1 en curl.

---

## 1. Première impression (5 lignes)

1. Le site a vraiment l'air d'une archive savante (bandeau bleu nuit, liste arXiv « math.AC open, proved here, all »), pas d'un SaaS : la direction visuelle est bonne et cohérente.
2. La phrase d'accueil explique bien le *contrat* (« accepted only if the Lean kernel checks it… no `sorry` and no additional axioms ») mais pas le *pourquoi* ni le *que faire maintenant* : aucun bouton « Contribuer », aucun « Brancher un agent » au-dessus de la ligne de flottaison.
3. Les chiffres font peur : « 1 verified proofs · 1 partial proofs · 1 statement corrections · 1 contributors » — un site qui paraît vide, avec des pluriels cassés, et 1 870 problèmes affichés alors que les identifiants vont jusqu'à NS.08830.
4. Les pages problème sont riches et sérieuses (hash, toolchain, historique des versions), mais il y a des incohérences qui minent la confiance dans un site dont le seul produit est la *confiance* (« Status: open · … · proved on nosorry », critique « rejected » dont la résolution dit « Accepted »).
5. Côté agent, la doc est dense et honnête mais le chemin « je copie une commande et ça marche » n'existe pas : dossier `skill/nosorry` sans lien, `NOSORRY_URL=https://nosorry.example`, commande `nosorry` qui n'est installée nulle part.

---

## 2. Ce qui fonctionne

- **Identité visuelle** : thème clair, typographie sobre, bandeau `#1f3a60`, densité d'information type arXiv. Aucun dégradé, aucune carte « SaaS ». C'est exactement l'intention.
- **Navigation façon arXiv** sur l'accueil : chaque catégorie expose « open, proved here, all » + compteurs « 18 open / 34 » + sous-domaines « includes: … ». Très lisible pour un mathématicien.
- **Page problème** (/p/erdos-488) : énoncé informel rendu en KaTeX propre, tableau de métadonnées (Subjects, MSC, « Cite as: NS.02256 [math.CO] · NS.02256v1 for this version », Declaration, Statement hash, Toolchain, Upstream), énoncé Lean coloré, phrase de contrat claire (« A solution keeps every definition of Challenge.lean unchanged and proves Erdos488.erdos_488 with the same type… »), encadré « Current browse context » repris d'arXiv, historique des versions.
- **Transparence de la vérification** : /docs/verification avec le tableau « Badge / Question / Who decides » (excellent : il dit honnêtement que « Faithful statement » est décidé par des humains), pipeline détaillé, section « Reproducing a verdict ».
- **Page de soumission** (/s/…) : les quatre badges (« Lean accepts it / Standard axioms / Right theorem / Faithful statement ») + journal étape par étape avec durées. Le message de verdict de la soumission rejetée est actionnable (« the proof still depends on sorry: Demo.even_add — submit it as a partial proof »).
- **Barème** (/docs/scoring) : clair, assumé (« Exposing a broken statement is worth more than most proofs, on purpose »), registre append-only expliqué.
- **API** : `GET /api/v1` renvoie un index auto-descriptif des endpoints et des limites ; `GET /api/v1/problems?status=open&limit=2` fonctionne avec pagination par curseur ; `Challenge.lean` téléchargeable en `text/plain`. Très bon point de départ pour un agent.
- **Mobile** : pas de défilement horizontal (scrollWidth = 375 sur l'accueil, la liste et la page problème) ; les formules longues défilent dans leur propre boîte.
- **Formulaire de soumission** : pré-rempli depuis la page problème (`/submit?problem=demo-even-add`), labels correctement associés (`for`/`id`), après envoi redirection directe vers la page de suivi avec auto-rafraîchissement (« Checking… this page updates by itself. »).
- **404** : « Not in the archive — This page does not exist, or the submission is private to its author » + liens « Browse problems · Search ». Juste et utile.

---

## 3. Problèmes constatés

Format : **[Priorité] Page — constat** · Pourquoi ça gêne · Correctif concret.

### 3.1 Confiance et exactitude (le cœur du produit)

**P1-1. [P1] /account — la clé API secrète passe dans l'URL.**
Après « New key », l'URL devient `/account?newkey=ns_…` (la clé complète). Un rechargement réaffiche l'encadré « Copy this key now — it is shown only once. » (vérifié).
· Le secret finit dans l'historique du navigateur, les logs serveur/proxy, l'en-tête Referer, les captures d'écran partagées ; et le message « shown only once » est faux.
· Correctif : renvoyer la clé dans la réponse de la server action (état React / cookie flash à usage unique, `HttpOnly`, effacé à la première lecture), jamais en query string. Ajouter un bouton « Copier » et, sous la clé, le bloc prêt à coller : `export NOSORRY_API_KEY=…` / `$env:NOSORRY_API_KEY="…"`.

**P1-2. [P1] /p/demo-even-add — statut contradictoire.**
Ligne de statut : « Status: open · reviewed statement · proved on nosorry ». Même chose dans la liste `?status=proved` : « Status:open · proved on nosorry ».
· Un problème ne peut pas être à la fois « open » et « proved ». Pour un mathématicien, c'est le genre de détail qui fait douter de tout le reste.
· Correctif : un seul statut principal parmi {open, proved here, known result, disproved}, puis les qualificatifs. Ex. « Status: **proved here** (open in the literature) · reviewed statement ». Clarifier dans /docs/scoring la différence « open (littérature) » vs « proved here (formel) ».

**P1-3. [P1] /p/demo-even-add, section « Statement review » — données incohérentes.**
La deuxième critique est marquée « rejected » mais sa résolution dit « Accepted: the definition now uses %. Proofs of v1 are re-checked. » Dans la première critique, `$n \bmod 2 = 0$` s'affiche en rouge avec un caractère carré (« n □mod 2 = 0 ») : erreur KaTeX visible.
· Même si ce sont des données de démo, c'est la page que tout nouveau venu ouvrira en premier (elle est en tête de « Latest verified contributions »).
· Correctif : nettoyer le seed ; côté rendu, ne jamais afficher une erreur KaTeX brute en rouge — retomber sur le TeX source en `<code>` (option `throwOnError:false` + `errorColor` neutre) ; empêcher en base qu'un statut « rejected » porte une résolution commençant par « Accepted ».

**P1-4. [P1] Accueil, leaderboard, /s/s-s75y47d38k — le problème de démo compte comme un problème de recherche.**
L'accueil le liste sous « Latest verified contributions », /list/math.NT?status=research l'inclut, le ledger affiche « +100 proof:first:open » et le leaderboard crédite demo-alice d'« Open problems solved: 1 », alors que sa description dit « A pipeline test that compiles without Mathlib ».
· Le barème (« First verified proof of an open research problem — 100 ») est contredit par la première ligne du registre. Un visiteur sceptique y voit une gamification truquée.
· Correctif : classer les problèmes de démo en « sanity test » (1 pt), les exclure de « research » et des compteurs de l'accueil, ou les masquer en dehors d'un mode démo.

**P1-5. [P1] /s/s-jfnxwvcsq9 (soumission rejetée) — messages contradictoires.**
L'étape « statement & axioms — pass » affiche « axioms: [sorryAx] » ; l'encadré « Open lemmas » dit « This partial proof reduces Demo.even_add to: Demo.even_add » pour une soumission de type *proof* rejetée ; « compile submission — pass 0.62s » répète « 0.6s » dans la boîte de détail.
· L'utilisateur qui reçoit un rejet doit comprendre *une* chose : pourquoi. Ici, une étape marquée « pass » contient la raison de l'échec, et une phrase tautologique la contredit.
· Correctif : marquer l'étape « statement & axioms » en **fail** (ou « warn ») dès que `sorryAx` apparaît ; n'afficher « Open lemmas » que pour `kind = partial` ; si l'unique lemme ouvert est la cible elle-même, écrire « The target theorem itself still uses `sorry`. » ; supprimer les détails qui ne font que répéter la durée.

**P1-6. [P1] Recherche — « Erdős 1196 » ne trouve rien.**
`/search?q=Erdős 1196` → « Showing 0–0 of 0 results for Erdős 1196 » ; idem « erdos 1196 » et « Erdos488.erdos_488 » (nom de déclaration). Ça marche seulement avec « Erdős Problem 1196 », « 1196 », « erdos-1196 » ou « NS.00965 ».
· C'est LA requête naturelle d'un mathématicien (et d'un agent). Le moteur semble exiger tous les tokens en séquence exacte et ne pas plier les diacritiques.
· Correctif : (1) si la requête ressemble à `<collection> <numéro>`, rediriger directement vers `/p/erdos-1196` ; (2) recherche plein texte avec `unaccent` et opérateur ET sur les tokens (pas phrase exacte) ; (3) indexer `decl_name` et le slug ; (4) remplacer « Showing 0–0 of 0 results » par « No problem matches “Erdős 1196”. Try “1196”, or browse Erdős Problems. »

**P1-7. [P1] Mobile 375 px — impossible de se connecter ou d'atteindre son compte.**
`.hd-top { display: none }` sous le point de rupture : les liens « Login / Register » ou « Signed in as … » disparaissent ; rien ne les remplace dans la barre « Browse Recent Leaderboard Verification queue | Submit Agents & API Help ».
· Un utilisateur mobile ne peut ni s'inscrire depuis l'en-tête ni se déconnecter.
· Correctif : sur mobile, ajouter « Sign in » (ou le handle) en fin de la ligne de navigation ; ne cacher que le slogan.

**P2-8. [P2] /s/… soumission « sealed » — le source est présent dans le HTML envoyé à un visiteur anonyme (à vérifier en build de production).**
En anonyme, la page affiche correctement « The proof is sealed… », mais le payload RSC de la page contient l'objet complet de la soumission, `lean_source` compris (trouvé avec `curl … | grep omega`). Cela vient probablement des infos de debug de React en dev, mais la requête SQL charge le source même quand `showContent` est faux.
· Si cela se reproduit en prod, le « scellement » (base de la priorité et du crédit) est contournable avec « Afficher le source ».
· Correctif : ne pas sélectionner `lean_source`, `body_md`, `explanation_md` dans la requête quand l'utilisateur n'est ni auteur ni modérateur ; refaire le test `curl` sur `next build && next start`.

**P2-9. [P2] /queue — « 3 active workers » alors que rien ne tourne.**
Ma soumission s-k79mz67as6 est restée « queued » plus de 3 minutes avec « 1 queued · 0 running · … · 3 active workers ». La page de soumission affichait seulement « Waiting for a worker… ».
· Promesse non tenue (« mean turnaround (24h): 14s »), aucune information pour patienter. Je n'ai donc pas pu voir l'expérience d'erreur sur une preuve neuve.
· Correctif : compter un worker comme actif seulement si son heartbeat a moins de 60 s ; sur /s/…, afficher « Position 1 in queue · no worker online right now — your timestamp is already recorded (23 Nov 2026, 21:43 UTC) ». Ce dernier point rassure sur la priorité.

### 3.2 Architecture de l'information et navigation

**P1-10. [P1] Accueil — pas d'appel à l'action pour les deux publics.**
Le seul texte d'introduction est un paragraphe, suivi immédiatement de 22 catégories. « Submit » et « Agents & API » sont des liens texte de 13 px dans la barre ; « Login Register » sont en 11 px gris en haut à droite.
· Persona M : « Par où je commence ? Quel problème est à ma portée ? » Persona D : « Où est le quickstart ? » Aucun des deux n'a de réponse en 10 s.
· Correctif (sans tomber dans le SaaS) : sous le paragraphe, une ligne de trois liens en gras, façon arXiv « Submit / Help » :
  « **Prove a statement** — pick an open problem, submit a Lean file · **Connect your agent** — 3 commands for Claude Code or Codex · **Review a statement** — find misformalizations (60 pts) ». Puis un bloc « Good first problems » (5 problèmes ouverts à énoncé court, ou des variantes faciles).

**P1-11. [P1] Accueil — les chiffres sont trompeurs et mal accordés.**
« 1,870 research problems (978 open) · 1 verified proofs · 1 partial proofs · 1 statement corrections · 1 contributors ». Or `/list/math?status=all` donne 1 875 entrées et les identifiants vont jusqu'à NS.08830 (les variantes formelles sont masquées par défaut, cf. « include formal variants »).
· Pluriels faux ; l'écart 1 870 / ~8 830 n'est expliqué nulle part ; un compteur « 1 contributors » dessert le projet.
· Correctif : gérer le singulier ; écrire « 1,870 research problems (978 open) · 8,8xx formal statements including variants » avec un lien vers l'explication des variantes ; tant que l'activité est faible, remplacer les compteurs d'activité par « Latest activity » ou par la date de la dernière vérification.

**P2-12. [P2] /list/math.NT — le niveau MSC ne sert à rien.**
Encadré « MSC2020 classes » : une seule entrée, « 11 Number theory — 1135 ». Même chose sur /p/erdos-488 : « MSC classes: 05, 11 ».
· La promesse « field → category → MSC class » est vide : la classe MSC à deux chiffres double exactement la catégorie arXiv.
· Correctif : descendre au niveau MSC à 3 caractères (11A, 11B, 11N, 11P…), avec libellés (« 11N Multiplicative number theory »), même si c'est approximatif au départ ; sinon, retirer l'encadré.

**P2-13. [P2] /list/… — les filtres ne sont pas expliqués et la terminologie change.**
« Show: research | open | known results | proved here | textbook | sanity tests | all » ; « include formal variants » ; dans la recherche : « All problems / Open only / Known results » ; dans l'URL : `status=solved` pour « known results », `status=test` pour « sanity tests ». Le filtre actif (« research ») n'est signalé que par du gras.
· « research » contient « open » ; « known results » vs « proved here » est subtil ; « formal variants » n'est défini nulle part.
· Correctif : un `title`/infobulle ou une ligne d'aide sous les filtres (« research = problems not known to be textbook or tests; open = no accepted solution in the literature… ») ; aligner les noms (même libellé dans la liste, la recherche, l'URL et l'API) ; rendre l'état actif visible (fond gris clair + `aria-current`).

**P2-14. [P2] Listes et pages — titres non descriptifs et TeX brut dans les titres.**
« Erdős Problem 5 », « Erdős Problem 7 », « Erdős Problem 488 » : aucun indice sur le contenu. Sur /list/math.NT : « Digit $2$ in base $3$ representation of $2^n$ », « Integer values of $\tan(\arctan 1 + \arctan 2 + \cdots + \arctan n)$ » avec les dollars visibles.
· On ne peut pas parcourir une liste en lisant les titres ; le TeX brut fait « bug ».
· Correctif : rendre KaTeX dans les titres (liste, `<title>`, résultats de recherche) ; pour Erdős, générer un sous-titre court (« Erdős Problem 488 — density of multiples of a finite set ») ou afficher la première phrase de l'énoncé en gris à côté du numéro.

**P2-15. [P2] /list/… et /search — extraits coupés au milieu d'une formule et tailles de police incohérentes.**
Résultat « Erdős Problem 164 » : l'extrait s'arrête sur une formule en display coupée à mi-hauteur (« ∑ 1/ » tronqué). « Erdős Problem 1196 » : l'extrait s'affiche dans une police nettement plus grande et grasse que les autres. Le résultat 2 de math.NT contient une note de formalisation (« 0 < N excludes N = 0, where ZMod 0 is ℤ… ») dans le résumé.
· Rendu peu fiable, lecture difficile.
· Correctif : couper l'extrait *avant* rendu (sur le Markdown, à la fin d'une phrase et jamais dans un `$…$`/`$$…$$`), forcer les display en inline dans les extraits ; normaliser la taille de police du conteneur ; séparer « énoncé » et « notes de formalisation » dans les données.

**P2-16. [P2] Page problème — « [Submitted on 23 Nov 2026] ».**
Erdős 488 apparaît « Submitted on 23 Nov 2026 », sans auteur.
· Faux sens : le problème date de plusieurs décennies ; c'est la date d'import. Pour un mathématicien c'est presque une erreur d'attribution.
· Correctif : « [Imported from formal-conjectures on 23 Nov 2026 · problem posed by Erdős, see erdosproblems.com/488] » ; quand la source a des références, afficher « Posed by / Reference ».

**P2-17. [P2] Page problème — rien ne dit combien ça rapporte ni comment réfuter.**
Aucune mention des points sur /p/erdos-488 ; rien sur la manière de soumettre une *réfutation* d'une question « Is it true that… ? » (la docs ne mentionne que les énoncés `answer(sorry)`).
· Persona M : « Si je pense que la réponse est non, je fais quoi ? » est la première question devant un problème d'Erdős.
· Correctif : dans l'encadré « Contribute », une ligne « First verified proof: 100 pts · Accepted critique: up to 60 pts » ; dans /docs/verification, une section « Disproving a statement » (prouver la négation = critique « too strong » ? nouvelle soumission ? à préciser) et un lien depuis chaque énoncé en forme de question.

**P2-18. [P2] Page problème — l'énoncé formel ne montre pas les définitions.**
/p/demo-even-add affiche seulement `theorem even_add : ∀ a b, IsEven a → IsEven b → IsEven (a + b)`. La définition de `IsEven`, précisément l'objet des critiques affichées juste en dessous, n'est visible que dans Challenge.lean.
· On ne peut pas juger la fidélité de l'énoncé sans ouvrir un autre fichier.
· Correctif : afficher le Challenge.lean complet (repliable, « Show full Challenge.lean (12 lines) ») sous l'énoncé, avec bouton « Copy ».

**P3-19. [P3] Incohérences de vocabulaire.**
« Login / Register » (en-tête) vs « Sign in / Create an account » (formulaires) ; « Verification queue » (menu) vs « Verification pipeline » (titre de la page) ; « Help » pointe vers « How verification works » ; « Findings and remarks » vs kind « finding » ; « known result » vs `status=solved`.
· Correctif : un glossaire unique ; « Sign in / Create account » partout ; renommer le menu « Help » en « Docs », ou créer une vraie page /docs d'index (aujourd'hui `/docs` redirige en 307 et `/help` donne 404).

### 3.3 Inscription, compte, soumission

**P2-20. [P2] /signup — règles non annoncées, validations natives illisibles.**
Le handle « lemma lover » est bloqué par une infobulle native du navigateur ; un mot de passe court l'est aussi (le serveur exige 10 caractères, `actions.ts`), mais le formulaire ne le dit pas : le seul indice est « Public. Letters, digits, _ and -. » sous Handle.
· L'utilisateur devine les règles par essais/erreurs.
· Correctif : sous Password, « At least 10 characters. » ; messages d'erreur en ligne dans la charte du site (rouge `--bad`, sous le champ, `aria-describedby`) au lieu des bulles natives.

**P2-21. [P2] /signup → /account — aucun accueil.**
Après inscription on atterrit sur /account : « 0 points · user · member since … · no email · public profile », « No keys yet. », « Your submissions: None. »
· Moment idéal pour guider, totalement perdu.
· Correctif : un encadré « Next steps » : 1) « Pick an open problem » (lien vers une sélection), 2) « Connect an agent » (crée la clé et affiche les 3 commandes), 3) « Review a statement ». Ajouter aussi la possibilité d'ajouter l'e-mail (« Email (optional for now) » à l'inscription, mais aucun champ pour l'ajouter ensuite) et de changer le mot de passe.

**P2-22. [P2] /account — détails de mise en page.**
Le bouton « New key » passe sur deux lignes (« New / key ») ; la déconnexion n'existe que sur /account (« Sign out » en bas de page) ; « Revoke » sans confirmation visible.
· Correctif : `white-space: nowrap` sur les boutons ; « Sign out » aussi dans le menu du handle ; confirmation « Revoke key “audit test”? Agents using it will stop working. ».

**P2-23. [P2] /submit — un seul formulaire pour quatre usages.**
Pour « Proof — complete, sorry-free », on voit aussi « Target declaration (formalizations only) », « Notes / finding (Markdown, $TeX$) », « Leave empty for a formalization. ». Le problème choisi n'est pas rappelé (juste le slug `demo-even-add` dans un champ), la zone Solution.lean est vide alors que le placeholder dit « Paste the whole file, starting from the reference Challenge.lean ».
· Charge cognitive, risque d'erreur (mauvais champ), aucun contrôle visuel « je soumets bien pour le bon problème ».
· Correctif : afficher/masquer les champs selon « Kind » ; sous le champ Problem, afficher le titre et l'énoncé Lean du problème résolu (« Demo · the sum of two even numbers is even — Demo.even_add ») ; bouton « Start from Challenge.lean » qui pré-remplit la zone.

**P2-24. [P2] /submit, encadré « What is checked » — liste mal alignée.**
Les éléments « identical submissions », « kernel replay », « axioms of the proof » sont poussés à droite, loin de leur tiret. Cause : `.side li { display:flex; justify-content: space-between }` (globals.css l. 104), prévu pour « libellé — compteur », s'applique ici à du texte simple.
· Correctif : classe dédiée (`.side ul.plain li { display:list-item }`) pour les listes sans compteur.

**P3-25. [P3] /submit — boutons de fichier natifs en français dans une interface anglaise.**
« Choisir un fichier / Aucun fichier choisi ». Correctif : `<label class="btn">Upload .lean</label>` + input caché, nom du fichier affiché par le site.

**P2-26. [P2] Critique — envoi silencieux.**
Après « Submit critique », la page se recharge et la critique apparaît en tête du tableau, « in review · v2 », sans message de confirmation, sans lien permanent, sans indication de délai ni de discussion possible. Le statut du problème ne change pas (pas de « disputed »).
· Correctif : bandeau « Critique #4 received — a moderator will review it. You will see the decision here » ; ancre `#critique-4` ; fil de discussion (réponses) par critique ; afficher « 1 critique in review » à côté du statut du problème.

### 3.4 Leaderboard, activité, pages publiques

**P2-27. [P2] /leaderboard — onglets collés, table démesurée.**
Les onglets s'affichent « PeopleAgents & models » sans séparateur ; la table s'étire sur toute la largeur avec d'énormes espaces entre « Contributor » et « Points ».
· Correctif : « People | Agents & models » avec état actif ; table limitée à ~700 px ; ajouter la période (« all time / 30 days ») et une colonne « Critiques accepted » puisque le barème les valorise.

**P3-28. [P3] /recent — périmètre trop étroit.**
« Checked proofs, partial proofs and findings, newest first. » Les critiques et les nouvelles versions d'énoncé (événements importants) n'y figurent pas ; les rejets non plus (ils sont visibles dans /queue, d'où une incohérence entre les deux pages).
· Correctif : filtre par type (proofs / critiques / statement changes) et un flux Atom/RSS.

**P3-29. [P3] /queue — colonnes opaques.**
« Priority 120 / 40 », « Attempts 1 » sans explication.
· Correctif : remplacer Priority par « interactive / bulk / re-check », ou une infobulle.

**P3-30. [P3] /u/demo-alice — `<title>` générique et colonne redondante.**
Le titre d'onglet est « nosorry — formally verified mathematics » au lieu de « demo-alice | nosorry » ; la table répète « Submitter: demo-alice » sur chaque ligne.

**P3-31. [P3] /s/s-s75y47d38k — jargon interne visible.**
Ligne de points « +100 proof:first:open » ; « sandbox none (dev only) ». Correctif : libellé humain « +100 · first verified proof of an open problem » (le code en `title`).

### 3.5 Persona développeur : brancher un agent

**P1-32. [P1] /docs/agents — le quickstart n'est pas exécutable.**
« Copy the nosorry skill folder (from the repository's skill/nosorry) » sans lien ni commande de téléchargement ; `export NOSORRY_URL=https://nosorry.example` (domaine fictif) ; la page problème propose `nosorry fetch erdos-488` alors que la doc utilise `node skill/nosorry/bin/nosorry.mjs fetch erdos-488` et que l'encadré de clé dit « or run `nosorry login` » ; aucune instruction pour obtenir le bon projet Lean/Mathlib local, nécessaire pour `check`.
· Le développeur ne peut rien copier-coller tel quel. C'est le point de friction n°1 de la persona D.
· Correctif : un bloc « Quickstart (2 minutes) » en tête :
  `npx nosorry@latest init` (ou `curl -L <site>/skill.tar.gz | tar xz -C ~/.claude/skills`) → `nosorry login` → `nosorry fetch erdos-488` ; générer `NOSORRY_URL` à partir de l'origine courante ; variantes bash / PowerShell ; une section « Local Lean setup » avec le `lakefile`/`lean-toolchain` exacts (Lean v4.33.1 + révision Mathlib) téléchargeables ; harmoniser toutes les pages sur la même commande `nosorry`.

**P2-33. [P2] API — pas de spécification machine.**
`/api/v1/openapi.json` → 404 ; `/docs/api` → 404 ; `/llms.txt` → 404. Le lien de pied de page « API » renvoie du JSON brut. Le champ `statement_excerpt` contient du Markdown/TeX brut.
· Les agents travaillent bien mieux avec un schéma OpenAPI et un `llms.txt` ; un humain veut une page lisible.
· Correctif : publier `openapi.json` (généré depuis les routes), une page /docs/api lisible (exemples curl pour chaque endpoint, codes d'erreur, format des erreurs), un `/llms.txt` qui pointe vers ces deux ressources et vers la skill.

**P2-34. [P2] /docs/agents — pas de boucle de feedback documentée.**
Rien sur le format des erreurs renvoyées à l'agent (ex. ce qu'il reçoit pour « statement differs » ou un timeout de compilation), ni sur un mode « dry-run / check only » côté serveur, ni sur ce que fait `--wait` en cas de file bloquée.
· Correctif : exemple de réponse JSON pour `GET /api/v1/submissions/{id}` en cas d'échec, avec `stages[].detail` ; documenter les codes 4xx/429 ; documenter un timeout côté CLI.

### 3.6 Accessibilité et détails visuels

**P2-35. [P2] Accessibilité de base.**
Pas de `<h1>` sur l'accueil ; pas de lien d'évitement « Skip to content » ; un style de focus seulement pour les champs (`input:focus…` l. 182), rien pour les liens et boutons ; texte de 11 px gris `#666` dans l'en-tête (« Login Register ») ; les filtres actifs ne sont signalés que par la graisse.
· Correctif : `<h1 class="visually-hidden">nosorry — open archive of Lean-formalized problems</h1>` ; skip link ; `:focus-visible { outline: 2px solid var(--link); outline-offset: 2px }` global ; en-tête à 12–13 px minimum ; `aria-current="page"` sur la navigation et les filtres.

**P3-36. [P3] Page problème desktop — l'énoncé Lean est à l'étroit.**
La colonne principale fait ~550 px, laissant un grand vide à droite sous la barre latérale ; le commentaire de la ligne 2 de `erdos_488` déborde et impose un défilement horizontal du bloc de code.
· Correctif : laisser le bloc « Formal statement » s'étendre sur toute la largeur une fois passée la barre latérale, ou élargir la colonne principale à ~720 px ; bouton « Copy » sur le bloc.

**P3-37. [P3] Mobile — CTA enterrés.**
Sur /p/erdos-488 à 375 px, « Submit a proof or finding » n'apparaît qu'après les métadonnées, l'énoncé Lean, les sections vides « Proofs: None. Partial proofs: None. Findings and remarks: None. » et la revue.
· Correctif : sur mobile, une barre d'actions compacte sous le titre (« Challenge.lean · Submit · Critique ») ; regrouper les trois « None. » en une seule ligne « No contributions yet — be the first ».

**P3-38. [P3] Session de démo active par défaut.**
À l'arrivée, l'en-tête affichait « Signed in as demo-admin · Moderation », et les pages de soumission montraient le formulaire « Moderation — Revoke and reverse points », y compris sur une soumission déjà rejetée.
· Fausse la première impression en local et risque d'être oublié en staging.
· Correctif : pas de session préexistante ; masquer « Revoke » quand le statut est `rejected`.

---

## 4. Fonctionnalités attendues par un premier visiteur et absentes

1. **« Good first problems » / niveau de difficulté** : tag ou tri « short statement », « likely accessible », « has partial progress ». Aujourd'hui, 978 problèmes ouverts sans aucune aide au choix.
2. **Réfutation** : un chemin explicite pour prouver qu'un énoncé est faux (et le barème associé).
3. **Copier / télécharger le projet de départ** : bouton « Copy » sur les blocs Lean et un zip « starter project » (Challenge.lean + lakefile + lean-toolchain) par problème.
4. **Suivre un problème** (watch) et **notifications** (e-mail ou flux RSS/Atom) quand une critique est tranchée, quand une preuve est vérifiée, quand un énoncé change de version.
5. **Discussion** par problème ou par critique (même minimale) ; aujourd'hui une critique est un monologue.
6. **Page « About / FAQ »** : qui maintient le site, licence des contributions (les preuves publiées sont-elles en Apache-2.0 comme formal-conjectures ?), politique sur les agents, contact. `/about` donne 404.
7. **Licence et conditions** à l'inscription (contributions, transcripts) — aucune mention sur /signup.
8. **Spécification API** (OpenAPI), `llms.txt`, éventuellement un serveur MCP, pour la persona D.
9. **Tri par popularité / ancienneté / prix** (« Erdős prize $500 » quand la source le mentionne) et filtre « has partial proofs ».
10. **Profil enrichi** : affiliation, lien ORCID/GitHub/Zulip Lean ; pour un mathématicien, c'est ce qui donne de la valeur au crédit.
11. **Statistiques par agent/modèle** visibles depuis l'accueil (l'onglet existe dans le leaderboard mais n'est pas mis en avant), puisque c'est un argument fort du site.
12. **Export / citation** : BibTeX pour « Cite as: NS.02256v1 ».

---

## 5. Top 10 des changements, classés par impact / effort

| # | Changement | Impact | Effort | Réf. |
|---|---|---|---|---|
| 1 | **Ne plus mettre la clé API dans l'URL** (`?newkey=`), affichage unique réel + bouton Copier + bloc `export`/`$env:` prêt à coller | Très fort (sécurité) | Faible | P1-1 |
| 2 | **Corriger la recherche** : « Erdős 1196 » / « erdos 1196 » → redirection vers /p/erdos-1196 ; tokens en ET, `unaccent`, index sur `decl_name` ; message « No results » utile | Très fort | Faible–moyen | P1-6 |
| 3 | **Quickstart agent exécutable** : lien de téléchargement de la skill, `NOSORRY_URL` réel, commande `nosorry` unique partout, setup Lean/Mathlib local, variantes PowerShell | Très fort (persona D) | Moyen | P1-32 |
| 4 | **Statuts cohérents** : un seul statut principal (« proved here » ≠ « open »), étape « statement & axioms » en fail si `sorryAx`, supprimer « reduces X to: X », nettoyer la critique « rejected / Accepted » et l'erreur KaTeX rouge | Fort (confiance) | Faible | P1-2, P1-3, P1-5 |
| 5 | **Sortir la démo des problèmes de recherche** (compteurs, « research », ledger « proof:first:open », leaderboard) | Fort (crédibilité du barème) | Faible | P1-4 |
| 6 | **Accueil orienté action** : trois liens « Prove / Connect your agent / Review a statement », bloc « Good first problems », chiffres exacts (pluriels, explication 1 870 vs ~8 800 variantes) | Fort | Faible–moyen | P1-10, P1-11 |
| 7 | **Mobile : rétablir Sign in / compte** dans la navigation, CTA de contribution sous le titre du problème | Fort (bloquant mobile) | Faible | P1-7, P3-37 |
| 8 | **Page problème complète pour décider** : Challenge.lean entier repliable + Copier, points en jeu, comment réfuter, « Imported on » au lieu de « Submitted on » | Moyen–fort (persona M) | Faible–moyen | P2-16, P2-17, P2-18 |
| 9 | **/submit contextuel** : champs selon le type, rappel du problème ciblé, pré-remplissage depuis Challenge.lean ; file d'attente honnête (heartbeat, position, horodatage déjà enregistré) ; confirmation après critique | Moyen | Moyen | P2-23, P2-9, P2-26 |
| 10 | **Lisibilité des listes** : KaTeX dans les titres, sous-titres pour « Erdős Problem N », extraits coupés proprement, MSC à 3 caractères, filtres expliqués et nommés de façon cohérente, correctif CSS de « What is checked » et des onglets du leaderboard | Moyen | Moyen | P2-12 à P2-15, P2-24, P2-27 |

À vérifier en priorité hors de ce rapport : le payload RSC de /s/… en build de production (source d'une preuve scellée présent dans le HTML en dev, P2-8), et le fonctionnement réel des workers (ma soumission de test est restée « queued » : je n'ai pas pu observer l'expérience d'erreur sur une preuve neuve).
