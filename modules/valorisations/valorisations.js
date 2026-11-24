/* Onglet Valorisations : module de la plateforme (page assemblée par etl/site.py, derrière la coquille) ou page de
   développement servie par etl/valorisation/serveur_dev.py (configuration « va-config » dans la page).
   Dans la plateforme : la coquille a vérifié la connexion et le rôle (mes_modules, double authentification) ; chaque
   appel au serveur de calcul porte le jeton de session Supabase du moment (Authorization: Bearer), que le serveur
   vérifie à nouveau (signature, rôle demandé à la base). Aucun email ni identifiant saisi n'est jamais cru.
   Tout texte venu du serveur (noms, extraits de documents, messages) passe par textContent : jamais interprété comme
   du HTML. Aucune intégration n'est simulée ici : la page affiche l'état rendu par le serveur et ses refus tels quels. */
(async () => {
  "use strict";
  const configDev = document.getElementById("va-config");
  let P = null, cfg;
  if (configDev) {
    cfg = JSON.parse(configDev.textContent);
  } else {
    try { P = await window.plateforme.pret; } catch { return; }      // refus : la coquille l'a affiché
    const api = (window.plateforme.conf || {}).serveur;   // origine du serveur de calcul (site.env)
    cfg = {api: api ? api.replace(/\/+$/, "") + "/api" : null, acces: "plateforme", demo: false, essai: false, membre: ""};
  }
  const $ = id => document.getElementById(id);
  const SCENARIOS = [["bas", "Bas"], ["central", "Central"], ["haut", "Haut"]];
  const NOMS_INTEGRATIONS = {claude: "Extraction Claude", drive: "Google Drive", recalcul: "Recalcul du modèle",
                             pdf: "Rapport PDF", stockage: "Stockage des documents"};
  // unités de saisie : celles de etl/valorisation/unites.py (le serveur refuse toute autre) ; l'unité du champ du modèle
  // est toujours ajoutée à la liste (remplirUnites), pour qu'aucun champ ne soit impossible à saisir
  const UNITES = ["MWc", "kWc", "MW", "MWh", "h/an", "kWh/kWc/an", "€/MWh", "€/kWh", "c€/kWh", "%", "%/an", "fraction",
                  "k€", "€", "M€", "€/an", "k€/an", "ans", "mois", "€/kWc", "€/kWc/an", "k€/MWc", "texte", "date", "nombre"];
  let projet = null, etatGeneral = null;

  function el(tag, cls, texte) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texte !== undefined && texte !== null) n.textContent = String(texte);
    return n;
  }
  function bouton(texte, action, cls = "btn small") {
    const b = el("button", cls, texte);
    b.type = "button";
    b.addEventListener("click", action);
    return b;
  }
  function message(id, texte, erreur = false) {
    const m = $(id);
    m.textContent = texte || "";
    m.className = "va-msg" + (erreur ? " erreur" : "");
  }

  // identité : démonstration fictive locale -> compte de développement ; sinon jeton de session (fourni par la coquille
  // de la plateforme en production ; collé ici en développement), vérifié par le serveur et la base
  async function identite() {
    if (cfg.acces === "plateforme") {                      // jeton de la session en cours (rafraîchi par supabase-js)
      let session = null;
      try { ({data: {session}} = await P.sb.auth.getSession()); } catch {}
      return session && session.access_token ? {"Authorization": "Bearer " + session.access_token} : {};
    }
    if (cfg.acces === "demo") return {"X-Valo-Membre": $("va-membre").value.trim()};
    return $("va-membre").value.trim() ? {"Authorization": "Bearer " + $("va-membre").value.trim()} : {};
  }
  async function api(methode, chemin, corps, entetes = {}) {
    if (!cfg.api) return {ok: false, statut: 0, donnees: {erreur: "serveur de calcul non configuré"}};
    const init = {method: methode, credentials: "omit", cache: "no-store", redirect: "error",
                  headers: {...(await identite()), ...entetes}};
    if (corps instanceof Blob || corps instanceof ArrayBuffer) init.body = corps;
    else if (corps !== undefined) { init.body = JSON.stringify(corps); init.headers["Content-Type"] = "application/json"; }
    let rep, donnees = null;
    try { rep = await fetch(cfg.api + chemin, init); } catch { return {ok: false, statut: 0, donnees: {erreur: "serveur injoignable"}}; }
    try { donnees = await rep.json(); } catch { donnees = null; }
    return {ok: rep.ok, statut: rep.status, donnees};
  }
  const erreurDe = r => (r.donnees && typeof r.donnees.erreur === "string" ? r.donnees.erreur : `réponse ${r.statut}`) +
    (r.donnees && r.donnees.details && r.donnees.details.manquants ? ` : ${r.donnees.details.manquants.join(", ")}` : "");

  // ------------------------------------------------------------------ état général
  async function chargerEtat() {
    const r = await api("GET", "/etat");
    if (!r.ok) { message("va-msg", erreurDe(r), true); return; }
    etatGeneral = r.donnees;
    $("va-demo").hidden = !etatGeneral.demo;
    $("va-essai").hidden = !etatGeneral.essai;
    const ul = $("va-etats");
    ul.textContent = "";
    for (const [cle, e] of Object.entries(etatGeneral.integrations)) {
      const li = el("li", e.etat, `${NOMS_INTEGRATIONS[cle] || cle} : ${e.etat === "pret" ? "prêt" : e.etat === "desactive" ? "désactivé" : e.etat === "non_durable" ? "non durable (développement)" : e.etat === "local_prive" ? "local privé (sans copie distante)" : e.etat === "non_configure" ? "non configuré" : e.etat}`);
      li.title = e.raison;
      ul.appendChild(li);
    }
    const m = etatGeneral.modele;
    $("va-modele").textContent = `Modèle : ${m.nom || "?"} ; correspondance des cellules : ${m.statut_correspondance}` +
      (m.disponible ? "" : " ; fichier modèle non chargé sur ce serveur") + (m.erreur ? ` (${m.erreur})` : "") + ".";
    $("va-gabarit").hidden = m.disponible || !m.restaurable;
    const pe = etatGeneral.persistance || {etat: "memoire", ecartes: []};
    $("va-persistance").textContent = (pe.etat === "locale"
      ? "Projets enregistrés dans un dossier privé du serveur (repris au redémarrage)."
      : "Projets en mémoire seulement : perdus à l'arrêt du serveur.") +
      (pe.ecartes.length ? ` ${pe.ecartes.length} projet(s) illisible(s) ou altéré(s) écarté(s) : ` +
                           pe.ecartes.map(x => `${x.id} (${x.raison})`).join(" ; ") : "");
    $("va-persistance").className = "va-aide" + (pe.ecartes.length ? " va-alerte" : "");
    const c = etatGeneral.integrations.claude;
    $("va-extraire").disabled = c.etat !== "pret";
    $("va-extraire-etat").textContent = c.etat === "pret" ? "" : `Indisponible : ${c.raison}.`;
    const choix = $("va-p-choix"), avant = choix.value;
    choix.textContent = "";
    choix.appendChild(el("option", null, "Choisir un projet")).value = "";
    for (const p of etatGeneral.projets) { const o = el("option", null, p.nom); o.value = p.id; choix.appendChild(o); }
    choix.value = projet ? projet.id : avant;
  }

  // ------------------------------------------------------------------ projet
  function afficher(p) {
    projet = p;
    $("va-projet").hidden = !p;
    if (!p) return;
    if (p.avertissement) message("va-msg", p.avertissement, true);
    const docs = $("va-docs");
    docs.textContent = "";
    for (const d of p.documents) docs.appendChild(el("li", null, `${d.nom} (${Math.ceil(d.taille / 1024)} Ko, ${d.format})`));
    afficherDonnees(p);
    afficherTableaux(p);
    afficherHypotheses(p);
    afficherGeneration(p);
    message("va-d-msg", p.drive ? `Dossier lié : ${p.drive.dossier_id} (par ${p.drive.lie_par}, ${p.drive.verifie ? "vérifié" : "non vérifié"}).` : "");
    const reglage = p.reglages_note || {};                 // lecture de la dette enregistrée pour CE projet
    $("va-financement").value = reglage.financement || "dette_reprise";
    $("va-financement-just").value = reglage.justification || "";
  }

  function afficherTableaux(p) {
    const tableaux = p.mapping.tableaux || [], zone = $("va-tableaux");
    $("va-s-tableaux").hidden = !tableaux.length;
    zone.textContent = "";
    for (const t of tableaux) {
      const saisi = (p.tableaux || {})[t.cle];
      const cols = t.colonnes.map(c => `${c.cle}${c.unite !== "texte" ? ` (${c.unite})` : ""}${c.obligatoire ? " *" : ""}`);
      zone.appendChild(el("h3", null, `${t.libelle} : ${saisi ? saisi.lignes.length : 0} / ${t.lignes_max} lignes` +
                                         (saisi ? ` (par ${saisi.par})` : "")));
      zone.appendChild(el("p", "va-aide", `${t.feuille}, lignes ${t.premiere_ligne} à ${t.premiere_ligne + t.lignes_max - 1} ; en-tête : ${cols.join(" ; ")}`));
      const src = el("input", "va-tab-source");
      src.placeholder = "Source des valeurs (document, page, hypothèse documentée…)";
      src.dataset.cle = t.cle;
      src.value = saisi && saisi.source ? saisi.source : "";
      zone.appendChild(src);
      const hy = el("input", "va-tab-hyp");                  // vide par défaut : rien n'est coché à la place du membre
      hy.placeholder = "Valeurs posées en HYPOTHÈSE de test, non confirmées (ligne.colonne, ex. 1.cca_tiers, 1.tresorerie)";
      hy.dataset.cle = t.cle;
      hy.value = saisi && saisi.hypotheses ? saisi.hypotheses.map(h => `${h.ligne}.${h.colonne}`).join(", ") : "";
      zone.appendChild(hy);
      if (saisi && saisi.hypotheses && saisi.hypotheses.length)
        zone.appendChild(el("p", "va-hyp-test", `${saisi.hypotheses.length} valeur(s) en hypothèse de test non confirmée : ` +
          saisi.hypotheses.map(h => `ligne ${h.ligne}, ${h.colonne} = ${h.valeur}`).join(" ; ") + " — documents NON VALIDÉS tant qu'elles restent."));
      const zt = el("textarea", "va-tab-saisie");
      zt.rows = 6;
      zt.dataset.cle = t.cle;
      zt.value = saisi ? saisi.lignes.map(l => t.colonnes.map(c => l[c.cle] ?? "").join(";")).join("\n") : "";
      zone.appendChild(zt);
      const b = el("button", "btn small", "Enregistrer les lignes");
      b.type = "button";
      b.addEventListener("click", () => enregistrerTableau(t, zt.value, src.value, hy.value));
      zone.appendChild(el("div", "va-ligne")).appendChild(b);
    }
  }
  async function enregistrerTableau(t, texte, source = "", hypTexte = "") {
    const lignes = [];
    for (const [i, brut] of texte.split(/\r?\n/).entries()) {
      if (!brut.trim()) continue;
      let cases = brut.split(";").map(x => x.trim());
      const derniere = t.colonnes[t.colonnes.length - 1];
      if (cases.length > t.colonnes.length && derniere.type === "texte")    // la dernière colonne (texte) peut contenir des « ; »
        cases = [...cases.slice(0, t.colonnes.length - 1), cases.slice(t.colonnes.length - 1).join(" ; ")];
      if (cases.length > t.colonnes.length) return message("va-msg", `${t.libelle}, ligne ${i + 1} : ${cases.length} colonnes pour ${t.colonnes.length}.`, true);
      const l = {};
      for (const [j, c] of t.colonnes.entries()) {
        const v = cases[j] ?? "";
        if (v === "") continue;
        l[c.cle] = c.type === "nombre" ? Number(v.replace(/\s/g, "").replace(",", ".")) : v;
        if (c.type === "nombre" && !Number.isFinite(l[c.cle])) return message("va-msg", `${t.libelle}, ligne ${i + 1} : « ${c.cle} » nombre attendu.`, true);
      }
      lignes.push(l);
    }
    const hypotheses = hypTexte.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
    const r = await api("POST", `/projets/${projet.id}/tableaux`, {cle: t.cle, lignes, source, hypotheses});
    if (!r.ok) return message("va-msg", erreurDe(r), true);
    message("va-msg", `${t.libelle} : ${lignes.length} ligne(s) enregistrée(s).`);
    afficher(r.donnees);
  }

  function afficherDonnees(p) {
    const corps = $("va-donnees");
    corps.textContent = "";
    for (const d of p.donnees) {
      const tr = el("tr");
      tr.appendChild(el("td", null, d.cle));
      tr.appendChild(el("td", null, `${d.valeur} ${d.unite}` + (d.proposition ? ` (proposé : ${d.proposition.valeur} ${d.proposition.unite})` : "")));
      const src = el("td", "va-source");
      if (d.source && d.source.document) {
        const doc = p.documents.find(x => x.id === d.source.document);
        src.appendChild(el("div", null, `${doc ? doc.nom : d.source.document}${d.source.page ? `, p. ${d.source.page}` : ""}`));
        if (d.source.extrait) src.appendChild(el("div", null, `« ${d.source.extrait} »`));
        if (!d.source.verifiee && d.origine === "extraction") src.appendChild(el("div", "va-alerte", "extrait non vérifié automatiquement"));
      } else src.textContent = d.origine === "saisie" ? "saisie manuelle" : "aucune";
      tr.appendChild(src);
      tr.appendChild(el("td", null, d.origine === "extraction" ? `${Math.round(d.confiance * 100)} %` : "—"));
      const st = el("td");
      st.appendChild(el("span", "va-statut " + d.statut, {propose: "proposé", valide: "validé", corrige: "corrigé", rejete: "rejeté"}[d.statut] || d.statut));
      if (d.valide_par) st.appendChild(el("div", "va-source", d.valide_par));
      tr.appendChild(st);
      const act = el("td");
      if (d.statut === "propose") {
        act.appendChild(bouton("Valider", () => agirDonnee({action: "valider", cle: d.cle})));
        act.appendChild(bouton("Rejeter", () => agirDonnee({action: "rejeter", cle: d.cle})));
      }
      tr.appendChild(act);
      corps.appendChild(tr);
    }
    const champs = p.mapping.champs || [];
    const valides = new Set(p.donnees.filter(d => d.statut === "valide" || d.statut === "corrige").map(d => d.cle));
    // données propres au projet (sans valeur par défaut du modèle) : à valider ici ; les autres hypothèses obligatoires
    // sont reprises du modèle à l'étape 3 (signalées « à revoir »)
    const manquants = champs.filter(c => c.obligatoire && c.defaut !== "modele" && !valides.has(c.cle)).map(c => c.libelle || c.cle);
    const duModele = champs.filter(c => c.obligatoire && c.defaut === "modele" && !valides.has(c.cle)).length;
    $("va-manquants").className = "va-manquants" + (champs.length && !manquants.length ? " complet" : "");
    $("va-manquants").textContent = !champs.length
      ? "Aucun champ : la correspondance des cellules du modèle n'est pas établie (remplissage impossible)."
      : (manquants.length ? `Données du projet obligatoires sans valeur validée : ${manquants.join(", ")}.`
                          : "Toutes les données obligatoires du projet sont validées.") +
        (duModele ? ` ${duModele} hypothèse(s) obligatoire(s) reprise(s) du modèle à l'étape 3, à revoir.` : "");
    const sel = $("va-s-cle"), avant = sel.value;
    sel.textContent = "";
    for (const c of champs) { const o = el("option", null, c.libelle || c.cle); o.value = c.cle; sel.appendChild(o); }
    if (avant) sel.value = avant;
    remplirUnites();
  }
  function remplirUnites() {
    const c = (projet && projet.mapping.champs || []).find(x => x.cle === $("va-s-cle").value);
    const u = $("va-s-unite");
    u.textContent = "";
    for (const x of (c && !UNITES.includes(c.unite) ? [...UNITES, c.unite] : UNITES)) {
      const o = el("option", null, x); o.value = x; u.appendChild(o);
    }
    if (c) u.value = c.unite;
  }
  async function agirDonnee(corps) {
    const r = await api("POST", `/projets/${projet.id}/donnees`, corps);
    if (!r.ok) return message("va-msg", erreurDe(r), true);
    message("va-msg", "");
    afficher(r.donnees);
  }

  function afficherHypotheses(p) {
    const corps = $("va-hyp");
    corps.textContent = "";
    if (!p.hypotheses) {
      corps.appendChild(el("tr")).appendChild(el("td", "va-aide", "Pas encore préremplies.")).colSpan = 5;
      return;
    }
    for (const c of p.mapping.champs || []) {
      const tr = el("tr");
      tr.appendChild(el("td", null, (c.libelle || c.cle) + (c.par_scenario ? "" : " (commune)") + (c.obligatoire ? " *" : "")));
      for (const [s, nomS] of SCENARIOS) {
        const td = el("td");
        const h = p.hypotheses[s][c.cle];
        const i = el("input");
        i.value = h.valeur === null ? "" : h.valeur;
        i.setAttribute("aria-label", `${c.libelle || c.cle}, scénario ${nomS}`);
        i.dataset.cle = c.cle; i.dataset.scenario = s;
        i.addEventListener("change", () => ajuster(s, c, i.value));
        td.appendChild(i);
        if (h.origine === "a_saisir") td.appendChild(el("div", "va-alerte", "à saisir"));
        else if (h.origine === "modele") td.appendChild(el("div", "va-aide", "valeur du modèle, à revoir"));
        else if (String(h.origine || "").startsWith("ajuste:")) td.appendChild(el("div", "va-aide", "ajustée"));
        tr.appendChild(td);
      }
      tr.appendChild(el("td", null, c.unite));
      corps.appendChild(tr);
    }
  }
  async function ajuster(scenario, champ, brut) {
    const valeur = champ.type === "nombre" ? Number(String(brut).replace(",", ".")) : String(brut);
    if (champ.type === "nombre" && (brut === "" || !Number.isFinite(valeur))) return message("va-msg", `${champ.libelle} : nombre attendu.`, true);
    const r = await api("POST", `/projets/${projet.id}/hypotheses`, {scenario, cle: champ.cle, valeur, unite: champ.unite});
    if (!r.ok) return message("va-msg", erreurDe(r), true);
    message("va-msg", `${champ.libelle} (${champ.par_scenario ? scenario : "tous les scénarios"}) enregistré.`);
    afficher(r.donnees);
  }

  function afficherGeneration(p) {
    const zone = $("va-resultats");
    zone.textContent = "";
    const g = p.generation;
    if (!g) return;
    const ETATS = {fait: "fait", erreurs_excel: "fait, avec des formules en erreur", echec: "en échec", non_demande: "non demandé"};
    zone.appendChild(el("p", g.recalcul.etat === "fait" ? null : "va-alerte",
      `Recalcul (${g.recalcul.moteur || "—"}, ${g.recalcul.formules_controlees ?? 0} formules contrôlées) : ` +
      `${ETATS[g.recalcul.etat] || g.recalcul.etat}${g.recalcul.erreur ? ` (${g.recalcul.erreur})` : ""} ; ` +
      `PDF : ${ETATS[g.pdf.etat] || g.pdf.etat}${g.pdf.erreur ? ` (${g.pdf.erreur})` : ""} ; ` +
      `scénarios : ${g.mode_scenarios === "natif" ? "natifs du modèle (un classeur)" : "un classeur par scénario"}.`));
    if (g.statut_documents) {
      zone.appendChild(el("p", g.statut_documents.valide ? "va-complet" : "va-alerte",
        g.statut_documents.valide ? "Documents validés." :
          `Documents de travail NON VALIDÉS (mention sur chaque page et dans les noms de fichiers) : ${g.statut_documents.raisons.join(" ; ")}.`));
    }
    if (g.note && g.note.etat !== "non_prevue") {
      const NOTE = {faite: "faite", non_faite: "non faite", echec: "en échec"};
      zone.appendChild(el("p", g.note.etat === "faite" && !g.note.a_chiffrer ? null : "va-alerte",
        `Note de valorisation à la charte : ${NOTE[g.note.etat] || g.note.etat}` +
        (g.note.erreur ? ` (${g.note.erreur})` : "") +
        (g.note.etat === "faite" ? ` ; ${g.note.a_chiffrer} espace(s) réservé(s) « [à chiffrer] » à compléter.` : ".")));
    }
    if (g.resultats) {
      const t = el("table", "va-table");
      const tete = t.appendChild(el("thead")).appendChild(el("tr"));
      for (const x of ["Résultat", "Bas", "Central", "Haut", "Unité"]) tete.appendChild(el("th", null, x));
      const tb = t.appendChild(el("tbody"));
      for (const r of p.mapping.resultats || []) {
        const tr = tb.appendChild(el("tr"));
        tr.appendChild(el("td", null, r.libelle || r.cle));
        for (const [s] of SCENARIOS) {
          const v = g.resultats[s][r.cle];
          const erreur = v === null && (g.recalcul.erreurs_excel || {})[s];
          tr.appendChild(el("td", erreur ? "va-alerte" : null, typeof v === "number" ?
            v.toLocaleString("fr-FR", {maximumFractionDigits: 1}) : erreur ? "scénario en erreur" : v == null ? "—" : String(v)));
        }
        tr.appendChild(el("td", null, r.unite));
      }
      zone.appendChild(t);
      zone.appendChild(el("p", "va-aide", "Valeurs recalculées par LibreOffice sur une copie ; Excel recalcule les fichiers livrés à l'ouverture."));
    }
    const ul = zone.appendChild(el("ul"));
    for (const nom of g.fichiers) {
      const a = el("a", null, nom);
      a.href = "#";
      a.addEventListener("click", ev => { ev.preventDefault(); telecharger(nom); });
      ul.appendChild(el("li")).appendChild(a);
    }
    if (g.limites.length) {
      zone.appendChild(el("p", null, "Limites :"));
      const ll = zone.appendChild(el("ul"));
      for (const x of g.limites) ll.appendChild(el("li", "va-alerte", x));
    }
  }
  async function telecharger(nom) {
    let rep;
    try {
      rep = await fetch(`${cfg.api}/projets/${projet.id}/fichiers/${encodeURIComponent(nom)}`,
                        {headers: await identite(), cache: "no-store", credentials: "omit", redirect: "error"});
    } catch { return message("va-msg", "serveur injoignable", true); }
    if (!rep.ok) return message("va-msg", `téléchargement refusé (${rep.status})`, true);
    if (P) return P.telecharger(nom, await rep.blob());
    const url = URL.createObjectURL(await rep.blob());
    const a = el("a");
    a.href = url; a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ------------------------------------------------------------------ événements
  $("va-f-projet").addEventListener("submit", async ev => {
    ev.preventDefault();
    const nom = $("va-p-nom").value.trim();
    if (!nom) return message("va-msg", "Nom du projet attendu.", true);
    const r = await api("POST", "/projets", {nom});
    if (!r.ok) return message("va-msg", erreurDe(r), true);
    $("va-p-nom").value = "";
    message("va-msg", `Projet « ${r.donnees.nom} » créé.`);
    afficher(r.donnees);
    await chargerEtat();
  });
  $("va-gabarit-envoyer").addEventListener("click", async () => {
    const f = $("va-gabarit-fichier").files[0];
    if (!f) return message("va-msg", "Choisir le fichier du gabarit.", true);
    const r = await api("POST", "/modele/gabarit", await f.arrayBuffer(),
                        {"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    if (!r.ok) return message("va-msg", `Gabarit non restauré : ${erreurDe(r)}`, true);
    message("va-msg", `Gabarit restauré dans le coffre privé du serveur (empreinte ${r.donnees.gabarit.sha256.slice(0, 12)}…, vérifiée).`);
    $("va-gabarit-fichier").value = "";
    chargerEtat();
  });
  $("va-p-choix").addEventListener("change", async () => {
    const id = $("va-p-choix").value;
    if (!id) return afficher(null);
    const r = await api("GET", `/projets/${id}`);
    if (!r.ok) return message("va-msg", erreurDe(r), true);
    afficher(r.donnees);
  });
  $("va-deposer").addEventListener("click", async () => {
    const fichiers = [...$("va-fichiers").files];
    if (!fichiers.length) return message("va-msg", "Choisir au moins un fichier.", true);
    for (const f of fichiers) {
      const r = await api("POST", `/projets/${projet.id}/documents`, f, {"X-Nom-Fichier": encodeURIComponent(f.name)});
      if (!r.ok) { message("va-msg", `${f.name} : ${erreurDe(r)}`, true); continue; }
      message("va-msg", `${f.name} déposé.`);
      afficher(r.donnees.projet);
    }
    $("va-fichiers").value = "";
  });
  $("va-extraire").addEventListener("click", async () => {
    const r = await api("POST", `/projets/${projet.id}/extraire`);
    if (!r.ok) return message("va-msg", `Extraction : ${erreurDe(r)}`, true);
    message("va-msg", `${r.donnees.propositions} proposition(s), à valider une à une.`);
    afficher(r.donnees.projet);
  });
  $("va-s-cle").addEventListener("change", remplirUnites);
  $("va-f-saisie").addEventListener("submit", async ev => {
    ev.preventDefault();
    const c = (projet.mapping.champs || []).find(x => x.cle === $("va-s-cle").value);
    if (!c) return message("va-msg", "Aucun champ à saisir.", true);
    const brut = $("va-s-valeur").value.trim(), unite = $("va-s-unite").value;
    const valeur = c.type === "nombre" ? Number(brut.replace(",", ".")) : brut;
    if (c.type === "nombre" && (!brut || !Number.isFinite(valeur))) return message("va-msg", "Nombre attendu.", true);
    const r = await api("POST", `/projets/${projet.id}/donnees`, {action: "saisir", cle: c.cle, valeur, unite});
    if (!r.ok) return message("va-msg", erreurDe(r), true);
    $("va-s-valeur").value = "";
    message("va-msg", `${c.libelle} enregistré (${valeur} ${unite}).`);
    afficher(r.donnees);
  });
  $("va-preparer").addEventListener("click", async () => {
    const r = await api("POST", `/projets/${projet.id}/hypotheses`, {action: "preparer"});
    if (!r.ok) return message("va-msg", erreurDe(r), true);
    message("va-msg", "Hypothèses préremplies à partir des données validées.");
    afficher(r.donnees);
  });
  $("va-financement").addEventListener("change", async () => {
    const r = await api("POST", `/projets/${projet.id}/note`, {financement: $("va-financement").value,
                                                               justification: $("va-financement-just").value});
    if (!r.ok) return message("va-msg", erreurDe(r), true);
    message("va-msg", "Lecture de la dette pour la note enregistrée.");
    afficher(r.donnees);
  });
  $("va-generer").addEventListener("click", async () => {
    $("va-generer").disabled = true;
    message("va-msg", "Génération en cours…");
    const r = await api("POST", `/projets/${projet.id}/generer`);
    $("va-generer").disabled = false;
    if (!r.ok) return message("va-msg", `Génération refusée : ${erreurDe(r)}`, true);
    message("va-msg", r.donnees.generation && r.donnees.generation.mode_scenarios === "natif" ?
      "Classeurs générés : un classeur, scénarios natifs du modèle." : "Classeurs générés (un par scénario).");
    afficher(r.donnees);
  });
  $("va-f-drive").addEventListener("submit", async ev => {
    ev.preventDefault();
    const r = await api("POST", `/projets/${projet.id}/drive`, {dossier_id: $("va-d-id").value});
    if (!r.ok) return message("va-d-msg", erreurDe(r), true);
    afficher(r.donnees);
  });
  $("va-sauver").addEventListener("click", async () => {
    const r = await api("POST", `/projets/${projet.id}/sauvegarder`);
    if (!r.ok) return message("va-d-msg", `Sauvegarde non faite : ${erreurDe(r)}`, true);
    const f = (r.donnees.sauvegarde && r.donnees.sauvegarde.fichiers) || [];
    afficher(r.donnees.projet);
    message("va-d-msg", `Sauvegardé sur Drive : ${f.length} fichier(s) déposé(s), empreintes contrôlées.`);
  });
  $("va-essai").hidden = !cfg.essai;               // avertissement visible dès l'ouverture, avant toute connexion
  if (P) {                                         // plateforme : l'identité vient de la session, rien à saisir
    $("va-membre-lib").hidden = true;
    if (!cfg.api) {
      message("va-msg", "Serveur de calcul non configuré pour ce site (VALORISATIONS_API absente de site.env) : "
                        + "rien ne peut être calculé ni enregistré depuis cette page.", true);
      return;
    }
    return chargerEtat();
  }
  $("va-membre").addEventListener("change", chargerEtat);
  $("va-membre").value = cfg.membre || "";
  if (cfg.acces !== "demo") {
    $("va-membre").type = "password";
    $("va-membre-lib").firstChild.textContent = "Jeton de session (développement ; fourni par la plateforme en production) ";
  }
  chargerEtat();
})();
