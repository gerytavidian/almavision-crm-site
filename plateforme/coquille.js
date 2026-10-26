/* Coquille commune de la plateforme Almavision (une copie par page, assemblée par etl/site.py).

   Connexion à Supabase par email et mot de passe (comptes créés par etl/comptes.py), session gardée dans l'onglet
   (sessionStorage) ou sur l'appareil (localStorage) si « Rester connecté » est coché, accès revérifié toutes les
   5 minutes, déconnexion propre, changement de mot de passe, menu des modules.

   Chaque module attend la coquille :
       const P = await window.plateforme.pret;
   La promesse se résout quand la personne est connectée ET a accès au module de la page ; sinon la coquille affiche
   le refus et la promesse est rejetée avec une erreur marquée « affiche » (le module n'a rien à afficher de plus).

   P.sb            client supabase-js au nom de la personne : la sécurité par ligne de la base est la seule vraie barrière
   P.session       session Supabase
   P.moi           {user_id, prenom, type: "interne" | "invite"}
   P.module        {id, nom, role} du module de la page (null sur l'accueil)
   P.modules       modules accessibles [{id, nom, page, description, statut, role}]
   P.esc(t)        échappement HTML (préférer textContent)
   P.cle(nom)      clé de stockage local propre au module (« <id>:<nom> »)
   P.telecharger(nom, donnees)   enregistre un fichier sur l'ordinateur
   P.deconnecter(), P.changerMdp(), P.menuModules(), P.surArret(f) (f appelée à la déconnexion ; renvoie de quoi l'oublier)

   Droits : tant que le socle des droits (db/plateforme.sql, fonction mes_modules) n'est pas en base, un membre actif
   de l'équipe (est_membre) a accès à tous les modules et personne d'autre n'a accès à rien. */
