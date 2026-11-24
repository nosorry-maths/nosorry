# Audit d'intégrité — nosorry

Revue défensive en lecture seule (23/11/2026). Aucun test d'attaque n'a été lancé contre le site et aucun code d'exploitation n'a été écrit.
Les constats décrivent ce que chaque contrôle ne couvre pas, puis la correction à apporter.

Périmètre : `shared/preflight.mjs`, `shared/scoring.mjs`, `worker/worker.mjs`, `worker/sandbox.mjs`, `worker/ns-run.sh`, `worker/lean/Compare.lean`,
`src/lib/*.ts`, `src/app/actions.ts`, `src/app/api/v1/**`, `src/app/s/[id]/page.tsx`, `src/app/p/[slug]/page.tsx`, `db/migrations/*.sql`,
ainsi que `next.config.ts`, `docker-compose.yml` et `Dockerfile.verifier` quand ils comptent pour un constat.

## Tableau récapitulatif

| ID | Titre | Gravité | Fichier principal |
|---|---|---|---|
| NS-01 | Le code non fiable peut écrire dans le répertoire de job, qui contient aussi le vérificateur, la référence compilée et le début du `LEAN_PATH` | critique | worker/worker.mjs, worker/sandbox.mjs, worker/ns-run.sh |
| NS-02 | XSS stocké : les libellés de liens Markdown sont insérés bruts, et la CSP autorise `unsafe-inline` | critique | src/lib/render.ts, next.config.ts |
| NS-03 | Contrôle des définitions incomplet : noms internes ignorés, comparaison superficielle, rien hors du module Challenge | haute | worker/lean/Compare.lean |
| NS-04 | `comparator`, présenté comme « autorité finale », est désactivé par défaut et mal configuré | haute | worker/worker.mjs, Dockerfile.verifier |
| NS-05 | Modération sans machine à états : double attribution, acceptation d'une preuve rejetée, auto-modération | haute | src/app/actions.ts |
| NS-06 | Une formalisation acceptée devient un problème « open » à 100 points, avec un énoncé brouillon écrit par l'utilisateur | haute | src/app/actions.ts, worker/worker.mjs |
| NS-07 | En-têtes d'IP falsifiables : les limites de débit et le journal d'audit sont contournables | haute | src/lib/api.ts, src/lib/auth.ts |
| NS-08 | Les trous `sorry` de l'énoncé acceptent n'importe quel terme, y compris dans les hypothèses | moyenne | worker/lean/Compare.lean |
| NS-09 | Le préfiltre regex est contournable (lexer approximatif, mots-clés manquants, exemption ligne à ligne) | moyenne | shared/preflight.mjs |
| NS-10 | `leanchecker` fait confiance aux imports ; le worker détient le socket Docker | moyenne | worker/worker.mjs, docker-compose.yml |
| NS-11 | Les soumissions scellées divulguent verdict, lemmes ouverts, étapes et note de revue | moyenne | src/app/api/v1/submissions/[id]/route.ts, src/app/p/[slug]/page.tsx |
| NS-12 | La clé API passe dans l'URL de redirection | moyenne | src/app/actions.ts |
| NS-13 | File d'attente sans équité par utilisateur ; ressources par job très élevées | moyenne | src/lib/submissions.ts, worker/worker.mjs |
| NS-14 | La « première preuve » revient à la première vérification terminée, pas à la première soumission | moyenne | worker/worker.mjs, src/app/actions.ts |
| NS-15 | Re-vérification : une erreur d'infrastructure révoque les points, les partiels sont oubliés, la nouvelle source n'est pas compilée | moyenne | worker/worker.mjs, src/app/actions.ts |
| NS-16 | Détection des doublons et du plagiat triviale à contourner, et sujette à une course | moyenne | shared/preflight.mjs, worker/worker.mjs |
| NS-17 | Grand livre et journal d'audit : protections silencieuses ou contournables, trous dans l'audit | basse | db/migrations/001_init.sql, src/app/actions.ts |
| NS-18 | Idempotence non atomique | basse | src/lib/submissions.ts |
| NS-19 | Sessions et clés : blocage de compte par un tiers, pas d'expiration, liens `//` | basse | src/app/actions.ts, src/lib/auth.ts, src/lib/render.ts |
| NS-20 | Robustesse du worker : pas de jeton d'exclusivité, job orphelin, chemins de montage | basse | worker/worker.mjs, worker/sandbox.mjs |

---

## Partie A — Validité des preuves acceptées

### NS-01 — Le code non fiable écrit là où vivent le vérificateur et la référence (critique)

**Ce que fait le code**
- `worker/worker.mjs:113-117` crée un seul répertoire `jobDir` qui contient `src/Challenge.lean`, `src/Solution.lean`, `src/Compare.lean` (le vérificateur), puis `out/`.
  `worker.mjs:122-123` copie la référence compilée (`Challenge.olean`) dans `out/`.
