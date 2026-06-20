/* ============================================================
   APP.JS — Point d'entrée, intégration GRIST API, événements
   
   Responsabilités :
   - Déclarer les données globales partagées (allRecords)
   - Initialiser la carte et pré-charger le GeoJSON
   - Brancher les callbacks GRIST (onRecords, onOptions, ready)
   - Convertir le format de table GRIST en tableau d'objets
   - Wirer les événements des boutons de l'interface
   - Fournir les utilitaires UI partagés (showLoader, showStatus)
   
   Dépend de : config.js, filters.js, map.js
   (chargés avant dans index.html)
============================================================ */

'use strict';

/* ------------------------------------------------------------
   DONNÉES GLOBALES PARTAGÉES
   Accédées par filters.js et map.js
------------------------------------------------------------ */
let allRecords = []; // Tous les enregistrements reçus de GRIST

/* ============================================================
   UTILITAIRES UI PARTAGÉS
============================================================ */

/**
 * Affiche ou masque le spinner de chargement.
 * @param {boolean} visible
 */
function showLoader(visible) {
  document.getElementById('loader').classList.toggle('visible', visible);
}

/** Timer interne pour auto-masquer le message d'état */
let _statusTimer = null;

/**
 * Affiche un message transitoire en bas de carte.
 * Disparaît automatiquement après `duration` ms.
 *
 * @param {string} msg      - Message à afficher
 * @param {number} duration - Durée en ms (défaut : 4000)
 */
function showStatus(msg, duration = 4000) {
  const el      = document.getElementById('status-msg');
  el.textContent = msg;
  el.style.display = 'block';

  if (_statusTimer) clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => {
    el.style.display = 'none';
  }, duration);
}

/* ============================================================
   CONVERSION DU FORMAT DE TABLE GRIST
   
   GRIST renvoie les tables sous la forme columnar :
     { col1: [v1, v2, …], col2: [v1, v2, …], … }
   On le transforme en tableau de records row-oriented :
     [{ col1: v1, col2: v1, … }, { col1: v2, col2: v2, … }, …]
   
   @param  {Object} tableData - Données brutes GRIST
   @return {Array}            - Tableau d'objets (un par ligne)
============================================================ */
function gristTableToRecords(tableData) {
  if (!tableData) return [];

  const columns = Object.keys(tableData);
  if (columns.length === 0) return [];

  const rowCount = tableData[columns[0]].length;
  const records  = [];

  for (let i = 0; i < rowCount; i++) {
    const record = {};
    columns.forEach(col => { record[col] = tableData[col][i]; });
    records.push(record);
  }

  return records;
}

/* ============================================================
   INTÉGRATION GRIST API
============================================================ */

/**
 * Callback appelé par GRIST quand les options sauvegardées
 * du widget sont disponibles (au chargement ou après saveConfig).
 *
 * Met à jour `config`, charge les données de la table configurée
 * et reconstruit la barre de filtres.
 *
 * @param {Object|null} options - Options stockées dans GRIST
 */
function onGristOptions(options) {
  if (!options) return;

  // Fusionner les options reçues dans l'objet config global
  Object.assign(config, {
    tableId    : '',
    colCoords  : '',
    colTitle   : '',
    colRegion  : '',
    colDept    : '',
    infoCols   : [],
    filterCols : []
  }, options);

  // Si une table est configurée, récupérer ses données via l'API GRIST
  if (config.tableId) {
    grist.docApi.fetchTable(config.tableId)
      .then(tableData => {
        allRecords = gristTableToRecords(tableData);
        buildFilterBar();
        showStatus('Données chargées. Sélectionnez des filtres puis mettez à jour la carte.');
      })
      .catch(err => {
        console.error('[app.js] Erreur fetchTable :', err);
        showStatus(`Erreur lors du chargement de la table "${config.tableId}".`);
      });
  }
}

/**
 * Appelé par GRIST quand les enregistrements de la table liée
 * changent (mode "Linked widget" ou sélection de ligne).
 * Met à jour allRecords et reconstruit la barre de filtres.
 */
grist.onRecords(records => {
  if (!records || records.length === 0) return;
  allRecords = records;
  buildFilterBar();
});

/**
 * Appelé par GRIST lors d'un changement d'options du widget
 * (ex : après saveConfig ou rechargement du document).
 */
grist.onOptions(options => {
  onGristOptions(options);
});

/**
 * Enregistrement du widget auprès de GRIST.
 * - requiredAccess : droits minimum nécessaires
 * - onEditOptions  : callback GRIST pour ouvrir la configuration
 */
grist.ready({
  requiredAccess: 'read table',
  onEditOptions : () => {
    openConfigPanel();
  }
});

/* ============================================================
   CÂBLAGE DES ÉVÉNEMENTS BOUTONS
============================================================ */

// Mettre à jour la carte avec les filtres actifs
document.getElementById('btn-update')
  .addEventListener('click', updateMap);

// Réinitialiser tous les filtres
document.getElementById('btn-reset')
  .addEventListener('click', resetFilters);

// Fermer le cartouche d'information
document.getElementById('info-card-close')
  .addEventListener('click', hideInfoCard);

// Sauvegarder la configuration (config.js)
document.getElementById('btn-config-save')
  .addEventListener('click', saveConfig);

// Annuler / fermer le panneau de configuration (config.js)
document.getElementById('btn-config-cancel')
  .addEventListener('click', closeConfigPanel);

// Ajouter une variable dans la liste du cartouche info (config.js)
document.getElementById('btn-add-info')
  .addEventListener('click', () => addDynamicItem('list-info-cols', 'info'));

// Ajouter un filtre dans la liste des filtres (config.js)
document.getElementById('btn-add-filter')
  .addEventListener('click', () => addDynamicItem('list-filter-cols', 'filter'));

/* ============================================================
   DÉMARRAGE DE L'APPLICATION
============================================================ */

// Initialiser la carte Leaflet
initMap();

// Pré-charger le GeoJSON des départements en arrière-plan
// pour réduire le délai lors du premier clic "Mettre à jour"
loadDeptGeoJSON();