(() => {
  "use strict";
  const CONF = JSON.parse(document.getElementById("plateforme-config").textContent);
  let resoudre, rejeter;
  const pret = new Promise((ok, ko) => { resoudre = ok; rejeter = ko; });
  pret.catch(() => {});   // pas d'alerte « rejet non traité » si la page n'a pas de module à prévenir
  window.plateforme = {pret, conf: CONF};

  // affichée dans le cadre d'un autre site : on ne montre rien (protection contre le détournement de clic)
  if (window.top !== window.self) {
    document.documentElement.textContent = "";
    rejeter(Object.assign(new Error("page affichée dans un cadre"), {affiche: true}));
    return;
  }

  const MODULE = CONF.module === "accueil" ? null : (CONF.modules || []).find(m => m.id === CONF.module) || null;
  const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
  const charger = src => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => ko(new Error("chargement de " + src)); document.head.appendChild(s); });
  const domPret = () => new Promise(ok => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", ok, {once: true}) : ok());
  const bouton = (texte, action, classe = "btn") => { const b = document.createElement("button"); b.type = "button"; b.className = classe; b.textContent = texte; b.onclick = action; return b; };

  // où garder la session : l'onglet par défaut, l'appareil si la personne l'a demandé (préférence dans localStorage)
  const PREF = "almavision-rester", JETON = /^sb-.+-auth-token/, memoire = new Map();
  const rester = () => { try { return localStorage.getItem(PREF) === "1"; } catch { return false; } };
  const magasins = () => { const r = []; try { localStorage.length; r.push(localStorage); } catch {} try { sessionStorage.length; r.push(sessionStorage); } catch {} return r; };
  const magasin = () => { try { const s = rester() ? localStorage : sessionStorage; s.length; return s; } catch { return null; } };
  const stockage = {
    getItem: k => { const s = magasin(); try { return s ? s.getItem(k) : (memoire.get(k) ?? null); } catch { return memoire.get(k) ?? null; } },
    setItem: (k, v) => { const s = magasin();
      try { if (!s) throw new Error("pas de stockage"); s.setItem(k, v); } catch { memoire.set(k, v); }
      for (const autre of magasins()) if (autre !== s) try { autre.removeItem(k); } catch {} },   // jamais la session aux deux endroits
    removeItem: k => { memoire.delete(k); for (const s of magasins()) try { s.removeItem(k); } catch {} }};
  const effacerJetons = () => { memoire.clear();
    for (const s of magasins()) try { for (let i = s.length - 1; i >= 0; i--) { const k = s.key(i); if (k && JETON.test(k)) s.removeItem(k); } } catch {} };

  async function demarrer() {
    await charger("vendor/supabase.min.js");
    await domPret();
    const sb = window.supabase.createClient(CONF.url, CONF.cle, {auth: {persistSession: true, autoRefreshToken: true, storage: stockage}});
    const ecran = document.getElementById("connexion"), msg = document.getElementById("cnx-msg");
    // attente : celle de la page si elle en a une (la Prospection la garde jusqu'à ses données), sinon celle de la coquille
    let attente = document.getElementById("chargement");
    const attentePropre = !attente;
    if (!attente) { attente = document.createElement("div"); attente.id = "chargement"; attente.className = "chargement"; attente.setAttribute("role", "status"); attente.textContent = "Chargement…"; document.body.appendChild(attente); }
    for (const el of document.querySelectorAll(".cq-nom-module")) el.textContent = MODULE ? MODULE.nom : "Plateforme";

    // déconnexion : session locale fermée, jetons effacés quoi qu'il arrive, page rechargée (écran de connexion)
    let sortie = false;
    const arrets = new Set();   // abonnements des modules, coupés à la déconnexion
    const couper = () => { sortie = true; for (const f of [...arrets]) try { f(); } catch {} };
    const deconnecter = async (recharger = true) => {
      couper();
      try { await sb.auth.signOut({scope: "local"}); } catch {}
      effacerJetons();
      if (recharger) location.reload();
    };
    // session fermée ailleurs (autre onglet, jeton expiré qui ne se renouvelle plus) : même chose
    sb.auth.onAuthStateChange(evt => { if (evt === "SIGNED_OUT" && !sortie) { couper(); effacerJetons(); location.reload(); } });

    let session = null;
    try { ({data: {session}} = await sb.auth.getSession()); } catch { session = null; }
    if (!session) {
      attente.hidden = true; ecran.hidden = false;
      const caseRester = document.getElementById("cnx-rester");
      caseRester.checked = rester();
      session = await new Promise(fin => {
        document.getElementById("cnx-form").onsubmit = async e => {
          e.preventDefault(); msg.textContent = ""; const b = document.getElementById("cnx-go"); b.disabled = true; b.textContent = "Connexion…";
          // la préférence est posée avant la connexion : la session s'écrit directement au bon endroit
          try { if (caseRester.checked) localStorage.setItem(PREF, "1"); else localStorage.removeItem(PREF); } catch {}
          let data = null, error = null;
          try { ({data, error} = await sb.auth.signInWithPassword({email: document.getElementById("cnx-email").value.trim(), password: document.getElementById("cnx-mdp").value})); }
          catch (x) { error = x; }
          b.disabled = false; b.textContent = "Se connecter";
          if (error || !data || !data.session) { msg.textContent = error && error.message === "Invalid login credentials" ? "Email ou mot de passe incorrect." : "Connexion impossible : " + (error ? error.message : "réessayez") + "."; return; }
          document.getElementById("cnx-mdp").value = "";
          fin(data.session);
        };
      });
      ecran.hidden = true; attente.hidden = false;
    }

    // Modules accessibles : [{id, role}], [] si aucun, null si la question n'a pas pu être posée (réseau, base).
    // mes_modules() vient du socle des droits (db/plateforme.sql) ; tant qu'il n'est pas en base, est_membre() décide.
    let membre = null;
    const lireAcces = async () => {
      try {
        const {data, error} = await sb.rpc("mes_modules");
        if (!error && Array.isArray(data)) return data.filter(m => m && m.id).map(m => ({id: String(m.id), role: m.role || null}));
        if (error && !["PGRST202", "42883"].includes(error.code)) return null;   // fonction absente : repli ci-dessous
      } catch { return null; }
      try {
        const {data, error} = await sb.rpc("est_membre");
        if (error) return null;
        membre = data === true;
        return membre ? (CONF.modules || []).map(m => ({id: m.id, role: "equipe"})) : [];
      } catch { return null; }
    };
    const acces = await lireAcces();
    const refuser = texte => {
      attente.textContent = texte;
      attente.appendChild(bouton("Se déconnecter", () => deconnecter(), "btn small"));
      throw Object.assign(new Error(texte), {affiche: true});
    };
    if (acces === null) {
      attente.textContent = "Connexion impossible, réessayez.";
      attente.appendChild(bouton("Recharger", () => location.reload(), "btn small"));
      attente.appendChild(bouton("Se déconnecter", () => deconnecter(), "btn small"));
      throw Object.assign(new Error("connexion impossible"), {affiche: true});
    }
    const roles = new Map(acces.map(a => [a.id, a.role]));
    const modules = (CONF.modules || []).filter(m => roles.has(m.id)).map(m => ({...m, role: roles.get(m.id)}));
    if (!modules.length) refuser("Ce compte n'a accès à aucun module de la plateforme. Demandez à Géry.");
    if (MODULE && !roles.has(MODULE.id)) refuser(`Ce compte n'a pas accès au module « ${MODULE.nom} ».`);
    if (membre === null) { try { membre = (await sb.rpc("est_membre")).data === true; } catch { membre = false; } }

    // accès retiré en cours de journée : la page se vide et la session se ferme
    setInterval(async () => {
      if (sortie) return;
      const a = await lireAcces();
      if (a === null) return;   // erreur passagère : nouvelle question au prochain tour
      if (MODULE ? a.some(x => x.id === MODULE.id) : a.length) return;
      couper();
      document.body.textContent = "";
      const m = document.createElement("div"); m.className = "chargement"; m.setAttribute("role", "alert");
      m.textContent = "Accès retiré : ce compte n'a plus accès à cette page. ";
      m.appendChild(bouton("Se reconnecter", () => location.reload(), "btn small"));
      document.body.appendChild(m);
      await deconnecter(false);
    }, 5 * 60000);

    let prenom = "";
    try { prenom = (await sb.rpc("mon_prenom")).data || ""; } catch {}
    prenom = String(prenom || session.user.email || "");

    // changer son mot de passe : petite fenêtre, deux saisies identiques, 10 caractères au moins
    const changerMdp = () => {
      const fen = document.getElementById("mdp"), m1 = document.getElementById("mdp-1"), m2 = document.getElementById("mdp-2"),
            mm = document.getElementById("mdp-msg"), go = document.getElementById("mdp-go");
      const fermer = () => { fen.hidden = true; m1.value = m2.value = ""; mm.textContent = ""; mm.style.color = ""; };
      fermer(); fen.hidden = false; m1.focus();
      document.getElementById("mdp-x").onclick = fermer;
      fen.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); fermer(); } };
      document.getElementById("mdp-form").onsubmit = async e => {
        e.preventDefault(); mm.textContent = ""; mm.style.color = "";
        if (m1.value.length < 10) { mm.textContent = "10 caractères au moins."; return; }
        if (m1.value !== m2.value) { mm.textContent = "Les deux saisies ne sont pas identiques."; return; }
        go.disabled = true; go.textContent = "Enregistrement…";
        let error = null;
        try { ({error} = await sb.auth.updateUser({password: m1.value})); } catch (x) { error = x; }
        go.disabled = false; go.textContent = "Enregistrer";
        if (error) { mm.textContent = /different|same/i.test(error.message || "") ? "Choisissez un mot de passe différent de l'actuel." : "Changement impossible : " + (error.message || "réessayez") + "."; return; }
        m1.value = m2.value = ""; mm.style.color = "var(--accent)"; mm.textContent = "Mot de passe changé.";
        setTimeout(fermer, 1500);
      };
    };

    const telecharger = (nom, donnees) => {
      const blob = donnees instanceof Blob ? donnees : new Blob([donnees]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };

    // menu des modules : un lien par module accessible, celui de la page marqué ; l'accueil en premier
    const menuModules = () => {
      const nav = document.createElement("nav"); nav.className = "cq-modules"; nav.setAttribute("aria-label", "Modules de la plateforme");
      const lien = (texte, href, courant) => { const a = document.createElement("a"); a.href = href; a.textContent = texte; if (courant) a.setAttribute("aria-current", "page"); nav.appendChild(a); };
      lien("Accueil", "index.html#accueil", !MODULE);
      for (const m of modules) lien(m.nom, m.page, MODULE && m.id === MODULE.id);
      return nav;
    };

    // en-tête commun des pages qui n'ont pas le leur (accueil, modules en fragment)
    const entete = document.getElementById("cq-entete");
    if (entete) {
      const barre = document.createElement("div"); barre.className = "cq-barre";
      const marque = document.createElement("a"); marque.className = "cq-marque"; marque.href = "index.html#accueil";
      marque.innerHTML = '<svg width="28" height="32" viewBox="0 0 30 34" aria-hidden="true"><path d="M15 1 29 9v16L15 33 1 25V9z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 23l6-13 6 13M11.5 18h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      const nom = document.createElement("div"); nom.textContent = MODULE ? MODULE.nom : "Plateforme";
      const petit = document.createElement("small"); petit.textContent = "ALMAVISION"; nom.appendChild(petit); marque.appendChild(nom);
      const compte = document.createElement("div"); compte.className = "cq-compte";
      const qui = document.createElement("span"); qui.textContent = prenom;
      compte.append(qui, bouton("Changer mon mot de passe", changerMdp, "btn small"), bouton("Se déconnecter", () => deconnecter(), "btn small"));
      barre.append(marque, menuModules(), compte);
      entete.appendChild(barre);
    }

    if (MODULE) { try { localStorage.setItem("plateforme:dernier", MODULE.page); } catch {} }
    if (attentePropre) attente.hidden = true;
    return {
      sb, session, esc, telecharger, changerMdp, menuModules,
      moi: {user_id: session.user.id, prenom, type: membre ? "interne" : "invite"},
      module: MODULE ? {id: MODULE.id, nom: MODULE.nom, role: roles.get(MODULE.id)} : null,
      modules,
      cle: nom => `${MODULE ? MODULE.id : "accueil"}:${nom}`,
      deconnecter: () => deconnecter(),
      surArret: f => { arrets.add(f); return () => arrets.delete(f); },
    };
  }

  demarrer().then(resoudre, e => {
    if (!e.affiche) {
      const attente = document.getElementById("chargement");
      if (attente) { attente.hidden = false; attente.textContent = "Connexion impossible : " + e.message + ". Rechargez la page."; }
      e.affiche = true;
    }
    rejeter(e);
  });
})();
