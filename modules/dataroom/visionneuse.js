/* Visionneuse de la Data Room (lot b, docs/DATAROOM_PLAN.md §6 et annexe « Visionneuse »).

   window.drVisionneuse(options) rend {consulter(autorisation), telecharger(autorisation, dire), fermer()} ; options :
     conf          {url, cle} du projet Supabase (configuration de la page)
     jeton()       jeton de la personne (promesse), relu à chaque plage (il se renouvelle)
     suivre(c, n)  note les pages vues (dr_suivre), facultatif
     enregistrer(nom, blob)   enregistre un fichier sur l'ordinateur (P.telecharger de la coquille)
     pdfjs()       chargement de pdf.js (par défaut : import() de vendor/pdf.min.mjs, version épinglée par site.py)
   « autorisation » : ce que rend dr_autoriser (consultation, taille, nom, mime, action, plage_max, filigrane).

   Chaque octet passe par la fonction serveur « fichiers », plage par plage : GET …/functions/v1/fichiers?c=<consultation>,
   jeton dans l'en-tête Authorization (jamais dans l'adresse), Range: bytes=début-fin, sans cookie ni cache, aucune
   redirection suivie. La base revérifie tout à chaque plage : une révocation coupe la lecture tout de suite.
   - PDF : pdf.js lit par morceaux de 512 Ko ce dont la page affichée a besoin (PDFDataRangeTransport, pas de lecture à
     l'avance) ; chaque page est dessinée dans un canevas, sans calque de texte ni de liens (aucun lien ni script du
     document n'est actif), puis le filigrane (email et date) est dessiné par-dessus, dans le même canevas ;
   - image : lue par plages de 2 Mo au plus, dessinée dans un canevas avec le filigrane ;
   - téléchargement (niveau « télécharger ») : plages de 16 Mo, réassemblées dans le navigateur, puis enregistrées.
   Rien n'est gardé sur l'appareil : ni cache, ni stockage local ; les octets lus vivent dans la page jusqu'à la
   fermeture de la visionneuse. */
(() => {
  "use strict";
  const MORCEAU = 512 * 1024;
  const ERREURS = {
    403: "Accès refusé, ou lecture interrompue (droit retiré, document retiré, ou dix minutes sans activité) : fermez et rouvrez le document.",
    410: "Document indisponible pour le moment : l'équipe Almavision est prévenue.",
    416: "Lecture refusée (plage hors du document) : fermez et rouvrez le document.",
    429: "Plafond de lecture atteint pour aujourd'hui : reprenez demain.",
  };

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
    let ouverte = null;   // {doc, tache, autorisation, page, vues: Set}

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

    function montrer(autorisation) {
      fermer();
      $("dr-vis-titre").textContent = autorisation.nom;
      $("dr-vis-pages").hidden = true;
      $("dr-vis").hidden = false;
      $("dr-vis-fermer").onclick = fermer;
      $("dr-vis").onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); fermer(); } };
      $("dr-vis-fermer").focus();
      msg("Ouverture…");
    }

    function fermer() {
      const o = ouverte;
      ouverte = null;
      if (o && o.tache) { try { o.tache.destroy(); } catch {} }
      const toile = $("dr-vis-toile");
      if (toile) { toile.width = 0; toile.height = 0; }   // l'image lue ne reste pas dans la page
      if ($("dr-vis")) $("dr-vis").hidden = true;
    }

    async function afficherPage(o, n) {
      if (ouverte !== o) return;
      const page = await o.doc.getPage(n);
      if (ouverte !== o) return;
      const zone = $("dr-vis-zone"), toile = $("dr-vis-toile");
      const base = page.getViewport({scale: 1});
      const echelle = Math.min(3, Math.max(0.5, ((zone.clientWidth || 900) - 16) / base.width)) * (window.devicePixelRatio || 1);
      const vue = page.getViewport({scale: echelle});
      toile.width = Math.floor(vue.width);
      toile.height = Math.floor(vue.height);
      toile.style.width = `${Math.floor(vue.width / (window.devicePixelRatio || 1))}px`;
      const ctx = toile.getContext("2d");
      await page.render({canvasContext: ctx, viewport: vue, annotationMode: 0}).promise;   // 0 : sans annotations
      filigrane(ctx, toile.width, toile.height, o.autorisation.filigrane);
      o.page = n;
      o.vues.add(n);
      $("dr-vis-num").textContent = `Page ${n} sur ${o.doc.numPages}`;
      $("dr-vis-prec").disabled = n <= 1;
      $("dr-vis-suiv").disabled = n >= o.doc.numPages;
      msg("");
      if (options.suivre) options.suivre(o.autorisation.consultation, o.vues.size);
    }

    async function consulter(autorisation) {
      montrer(autorisation);
      const o = {autorisation, doc: null, tache: null, page: 0, vues: new Set()};
      ouverte = o;
      try {
        if (/^image\//.test(autorisation.mime || "")) {
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
        $("dr-vis-pages").hidden = o.doc.numPages < 2;
        $("dr-vis-prec").onclick = () => Promise.race([afficherPage(o, o.page - 1), echec]).catch(e => echouer(o, e));
        $("dr-vis-suiv").onclick = () => Promise.race([afficherPage(o, o.page + 1), echec]).catch(e => echouer(o, e));
        await Promise.race([afficherPage(o, 1), echec]);
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
