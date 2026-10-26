/* Accueil de la plateforme (index.html) : une tuile par module accessible.
   Sans « #accueil » dans l'adresse, renvoie tout de suite au dernier module ouvert sur cet appareil : les anciens
   favoris (l'adresse du site) mènent toujours à la Prospection. Le menu « Accueil » des modules pointe vers index.html#accueil. */
(() => {
  "use strict";
  const conf = window.plateforme.conf;
  if (location.hash !== "#accueil") {
    let dernier = null;
    try { dernier = localStorage.getItem("plateforme:dernier"); } catch {}
    if (dernier && (conf.modules || []).some(m => m.page === dernier)) { location.replace(dernier); return; }
  }
  (async () => {
    let P;
    try { P = await window.plateforme.pret; } catch { return; }   // refus ou erreur : la coquille l'a déjà affiché
    document.getElementById("accueil-prenom").textContent = P.moi.prenom;
    const tuiles = document.getElementById("accueil-tuiles");
    for (const m of P.modules) {
      const a = document.createElement("a"); a.className = "cq-tuile"; a.href = m.page;
      const nom = document.createElement("b"); nom.textContent = m.nom;
      const desc = document.createElement("span"); desc.textContent = m.description || "";
      a.append(nom, desc);
      if (m.statut && m.statut !== "en service") { const e = document.createElement("em"); e.textContent = m.statut; a.appendChild(e); }
      tuiles.appendChild(a);
    }
    document.getElementById("accueil-page").hidden = false;
  })();
})();
