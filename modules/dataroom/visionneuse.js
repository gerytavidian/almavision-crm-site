/* Visionneuse de la Data Room (lot b, docs/DATAROOM_PLAN.md §6 et annexe « Visionneuse »).

   window.drVisionneuse(options) rend {consulter(autorisation), telecharger(autorisation, dire), fermer()} ; options :
     conf          {url, cle} du projet Supabase (configuration de la page)
     jeton()       jeton de la personne (promesse), relu à chaque plage (il se renouvelle)
     suivre(c, n)  note les pages vues (dr_suivre), facultatif
     enregistrer(nom, blob)   enregistre un fichier sur l'ordinateur (P.telecharger de la coquille)
     pdfjs()       chargement de pdf.js (par défaut : import() de vendor/pdf.min.mjs, version épinglée par site.py)
     lecteurPdf()  chargement du lecteur de PDF.js (composant officiel PDFViewer de Mozilla ; par défaut :
                   vendor/pdf_viewer.css puis import() de vendor/pdf_viewer.mjs, épinglés par site.py comme pdf.js)
   « autorisation » : ce que rend dr_autoriser (consultation, taille, nom, mime, action, plage_max, filigrane).

   Chaque octet passe par la fonction serveur « fichiers », plage par plage : GET …/functions/v1/fichiers?c=<consultation>,
   jeton dans l'en-tête Authorization (jamais dans l'adresse), Range: bytes=début-fin, sans cookie ni cache, aucune
   redirection suivie. La base revérifie tout à chaque plage : une révocation coupe la lecture tout de suite.
   - PDF : pdf.js lit par morceaux de 512 Ko ce dont les pages affichées ont besoin (PDFDataRangeTransport, pas de lecture
     à l'avance) ; le lecteur PDFViewer de PDF.js (défilement continu, zoom, recherche) les affiche, avec une barre
     d'outils maison (pages, zoom, largeur, page entière, recherche, plein écran, fermer). Chaque page est dessinée dans
     un canevas, puis le filigrane (email et date, en diagonale) est dessiné dans ce même canevas avant qu'il ne
     s'affiche (événement « pagerendered » ; canevas caché par visionneuse.css tant qu'il n'est pas marqué). Aucune
     annotation : ni lien (ni externe, ni interne), ni formulaire, ni script du document. Le calque de texte sert à la
     recherche ; il n'est pas sélectionnable et la copie est bloquée tant que la visionneuse est ouverte (limite : le
     texte reste lisible par les outils de développement du navigateur ; seul le filigrane suit une capture d'écran).
     La recherche lit le texte de tout le document (toutes ses plages, donc compté dans le plafond de lecture).
     Ni téléchargement ni impression dans le lecteur : window.print est neutralisé pendant l'ouverture et l'impression
     de la page n'en montre rien (visionneuse.css) ; le téléchargement reste le bouton de la liste (contrôlé).
     Journal : chaque page à l'écran (la page courante, et toute page visible au moins à moitié) une fois dessinée.
     Si le lecteur ne se charge pas, l'ancien affichage page par page prend le relais (page dessinée hors de l'écran,
     puis copiée avec le filigrane dans le canevas affiché) ;
   - image : lue par plages de 2 Mo au plus, dessinée dans un canevas avec le filigrane ;
   - téléchargement (niveau « télécharger ») : plages de 16 Mo, réassemblées dans le navigateur, puis enregistrées.
   Rien n'est gardé sur l'appareil : ni cache, ni stockage local ; les octets lus vivent dans la page jusqu'à la
   fermeture de la visionneuse, qui détruit le document, le lecteur et vide les canevas. */
