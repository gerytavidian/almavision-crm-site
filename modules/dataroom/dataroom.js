/* Module Data Room Access (en co-construction, docs/DATAROOM_PLAN.md).

   Page de l'ÉQUIPE. Un acheteur (rôle « invite ») est renvoyé dès le démarrage vers sa page, acheteur.html (même
   dossier, module.json : page_invites) ; l'aperçu de ce qu'il voit se fait ici, par « Voir comme cet acheteur ».
   Carte « Acheteurs » (sql/09_marche.sql) : organisations acheteuses (dr_acheteurs), accès d'une organisation à ses seuls
   projets (dr_acces_organisation), aperçu en lecture seule (dr_apercu_marche, dr_apercu_documents) ; bouton « Créer la
   fiche marketplace » d'une salle (dr_vitrine_depuis_salle).
   L'équipe (rôle « equipe » ou plus sur le module) voit en plus l'écran « Synchronisation » du lot a (plan §6) :
   - les bibliothèques SharePoint suivies, avec leur dernier passage (compteurs, erreurs, alertes), la date d'expiration
     du secret Microsoft (notée ici, alerte 30 jours avant) et un bouton « Synchroniser maintenant », qui appelle la
     fonction serveur « synchro » ;
   - la déclaration d'une bibliothèque ;
   - l'arborescence indexée : état de publication de chaque fichier, création et réglages d'une salle, publication et
     dépublication (confirmation pour un dossier ; pour une salle entière, son code est à taper).
   Carte « Texte et recherche » (lot d1) : état de l'indexation (dr_place), relance d'un document (dr_index_relancer),
   recherche dans une salle (dr_recherche_texte) et bouton « Indexer maintenant » (fonction serveur « indexer »).
   Lot e : étape de chaque dossier de premier niveau et exception d'un fichier (dr_regler_etape), carte « Tester
   l'assistant » (fonction serveur « assistant », consommation : dr_assistant_etat).
   L'équipe lit les tables dr_ (la base les réserve au rôle « equipe ») et n'y écrit jamais : chaque action appelle une
   fonction de la base (dr_ajouter_bibliotheque, dr_regler_bibliotheque, dr_creer_salle, dr_regler_salle, dr_publier,
   dr_depublier), qui contrôle tout et explique ses refus ; son message est affiché tel quel. dr_bibliotheque se lit
   colonne par colonne (jamais toutes les colonnes d'un coup) : la base ne donne pas à l'équipe les adresses de Graph du
   delta (curseur et page en cours) ; une lecture pas finie se voit à la colonne lecture_en_cours. Tout texte venu de la
   base passe par textContent. Les identifiants de SharePoint servent seulement à relier les éléments entre eux : ils ne
   sont jamais affichés. */
