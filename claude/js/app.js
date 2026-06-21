/* ============================================================
   APP.JS — Point d'entrée, intégration GRIST API, événements
============================================================ */

'use strict';

/* ------------------------------------------------------------
   DONNÉES GLOBALES PARTAGÉES
------------------------------------------------------------ */
let allRecords = [];

/* ------------------------------------------------------------
   FLAGS DE SYNCHRONISATION
   Permettent d'attendre que les deux sources (options ET records)
   soient disponibles avant de construire la barre de filtres.
   
   Problème résolu : grist.onOptions() et grist.onRecords() sont
   deux callbacks indépendants dont l'ordre d'arrivée n'est pas
   garanti. Si onRecords arrive avant onOptions, config.colRegion
   et config.colDept sont encore vides → les filtres région et
   département ne sont pas créés.
   
   Solution : on pose deux drapeaux et on ne lance buildFilterBar()
   que quand les deux sont levés.
------------------------------------------------------------ */
let _optionsReady = false;  // true quand onOptions a peuplé config
let _recordsReady = false;  // true quand allRecords est peuplé

/**
 * Tente de construire la barre de filtres.
 * N'exécute buildFilterBar() que si les deux conditions sont réunies :
 *   1. config est peuplé (options reçues de GRIST)
 *   2. allRecords est peuplé (données reçues de GRIST)
 *
 * Cette fonction est appelée depuis onGristOptions() ET depuis
 * grist.onRecords() pour que le premier arrivé attende le second.
 */
function tryBuildFilterBar() {
  // Condition de garde : les deux sources doivent être prêtes
  if (!_optionsReady || !_recordsReady) {
    console.debug(
      '[app.js] tryBuildFilterBar() en attente —',
      `options:${_optionsReady} records:${_recordsReady}`
    );
    return;
  }

  console.debug('[app.js] Les deux sources prêtes → buildFilterBar()');
  buildFilterBar();
  showStatus('Données chargées. Sélectionnez des filtres puis mettez à jour la carte.');
}

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
 * @param {string} msg      - Message à afficher
 * @param {number} duration - Durée en ms (défaut : 4000)
 */
function showStatus(msg, duration = 4000) {
  const el       = document.getElementById('status-msg');
  el.textContent = msg;
  el.style.display = 'block';

  if (_statusTimer) clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => {
    el.style.display = 'none';
  }, duration);
}

/* ============================================================
   CONVERSION DU FORMAT DE TABLE GRIST
   
   Convertit le format columnar GRIST :
     { col1: [v1,v2,...], col2: [v1,v2,...] }
   en tableau de records row-oriented :
     [{ col1:v1, col2:v1 }, { col1:v2, col2:v2 }, ...]
   
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
 * du widget sont disponibles.
 *
 * Deux stratégies de chargement des données sont gérées :
 *
 * A) fetchTable (mode autonome) :
 *    Si config.tableId est défini, on récupère les données
 *    directement via l'API. Dans ce cas c'est onGristOptions
 *    qui peuple allRecords, et _recordsReady est levé ici.
 *
 * B) onRecords (mode linked widget) :
 *    GRIST pousse les records automatiquement via onRecords.
 *    Dans ce cas _recordsReady est levé dans grist.onRecords().
 *
 * Dans les deux cas, tryBuildFilterBar() vérifie que les deux
 * flags sont levés avant de construire les filtres.
 *
 * @param {Object|null} options - Options stockées dans GRIST
 */
function onGristOptions(options) {
  if (!options) {
    console.warn('[app.js] onGristOptions : aucune option reçue');
    return;
  }

  // Fusionner les options dans l'objet config global (défini dans config.js)
  Object.assign(config, {
    tableId    : '',
    colCoords  : '',
    colTitle   : '',
    colRegion  : '',
    colDept    : '',
    infoCols   : [],
    filterCols : []
  }, options);

  // Marquer les options comme prêtes
  _optionsReady = true;

  console.debug('[app.js] onGristOptions → config peuplé :', config);

  // Stratégie A : chargement direct via fetchTable
  // Utilisé quand le widget n'est pas en mode "linked widget"
  if (config.tableId) {
    showLoader(true);

    grist.docApi.fetchTable(config.tableId)
      .then(tableData => {
        allRecords    = gristTableToRecords(tableData);
        _recordsReady = true; // Les données sont disponibles

        console.debug(`[app.js] fetchTable OK → ${allRecords.length} enregistrements`);

        // Tenter la construction des filtres
        // (config EST déjà prêt ici car on est dans le .then de fetchTable
        //  qui est lui-même appelé depuis onGristOptions → les deux flags
        //  sont levés → buildFilterBar() s'exécute immédiatement)
        tryBuildFilterBar();
      })
      .catch(err => {
        console.error('[app.js] Erreur fetchTable :', err);
        showStatus(`Erreur lors du chargement de la table "${config.tableId}".`);
      })
      .finally(() => {
        showLoader(false);
      });

  } else {
    // Pas de tableId configuré : on dépend du mode linked widget (onRecords)
    // On tente quand même au cas où onRecords serait déjà arrivé
    console.debug('[app.js] Pas de tableId → attente de onRecords');
    tryBuildFilterBar();
  }
}

/**
 * Stratégie B : GRIST pousse les records via onRecords.
 * Appelé automatiquement quand la table liée change ou
 * quand une ligne est sélectionnée (linked widget).
 *
 * Ce callback peut arriver AVANT ou APRÈS onOptions.
 * tryBuildFilterBar() gère les deux cas.
 */
grist.onRecords(records => {
  if (!records || records.length === 0) {
    console.debug('[app.js] onRecords : aucun enregistrement reçu');
    return;
  }

  allRecords    = records;
  _recordsReady = true; // Les données sont disponibles

  console.debug(`[app.js] onRecords → ${allRecords.length} enregistrements`);

  // Tenter la construction des filtres
  // Si onOptions n'est pas encore arrivé, _optionsReady = false
  // → tryBuildFilterBar() attend sans rien faire
  tryBuildFilterBar();
});

/**
 * Écouter les mises à jour des options du widget.
 * Appelé aussi lors d'un saveConfig() via grist.setOptions().
 * On réinitialise les flags pour forcer un rechargement complet.
 */
grist.onOptions(options => {
  console.debug('[app.js] onOptions appelé');

  // Réinitialiser les flags : une nouvelle config nécessite
  // de recharger les données avec les nouveaux paramètres
  _optionsReady = false;
  _recordsReady = false;

  onGristOptions(options);
});

/**
 * Enregistrement du widget auprès de GRIST.
 * - requiredAccess : droits minimum nécessaires
 * - onEditOptions  : ouvre le panneau de configuration
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

document.getElementById('btn-update')
  .addEventListener('click', updateMap);

document.getElementById('btn-reset')
  .addEventListener('click', resetFilters);

document.getElementById('info-card-close')
  .addEventListener('click', hideInfoCard);

document.getElementById('btn-config-save')
  .addEventListener('click', saveConfig);

document.getElementById('btn-config-cancel')
  .addEventListener('click', closeConfigPanel);

document.getElementById('btn-add-info')
  .addEventListener('click', () => addDynamicItem('list-info-cols', 'info'));

document.getElementById('btn-add-filter')
  .addEventListener('click', () => addDynamicItem('list-filter-cols', 'filter'));

/* ============================================================
   DÉMARRAGE DE L'APPLICATION
============================================================ */

// Initialiser la carte Leaflet
initMap();

// Pré-charger le GeoJSON des départements en arrière-plan
loadDeptGeoJSON();
