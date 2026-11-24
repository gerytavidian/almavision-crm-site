/* Coquille commune de la plateforme Almavision (une copie par page, assemblée par etl/site.py).

   Connexion à Supabase par email et mot de passe (comptes créés par etl/comptes.py) ou, pour un acquéreur, par code
   reçu par email ; second facteur (application d'authentification) pour un membre sur un module qui l'exige ; session
   gardée dans l'onglet
   (sessionStorage) ou sur l'appareil (localStorage) si « Rester connecté » est coché (membres de l'équipe seulement :
   la session d'un invité reste toujours dans l'onglet), accès revérifié toutes les 5 minutes, déconnexion propre,
   changement de mot de passe, menu des modules.

   Chaque module attend la coquille :
       const P = await window.plateforme.pret;
   La promesse se résout quand la personne est connectée ET a accès au module de la page ; sinon la coquille affiche
   le refus et la promesse est rejetée avec une erreur marquée « affiche » (le module n'a rien à afficher de plus).

   P.sb            client supabase-js au nom de la personne : la sécurité par ligne de la base est la seule vraie barrière
   P.session       session Supabase
   P.moi           {user_id, prenom, type: "interne" | "invite"}
   P.appareil      vrai si un membre a choisi « Rester connecté » (session sur l'appareil) : seul cas où un module garde
                   des données sur l'appareil (cache de la Prospection)
   P.module        {id, nom, role} du module de la page (null sur l'accueil)
   P.modules       modules accessibles [{id, nom, page, description, statut, role}]
   P.esc(t)        échappement HTML (préférer textContent)
   P.cle(nom)      clé de stockage local propre au module (« <id>:<nom> »)
   P.telecharger(nom, donnees)   enregistre un fichier sur l'ordinateur
   P.deconnecter(), P.changerMdp(), P.menuModules(), P.surArret(f) (f appelée à la déconnexion ; renvoie de quoi l'oublier)

   P.vue           "invites" sur la page des invités d'un module (« page_invites » de module.json : acheteur.html de la
                   Data Room), "equipe" ailleurs

   Droits : tant que le socle des droits (db/plateforme.sql, fonction mes_modules) n'est pas en base, un membre actif
   de l'équipe (est_membre) a accès à tous les modules et personne d'autre n'a accès à rien.

   Aiguillage (décision de Géry du 24/11/2026) : un invité connecté va tout droit à la page des invités de son module
   (depuis l'accueil ou la page principale du module), sans accueil ni menu des modules ; un membre de l'équipe qui
   ouvre une page des invités est renvoyé vers la page principale du module (l'aperçu « Voir comme » s'y trouve). La
   page des invités ne cite dans sa configuration que les modules ouverts aux invités (etl/site.py). */
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
  const PAGE_INVITES = CONF.vue === "invites";   // page des invités d'un module (acheteur.html)
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
  const ongletSeulement = () => {
    try { localStorage.removeItem(PREF); } catch {}
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !JETON.test(k)) continue;
        const v = localStorage.getItem(k);
        try { sessionStorage.setItem(k, v); } catch { memoire.set(k, v); }
        localStorage.removeItem(k);
      }
    } catch {}
  };
  const effacerJetons = () => { memoire.clear();
    for (const s of magasins()) try { for (let i = s.length - 1; i >= 0; i--) { const k = s.key(i); if (k && JETON.test(k)) s.removeItem(k); } } catch {} };

  // Plateforme en veille : le projet Supabase (offre gratuite) se met en pause après une semaine sans activité ; ses
  // adresses ne répondent plus (erreur réseau ou 5xx). Sur une erreur de connexion, la coquille interroge
  // /auth/v1/health : si le projet ne répond pas, elle affiche « en veille » au lieu d'une erreur brute, et réessaie
  // toute seule toutes les 30 secondes (page rechargée dès qu'il répond). Rien n'est envoyé d'autre que la clé publique.
  const SONDE_MS = 8000, REESSAI_MS = 30000;
  const repond = async () => {
    try {
      const rep = await fetch(`${CONF.url}/auth/v1/health`, {method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
        headers: {apikey: CONF.cle}, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(SONDE_MS) : undefined});
      return rep.status < 500;
    } catch { return false; }
  };
  let enVeille = false;
  const veille = async () => {
    if (enVeille) return true;
    if (await repond()) return false;
    enVeille = true;
    document.body.textContent = "";
    const m = document.createElement("div"); m.className = "chargement cq-veille"; m.id = "cq-veille"; m.setAttribute("role", "alert");
    const titre = document.createElement("b"); titre.textContent = "La plateforme est en veille.";
    const texte = document.createElement("p");
    texte.textContent = "La base de données ne répond pas : elle se met en pause après quelques jours sans visite, ou elle est " +
      "momentanément injoignable. La page réessaie toute seule toutes les 30 secondes ; si cela dure, prévenez Géry " +
      "(relance depuis le tableau de bord Supabase, une minute environ).";
    const etat = document.createElement("p"); etat.id = "cq-veille-etat";
    const essayer = async () => {
      etat.textContent = "Nouvel essai…";
      if (await repond()) { etat.textContent = "La base répond : rechargement."; location.reload(); return; }
      etat.textContent = "Toujours en veille (dernier essai : " + new Date().toLocaleTimeString("fr-FR") + ").";
      setTimeout(essayer, REESSAI_MS);
    };
    m.append(titre, texte, bouton("Réessayer maintenant", () => essayer(), "btn small"), etat);
    document.body.appendChild(m);
    setTimeout(essayer, REESSAI_MS);
    return true;
  };
  const affiche = texte => Object.assign(new Error(texte), {affiche: true});

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
    // les arrêts peuvent rendre une promesse (cache effacé) : attendue 1,5 s au plus avant de recharger
    const couper = () => { sortie = true;
      return Promise.race([Promise.all([...arrets].map(f => { try { return Promise.resolve(f()).catch(() => {}); } catch { return null; } })),
                           new Promise(ok => setTimeout(ok, 1500))]); };
    const deconnecter = async (recharger = true) => {
      await couper();
      try { await sb.auth.signOut({scope: "local"}); } catch {}
      effacerJetons();
      if (recharger) location.reload();
    };
    // session fermée ailleurs (autre onglet, jeton expiré qui ne se renouvelle plus) : même chose
    sb.auth.onAuthStateChange(evt => { if (evt === "SIGNED_OUT" && !sortie) { effacerJetons(); couper().then(() => location.reload()); } });

    let session = null;
    try { ({data: {session}} = await sb.auth.getSession()); } catch { session = null; }
    if (!session) {
      attente.hidden = true; ecran.hidden = false;
      const caseRester = document.getElementById("cnx-rester");
      caseRester.checked = rester();
      session = await new Promise(fin => {
        // connexion par code (acquéreurs) : la page demande le code à la fonction serveur « code », qui répond toujours
        // la même chose ; le code est vérifié par Supabase Auth ; la session reste dans l'onglet (préférence retirée)
        const formMdp = document.getElementById("cnx-form"), formCode = document.getElementById("cnx-code-form");
        const msgCode = document.getElementById("cnx-code-msg"), champCode = document.getElementById("cnx-code");
        // page des acheteurs : la connexion par code d'abord (le mot de passe reste à un clic, pour l'équipe)
        if (PAGE_INVITES) { formMdp.hidden = true; formCode.hidden = false; }
        document.getElementById("cnx-vers-code").onclick = () => { formMdp.hidden = true; formCode.hidden = false; msgCode.textContent = ""; };
        document.getElementById("cnx-vers-mdp").onclick = () => { formCode.hidden = true; formMdp.hidden = false; };
        document.getElementById("cnx-code-demander").onclick = async () => {
          const email = document.getElementById("cnx-code-email").value.trim(), b = document.getElementById("cnx-code-demander");
          if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email)) { msgCode.textContent = "Adresse email attendue."; return; }
          b.disabled = true; msgCode.textContent = "Envoi…";
          let texte = "";
          try {
            const rep = await fetch(`${CONF.url}/functions/v1/code`, {
              method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
              headers: {"apikey": CONF.cle, "Content-Type": "application/json"}, body: JSON.stringify({email}),
            });
            const corps = await rep.json().catch(() => null);
            texte = rep.ok && corps && typeof corps.message === "string" ? corps.message
              : rep.status === 400 ? "Adresse email attendue." : "Service momentanément indisponible : réessayez dans quelques minutes.";
          } catch { texte = "Pas de réponse du serveur : réessayez dans quelques minutes."; }
          if (!/Si cette adresse/.test(texte) && texte !== "Adresse email attendue." && await veille()) return;
          b.disabled = false;
          msgCode.textContent = texte;
          for (const id of ["cnx-code-lib", "cnx-code", "cnx-code-go"]) document.getElementById(id).hidden = false;
          champCode.focus();
        };
        formCode.onsubmit = async e => {
          e.preventDefault();
          const email = document.getElementById("cnx-code-email").value.trim(), code = champCode.value.replace(/\s/g, "");
          if (!/^\d{6,10}$/.test(code)) { msgCode.textContent = "Code à chiffres attendu (reçu par email)."; return; }
          try { localStorage.removeItem(PREF); } catch {}   // jamais « rester connecté » par ce chemin
          const b = document.getElementById("cnx-code-go"); b.disabled = true;
          let data = null, error = null;
          try { ({data, error} = await sb.auth.verifyOtp({email, token: code, type: "email"})); } catch (x) { error = x; }
          b.disabled = false;
          if (error || !data || !data.session) { msgCode.textContent = "Code incorrect ou expiré : demandez-en un nouveau."; return; }
          champCode.value = "";
          fin(data.session);
        };
        document.getElementById("cnx-form").onsubmit = async e => {
          e.preventDefault(); msg.textContent = ""; const b = document.getElementById("cnx-go"); b.disabled = true; b.textContent = "Connexion…";
          // la préférence est posée avant la connexion : la session s'écrit directement au bon endroit
          try { if (caseRester.checked) localStorage.setItem(PREF, "1"); else localStorage.removeItem(PREF); } catch {}
          let data = null, error = null;
          try { ({data, error} = await sb.auth.signInWithPassword({email: document.getElementById("cnx-email").value.trim(), password: document.getElementById("cnx-mdp").value})); }
          catch (x) { error = x; }
          b.disabled = false; b.textContent = "Se connecter";
          if (error && error.message !== "Invalid login credentials" && await veille()) return;
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
    let acces = await lireAcces();
    const estMembre = async () => { if (membre === null) { try { membre = (await sb.rpc("est_membre")).data === true; } catch { membre = false; } } return membre; };

    // Aiguillage entre la page de l'équipe et la page des invités d'un module, avant tout second facteur (un membre
    // n'a pas à saisir son code sur la page des acheteurs). Seulement sur une réponse franche de la base : si
    // est_membre ne répond pas, la page reste où elle est (les droits de la base décident de toute façon).
    const typeSur = async () => {
      if (membre !== null) return membre;
      try { const {data, error} = await sb.rpc("est_membre"); if (error) return null; membre = data === true; return membre; }
      catch { return null; }
    };
    const aiguiller = cible => { location.replace(cible); throw affiche("redirection vers " + cible); };
    if (acces !== null) {
      const type = (PAGE_INVITES || !MODULE || MODULE.page_invites) ? await typeSur() : null;
      if (type === true && PAGE_INVITES && MODULE) aiguiller(MODULE.page);
      if (type === false && !PAGE_INVITES) {
        if (MODULE && MODULE.page_invites) aiguiller(MODULE.page_invites);
        if (!MODULE) {
          // accueil : vers la page des invités du premier module accessible qui en a une, sinon vers ce module
          const ouverts = (CONF.modules || []).filter(m => acces.some(a => a.id === m.id));
          const cible = ouverts.find(m => m.page_invites) || ouverts[0];
          if (cible) aiguiller(cible.page_invites || cible.page);
        }
      }
    }

    // Double authentification de l'équipe : un module marqué « double_auth » (module.json, acces.double_auth_equipe)
    // n'est ouvert par la base à un membre qu'avec un jeton « aal2 » (mot de passe + code de l'application
    // d'authentification). Sans lui, le module manque à mes_modules : sur sa page, la coquille demande le code (ou fait
    // enregistrer l'application la première fois), puis relit les accès avec le nouveau jeton. Les invités n'ont pas de
    // second facteur (code par email à chaque connexion) : rien ne leur est demandé.
    const exigeMfa = m => !!(m && m.double_auth);
    const aSecondFacteur = async () => {
      try { const {data} = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); return !!data && data.currentLevel === "aal2"; }
      catch { return false; }
    };
    let manquants = acces === null ? [] : (CONF.modules || []).filter(m => exigeMfa(m) && !acces.some(a => a.id === m.id));
    if (manquants.length && (await aSecondFacteur() || !(await estMembre()))) manquants = [];
    if (MODULE && manquants.includes(MODULE)) {
      await secondFacteur();
      try { ({data: {session}} = await sb.auth.getSession()); } catch {}
      acces = await lireAcces();
      manquants = [];
    }

    async function secondFacteur() {
      const ecranMfa = document.getElementById("mfa"), form = document.getElementById("mfa-form"),
            msgMfa = document.getElementById("mfa-msg"), champ = document.getElementById("mfa-code"),
            go = document.getElementById("mfa-go"), nouveau = document.getElementById("mfa-nouveau");
      const echec = () => {
        ecranMfa.hidden = true; attente.hidden = false;
        attente.textContent = "Double authentification impossible pour le moment, réessayez.";
        attente.appendChild(bouton("Recharger", () => location.reload(), "btn small"));
        attente.appendChild(bouton("Se déconnecter", () => deconnecter(), "btn small"));
        return Object.assign(new Error("double authentification impossible"), {affiche: true});
      };
      let factorId = null;
      try {
        const {data: l, error} = await sb.auth.mfa.listFactors();
        if (error || !l) throw echec();
        const verifie = (l.totp || []).find(f => f && f.status === "verified");
        if (verifie) factorId = verifie.id;
        else {
          // première fois : une application d'authentification à enregistrer (les essais abandonnés sont retirés)
          for (const f of (l.all || []).filter(f => f && f.factor_type === "totp" && f.status !== "verified")) {
            await sb.auth.mfa.unenroll({factorId: f.id});
          }
          const {data: e, error: ee} = await sb.auth.mfa.enroll({factorType: "totp", friendlyName: "Almavision"});
          if (ee || !e || !e.id || !e.totp) throw echec();
          factorId = e.id;
          const qr = document.getElementById("mfa-qr");
          if (/^data:image\/svg\+xml[;,]/.test(String(e.totp.qr_code || ""))) { qr.src = e.totp.qr_code; qr.hidden = false; } else qr.hidden = true;
          document.getElementById("mfa-secret").textContent = String(e.totp.secret || "");
          nouveau.hidden = false;
        }
      } catch (x) { throw x && x.affiche ? x : echec(); }
      attente.hidden = true; ecranMfa.hidden = false; msgMfa.textContent = ""; champ.value = ""; champ.focus();
      document.getElementById("mfa-x").onclick = () => deconnecter();
      await new Promise(fin => {
        form.onsubmit = async e => {
          e.preventDefault();
          const code = champ.value.replace(/\s/g, "");
          if (!/^\d{6}$/.test(code)) { msgMfa.textContent = "Code à 6 chiffres attendu (application d'authentification)."; return; }
          go.disabled = true; msgMfa.textContent = "";
          let error = null;
          try { ({error} = await sb.auth.mfa.challengeAndVerify({factorId, code})); } catch (x) { error = x || new Error("réseau"); }
          go.disabled = false;
          if (error) { champ.value = ""; msgMfa.textContent = "Code incorrect ou expiré : saisissez le code affiché maintenant."; return; }
          champ.value = "";
          fin();
        };
      });
      ecranMfa.hidden = true; nouveau.hidden = true; attente.hidden = false;
    }

    const refuser = texte => {
      attente.textContent = texte;
      attente.appendChild(bouton("Se déconnecter", () => deconnecter(), "btn small"));
      throw Object.assign(new Error(texte), {affiche: true});
    };
    if (acces === null && await veille()) throw affiche("plateforme en veille");
    if (acces === null) {
      attente.textContent = "Connexion impossible, réessayez.";
      attente.appendChild(bouton("Recharger", () => location.reload(), "btn small"));
      attente.appendChild(bouton("Se déconnecter", () => deconnecter(), "btn small"));
      throw Object.assign(new Error("connexion impossible"), {affiche: true});
    }
    const roles = new Map(acces.map(a => [a.id, a.role]));
    // modules à double authentification pas encore ouverts (membre, jeton « aal1 ») : dans le menu, leur page demande le code
    const modules = (CONF.modules || []).filter(m => roles.has(m.id) || manquants.includes(m))
      .map(m => roles.has(m.id) ? {...m, role: roles.get(m.id)} : {...m, role: null, statut: "double authentification"});
    if (!modules.length) refuser("Ce compte n'a accès à aucun module de la plateforme. Demandez à Géry.");
    if (MODULE && !roles.has(MODULE.id)) refuser(`Ce compte n'a pas accès au module « ${MODULE.nom} ».`);
    await estMembre();
    // un invité (acquéreur) ne reste jamais connecté sur l'appareil : sa session vit dans l'onglet seulement, même si la
    // case « Rester connecté » a été cochée (préférence retirée, jetons déplacés de localStorage vers sessionStorage)
    if (!membre) ongletSeulement();

    // accès retiré en cours de journée : la page se vide et la session se ferme
    setInterval(async () => {
      if (sortie) return;
      if (enVeille) return;
      const a = await lireAcces();
      if (a === null) { if (await veille()) couper(); return; }   // erreur passagère : nouvelle question au prochain tour
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

    // menu des modules : un lien par module accessible, celui de la page marqué ; l'accueil en premier. Un invité n'a
    // pas de menu (il n'a qu'une page : celle des invités de son module)
    const menuModules = () => {
      const nav = document.createElement("nav"); nav.className = "cq-modules"; nav.setAttribute("aria-label", "Modules de la plateforme");
      if (!membre) return nav;
      const lien = (texte, href, courant) => { const a = document.createElement("a"); a.href = href; a.textContent = texte; if (courant) a.setAttribute("aria-current", "page"); nav.appendChild(a); };
      lien("Accueil", "index.html#accueil", !MODULE);
      for (const m of modules) lien(m.nom, m.page, MODULE && m.id === MODULE.id);
      return nav;
    };

    // en-tête commun des pages qui n'ont pas le leur (accueil, modules en fragment)
    const entete = document.getElementById("cq-entete");
    if (entete) {
      const barre = document.createElement("div"); barre.className = "cq-barre";
      const marque = document.createElement("a"); marque.className = "cq-marque"; marque.href = membre || !MODULE ? "index.html#accueil" : (PAGE_INVITES && MODULE.page_invites) || MODULE.page;
      marque.innerHTML = '<svg width="28" height="32" viewBox="0 0 30 34" aria-hidden="true"><path d="M15 1 29 9v16L15 33 1 25V9z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 23l6-13 6 13M11.5 18h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      const nom = document.createElement("div"); nom.textContent = MODULE ? MODULE.nom : "Plateforme";
      const petit = document.createElement("small"); petit.textContent = "ALMAVISION"; nom.appendChild(petit); marque.appendChild(nom);
      const compte = document.createElement("div"); compte.className = "cq-compte";
      const qui = document.createElement("span"); qui.textContent = prenom;
      compte.append(qui, bouton("Changer mon mot de passe", changerMdp, "btn small"), bouton("Se déconnecter", () => deconnecter(), "btn small"));
      barre.append(marque, menuModules(), compte);
      entete.appendChild(barre);
    }

    // dernier module ouvert (accueil sans « #accueil ») : membres seulement, jamais la page des invités
    if (MODULE && membre && !PAGE_INVITES) { try { localStorage.setItem("plateforme:dernier", MODULE.page); } catch {} }
    if (attentePropre) attente.hidden = true;
    return {
      sb, session, esc, telecharger, changerMdp, menuModules,
      moi: {user_id: session.user.id, prenom, type: membre ? "interne" : "invite"},
      appareil: membre && rester(),   // session gardée sur l'appareil (« Rester connecté », membres seulement)
      module: MODULE ? {id: MODULE.id, nom: MODULE.nom, role: roles.get(MODULE.id)} : null,
      modules,
      cle: nom => `${MODULE ? MODULE.id : "accueil"}:${nom}`,
      vue: PAGE_INVITES ? "invites" : "equipe",
      deconnecter: () => deconnecter(),
      surArret: f => { arrets.add(f); return () => arrets.delete(f); },
    };
  }

  demarrer().then(resoudre, async e => {
    if (!e.affiche && await veille()) e.affiche = true;
    if (!e.affiche) {
      const attente = document.getElementById("chargement");
      if (attente) { attente.hidden = false; attente.textContent = "Connexion impossible : " + e.message + ". Rechargez la page."; }
      e.affiche = true;
    }
    rejeter(e);
  });
})();