(async () => {
  "use strict";
  let P;
  try { P = await window.plateforme.pret; } catch { return; }   // refus ou erreur : la coquille l'a déjà affiché

  // rangs des rôles du module, les mêmes que dans module.json (acces.roles) : contrôlé par tests/test_plateforme.py
  const RANGS = {invite: 10, equipe: 20, admin: 30};
  const role = P.module ? P.module.role : null;
  // un acheteur (rôle « invite ») a sa page, acheteur.html, dans le même dossier : il y est renvoyé sans rien voir ici
  if (role === "invite") {
    window.location.replace(new URL("acheteur.html", window.location.href).href);
    return;
  }
  document.getElementById("dr-presentation").hidden = false;
  document.getElementById("dr").hidden = false;
  if ((RANGS[role] || 0) < RANGS.equipe) return;   // présentation seulement

  const sb = P.sb, conf = window.plateforme.conf;
  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------------ petits outils
  const el = (balise, classe, texte) => {
    const n = document.createElement(balise);
    if (classe) n.className = classe;
    if (texte != null) n.textContent = String(texte);
    return n;
  };
  // cle : repère du bouton, pour lui rendre le focus quand la zone est redessinée (rechargement)
  const bouton = (texte, action, classe = "btn small", etiquette = "", cle = "") => {
    const b = el("button", classe, texte);
    b.type = "button";
    if (etiquette) b.setAttribute("aria-label", etiquette);
    if (cle) b.dataset.cle = cle;
    b.addEventListener("click", action);
    return b;
  };
  const DATE = new Intl.DateTimeFormat("fr-FR", {dateStyle: "short", timeStyle: "short"});
  const HEURE = new Intl.DateTimeFormat("fr-FR", {timeStyle: "short"});
  const JOUR = new Intl.DateTimeFormat("fr-FR", {dateStyle: "short"});
  const NOMBRE = new Intl.NumberFormat("fr-FR", {maximumFractionDigits: 1});
  const TRI = new Intl.Collator("fr", {numeric: true, sensitivity: "base"});
  const date = d => d ? DATE.format(new Date(d)) : "";
  const jourDe = d => d ? JOUR.format(new Date(d)) : "";                     // horodatage -> jour, à l'heure locale
  const jour = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
  // date AAAA-MM-JJ qui existe (pas de 30 février)
  const dateValide = v => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
    if (!m || +m[1] < 2020 || +m[1] > 2100) return false;   // mêmes bornes que dr_regler_bibliotheque
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  };
  // jours entre aujourd'hui (jour local) et une date AAAA-MM-JJ : 0 le jour même, négatif une fois passée
  const joursAvant = d => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ""));
    if (!m) return null;
    const a = new Date();
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  };
  const duree = (a, b) => {
    const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  };
  const taille = o => o == null ? "" : o < 1024 ? `${o} o` : o < 1048576 ? `${NOMBRE.format(o / 1024)} Ko`
    : o < 1073741824 ? `${NOMBRE.format(o / 1048576)} Mo` : `${NOMBRE.format(o / 1073741824)} Go`;
  const compte = (n, mot, pluriel = mot + "s") => `${NOMBRE.format(n)} ${n > 1 ? pluriel : mot}`;
  // dossiers d'abord, puis fichiers, par nom (« Pièce 2 » avant « Pièce 10 »)
  const ordre = (a, b) => (a.type === "fichier") - (b.type === "fichier") || TRI.compare(a.nom, b.nom);

  const A_INSTALLER = "Data Room pas encore installée (règles d'accès à installer : python etl/droits.py --installer).";
  const A_METTRE_A_JOUR = "Data Room à mettre à jour dans la base (règles d'accès à réinstaller : python etl/droits.py --installer).";
  // message d'une erreur de la base : celui de la fonction, tel quel (il explique le refus) ; sans code, c'est le réseau
  const messageBase = e => {
    if (!e) return "";
    const m = String(e.message || e);
    if (e.code === "42501" && /permission denied/i.test(m)) return "refusé par la base (rôle « equipe » du module manquant ?)";
    if (["PGRST202", "42883"].includes(e.code)) return "fonction absente de la base (SQL du module à réinstaller : python etl/droits.py --installer)";
    return e.code ? m : /fetch|network|load failed/i.test(m) ? "pas de réponse de la base (connexion coupée ?), réessayez" : m;
  };
  // colonne absente : SQL du module plus ancien que la page (42703 de Postgres, « column … does not exist »)
  const colonneAbsente = e => ["42703", "PGRST204"].includes(e && e.code) ||
    /column .* does not exist/i.test(String((e && e.message) || ""));
  // table absente : SQL du module pas encore installé (PostgREST répond 404, avec « relation does not exist » ou
  // « schema cache » selon sa version)
  const tableAbsente = (e, statut) => statut === 404 || ["42P01", "PGRST205"].includes(e && e.code) ||
    /does not exist|schema cache/i.test(String((e && e.message) || ""));
  // relation entre deux tables inconnue de l'API (embarquement refusé)
  const relationRefusee = e => ["PGRST200", "PGRST201"].includes(e && e.code);
  const appel = async (fonction, args) => {
    try { return await sb.rpc(fonction, args); } catch (x) { return {data: null, error: x}; }
  };
  const ecrire = (n, texte, classe = "") => { n.className = "dr-msg" + (classe ? " " + classe : ""); n.textContent = texte || ""; };
  // annonce pour les lecteurs d'écran (zone invisible) : les cartes sont redessinées à chaque rechargement
  const annoncer = t => { const a = $("dr-annonce"); a.textContent = ""; setTimeout(() => { a.textContent = t; }, 60); };
  const arbreMsg = (texte, erreur = false) => { ecrire($("dr-arbre-msg"), texte, erreur ? "erreur" : ""); annoncer(texte); };

  // focus gardé d'un dessin à l'autre (les cartes et l'arborescence sont redessinées à chaque rechargement) : chaque
  // commande porte un repère (data-cle) ; le focus revient sur la commande de même repère, sinon sur la ligne de l'élément
  const focusDe = zone => {
    const a = document.activeElement;
    if (!a || a === document.body || !zone.contains(a)) return null;
    const ligne = a.closest(".dr-ligne");
    return {cle: (a.dataset && a.dataset.cle) || "", id: ligne ? ligne.dataset.id : ""};
  };
  function rendreFocus(zone, voulu) {
    if (!voulu) return;
    let n = voulu.cle ? [...zone.querySelectorAll("[data-cle]")].find(x => x.dataset.cle === voulu.cle && !x.disabled) : null;
    if (!n && voulu.id) {
      n = [...zone.querySelectorAll(".dr-ligne")].find(x => x.dataset.id === voulu.id) || null;
      if (n) n.tabIndex = -1;
    }
    if (n) n.focus();
  }

  // champ de formulaire : libellé relié au contrôle, repère de focus
  let numeroChamp = 0;
  const champ = (f, libelle, controle, cle = "") => {
    controle.id = `dr-s-${++numeroChamp}`;
    if (cle) controle.dataset.cle = cle;
    const l = el("label", null, libelle);
    l.htmlFor = controle.id;
    f.append(l, controle);
    return controle;
  };
  const options = (select, liste) => { for (const [v, t] of liste) { const o = el("option", null, t); o.value = v; select.appendChild(o); } return select; };

  // ------------------------------------------------------------------ état et lecture
  // dr_bibliotheque : colonnes nommées une à une (la base ne donne pas les autres à l'équipe)
  const COL_BIBLIO = "id,nom,synchro_le,erreur,verrou_jusqu_a,secret_expire_le,cree_le,lecture_en_cours,enumeration_id," +
                     "enumeration_a_refaire";
  const COL_PASSAGE = "id,debut,fin,complete,pages,ajoutes,modifies,deplaces,retires,depublies,versions_lues,erreurs,alertes";
  const COL_SALLE = "id,code,nom_de_code,type_actif,statut,publication,bibliotheque_id,racine_item_id";
  const COL_ELEMENT = "id,item_id,parent_item_id,type,nom,mime,taille,salle_id,dossier_id,versions_a_jour," +
                      "version_courante_id,version_publiee_id,publie_nom,publie_mime,publie_le,auto_bloque,etape";
  // numéros des versions courante et publiée, lus avec chaque élément (clés étrangères de dr_element vers dr_version)
  const COL_VERSIONS = "version_courante:dr_version!version_courante_id(version_graph,purgee_le)," +
                       "version_publiee:dr_version!version_publiee_id(version_graph,purgee_le)";
  const COL_VERSION = "id,version_graph,purgee_le";
  const PAGE = 1000, PLAFOND = 50000, PAR_PAGE = 200, TAILLE_MAX = 262144000;
  const STATUTS = {preparation: "en préparation", ouverte: "ouverte", close: "close"};
  const TYPES = {developpement: "Développement", exploitation: "En exploitation", portefeuille: "Portefeuille"};
  const PUBLICATIONS = [["manuelle", "Manuelle : l'équipe publie chaque document"],
                        ["auto", "Automatique : les nouvelles versions sont publiées d'office"]];

  const etat = {
    biblios: [],
    attente: new Set(),      // bibliothèques dont la lecture n'est pas finie (delta en cours, relecture complète à faire)
    passages: new Map(),     // bibliothèque -> derniers passages, le plus récent d'abord
    salles: [], salleDe: new Map(), sallesIci: new Map(),
    choisie: null,           // bibliothèque affichée dans l'arborescence
    elements: [], tronque: false, versions: new Map(), premiers: [],
    parId: new Map(), parItem: new Map(), enfants: new Map(), contientSalle: new Set(),
    ouverts: new Set(),      // dossiers dépliés, gardés d'un rechargement à l'autre
    racinesVues: new Set(),  // racines de bibliothèque déjà dépliées une fois (salle sur toute la bibliothèque)
    affiches: new Map(),     // liste (« racine » ou id du dossier) -> nombre d'éléments affichés, gardé de même
    enCours: new Set(),      // synchronisations lancées depuis cette page
    bilans: new Map(),       // bibliothèque -> {texte, erreur} : bilan du dernier « Synchroniser maintenant »
    brouillon: null,         // saisie du formulaire « Créer une salle » ouvert
    confirmation: null,      // {id, retirer, code} : publication ou dépublication d'un dossier à confirmer
    reglages: null,          // {id, nom, statut, publication} : formulaire « Réglages » d'une salle ouvert
    secret: null,            // {id, valeur} : saisie de la date d'expiration du secret ouverte
    focusArbre: null, focusBiblios: null,   // focus à rendre au prochain dessin, après une action
  };
  let msgLecture = false;

  // lecture par tranches de 1 000 lignes (le plafond de l'API), dans un ordre stable
  async function toutes(requete) {
    const lignes = [];
    for (let de = 0; de < PLAFOND; de += PAGE) {
      const {data, error} = await requete().range(de, de + PAGE - 1);
      if (error) throw error;
      lignes.push(...(data || []));
      if (!data || data.length < PAGE) return {lignes, tronque: false};
    }
    return {lignes, tronque: true};
  }

  // éléments d'une bibliothèque avec les numéros de leurs versions, dans la même requête (une par tranche de 1 000) ;
  // repli si l'API ne connaît pas la relation : numéros lus à part, par lots de 100 identifiants, quatre lots à la fois
  async function lireElements(biblio) {
    const lire = colonnes => toutes(() => sb.from("dr_element").select(colonnes)
      .eq("bibliotheque_id", biblio).is("retire_le", null).order("id"));
    const versions = new Map();
    try {
      const r = await lire(COL_ELEMENT + "," + COL_VERSIONS);
      for (const e of r.lignes) {
        if (e.version_courante_id && e.version_courante) versions.set(e.version_courante_id, e.version_courante);
        if (e.version_publiee_id && e.version_publiee) versions.set(e.version_publiee_id, e.version_publiee);
      }
      return {...r, versions};
    } catch (x) {
      if (!relationRefusee(x)) throw x;
    }
    const r = await lire(COL_ELEMENT);
    const ids = [...new Set(r.lignes.flatMap(e => [e.version_courante_id, e.version_publiee_id]).filter(Boolean))];
    const lots = [];
    for (let i = 0; i < ids.length; i += 100) lots.push(ids.slice(i, i + 100));
    for (let i = 0; i < lots.length; i += 4) {
      const reps = await Promise.all(lots.slice(i, i + 4).map(l => sb.from("dr_version").select(COL_VERSION).in("id", l)));
      for (const {data, error} of reps) {
        if (error) throw error;
        for (const v of data || []) versions.set(v.id, v);
      }
    }
    return {...r, versions};
  }

  async function charger() {
    const r = await sb.from("dr_bibliotheque").select(COL_BIBLIO).order("cree_le");
    if (r.error) {
      if (colonneAbsente(r.error)) { pasInstallee(A_METTRE_A_JOUR); return; }
      if (tableAbsente(r.error, r.status)) { pasInstallee(A_INSTALLER); return; }
      throw r.error;
    }
    if (msgLecture) { ecrire($("dr-msg"), ""); msgLecture = false; }
    $("dr-declarer").hidden = $("dr-portee").hidden = false;
    etat.biblios = r.data || [];
    // lecture pas finie : delta en cours (lecture_en_cours, calculée par la base), énumération complète en cours ou à refaire
    etat.attente = new Set(etat.biblios.filter(b => b.lecture_en_cours === true || b.enumeration_id ||
                                                    b.enumeration_a_refaire === true).map(b => b.id));
    const passages = await Promise.all(etat.biblios.map(b => sb.from("dr_synchro").select(COL_PASSAGE)
      .eq("bibliotheque_id", b.id).order("debut", {ascending: false}).limit(6)));
    etat.passages = new Map();
    passages.forEach((p, i) => { if (p.error) throw p.error; etat.passages.set(etat.biblios[i].id, p.data || []); });
    etat.salles = (await toutes(() => sb.from("dr_salle").select(COL_SALLE).order("id"))).lignes;
    etat.salleDe = new Map(etat.salles.map(s => [s.id, s]));
    if (!etat.biblios.some(b => b.id === etat.choisie)) {
      etat.choisie = etat.biblios.length ? etat.biblios[0].id : null;
      oublierArbre();
    }
    if (etat.secret && !etat.biblios.some(b => b.id === etat.secret.id)) etat.secret = null;
    if (etat.reglages && !etat.salleDe.has(etat.reglages.id)) etat.reglages = null;
    afficherBiblios();   // d'abord les bibliothèques : l'arborescence peut être longue à lire

    if (!etat.choisie) { indexer([], false); afficherArbre(); return; }
    if (!etat.elements.length) { $("dr-arbre-zone").hidden = false; $("dr-arbre").textContent = "Lecture de l'arborescence…"; }
    const {lignes, tronque, versions} = await lireElements(etat.choisie);
    indexer(lignes, tronque, versions);
    afficherArbre();
    // erreurs de passage qui désignent un élément : son nom n'est connu qu'une fois l'arborescence lue
    if ([...etat.passages.values()].some(l => l.some(p => Array.isArray(p.erreurs) && p.erreurs.some(x => x && typeof x === "object")))) {
      afficherBiblios();
    }
  }

  // un seul rechargement à la fois (actions et synchronisation peuvent finir en même temps)
  let file = Promise.resolve();
  const recharger = () => (file = file.then(async () => {
    try { await charger(); }
    catch (e) { ecrire($("dr-msg"), "Lecture impossible : " + messageBase(e) + ".", "erreur"); msgLecture = true; }
  }));

  function pasInstallee(texte) {
    $("dr-biblios").textContent = "";
    $("dr-declarer").hidden = $("dr-portee").hidden = true;
    $("dr-arbre-zone").hidden = true;
    ecrire($("dr-msg"), texte, "calme");
    msgLecture = true;
  }

  // nouvelle bibliothèque affichée : dossiers dépliés, pages affichées et formulaires de l'arborescence oubliés
  function oublierArbre() {
    etat.ouverts.clear();
    etat.affiches.clear();
    etat.brouillon = etat.confirmation = etat.reglages = null;
  }

  // ------------------------------------------------------------------ bibliothèques et passages
  const verrouActif = b => !!b.verrou_jusqu_a && Date.parse(b.verrou_jusqu_a) > Date.now();
  const ALERTES = {
    historique_non_conserve: "l'historique des versions n'est pas conservé : vérifier le réglage des versions de la " +
      "bibliothèque (mode manuel, sans expiration)",
    version_publiee_purgee: "la version publiée a disparu de l'historique de SharePoint : le document n'est plus " +
      "disponible pour les acquéreurs, publier la version du moment",
    versions_en_retard: "la liste des versions reste plus ancienne que le fichier après trois lectures : prise telle quelle",
  };
  const texteAlerte = a => `« ${(a && a.nom) || "fichier"} » : ${ALERTES[a && a.type] || `alerte « ${a && a.type} »`}`;
  // erreur d'un passage : texte court de la fonction serveur, ou {element, erreur} de la base (l'identifiant SharePoint
  // de l'élément est remplacé par son nom quand il est connu, jamais affiché)
  const texteErreur = x => {
    if (x && typeof x === "object") {
      const e = etat.parItem.get(String(x.element || ""));
      return `${e ? `« ${e.nom} »` : "Un élément"} : ${x.erreur || "erreur"}`;
    }
    return String(x);
  };
  const compteurs = p => {
    const m = [compte(p.pages || 0, "page lue", "pages lues")];
    const liste = [[p.ajoutes, "ajouté"], [p.modifies, "modifié"], [p.deplaces, "déplacé ou renommé", "déplacés ou renommés"],
                   [p.retires, "retiré"], [p.depublies, "dépublié d'office", "dépubliés d'office"]];
    for (const [n, mot, pluriel] of liste) if (n) m.push(compte(n, mot, pluriel));
    if (p.versions_lues) m.push(`versions lues pour ${compte(p.versions_lues, "fichier")}`);
    if (m.length === 1) m.push("aucun changement");
    return m.join(" · ");
  };
  // alerte d'expiration du secret Microsoft (Entra) : à 30 jours et moins, ou passé
  const alerteSecret = d => {
    const j = joursAvant(d);
    if (j == null || j > 30) return "";
    if (j < 0) {
      return `Le secret Microsoft de la synchronisation a expiré le ${jour(d)} : Microsoft refuse la synchronisation. ` +
        "À renouveler (Entra, puis secrets Supabase), puis noter ici la nouvelle date.";
    }
    const quand = j === 0 ? "aujourd'hui" : j === 1 ? "demain" : `dans ${j} jours`;
    return `Le secret Microsoft de la synchronisation expire ${quand} (${jour(d)}) : à renouveler avant (Entra, puis ` +
      "secrets Supabase), puis noter ici la nouvelle date.";
  };

  function liste(classe, titre, items, texte) {
    const bloc = document.createDocumentFragment();
    if (!items || !items.length) return bloc;
    bloc.appendChild(el("p", classe === "erreurs" ? "dr-erreur" : "dr-note", titre));
    const ul = el("ul", "dr-liste " + classe);
    for (const x of items.slice(0, 20)) ul.appendChild(el("li", null, texte(x)));
    if (items.length > 20) ul.appendChild(el("li", null, `… et ${items.length - 20} autres`));
    bloc.appendChild(ul);
    return bloc;
  }

  function blocPassage(p, b) {
    const bloc = el("div", "dr-passage");
    let titre = `Dernier passage : ${date(p.debut)}`;
    if (p.fin) titre += ` (${duree(p.debut, p.fin)})`;
    else titre += verrouActif(b) ? ", en cours" : ", interrompu avant sa fin (clos au passage suivant)";
    if (p.complete) titre += " · relecture complète de la bibliothèque";
    bloc.appendChild(el("p", "dr-passage-titre", titre));
    bloc.appendChild(el("p", "dr-compteurs", compteurs(p)));
    const erreurs = Array.isArray(p.erreurs) ? p.erreurs : [], alertes = Array.isArray(p.alertes) ? p.alertes : [];
    bloc.appendChild(liste("erreurs", erreurs.length > 1 ? `${erreurs.length} erreurs :` : "Une erreur :", erreurs, texteErreur));
    bloc.appendChild(liste("alertes", alertes.length > 1 ? `${alertes.length} alertes :` : "Une alerte :", alertes, texteAlerte));
    return bloc;
  }

  // date d'expiration du secret Microsoft de la synchronisation : notée par l'équipe (dr_regler_bibliotheque), alerte
  // 30 jours avant
  function blocSecret(b) {
    const bloc = el("div", "dr-secret");
    const ligne = el("div", "dr-secret-ligne");
    const d = b.secret_expire_le, ouvert = !!etat.secret && etat.secret.id === b.id;
    ligne.appendChild(el("p", "dr-note", d ? `Secret Microsoft de la synchronisation : expire le ${jour(d)}.`
      : "Date d'expiration du secret Microsoft non notée : notez-la pour être prévenu 30 jours avant."));
    if (!ouvert) {
      ligne.appendChild(bouton(d ? "Modifier la date" : "Noter la date", () => {
        etat.secret = {id: b.id, valeur: d || ""};
        etat.focusBiblios = {cle: "secret-date:" + b.id};
        afficherBiblios();
      }, "btn small", `${d ? "Modifier" : "Noter"} la date d'expiration du secret Microsoft de « ${b.nom} »`, "secret:" + b.id));
    }
    bloc.appendChild(ligne);
    const alerte = alerteSecret(d);
    if (alerte) bloc.appendChild(el("p", "dr-erreur", alerte));
    if (ouvert) bloc.appendChild(formSecret(b));
    return bloc;
  }

  function formSecret(b) {
    const f = el("form", "dr-form dr-form-secret");
    f.noValidate = true;
    f.autocomplete = "off";
    const d = champ(f, "Expiration du secret (Entra : Certificats et secrets)", el("input"), "secret-date:" + b.id);
    d.type = "date";
    d.required = true;
    d.value = etat.secret.valeur || "";
    const garder = () => { if (etat.secret && etat.secret.id === b.id) etat.secret.valeur = d.value; };
    d.addEventListener("input", garder);
    d.addEventListener("change", garder);
    const msg = el("p", "dr-msg erreur");
    msg.setAttribute("role", "alert");
    const boutons = el("div", "dr-boutons");
    const go = el("button", "btn primary small", "Enregistrer");
    go.type = "submit";
    go.dataset.cle = "secret-go:" + b.id;
    boutons.appendChild(go);
    if (b.secret_expire_le) {
      boutons.appendChild(bouton("Effacer la date", () => enregistrerSecret(b, null, msg, f), "btn small", "", "secret-effacer:" + b.id));
    }
    boutons.appendChild(bouton("Annuler", () => {
      etat.secret = null;
      etat.focusBiblios = {cle: "secret:" + b.id};
      afficherBiblios();
    }, "btn small", "", "secret-annuler:" + b.id));
    f.append(boutons, msg);
    f.addEventListener("submit", ev => {
      ev.preventDefault();
      const v = d.value.trim();
      if (!dateValide(v)) return ecrire(msg, "Date attendue : jour, mois et année (par exemple 20/11/2027).", "erreur");
      enregistrerSecret(b, v, msg, f);
    });
    return f;
  }

  async function enregistrerSecret(b, valeur, msg, f) {
    const boutons = [...f.querySelectorAll("button")];
    for (const x of boutons) x.disabled = true;
    ecrire(msg, "", "erreur");
    const {error} = await appel("dr_regler_bibliotheque", {p_id: b.id, p_reglages: {secret_expire_le: valeur}});
    for (const x of boutons) x.disabled = false;
    if (error) return ecrire(msg, messageBase(error), "erreur");
    etat.secret = null;
    const t = valeur ? `« ${b.nom} » : expiration du secret Microsoft notée au ${jour(valeur)}.`
      : `« ${b.nom} » : date d'expiration du secret Microsoft effacée.`;
    ecrire($("dr-msg"), t);
    annoncer(t);
    etat.focusBiblios = {cle: "secret:" + b.id};
    await recharger();
  }

  function carteBiblio(b) {
    const carte = el("article", "dr-biblio");
    const tete = el("div", "dr-tete");
    tete.appendChild(el("h3", null, b.nom));
    const enCours = etat.enCours.has(b.id);
    const go = bouton(enCours ? "Synchronisation en cours…" : "Synchroniser maintenant", () => synchroniser(b),
                      "btn primary small", enCours ? "" : `Synchroniser maintenant la bibliothèque « ${b.nom} »`, "synchro:" + b.id);
    go.disabled = enCours;
    tete.appendChild(go);
    carte.appendChild(tete);
    carte.appendChild(el("p", "dr-note", b.synchro_le ? `Dernière synchronisation complète : ${date(b.synchro_le)}.`
      : "Jamais synchronisée : cliquez « Synchroniser maintenant » pour lire son contenu."));
    if (verrouActif(b) && !enCours) {
      carte.appendChild(el("p", "dr-note", "Un passage est en cours (synchronisation automatique ou lancée par un collègue)."));
    }
    if (etat.attente.has(b.id)) {
      carte.appendChild(el("p", "dr-note", "Lecture pas finie (elle se fait en plusieurs passages, ou une relecture complète " +
        "est à faire) : la publication attend le prochain passage."));
    }
    if (b.erreur) carte.appendChild(el("p", "dr-erreur", "Dernière erreur : " + b.erreur));
    carte.appendChild(blocSecret(b));
    const bilan = etat.bilans.get(b.id);
    if (bilan) carte.appendChild(el("p", bilan.erreur ? "dr-erreur" : "dr-bilan", bilan.texte));
    const passages = etat.passages.get(b.id) || [];
    if (passages.length) carte.appendChild(blocPassage(passages[0], b));
    if (passages.length > 1) {
      const det = el("details", "dr-precedents");
      det.appendChild(el("summary", null, "Passages précédents"));
      const ul = el("ul", "dr-liste");
      for (const p of passages.slice(1)) {
        const n = Array.isArray(p.erreurs) ? p.erreurs.length : 0;
        ul.appendChild(el("li", null, `${date(p.debut)}${p.fin ? "" : " (interrompu)"} : ${compteurs(p)}` +
          (n ? ` · ${compte(n, "erreur")}` : "")));
      }
      det.appendChild(ul);
      carte.appendChild(det);
    }
    return carte;
  }

  function afficherBiblios() {
    const zone = $("dr-biblios");
    const voulu = etat.focusBiblios || focusDe(zone);
    etat.focusBiblios = null;
    zone.textContent = "";
    if (!etat.biblios.length) {
      zone.appendChild(el("p", "dr-vide", "Aucune bibliothèque déclarée : déclarez celle du site « Data rooms » ci-dessous, " +
        "puis synchronisez."));
      $("dr-declarer").open = true;
      return;
    }
    for (const b of etat.biblios) zone.appendChild(carteBiblio(b));
    rendreFocus(zone, voulu);
  }

  // ------------------------------------------------------------------ « Synchroniser maintenant »
  // Fonction serveur « synchro » (supabase/functions/synchro/index.ts) : jeton de la personne dans l'en-tête (jamais
  // dans l'adresse) avec la clé publique du projet, aucune redirection suivie (le jeton ne part que vers Supabase). Un
  // passage dure jusqu'à 2 minutes environ. Réponse au bouton (synchrone) : {bibliotheques: [{id, nom, statut, pages,
  // elements, versions_lues, erreurs, refuses}]}, statut « fini », « interrompu » (budget de temps atteint), « erreur »,
  // « deja_en_cours » ou « reporte » ; en cas de refus : {erreur: "texte court"}. 202 : passage lancé en arrière-plan.
  async function appelerSynchro(id) {
    let jeton = P.session.access_token;
    try { const {data} = await sb.auth.getSession(); if (data && data.session) jeton = data.session.access_token; } catch {}
    const arret = new AbortController(), minuterie = setTimeout(() => arret.abort(), 180000);
    let rep, corps = null;
    try {
      rep = await fetch(`${conf.url}/functions/v1/synchro`, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal: arret.signal,
        headers: {"Authorization": `Bearer ${jeton}`, "apikey": conf.cle, "Content-Type": "application/json"},
        body: JSON.stringify({bibliotheque: id}),
      });
      try { corps = await rep.json(); } catch { corps = null; }
    } catch {
      return {texte: arret.signal.aborted
        ? "Pas de réponse au bout de 3 minutes : le passage continue peut-être sur le serveur. Rechargez dans un moment."
        : "Pas de réponse du serveur : connexion coupée, ou fonction de synchronisation pas encore installée. Réessayez dans un moment."};
    } finally { clearTimeout(minuterie); }
    // détail donné par la fonction elle-même (texte court, sans adresse ni secret)
    const erreur = corps && typeof corps.erreur === "string" && corps.erreur ? corps.erreur.slice(0, 300) : "";
    const res = corps && Array.isArray(corps.bibliotheques) ? corps.bibliotheques.find(x => x && x.id === id) : null;
    const statut = res ? String(res.statut || "") : "";
    if (rep.status === 409 || statut === "deja_en_cours") {
      return {occupe: true, texte: "Un passage est déjà en cours (synchronisation automatique ou lancée par un collègue) : " +
        "son bilan s'affichera ici au prochain rechargement."};
    }
    if (rep.status === 202) {
      return {occupe: true, texte: "Passage lancé sur le serveur : son bilan s'affichera ici au prochain rechargement."};
    }
    if (rep.ok && statut === "reporte") {
      return {occupe: true, texte: "Pas commencée : temps permis atteint, ou SharePoint demande d'attendre (limite de " +
        "requêtes). Réessayez dans quelques minutes."};
    }
    if (rep.ok) {
      const erreurs = res && Array.isArray(res.erreurs) ? res.erreurs.filter(x => typeof x === "string") : [];
      return {ok: true, statut, erreurs};
    }
    // 5xx : la fonction a échoué avant d'ouvrir un passage (configuration, liste des bibliothèques), ou a été coupée
    // pendant ; rien n'est forcément noté sur la bibliothèque
    if (rep.status >= 500) {
      return {texte: `La fonction de synchronisation a échoué avant ou pendant le passage (code ${rep.status}` +
        `${erreur ? ` : ${erreur}` : ""}). Voir le journal de la fonction (Supabase : Edge Functions > synchro > Logs) ` +
        "et, après rechargement, la carte de la bibliothèque."};
    }
    const textes = {
      400: "Demande refusée par la fonction de synchronisation",
      401: "Refusé : session expirée ou compte sans le rôle « equipe » du module ; reconnectez-vous, puis réessayez",
      403: "Refusé par le serveur (adresse de la page non autorisée)",
      404: "Fonction de synchronisation introuvable (pas encore déployée ?) ou bibliothèque inconnue",
      429: "Trop de demandes : réessayez dans une minute",
    };
    return {texte: (textes[rep.status] || `Réponse inattendue du serveur (code ${rep.status})`) +
      (erreur ? ` (${erreur})` : "") + "."};
  }

  function bilanPassage(p, b, depuis, r) {
    // passage plus ancien que le clic (une minute de marge pour les horloges) : la fonction n'en a pas ouvert de nouveau
    if (!p || Date.parse(p.debut) < depuis - 60000) {
      return r.erreurs.length ? `La synchronisation n'a pas pu commencer : ${r.erreurs.slice(0, 3).join(" ; ")}.`
        : "La fonction a répondu, mais aucun nouveau passage n'est enregistré (un passage était peut-être déjà en cours).";
    }
    let t = p.fin ? `Passage terminé à ${HEURE.format(new Date(p.fin))} : ${compteurs(p)}.`
      : `Passage commencé à ${HEURE.format(new Date(p.debut))}, pas encore clos.`;
    const n = Array.isArray(p.erreurs) ? p.erreurs.length : 0;
    if (n) t += ` ${n > 1 ? `${n} erreurs` : "Une erreur"} (détail ci-dessous).`;
    else if (r.erreurs.length) t += ` Erreur : ${r.erreurs.slice(0, 3).join(" ; ")}.`;
    if (r.statut === "interrompu") t += " Temps permis atteint : le passage s'est arrêté proprement.";
    if (etat.attente.has(b.id)) {
      t += " La lecture n'est pas finie : la suite au prochain « Synchroniser maintenant ».";
    }
    return t;
  }

  async function synchroniser(b) {
    if (etat.enCours.has(b.id)) return;
    const a = document.activeElement, cle = "synchro:" + b.id;
    const avaitFocus = !!a && !!a.dataset && a.dataset.cle === cle;
    etat.enCours.add(b.id);
    etat.bilans.set(b.id, {texte: "Passage en cours : jusqu'à 2 minutes environ. La page peut rester ouverte."});
    afficherBiblios();
    annoncer(`Synchronisation de « ${b.nom} » lancée.`);
    const depuis = Date.now();
    const r = await appelerSynchro(b.id);
    etat.enCours.delete(b.id);
    await recharger();
    const bilan = r.ok ? {texte: bilanPassage((etat.passages.get(b.id) || [])[0], b, depuis, r), erreur: r.statut === "erreur"}
      : {texte: r.texte, erreur: !r.occupe};
    etat.bilans.set(b.id, bilan);
    // le bouton, désactivé pendant le passage, avait perdu le focus : il le retrouve si personne ne l'a pris ailleurs
    const ici = document.activeElement;
    if (avaitFocus && (!ici || ici === document.body)) etat.focusBiblios = {cle};
    afficherBiblios();
    annoncer(bilan.texte);
  }

  // ------------------------------------------------------------------ déclaration d'une bibliothèque
  /** Appel de la fonction synchro pour une demande en lecture seule ({site} ou {sites}) : {rep, corps} ou null. */
  async function demanderSynchro(corps) {
    let jeton = P.session.access_token;
    try { const {data} = await sb.auth.getSession(); if (data && data.session) jeton = data.session.access_token; } catch {}
    try {
      const rep = await fetch(`${conf.url}/functions/v1/synchro`, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
        headers: {"Authorization": `Bearer ${jeton}`, "apikey": conf.cle, "Content-Type": "application/json"},
        body: JSON.stringify(corps),
      });
      let lu = null;
      try { lu = await rep.json(); } catch { lu = null; }
      return {rep, corps: lu};
    } catch {
      return null;
    }
  }

  // portée de lecture : quels sites l'application Graph actuelle lit déjà (lecture seule, rien n'est déclaré)
  const ETATS_SITE = {lisible: "lu par l'application", acces_refuse: "refusé par Microsoft (l'application n'a pas la lecture de ce site)",
    introuvable: "introuvable (adresse à vérifier)", adresse_invalide: "adresse non reconnue (adresse d'un site SharePoint attendue : https://…/sites/<site>)",
    erreur: "erreur de Microsoft", non_verifie: "non vérifié (arrêt plus haut)"};
  async function verifierPortee(ev) {
    ev.preventDefault();
    const m = $("dr-p-msg"), liste = $("dr-p-liste"), go = $("dr-p-go");
    const adresses = [...new Set($("dr-p-adresses").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean))];
    liste.textContent = "";
    if (!adresses.length) return ecrire(m, "Collez au moins une adresse de site.", "erreur");
    if (adresses.length > 60) return ecrire(m, "60 adresses au plus par vérification.", "erreur");
    go.disabled = true;
    ecrire(m, `Vérification de ${adresses.length} site(s) auprès de Microsoft…`);
    const r = await demanderSynchro({sites: adresses.map(a => a.slice(0, 400))});
    go.disabled = false;
    if (!r) return ecrire(m, "Pas de réponse du serveur : fonction de synchronisation pas encore installée, ou connexion coupée.", "erreur");
    const sites = r.corps && Array.isArray(r.corps.sites) ? r.corps.sites : null;
    if (!r.rep.ok || !sites) {
      const detail = r.corps && typeof r.corps.erreur === "string" ? r.corps.erreur.slice(0, 300) : `réponse ${r.rep.status}`;
      return ecrire(m, `Vérification impossible : ${detail}`, "erreur");
    }
    const lisibles = sites.filter(x => x && x.etat === "lisible").length;
    ecrire(m, `${lisibles} site(s) lu(s) par l'application sur ${sites.length}.`);
    annoncer(`${lisibles} site(s) lu(s) sur ${sites.length}.`);
    for (const x of sites.slice(0, 60)) {
      if (!x || typeof x !== "object") continue;
      const li = el("li", "dr-portee-" + (x.etat === "lisible" ? "ok" : "non"));
      li.append(el("b", null, String(x.nom || x.adresse || "").slice(0, 200)), " · ",
                ETATS_SITE[x.etat] || String(x.etat).slice(0, 40));
      if (x.adresse && x.nom) li.append(el("span", "dr-lieu", String(x.adresse).slice(0, 400)));
      if (x.etat === "lisible" && Array.isArray(x.bibliotheques)) {
        const sous = el("ul");
        for (const b of x.bibliotheques.slice(0, 50)) {
          if (!b || typeof b.drive_id !== "string") continue;
          const lb = el("li", null, `Bibliothèque « ${String(b.nom || "").slice(0, 200)} »`);
          {
            lb.appendChild(bouton("Déclarer", () => {
              $("dr-b-nom").value = `${String(x.nom || "").slice(0, 120)} · ${String(b.nom || "").slice(0, 70)}`.slice(0, 200);
              $("dr-b-site").value = String(x.site_id || "").slice(0, 300);
              $("dr-b-drive").value = b.drive_id.slice(0, 200);
              $("dr-declarer").open = true;
              ecrire($("dr-b-msg"), "Identifiants remplis : vérifiez puis « Déclarer ».");
              $("dr-b-go").focus();
            }, "btn small", `Déclarer la bibliothèque « ${String(b.nom || "")} » du site ${String(x.nom || "")}`));
          }
          sous.appendChild(lb);
        }
        li.appendChild(sous);
      }
      liste.appendChild(li);
    }
  }

  /** Identifiants d'un site SharePoint, lus par la fonction synchro avec l'application Graph (lecture seule). */
  async function trouverSite() {
    const adresse = $("dr-b-adresse").value.trim(), m = $("dr-b-msg"), go = $("dr-b-trouver");
    ecrire(m, "", "erreur");
    if (!/^https:\/\/[a-z0-9-]+\.sharepoint\.com\/(sites|teams)\/[^/?#]+/i.test(adresse) || adresse.length > 400) {
      return ecrire(m, "Adresse attendue : celle du site SharePoint, copiée depuis le navigateur (https://…/sites/<nom>).", "erreur");
    }
    let jeton = P.session.access_token;
    try { const {data} = await sb.auth.getSession(); if (data && data.session) jeton = data.session.access_token; } catch {}
    go.disabled = true;
    ecrire(m, "Lecture du site auprès de Microsoft…");
    let rep, corps = null;
    try {
      rep = await fetch(`${conf.url}/functions/v1/synchro`, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
        headers: {"Authorization": `Bearer ${jeton}`, "apikey": conf.cle, "Content-Type": "application/json"},
        body: JSON.stringify({site: adresse}),
      });
      try { corps = await rep.json(); } catch { corps = null; }
    } catch {
      go.disabled = false;
      return ecrire(m, "Pas de réponse du serveur : fonction de synchronisation pas encore installée, ou connexion coupée.", "erreur");
    }
    go.disabled = false;
    const s = corps && corps.site;
    if (!rep.ok || !s || typeof s.site_id !== "string" || typeof s.drive_id !== "string") {
      const detail = corps && typeof corps.erreur === "string" ? corps.erreur.slice(0, 300) : `réponse ${rep.status}`;
      return ecrire(m, `Site non lu : ${detail}`, "erreur");
    }
    $("dr-b-site").value = s.site_id.slice(0, 300);
    $("dr-b-drive").value = s.drive_id.slice(0, 200);
    if (s.nom) $("dr-b-nom").value = String(s.nom).slice(0, 200);
    const autres = Array.isArray(s.bibliotheques) ? s.bibliotheques.length - 1 : 0;
    ecrire(m, `Site « ${String(s.nom || "").slice(0, 200)} » lu, bibliothèque « ${String(s.bibliotheque || "").slice(0, 200)} » : ` +
      "vérifiez puis « Déclarer »." + (autres > 0 ? ` Ce site a ${autres} autre(s) bibliothèque(s) : voir « Portée de lecture ».` : ""));
  }

  async function declarer(ev) {
    ev.preventDefault();
    const nom = $("dr-b-nom").value.trim(), site = $("dr-b-site").value.trim(), drive = $("dr-b-drive").value.trim();
    const m = $("dr-b-msg"), go = $("dr-b-go");
    ecrire(m, "", "erreur");
    if (!nom || nom.length > 200) return ecrire(m, "Nom : de 1 à 200 caractères.", "erreur");
    if (!site || site.length > 300) return ecrire(m, "Identifiant du site : de 1 à 300 caractères.", "erreur");
    if (!/^[A-Za-z0-9!._-]{1,200}$/.test(drive)) {
      return ecrire(m, "Identifiant de la bibliothèque : lettres, chiffres et ! . _ - seulement (il commence en général par « b! »).", "erreur");
    }
    go.disabled = true;
    const {error} = await appel("dr_ajouter_bibliotheque", {p_nom: nom, p_site_id: site, p_drive_id: drive});
    go.disabled = false;
    if (error) return ecrire(m, messageBase(error), "erreur");
    $("dr-b-site").value = "";
    $("dr-b-drive").value = "";
    $("dr-declarer").open = false;
    ecrire($("dr-msg"), `Bibliothèque « ${nom} » déclarée : cliquez « Synchroniser maintenant » pour lire son contenu, ` +
      "puis notez la date d'expiration du secret Microsoft.");
    annoncer(`Bibliothèque « ${nom} » déclarée.`);
    await recharger();
  }

  // ------------------------------------------------------------------ arborescence
  function indexer(lignes, tronque, versions = new Map()) {
    Object.assign(etat, {elements: lignes, tronque, versions, parId: new Map(), parItem: new Map(), enfants: new Map(),
                         contientSalle: new Set()});
    for (const e of lignes) { etat.parId.set(e.id, e); etat.parItem.set(e.item_id, e); }
    for (const e of lignes) {
      if (!e.parent_item_id) continue;
      if (!etat.enfants.has(e.parent_item_id)) etat.enfants.set(e.parent_item_id, []);
      etat.enfants.get(e.parent_item_id).push(e);
    }
    for (const l of etat.enfants.values()) l.sort(ordre);
    etat.sallesIci = new Map(etat.salles.filter(s => s.bibliotheque_id === etat.choisie).map(s => [s.racine_item_id, s]));
    // dossiers qui contiennent une salle : pas de « Créer une salle ici » (pas de salle dans une salle)
    for (const racine of etat.sallesIci.keys()) {
      let p = etat.parItem.get(racine);
      for (let n = 0; p && p.parent_item_id && n < 64; n++) {
        p = etat.parItem.get(p.parent_item_id);
        if (p) etat.contientSalle.add(p.id);
      }
    }
    // la racine de la bibliothèque n'est pas affichée : ses enfants forment le premier niveau ; un élément dont le
    // dossier parent n'est pas lu (lecture en cours) est montré au premier niveau
    const racines = new Set(lignes.filter(e => e.type === "racine").map(e => e.item_id));
    etat.premiers = lignes.filter(e => e.type !== "racine" &&
      (racines.has(e.parent_item_id) || !etat.parItem.has(e.parent_item_id))).sort(ordre);
    // une bibliothèque peut être un projet à elle seule (un site SharePoint par opération) : sa racine est alors la
    // racine de la salle, affichée en tête, ses dossiers de premier niveau dessous
    etat.racine = lignes.find(e => e.type === "racine") || null;
    if (etat.racine && etat.sallesIci.has(etat.racine.item_id) && !etat.racinesVues.has(etat.racine.id)) {
      etat.racinesVues.add(etat.racine.id);
      etat.ouverts.add(etat.racine.id);
    }
  }

  // la racine est affichée comme un élément quand elle porte une salle, ou que le formulaire de salle y est ouvert
  const racineAffichee = () => !!etat.racine && (etat.sallesIci.has(etat.racine.item_id) ||
    (!!etat.brouillon && etat.brouillon.id === etat.racine.id));
  // nom montré : la racine porte le nom de la bibliothèque (Microsoft la nomme « root »)
  function nomAffiche(e) {
    if (e.type !== "racine") return e.nom;
    const b = etat.biblios.find(x => x.id === etat.choisie);
    return b ? `${b.nom} (toute la bibliothèque)` : "Toute la bibliothèque";
  }

  function etatFichier(e) {
    const vc = etat.versions.get(e.version_courante_id), vp = etat.versions.get(e.version_publiee_id);
    const num = v => v ? v.version_graph : "?";
    if (!e.dossier_id) return {classe: "", texte: "à la racine de la salle : à ranger dans un dossier pour être publié"};
    if (e.version_publiee_id) {
      let t = `publié le ${jourDe(e.publie_le) || "?"} · version ${num(vp)}`;
      if (e.publie_nom && e.publie_nom !== e.nom) t += ` · nom figé « ${e.publie_nom} »`;
      if (vp && vp.purgee_le) t += " · version disparue de l'historique de SharePoint, à republier";
      if (e.versions_a_jour && e.version_courante_id && e.version_courante_id !== e.version_publiee_id) {
        return {classe: "a-publier", texte: `${t} · nouvelle version ${num(vc)} à publier`};
      }
      return {classe: "publie", texte: t};
    }
    if (!e.versions_a_jour || !e.version_courante_id) return {classe: "", texte: "non publié · versions pas encore lues"};
    return {classe: "", texte: `non publié · version ${num(vc)}` +
      (e.auto_bloque ? " · dépublié : republication par l'équipe seulement" : "")};
  }

  // cle : repère de la commande qui aura le focus après le rechargement (sinon, la ligne de l'élément)
  async function publier(e, b, retirer, cle = b ? b.dataset.cle : "") {
    if (b) b.disabled = true;
    const {data, error} = await appel(retirer ? "dr_depublier" : "dr_publier", {p_element: e.id});
    const n = Number(data) || 0;
    if (error) arbreMsg(`« ${e.nom} » : ${messageBase(error)}`, true);
    else if (retirer) arbreMsg(`« ${e.nom} » : ${n ? compte(n, "fichier dépublié", "fichiers dépubliés") : "rien à dépublier"}.`);
    else if (e.type === "fichier") arbreMsg(n ? `« ${e.nom} » publié.` : `« ${e.nom} » : déjà publié dans cette version.`);
    else arbreMsg(`« ${e.nom} » : ${n ? compte(n, "fichier publié", "fichiers publiés")
      : "aucun fichier à publier (déjà publiés, versions pas encore lues, ou fichiers à la racine de la salle)"}.`);
    etat.focusArbre = {cle, id: e.id};
    await recharger();
    etat.focusArbre = null;
    if (b) b.disabled = false;   // utile seulement si le rechargement a échoué (sinon la ligne est redessinée)
  }

  // fichiers d'un dossier et de ses sous-dossiers, sans entrer dans la racine d'une autre salle (comme dr__sous_arbre)
  function fichiersDe(e) {
    const fichiers = [], vus = new Set([e.item_id]), pile = [e.item_id];
    while (pile.length) {
      for (const c of etat.enfants.get(pile.pop()) || []) {
        if (c.type === "fichier") fichiers.push(c);
        else if (!vus.has(c.item_id) && !etat.sallesIci.has(c.item_id)) { vus.add(c.item_id); pile.push(c.item_id); }
      }
    }
    return fichiers;
  }
  // publiable d'après la dernière lecture (la base décide : dr__publier)
  const publiable = f => !!(f.salle_id && f.dossier_id && f.versions_a_jour && f.version_courante_id &&
    f.version_courante_id !== f.version_publiee_id && !(etat.versions.get(f.version_courante_id) || {}).purgee_le &&
    !(f.taille > TAILLE_MAX));

  // publication ou dépublication d'un dossier : à confirmer, avec le nombre de fichiers concernés ; pour le dossier
  // racine d'une salle (toute la salle), le code de la salle est à taper
  function demanderConfirmation(e, li, retirer) {
    for (const autre of $("dr-arbre").querySelectorAll(".dr-confirmer")) autre.remove();
    etat.confirmation = {id: e.id, retirer, code: ""};
    const p = panneauConfirmation(e);
    li.insertBefore(p, li.children[1] || null);
    (p.querySelector("input") || p.querySelector("button")).focus();
  }

  function panneauConfirmation(e) {
    const c = etat.confirmation, retirer = c.retirer, action = (retirer ? "depublier:" : "publier:") + e.id;
    const salle = etat.sallesIci.get(e.item_id) || null;
    const fichiers = fichiersDe(e);
    const n = retirer ? fichiers.filter(f => f.version_publiee_id).length : fichiers.filter(publiable).length;
    const quoi = salle ? `toute la salle ${salle.code} « ${salle.nom_de_code} »` : `le dossier « ${e.nom} »`;
    let texte;
    if (retirer) {
      texte = n ? `Dépublier ${compte(n, "fichier publié", "fichiers publiés")} dans ${quoi} ? Les acquéreurs n'y auront ` +
        "plus accès, jusqu'à une nouvelle publication par l'équipe."
        : `Aucun fichier publié dans ${quoi} d'après la dernière lecture. Dépublier quand même ?`;
    } else {
      texte = n ? `Publier ${compte(n, "fichier")} dans ${quoi} ? Chaque fichier est publié dans sa version du moment et ` +
        "devient visible des acquéreurs qui ont accès à son dossier."
        : `Aucun fichier à publier dans ${quoi} d'après la dernière lecture (déjà publiés, versions pas encore lues ou ` +
          "fichiers à la racine de la salle). Publier quand même ?";
      if (n && fichiers.length > n) {
        texte += ` ${compte(fichiers.length - n, "autre fichier", "autres fichiers")} : déjà publiés, versions pas encore ` +
          "lues ou à la racine de la salle.";
      }
    }
    if (etat.tronque) texte += " Arborescence lue en partie : le nombre réel peut être plus grand.";
    const f = el("form", "dr-form dr-confirmer");
    f.noValidate = true;
    f.autocomplete = "off";
    f.appendChild(el("p", "dr-confirmer-texte", texte));
    let code = null;
    if (salle) {
      code = champ(f, `Pour confirmer, tapez le code de la salle (${salle.code})`, el("input"), "confirmer-code:" + e.id);
      code.maxLength = 11;
      code.spellcheck = false;
      code.value = c.code || "";
      code.addEventListener("input", () => { if (etat.confirmation && etat.confirmation.id === e.id) etat.confirmation.code = code.value; });
    }
    const msg = el("p", "dr-msg erreur");
    msg.setAttribute("role", "alert");
    const boutons = el("div", "dr-boutons");
    const go = el("button", "btn primary small", retirer ? (n ? `Dépublier ${compte(n, "fichier")}` : "Dépublier quand même")
      : (n ? `Publier ${compte(n, "fichier")}` : "Publier quand même"));
    go.type = "submit";
    go.dataset.cle = "confirmer:" + e.id;
    boutons.append(go, bouton("Annuler", () => {
      etat.confirmation = null;
      f.remove();
      rendreFocus($("dr-arbre"), {cle: action, id: e.id});
    }, "btn small", "", "annuler:" + e.id));
    f.append(boutons, msg);
    f.addEventListener("submit", ev => {
      ev.preventDefault();
      if (salle && code.value.trim().toUpperCase() !== salle.code) {
        return ecrire(msg, `Code de la salle attendu : ${salle.code}. Rien n'a été ${retirer ? "dépublié" : "publié"}.`, "erreur");
      }
      etat.confirmation = null;
      f.remove();
      publier(e, null, retirer, action);
    });
    return f;
  }

  function codeSuivant() {
    const an = new Date().getFullYear();
    const pris = etat.salles.map(s => /^DR-(\d{4})-(\d{3})$/.exec(s.code)).filter(m => m && +m[1] === an).map(m => +m[2]);
    const n = Math.max(0, ...pris) + 1;
    return n <= 999 ? `DR-${an}-${String(n).padStart(3, "0")}` : "";
  }

  function formSalle(e) {
    const f = el("form", "dr-form dr-form-salle");
    f.noValidate = true;
    f.autocomplete = "off";
    f.appendChild(el("p", "dr-form-titre", e.type === "racine" ? `Nouvelle salle sur ${nomAffiche(e)}`
                                                               : `Nouvelle salle sur le dossier « ${e.nom} »`));
    const code = champ(f, "Code (DR-AAAA-NNN)", el("input"), "salle-code:" + e.id);
    code.maxLength = 11; code.spellcheck = false; code.required = true;
    const nomCode = champ(f, "Nom de code (vu des acquéreurs)", el("input"), "salle-nom:" + e.id);
    nomCode.maxLength = 120; nomCode.required = true;
    const type = champ(f, "Type d'actif", options(el("select"), [["", "Non précisé"], ...Object.entries(TYPES)]), "salle-type:" + e.id);
    const mw = champ(f, "Puissance en MW (facultatif)", el("input"), "salle-mw:" + e.id);
    mw.type = "number"; mw.min = "0"; mw.step = "0.001"; mw.inputMode = "decimal";
    const pub = champ(f, "Publication", options(el("select"), PUBLICATIONS), "salle-pub:" + e.id);
    const b = etat.brouillon && etat.brouillon.id === e.id ? etat.brouillon : {code: codeSuivant(), nom: "", type: "", mw: "", pub: "manuelle"};
    code.value = b.code; nomCode.value = b.nom; type.value = b.type; mw.value = b.mw; pub.value = b.pub;
    const garder = () => { etat.brouillon = {id: e.id, code: code.value, nom: nomCode.value, type: type.value, mw: mw.value, pub: pub.value}; };
    f.addEventListener("input", garder);
    f.addEventListener("change", garder);
    garder();
    const msg = el("p", "dr-msg erreur");
    msg.setAttribute("role", "alert");
    const boutons = el("div", "dr-boutons");
    const go = el("button", "btn primary small", "Créer la salle");
    go.type = "submit";
    boutons.append(go, bouton("Annuler", () => {
      etat.brouillon = null;
      if (e.type === "racine") afficherArbre(); else f.remove();
    }));
    f.append(boutons, msg);
    f.addEventListener("submit", async ev => {
      ev.preventDefault();
      ecrire(msg, "", "erreur");
      const c = code.value.trim().toUpperCase(), n = nomCode.value.trim();
      if (!/^DR-\d{4}-\d{3}$/.test(c)) return ecrire(msg, "Code attendu de la forme DR-2026-001.", "erreur");
      if (!n || n.length > 120) return ecrire(msg, "Nom de code : de 1 à 120 caractères.", "erreur");
      const p = mw.value === "" ? null : Number(mw.value);
      if (p !== null && !(p >= 0 && p < 1e7)) return ecrire(msg, "Puissance : un nombre positif, en MW.", "erreur");
      go.disabled = true;
      const {error} = await appel("dr_creer_salle", {p_bibliotheque: etat.choisie, p_code: c, p_nom_de_code: n,
        p_racine_item_id: e.item_id, p_type_actif: type.value || null, p_puissance_mw: p, p_publication: pub.value});
      go.disabled = false;
      if (error) return ecrire(msg, messageBase(error), "erreur");
      etat.brouillon = null;
      etat.ouverts.add(e.id);
      arbreMsg(`Salle ${c} « ${n} » créée sur ${e.type === "racine" ? nomAffiche(e) : `le dossier « ${e.nom} »`} : ` +
        "publiez ensuite ses documents, dossier par dossier.");
      etat.focusArbre = {id: e.id};
      await recharger();
    });
    return f;
  }

  function ouvrirForm(e, li) {
    for (const autre of $("dr-arbre").querySelectorAll(".dr-form-salle")) autre.remove();
    if (!etat.brouillon || etat.brouillon.id !== e.id) etat.brouillon = null;
    const f = formSalle(e);
    li.insertBefore(f, li.children[1] || null);
    f.querySelector("input").focus();
  }

  // réglages d'une salle (dr_regler_salle) : nom de code, statut, mode de publication ; seuls les changements partent
  function formReglages(s) {
    const r = etat.reglages;
    const f = el("form", "dr-form dr-form-reglages");
    f.noValidate = true;
    f.autocomplete = "off";
    f.appendChild(el("p", "dr-form-titre", `Réglages de la salle ${s.code}`));
    const nom = champ(f, "Nom de code (vu des acquéreurs)", el("input"), "reglage-nom:" + s.id);
    nom.maxLength = 120; nom.required = true;
    const statut = champ(f, "Statut", options(el("select"), Object.entries(STATUTS)), "reglage-statut:" + s.id);
    const pub = champ(f, "Publication", options(el("select"), PUBLICATIONS), "reglage-pub:" + s.id);
    nom.value = r.nom; statut.value = r.statut; pub.value = r.publication;
    const avis = el("p", "dr-avert");
    const garder = () => {
      etat.reglages = {id: s.id, nom: nom.value, statut: statut.value, publication: pub.value};
      avis.textContent = pub.value === "auto" && s.publication !== "auto"
        ? "En publication automatique, chaque nouvelle version d'un fichier de la salle est publiée d'office aux acquéreurs, " +
          "sans validation de l'équipe." : "";
    };
    f.addEventListener("input", garder);
    f.addEventListener("change", garder);
    garder();
    const msg = el("p", "dr-msg erreur");
    msg.setAttribute("role", "alert");
    const boutons = el("div", "dr-boutons");
    const go = el("button", "btn primary small", "Enregistrer");
    go.type = "submit";
    go.dataset.cle = "reglage-go:" + s.id;
    boutons.append(go, bouton("Annuler", () => {
      etat.reglages = null;
      f.remove();
      for (const x of $("dr-arbre").querySelectorAll(".dr-salles [aria-expanded]")) x.setAttribute("aria-expanded", "false");
      rendreFocus($("dr-arbre"), {cle: "reglages:" + s.id});
    }, "btn small", "", "reglage-annuler:" + s.id));
    f.append(avis, boutons, msg);
    f.addEventListener("submit", async ev => {
      ev.preventDefault();
      ecrire(msg, "", "erreur");
      const n = nom.value.trim();
      if (!n || n.length > 120) return ecrire(msg, "Nom de code : de 1 à 120 caractères.", "erreur");
      const changes = {}, dits = [];
      if (n !== s.nom_de_code) { changes.nom_de_code = n; dits.push(`nom de code « ${n} »`); }
      if (statut.value !== s.statut) { changes.statut = statut.value; dits.push(`statut « ${STATUTS[statut.value] || statut.value} »`); }
      if (pub.value !== s.publication) {
        changes.publication = pub.value;
        dits.push(`publication ${pub.value === "auto" ? "automatique" : "manuelle"}`);
      }
      if (!dits.length) return ecrire(msg, "Aucun changement à enregistrer.", "erreur");
      go.disabled = true;
      const {error} = await appel("dr_regler_salle", {p_salle: s.id, p_reglages: changes});
      go.disabled = false;
      if (error) return ecrire(msg, messageBase(error), "erreur");
      etat.reglages = null;
      arbreMsg(`Salle ${s.code} : ${dits.join(", ")}.`);
      etat.focusArbre = {cle: "reglages:" + s.id};
      await recharger();
    });
    return f;
  }

  function ouvrirReglages(s, li, b) {
    const deja = !!etat.reglages && etat.reglages.id === s.id;
    for (const autre of $("dr-arbre").querySelectorAll(".dr-form-reglages")) autre.remove();
    for (const x of $("dr-arbre").querySelectorAll(".dr-salles [aria-expanded]")) x.setAttribute("aria-expanded", "false");
    etat.reglages = null;
    if (deja) return;
    etat.reglages = {id: s.id, nom: s.nom_de_code, statut: s.statut, publication: s.publication};
    b.setAttribute("aria-expanded", "true");
    const f = formReglages(s);
    li.appendChild(f);
    f.querySelector("input").focus();
  }

  // éléments d'une liste (premier niveau, ou contenu d'un dossier) par pages de 200 ; le nombre affiché est gardé par
  // liste (cle : « racine » ou id du dossier), d'un rechargement à l'autre
  function remplir(ul, liste, cle, de = 0) {
    const n = de ? PAR_PAGE : Math.max(PAR_PAGE, etat.affiches.get(cle) || 0);
    for (const e of liste.slice(de, de + n)) ul.appendChild(noeud(e));
    const fin = de + n, reste = liste.length - fin;
    if (reste > 0) {
      const li = el("li", "dr-suite");
      const texte = reste > PAR_PAGE ? `Afficher les ${PAR_PAGE} éléments suivants (reste ${NOMBRE.format(reste)})`
        : reste > 1 ? `Afficher les ${reste} derniers éléments` : "Afficher le dernier élément";
      li.appendChild(bouton(texte, () => {
        li.remove();
        etat.affiches.set(cle, fin + PAR_PAGE);
        remplir(ul, liste, cle, fin);
        // le bouton a disparu : le focus passe au premier élément ajouté
        const ligne = ul.children[fin] && ul.children[fin].querySelector(".dr-ligne");
        if (ligne) { ligne.tabIndex = -1; ligne.focus(); }
      }, "btn small", "", "suite:" + cle));
      ul.appendChild(li);
    }
  }

  function noeud(e) {
    const li = el("li", "dr-noeud");
    const ligne = el("div", "dr-ligne " + e.type);
    ligne.dataset.id = e.id;
    li.appendChild(ligne);
    const enfants = e.type === "fichier" ? [] : etat.enfants.get(e.item_id) || [];
    let pli = null;
    if (e.type === "fichier") ligne.appendChild(el("span", "dr-pli-vide"));
    else {
      pli = el("button", "dr-pli");
      pli.type = "button";
      pli.dataset.cle = "pli:" + e.id;
      pli.setAttribute("aria-expanded", String(etat.ouverts.has(e.id)));
      pli.setAttribute("aria-label", `Contenu du dossier « ${nomAffiche(e)} »`);
      pli.disabled = !enfants.length;
      ligne.appendChild(pli);
    }
    ligne.appendChild(el("span", "dr-nom", nomAffiche(e)));

    const conteneur = e.type === "dossier" || e.type === "racine";
    const salle = conteneur ? etat.sallesIci.get(e.item_id) : null;
    if (salle) {
      ligne.appendChild(el("span", "dr-badge salle", `Salle ${salle.code} · ${salle.nom_de_code}`));
      ligne.appendChild(bouton("Interroger ce projet avec Claude", () => interrogerEquipe(salle), "btn primary small dr-claude",
        `Interroger le projet ${salle.code} avec Claude`, "claude:" + salle.id));
      ligne.appendChild(el("span", "dr-etat", `${STATUTS[salle.statut] || salle.statut} · publication ` +
        (salle.publication === "auto" ? "automatique" : "manuelle")));
    } else if (e.salle_id && e.dossier_id === e.id) {
      ligne.appendChild(el("span", "dr-badge", "dossier de premier niveau"));
    }
    if (e.type === "dossier" && !etat.parItem.has(e.parent_item_id)) {
      ligne.appendChild(el("span", "dr-etat", "dossier parent pas encore lu"));
    }
    if (e.type === "fichier") {
      if (e.taille != null) ligne.appendChild(el("span", "dr-taille", taille(e.taille)));
      if (e.salle_id) {
        const st = etatFichier(e), s = el("span", "dr-etat " + st.classe, st.texte);
        if (e.publie_nom) s.title = `Nom vu par les acquéreurs : ${e.publie_nom}`;
        ligne.appendChild(s);
        const salleFichier = etat.salleDe.get(e.salle_id), dossier = etat.parId.get(e.dossier_id);
        if (salleFichier) ligne.appendChild(el("span", "dr-lieu", salleFichier.code + (dossier ? ` › ${dossier.nom}` : "")));
      } else ligne.appendChild(el("span", "dr-etat", "hors salle"));
    }

    const actions = el("span", "dr-actions");
    if (e.salle_id && e.type === "fichier") {
      // un fichier à la racine de la salle ne se publie pas (les droits se donnent par dossier de premier niveau)
      if (e.dossier_id && (!e.version_publiee_id || (e.version_courante_id && e.version_courante_id !== e.version_publiee_id))) {
        const t = e.version_publiee_id ? "Publier la nouvelle version" : "Publier";
        actions.appendChild(bouton(t, ev => publier(e, ev.currentTarget, false), "btn small", `${t} : « ${e.nom} »`, "publier:" + e.id));
      }
      if (e.version_publiee_id) {
        actions.appendChild(bouton("Dépublier", ev => publier(e, ev.currentTarget, true), "btn small", `Dépublier « ${e.nom} »`,
                                   "depublier:" + e.id));
      }
      // aperçu (lot b) : la version publiée, sinon la version courante ; un fichier qui n'est ni un PDF ni une image se
      // télécharge
      if (e.version_publiee_id || e.version_courante_id) {
        const visible = consultable(e.publie_mime || e.mime);
        actions.appendChild(bouton(visible ? "Aperçu" : "Télécharger",
          () => ouvrirDocument(e.id, visible ? "consulter" : "telecharger", arbreMsg), "btn small",
          `${visible ? "Aperçu" : "Télécharger"} : « ${e.publie_nom || e.nom} »`, "apercu:" + e.id));
      }
    } else if (e.salle_id && conteneur) {
      const tout = salle ? `toute la salle ${salle.code}` : `tous les fichiers du dossier « ${e.nom} »`;
      actions.appendChild(bouton("Publier…", () => demanderConfirmation(e, li, false), "btn small", `Publier ${tout}`,
                                 "publier:" + e.id));
      actions.appendChild(bouton("Dépublier…", () => demanderConfirmation(e, li, true), "btn small", `Dépublier ${tout}`,
                                 "depublier:" + e.id));
    } else if (conteneur && !etat.contientSalle.has(e.id)) {
      actions.appendChild(bouton("Créer une salle ici", () => ouvrirForm(e, li), "btn small",
        `Créer une salle sur le dossier « ${nomAffiche(e)} »`, "salle:" + e.id));
    }
    // étape du processus de vente (lot e) : sur un dossier de premier niveau, ou en exception sur un fichier rangé dans
    // l'un d'eux ; la base contrôle (dr_regler_etape)
    if (e.salle_id && ((e.type === "dossier" && e.dossier_id === e.id) || (e.type === "fichier" && e.dossier_id))) {
      actions.appendChild(choixEtape(e));
    }
    if (actions.childNodes.length) ligne.appendChild(actions);

    // contenu d'un dossier : dessiné à la première ouverture seulement (grandes bibliothèques)
    if (pli && enfants.length) {
      const sous = el("ul");
      sous.hidden = !etat.ouverts.has(e.id);
      li.appendChild(sous);
      let rempli = false;
      if (!sous.hidden) { remplir(sous, enfants, e.id); rempli = true; }
      pli.addEventListener("click", () => {
        const ouvrir = sous.hidden;
        sous.hidden = !ouvrir;
        pli.setAttribute("aria-expanded", String(ouvrir));
        if (ouvrir) etat.ouverts.add(e.id); else etat.ouverts.delete(e.id);
        if (ouvrir && !rempli) { remplir(sous, enfants, e.id); rempli = true; }
      });
    }
    if (etat.brouillon && etat.brouillon.id === e.id && !e.salle_id) li.insertBefore(formSalle(e), li.children[1] || null);
    if (etat.confirmation && etat.confirmation.id === e.id && e.salle_id && conteneur) {
      li.insertBefore(panneauConfirmation(e), li.children[1] || null);
    }
    return li;
  }

  // déplie les dossiers jusqu'à l'élément, affiche assez d'éléments de chaque liste pour qu'il y figure, et le montre
  function montrer(e) {
    for (let p = e, n = 0; p && n < 64; n++) {
      etat.ouverts.add(p.id);
      const parent = etat.parItem.get(p.parent_item_id);
      const cle = parent && (parent.type !== "racine" || racineAffichee()) ? parent.id : "racine";
      const i = (cle === "racine" ? etat.premiers : etat.enfants.get(parent.item_id) || []).indexOf(p);
      if (i >= PAR_PAGE) etat.affiches.set(cle, Math.max(etat.affiches.get(cle) || 0, Math.ceil((i + 1) / PAR_PAGE) * PAR_PAGE));
      p = parent;
    }
    etat.focusArbre = {id: e.id};
    afficherArbre();
    const ligne = [...$("dr-arbre").querySelectorAll(".dr-ligne")].find(x => x.dataset.id === e.id);
    if (!ligne) { arbreMsg(`« ${e.nom} » est plus loin dans son dossier : utilisez « Afficher les éléments suivants ».`); return; }
    ligne.scrollIntoView({block: "center"});
    ligne.classList.add("dr-repere");
    setTimeout(() => ligne.classList.remove("dr-repere"), 2500);
  }

  function afficherArbre() {
    const zone = $("dr-arbre-zone"), arbre = $("dr-arbre"), choix = $("dr-biblio");
    const voulu = etat.focusArbre || focusDe(arbre);
    etat.focusArbre = null;
    zone.hidden = !etat.biblios.length;
    if (!etat.biblios.length) return;
    choix.textContent = "";
    for (const b of etat.biblios) { const o = el("option", null, b.nom); o.value = b.id; choix.appendChild(o); }
    choix.value = etat.choisie;
    $("dr-choix-biblio").hidden = etat.biblios.length < 2;
    arbre.textContent = "";
    if (!etat.elements.length) {
      arbre.appendChild(el("p", "dr-vide", "Rien d'indexé pour l'instant : lancez « Synchroniser maintenant »."));
      return;
    }
    const fichiers = etat.elements.filter(e => e.type === "fichier");
    const publies = fichiers.filter(e => e.version_publiee_id).length;
    const nouvelles = fichiers.filter(e => e.version_publiee_id && e.versions_a_jour && e.version_courante_id &&
                                           e.version_courante_id !== e.version_publiee_id).length;
    const resume = [compte(etat.elements.filter(e => e.type === "dossier").length, "dossier"), compte(fichiers.length, "fichier"),
                    compte(etat.sallesIci.size, "salle"), compte(publies, "fichier publié", "fichiers publiés")];
    if (nouvelles) resume.push(compte(nouvelles, "nouvelle version à publier", "nouvelles versions à publier"));
    arbre.appendChild(el("p", "dr-resume", resume.join(" · ")));
    if (etat.tronque) {
      arbre.appendChild(el("p", "dr-erreur", `Plus de ${NOMBRE.format(PLAFOND)} éléments : seuls les ${NOMBRE.format(PLAFOND)} ` +
        "premiers lus sont affichés."));
    }

    const salles = [...etat.sallesIci.values()].sort((a, b) => TRI.compare(a.code, b.code));
    if (salles.length) {
      const ul = el("ul", "dr-salles");
      for (const s of salles) {
        const li = el("li");
        li.append(el("b", null, s.code), ` ${s.nom_de_code} · ${STATUTS[s.statut] || s.statut} · publication ` +
          (s.publication === "auto" ? "automatique" : "manuelle"));
        const racine = etat.parItem.get(s.racine_item_id);
        if (racine) li.appendChild(bouton("Afficher", () => montrer(racine), "btn small", `Afficher la salle ${s.code}`, "afficher:" + s.id));
        else li.append(" · dossier de la salle introuvable (supprimé de SharePoint ?)");
        const ouvert = !!etat.reglages && etat.reglages.id === s.id;
        const r = bouton("Réglages", ev => ouvrirReglages(s, li, ev.currentTarget), "btn small", `Réglages de la salle ${s.code}`,
                         "reglages:" + s.id);
        r.setAttribute("aria-expanded", String(ouvert));
        li.appendChild(r);
        li.appendChild(bouton("Créer la fiche marketplace", ev => ficheDepuisSalle(s, ev.currentTarget), "btn small",
                              `Créer ou ouvrir la fiche marketplace de la salle ${s.code}`, "fiche:" + s.id));
        if (ouvert) li.appendChild(formReglages(s));
        ul.appendChild(li);
      }
      arbre.appendChild(ul);
    }

    // bibliothèque sans salle : elle peut devenir une salle entière (un site SharePoint par opération)
    if (etat.racine && !etat.sallesIci.size && !racineAffichee()) {
      const p = el("p", "dr-aide");
      p.append("Si cette bibliothèque est un seul projet (un site SharePoint par opération) : ");
      p.appendChild(bouton("Créer une salle sur toute la bibliothèque", () => {
        etat.brouillon = {id: etat.racine.id, code: codeSuivant(), nom: "", type: "", mw: "", pub: "manuelle"};
        etat.focusArbre = {cle: "salle-code:" + etat.racine.id};
        afficherArbre();
      }, "btn small", "Créer une salle sur toute la bibliothèque", "salle-biblio:" + etat.choisie));
      arbre.appendChild(p);
    }
    const ul = el("ul");
    remplir(ul, racineAffichee() ? [etat.racine] : etat.premiers, "racine");
    arbre.appendChild(ul);
    rendreFocus(arbre, voulu);
  }


  // ------------------------------------------------------------------ texte et recherche (lot d1, sql/02_texte.sql)
  // dr_place : place prise et état de l'indexation par salle, documents non indexés ; dr_recherche_texte : recherche
  // dans une salle (chaque mot cherché est un groupe à lui seul ; « tous les mots », puis « l'un des mots ») ;
  // « Indexer maintenant » : fonction serveur « indexer », comme « Synchroniser maintenant ». Les mots trouvés arrivent
  // entre ⟦ et ⟧ dans l'extrait : découpés ici et mis en <mark> par textContent, jamais par du HTML.
  const STATUTS_INDEX = {indexe: "indexés", attente: "en attente", en_cours: "en cours", non_indexe: "non indexés", echec: "en échec"};
  const texteMsg = (t, erreur = false) => ecrire($("dr-texte-msg"), t, erreur ? "erreur" : "");

  async function chargerTexte() {
    const {data, error} = await appel("dr_place", {});
    const zone = $("dr-place");
    zone.textContent = "";
    if (error) {
      texteMsg(["PGRST202", "42883"].includes(error.code)
        ? "Recherche pas encore installée dans la base (sql/02_texte.sql : python etl/droits.py --installer)."
        : `État de l'indexation illisible : ${messageBase(error)}.`, true);
      $("dr-texte").hidden = false;
      return;
    }
    texteMsg("");
    const p = data || {};
    const base = Number(p.base_octets) || 0, seuil = Number(p.seuil_octets) || 0;
    const ligne = el("p", base > seuil ? "dr-msg erreur" : "dr-aide",
      `Base : ${taille(base)} sur ${taille(seuil)} permis pour l'indexation (texte des documents : ${taille(Number(p.extraits_octets) || 0)}).` +
      (base > seuil ? " Indexation arrêtée : place à libérer (salles closes, documents dépubliés)." : ""));
    zone.appendChild(ligne);
    // trafic du mois servi par la fonction « fichiers » (lot b, dr_trafic) : au-delà de 2 Go, les téléchargements
    // s'arrêtent et la consultation continue (quota de 5 Go partagé avec la Prospection)
    try {
      const auj = new Date(), mois = `${auj.getFullYear()}-${String(auj.getMonth() + 1).padStart(2, "0")}-01`;
      const {data: t, error: et} = await sb.from("dr_trafic").select("octets").gte("jour", mois);
      if (!et && Array.isArray(t)) {
        const n = t.reduce((s, r) => s + (Number(r.octets) || 0), 0), plafond = 2 * 1024 * 1048576;
        zone.appendChild(el("p", n >= 0.8 * plafond ? "dr-msg erreur" : "dr-aide",
          `Trafic des documents ce mois : ${taille(n)} sur ${taille(plafond)}` +
          (n >= plafond ? " : téléchargements arrêtés jusqu'au mois prochain (la consultation continue)." : ".")));
      }
    } catch { /* table du lot b pas encore installée */ }
    const salles = Array.isArray(p.salles) ? p.salles : [];
    const choix = $("dr-c-salle"), avant = choix.value;
    choix.textContent = "";
    if (salles.length) {
      const ul = el("ul", "dr-place-salles");
      for (const s of salles) {
        const st = s.statuts && typeof s.statuts === "object" ? s.statuts : {};
        const parts = Object.keys(STATUTS_INDEX).filter(k => st[k]).map(k => `${NOMBRE.format(st[k])} ${STATUTS_INDEX[k]}`);
        ul.appendChild(el("li", null, `${s.code} (${s.nom_de_code}) : ${parts.length ? parts.join(", ") : "aucun document"}` +
          ` · ${compte(Number(s.extraits) || 0, "extrait")}`));
        const o = el("option", null, `${s.code} (${s.nom_de_code})`);
        o.value = s.salle_id;
        choix.appendChild(o);
      }
      zone.appendChild(ul);
      // salle choisie gardée d'un rechargement à l'autre, sinon la première
      choix.value = salles.some(s => s.salle_id === avant) ? avant : salles[0].salle_id;
    }
    const non = Array.isArray(p.non_indexes) ? p.non_indexes : [];
    if (non.length) {
      const d = el("details", "dr-non-indexes");
      d.appendChild(el("summary", null, `${compte(non.length, "document")} non ${non.length > 1 ? "indexés" : "indexé"}`));
      const ul = el("ul");
      for (const x of non) {
        const li = el("li", null, `${x.nom} (version ${x.version}) : ${x.raison || (x.statut === "echec" ? "échec" : "non lu")} `);
        li.appendChild(bouton("Relancer", () => relancer(x), "btn small", `Relancer l'indexation de ${x.nom}`, "relancer:" + x.element_id));
        ul.appendChild(li);
      }
      d.appendChild(ul);
      zone.appendChild(d);
    }
    $("dr-c-go").disabled = !salles.length;
    $("dr-texte").hidden = false;
    remplirSallesAssistant(salles);
  }

  async function relancer(x) {
    const {data, error} = await appel("dr_index_relancer", {p_element: x.element_id});
    if (error) { texteMsg(`Relance refusée : ${messageBase(error)}.`, true); return; }
    await chargerTexte();
    texteMsg(data ? `« ${x.nom} » sera relu au prochain passage de l'indexation.` : "Rien à relancer pour ce document.");
  }

  // mots de la saisie : 12 au plus, 60 caractères au plus chacun (limites de la base) ; un groupe par mot
  const motsDe = t => String(t || "").split(/\s+/).map(m => m.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ""))
    .filter(m => m.length >= 2).map(m => m.slice(0, 60)).slice(0, 12);

  // extrait avec les mots trouvés entre ⟦ et ⟧ -> nœuds texte et <mark>
  function extraitMarque(t) {
    const p = el("p", "dr-extrait");
    String(t || "").split(/(⟦[^⟦⟧]*⟧)/).forEach(morceau => {
      if (/^⟦[^⟦⟧]*⟧$/.test(morceau)) p.appendChild(el("mark", null, morceau.slice(1, -1)));
      else if (morceau) p.append(morceau);
    });
    return p;
  }

  async function chercher(ev) {
    ev.preventDefault();
    const salle = $("dr-c-salle").value, mots = motsDe($("dr-c-mots").value), liste = $("dr-resultats"), msg = $("dr-c-msg");
    liste.textContent = "";
    if (!salle) { ecrire(msg, "Aucune salle : créez-en une dans l'arborescence ci-dessus.", "erreur"); return; }
    if (!mots.length) { ecrire(msg, "Tapez au moins un mot de deux lettres.", "erreur"); return; }
    $("dr-c-go").disabled = true;
    ecrire(msg, "Recherche…");
    const {data, error} = await appel("dr_recherche_texte", {p_salle: salle, p_groupes: mots.map(m => [m]), p_limite: 20});
    $("dr-c-go").disabled = false;
    if (error) { ecrire(msg, `Recherche refusée : ${messageBase(error)}.`, "erreur"); return; }
    const res = data && Array.isArray(data.resultats) ? data.resultats : [];
    if (!res.length) { ecrire(msg, "Aucun extrait trouvé (les documents non indexés ne sont pas cherchés)."); return; }
    ecrire(msg, `${compte(res.length, "extrait")}` + (data.mode === "un_des_mots"
      ? " contenant l'un des mots (aucun ne les contient tous)." : " contenant tous les mots."));
    for (const x of res) {
      const li = el("li");
      const ou = [x.page != null ? `page ${x.page}` : "", x.feuille ? `feuille « ${x.feuille} »` : ""].filter(Boolean).join(", ");
      li.appendChild(el("p", "dr-res-titre", `${x.nom} · version ${x.version} ${x.publiee ? "(publiée)" : "(à publier)"}` +
        (ou ? ` · ${ou}` : "")));
      li.appendChild(extraitMarque(x.extrait));
      liste.appendChild(li);
    }
    annoncer(msg.textContent);
  }

  // « Indexer maintenant » : même appel que « Synchroniser maintenant », sans corps ; réponse : bilan sans nom de fichier
  async function indexerMaintenant() {
    const b = $("dr-indexer");
    b.disabled = true;
    texteMsg("Indexation en cours : jusqu'à une minute.");
    let jeton = P.session.access_token;
    try { const {data} = await sb.auth.getSession(); if (data && data.session) jeton = data.session.access_token; } catch {}
    const arret = new AbortController(), minuterie = setTimeout(() => arret.abort(), 120000);
    let rep, corps = null;
    try {
      rep = await fetch(`${conf.url}/functions/v1/indexer`, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal: arret.signal,
        headers: {"Authorization": `Bearer ${jeton}`, "apikey": conf.cle},
      });
      try { corps = await rep.json(); } catch { corps = null; }
    } catch {
      texteMsg("Pas de réponse du serveur : connexion coupée, ou fonction d'indexation pas encore installée.", true);
      b.disabled = false;
      return;
    } finally { clearTimeout(minuterie); }
    b.disabled = false;
    await chargerTexte();   // avant le bilan : le rechargement efface le message
    if (rep.ok && corps && typeof corps.statut === "string") {
      const t = {vide: "Plus rien à indexer.", budget: "Temps d'un appel atteint : la suite au prochain passage (chaque minute).",
                 place: "Indexation arrêtée : la base est trop pleine.", limite: "SharePoint demande d'attendre : la suite dans quelques minutes.",
                 erreur: "Erreur de la base."}[corps.statut] || "";
      texteMsg(`${compte(Number(corps.taches) || 0, "document")} lu(s), ${compte(Number(corps.extraits) || 0, "extrait")} écrit(s). ${t}`,
        corps.statut === "erreur" || corps.statut === "place");
    } else {
      const erreur = corps && typeof corps.erreur === "string" ? corps.erreur.slice(0, 300) : "";
      texteMsg(({401: "Refusé : session expirée ou compte sans le rôle « equipe » du module",
                 404: "Fonction d'indexation introuvable (pas encore déployée ?)"}[rep.status] ||
                `Réponse inattendue du serveur (code ${rep.status})`) + (erreur ? ` (${erreur})` : "") + ".", true);
    }
  }


  // ------------------------------------------------------------------ étapes (lot e, sql/04_assistant.sql)
  const ETAPES = ["Teaser et mémo", "Offre indicative", "Offre ferme et due diligence", "Confirmatoire"];
  function choixEtape(e) {
    const c = el("select", "dr-etape");
    const fichier = e.type === "fichier";
    c.setAttribute("aria-label", `Étape de « ${e.nom} »` + (fichier ? " (exception au dossier)" : ""));
    c.dataset.cle = "etape:" + e.id;
    const vide = el("option", null, fichier ? "Étape du dossier" : "Sans étape (invisible)");
    vide.value = "";
    c.appendChild(vide);
    ETAPES.forEach((t, i) => { const o = el("option", null, `Étape ${i} · ${t}`); o.value = String(i); c.appendChild(o); });
    c.value = e.etape == null ? "" : String(e.etape);
    c.addEventListener("change", async () => {
      const v = c.value === "" ? null : Number(c.value);
      c.disabled = true;
      const {error} = await appel("dr_regler_etape", {p_element: e.id, p_etape: v});
      if (error) arbreMsg(`« ${e.nom} » : ${messageBase(error)}`, true);
      else arbreMsg(`« ${e.nom} » : ${v == null ? (fichier ? "étape de son dossier" : "sans étape, invisible des acquéreurs")
                                                  : `étape ${v} (${ETAPES[v]})`}.`);
      etat.focusArbre = {cle: c.dataset.cle, id: e.id};
      await recharger();
      etat.focusArbre = null;
    });
    return c;
  }

  // ------------------------------------------------------------------ « Tester l'assistant » (lot e)
  // Fonction serveur « assistant » (supabase/functions/assistant) avec le jeton de la personne. Une conversation garde sa
  // salle et son étape : en changer en ouvre une nouvelle. La réponse arrive avec des renvois [1], [2]… et la liste des
  // passages cités (document, page). etape_requise : la réponse existe dans un document d'une étape plus haute (dit à
  // l'équipe seulement ; l'acquéreur reçoit la réponse neutre).
  const RESULTATS = {repondu: "Répondu", partiel: "Réponse partielle", sans_reponse: "Pas de réponse dans les documents",
                     refus: "Refus", erreur: "Erreur"};
  const fil = {conversation: null, salle: "", etape: ""};
  const aMsg = (t, erreur = false) => ecrire($("dr-a-msg"), t, erreur ? "erreur" : "");

  function nouvelleConversation(annonce = true) {
    fil.conversation = null;
    $("dr-a-fil").textContent = "";
    if (annonce) aMsg("Nouvelle conversation.");
  }

  // salles connues de la carte de l'assistant (dr_place) : contexte affiché et raccourci depuis l'arborescence
  let sallesAssistant = [];
  function contexteEquipe() {
    const s = sallesAssistant.find(x => x.salle_id === $("dr-a-salle").value), etape = $("dr-a-etape");
    $("dr-a-contexte").textContent = s
      ? `Projet : ${s.code} · ${s.nom_de_code}. Essai comme un acquéreur à l'étape « ${
          (() => { const os = [...etape.querySelectorAll("option")]; return ((os.find(o => o.value === etape.value) || os[0]) || {}).textContent || etape.value; })()} » : Claude ne lit que les documents publiés de ce projet ouverts à cette étape.`
      : "Aucun projet (salle) pour le moment : créez une salle dans l'arborescence.";
    // interrupteur du projet (réglages de la salle) : il gouverne aussi les questions de l'équipe
    const coupe = !!s && s.assistant_actif === false;
    if (coupe) {
      $("dr-a-contexte").textContent = `Projet : ${s.code} · ${s.nom_de_code}. Assistant non activé pour ce projet : ` +
        "l'activer dans les réglages de la salle (arborescence) pour l'essayer ; les acquéreurs n'y ont accès qu'une fois " +
        "la salle ouverte.";
    }
    $("dr-a-go").disabled = !s || coupe;
  }
  function interrogerEquipe(salle) {
    if (!sallesAssistant.some(x => x.salle_id === salle.id)) {
      arbreMsg(`Assistant indisponible pour la salle ${salle.code} : la recherche n'est pas encore installée, ou la salle n'est pas encore connue d'elle (Recharger).`, true);
      return;
    }
    $("dr-a-salle").value = salle.id;
    nouvelleConversation(false);
    contexteEquipe();
    $("dr-assistant").scrollIntoView({block: "start"});
    $("dr-a-question").focus();
    annoncer(`Interroger le projet ${salle.code} avec Claude.`);
  }

  function remplirSallesAssistant(salles) {
    sallesAssistant = salles;
    const choix = $("dr-a-salle"), avant = choix.value;
    choix.textContent = "";
    for (const s of salles) {
      const o = el("option", null, `${s.code} (${s.nom_de_code})`);
      o.value = s.salle_id;
      choix.appendChild(o);
    }
    if (salles.length) choix.value = salles.some(s => s.salle_id === avant) ? avant : salles[0].salle_id;
    contexteEquipe();
    $("dr-assistant").hidden = false;
  }

  async function chargerConso() {
    const {data, error} = await appel("dr_assistant_etat", {});
    if (error || !data) { $("dr-a-conso").textContent = ""; return; }
    $("dr-a-conso").textContent = `Vos questions aujourd'hui : ${data.questions_du_jour} sur ${data.plafond_du_jour}. ` +
      `Coût de l'assistant ce mois-ci : ${NOMBRE.format(Number(data.cout_du_mois_usd) || 0)} $ sur ${data.plafond_du_mois_usd} $.`;
  }

  async function poserQuestion(ev) {
    ev.preventDefault();
    const salle = $("dr-a-salle").value, etape = $("dr-a-etape").value, question = $("dr-a-question").value.trim();
    if (!salle) { aMsg("Aucune salle : créez-en une dans l'arborescence ci-dessus.", true); return; }
    if (question.length < 2) { aMsg("Tapez une question.", true); return; }
    if (fil.conversation && (fil.salle !== salle || fil.etape !== etape)) nouvelleConversation(false);
    $("dr-a-go").disabled = true;
    aMsg("L'assistant cherche dans les documents et rédige sa réponse…");
    let jeton = P.session.access_token;
    try { const {data} = await sb.auth.getSession(); if (data && data.session) jeton = data.session.access_token; } catch {}
    const arret = new AbortController(), minuterie = setTimeout(() => arret.abort(), 150000);
    let rep, corps = null;
    try {
      rep = await fetch(`${conf.url}/functions/v1/assistant`, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal: arret.signal,
        headers: {"Authorization": `Bearer ${jeton}`, "apikey": conf.cle, "Content-Type": "application/json"},
        body: JSON.stringify({salle, etape: Number(etape), question, conversation: fil.conversation}),
      });
      try { corps = await rep.json(); } catch { corps = null; }
    } catch {
      aMsg("Pas de réponse du serveur : connexion coupée, ou fonction de l'assistant pas encore installée.", true);
      $("dr-a-go").disabled = false;
      return;
    } finally { clearTimeout(minuterie); }
    $("dr-a-go").disabled = false;
    if (!rep.ok || !corps || typeof corps.reponse !== "string") {
      const erreur = corps && typeof corps.erreur === "string" ? corps.erreur.slice(0, 300) : "";
      aMsg(({401: "Refusé : session expirée ou compte sans le rôle « equipe » du module",
             404: "Fonction de l'assistant introuvable (pas encore déployée ?)"}[rep.status] ||
            `L'assistant n'a pas pu répondre (code ${rep.status})`) + (erreur ? ` : ${erreur}` : "") + ".", true);
      await chargerConso();
      return;
    }
    fil.conversation = corps.conversation; fil.salle = salle; fil.etape = etape;
    $("dr-a-question").value = "";
    const li = el("li", "dr-echange");
    li.appendChild(el("p", "dr-q", question));
    const r = el("p", "dr-r", corps.reponse);
    li.appendChild(r);
    const badge = el("p", "dr-resultat " + (corps.resultat || ""), (RESULTATS[corps.resultat] || corps.resultat) +
      (corps.tronquee ? " (réponse coupée : trop longue)" : ""));
    li.appendChild(badge);
    const cits = Array.isArray(corps.citations) ? corps.citations : [];
    if (cits.length) {
      const ul = el("ul", "dr-citations");
      for (const c of cits) {
        const ou = c.feuille ? `feuille « ${c.feuille} »` : c.page != null ? `page ${c.page}` : "";
        ul.appendChild(el("li", null, `[${c.n}] ${c.nom}${ou ? `, ${ou}` : ""}`));
      }
      li.appendChild(ul);
    }
    if (corps.etape_requise != null) {
      li.appendChild(el("p", "dr-aide", `La réponse se trouve dans un document d'étape ${corps.etape_requise} ` +
        `(${ETAPES[corps.etape_requise] || ""}) : un acquéreur à cette étape ne la voit pas encore et reçoit la réponse ` +
        "neutre ci-dessus. Indication réservée à l'équipe."));
    }
    $("dr-a-fil").appendChild(li);
    aMsg(`Réponse reçue (coût : ${NOMBRE.format(Number(corps.cout_usd) || 0)} $).`);
    annoncer(`Réponse de l'assistant : ${RESULTATS[corps.resultat] || ""}.`);
    await chargerConso();
  }


  // ------------------------------------------------------------------ outils communs (aperçus et documents)
  // L'écran de l'acheteur a sa page, acheteur.html (acheteur.js) ; restent ici ce dont l'équipe se sert : libellés des
  // étapes, visionneuse pour l'aperçu d'un document de l'arborescence, illustrations et libellés de la Marketplace.
  const ETAPES_ACHETEUR = ["Teaser et mémo d'information", "Offre indicative", "Offre ferme et due diligence", "Confirmatoire"];

  // documents (lot b, visionneuse.js) : dr_autoriser ouvre une consultation (contrôle complet, journal) ; les octets
  // passent ensuite plage par plage par la fonction serveur « fichiers », qui appelle dr_plage avec le jeton de la
  // personne ; dr_suivre note les pages vues. Ici : aperçu de l'équipe, dans l'arborescence.
  const consultable = mime => /^(application\/pdf|image\/)/.test(mime || "");
  const jetonActuel = async () => {
    try { const {data} = await sb.auth.getSession(); if (data && data.session) return data.session.access_token; } catch {}
    return P.session.access_token;
  };
  const visionneuse = window.drVisionneuse({
    conf, jeton: jetonActuel, enregistrer: P.telecharger,
    suivre: (c, n) => { appel("dr_suivre", {p_consultation: c, p_pages: n}); },
  });
  P.surArret(() => visionneuse.fermer());
  const refusOuverture = e => e && e.code === "DRJ03" ? "Nombre d'ouvertures du jour atteint : reprenez demain."
    : e && e.code === "42501" ? "Ce document ne vous est pas (ou plus) ouvert."
    : e && e.code === "55000" ? "Document indisponible pour le moment : l'équipe Almavision est prévenue."
    : `Ouverture impossible : ${messageBase(e)}.`;
  async function ouvrirDocument(id, action, dire) {
    dire(action === "telecharger" ? "Préparation du téléchargement…" : "Ouverture…");
    const {data, error} = await appel("dr_autoriser", {p_element: id, p_action: action});
    if (error || !data) { dire(refusOuverture(error)); return; }
    if (action === "telecharger") await visionneuse.telecharger(data, dire);
    else { dire(""); await visionneuse.consulter(data); }
  }

  // Visuel d'une opération : ILLUSTRATION générée dans la page (SVG), jamais une photo du projet. Aucune image n'est
  // stockée ni téléchargée : le dessin dépend seulement du type d'actif et du code de la salle (même opération, même
  // dessin) ; il est marqué « Illustration » et décrit comme tel aux lecteurs d'écran. Rien venu de la base n'entre dans
  // le dessin autrement que par setAttribute ou textContent.
  const NS = "http://www.w3.org/2000/svg";
  function graine(texte) { let h = 2166136261; for (const c of String(texte || "")) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function forme(nom, attributs) { const n = document.createElementNS(NS, nom); for (const [k, v] of Object.entries(attributs)) n.setAttribute(k, String(v)); return n; }
  function visuelOperation(s, classe) {
    const g = graine(s.code), alea = i => ((g >>> (i * 3)) & 7) / 7;            // 0..1, déterministe
    const ciels = [["#DCE8EE", "#B9D3DD"], ["#E8EEDF", "#CFE0C4"], ["#EEE6DA", "#DDCBB2"], ["#E1E6F2", "#C3CDE6"]];
    const [ciel, horizon] = ciels[g % ciels.length];
    const cadre = el("figure", "dr-visuel " + (classe || ""));
    const svg = forme("svg", {viewBox: "0 0 320 180", role: "img", "aria-label": `Illustration, pas une photo du projet : ${
      TYPES[s.type_actif] || "opération"}`, focusable: "false"});
    const titre = document.createElementNS(NS, "title");
    titre.textContent = "Illustration générée (pas une photo du projet)";
    svg.appendChild(titre);
    svg.appendChild(forme("rect", {x: 0, y: 0, width: 320, height: 180, fill: ciel}));
    svg.appendChild(forme("rect", {x: 0, y: 105, width: 320, height: 75, fill: horizon}));
    svg.appendChild(forme("circle", {cx: 60 + Math.round(alea(1) * 200), cy: 38 + Math.round(alea(2) * 18), r: 16, fill: "#F2C14E", opacity: 0.9}));
    // relief au loin
    svg.appendChild(forme("path", {d: `M0 108 Q ${80 + alea(3) * 60} ${78 + alea(4) * 14} 170 104 T 320 ${96 + alea(5) * 10} V 112 H 0 Z`,
                                   fill: "#9FC4BB", opacity: 0.7}));
    const panneau = (x, y, l, h, plein) => forme("polygon", {
      points: `${x},${y} ${x + l},${y} ${x + l + 6},${y + h} ${x + 6},${y + h}`,
      fill: plein ? "#24413C" : "none", stroke: plein ? "#64879A" : "#0B4740", "stroke-width": plein ? 1 : 1.4,
      "stroke-dasharray": plein ? "none" : "4 3"});
    if (s.type_actif === "portefeuille") {
      // toitures équipées
      for (let i = 0; i < 3; i++) {
        const x = 30 + i * 95, y = 92 + Math.round(alea(i + 6) * 10);
        svg.appendChild(forme("rect", {x, y: y + 24, width: 76, height: 50, fill: "#F3F6F8", stroke: "#7D8E91"}));
        svg.appendChild(forme("polygon", {points: `${x - 6},${y + 26} ${x + 38},${y} ${x + 82},${y + 26}`, fill: "#46595A"}));
        for (let k = 0; k < 3; k++) svg.appendChild(panneau(x + 6 + k * 22, y + 8, 16, 10, true));
      }
    } else {
      // centrale au sol : rangées de panneaux (en pointillés pour un projet en développement)
      const plein = s.type_actif !== "developpement", rangs = 3 + (g % 2);
      for (let r = 0; r < rangs; r++) {
        for (let c = 0; c < 6; c++) svg.appendChild(panneau(22 + c * 48 + r * 6, 118 + r * 15, 38, 10, plein));
      }
      if (!plein) for (const x of [24, 300]) svg.appendChild(forme("line", {x1: x, y1: 112, x2: x, y2: 172, stroke: "#E8613A", "stroke-width": 2}));
    }
    // motif d'hexagones de la charte, en filigrane
    for (let i = 0; i < 4; i++) {
      const cx = 270 + (i % 2) * 18, cy = 20 + i * 14, r = 9;
      svg.appendChild(forme("polygon", {points: [0, 1, 2, 3, 4, 5].map(k => `${(cx + r * Math.cos(Math.PI / 3 * k + Math.PI / 6)).toFixed(1)},${
        (cy + r * Math.sin(Math.PI / 3 * k + Math.PI / 6)).toFixed(1)}`).join(" "), fill: "none", stroke: "#00352F", opacity: 0.25}));
    }
    cadre.appendChild(svg);
    cadre.appendChild(el("figcaption", "dr-visuel-mention", "Illustration"));
    return cadre;
  }

  // ---------------- Marketplace (sql/08_vitrine.sql) : libellés et dessin des fiches, pour la Vitrine et l'aperçu
  // « Voir comme cet acheteur »
  const TECHNOS = {pv_sol: "Photovoltaïque au sol", pv_toiture: "Photovoltaïque en toiture", pv_ombriere: "Ombrières",
                   agrivoltaisme: "Agrivoltaïsme", portefeuille_pv: "Portefeuille photovoltaïque", eolien: "Éolien",
                   stockage: "Stockage", hybride: "Hybride"};
  const STADES = {developpement: "Développement", pret_a_construire: "Prêt à construire", construction: "Construction",
                  exploitation: "En exploitation"};
  const ILLUSTRATIONS = {sol: "exploitation", toiture: "portefeuille", ombriere: "exploitation", agrivoltaisme: "exploitation",
                         eolien: "developpement", stockage: "developpement"};
  // même dessin que les opérations (ILLUSTRATION générée, jamais une photo) ; la graine est l'identifiant de la fiche
  const visuelFiche = (f, classe) => visuelOperation({code: f.id, type_actif: ILLUSTRATIONS[f.illustration] || "exploitation"}, classe);
  const infosFiche = f => [TECHNOS[f.technologie] || f.technologie, `${NOMBRE.format(Number(f.puissance_mwc))} MWc`,
                           f.zone, STADES[f.stade] || f.stade].filter(Boolean);

  // ------------------------------------------------------------------ « Acquéreurs » (équipe, lot c)
  // Organisations, comptes invités (rattacher, détacher), invitations dans une salle (étape, fin, suspension), droits
  // par dossier de premier niveau et dossiers réservés. Lecture des tables dr_organisation, dr_participation, dr_droit et
  // dr_element (colonnes nommées) ; chaque action par une fonction de l'équipe, qui contrôle et journalise.
  const COL_ORG = "id,nom,categorie";
  const COL_PART = "id,salle_id,organisation_id,statut,fin,etape";
  const COL_DROIT = "id,organisation_id,dossier_id,niveau";
  const COL_DOSSIER = "id,nom,etape,reserve,dossier_id";
  const CATEGORIES = {fonds: "fonds", ipp: "IPP", industriel: "industriel", conseil: "conseil", autre: "autre"};
  const acq = {orgs: [], comptes: [], salles: []};
  const acqMsg = (t, erreur = false) => ecrire($("dr-acq-msg"), t, erreur ? "erreur" : "");
  const lire = async (table, colonnes, filtre) => {
    try {
      let r = sb.from(table).select(colonnes);
      if (filtre) r = filtre(r);
      return await r;
    } catch (x) { return {data: null, error: x}; }
  };
  const optionsOrgs = (choix, vide) => {
    choix.textContent = "";
    if (vide) { const o = el("option", null, vide); o.value = ""; choix.appendChild(o); }
    for (const o of acq.orgs) { const x = el("option", null, o.nom); x.value = o.id; choix.appendChild(x); }
  };
  const action = async (fonction, args, reussite) => {
    const {error} = await appel(fonction, args);
    if (error) { acqMsg(messageBase(error), true); return false; }
    acqMsg(reussite);
    await chargerAcquereurs();
    await rafraichirAcheteurs();
    return true;
  };

  async function chargerAcquereurs() {
    const [orgs, comptes, salles] = await Promise.all([
      lire("dr_organisation", COL_ORG, r => r.order("nom")), appel("dr_comptes_invites", {}),
      lire("dr_salle", "id,code,nom_de_code", r => r.order("code"))]);
    if (orgs.error || comptes.error || salles.error) {
      const e = orgs.error || comptes.error || salles.error;
      acqMsg(["PGRST202", "42883", "42P01", "PGRST205"].includes(e && e.code)
        ? "Acquéreurs pas encore installés dans la base (sql/03_acheteurs.sql : python etl/droits.py --installer)."
        : `Lecture impossible : ${messageBase(e)}.`, true);
      $("dr-acquereurs").hidden = false;
      return;
    }
    acq.orgs = orgs.data || []; acq.comptes = Array.isArray(comptes.data) ? comptes.data : []; acq.salles = salles.data || [];
    const ul = $("dr-acq-orgs");
    ul.textContent = "";
    for (const o of acq.orgs) ul.appendChild(el("li", null, `${o.nom} · ${CATEGORIES[o.categorie] || o.categorie}`));
    if (!acq.orgs.length) ul.appendChild(el("li", "dr-vide", "Aucune organisation."));
    const uc = $("dr-acq-comptes");
    uc.textContent = "";
    for (const c of acq.comptes) {
      const li = el("li", null, `${c.email}${c.nom ? ` · ${c.nom}` : ""}${c.societe ? ` (${c.societe})` : ""}` +
        (c.valide ? "" : " · compte bloqué ou terminé"));
      if (c.organisation) li.appendChild(el("span", "dr-badge", c.organisation));
      const choix = el("select");
      choix.setAttribute("aria-label", `Organisation de ${c.email}`);
      optionsOrgs(choix, "Choisir une organisation");
      choix.value = c.organisation_id || "";
      li.appendChild(choix);
      li.appendChild(bouton(c.organisation_id ? "Changer" : "Rattacher", () => {
        if (!choix.value) { acqMsg("Choisissez une organisation.", true); return; }
        action("dr_rattacher_acheteur", {p_user: c.user_id, p_organisation: choix.value}, `${c.email} rattaché.`);
      }, "btn small", `Rattacher ${c.email}`));
      if (c.organisation_id || c.acces) {
        li.appendChild(bouton("Détacher", () => action("dr_detacher_acheteur", {p_user: c.user_id}, `${c.email} détaché.`),
                              "btn small", `Détacher ${c.email}`));
      }
      li.appendChild(bouton(c.actif === false ? "Débloquer" : "Bloquer", () => action("dr_bloquer_compte",
        {p_user: c.user_id, p_bloque: c.actif !== false}, `${c.email} : ${c.actif === false ? "débloqué" : "bloqué"}.`),
        "btn small", `${c.actif === false ? "Débloquer" : "Bloquer"} ${c.email}`));
      uc.appendChild(li);
    }
    if (!acq.comptes.length) uc.appendChild(el("li", "dr-vide", "Aucun compte invité."));
    const choixSalle = $("dr-acq-salle"), avant = choixSalle.value;
    choixSalle.textContent = "";
    for (const s of acq.salles) { const o = el("option", null, `${s.code} (${s.nom_de_code})`); o.value = s.id; choixSalle.appendChild(o); }
    if (acq.salles.length) choixSalle.value = acq.salles.some(s => s.id === avant) ? avant : acq.salles[0].id;
    optionsOrgs($("dr-acq-inv-org"), null);
    optionsOrgs($("dr-acq-c-org"), "Sans organisation pour l'instant");
    $("dr-acquereurs").hidden = false;
    await chargerSalleAcquereurs();
  }

  async function chargerSalleAcquereurs() {
    const salle = $("dr-acq-salle").value, ul = $("dr-acq-parts"), droits = $("dr-acq-droits");
    ul.textContent = ""; droits.textContent = "";
    if (!salle) { ul.appendChild(el("li", "dr-vide", "Aucune salle.")); return; }
    const [parts, dossiers, lus] = await Promise.all([
      lire("dr_participation", COL_PART, r => r.eq("salle_id", salle)),
      lire("dr_element", COL_DOSSIER, r => r.eq("salle_id", salle).eq("type", "dossier").is("retire_le", null)),
      lire("dr_droit", COL_DROIT, r => r.eq("salle_id", salle))]);
    if (parts.error || dossiers.error || lus.error) { acqMsg(`Lecture impossible : ${messageBase(parts.error || dossiers.error || lus.error)}.`, true); return; }
    const nomOrg = id => (acq.orgs.find(o => o.id === id) || {}).nom || "organisation inconnue";
    const participants = parts.data || [];
    for (const p of participants) {
      const li = el("li", null, `${nomOrg(p.organisation_id)} · ${p.statut === "active" ? "active" : "suspendue"} · jusqu'au ${jourDe(p.fin)}`);
      const choix = el("select");
      choix.setAttribute("aria-label", `Étape de ${nomOrg(p.organisation_id)}`);
      ETAPES_ACHETEUR.forEach((t, i) => { const o = el("option", null, `Étape ${i} · ${t}`); o.value = String(i); choix.appendChild(o); });
      choix.value = String(p.etape);
      choix.addEventListener("change", () => action("dr_regler_participation", {p_participation: p.id, p_reglages: {etape: Number(choix.value)}},
        `${nomOrg(p.organisation_id)} : étape ${choix.value}.`));
      li.appendChild(choix);
      li.appendChild(bouton(p.statut === "active" ? "Suspendre" : "Reprendre", () => action("dr_regler_participation",
        {p_participation: p.id, p_reglages: {statut: p.statut === "active" ? "suspendue" : "active"}},
        `${nomOrg(p.organisation_id)} : ${p.statut === "active" ? "accès suspendu" : "accès repris"}.`), "btn small",
        `${p.statut === "active" ? "Suspendre" : "Reprendre"} ${nomOrg(p.organisation_id)}`));
      ul.appendChild(li);
    }
    if (!participants.length) ul.appendChild(el("li", "dr-vide", "Aucune organisation invitée dans cette salle."));
    // droits : un dossier de premier niveau par ligne, une organisation invitée par colonne
    const premiers = (dossiers.data || []).filter(d => d.dossier_id === d.id).sort((a, b) => TRI.compare(a.nom, b.nom));
    if (!premiers.length) { droits.appendChild(el("p", "dr-vide", "Aucun dossier de premier niveau.")); return; }
    const table = el("table", "dr-acq-table");
    const tete = el("tr");
    tete.appendChild(el("th", null, "Dossier"));
    tete.appendChild(el("th", null, "Réservé"));
    for (const p of participants) tete.appendChild(el("th", null, nomOrg(p.organisation_id)));
    table.appendChild(tete);
    for (const d of premiers) {
      const tr = el("tr");
      tr.appendChild(el("td", null, `${d.nom}${d.etape == null ? " · sans étape (invisible)" : ` · étape ${d.etape}`}`));
      const tdr = el("td"), caseR = el("input");
      caseR.type = "checkbox"; caseR.checked = !!d.reserve; caseR.setAttribute("aria-label", `Réserver « ${d.nom} »`);
      caseR.addEventListener("change", () => action("dr_reserver_dossier", {p_dossier: d.id, p_reserve: caseR.checked},
        `« ${d.nom} » : ${caseR.checked ? "réservé aux organisations qui y ont un droit" : "ouvert à toutes les organisations"}.`));
      tdr.appendChild(caseR);
      tr.appendChild(tdr);
      for (const p of participants) {
        const td = el("td"), choix = el("select");
        choix.setAttribute("aria-label", `Droit de ${nomOrg(p.organisation_id)} sur « ${d.nom} »`);
        for (const [v, t] of [["", "—"], ["consulter", "consulter"], ["telecharger", "télécharger"]]) {
          const o = el("option", null, t); o.value = v; choix.appendChild(o);
        }
        const lu = (lus.data || []).find(x => x.dossier_id === d.id && x.organisation_id === p.organisation_id);
        choix.value = lu ? lu.niveau : "";
        choix.addEventListener("change", () => action("dr_regler_droit",
          {p_organisation: p.organisation_id, p_dossier: d.id, p_niveau: choix.value || null},
          `Droit de ${nomOrg(p.organisation_id)} sur « ${d.nom} » : ${choix.value || "retiré"}.`));
        td.appendChild(choix);
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    droits.appendChild(table);
  }

  async function creerOrganisation(ev) {
    ev.preventDefault();
    const nom = $("dr-acq-org-nom").value.trim();
    if (!nom) { acqMsg("Nom de l'organisation ?", true); return; }
    if (await action("dr_creer_organisation", {p_nom: nom, p_categorie: $("dr-acq-org-cat").value}, `« ${nom} » créée.`)) {
      $("dr-acq-org-nom").value = "";
    }
  }

  // compte d'un acquéreur : fonction serveur « comptes » (seule à tenir la clé d'administration de Supabase), avec le
  // jeton du membre ; la base contrôle (jamais un membre de l'équipe, adresse, date de fin d'un an au plus)
  async function creerCompte(ev) {
    ev.preventDefault();
    const email = $("dr-acq-c-email").value.trim(), fin = $("dr-acq-c-fin").value;
    if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email)) { acqMsg("Adresse email ?", true); return; }
    if (!dateValide(fin)) { acqMsg("Date de fin de l'accès ?", true); return; }
    let jeton = P.session.access_token;
    try { const {data} = await sb.auth.getSession(); if (data && data.session) jeton = data.session.access_token; } catch {}
    $("dr-acq-c-go").disabled = true;
    let rep, corps = null;
    try {
      rep = await fetch(`${conf.url}/functions/v1/comptes`, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
        headers: {"Authorization": `Bearer ${jeton}`, "apikey": conf.cle, "Content-Type": "application/json"},
        body: JSON.stringify({email, nom: $("dr-acq-c-nom").value.trim() || null, societe: $("dr-acq-c-societe").value.trim() || null,
                              fin, organisation: $("dr-acq-c-org").value || null}),
      });
      corps = await rep.json().catch(() => null);
    } catch {
      $("dr-acq-c-go").disabled = false;
      acqMsg("Pas de réponse du serveur : fonction « comptes » pas encore installée, ou connexion coupée.", true);
      return;
    }
    $("dr-acq-c-go").disabled = false;
    if (!rep.ok || !corps || !corps.user_id) {
      acqMsg(`Compte non créé : ${corps && typeof corps.erreur === "string" ? corps.erreur.slice(0, 300) : `code ${rep.status}`}.`, true);
      return;
    }
    for (const id of ["dr-acq-c-email", "dr-acq-c-nom", "dr-acq-c-societe", "dr-acq-c-fin"]) $(id).value = "";
    acqMsg(`${email} : compte ${corps.cree ? "créé" : "mis à jour"}.`);
    await chargerAcquereurs();
  }

  async function inviterOrganisation(ev) {
    ev.preventDefault();
    const salle = $("dr-acq-salle").value, org = $("dr-acq-inv-org").value, fin = $("dr-acq-inv-fin").value;
    if (!salle || !org) { acqMsg("Choisissez une salle et une organisation.", true); return; }
    if (!dateValide(fin)) { acqMsg("Date de fin de l'accès ?", true); return; }
    await action("dr_inviter", {p_salle: salle, p_organisation: org, p_fin: `${fin}T23:59:59`, p_etape: Number($("dr-acq-inv-etape").value)},
      "Organisation invitée.");
  }

  // ------------------------------------------------------------------ « Acheteurs » (équipe, sql/09_marche.sql)
  // Une ligne par organisation acheteuse (dr_acheteurs) ; son panneau (dr_acces_organisation) ne montre QUE les salles où
  // elle participe : étape (réglée par dr_regler_participation, identifiant de la participation lu dans dr_participation),
  // statut et fin de l'accès, clause, droits accordés par dossier, documents ouverts sur listés. « Voir comme cet
  // acheteur » : aperçu en LECTURE SEULE de sa page (dr_apercu_marche, dr_apercu_documents, calculés par la base comme si
  // on était cette organisation, salles en préparation comprises) ; aucun bouton d'ouverture, aucune fonction de
  // l'acheteur (ni dr_autoriser, ni l'assistant), rien au journal. Tout texte venu de la base passe par textContent.
  const NIVEAUX = {consulter: "consulter", telecharger: "consulter et télécharger"};
  const STATUTS_SALLE_ACHETEUR = {preparation: "en préparation : pas encore visible de l'acheteur", ouverte: "ouverte",
                                  close: "close : plus visible de l'acheteur"};
  const ae = {orgs: [], choisie: null, projets: [], apercu: null, apercuFiche: null};
  const aeMsg = (t, classe = "") => ecrire($("dr-ae-msg"), t, classe);
  const aePMsg = (t, erreur = false) => ecrire($("dr-ae-p-msg"), t, erreur ? "erreur" : "");
  const pluriel = (n, mot, pl = mot + "s") => `${NOMBRE.format(n || 0)} ${(n || 0) > 1 ? pl : mot}`;
  const orgChoisie = () => ae.orgs.find(o => o.organisation_id === ae.choisie) || null;
  const fonctionAbsente = e => ["PGRST202", "42883"].includes(e && e.code);

  async function chargerAcheteurs() {
    const {data, error} = await appel("dr_acheteurs", {});
    $("dr-ae").hidden = false;
    const ul = $("dr-ae-liste");
    ul.textContent = "";
    if (error) {
      if (fonctionAbsente(error)) {
        aeMsg("Carte « Acheteurs » pas encore installée dans la base (sql/09_marche.sql, installé par une personne : " +
              "python etl/droits.py --installer).", "calme");
      } else aeMsg(`Lecture impossible : ${messageBase(error)}.`, "erreur");
      ae.orgs = [];
      fermerAcheteur(false);
      return;
    }
    aeMsg("");
    ae.orgs = (Array.isArray(data) ? data : []).slice().sort((a, b) => TRI.compare(a.nom || "", b.nom || ""));
    if (!ae.orgs.length) ul.appendChild(el("li", "dr-vide", "Aucune organisation acheteuse : créez-en une dans « Acquéreurs »."));
    for (const o of ae.orgs) {
      const choisie = o.organisation_id === ae.choisie;
      const li = el("li", "dr-ae-org" + (choisie ? " choisie" : ""));
      li.appendChild(el("span", "dr-ae-nom", o.nom));
      li.appendChild(el("span", "dr-ae-infos", [CATEGORIES[o.categorie] || o.categorie, pluriel(o.comptes, "compte"),
        pluriel(o.salles, "projet"), o.derniere_activite ? `dernière activité le ${date(o.derniere_activite)}` : "aucune activité"]
        .filter(Boolean).join(" · ")));
      const b = bouton(choisie ? "Ouvert" : "Voir ses accès", () => ouvrirAcheteur(o.organisation_id), "btn small",
                       `Voir les accès de ${o.nom}`, "ae-org:" + o.organisation_id);
      b.setAttribute("aria-expanded", String(choisie));
      li.appendChild(b);
      ul.appendChild(li);
    }
    if (ae.choisie && !orgChoisie()) fermerAcheteur(false);
  }

  // après une action (ici ou dans « Acquéreurs ») : liste et panneau ouvert relus, focus gardé
  async function rafraichirAcheteurs() {
    const voulu = focusDe($("dr-ae"));
    await chargerAcheteurs();
    if (ae.choisie) await ouvrirAcheteur(ae.choisie, false);
    rendreFocus($("dr-ae"), voulu);
  }

  function fermerAcheteur(focus = true) {
    const avant = ae.choisie;
    ae.choisie = null; ae.projets = [];
    fermerApercu(false);
    $("dr-ae-panneau").hidden = true;
    $("dr-ae-projets").textContent = "";
    aePMsg("");
    for (const li of $("dr-ae-liste").children) {
      li.classList.remove("choisie");
      const b = li.querySelector("button");
      if (b) { b.setAttribute("aria-expanded", "false"); b.textContent = "Voir ses accès"; }
    }
    if (focus && avant) rendreFocus($("dr-ae"), {cle: "ae-org:" + avant});
  }

  async function ouvrirAcheteur(id, focus = true) {
    if (ae.choisie !== id) fermerApercu(false);
    ae.choisie = id;
    const o = orgChoisie();
    if (!o) return;
    for (const li of $("dr-ae-liste").children) {
      const b = li.querySelector("button");
      const ici = !!b && b.dataset.cle === "ae-org:" + id;
      if (ici) li.classList.add("choisie"); else li.classList.remove("choisie");
      if (b) { b.setAttribute("aria-expanded", String(ici)); b.textContent = ici ? "Ouvert" : "Voir ses accès"; }
    }
    $("dr-ae-panneau").hidden = false;
    $("dr-ae-p-titre").textContent = `${o.nom} · ${CATEGORIES[o.categorie] || o.categorie || "acheteur"}`;
    if (focus) { aePMsg("Lecture des accès…"); $("dr-ae-p-titre").focus(); }
    const [acc, parts] = await Promise.all([appel("dr_acces_organisation", {p_organisation: id}),
                                            lire("dr_participation", "id,salle_id", r => r.eq("organisation_id", id))]);
    if (ae.choisie !== id) return;                      // autre organisation choisie entre-temps
    const ul = $("dr-ae-projets");
    ul.textContent = "";
    if (acc.error) { ae.projets = []; aePMsg(`Accès illisibles : ${messageBase(acc.error)}.`, true); return; }
    if (focus) aePMsg("");
    ae.projets = (Array.isArray(acc.data) ? acc.data : []).slice().sort((a, b) => TRI.compare(a.code || "", b.code || ""));
    const participation = new Map(((parts && !parts.error && parts.data) || []).map(p => [p.salle_id, p.id]));
    if (!ae.projets.length) {
      ul.appendChild(el("li", "dr-vide", "Aucun projet : cette organisation n'est invitée dans aucune salle. « Inviter sur un " +
        "autre projet » pour l'inviter."));
    }
    ae.projets.forEach((p, i) => ul.appendChild(ligneProjet(o, p, participation.get(p.salle_id), i)));
  }

  function ligneProjet(o, p, participationId, i) {
    const li = el("li", "dr-ae-projet" + (p.salle_statut === "preparation" ? " preparation" : ""));
    const titre = el("p", "dr-ae-projet-titre");
    titre.append(el("b", null, p.code), ` ${p.nom_de_code || ""}`);
    li.appendChild(titre);
    li.appendChild(el("p", p.salle_statut === "ouverte" ? "dr-note" : "dr-avert",
                      `Salle ${STATUTS_SALLE_ACHETEUR[p.salle_statut] || p.salle_statut}`));
    const echue = p.participation_statut === "echue" || (!!p.fin && Date.parse(p.fin) < Date.now());
    const actif = p.participation_statut === "active" && !echue;
    // documents « ouverts » : ceux de son étape et de ses droits ; ils ne s'ouvrent vraiment qu'avec un accès actif, une
    // salle ouverte et la clause acceptée (dr_autoriser) : sinon, on le dit à côté du nombre
    const bloque = !actif ? (echue ? "accès échu" : "accès suspendu") : p.salle_statut !== "ouverte" ? "salle pas ouverte"
      : !p.nda_acceptee ? "clause pas encore acceptée" : "";
    li.appendChild(el("p", "dr-note", [
      `Accès ${actif ? "actif" : echue ? "échu" : "suspendu"}` + (p.fin ? ` jusqu'au ${jourDe(p.fin)}` : ""),
      p.nda_acceptee ? "clause acceptée" : "clause pas encore acceptée",
      `${pluriel(p.documents_ouverts, "document ouvert", "documents ouverts")} à son étape sur ` +
        `${pluriel(p.documents_listes, "listé", "listés")}` + (bloque ? ` (rien ne s'ouvre pour lui : ${bloque})` : ""),
      p.derniere_activite ? `dernière activité le ${date(p.derniere_activite)}` : "aucune activité"].join(" · ")));
    // étape : réglée comme dans « Acquéreurs » (dr_regler_participation)
    const ligne = el("div", "dr-ae-etape");
    const choix = el("select", "dr-etape");
    choix.id = `dr-ae-etape-${i}`;
    choix.dataset.cle = "ae-etape:" + p.salle_id;
    ETAPES_ACHETEUR.forEach((t, n) => { const x = el("option", null, `Étape ${n} · ${t}`); x.value = String(n); choix.appendChild(x); });
    choix.value = String(p.etape);
    const l = el("label", null, "Étape atteinte");
    l.htmlFor = choix.id;
    ligne.append(l, choix);
    if (!participationId) {
      choix.disabled = true;
      ligne.appendChild(el("span", "dr-avert", "participation introuvable : rechargez"));
    }
    choix.addEventListener("change", () => reglerEtape(o, p, participationId, choix));
    li.appendChild(ligne);
    const droits = Array.isArray(p.droits) ? p.droits : [];
    if (!droits.length) {
      li.appendChild(el("p", "dr-note", "Droits par dossier : aucun accordé (dossiers non réservés, en consultation)."));
    } else {
      li.appendChild(el("p", "dr-note", "Droits par dossier accordés :"));
      const ud = el("ul", "dr-liste");
      for (const d of droits) {
        ud.appendChild(el("li", null, `${d.dossier} : ${NIVEAUX[d.niveau] || d.niveau}${d.reserve ? " · dossier réservé" : ""}`));
      }
      li.appendChild(ud);
    }
    return li;
  }

  async function reglerEtape(o, p, participationId, choix) {
    const v = Number(choix.value);
    if (!participationId || !(v >= 0 && v <= 3)) return;
    choix.disabled = true;
    const {error} = await appel("dr_regler_participation", {p_participation: participationId, p_reglages: {etape: v}});
    choix.disabled = false;
    if (error) { choix.value = String(p.etape); aePMsg(messageBase(error), true); return; }
    const texte = `${o.nom} · ${p.code} : étape ${v} (${ETAPES_ACHETEUR[v]}).`;
    await chargerAcquereurs();
    await chargerAcheteurs();
    await ouvrirAcheteur(o.organisation_id, false);
    aePMsg(texte);
    rendreFocus($("dr-ae"), {cle: "ae-etape:" + p.salle_id});
  }

  // « Inviter sur un autre projet » : le formulaire d'invitation de « Acquéreurs », prérempli (organisation, une salle
  // où elle n'est pas encore) ; la fin de l'accès et l'étape restent à choisir, l'invitation part par « Inviter »
  async function inviterAutreProjet() {
    const o = orgChoisie();
    if (!o) return;
    const deja = new Set(ae.projets.map(p => p.salle_id));
    const libres = acq.salles.filter(s => !deja.has(s.id));
    if (!libres.length) { aePMsg(`${o.nom} est déjà invitée dans toutes les salles.`); return; }
    const salle = $("dr-acq-salle");
    if (!salle.value || deja.has(salle.value)) {
      salle.value = libres[0].id;
      await chargerSalleAcquereurs();
    }
    $("dr-acq-inv-org").value = o.organisation_id;
    acqMsg(`Invitation de ${o.nom} : vérifiez la salle, choisissez la fin de l'accès et l'étape, puis « Inviter ».`);
    aePMsg(`Formulaire d'invitation prérempli pour ${o.nom}, dans la carte « Acquéreurs ».`);
    $("dr-acq-form-inviter").scrollIntoView({block: "center"});
    $("dr-acq-inv-fin").focus();
  }

  // ---------------- aperçu « Voir comme cet acheteur » (lecture seule)
  function fermerApercu(focus = true) {
    const ouvert = !!ae.apercu;
    ae.apercu = null;
    $("dr-ae-apercu").hidden = true;
    $("dr-ae-a-grille").textContent = "";
    $("dr-ae-a-f-docs").textContent = "";
    $("dr-ae-a-fiche").hidden = true;
    $("dr-ae-voir").setAttribute("aria-expanded", "false");
    if (focus && ouvert && !$("dr-ae-panneau").hidden) $("dr-ae-voir").focus();
  }

  // mêmes unités que la page de l'acheteur : MWc avec une fiche vitrine (publiée), MW pour une salle sans fiche
  const infosApercu = l => [l.technologie ? TECHNOS[l.technologie] || l.technologie : l.type_actif ? TYPES[l.type_actif] || l.type_actif : "",
    l.puissance_mw != null ? `${NOMBRE.format(Number(l.puissance_mw))} ${l.fiche_id ? "MWc" : "MW"}` : "", l.zone || "",
    l.stade ? STADES[l.stade] || l.stade : ""].filter(Boolean);
  // même dessin que la page de l'acheteur : illustration de la fiche vitrine si elle existe, sinon type d'actif de la salle
  const visuelApercu = (l, classe) => l.illustration
    ? visuelOperation({code: l.fiche_id || l.cle, type_actif: ILLUSTRATIONS[l.illustration] || "exploitation"}, classe)
    : visuelOperation({code: l.code || l.cle, type_actif: l.type_actif}, classe);
  const etapeDite = n => `étape ${n}${ETAPES_ACHETEUR[n] ? ` (${ETAPES_ACHETEUR[n]})` : ""}`;
  // salle en préparation : l'acheteur ne la voit pas encore ; si elle a une fiche vitrine PUBLIÉE (fiche_id n'est rendu
  // que pour une fiche publiée), il en voit seulement la fiche publique, en carte de découverte, sans document
  const prepaDite = (l, fiche) => (fiche ? "Salle en préparation : " : "En préparation : ") + (l.fiche_id
    ? "cet acheteur n'en voit que la fiche publique de la Marketplace (« Demander l'accès »), sans aucun document."
    : fiche ? "cet acheteur ne voit pas encore ce projet ni ses documents." : "cet acheteur ne voit pas encore ce projet");

  async function voirCommeAcheteur() {
    const o = orgChoisie();
    if (!o) return;
    const jeton = {org: o.organisation_id};
    ae.apercu = jeton;
    $("dr-ae-apercu").hidden = false;
    $("dr-ae-a-fiche").hidden = true;
    $("dr-ae-a-grille").hidden = false;
    $("dr-ae-a-grille").textContent = "";
    $("dr-ae-voir").setAttribute("aria-expanded", "true");
    $("dr-ae-a-bandeau").textContent = `Aperçu : vous voyez ce que voit ${o.nom}`;
    $("dr-ae-a-bandeau").focus();
    ecrire($("dr-ae-a-msg"), "Lecture…");
    const {data, error} = await appel("dr_apercu_marche", {p_organisation: o.organisation_id});
    if (ae.apercu !== jeton) return;
    if (error) { ecrire($("dr-ae-a-msg"), `Aperçu impossible : ${messageBase(error)}.`, "erreur"); return; }
    const lignes = Array.isArray(data) ? data : [];
    const projets = lignes.filter(l => l.participe), prepa = projets.filter(l => l.salle_statut === "preparation").length;
    ecrire($("dr-ae-a-msg"), !lignes.length ? "Rien à montrer : aucun projet pour cet acheteur, et aucune fiche publiée dans la Marketplace."
      : `${pluriel(projets.length, "projet")} de l'acheteur${prepa ? ` (dont ${prepa} en préparation, pas encore visible${prepa > 1 ? "s" : ""} de lui)` : ""}` +
        ` · ${pluriel(lignes.length - projets.length, "autre fiche publiée", "autres fiches publiées")}, sans document.`);
    const ul = $("dr-ae-a-grille");
    for (const l of lignes) {
      const li = el("li", "dr-v-carte" + (l.participe && l.salle_statut === "preparation" ? " dr-ae-prepa" : ""));
      if (l.participe && l.salle_statut === "preparation") {
        li.appendChild(el("p", "dr-ae-bandeau-prepa", prepaDite(l, false)));
      }
      li.appendChild(visuelApercu(l, "petit"));
      li.appendChild(el("p", "dr-ach-op-nom", l.nom_de_code));
      li.appendChild(el("p", "dr-ach-op-infos", infosApercu(l).join(" · ")));
      if (l.participe) {
        li.appendChild(el("p", "dr-v-extrait", [`Son projet · ${etapeDite(l.etape)}`, l.fin ? `accès jusqu'au ${jourDe(l.fin)}` : "",
          l.nda_a_accepter ? "clause à accepter" : "", l.assistant_actif ? "Claude activé" : "Claude non activé"].filter(Boolean).join(" · ")));
      } else {
        li.appendChild(el("p", "dr-v-extrait", "Fiche de présentation : aucun document."));
      }
      if (l.resume) li.appendChild(el("p", "dr-v-extrait", l.resume.length > 140 ? l.resume.slice(0, 140) + "…" : l.resume));
      if (l.participe && l.salle_id) {
        li.appendChild(bouton("Voir sa fiche", () => ficheApercu(l, jeton), "btn small",
                              `Voir la fiche de ${l.nom_de_code} comme ${o.nom}`, "ae-apercu:" + l.cle));
      }
      ul.appendChild(li);
    }
  }

  async function ficheApercu(l, jeton) {
    const o = orgChoisie();
    if (!o || ae.apercu !== jeton) return;
    ae.apercuFiche = l.cle;
    $("dr-ae-a-grille").hidden = true;
    $("dr-ae-a-fiche").hidden = false;
    $("dr-ae-a-f-titre").textContent = `${l.nom_de_code} (${l.code})`;
    // ce qui sépare l'aperçu de sa vraie page : salle en préparation, clause pas encore acceptée (il ne voit alors que
    // la clause, pas cette liste)
    $("dr-ae-a-f-prepa").textContent = [l.salle_statut === "preparation" ? prepaDite(l, true) : "",
      l.nda_a_accepter ? "Clause de confidentialité pas encore acceptée : l'acheteur voit d'abord la clause, et cette " +
        "liste seulement après l'avoir acceptée." : ""].filter(Boolean).join(" ");
    $("dr-ae-a-f-infos").textContent = [...infosApercu(l), etapeDite(l.etape)].join(" · ");
    $("dr-ae-a-f-resume").textContent = l.resume || "";
    const zone = $("dr-ae-a-f-docs");
    zone.textContent = "";
    $("dr-ae-a-f-titre").focus();
    ecrire($("dr-ae-a-f-msg"), "Lecture des documents…");
    const {data, error} = await appel("dr_apercu_documents", {p_salle: l.salle_id, p_organisation: o.organisation_id});
    if (ae.apercu !== jeton) return;
    if (error) { ecrire($("dr-ae-a-f-msg"), `Documents illisibles : ${messageBase(error)}.`, "erreur"); return; }
    const docs = Array.isArray(data) ? data : [];
    const ouverts = docs.filter(d => d.accessible).length;
    ecrire($("dr-ae-a-f-msg"), docs.length ? `${pluriel(ouverts, "document ouvert", "documents ouverts")} sur ` +
      `${pluriel(docs.length, "document listé", "documents listés")} pour ${o.nom}.` : "Aucun document publié visible de cet acheteur.");
    const parDossier = new Map();
    for (const d of docs) {
      if (!parDossier.has(d.dossier)) parDossier.set(d.dossier, []);
      parDossier.get(d.dossier).push(d);
    }
    for (const [dossier, liste] of [...parDossier].sort((a, b) => TRI.compare(a[0] || "", b[0] || ""))) {
      zone.appendChild(el("p", "dr-ae-dossier", dossier || "Dossier"));
      const ul = el("ul", "dr-ach-liste dr-ae-docs");
      for (const d of liste.sort((a, b) => TRI.compare(a.nom || "", b.nom || ""))) {
        const li = el("li", d.accessible ? "ouvert" : "ferme");
        if (!d.accessible) {
          const c = el("span", "dr-ae-cadenas");
          c.setAttribute("aria-hidden", "true");
          li.appendChild(c);
        }
        li.appendChild(el("span", "dr-nom", d.nom));
        if (d.taille != null) li.appendChild(el("span", "dr-taille", taille(Number(d.taille))));
        if (d.publie_le) li.appendChild(el("span", "dr-lieu", `publié le ${jourDe(d.publie_le)}`));
        li.appendChild(el("span", "dr-badge" + (d.accessible ? "" : " ferme"), d.accessible
          ? (d.telecharger ? "ouvert · téléchargeable" : "ouvert")
          : d.etape > l.etape ? `fermé : accessible à l'étape ${d.etape}` +
            (!consultable(d.mime) && !d.telecharger ? ", avec le niveau « télécharger » (ni PDF ni image)" : "")
          : "fermé : niveau « télécharger » nécessaire (ni PDF ni image)"));
        ul.appendChild(li);
      }
      zone.appendChild(ul);
    }
  }

  // ---------------- « Créer la fiche marketplace » d'une salle (dr_vitrine_depuis_salle) : brouillon lié à la salle,
  // prérempli par la base (ou fiche déjà liée), ouvert ensuite en édition dans la carte « Vitrine »
  async function ficheDepuisSalle(s, b) {
    if (b) b.disabled = true;
    const {data, error} = await appel("dr_vitrine_depuis_salle", {p_salle: s.id});
    if (b) b.disabled = false;
    if (error || !data) {
      arbreMsg(`Fiche marketplace de la salle ${s.code} : ${error ? messageBase(error) : "pas de réponse de la base"}.`, true);
      return;
    }
    vit.choisie = data;
    await chargerVitrineEquipe();
    const f = vit.fiches.find(x => x.id === data) || null;
    remplirFormulaire(f);
    arbreMsg(`Salle ${s.code} : fiche marketplace « ${f ? f.nom_de_code : s.nom_de_code} » ouverte dans « Vitrine » ` +
      (f && f.statut !== "brouillon" ? `(${STATUTS_FICHE[f.statut] || f.statut}).` : "(brouillon, invisible des acheteurs)."));
    $("dr-vit").scrollIntoView({block: "start"});
    $("dr-vit-nom").focus();
  }

  // ------------------------------------------------------------------ « Vitrine » (équipe, sql/08_vitrine.sql)
  // Préparation des fiches NON CONFIDENTIELLES de la Marketplace : brouillon, aperçu (exactement ce que voit un acquéreur,
  // rendu par la base), publication avec validation de diffusion, retrait, vente ; demandes d'accès (classées, aucun
  // droit donné). Aucune table lue directement : seulement les fonctions de l'équipe, qui contrôlent tout.
  const STATUTS_FICHE = {brouillon: "brouillon", publiee: "publiée", retiree: "retirée", vendue: "vendue"};
  const vit = {fiches: [], choisie: null};
  const vitMsg = (t, erreur = false) => ecrire($("dr-vit-msg"), t, erreur ? "erreur" : "");
  async function chargerVitrineEquipe() {
    const [{data, error}, dem] = await Promise.all([appel("dr_vitrine_equipe", {}), appel("dr_vitrine_demandes", {})]);
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") { $("dr-vit").hidden = true; return; }   // SQL non installé
      $("dr-vit").hidden = false;
      vitMsg(`Vitrine illisible : ${messageBase(error)}.`, true);
      return;
    }
    $("dr-vit").hidden = false;
    vit.fiches = Array.isArray(data) ? data : [];
    const ul = $("dr-vit-fiches");
    ul.textContent = "";
    if (!vit.fiches.length) ul.appendChild(el("li", "dr-vide", "Aucune fiche. Préparez-en une avec le formulaire."));
    for (const f of vit.fiches) {
      const li = el("li", "dr-vit-fiche" + (f.id === vit.choisie ? " choisie" : ""));
      li.appendChild(el("span", "dr-badge statut-" + f.statut, STATUTS_FICHE[f.statut] || f.statut));
      li.appendChild(el("span", "dr-vit-nom", f.nom_de_code));
      const liee = f.salle_id ? etat.salleDe.get(f.salle_id) : null;
      li.appendChild(el("span", "dr-vit-infos", `${NOMBRE.format(Number(f.puissance_mwc))} MWc · ${f.zone}` +
                                                  (liee ? ` · salle ${liee.code}` : "") +
                                                  (f.demandes_en_attente ? ` · ${f.demandes_en_attente} demande(s)` : "")));
      li.appendChild(bouton("Ouvrir", () => choisirFiche(f.id), "btn small", `Ouvrir la fiche ${f.nom_de_code}`));
      ul.appendChild(li);
    }
    const ud = $("dr-vit-demandes");
    ud.textContent = "";
    const demandes = dem && !dem.error && Array.isArray(dem.data) ? dem.data : [];
    if (!demandes.length) ud.appendChild(el("li", "dr-vide", "Aucune demande."));
    for (const d of demandes) {
      const li = el("li", "dr-vit-demande");
      li.appendChild(el("span", null, `${d.organisation} · ${d.nom_de_code} · ${jourDe(d.cree_le)} · ${d.statut === "en_attente" ? "en attente" : d.statut}`));
      if (d.message) li.appendChild(el("q", null, d.message));
      if (d.statut === "en_attente") {
        for (const [st, t] of [["traitee", "Marquer traitée"], ["refusee", "Refuser"]]) {
          li.appendChild(bouton(t, async () => {
            const {error: e} = await appel("dr_vitrine_demande_traiter", {p_id: d.id, p_statut: st});
            if (e) return vitMsg(messageBase(e), true);
            vitMsg("Demande classée. Aucun accès n'a été ouvert ; pour inviter : « Acquéreurs ».");
            await chargerVitrineEquipe();
          }, "btn small"));
        }
      }
      ud.appendChild(li);
    }
    if (vit.choisie) await apercuFiche(vit.choisie);
  }
  function remplirFormulaire(f) {
    $("dr-vit-form-titre").textContent = f ? `Fiche « ${f.nom_de_code} » (${STATUTS_FICHE[f.statut]})` : "Nouvelle fiche (brouillon)";
    $("dr-vit-nom").value = f ? f.nom_de_code : "";
    $("dr-vit-techno").value = f ? f.technologie : "pv_sol";
    $("dr-vit-stade").value = f ? f.stade : "exploitation";
    $("dr-vit-puissance").value = f ? f.puissance_mwc : "";
    $("dr-vit-zone").value = f ? f.zone : "Occitanie";
    $("dr-vit-annee").value = f && f.annee_mise_en_service ? f.annee_mise_en_service : "";
    $("dr-vit-resume").value = f ? f.resume : "";
    $("dr-vit-points").value = f ? (f.points_cles || []).join("\n") : "";
    $("dr-vit-illustration").value = f ? f.illustration : "sol";
    $("dr-vit-note").value = f ? f.note_interne : "";
    const fige = !!f && f.statut !== "brouillon";
    for (const n of $("dr-vit-form").querySelectorAll("input, select, textarea")) n.disabled = fige;
    $("dr-vit-enregistrer").disabled = fige;
    ecrire($("dr-vit-form-msg"), fige ? "Fiche publiée, retirée ou vendue : la remettre en brouillon pour la modifier." : "");
  }
  async function choisirFiche(id) {
    vit.choisie = id;
    remplirFormulaire(vit.fiches.find(f => f.id === id) || null);
    for (const li of $("dr-vit-fiches").children) li.classList.remove("choisie");
    await apercuFiche(id);
  }
  async function apercuFiche(id) {
    const f = vit.fiches.find(x => x.id === id);
    const {data, error} = await appel("dr_vitrine_apercu", {p_id: id});
    const zone = $("dr-vit-apercu-carte"), actions = $("dr-vit-actions");
    zone.textContent = ""; actions.textContent = "";
    if (error || !data || !f) { $("dr-vit-apercu").hidden = true; return; }
    $("dr-vit-apercu").hidden = false;
    const carte = el("div", "dr-v-carte apercu");
    carte.appendChild(visuelFiche(data, "petit"));                   // même dessin que la Marketplace
    carte.appendChild(el("p", "dr-ach-op-nom", data.nom_de_code));
    carte.appendChild(el("p", "dr-ach-op-infos", infosFiche(data).join(" · ")));
    if (data.resume) carte.appendChild(el("p", "dr-v-extrait", data.resume));
    const pts = el("ul", "dr-v-points");
    for (const p of data.points_cles || []) pts.appendChild(el("li", null, String(p)));
    carte.appendChild(pts);
    carte.appendChild(el("p", "dr-aide", `Champs envoyés aux acquéreurs : ${Object.keys(data).join(", ")}.`));
    zone.appendChild(carte);
    $("dr-vit-valider").checked = false;
    $("dr-vit-valider").disabled = f.statut !== "brouillon";
    const passer = (st, t, cls = "btn small") => actions.appendChild(bouton(t, async () => {
      if (st === "publiee" && !$("dr-vit-valider").checked) return vitMsg("Cochez la validation de la diffusion avant de publier.", true);
      // la validation porte sur la version RELUE ici (maj_le) : modifiée entre-temps, la base refuse (40001)
      const {error: e} = await appel("dr_vitrine_statut", st === "publiee"
        ? {p_id: id, p_statut: st, p_diffusion_validee: true, p_version: f.maj_le}
        : {p_id: id, p_statut: st});
      if (e && e.code === "40001") { await chargerVitrineEquipe(); return vitMsg("La fiche a été modifiée depuis cet aperçu : relisez l'aperçu à jour, puis validez de nouveau.", true); }
      if (e) return vitMsg(messageBase(e), true);
      vitMsg(`Fiche « ${f.nom_de_code} » : ${STATUTS_FICHE[st]}.`);
      await chargerVitrineEquipe();
      remplirFormulaire(vit.fiches.find(x => x.id === id) || null);
    }, cls));
    if (f.statut === "brouillon") passer("publiee", "Publier dans la Marketplace", "btn primary small");
    if (f.statut === "publiee") { passer("retiree", "Retirer"); passer("vendue", "Marquer vendue"); }
    if (f.statut === "retiree") passer("brouillon", "Remettre en brouillon");
  }
  async function enregistrerFiche(ev) {
    ev.preventDefault();
    const fiche = {nom_de_code: $("dr-vit-nom").value.trim(), technologie: $("dr-vit-techno").value, stade: $("dr-vit-stade").value,
                   puissance_mwc: Number(String($("dr-vit-puissance").value).replace(",", ".")), zone: $("dr-vit-zone").value,
                   resume: $("dr-vit-resume").value.trim(), illustration: $("dr-vit-illustration").value,
                   note_interne: $("dr-vit-note").value.trim(),
                   points_cles: $("dr-vit-points").value.split("\n").map(x => x.trim()).filter(Boolean)};
    const annee = $("dr-vit-annee").value.trim();
    fiche.annee_mise_en_service = annee ? Number(annee) : null;
    if (!fiche.nom_de_code || !(fiche.puissance_mwc > 0)) return ecrire($("dr-vit-form-msg"), "Nom de code et puissance attendus.", "erreur");
    if (fiche.points_cles.length > 5) return ecrire($("dr-vit-form-msg"), "5 points clés au plus.", "erreur");
    const brouillon = vit.choisie && (vit.fiches.find(f => f.id === vit.choisie) || {}).statut === "brouillon";
    const {data, error} = await appel("dr_vitrine_enregistrer", {p_id: brouillon ? vit.choisie : null, p_fiche: fiche});
    if (error) return ecrire($("dr-vit-form-msg"), `Non enregistrée : ${messageBase(error)}.`, "erreur");
    ecrire($("dr-vit-form-msg"), "Brouillon enregistré (invisible des acquéreurs). Vérifiez l'aperçu avant de publier.");
    vit.choisie = data;
    await chargerVitrineEquipe();
    remplirFormulaire(vit.fiches.find(f => f.id === data) || null);
  }

  // ------------------------------------------------------------------ tableau de bord (équipe, lot f)
  // dr_tableau (sql/07_tableau.sql) : une salle ou toutes ; seulement les acquéreurs (ni aperçus ni essais de l'équipe).
  // Lecture seule ; tout texte venu de la base passe par textContent.
  const tb = {donnees: null};
  const tbMsg = (t, erreur = false) => ecrire($("dr-tb-msg"), t, erreur ? "erreur" : "");
  function tableauLignes(table, entetes, lignes) {
    table.textContent = "";
    const tete = el("tr");
    for (const [t, n] of entetes) tete.appendChild(el("th", n ? "n" : null, t));
    const thead = el("thead"); thead.appendChild(tete); table.appendChild(thead);
    const corps = el("tbody");
    for (const l of lignes) {
      const tr = el("tr");
      l.forEach((v, i) => tr.appendChild(el("td", entetes[i][1] ? "n" : null, v)));
      corps.appendChild(tr);
    }
    table.appendChild(corps);
  }
  function afficherQuestions() {
    const t = tb.donnees, ol = $("dr-tb-questions");
    ol.textContent = "";
    if (!t) return;
    const qs = (Array.isArray(t.questions) ? t.questions : []).filter(q => !$("dr-tb-sans").checked || q.resultat === "sans_reponse");
    if (!qs.length) { ol.appendChild(el("li", "dr-vide", "Aucune question.")); return; }
    for (const q of qs) {
      const li = el("li", null, q.question);
      li.appendChild(el("span", "dr-tb-meta", [date(q.le), q.salle_code, q.organisation || "organisation inconnue",
        (RESULTATS[q.resultat] || q.resultat).toLowerCase(),
        q.etape_requise != null ? `réponse à l'étape ${q.etape_requise}` : ""].filter(Boolean).join(" · ")));
      ol.appendChild(li);
    }
  }
  async function chargerTableau() {
    const choix = $("dr-tb-salle");
    tbMsg("Lecture…");
    const {data, error} = await appel("dr_tableau", {p_salle: choix.value || null});
    if (error) {
      tbMsg(["PGRST202", "42883"].includes(error.code)
        ? "Tableau de bord pas encore installé dans la base (sql/07_tableau.sql : python etl/droits.py --installer)."
        : `Tableau de bord illisible : ${messageBase(error)}.`, true);
      $("dr-tableau").hidden = false;
      return;
    }
    const t = tb.donnees = data || {};
    tbMsg("");
    // périmètre : liste des salles gardée (lue avec « toutes les salles »)
    if (!choix.value && Array.isArray(t.salles)) {
      const avant = choix.value;
      choix.textContent = "";
      const tout = el("option", null, "Toutes les salles"); tout.value = ""; choix.appendChild(tout);
      for (const s of t.salles) { const o = el("option", null, `${s.code} · ${s.nom_de_code}`); o.value = s.salle_id; choix.appendChild(o); }
      choix.value = avant;
    }
    const c = t.chiffres || {};
    const dl = $("dr-tb-chiffres");
    dl.textContent = "";
    for (const [lib, v] of [["Documents publiés", NOMBRE.format(c.documents_publies || 0)],
                            ["Documents ouverts", NOMBRE.format(c.documents_ouverts || 0)],
                            ["Ouvertures", NOMBRE.format(c.ouvertures || 0)], ["Téléchargements", NOMBRE.format(c.telechargements || 0)],
                            ["Volume lu", taille(Number(c.octets) || 0) || "0 o"],
                            ["Organisations actives", NOMBRE.format(c.organisations_actives || 0)],
                            ["Questions", NOMBRE.format(c.questions || 0)], ["Sans réponse", NOMBRE.format(c.sans_reponse || 0)],
                            ["Recherches", NOMBRE.format(c.recherches || 0)]]) {
      const d = el("div"); d.append(el("dt", null, lib), el("dd", null, v)); dl.appendChild(d);
    }
    const vus = Array.isArray(t.plus_vus) ? t.plus_vus : [];
    tableauLignes($("dr-tb-vus"), [["Document"], ["Dossier"], ["Ouvertures", 1], ["Téléchargements", 1], ["Organisations", 1], ["Dernière"]],
      vus.map(d => [d.nom, d.dossier || "", NOMBRE.format(d.ouvertures), NOMBRE.format(d.telechargements),
                    NOMBRE.format(d.organisations), date(d.derniere)]));
    const jamais = Array.isArray(t.jamais_ouverts) ? t.jamais_ouverts : [], total = Number(t.jamais_ouverts_total) || 0;
    $("dr-tb-jamais-titre").textContent = `Documents jamais ouverts (${NOMBRE.format(total)})`;
    const ul = $("dr-tb-jamais");
    ul.textContent = "";
    for (const d of jamais) ul.appendChild(el("li", null, `${d.dossier ? d.dossier + " › " : ""}${d.nom}`));
    if (total > jamais.length) ul.appendChild(el("li", "dr-vide", `… et ${NOMBRE.format(total - jamais.length)} autres`));
    if (!total) ul.appendChild(el("li", "dr-vide", "Tous les documents publiés ont été ouverts."));
    const orgs = Array.isArray(t.organisations) ? t.organisations : [];
    tableauLignes($("dr-tb-orgs"), [["Organisation"], ["Salle"], ["Étape", 1], ["Statut"], ["Ouvertures", 1], ["Téléch.", 1],
                                     ["Documents", 1], ["Questions", 1], ["Recherches", 1], ["Dernière activité"]],
      orgs.map(o => [o.organisation, o.salle_code, String(o.etape), o.statut === "active" ? "active" : "suspendue",
                     NOMBRE.format(o.ouvertures), NOMBRE.format(o.telechargements), NOMBRE.format(o.documents),
                     NOMBRE.format(o.questions), NOMBRE.format(o.recherches), o.derniere_activite ? date(o.derniere_activite) : "aucune"]));
    afficherQuestions();
    const th = $("dr-tb-themes");
    th.textContent = "";
    const themes = Array.isArray(t.themes) ? t.themes : [];
    for (const x of themes) th.appendChild(el("li", null, `${x.mot} · ${NOMBRE.format(x.n)}`));
    if (!themes.length) th.appendChild(el("li", "dr-vide", "Aucun mot pour le moment."));
    $("dr-tableau").hidden = false;
  }

  // ------------------------------------------------------------------ démarrage
  $("dr-synchro").hidden = false;
  $("dr-recharger").addEventListener("click", () => recharger());
  $("dr-form-biblio").addEventListener("submit", declarer);
  $("dr-b-trouver").addEventListener("click", trouverSite);
  $("dr-form-portee").addEventListener("submit", verifierPortee);
  $("dr-biblio").addEventListener("change", ev => {
    etat.choisie = ev.target.value;
    oublierArbre();
    etat.elements = [];
    ecrire($("dr-arbre-msg"), "");
    recharger();
  });
  $("dr-form-chercher").addEventListener("submit", chercher);
  $("dr-indexer").addEventListener("click", indexerMaintenant);
  $("dr-form-assistant").addEventListener("submit", poserQuestion);
  $("dr-a-nouvelle").addEventListener("click", () => nouvelleConversation());
  $("dr-a-salle").addEventListener("change", contexteEquipe);
  $("dr-a-etape").addEventListener("change", contexteEquipe);
  $("dr-acq-recharger").addEventListener("click", () => chargerAcquereurs());
  $("dr-ae-recharger").addEventListener("click", () => rafraichirAcheteurs());
  $("dr-ae-voir").addEventListener("click", () => voirCommeAcheteur());
  $("dr-ae-inviter").addEventListener("click", () => inviterAutreProjet());
  $("dr-ae-fermer").addEventListener("click", () => fermerAcheteur());
  $("dr-ae-a-fermer").addEventListener("click", () => fermerApercu());
  $("dr-ae-a-retour").addEventListener("click", () => {
    $("dr-ae-a-fiche").hidden = true; $("dr-ae-a-grille").hidden = false;
    // le focus revient sur la carte du projet quitté (comme acheteur.js), sinon sur la première
    const boutons = [...$("dr-ae-a-grille").querySelectorAll("button")];
    const b = boutons.find(x => x.dataset.cle === "ae-apercu:" + ae.apercuFiche) || boutons[0];
    if (b) b.focus();
  });
  $("dr-acq-salle").addEventListener("change", () => chargerSalleAcquereurs());
  $("dr-acq-form-org").addEventListener("submit", creerOrganisation);
  $("dr-acq-form-inviter").addEventListener("submit", inviterOrganisation);
  $("dr-acq-form-compte").addEventListener("submit", creerCompte);
  $("dr-tb-recharger").addEventListener("click", () => chargerTableau());
  $("dr-vit-recharger").addEventListener("click", () => chargerVitrineEquipe());
  $("dr-vit-form").addEventListener("submit", enregistrerFiche);
  $("dr-vit-nouvelle").addEventListener("click", () => { vit.choisie = null; remplirFormulaire(null); $("dr-vit-apercu").hidden = true; });
  $("dr-tb-salle").addEventListener("change", () => chargerTableau());
  $("dr-tb-sans").addEventListener("change", afficherQuestions);
  await recharger();
  await chargerTexte();
  await chargerConso();
  await chargerAcquereurs();
  await chargerAcheteurs();
  await chargerVitrineEquipe();
  await chargerTableau();
})();
