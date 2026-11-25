/* Page de l'acquéreur du module Data Room (acheteur.html, décisions de Géry du 24/11/2026).

   Page simple façon marketplace, pour un compte invité (rôle « invite » du module) ; l'équipe n'y fait rien : la coquille
   la renvoie vers dataroom.html, où se trouve l'aperçu « Voir comme cet acheteur ».
   - Grille des projets (dr_marche, sql/09_marche.sql) : une carte par salle ouverte où l'organisation du compte participe
     (badge « Vos projets ») et une carte par fiche vitrine publiée hors de ses salles (découverte). Filtres légers
     (technologie, stade, mot-clé, vos projets seulement), dans la page, sur ce que la base a rendu.
   - Fiche d'un projet où l'on participe : bandeau (étape atteinte, fin d'accès), clause à accepter d'abord
     (dr_accepter_nda ; son texte est lu par dr_mes_salles), puis tous les documents publiés de la salle, groupés par
     dossier (dr_fiche_documents) : ceux qui sont ouverts se consultent ou se téléchargent par le même chemin que l'écran
     de l'acquéreur de dataroom.js (dr_autoriser, fonction serveur « fichiers », visionneuse.js avec filigrane, dr_plage,
     dr_suivre) ; les autres sont grisés, avec un cadenas et l'étape à laquelle ils s'ouvriront, et AUCUN appel
     d'ouverture. Puis « Interroger Claude sur ce projet » (fonction serveur « assistant ») si l'équipe l'a activé.
   - Fiche de découverte : informations publiques (dr_vitrine_fiche), aucun document, « Demander l'accès »
     (dr_vitrine_demander).
   La base revérifie tout à chaque appel (conditions 1 à 4, étape, droits par dossier, dossiers réservés) et refuse
   toujours de la même façon (42501 « accès refusé ») ; la page n'affiche que ce qu'elle a reçu. Tout texte venu de la
   base passe par textContent ou setAttribute ; aucun script extérieur ni en ligne. */
