/* Module Data Room Access : page d'attente tant que le module est en co-construction (voir docs/ARCHITECTURE.md §5).
   Réservé à l'équipe tant que le socle des droits (étape 3) n'est pas en base. */
(async () => {
  "use strict";
  try { await window.plateforme.pret; } catch { return; }   // refus ou erreur : la coquille l'a déjà affiché
  document.getElementById("dr").hidden = false;
})();