(() => {
  "use strict";
  const MORCEAU = 512 * 1024;
  const PIXELS_MAX = 4096 * 4096;   // canevas d'une page : 16 millions de pixels au plus (mémoire des téléphones)
  const ERREURS = {
    403: "Accès refusé, ou lecture interrompue (droit retiré, document retiré, ou dix minutes sans activité) : fermez et rouvrez le document.",
    410: "Document indisponible pour le moment : l'équipe Almavision est prévenue.",
    416: "Lecture refusée (plage hors du document) : fermez et rouvrez le document.",
    429: "Plafond de lecture atteint pour aujourd'hui : reprenez demain.",
  };
  const SANS_IMPRESSION = "Impression désactivée : les documents de la data room se consultent à l'écran.";
  const SANS_COPIE = "Copie désactivée dans la data room.";

  class ErreurLecture extends Error {
    constructor(statut, message) { super(message); this.statut = statut; this.name = "ErreurLecture"; }
  }

  window.drVisionneuse = function creer(options) {
    const conf = options.conf;
    const $ = id => document.getElementById(id);
    const chargerPdfjs = options.pdfjs || (async () => {
      const lib = await import(new URL("vendor/pdf.min.mjs", document.baseURI).href);
      lib.GlobalWorkerOptions.workerSrc = new URL("vendor/pdf.worker.min.mjs", document.baseURI).href;
      return lib;
    });
    // le lecteur lit globalThis.pdfjsLib, posé par pdf.min.mjs : il se charge donc après pdf.js
    const chargerLecteur = options.lecteurPdf || (async () => {
      await feuille("vendor/pdf_viewer.css");
      return import(new URL("vendor/pdf_viewer.mjs", document.baseURI).href);
    });
    let ouverte = null;   // {doc, tache, autorisation, page, vues: Set, rendues: Set, marques: WeakSet, lecteur, note}
    let gardes = null;    // impression et copie neutralisées pendant l'ouverture
    let retour = null;    // élément qui avait le focus avant l'ouverture
    let outils = null;    // barre d'outils et zone du lecteur, créées à la première ouverture d'un PDF

    function feuille(chemin) {
      const href = new URL(chemin, document.baseURI).href;
      if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return Promise.resolve();
      return new Promise((ok, ko) => {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = href;
        l.onload = () => ok();
        l.onerror = () => { l.remove(); ko(new Error("feuille de style du lecteur introuvable")); };
        document.head.appendChild(l);
      });
    }

    // une plage, par la fonction « fichiers » ; un 409 (fichier changé dans SharePoint pendant la lecture) est redemandé
    // une fois. Rend les octets, ou lève ErreurLecture avec un message pour la personne.
    async function plage(autorisation, debut, fin, essai = 0) {
      let rep;
      try {
        rep = await fetch(`${conf.url}/functions/v1/fichiers?c=${encodeURIComponent(autorisation.consultation)}`, {
          method: "GET", redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
          headers: {"Authorization": `Bearer ${await options.jeton()}`, "apikey": conf.cle, "Range": `bytes=${debut}-${fin}`},
        });
      } catch {
        throw new ErreurLecture(0, "Pas de réponse du serveur : vérifiez la connexion, puis rouvrez le document.");
      }
      if (rep.status === 409 && essai < 1) {
        try { await rep.arrayBuffer(); } catch {}
        await new Promise(ok => setTimeout(ok, 400));
        return plage(autorisation, debut, fin, essai + 1);
      }
      if (rep.status !== 206) {
        try { await rep.arrayBuffer(); } catch {}
        throw new ErreurLecture(rep.status, ERREURS[rep.status] || "Lecture impossible pour le moment : réessayez dans un moment.");
      }
      const octets = new Uint8Array(await rep.arrayBuffer());
      if (octets.byteLength !== fin - debut + 1) throw new ErreurLecture(0, "Lecture incomplète : rouvrez le document.");
      return octets;
    }

    // [debut, fin) en plages de « pas » octets au plus, l'une après l'autre ; progression(lus) après chacune
    async function lire(autorisation, debut, fin, pas, progression) {
      const morceaux = [];
      let lus = 0;
      for (let d = debut; d < fin; d += pas) {
        const o = await plage(autorisation, d, Math.min(d + pas, fin) - 1);
        morceaux.push(o);
        lus += o.byteLength;
        if (progression) progression(lus);
      }
      if (morceaux.length === 1) return morceaux[0];
      const tout = new Uint8Array(lus);
      let i = 0;
      for (const m of morceaux) { tout.set(m, i); i += m.byteLength; }
      return tout;
    }

    // filigrane : email et date, en diagonale, répétés sur toute la surface, dans le canevas lui-même
    function filigrane(ctx, largeur, hauteur, texte) {
      ctx.save();
      if (ctx.setTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#00352F";
      const taille = Math.max(12, Math.round(largeur / 32));
      ctx.font = `600 ${taille}px sans-serif`;
      ctx.translate(largeur / 2, hauteur / 2);
      ctx.rotate(-Math.PI / 6);
      const pasX = taille * (texte.length * 0.62 + 4), pasY = taille * 5;
      const portee = Math.hypot(largeur, hauteur);
      for (let y = -portee; y <= portee; y += pasY) {
        for (let x = -portee; x <= portee; x += pasX) ctx.fillText(texte, x + ((y / pasY) % 2 ? pasX / 2 : 0), y);
      }
      ctx.restore();
    }

    const msg = (t, erreur = false) => { const m = $("dr-vis-msg"); m.textContent = t; m.className = "dr-msg" + (erreur ? " erreur" : ""); };

    // ---------------------------------------------------------------- impression et copie neutralisées pendant l'ouverture
    function garder() {
      if (gardes) return;
      const ac = typeof AbortController === "function" ? new AbortController() : null;
      gardes = {ac, print: null};
      if (typeof window.print === "function") {
        gardes.print = window.print;
        window.print = function sansImpression() { msg(SANS_IMPRESSION, true); };
      }
      if (ac && typeof window.addEventListener === "function") {
        const o = {capture: true, signal: ac.signal};
        // avant les écouteurs de la page et du lecteur (PDFViewer copie tout le texte sur « Tout sélectionner »)
        const bloquer = e => {
          if (outils && e.target === outils.champ) return;   // sa propre recherche reste copiable
          e.preventDefault(); e.stopImmediatePropagation(); msg(SANS_COPIE);
        };
        window.addEventListener("copy", bloquer, o);
        window.addEventListener("cut", bloquer, o);
        window.addEventListener("keydown", e => {
          if ((e.ctrlKey || e.metaKey) && /^[ps]$/i.test(e.key || "")) {
            e.preventDefault(); e.stopImmediatePropagation();
            msg(/^p$/i.test(e.key) ? SANS_IMPRESSION
              : "Le document s'enregistre par le bouton « Télécharger » de la liste, s'il vous est ouvert.");
          }
        }, o);
      }
      if (document.body && document.body.classList) document.body.classList.add("dr-vis-ouverte");
    }

    function relacher() {
      const g = gardes;
      gardes = null;
      if (!g) return;
      if (g.ac) g.ac.abort();
      if (g.print && window.print && window.print.name === "sansImpression") window.print = g.print;
      if (document.body && document.body.classList) document.body.classList.remove("dr-vis-ouverte");
    }

    // ---------------------------------------------------------------- barre d'outils et zone du lecteur (créées une fois)
    function el(tag, attributs = {}, texte = "") {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attributs)) e.setAttribute(k, v);
      if (texte) e.textContent = texte;
      return e;
    }
    function bouton(texte, etiquette, action) {
      const b = el("button", {type: "button", class: "btn small", "aria-label": etiquette, title: etiquette}, texte);
      b.onclick = () => { if (ouverte && ouverte.lecteur) action(ouverte.lecteur); };
      return b;
    }

    function creerOutils() {
      if (outils) return outils;
      const vis = $("dr-vis");
      const barre = el("div", {class: "dr-vis-outils", role: "toolbar", "aria-label": "Outils du document"});
      const prec = bouton("‹", "Page précédente", l => l.viewer.previousPage());
      const suiv = bouton("›", "Page suivante", l => l.viewer.nextPage());
      const page = el("input", {type: "text", inputmode: "numeric", autocomplete: "off", class: "dr-vis-page",
                                id: "dr-vis-page", "aria-label": "Numéro de la page", size: "4"});
      const total = el("span", {class: "dr-vis-total", id: "dr-vis-total"});
      page.onchange = () => {
        const l = ouverte && ouverte.lecteur;
        const n = Number.parseInt(page.value, 10);
        if (!l) return;
        if (Number.isInteger(n) && n >= 1 && n <= l.viewer.pagesCount) l.viewer.currentPageNumber = n;
        else page.value = String(l.viewer.currentPageNumber);
      };
      const moins = bouton("−", "Zoom arrière", l => l.viewer.decreaseScale());
      const echelle = el("span", {class: "dr-vis-echelle", id: "dr-vis-echelle", "aria-live": "polite"});
      const plus = bouton("+", "Zoom avant", l => l.viewer.increaseScale());
      const largeur = bouton("Largeur", "Ajuster à la largeur", l => { l.viewer.currentScaleValue = "page-width"; });
      const entiere = bouton("Page entière", "Afficher la page entière", l => { l.viewer.currentScaleValue = "page-fit"; });
      const champ = el("input", {type: "search", class: "dr-vis-cherche", id: "dr-vis-cherche", autocomplete: "off",
                                 placeholder: "Rechercher dans le document", "aria-label": "Rechercher dans le document",
                                 title: "La recherche lit le texte de tout le document (Entrée : suivant, Maj+Entrée : précédent)"});
      const avant = bouton("Précédent", "Résultat précédent", l => chercher(l, "again", true));
      const apres = bouton("Suivant", "Résultat suivant", l => chercher(l, "again", false));
      const resultats = el("span", {class: "dr-vis-resultats", id: "dr-vis-resultats", role: "status", "aria-live": "polite"});
      champ.oninput = () => { if (ouverte && ouverte.lecteur) chercher(ouverte.lecteur, "", false); };
      champ.onkeydown = e => {
        if (e.key === "Enter") { e.preventDefault(); if (ouverte && ouverte.lecteur) chercher(ouverte.lecteur, "again", !!e.shiftKey); }
      };
      const ecran = el("button", {type: "button", class: "btn small", "aria-pressed": "false", title: "Plein écran"}, "Plein écran");
      ecran.onclick = () => basculerPleinEcran();
      const groupe = (etiquette, ...enfants) => {
        const g = el("span", {class: "dr-vis-groupe", role: "group", "aria-label": etiquette});
        for (const x of enfants) g.appendChild(x);
        return g;
      };
      barre.appendChild(groupe("Pages", prec, page, total, suiv));
      barre.appendChild(groupe("Zoom", moins, echelle, plus, largeur, entiere));
      barre.appendChild(groupe("Recherche", champ, avant, apres, resultats));
      barre.appendChild(groupe("Affichage", ecran));
      barre.hidden = true;
      const zone = el("div", {class: "dr-vis-pdf", id: "dr-vis-pdf"});
      zone.hidden = true;
      vis.insertBefore(barre, $("dr-vis-msg"));
      vis.insertBefore(zone, $("dr-vis-zone"));
      if (typeof document.addEventListener === "function") {
        document.addEventListener("fullscreenchange", () => {
          const plein = document.fullscreenElement === vis;
          ecran.setAttribute("aria-pressed", plein ? "true" : "false");
          ecran.textContent = plein ? "Quitter le plein écran" : "Plein écran";
        });
      }
      outils = {barre, zone, prec, suiv, page, total, echelle, champ, resultats, ecran, moins, plus, largeur, entiere, avant, apres};
      return outils;
    }

    // ce qui est montré : « pdf » (lecteur), « canevas » (image, ou PDF en secours), rien (fermé)
    function mode(m) {
      $("dr-vis-zone").hidden = m !== "canevas";
      if (outils) { outils.barre.hidden = m !== "pdf"; outils.zone.hidden = m !== "pdf"; }
      if (m !== "canevas") $("dr-vis-pages").hidden = true;
    }

    function basculerPleinEcran() {
      const vis = $("dr-vis");
      try {
        if (document.fullscreenElement === vis) document.exitFullscreen();
        else if (vis.requestFullscreen) vis.requestFullscreen().catch(() => msg("Plein écran refusé par le navigateur."));
        else msg("Plein écran indisponible dans ce navigateur.");
      } catch { msg("Plein écran indisponible dans ce navigateur."); }
    }

    // raccourcis : Échap ferme ; Ctrl+F recherche ; F3 / Ctrl+G résultat suivant (Maj : précédent) ; Ctrl +, −, 0 :
    // zoom ; flèches gauche et droite, Début, Fin : pages (hors champ de saisie). Ctrl+P et Ctrl+S : refusés (garder).
    function clavier(e) {
      if (e.key === "Escape") { e.stopPropagation(); fermer(); return; }
      const l = ouverte && ouverte.lecteur;
      if (!l) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const saisie = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "");
      const fait = () => { e.preventDefault(); e.stopPropagation(); };
      if (ctrl && /^f$/i.test(e.key)) { fait(); outils.champ.focus(); if (outils.champ.select) outils.champ.select(); }
      else if (e.key === "F3" || (ctrl && /^g$/i.test(e.key))) { fait(); chercher(l, "again", !!e.shiftKey); }
      else if (ctrl && (e.key === "+" || e.key === "=")) { fait(); l.viewer.increaseScale(); }
      else if (ctrl && (e.key === "-" || e.key === "_")) { fait(); l.viewer.decreaseScale(); }
      else if (ctrl && e.key === "0") { fait(); l.viewer.currentScaleValue = "page-width"; }
      else if (saisie || ctrl || e.altKey) return;
      else if (e.key === "ArrowRight") { fait(); l.viewer.nextPage(); }
      else if (e.key === "ArrowLeft") { fait(); l.viewer.previousPage(); }
      else if (e.key === "Home") { fait(); l.viewer.currentPageNumber = 1; }
      else if (e.key === "End") { fait(); l.viewer.currentPageNumber = l.viewer.pagesCount; }
    }

    function montrer(autorisation) {
      fermer();
      retour = document.activeElement || null;
      $("dr-vis-titre").textContent = autorisation.nom;
      $("dr-vis-pages").hidden = true;
      $("dr-vis").hidden = false;
      $("dr-vis-fermer").onclick = fermer;
      $("dr-vis").onkeydown = clavier;
      $("dr-vis-fermer").focus();
      garder();
      msg("Ouverture…");
    }

    function detruireLecteur(l) {
      // canevas relevés avant que le lecteur ne les retire de la page, vidés ensuite (mémoire rendue tout de suite)
      const toiles = l.visuel.querySelectorAll ? [...l.visuel.querySelectorAll("canvas")] : [];
      try { l.eventBus.dispatch("findbarclose", {source: null}); } catch {}
      try { l.viewer.setDocument(null); } catch {}
      try { l.link.setDocument(null); } catch {}
      try { l.ac.abort(); } catch {}   // nos écouteurs, observation du redimensionnement, défilement
      for (const t of toiles) { t.width = 0; t.height = 0; }
      l.visuel.textContent = "";
      if (l.conteneur.remove) l.conteneur.remove();
    }

    function fermer() {
      const o = ouverte;
      const etaitOuverte = !!($("dr-vis") && !$("dr-vis").hidden);
      ouverte = null;
      if (o && o.lecteur) { const l = o.lecteur; o.lecteur = null; detruireLecteur(l); }
      if (o && o.tache) { try { o.tache.destroy(); } catch {} }   // détruit aussi le document et son worker
      const toile = $("dr-vis-toile");
      if (toile) { toile.width = 0; toile.height = 0; }   // l'image lue ne reste pas dans la page
      if (outils) {
        outils.champ.value = ""; outils.resultats.textContent = ""; outils.page.value = ""; outils.total.textContent = "";
        outils.echelle.textContent = "";
      }
      relacher();
      if (typeof document.exitFullscreen === "function" && document.fullscreenElement && document.fullscreenElement === $("dr-vis")) {
        try { document.exitFullscreen().catch(() => {}); } catch {}
      }
      if ($("dr-vis")) { mode(null); $("dr-vis").hidden = true; }
      const r = retour;
      retour = null;
      if (etaitOuverte && r && r.focus && r.isConnected !== false) { try { r.focus(); } catch {} }
    }

    // ---------------------------------------------------------------- lecteur PDF.js (PDFViewer)
    function chercher(l, type, precedent) {
      const q = outils.champ.value.trim();
      if (!q) {
        outils.resultats.textContent = "";
        l.eventBus.dispatch("findbarclose", {source: null});
        return;
      }
      l.eventBus.dispatch("find", {source: null, type, query: q, caseSensitive: false, entireWord: false,
                                   highlightAll: true, findPrevious: !!precedent, matchDiacritics: false});
    }

    function resultatsTrouves(nb) {
      const {current = 0, total = 0} = nb || {};
      return total ? `${current} sur ${total} résultat${total > 1 ? "s" : ""}` : "";
    }

    // pages affichées et déjà dessinées (filigrane compris) : notées une fois chacune dans le journal (dr_suivre). La page
    // courante, et toute autre page visible au moins à moitié (zoom arrière ou page entière : plusieurs pages à l'écran) ;
    // une page préparée d'avance hors de l'écran n'est pas notée.
    const VISIBLE_MIN = 50;   // pourcentage de la page à l'écran
    function pagesAffichees(viewer) {
      const n = new Set([viewer.currentPageNumber]);
      try {
        const v = typeof viewer._getVisiblePages === "function" ? viewer._getVisiblePages() : null;
        for (const x of (v && v.views) || []) if (x && x.percent >= VISIBLE_MIN && Number.isInteger(x.id)) n.add(x.id);
      } catch {}
      return n;
    }
    function noter(o) {
      const l = o.lecteur;
      if (!l || ouverte !== o) return;
      let nouvelles = 0;
      for (const n of pagesAffichees(l.viewer)) {
        if (!o.rendues.has(n) || o.vues.has(n)) continue;
        o.vues.add(n);
        nouvelles++;
      }
      if (nouvelles && options.suivre) options.suivre(o.autorisation.consultation, o.vues.size);
    }

    function majPage(o) {
      const l = o.lecteur;
      if (!l) return;
      const n = l.viewer.currentPageNumber, total = l.viewer.pagesCount;
      if (o.saisiePage !== true) outils.page.value = String(n);
      outils.total.textContent = `/ ${total}`;
      outils.prec.disabled = n <= 1;
      outils.suiv.disabled = n >= total;
    }

    // filigrane dans le canevas d'une page tout juste dessinée, avant qu'il ne s'affiche (même tâche que le dessin)
    function marquer(o, toile) {
      if (!toile || o.marques.has(toile) || !toile.width || !toile.height || !toile.getContext) return false;
      filigrane(toile.getContext("2d"), toile.width, toile.height, o.autorisation.filigrane);
      o.marques.add(toile);
      if (toile.classList) toile.classList.add("dr-fil");
      return true;
    }

    function ouvrirLecteur(o, lib, V, echec) {
      const ui = creerOutils();
      const conteneur = el("div", {class: "dr-vis-conteneur", id: "dr-vis-conteneur", tabindex: "0",
                                   "aria-label": `Document ${o.autorisation.nom}`});
      const visuel = el("div", {class: "pdfViewer"});
      conteneur.appendChild(visuel);
      ui.zone.textContent = "";
      ui.zone.appendChild(conteneur);
      mode("pdf");   // le conteneur doit être affiché (position absolue) avant la création du lecteur
      const ac = new AbortController();
      const signal = ac.signal;
      const eventBus = new V.EventBus();
      // liens : aucun (annotations désactivées) ; et le service de liens ne navigue jamais vers l'extérieur
      const link = new V.PDFLinkService({eventBus, externalLinkTarget: 0, externalLinkRel: "noopener noreferrer nofollow"});
      link.externalLinkEnabled = false;
      const find = new V.PDFFindController({eventBus, linkService: link});
      const AM = lib.AnnotationMode || {}, AE = lib.AnnotationEditorType || {};
      const viewer = new V.PDFViewer({
        container: conteneur, viewer: visuel, eventBus, linkService: link, findController: find,
        textLayerMode: 1,                          // calque de texte : pour la recherche seulement
        annotationMode: AM.DISABLE ?? 0,           // ni liens, ni formulaires, ni scripts du document
        annotationEditorMode: AE.DISABLE ?? -1,    // aucun outil d'annotation
        maxCanvasPixels: PIXELS_MAX, enablePrintAutoRotate: false, abortSignal: signal,
      });
      const l = {viewer, eventBus, link, find, ac, conteneur, visuel};
      o.lecteur = l;
      link.setViewer(viewer);
      const sur = (nom, f) => eventBus.on(nom, x => { if (ouverte === o) f(x || {}); }, {signal});
      sur("pagesinit", () => { viewer.currentScaleValue = "page-width"; majPage(o); msg(o.note || ""); });
      sur("pagerendered", e => {
        const vue = e.source || viewer.getPageView(e.pageNumber - 1);
        marquer(o, vue && vue.canvas);
        if (e.error) { msg("Page illisible dans la visionneuse.", true); return; }
        o.rendues.add(e.pageNumber);
        noter(o);
      });
      // vignettes : aucune dans ce lecteur ; s'il y en avait un jour, même filigrane
      sur("thumbnailrendered", e => { const v = e.source; marquer(o, v && v.canvas); });
      sur("pagechanging", () => { majPage(o); noter(o); });
      sur("updateviewarea", () => noter(o));   // défilement ou zoom : pages à l'écran
      sur("pagesloaded", () => majPage(o));
      sur("scalechanging", e => { ui.echelle.textContent = `${Math.round((e.scale || viewer.currentScale || 1) * 100)} %`; });
      sur("updatefindmatchescount", e => { ui.resultats.textContent = resultatsTrouves(e.matchesCount); });
      sur("updatefindcontrolstate", e => {
        // FindState de PDF.js : 0 trouvé, 1 introuvable, 2 reprise au début (ou à la fin), 3 en cours
        const t = resultatsTrouves(e.matchesCount);
        ui.resultats.textContent = e.state === 1 ? "Aucun résultat" : e.state === 3 ? "Recherche…"
          : e.state === 2 ? `${t}${t ? " · " : ""}reprise ${e.previous ? "à la fin" : "au début"}` : t;
      });
      ui.page.onfocus = () => { o.saisiePage = true; };
      ui.page.onblur = () => { o.saisiePage = false; majPage(o); };
      // une plage refusée pendant la lecture (droit retiré, plafond) : message, le lecteur s'arrête là
      echec.then(null, e => echouer(o, e));
      viewer.setDocument(o.doc);
      link.setDocument(o.doc, null);
    }

    // ---------------------------------------------------------------- secours : une page à la fois dans un canevas
    async function afficherPage(o, n) {
      if (ouverte !== o) return;
      const page = await o.doc.getPage(n);
      if (ouverte !== o) return;
      const zone = $("dr-vis-zone"), toile = $("dr-vis-toile");
      const base = page.getViewport({scale: 1});
      const echelle = Math.min(3, Math.max(0.5, ((zone.clientWidth || 900) - 16) / base.width)) * (window.devicePixelRatio || 1);
      const vue = page.getViewport({scale: echelle});
      // dessin dans un canevas hors de la page (pdf.js dessine par étapes : rien ne doit se voir sans filigrane), puis
      // copie dans le canevas affiché et filigrane dans la même tâche, avant tout affichage
      const brouillon = document.createElement("canvas");
      brouillon.width = Math.floor(vue.width);
      brouillon.height = Math.floor(vue.height);
      try {
        await page.render({canvasContext: brouillon.getContext("2d"), viewport: vue, annotationMode: 0}).promise;   // 0 : sans annotations
        if (ouverte !== o) return;
        toile.width = brouillon.width;
        toile.height = brouillon.height;
        toile.style.width = `${Math.floor(vue.width / (window.devicePixelRatio || 1))}px`;
        const ctx = toile.getContext("2d");
        ctx.drawImage(brouillon, 0, 0);
        filigrane(ctx, toile.width, toile.height, o.autorisation.filigrane);
      } finally {
        brouillon.width = 0; brouillon.height = 0;
      }
      o.page = n;
      o.vues.add(n);
      $("dr-vis-num").textContent = `Page ${n} sur ${o.doc.numPages}`;
      $("dr-vis-prec").disabled = n <= 1;
      $("dr-vis-suiv").disabled = n >= o.doc.numPages;
      msg(o.note || "");
      if (options.suivre) options.suivre(o.autorisation.consultation, o.vues.size);
    }

    async function pageParPage(o, echec) {
      mode("canevas");
      $("dr-vis-pages").hidden = o.doc.numPages < 2;
      $("dr-vis-prec").onclick = () => Promise.race([afficherPage(o, o.page - 1), echec]).catch(e => echouer(o, e));
      $("dr-vis-suiv").onclick = () => Promise.race([afficherPage(o, o.page + 1), echec]).catch(e => echouer(o, e));
      await Promise.race([afficherPage(o, 1), echec]);
    }

    async function consulter(autorisation) {
      montrer(autorisation);
      const o = {autorisation, doc: null, tache: null, page: 0, vues: new Set(), rendues: new Set(),
                 marques: new WeakSet(), lecteur: null, note: "", saisiePage: false};
      ouverte = o;
      try {
        if (/^image\//.test(autorisation.mime || "")) {
          mode("canevas");
          const octets = await lire(autorisation, 0, autorisation.taille, Math.min(autorisation.plage_max, 2 * 1024 * 1024));
          if (ouverte !== o) return;
          const image = await createImageBitmap(new Blob([octets], {type: autorisation.mime}));
          const toile = $("dr-vis-toile");
          toile.width = image.width; toile.height = image.height; toile.style.width = "";
          const ctx = toile.getContext("2d");
          ctx.drawImage(image, 0, 0);
          if (image.close) image.close();
          filigrane(ctx, toile.width, toile.height, autorisation.filigrane);
          o.vues.add(1);
          msg("");
          if (options.suivre) options.suivre(autorisation.consultation, 1);
          return;
        }
        const lib = await chargerPdfjs();
        if (ouverte !== o) return;
        // lecteur complet si possible ; sinon l'affichage page par page, dit à la personne
        let V = null;
        try { V = await chargerLecteur(); } catch { V = null; }
        if (ouverte !== o) return;
        let rejeter = () => {};
        const echec = new Promise((_, r) => { rejeter = r; });
        echec.catch(() => {});
        class Plages extends lib.PDFDataRangeTransport {
          requestDataRange(debut, fin) {
            lire(autorisation, debut, Math.min(fin, autorisation.taille), MORCEAU)
              .then(octets => { if (ouverte === o) this.onDataRange(debut, octets); }, rejeter);
          }
        }
        o.tache = lib.getDocument({
          range: new Plages(autorisation.taille, null), length: autorisation.taille, rangeChunkSize: MORCEAU,
          disableAutoFetch: true, disableStream: true, isEvalSupported: false, enableXfa: false,
          disableFontFace: false, useSystemFonts: true, verbosity: 0,
        });
        o.doc = await Promise.race([o.tache.promise, echec]);
        if (ouverte !== o) return;
        if (V && V.PDFViewer) {
          try { ouvrirLecteur(o, lib, V, echec); return; }
          catch {
            if (o.lecteur) { const l = o.lecteur; o.lecteur = null; detruireLecteur(l); }
            if (ouverte !== o) return;
          }
        }
        o.note = "Lecteur complet indisponible : affichage simple, page par page (sans zoom ni recherche).";
        await pageParPage(o, echec);
      } catch (e) {
        echouer(o, e);
      }
    }

    function echouer(o, e) {
      if (ouverte !== o) return;
      msg(e instanceof ErreurLecture ? e.message
        : e && e.name === "PasswordException" ? "Document protégé par un mot de passe : il ne peut pas être affiché ici."
        : "Document illisible dans la visionneuse.", true);
    }

    // dire(texte) : progression et issue, pour la personne
    async function telecharger(autorisation, dire = () => {}) {
      try {
        const octets = await lire(autorisation, 0, autorisation.taille, autorisation.plage_max,
          lus => dire(`Téléchargement : ${Math.round(100 * lus / Math.max(1, autorisation.taille))} %`));
        options.enregistrer(autorisation.nom, new Blob([octets], {type: "application/octet-stream"}));
        dire("Téléchargement terminé.");
        return true;
      } catch (e) {
        dire(e instanceof ErreurLecture ? e.message : "Téléchargement impossible.");
        return false;
      }
    }

    return {consulter, telecharger, fermer, plage};
  };
})();
