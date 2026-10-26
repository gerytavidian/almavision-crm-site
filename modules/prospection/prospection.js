/* Module Prospection Projet : adaptateur entre la coquille de la plateforme et l'application de prospection
   (etl/app_template.html, inchangée). Il installe ce que l'application attend depuis l'époque claude.ai :
   window.claude (db : suivi et tâches dans la table app_doc avec le temps réel ; user ; downloads ; sample : Claude par
   la base), window.__lireDonnees (données compressées de la table app_data), window.__site (prénom, déconnexion,
   changement de mot de passe) et window.__lib (bibliothèques copiées dans vendor/). L'application attend
   window.__pret avant de démarrer. */
window.__pret = (async () => {
  "use strict";
  const P = await window.plateforme.pret;
  const sb = P.sb, session = P.session, prenom = P.moi.prenom;
  window.__lib = {d3: "vendor/d3.min.js", xlsx: "vendor/xlsx.full.min.js"};

  // données de l'application : gzip en base64, décompressé dans le navigateur
  window.__lireDonnees = async f => {
    const nom = f.replace(/^data-|\.json$/g, "");
    const {data, error} = await sb.rpc("donnees_app", {n: nom});
    if (error || !data) throw new Error(`${f} : ${error ? error.message : "absent"}`);
    const bin = Uint8Array.from(atob(data.gz), c => c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
  };
  const erreur = e => Object.assign(new Error(e.message), {code: e.code === "42501" || /row-level security/i.test(e.message) ? "invalid_argument" : "unavailable"});
  // Lecture d'une collection : tout au départ, puis seulement ce qui a changé (maj plus récent que le dernier vu, avec
  // une marge pour les horloges décalées). Le temps réel apporte les écritures des collègues ; une suppression, une
  // erreur ou un tour sur dix relisent tout.
  const MARGE = 5 * 60000, retraits = new Map();   // retraits : collection -> fonctions qui enlèvent un document des vues
  const db = {collection: col => ({
    doc: id => ({
      set: async data => { const {error} = await sb.from("app_doc").upsert({collection: col, id, data, maj: new Date().toISOString(), par: session.user.id}); if (error) throw erreur(error); },
      delete: async () => { const {error} = await sb.from("app_doc").delete().eq("collection", col).eq("id", id); if (error) throw erreur(error);
        for (const f of retraits.get(col) || []) f(String(id)); }}),   // retiré tout de suite, même si le temps réel est coupé
    onSnapshot: (fn, err) => {
      let actif = true, docs = new Map(), dernier = 0, derComplete = 0, tours = 0, abonne = 0, niveau = 0, t = null, te = null, file = Promise.resolve();
      const emettre = () => { if (actif) fn({docs: [...docs].map(([id, data]) => ({id, data: () => data}))}); };
      const emettreBientot = () => { clearTimeout(te); te = setTimeout(emettre, 300); };
      const lire = async depuis => {
        const lignes = [];
        for (let de = 0; ; de += 1000) {
          let q = sb.from("app_doc").select("id,data,maj").eq("collection", col);
          q = depuis ? q.gt("maj", depuis).order("maj").order("id") : q.order("id");
          const {data, error} = await q.range(de, de + 999);
          if (error) throw error;
          lignes.push(...(data || [])); if (!data || data.length < 1000) return lignes;
        }
      };
      const noter = lignes => { for (const r of lignes) { const ms = Date.parse(r.maj); if (ms > dernier) dernier = ms; } };
      const complete = async () => {
        derComplete = Date.now();
        try { const lignes = await lire(null); docs = new Map(lignes.map(r => [String(r.id), r.data])); dernier = 0; noter(lignes); emettre(); }
        catch (e) { if (err) err(e); }
      };
      const increment = async () => {
        if (!dernier) return complete();
        let lignes;
        try { lignes = await lire(new Date(dernier - MARGE).toISOString()); } catch { return complete(); }   // erreur : relecture complète
        noter(lignes);
        let change = false;
        for (const r of lignes) { const id = String(r.id);
          if (!docs.has(id) || JSON.stringify(docs.get(id)) !== JSON.stringify(r.data)) { docs.set(id, r.data); change = true; } }
        if (change) emettre();
      };
      // 1 : relecture incrémentale ; 2 : relecture complète (la plus forte demandée l'emporte)
      const bientot = n => { niveau = Math.max(niveau, n); clearTimeout(t);
        t = setTimeout(() => { const k = niveau; niveau = 0; file = file.then(() => actif && (k === 2 ? complete() : increment())).catch(() => {}); }, 300); };
      const recu = p => {
        const r = p && p.new;
        if (r && r.collection === col && r.id != null && r.data !== undefined) { docs.set(String(r.id), r.data); emettreBientot(); }
        else bientot(1);   // message incomplet (trop gros pour le temps réel) : on relit ce qui a changé
      };
      file = file.then(complete);
      const canal = sb.channel("doc-" + col)
        .on("postgres_changes", {event: "INSERT", schema: "public", table: "app_doc", filter: `collection=eq.${col}`}, recu)
        .on("postgres_changes", {event: "UPDATE", schema: "public", table: "app_doc", filter: `collection=eq.${col}`}, recu)
        // suppressions faites par les collègues : lues dans l'historique (une ligne ajoutée, « apres » vide), dont la
        // diffusion respecte les règles d'accès ; les suppressions de app_doc ne sont plus diffusées (db/site.sql)
        .on("postgres_changes", {event: "INSERT", schema: "public", table: "app_doc_historique", filter: `collection=eq.${col}`},
          p => { const h = p && p.new;
            if (!h || h.apres === undefined) bientot(2);   // message incomplet (trop gros pour le temps réel) : relecture
            else if (h.apres === null && h.id != null) retirer(String(h.id)); })
        // ancienne diffusion des suppressions, tant que db/site.sql n'a pas été rejoué (sans effet ensuite)
        .on("postgres_changes", {event: "DELETE", schema: "public", table: "app_doc"},
          p => { const o = p && p.old; if (!o || !o.collection || o.collection === col) bientot(2); })
        .subscribe(etat => {
          if (etat === "CHANNEL_ERROR" || etat === "TIMED_OUT") { if (Date.now() - derComplete > 60000) bientot(2); }
          else if (etat === "SUBSCRIBED" && abonne++) bientot(1);   // reconnexion : rattraper ce qui a été manqué
        });
      const repli = setInterval(() => bientot(++tours % 10 ? 1 : 2), 60000);   // si le temps réel décroche
      const retirer = id => { if (docs.delete(id)) emettreBientot(); };
      if (!retraits.has(col)) retraits.set(col, new Set());
      retraits.get(col).add(retirer);
      let oublier = () => {};
      const arreter = () => { actif = false; retraits.get(col).delete(retirer); clearInterval(repli); clearTimeout(t); clearTimeout(te); oublier(); try { sb.removeChannel(canal); } catch {} };
      oublier = P.surArret(arreter);
      return arreter;
    }})};
  const user = {id: async () => session.user.id, can: async () => true, me: async () => ({name: prenom})};
  user.profiles = async ids => {
    const {data} = await sb.from("membre").select("user_id,prenom").in("user_id", ids);
    return Object.fromEntries((data || []).map(r => [r.user_id, {name: r.prenom}]));
  };
  const downloads = {save: async ({filename, data}) => P.telecharger(filename, data)};

  // Claude (recherche en langage naturel) : la base met la question en file (ia_demander, clé API dans Vault côté
  // Supabase, jamais dans la page) et la page vient chercher la réponse chaque seconde (ia_reponse)
  const echec = (code, message) => Object.assign(new Error(message), {code});
  const sample = async (input, opts = {}) => {
    const consigne = typeof input === "string" ? input : input.filter(t => t.role === "user").map(t => typeof t.content === "string" ? t.content : "").join("\n\n");
    const {data: n, error} = await sb.rpc("ia_demander", {consigne});
    if (error) throw echec(error.hint === "rate_limited" ? "rate_limited" : error.code === "42501" ? "not_granted" : "unavailable", error.message);
    for (const debut = Date.now(); Date.now() - debut < 150000; ) {
      if (opts.signal && opts.signal.aborted) throw echec("cancelled", "annulé");
      await new Promise(ok => setTimeout(ok, 1000));
      const {data: r, error: e2} = await sb.rpc("ia_reponse", {num: n});
      if (e2) throw echec("unavailable", e2.message);
      if (r.etat === "ok") return {text: r.texte, truncated: !!r.tronque};
      if (r.etat === "erreur") throw echec(r.code || "unavailable", r.message);
    }
    throw echec("unavailable", "Claude n'a pas répondu à temps");
  };
  sample.json = async (input, opts) => {
    const {text} = await sample(input, opts);
    const t = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""), a = t.indexOf("{"), b = t.lastIndexOf("}");
    return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
  };

  window.claude = {use: async n => n === "db" ? db : n === "user" ? user : n === "downloads" ? downloads : n === "sample" ? sample : null};
  window.__site = {prenom, deconnexion: P.deconnecter, changerMdp: P.changerMdp};

  // menu des modules dans l'en-tête de l'application, à côté du logo
  const marque = document.querySelector("header .brand");
  if (marque && P.modules.length > 1) marque.after(P.menuModules());
})();