- `worker/sandbox.mjs:51` monte ce répertoire **en lecture-écriture** (`-v ${hostDir}:/job:rw`) pour **chaque** étape :
  la compilation de la soumission (`worker.mjs:150`), puis `lean --run src/Compare.lean` (`:159`), `leanchecker` (`:178`) et `comparator` (`:190`).
- `worker/ns-run.sh:6` place `/job/out` **en tête** du `LEAN_PATH`, devant Mathlib et la bibliothèque standard.
- `docs/site/security.md` le dit lui-même : « a Lean file can execute arbitrary programs while it compiles ». Le préfiltre n'est pas une barrière (voir NS-09).

**La faille**
Si du code s'exécute pendant l'élaboration de `Solution.lean` (macro, élaborateur ou tactique définis dans le fichier, ou contournement du préfiltre),
il a les droits d'écriture sur `out/` (indispensables pour produire l'`.olean`) et peut-être sur `src/`. Il peut alors :
- remplacer `out/Challenge.olean` par une « référence » qui contient l'énoncé qu'il a réellement prouvé ;
- déposer dans `out/` des modules qui masquent `Init`, `Lean` ou `Mathlib`. Ils seront chargés en priorité par `Compare.lean`, `leanchecker` et `comparator` ;
- réécrire `src/Compare.lean`, si les permissions le permettent, puisqu'il est interprété depuis ce répertoire à l'étape suivante.

Les étapes 5 à 7 jugent donc des artefacts que le candidat a pu modifier. Les contrôles d'axiomes, la comparaison d'énoncés et le rejeu noyau ne garantissent plus rien.

**Impact** : acceptation d'une preuve fausse ou d'un autre énoncé, donc des points (jusqu'à 100 sur un problème ouvert) et un problème marqué « prouvé sur nosorry ».

**Correction**
1. Une étape = un conteneur, avec des montages distincts. Le conteneur de compilation de la soumission ne voit que `src/Solution.lean` en lecture seule et un répertoire de sortie vide.
   Le worker (hôte) ne récupère ensuite **que** `Solution.olean` / `.ilean`, par nom exact. Il rejette tout autre fichier, lien symbolique ou fichier spécial.
2. Les étapes de contrôle tournent dans un nouveau conteneur où la référence (depuis le cache) et la sortie de la soumission sont montées **en lecture seule**.
   Le `LEAN_PATH` y place d'abord la base de l'image, puis un répertoire qui ne contient que `Challenge.olean` et `Solution.olean`.
3. `Compare` devient un **binaire précompilé dans l'image** (`lake build`). On n'interprète plus une source copiée dans le répertoire du job.
4. Vérifier en sortie que l'en-tête de `Solution.olean` n'importe que des modules autorisés (même liste que le préfiltre, mais lue dans l'`.olean`).
5. C'est le modèle de `leanprover/comparator` : la compilation non fiable est isolée (landrun), puis les deux environnements sont exportés et vérifiés par un processus séparé. Voir NS-04.

### NS-03 — Contrôle des définitions incomplet (haute)

**Ce que fait le code** : `Compare.lean:89-102` parcourt les constantes **du seul module Challenge**. Il ignore `n.isInternal` et la cible (`:93`), ignore tous les théorèmes (`:95`),
puis compare pour le reste `kindOf`, `type` et `value` par égalité d'`Expr` (`:100-101`). La valeur des `opaque` n'est pas comparée.

**Ce qui n'est pas couvert**
- **Noms internes** (`_private.*`, `*._unary`, `*._mutual`, `*._proof_*`, etc.). Les définitions auxiliaires produites par la récursion bien fondée ou par `private` sont ignorées.
  Or la valeur d'une définition publique y fait référence **par nom**. Si la soumission peut déclarer un auxiliaire du même nom avec un autre contenu, la définition publique semble « identique » alors que son sens a changé.
  Il reste à vérifier, pour la version de Lean épinglée, quels noms réservés l'élaborateur refuse. La règle « ignorer isInternal » est toutefois fragile par construction.
- **Comparaison à un seul niveau** : on compare `f := g` nom à nom, sans suivre la fermeture des dépendances. Aujourd'hui c'est compensé par le fait que chaque constante non interne du module est comparée. Mais les auxiliaires internes (point précédent) et les constantes d'autres modules (supposées identiques parce qu'elles viennent de la même image, ce qui suppose NS-01 corrigé) échappent au contrôle.
- **Champs non comparés** : `levelParams` des définitions, drapeaux `isUnsafe`/`partial`, `all` (blocs mutuels), et pour les inductifs `numParams`, `numIndices`, `isRec`, `isNested`.
  Comme les recteurs et les constructeurs sont comparés par type, un changement de constructeurs se voit sur `Foo.rec`. Ce n'est vrai que tant que ces noms ne sont pas internes.
- **Pas de liste explicite** : le contrôle porte sur « tout le module Challenge » et non sur « la fermeture de l'énoncé cible ». Une définition de la référence inutile à l'énoncé bloque une soumission (faux négatif), alors qu'un auxiliaire interne utile à l'énoncé n'est pas contrôlé.

**Impact** : une soumission peut modifier le sens d'une définition dont dépend l'énoncé et rester « identique » pour le contrôle.

**Correction** : calculer dans l'environnement Challenge la **fermeture transitive** des constantes utilisées par le type de la cible, **y compris les noms internes et hors module**.
Exiger que chaque constante de cette fermeture existe dans l'environnement Solution avec un `ConstantInfo` **identique** (type, valeur, `levelParams`, sûreté, champs d'inductif, règles de recteur).
Exiger aussi que la soumission n'ait ajouté aucune déclaration à un espace de noms réservé de la référence. C'est l'approche de comparator et de SafeVerify : comparer toute la fermeture, et pas seulement un module, nom par nom.