(async () => {
  "use strict";
  let P;
  try { P = await window.plateforme.pret; } catch { return; }   // refus ou erreur : la coquille l'a déjà affiché
  const $ = id => document.getElementById(id);
  $("ach").hidden = false;
  const sb = P.sb, conf = window.plateforme.conf;

  // ------------------------------------------------------------------ petits outils (les mêmes que dataroom.js)
  const el = (balise, classe, texte) => {
    const n = document.createElement(balise);
    if (classe) n.className = classe;
    if (texte != null) n.textContent = String(texte);
    return n;
  };
  const bouton = (texte, action, classe = "btn small", etiquette = "") => {
    const b = el("button", classe, texte);
    b.type = "button";
    if (etiquette) b.setAttribute("aria-label", etiquette);
    b.addEventListener("click", action);
    return b;
  };
  const JOUR = new Intl.DateTimeFormat("fr-FR", {dateStyle: "short"});
  const NOMBRE = new Intl.NumberFormat("fr-FR", {maximumFractionDigits: 1});
  const TRI = new Intl.Collator("fr", {numeric: true, sensitivity: "base"});
  const jourDe = d => d ? JOUR.format(new Date(d)) : "";
  const taille = o => o == null ? "" : o < 1024 ? `${o} o` : o < 1048576 ? `${NOMBRE.format(o / 1024)} Ko`
    : o < 1073741824 ? `${NOMBRE.format(o / 1048576)} Mo` : `${NOMBRE.format(o / 1073741824)} Go`;
  const sansAccents = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const ecrire = (n, texte, classe = "") => { n.className = "dr-msg" + (classe ? " " + classe : ""); n.textContent = texte || ""; };
  const annoncer = t => { const a = $("ach-annonce"); a.textContent = ""; setTimeout(() => { a.textContent = t; }, 60); };
  const msg = (t, erreur = false) => ecrire($("ach-msg"), t, erreur ? "erreur" : "");
  const appel = async (fonction, args) => {
    try { return await sb.rpc(fonction, args); } catch (x) { return {data: null, error: x}; }
  };
  // jamais le texte brut de la base ou du navigateur (souvent en anglais, parfois technique) : une phrase en français
  const messageBase = e => {
    if (!e) return "";
    const m = String(e.message || e), code = String(e.code || "");
    if (["PGRST202", "42883"].includes(code)) return "service pas encore disponible, réessayez plus tard";
    if (/^PGRST3/.test(code) || /jwt/i.test(m)) return "session expirée : reconnectez-vous";
    if (!code && /fetch|network|load failed/i.test(m)) return "pas de réponse du serveur (connexion coupée ?), réessayez";
    return "le serveur n'a pas pu répondre pour le moment, réessayez";
  };
  const REFUS = "Accès à ce projet fermé ou suspendu. Rapprochez-vous de votre contact chez Almavision.";
  const refus = e => e && e.code === "42501" ? REFUS : `Lecture impossible : ${messageBase(e)}.`;

  // page réservée aux acquéreurs : l'équipe voit ce qu'un acquéreur voit par l'aperçu de dataroom.html (aucun appel ici)
  // (la coquille renvoie déjà un membre vers dataroom.html ; ici, quand elle n'a pas pu le reconnaître)
  if (!P.module || P.module.role !== "invite") {
    $("ach-marche").hidden = true;
    $("ach-entete").hidden = true;
    const m = $("ach-msg");
    m.className = "dr-msg";
    m.textContent = "Page réservée aux acquéreurs. L'équipe Almavision voit ce qu'un acquéreur voit par « Voir comme cet acheteur », dans la ";
    const lien = el("a", null, "page Data Room");
    lien.setAttribute("href", "dataroom.html");
    m.append(lien, ".");
    return;
  }

  // ------------------------------------------------------------------ libellés
  const TECHNOS = {pv_sol: "Photovoltaïque au sol", pv_toiture: "Photovoltaïque en toiture", pv_ombriere: "Ombrières",
                   agrivoltaisme: "Agrivoltaïsme", portefeuille_pv: "Portefeuille photovoltaïque", eolien: "Éolien",
                   stockage: "Stockage", hybride: "Hybride"};
  const STADES = {developpement: "Développement", pret_a_construire: "Prêt à construire", construction: "Construction",
                  exploitation: "En exploitation"};
  const TYPES = {developpement: "Développement", exploitation: "En exploitation", portefeuille: "Portefeuille"};
  const ETAPES = ["Teaser et mémo d'information", "Offre indicative", "Offre ferme et due diligence", "Confirmatoire"];
  const etapeTexte = n => n == null ? "" : ETAPES[n] ? `étape ${n} · ${ETAPES[n]}` : `étape ${n}`;
  // après « Étape atteinte : » (sans répéter le mot)
  const etapeAtteinte = n => n == null ? "" : `Étape atteinte : ${n}${ETAPES[n] ? ` · ${ETAPES[n]}` : ""}`;
  const techno = p => p.technologie ? TECHNOS[p.technologie] || p.technologie : "";
  const stade = p => p.stade ? STADES[p.stade] || p.stade : "";
  // puissance : MWc sur une fiche vitrine, MW pour une salle sans fiche (mêmes unités que dataroom.js)
  const puissance = p => p.puissance_mw == null || p.puissance_mw === "" ? ""
    : `${NOMBRE.format(Number(p.puissance_mw))} ${p.fiche_id ? "MWc" : "MW"}`;
  const consultable = mime => /^(application\/pdf|image\/)/.test(mime || "");

  // ------------------------------------------------------------------ dessins (même illustration que dataroom.js)
  // ILLUSTRATION générée dans la page (SVG), jamais une photo du projet ; rien venu de la base n'y entre autrement que
  // par setAttribute ou textContent. Graine : la fiche vitrine si elle existe (même dessin que la Marketplace de
  // dataroom.js), sinon le code de la salle (même dessin que « Mes opérations »).
  const NS = "http://www.w3.org/2000/svg";
  const ILLUSTRATIONS = {sol: "exploitation", toiture: "portefeuille", ombriere: "exploitation", agrivoltaisme: "exploitation",
                         eolien: "developpement", stockage: "developpement"};
  function graine(texte) { let h = 2166136261; for (const c of String(texte || "")) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function forme(nom, attributs) { const n = document.createElementNS(NS, nom); for (const [k, v] of Object.entries(attributs)) n.setAttribute(k, String(v)); return n; }
  const typeDessin = p => p.illustration ? ILLUSTRATIONS[p.illustration] || "exploitation"
    : TYPES[p.type_actif] ? p.type_actif : p.stade === "developpement" ? "developpement" : "exploitation";
  function visuel(p, classe) {
    const type = typeDessin(p), g = graine(p.fiche_id || p.code || p.salle_id), alea = i => ((g >>> (i * 3)) & 7) / 7;
    const ciels = [["#DCE8EE", "#B9D3DD"], ["#E8EEDF", "#CFE0C4"], ["#EEE6DA", "#DDCBB2"], ["#E1E6F2", "#C3CDE6"]];
    const [ciel, horizon] = ciels[g % ciels.length];
    const cadre = el("figure", "dr-visuel " + (classe || ""));
    const svg = forme("svg", {viewBox: "0 0 320 180", role: "img", focusable: "false",
      "aria-label": `Illustration, pas une photo du projet : ${techno(p) || TYPES[type] || "projet"}`});
    const titre = document.createElementNS(NS, "title");
    titre.textContent = "Illustration générée (pas une photo du projet)";
    svg.appendChild(titre);
    svg.appendChild(forme("rect", {x: 0, y: 0, width: 320, height: 180, fill: ciel}));
    svg.appendChild(forme("rect", {x: 0, y: 105, width: 320, height: 75, fill: horizon}));
    svg.appendChild(forme("circle", {cx: 60 + Math.round(alea(1) * 200), cy: 38 + Math.round(alea(2) * 18), r: 16, fill: "#F2C14E", opacity: 0.9}));
    svg.appendChild(forme("path", {d: `M0 108 Q ${80 + alea(3) * 60} ${78 + alea(4) * 14} 170 104 T 320 ${96 + alea(5) * 10} V 112 H 0 Z`,
                                   fill: "#9FC4BB", opacity: 0.7}));
    const panneau = (x, y, l, h, plein) => forme("polygon", {
      points: `${x},${y} ${x + l},${y} ${x + l + 6},${y + h} ${x + 6},${y + h}`,
      fill: plein ? "#24413C" : "none", stroke: plein ? "#64879A" : "#0B4740", "stroke-width": plein ? 1 : 1.4,
      "stroke-dasharray": plein ? "none" : "4 3"});
    if (type === "portefeuille") {
      for (let i = 0; i < 3; i++) {
        const x = 30 + i * 95, y = 92 + Math.round(alea(i + 6) * 10);
        svg.appendChild(forme("rect", {x, y: y + 24, width: 76, height: 50, fill: "#F3F6F8", stroke: "#7D8E91"}));
        svg.appendChild(forme("polygon", {points: `${x - 6},${y + 26} ${x + 38},${y} ${x + 82},${y + 26}`, fill: "#46595A"}));
        for (let k = 0; k < 3; k++) svg.appendChild(panneau(x + 6 + k * 22, y + 8, 16, 10, true));
      }
    } else {
      const plein = type !== "developpement", rangs = 3 + (g % 2);
      for (let r = 0; r < rangs; r++) {
        for (let c = 0; c < 6; c++) svg.appendChild(panneau(22 + c * 48 + r * 6, 118 + r * 15, 38, 10, plein));
      }
      if (!plein) for (const x of [24, 300]) svg.appendChild(forme("line", {x1: x, y1: 112, x2: x, y2: 172, stroke: "#E8613A", "stroke-width": 2}));
    }
    for (let i = 0; i < 4; i++) {
      const cx = 270 + (i % 2) * 18, cy = 20 + i * 14, r = 9;
      svg.appendChild(forme("polygon", {points: [0, 1, 2, 3, 4, 5].map(k => `${(cx + r * Math.cos(Math.PI / 3 * k + Math.PI / 6)).toFixed(1)},${
        (cy + r * Math.sin(Math.PI / 3 * k + Math.PI / 6)).toFixed(1)}`).join(" "), fill: "none", stroke: "#00352F", opacity: 0.25}));
    }
    cadre.appendChild(svg);
    cadre.appendChild(el("figcaption", "dr-visuel-mention", "Illustration"));
    return cadre;
  }
  // cadenas dessiné, décoratif : la raison est dite en toutes lettres à côté
  function cadenas() {
    const svg = forme("svg", {viewBox: "0 0 16 16", width: 14, height: 14, class: "ach-cadenas", "aria-hidden": "true", focusable: "false"});
    svg.appendChild(forme("rect", {x: 3, y: 7, width: 10, height: 8, rx: 1.5, fill: "currentColor"}));
    svg.appendChild(forme("path", {d: "M5 7V5a3 3 0 0 1 6 0v2", fill: "none", stroke: "currentColor", "stroke-width": 1.6}));
    return svg;
  }

  // ------------------------------------------------------------------ état
  const ach = {projets: [], choisi: null, conversation: null};

  // ------------------------------------------------------------------ marketplace (dr_marche)
  function remplirChoix(select, valeurs, libelles) {
    const avant = select.value;
    while (select.children.length > 1) select.removeChild(select.children[select.children.length - 1]);
    for (const v of [...valeurs].sort((a, b) => TRI.compare(libelles[a] || a, libelles[b] || b))) {
      const o = el("option", null, libelles[v] || v);
      o.value = v;
      select.appendChild(o);
    }
    select.value = valeurs.has(avant) ? avant : "";
  }
  const filtres = () => ({techno: $("ach-f-techno").value, stade: $("ach-f-stade").value,
                          texte: sansAccents($("ach-f-texte").value.trim()), miens: $("ach-f-miens").checked});
  const retenu = (p, f) => (!f.techno || p.technologie === f.techno) && (!f.stade || p.stade === f.stade) &&
    (!f.miens || p.participe === true) &&
    (!f.texte || sansAccents([p.nom_de_code, p.code, p.zone, p.resume, techno(p), stade(p)].filter(Boolean).join(" ")).includes(f.texte));

  async function chargerMarche() {
    ecrire($("ach-compte"), "Lecture des projets…", "calme");
    const {data, error} = await appel("dr_marche", {});
    if (error) {
      ach.projets = [];
      $("ach-grille").textContent = "";
      ecrire($("ach-compte"), error.code === "42501" ? "Espace réservé aux acquéreurs invités par Almavision."
        : `Lecture impossible : ${messageBase(error)}.`, "erreur");
      return false;
    }
    ach.projets = (Array.isArray(data) ? data : []).filter(p => p && p.cle)
      .sort((a, b) => (b.participe === true) - (a.participe === true) || TRI.compare(a.nom_de_code || "", b.nom_de_code || ""));
    remplirChoix($("ach-f-techno"), new Set(ach.projets.map(p => p.technologie).filter(Boolean)), TECHNOS);
    remplirChoix($("ach-f-stade"), new Set(ach.projets.map(p => p.stade).filter(Boolean)), STADES);
    afficherGrille();
    return true;
  }

  function afficherGrille() {
    const ul = $("ach-grille"), f = filtres();
    ul.textContent = "";
    const liste = ach.projets.filter(p => retenu(p, f));
    const filtre = f.techno || f.stade || f.texte || f.miens;
    const miens = ach.projets.filter(p => p.participe === true).length;
    ecrire($("ach-compte"), !ach.projets.length ? "Aucun projet proposé pour le moment."
      : !liste.length ? "Aucun projet ne correspond à ces critères."
      : `${liste.length} projet${liste.length > 1 ? "s" : ""}${filtre ? ` sur ${ach.projets.length}` : ""}` +
        (miens ? ` · ${miens} ouvert${miens > 1 ? "s" : ""} pour vous` : ""), "calme");
    for (const p of liste) {
      const li = el("li", "ach-carte" + (p.participe ? " miens" : ""));
      li.appendChild(visuel(p, "petit"));
      if (p.participe) li.appendChild(el("span", "ach-badge", "Vos projets"));
      li.appendChild(el("h3", "ach-carte-nom", p.nom_de_code || "Projet"));
      const infos = [techno(p), puissance(p), p.zone, stade(p)].filter(Boolean);
      if (infos.length) li.appendChild(el("p", "ach-carte-infos", infos.join(" · ")));
      if (p.participe) {
        const etat = [etapeAtteinte(p.etape),
                      p.nda_a_accepter ? "clause à accepter" : ""].filter(Boolean);
        if (etat.length) li.appendChild(el("p", "ach-carte-etat", etat.join(" · ")));
      }
      if (p.resume) li.appendChild(el("p", "ach-carte-extrait", p.resume.length > 140 ? p.resume.slice(0, 140) + "…" : p.resume));
      const b = bouton("Voir la fiche", () => ouvrirProjet(p.cle), "btn small ach-carte-voir",
                       `Voir la fiche du projet ${p.nom_de_code || ""}`.trim());
      b.dataset.cle = p.cle;
      li.appendChild(b);
      // toute la carte s'ouvre à la souris ; au clavier, le bouton suffit (un seul arrêt de tabulation par carte)
      li.addEventListener("click", ev => { if (!b.contains(ev.target)) ouvrirProjet(p.cle); });
      ul.appendChild(li);
    }
  }

  function montrerGrille() {
    visionneuse.fermer();
    ach.choisi = null; ach.conversation = null;
    $("ach-fiche").hidden = true;
    $("ach-marche").hidden = false;
    msg("");
  }

  // ------------------------------------------------------------------ fiche produit
  function entete(p, f) {
    const place = $("ach-fiche-visuel");
    place.textContent = "";
    place.appendChild(visuel(p, "grand"));
    const badge = $("ach-fiche-badge");
    badge.textContent = "";
    if (p.participe) badge.appendChild(el("span", "ach-badge", "Vos projets"));
    $("ach-fiche-titre").textContent = p.nom_de_code || "Projet";
    const dl = $("ach-fiche-infos");
    dl.textContent = "";
    const lignes = [["Technologie", techno(p)], ["Stade", stade(p)], ["Puissance", puissance(p)], ["Zone", p.zone],
                    ["Type d'actif", p.type_actif && !p.technologie ? TYPES[p.type_actif] || p.type_actif : ""]];
    if (f && f.annee_mise_en_service) lignes.push(["Mise en service", String(f.annee_mise_en_service)]);
    if (p.participe && p.code) lignes.push(["Référence", p.code]);
    for (const [t, v] of lignes) if (v) dl.append(el("dt", null, t), el("dd", null, v));
    $("ach-fiche-resume").textContent = (f && f.resume) || p.resume || "";
    const pts = $("ach-fiche-points");
    pts.textContent = "";
    for (const x of f && Array.isArray(f.points_cles) ? f.points_cles : []) pts.appendChild(el("li", null, String(x)));
  }

  async function ouvrirProjet(cle) {
    const p = ach.projets.find(x => x.cle === cle);
    if (!p) return;
    visionneuse.fermer();
    ach.choisi = p; ach.conversation = null;
    msg("");
    $("ach-fil").textContent = ""; ecrire($("ach-q-msg"), ""); $("ach-question").value = "";
    $("ach-docs").textContent = ""; ecrire($("ach-docs-msg"), ""); ecrire($("ach-nda-msg"), ""); ecrire($("ach-d-msg"), "");
    $("ach-projet").hidden = true; $("ach-decouverte").hidden = true;
    // la carte « Interroger la data room » est en tête de fiche, hors de #ach-projet : cachée tant que rien ne l'autorise
    $("ach-assistant").hidden = true; $("ach-assistant-absent").hidden = true;
    // informations publiques de la fiche vitrine (résumé, points clés, mise en service) : facultatives pour un projet où
    // l'on participe (dr_marche ne rend fiche_id que pour une fiche publiée ; si elle vient d'être retirée, on garde ce
    // que dr_marche a rendu)
    let f = null;
    if (p.fiche_id) {
      const r = await appel("dr_vitrine_fiche", {p_id: p.fiche_id});
      if (ach.choisi !== p) return;   // une autre fiche a été ouverte entre-temps
      if (!r.error && r.data) f = r.data;
      else if (!p.participe) {
        await chargerMarche();
        montrerGrille();
        msg(r.error && r.error.code === "P0002" ? "Ce projet n'est plus proposé." : `Lecture impossible : ${messageBase(r.error)}.`, true);
        return;
      }
    }
    entete(p, f);
    $("ach-marche").hidden = true;
    $("ach-fiche").hidden = false;
    $("ach-fiche-titre").focus();
    annoncer(`Fiche du projet ${p.nom_de_code || ""}.`);
    if (p.participe) await projetOuvert(p);
    else decouverte(f);
  }

  // ---------------- projet où l'organisation participe
  async function projetOuvert(p) {
    $("ach-projet").hidden = false;
    $("ach-bandeau").textContent = [etapeAtteinte(p.etape),
                                    p.fin ? `accès jusqu'au ${jourDe(p.fin)}` : ""].filter(Boolean).join(" · ");
    $("ach-docs-carte").hidden = true; $("ach-assistant").hidden = true; $("ach-assistant-absent").hidden = true;
    if (p.nda_a_accepter) { await montrerClause(p); return; }
    $("ach-nda").hidden = true;
    $("ach-assistant").hidden = !p.assistant_actif;
    $("ach-assistant-absent").hidden = !!p.assistant_actif;
    await chargerDocuments(p);
  }

  // texte de la clause : dr_mes_salles (la fonction de l'écran de l'acquéreur de dataroom.js, qui rend la clause en cours)
  async function montrerClause(p) {
    $("ach-nda").hidden = false;
    $("ach-nda-ok").checked = false;
    $("ach-nda-go").disabled = true;
    const zone = $("ach-nda-texte");
    zone.textContent = "Lecture de la clause…";
    const {data, error} = await appel("dr_mes_salles", {});
    if (ach.choisi !== p) return;
    const s = !error && Array.isArray(data) ? data.find(x => x && x.salle_id === p.salle_id) : null;
    if (!s) {
      zone.textContent = "";
      ecrire($("ach-nda-msg"), error ? refus(error) : REFUS, "erreur");
      return;
    }
    zone.textContent = s.nda_texte || "";
    $("ach-nda-go").disabled = false;
  }

  async function accepterClause() {
    const p = ach.choisi;
    if (!p || !p.participe) return;
    if (!$("ach-nda-ok").checked) { ecrire($("ach-nda-msg"), "Cochez la case pour accepter la clause.", "erreur"); return; }
    $("ach-nda-go").disabled = true;
    const {error} = await appel("dr_accepter_nda", {p_salle: p.salle_id});
    $("ach-nda-go").disabled = false;
    if (error) { ecrire($("ach-nda-msg"), refus(error), "erreur"); return; }
    annoncer("Clause acceptée.");
    // projets relus (la clause n'est plus à accepter), puis la même fiche
    if (!await chargerMarche()) { montrerGrille(); return; }
    if (!ach.projets.some(x => x.cle === p.cle)) { montrerGrille(); msg(REFUS, true); return; }
    await ouvrirProjet(p.cle);
  }

  // documents de la salle (dr_fiche_documents) : tous les fichiers publiés que l'organisation peut voir, ouverts ou non ;
  // un document fermé n'a aucun bouton (aucun appel d'ouverture possible depuis la page)
  async function chargerDocuments(p) {
    const carte = $("ach-docs-carte"), zone = $("ach-docs"), m = $("ach-docs-msg");
    carte.hidden = false;
    ecrire(m, "Lecture des documents…");
    const {data, error} = await appel("dr_fiche_documents", {p_salle: p.salle_id});
    if (ach.choisi !== p) return;
    zone.textContent = "";
    if (error) {
      ecrire(m, refus(error), "erreur");
      $("ach-assistant").hidden = true; $("ach-assistant-absent").hidden = true;
      return;
    }
    const docs = (Array.isArray(data) ? data : []).filter(d => d && d.element_id);
    if (!docs.length) { ecrire(m, "Aucun document publié dans ce projet pour le moment."); return; }
    const ouverts = docs.filter(d => d.accessible === true).length;
    ecrire(m, `${ouverts} document${ouverts > 1 ? "s" : ""} ouvert${ouverts > 1 ? "s" : ""} pour vous sur ${docs.length}.`);
    const parDossier = new Map();
    for (const d of docs) { const k = d.dossier || "Documents"; if (!parDossier.has(k)) parDossier.set(k, []); parDossier.get(k).push(d); }
    for (const [dossier, liste] of [...parDossier].sort((a, b) => TRI.compare(a[0], b[0]))) {
      const bloc = el("section", "ach-dossier");
      const h = el("h4", null, dossier);
      bloc.appendChild(h);
      const ul = el("ul", "ach-liste");
      for (const d of liste.sort((a, b) => TRI.compare(a.nom || "", b.nom || ""))) ul.appendChild(ligneDocument(p, d));
      bloc.appendChild(ul);
      zone.appendChild(bloc);
    }
  }

  function ligneDocument(p, d) {
    const ouvert = d.accessible === true;
    const li = el("li", "ach-doc" + (ouvert ? "" : " ferme"));
    if (!ouvert) li.appendChild(cadenas());
    li.appendChild(el("span", "ach-doc-nom", d.nom));
    if (d.taille != null) li.appendChild(el("span", "dr-taille", taille(Number(d.taille))));
    if (d.publie_le) li.appendChild(el("span", "dr-lieu", `publié le ${jourDe(d.publie_le)}`));
    if (!ouvert) {
      // étape future d'un fichier ni PDF ni image sans le niveau « télécharger » : il restera fermé à cette étape
      const pasEncore = d.etape != null && p.etape != null && Number(d.etape) > Number(p.etape);
      const sansFormat = !consultable(d.mime) && d.telecharger !== true;
      const raison = pasEncore ? `Accessible à l'${etapeTexte(Number(d.etape))}` +
          (sansFormat ? ", avec le droit de téléchargement (format non affichable dans la plateforme)" : "")
        : "Téléchargement non autorisé (format non affichable dans la plateforme)";
      li.appendChild(el("span", "ach-raison", raison));
      return li;
    }
    const actions = el("span", "dr-doc-actions"), msgDoc = el("span", "dr-doc-msg");
    msgDoc.setAttribute("role", "status");
    const dire = t => { msgDoc.textContent = t; };
    if (consultable(d.mime)) {
      actions.appendChild(bouton("Consulter", () => ouvrirDocument(d.element_id, "consulter", dire), "btn small",
                                 `Consulter « ${d.nom} »`));
    }
    // « Télécharger » toujours montré sur un document ouvert : actif avec le niveau « télécharger » du dossier, sinon grisé
    // avec sa raison (le serveur refuse de toute façon un téléchargement non autorisé : dr_autoriser)
    if (d.telecharger === true) {
      actions.appendChild(bouton("Télécharger", () => ouvrirDocument(d.element_id, "telecharger", dire), "btn small",
                                 `Télécharger « ${d.nom} »`));
    } else {
      const b = bouton("Télécharger", () => {}, "btn small", `Télécharger « ${d.nom} » : non autorisé pour ce dossier`);
      b.disabled = true;
      b.title = "Téléchargement non autorisé pour ce dossier : demandez-le à l'équipe Almavision";
      actions.appendChild(b);
    }
    li.append(actions, msgDoc);
    return li;
  }

  // ouverture : le même chemin que dataroom.js (dr_autoriser, puis la visionneuse par la fonction serveur « fichiers »)
  const jetonActuel = async () => {
    try { const {data} = await sb.auth.getSession(); if (data && data.session) return data.session.access_token; } catch {}
    return P.session.access_token;
  };
  const visionneuse = window.drVisionneuse({
    conf, jeton: jetonActuel, enregistrer: P.telecharger,
    suivre: (c, n) => { appel("dr_suivre", {p_consultation: c, p_pages: n}); },
  });
  if (P.surArret) P.surArret(() => visionneuse.fermer());
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

  // ---------------- assistant (fonction serveur « assistant », même appel que l'écran de l'acquéreur de dataroom.js)
  async function poserQuestion(ev) {
    ev.preventDefault();
    const p = ach.choisi, m = $("ach-q-msg"), question = $("ach-question").value.trim();
    if (!p || !p.participe || !p.assistant_actif || p.nda_a_accepter) return;
    if (question.length < 2) { ecrire(m, "Tapez une question.", "erreur"); return; }
    $("ach-q-go").disabled = true;
    ecrire(m, "L'assistant cherche dans les documents et rédige sa réponse…");
    const jeton = await jetonActuel();
    const arret = new AbortController(), minuterie = setTimeout(() => arret.abort(), 150000);
    let rep, corps = null;
    try {
      rep = await fetch(`${conf.url}/functions/v1/assistant`, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal: arret.signal,
        headers: {"Authorization": `Bearer ${jeton}`, "apikey": conf.cle, "Content-Type": "application/json"},
        body: JSON.stringify({salle: p.salle_id, etape: 0, question, conversation: ach.conversation}),
      });
      try { corps = await rep.json(); } catch { corps = null; }
    } catch {
      ecrire(m, "Pas de réponse du serveur : réessayez dans un moment.", "erreur");
      $("ach-q-go").disabled = false;
      return;
    } finally { clearTimeout(minuterie); }
    $("ach-q-go").disabled = false;
    if (ach.choisi !== p) return;
    // codes de la fonction serveur (supabase/functions/assistant/index.ts) : 403 assistant coupé par l'équipe (DRA01),
    // 429 plafond du jour (DRJ01) ou du mois (DRM01), 401 accès fermé, 502 Claude indisponible
    if (!rep.ok || !corps || typeof corps.reponse !== "string") {
      const erreur = corps && typeof corps.erreur === "string" ? corps.erreur : "";
      if (rep.status === 403) {
        p.assistant_actif = false;
        $("ach-assistant").hidden = true;
        $("ach-assistant-absent").hidden = false;
        annoncer("Assistant pas activé pour ce projet.");
        return;
      }
      ecrire(m, rep.status === 429 && /mois/i.test(erreur)
          ? "Assistant momentanément indisponible pour ce projet (plafond atteint) : l'équipe Almavision est prévenue."
        : rep.status === 429 ? "Nombre de questions du jour atteint : reprenez demain."
        : rep.status === 401 ? "Accès à l'assistant fermé pour ce projet."
        : rep.status === 502 ? "Assistant indisponible pour le moment : réessayez plus tard."
        : "L'assistant n'a pas pu répondre : réessayez.", "erreur");
      return;
    }
    ach.conversation = corps.conversation;
    $("ach-question").value = "";
    const li = el("li", "dr-echange");
    li.appendChild(el("p", "dr-q", question));
    li.appendChild(el("p", "dr-r", corps.reponse));
    const cits = Array.isArray(corps.citations) ? corps.citations : [];
    if (cits.length) {
      const ul = el("ul", "dr-citations");
      for (const c of cits) {
        const ou = c.feuille ? `feuille « ${c.feuille} »` : c.page != null ? `page ${c.page}` : "";
        ul.appendChild(el("li", null, `[${c.n}] ${c.nom}${ou ? `, ${ou}` : ""}`));
      }
      li.appendChild(ul);
    }
    $("ach-fil").appendChild(li);
    ecrire(m, "");
    annoncer("Réponse de l'assistant reçue.");
  }

  // ---------------- fiche de découverte : informations publiques seulement, aucun document
  function decouverte(f) {
    $("ach-decouverte").hidden = false;
    etatDemande(f ? f.ma_demande : null);
  }
  function etatDemande(statut) {
    const deja = statut === "en_attente";
    $("ach-demander").disabled = deja || !(ach.choisi && ach.choisi.fiche_id);
    $("ach-message").disabled = deja;
    ecrire($("ach-d-msg"), deja ? "Votre demande d'accès est enregistrée ; l'équipe Almavision vous recontactera. Aucun accès n'est ouvert automatiquement."
      : statut === "traitee" ? "Votre précédente demande a été traitée par l'équipe Almavision."
      : statut === "refusee" ? "Votre précédente demande n'a pas été retenue ; vous pouvez en faire une nouvelle." : "");
  }
  async function demanderAcces(ev) {
    ev.preventDefault();
    const p = ach.choisi;
    if (!p || p.participe || !p.fiche_id) return;
    $("ach-demander").disabled = true;
    const {data, error} = await appel("dr_vitrine_demander", {p_id: p.fiche_id, p_message: $("ach-message").value.trim()});
    if (error) {
      $("ach-demander").disabled = false;
      ecrire($("ach-d-msg"), error.code === "P0002" ? "Ce projet n'est plus proposé." : error.code === "54000"
        ? "Trop de demandes aujourd'hui : réessayez demain." : `Demande non enregistrée : ${messageBase(error)}.`, "erreur");
      return;
    }
    $("ach-message").value = "";
    etatDemande(data && data.statut);
    annoncer(data && data.deja ? "Demande déjà enregistrée." : "Demande d'accès enregistrée.");
  }

  // ------------------------------------------------------------------ démarrage
  $("ach-filtres").addEventListener("submit", ev => { ev.preventDefault(); afficherGrille(); });
  for (const id of ["ach-f-techno", "ach-f-stade", "ach-f-miens"]) $(id).addEventListener("change", afficherGrille);
  $("ach-f-texte").addEventListener("input", afficherGrille);
  $("ach-f-effacer").addEventListener("click", () => {
    $("ach-f-techno").value = ""; $("ach-f-stade").value = ""; $("ach-f-texte").value = ""; $("ach-f-miens").checked = false;
    afficherGrille();
  });
  $("ach-retour").addEventListener("click", () => {
    const cle = ach.choisi && ach.choisi.cle;
    montrerGrille();
    // le focus revient sur la carte du projet quitté
    const b = cle ? [...$("ach-grille").querySelectorAll("button")].find(x => x.dataset.cle === cle) : null;
    if (b) b.focus();
  });
  $("ach-nda-go").addEventListener("click", accepterClause);
  $("ach-form-question").addEventListener("submit", poserQuestion);
  $("ach-nouvelle").addEventListener("click", () => { ach.conversation = null; $("ach-fil").textContent = "";
                                                      ecrire($("ach-q-msg"), "Nouvelle conversation."); });
  $("ach-form-demande").addEventListener("submit", demanderAcces);
  await chargerMarche();
})();