### NS-04 — `comparator` désactivé, et configuré trop faiblement quand il est actif (haute)

**Ce que fait le code** : `worker.mjs:184-196` ne lance comparator que si `COMPARATOR_BIN` est défini. Sinon l'étape est notée `skipped`.
`Dockerfile.verifier:93` laisse son installation en commentaire. La configuration (`worker.mjs:186-189`) passe `definition_names: []` et `enable_nanoda: false`.
Comparator lit en outre les mêmes `.olean` du répertoire de job, qui sont modifiables (NS-01).
`docs/site/security.md` et `verification.md` le présentent pourtant comme « independent judge… its verdict overrides ours ».

**La faille** : en production standard, le seul juge est `Compare.lean` (NS-03), interprété depuis un répertoire modifiable (NS-01). Même activé, comparator ne reçoit aucune définition à protéger et ne fait pas de seconde vérification par un noyau indépendant.

**Impact** : la défense en profondeur annoncée n'existe pas. Le badge « Right theorem » repose sur un seul contrôle.

**Correction** : construire comparator dans l'image et le rendre **obligatoire** pour toute attribution de points (verdict `needs_review` sinon).
Lui fournir la vraie entrée : un projet Lake avec la source de la référence et celle de la soumission, pour qu'il compile lui-même dans son bac à sable, plutôt que nos `.olean`.
Renseigner `definition_names` avec la fermeture de l'énoncé et activer `enable_nanoda`, qui ajoute un second noyau indépendant.
Prévoir un chemin explicite pour les énoncés à `answer(sorry)`, que comparator rejettera par construction (voir NS-08). Corriger la documentation tant que ce n'est pas fait.

### NS-08 — Les trous `sorry` de l'énoncé acceptent n'importe quel terme (moyenne)

**Ce que fait le code** : dans `Compare.lean:29-31`, **tout** sous-terme `sorryAx …` du type de référence correspond à n'importe quel terme de la soumission et lève `answer_filled`.
`worker.mjs:199` et `scoring.mjs:21` passent alors la preuve en `needs_review`.

**Ce qui n'est pas couvert**
- Le trou n'est pas limité aux emplacements `answer(…)` : un `sorry` placé dans une **hypothèse** ou dans le corps d'une quantification se remplace aussi. Une hypothèse `False` rend l'énoncé trivial.
- Rien n'enregistre **où** se trouvent les trous ni **ce qui** a été mis à la place. Le modérateur ne voit qu'un drapeau et doit relire toute la source.
- `problems.needs_answer` (fixé à l'import) et la détection `answer_filled` ne sont jamais rapprochés.
- La validation (`actions.ts:155-170`) attribue les points sans enregistrer la réponse validée. Une seconde preuve avec une réponse différente repart en revue, sans comparaison possible.

**Correction** : n'accepter des trous **qu'aux positions marquées** par l'élaborateur `answer` (repérables par leur `mdata` ou leur forme élaborée dans formal-conjectures) et rejeter tout autre `sorry` dans le type de référence.
Extraire les termes substitués et les afficher au modérateur (pretty-print) avec le verdict. Après validation, **figer la réponse** dans une nouvelle version de l'énoncé, de sorte que les preuves suivantes se comparent sans trou.
Refuser les énoncés à trous dans `type_matches` lorsque `needs_answer = false`.

### NS-09 — Préfiltre regex contournable (moyenne)

`preflight.mjs` se présente comme un simple filtre (ligne 2). Le constat est donc moyen tant que NS-01 est corrigé, mais critique tant que NS-01 reste ouvert, car ce filtre est alors la seule barrière contre l'exécution de code à la compilation.

**Ce qui n'est pas couvert**
- **Lexer approximatif** (`stripLean`, `:7-18`) : il ne connaît ni les littéraux caractère (`'"'` ouvre une « chaîne » qui avale le code jusqu'au prochain `"`), ni les chaînes brutes `r"…"` / `r#"…"#`, ni les identifiants `«…»`, qui peuvent contenir `"`, `--` ou `/-`.
  Du code réel peut donc être retiré de la vue des règles.
- **Mots-clés absents** de `RULES` (`:20-34`) : `run_tac` et `by_elab` (Mathlib), les élaborateurs déclarés par **attribut** sur une `def` (`@[term_elab]`, `@[command_elab]`, `@[tactic]`, `@[macro]`, `@[init]`, `@[env_linter]`), `deriving` avec des handlers, et `liftIO`, `EIO`, `BaseIO` (le `\b` de `\bIO\b` ne s'applique pas à l'intérieur de `liftIO`).
  Les noms entre guillemets français contournent aussi `set_option debug.` et `\bIO\b`. `maxHeartbeats` accepte n'importe quelle grande valeur non nulle, et `synthInstance.maxHeartbeats 0` passe.
  La règle `axiom` exige un début de ligne : un attribut placé avant sur la même ligne la contourne. Ce dernier cas est rattrapé par le contrôle d'axiomes de `Compare.lean`.
- **Exemption ligne à ligne** (`:50-53`) : toute ligne de la soumission identique (après `trim`) à une ligne de plus de 3 caractères de la référence est effacée avant l'application des règles, où qu'elle soit et quel que soit son contexte.
  Une référence qui contient `set_option maxHeartbeats 0 in`, `open Lean in`, une `macro` ou une `notation` autorise donc ces lignes **partout** dans la soumission. Avec NS-06, c'est un utilisateur qui écrit la référence.
- Les formalisations sautent toutes les règles `meta` (`:58`).

**Ce qui est bien couvert ailleurs** : `native_decide`, `ofReduceBool` et `trustCompiler` laissent des axiomes (`Lean.ofReduceBool`, `Lean.trustCompiler`) dans la fermeture, qui sont rejetés par `Compare.lean:104-105` indépendamment de la regex.
`debug.skipKernelTC` et l'ajout de déclarations sans contrôle sont rattrapés par `leanchecker`. `implemented_by`, `extern` et `opaque` n'ont pas d'effet sur le noyau sans `native_decide`. Tout cela suppose NS-01 corrigé.

**Correction** : faire le filtrage sur le **flux de syntaxe Lean**, en parsant la soumission dans l'image avec le vrai parseur et en refusant les commandes et attributs méta par leur `SyntaxNodeKind`, plutôt que sur du texte.
Remplacer l'exemption ligne à ligne par une exemption **par déclaration**, vérifiée identique à la déclaration correspondante de la référence. Ajouter une limite de heartbeats imposée par le worker (`-D maxHeartbeats=…` en ligne de commande) plutôt que de filtrer `set_option`.

### NS-10 — Confiance dans l'environnement importé et dans l'hôte (moyenne)

- `leanchecker Solution` (`worker.mjs:178`) ne rejoue que les déclarations du module `Solution` et fait confiance aux `.olean` importés, alors que le `LEAN_PATH` commence par `/job/out` (NS-01).
  Mathlib provient de `lake exe cache get` (`Dockerfile.verifier:89`), qui est un cache téléchargé. Les branches par défaut ne sont pas épinglées : `FC_REV=main`, `elan-init.sh` depuis `master` (`:82`, `:85`).
- `docker-compose.yml:71` monte `/var/run/docker.sock` dans le worker. Une compromission du worker équivaut à un accès root sur l'hôte. Les conteneurs de vérification utilisent le runtime par défaut (`Dockerfile.worker:2` mentionne gVisor sans l'imposer).

**Correction** : `leanchecker --fresh` (ou l'export et le rejeu de comparator) pour les attributions à fort enjeu, au moins pour les problèmes `open`, et une ordonnance de `LEAN_PATH` qui place la base en premier.
Épingler `FC_REV`, la version d'elan et le condensé de l'image. Utiliser `--runtime=runsc` (gVisor) ou une machine dédiée, et un proxy du socket Docker limité à `create/start/wait/rm` sur une seule image.

### NS-16 — Doublons et plagiat (moyenne)

`fingerprint` (`preflight.mjs:66-69`) est un SHA-256 du source sans commentaires ni espaces. Renommer un lemme suffit à le contourner.
La recherche (`worker.mjs:106-108`) ne considère que les soumissions antérieures **déjà** `verified/partial/accepted/needs_review`. Deux copies soumises pendant que l'original est encore `queued`/`running` passent toutes les deux.
Une preuve publiée peut donc être reprise, légèrement modifiée, et rapporter les points « later » (10 sur un problème ouvert).

**Correction** : normaliser sur l'**environnement compilé** (hash des termes de preuve à renommage alpha près, ou des noms de lemmes Mathlib utilisés). Inclure les statuts `queued`/`running` dans la recherche, puis réévaluer au moment de l'attribution.
Marquer comme « à relire » toute preuve très proche d'une preuve publique plus ancienne d'un autre auteur.

---

## Partie B — Application web et intégrité des points

### NS-02 — XSS stocké par le rendu Markdown (critique)

**Ce que fait le code** : `src/lib/render.ts:14-15` redéfinit `link({ href, text })` et insère `${text}` tel quel.
Avec `marked` 18.2.1 (version installée), le champ `text` d'un jeton `link` est le **libellé brut** (voir la fonction interne `outputLink` : `text: l[1]`). Le rendu par défaut, lui, appelle `this.parser.parseInline(tokens)`.
Le libellé n'est donc **pas échappé**, ni dans la branche `<a>` ni dans le repli « lien non http » (qui renvoie aussi `text`). Le renderer `html` échappe le HTML, mais pas à l'intérieur d'un libellé de lien.
La CSP (`next.config.ts:5`) autorise `script-src 'unsafe-inline'`, donc les gestionnaires d'événements en ligne s'exécutent.

**Où c'est affiché** (`Md`, `src/components/ui.tsx:17-18`) : corps des critiques (page publique `/p/[slug]:133` **et** page `/mod`), `body_md`, `explanation_md` et `derived_from` des soumissions (`/s/[id]:124-126`, visibles des modérateurs même quand elles sont privées), `statement_md` d'un problème issu d'une formalisation (`actions.ts:178-180`), et `review_note`.

**Impact** : n'importe quel compte peut exécuter du script dans la session d'un modérateur qui ouvre `/mod`.
Les server actions (`reviewSubmission`, `resolveCritique`, `revokeSubmission`) acceptent les requêtes de même origine, donc ce script peut attribuer des points, révoquer des preuves ou modifier des énoncés. Les cookies sont `HttpOnly`, mais l'action se fait au nom du modérateur.

**Correction**
1. Utiliser `this.parser.parseInline(tokens)` dans le renderer `link` (fonction classique, pas fléchée) et échapper le repli.
2. Passer le HTML final par un assainisseur à liste blanche (DOMPurify/jsdom ou `sanitize-html`), avec les balises et classes de KaTeX autorisées.
3. Passer la CSP à des nonces (`script-src 'self' 'nonce-…'`, supporté par Next 15 via le middleware) et retirer `'unsafe-inline'`.
4. Ajouter un test de non-régression sur le rendu des libellés de liens, des titres et des images.

### NS-05 — Modération sans machine à états (haute)

**Ce que fait le code**
- `reviewSubmission` (`actions.ts:143-194`) verrouille la ligne mais **ne vérifie pas** `status = 'needs_review'`. Accepter une soumission `rejected` (échec de compilation ou du noyau) la passe en `verified`.
  Accepter une preuve déjà `verified` et payée ajoute un événement `proof:later`, car il n'existe pas ici de contrôle « mine » comme dans `worker.mjs:259-263`. Deux clics, ou deux modérateurs, paient donc deux fois.
- `points` (`:147`) va jusqu'à 500 et **remplace** la règle pour une preuve (`:154-155`), sans motif obligatoire ni second avis.
- Rien n'empêche un modérateur de valider **sa propre** soumission ou **sa propre** critique (`resolveCritique`, `:220-253`).
- `resolveCritique` ne vérifie pas `cr.status = 'open'`. Une critique acceptée deux fois rapporte deux fois (`:231-234`).
- `reject` ne reverse pas les points éventuellement déjà versés.
- `revokeSubmission` (`:197-217`) ne vérifie pas le statut. Chaque appel « cheating » ajoute une nouvelle pénalité de −50 (`:209-210`).

**Impact** : le classement peut être faussé, par erreur ou délibérément par un modérateur, ou via NS-02.

**Correction** : transitions explicites dans le SQL (`UPDATE … WHERE public_id=$1 AND status='needs_review' RETURNING …`, puis erreur si aucune ligne), et de même `status='open'` pour les critiques.
Interdire `reviewed_by = user_id`. Exiger un motif et un second modérateur au-delà du barème.
Côté base, ajouter un **index unique partiel** sur `point_events (submission_id) WHERE delta > 0 AND reverses_id IS NULL AND reason LIKE 'proof:%'` (idem pour `critique_id`), qui empêche structurellement le double paiement, et `UNIQUE (reverses_id)` contre la double révocation.

### NS-06 — Les formalisations deviennent des problèmes « open » (haute)

**Ce que fait le code** : à l'acceptation d'une formalisation (`actions.ts:173-188`), un problème est créé avec `status 'open'` et `statement_status 'draft'`.
`proofHold` (`scoring.mjs:19-23`) ne gèle que `disputed`. Une preuve d'un énoncé `draft` rapporte donc `POINTS.proof.open.first = 100`, et l'auteur de la formalisation peut la prouver lui-même aussitôt.
Côté worker (`worker.mjs:135-146`), l'étape `inspect statement` ne vérifie pas que la cible contient un `sorry`, malgré le commentaire de la ligne 136. Les axiomes et `answer_filled` sont seulement affichés.
La source de l'utilisateur, avec ses macros autorisées (`preflight.mjs:58`), devient ensuite la référence de tous, et ses lignes sont exemptées dans les preuves (NS-09).

**Impact** : un énoncé facile accepté en revue rapporte 10 + 100 points à son auteur. Le statut « problème ouvert » est dévalué.

**Correction** : créer ces problèmes avec un statut sans points (`test`) ou geler les points tant que `statement_status ∉ {reviewed, frozen}`. Interdire à l'auteur de la formalisation la prime « first ».
Rejeter dans le worker une formalisation dont la cible n'est pas un théorème au corps `sorry` ou qui introduit des axiomes. Interdire les commandes méta dans une référence, ou les faire valider explicitement.

### NS-07 — IP client falsifiable (haute)

**Ce que fait le code** : `api.ts:10-13` et `auth.ts:14-19`. Sans `TRUST_PROXY`, l'en-tête `X-Real-IP` est lu **tel qu'envoyé par le client**. Avec `TRUST_PROXY`, c'est la **première** valeur de `X-Forwarded-For`, que le client contrôle (le proxy ajoute la sienne à la fin).

**Impact** : contournement des limites d'inscription (5/h/IP), de connexion (20/15 min/IP, utile au bourrage d'identifiants) et des limites anonymes de l'API. Le journal d'audit, `sessions.ip` et `submissions.client_ip` deviennent falsifiables.
Avec des inscriptions illimitées, les quotas « par compte » (NS-13) ne protègent plus rien.

**Correction** : ne faire confiance qu'au proxy connu. Prendre la valeur de `X-Forwarded-For` située à N positions de la fin (N = nombre de proxys de confiance), ou un en-tête que le proxy **écrase** (`X-Real-IP` réécrit par nginx, `CF-Connecting-IP`).
Sans proxy, utiliser l'adresse de la socket. Ajouter des limites globales (inscriptions par heure, échecs de connexion par compte).

### NS-11 — Fuites des soumissions « scellées » (moyenne)

**Ce que fait le code**
- `GET /api/v1/submissions/[id]` (`route.ts:18-29`) renvoie à tout visiteur, pour une soumission privée au statut public, `verdict` (JSON complet de `Compare` : lemmes ouverts, taille de la fermeture, axiomes), `open_lemmas`, `review_note` et `latest_run.stages`. Seul `lean_source` est masqué.
- `/s/[id]` (`page.tsx:40-42`, `95-115`) affiche les lemmes ouverts et le détail des étapes à tous.
- `/p/[slug]` (`page.tsx:35`, `111-116`) liste les `open_lemmas` de **toutes** les preuves partielles, privées comprises, car `recentSubmissions` (`data.ts:91`) ne filtre pas `visibility`. L'API `problems/[slug]` filtre pourtant `visibility='public'` (`route.ts:16`), ce qui est incohérent.

**Impact** : les noms de lemmes et la structure d'une réduction partielle sont souvent l'idée clé. Un concurrent peut s'en servir avant que l'auteur ne publie.

**Correction** : pour un non-propriétaire d'une soumission privée, ne renvoyer que le statut, les badges et les dates. Retirer `verdict`, `open_lemmas`, `stages[].detail` et `review_note` (ou le rendre explicitement public).
Ajouter `publicContent` à `recentSubmissions` et l'utiliser sur `/p/[slug]`.

### NS-12 — Clé API dans l'URL (moyenne)

`createApiKey` (`actions.ts:71`) redirige vers `/account?newkey=<clé>`. La clé se retrouve dans l'historique du navigateur, les journaux du proxy et de Next, et éventuellement les outils d'analyse.
`Referrer-Policy: strict-origin-when-cross-origin` évite la fuite vers les autres sites, mais pas les autres.

**Correction** : renvoyer la clé dans l'état du formulaire (`useActionState`) ou dans un cookie flash `HttpOnly` à usage unique, lu puis supprimé par `/account`.

### NS-13 — Équité de la file et ressources (moyenne)

- `claim()` (`worker.mjs:29-38`) sert la file par `priority, id`. Aucun partage équitable par utilisateur : un compte avec 200 jobs (`config.ts:15`) passe devant tous ceux qui soumettent après lui.
  La re-vérification (priorité 40, `actions.ts:245`) passe devant tout.
- Coût maximal d'un job : compilation 20 min, `Compare` 10 min, `leanchecker` 30 min, comparator 30 min (`worker.mjs:126,150,159,178,190` ; `sandbox.mjs:42`). Cela fait environ 90 min, 2 CPU et 8 Go par job.
  Une erreur d'infrastructure (`result = "error"`) relance le job jusqu'à 3 fois (`worker.mjs:225-227`).
- `POST /api/v1/submissions` ne vérifie la taille qu'à partir de `content-length` (`route.ts:12`). Avec un envoi par morceaux, `req.json()` charge tout en mémoire.
  Un lot de 100 éléments peut porter 100 × (1 Mo de source + 8 Mo de transcript).
- Les quotas sont par compte, et les comptes sont faciles à créer (NS-07).

**Correction** : ordonnancer par utilisateur (par exemple `ORDER BY priority, (rang du job chez son auteur), id`, ou un *weighted fair queuing* par `user_id`). Fixer un budget de CPU·minutes par utilisateur et par jour.
Utiliser un délai global plus court pour les problèmes `test`/`textbook`. Lire le corps en flux avec une limite stricte, et appliquer une limite totale par lot.

### NS-14 — Course à la « première preuve » (moyenne)

`awardProof` (`worker.mjs:252-269`) sérialise correctement par problème (`pg_advisory_xact_lock`). Mais « first » désigne la **première vérification terminée**, pas la première soumission.
Une preuve rapide soumise plus tard l'emporte sur une preuve lente soumise plus tôt. Une preuve retenue en revue (`answer`, `disputed`) perd la primauté au profit de toute preuve validée automatiquement pendant l'attente (`actions.ts:157-166`).
Quand la première preuve est révoquée, la suivante ne devient jamais « first ».
Le verrou utilise l'espace de clés `bigint` unique, partagé avec tout autre futur `pg_advisory_*`.

**Correction** : définir la primauté par `submissions.created_at` (ou `id`) parmi les preuves valides, et recalculer lors de toute validation ou révocation avec des événements compensatoires (promotion « later → first »).
Utiliser la forme à deux clés `pg_advisory_xact_lock(<constante 'proof'>, problem_id)`.

### NS-15 — Chemins de re-vérification (moyenne)

- `worker.mjs:240` : si une `reverify` se termine en `error` après épuisement des tentatives, `revokeProof` reverse les points et passe la preuve en `superseded`. Une panne d'infrastructure efface donc des points.
- `resolveCritique` (`actions.ts:243-245`) ne remet en file que `verified` et `needs_review`. Les `partial`, `accepted` et `superseded` gardent leur ancienne version.
  Les points restent acquis tant que le job n'a pas tourné, et une nouvelle source (`new_source`) devient l'énoncé courant **sans avoir été compilée**. Si elle ne compile pas, toutes les preuves sont révoquées.
- `statement_lean` est recopié de l'ancienne version (`:241`). L'affichage montre donc l'ancien énoncé.

**Correction** : ne révoquer que sur un verdict « ne correspond plus » (`rejected`), jamais sur `error`. Faire tourner un job `check_formalization` sur la nouvelle source **avant** de la publier.
Re-vérifier aussi les partiels. Geler les points (statut `disputed`) pendant la re-vérification. Recalculer `statement_lean`.

### NS-17 — Grand livre et audit (basse)

- `001_init.sql:252-253` : des `RULE … DO INSTEAD NOTHING` font **échouer silencieusement** un `UPDATE`/`DELETE` et ne protègent ni contre `TRUNCATE` ni contre le propriétaire de la table (le même rôle que l'application).
  Le README parle de « database rejects updates » ; or la base ne rejette rien, elle ignore. `audit_log` n'a aucune protection.
- `setVisibility`, `createCritique` (web et API) et les publications ne sont pas audités. Les insertions d'audit directes (`actions.ts:190, 213, 249`) n'enregistrent pas l'IP.
- La vue `leaderboard` (`003_leaderboard_fix.sql`) est correcte pour la somme. `open_solved` dépend du statut **actuel** du problème, ce qui est acceptable mais doit être documenté.

**Correction** : utiliser un trigger `BEFORE UPDATE OR DELETE OR TRUNCATE` qui lève une exception, et un rôle applicatif distinct du propriétaire, sans `UPDATE/DELETE/TRUNCATE` sur `point_events` et `audit_log`. Auditer toutes les actions qui changent l'état, avec l'IP.

### NS-18 — Idempotence (basse)

`submissions.ts:42-46` lit puis insère sans verrou. Deux requêtes simultanées avec la même clé font échouer la seconde sur `UNIQUE (user_id, idempotency_key)`, ce qui donne une erreur 500 au lieu de la réponse « duplicate ».
Une même clé réutilisée avec un autre contenu renvoie silencieusement l'ancienne soumission.

**Correction** : `INSERT … ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING`, puis relecture. Stocker le hash de la requête et répondre 409 s'il diffère.

### NS-19 — Sessions, clés, liens (basse)

- `actions.ts:37` : la limite `login-acct:<handle>` (10 / 15 min) permet à un tiers de bloquer la connexion d'un utilisateur donné. Préférer un délai progressif ou un captcha au-delà d'un seuil, plutôt qu'un refus.
- `auth.ts:61` compare des hash avec `!==` (impact négligeable puisqu'il s'agit d'un SHA-256 ; `timingSafeEqual` par principe). Les clés API n'expirent pas, et il n'existe ni déconnexion de toutes les sessions ni rotation lors d'un changement de rôle.
- `render.ts:14` accepte tout `href` commençant par `/`, y compris `//hote.externe` (lien vers l'extérieur sans `target`). Exiger `^/(?![/\\])`.

### NS-20 — Robustesse du worker (basse)

- `finish()` (`worker.mjs:219-241`) ne vérifie pas que le job est toujours verrouillé par ce worker (`locked_by = WORKER_ID`). Après un `reapStale` (`:40-46`), deux workers peuvent écrire deux verdicts différents.
  Le double paiement est évité par la vérification « mine », mais pas l'écrasement du statut. Ajouter un jeton d'exclusivité (`UPDATE jobs … WHERE id=$1 AND locked_by=$2`, rien si 0 ligne).
- `verify()` (`:77`) retourne sans terminer le job si la soumission n'existe plus. Le job boucle jusqu'à `dead`.
- `sandbox.mjs:45` : dans `docker-compose.yml`, `JOBS_HOST_DIR` n'est pas défini. Le chemin interne au conteneur `/jobs/...` est alors monté comme un chemin **de l'hôte**. C'est soit cassé, soit un montage d'un répertoire hôte imprévu. Utiliser un volume nommé monté explicitement.

---

## Points vérifiés sans constat

- **Comparaison au niveau des `Expr`, dans deux environnements séparés** (`Compare.lean:81-87`) : les notations, instances, attributs `simp` et options ajoutés par la soumission ne changent pas le type élaboré de la référence. Ce n'est pas une faille *pour le type de la cible*. Le `mdata` est retiré des deux côtés (`:21-28`) et les paramètres d'univers sont comparés (`:87`).
- `importModules` sans `loadExts` : les initialiseurs des modules ne s'exécutent pas dans le vérificateur.
- `native_decide`, `Lean.trustCompiler` et les axiomes ajoutés sont rejetés par la fermeture d'axiomes, indépendamment du préfiltre. L'ajout de déclarations non vérifiées est rattrapé par `leanchecker`. Les deux supposent NS-01 corrigé.
- **SQL** : toutes les valeurs utilisateur sont passées en paramètres. Les interpolations (`ORDER BY`, `LIMIT`, `OFFSET`, filtres) ne reçoivent que des constantes ou des nombres bornés (`data.ts:50-57`, `problems/route.ts:23-28`). Aucune injection trouvée. Un `page` non numérique peut provoquer une erreur 500 (`OFFSET NaN`).
- Mots de passe en scrypt avec temps constant, sessions et clés stockées en SHA-256, cookies `HttpOnly`/`Secure`/`SameSite=Lax`, contrôle d'origine des server actions par Next, `safeNext` contre les redirections ouvertes.
- KaTeX avec `trust: false` et `maxExpand` borné. Le texte des formules est échappé par KaTeX.

## Référence : lean4checker et comparator

- **lean4checker / `leanchecker`** rejoue les déclarations d'un module dans le noyau. Avec `--fresh`, il rejoue aussi tout l'environnement importé. Il détecte les environnements « bricolés » par métaprogrammation, mais **ne compare pas** l'énoncé à une référence. Son verdict dépend de l'intégrité des fichiers qu'on lui donne (NS-01, NS-10).
- **leanprover/comparator**, d'après sa documentation, compile la référence et la solution dans un bac à sable, exporte les environnements, vérifie que les théorèmes visés **et toutes les constantes dont dépend leur énoncé** sont identiques, que les axiomes appartiennent à la liste autorisée, puis rejoue la solution dans le noyau (et en option dans nanoda).
  C'est exactement ce que `Compare.lean` approche partiellement. La cible est donc : comparator obligatoire et bien configuré (NS-04), plus un chemin de revue dédié aux `answer(…)` (NS-08).
