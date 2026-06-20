/* ============================================================
   CONFIG.JS — Gestion du panneau de configuration GRIST
   
   Responsabilités :
   - Définir et exposer l'objet `config` (état global partagé)
   - Ouvrir/fermer le panneau de configuration
   - Lire/écrire la configuration depuis/vers les options GRIST
   - Gérer les listes dynamiques (infoCols, filterCols)
============================================================ */

'use strict';

/* ------------------------------------------------------------
   CONFIGURATION PAR DÉFAUT
   Cet objet est la source de vérité pour tous les modules.
   Il est peuplé au démarrage via grist.onOptions() dans app.js
------------------------------------------------------------ */
const config = {
  tableId    : '',   // Nom / ID de la table GRIST à afficher
  colCoords  : '',   // Colonne contenant "lat,lon"
  colTitle   : '',   // Colonne utilisée comme titre de l'épingle
  colRegion  : '',   // Colonne région (filtre auto + coloration)
  colDept    : '',   // Colonne département (filtre auto + coloration)
  infoCols   : [],   // Colonnes affichées dans le cartouche info
  filterCols : []    // Colonnes proposées comme filtres dans la barre
};

/* ============================================================
   OUVERTURE DU PANNEAU
   Pré-remplit tous les champs avec les valeurs de `config`
============================================================ */
function openConfigPanel() {
  // Champs texte simples
  document.getElementById('cfg-table').value       = config.tableId   || '';
  document.getElementById('cfg-col-coords').value  = config.colCoords || '';
  document.getElementById('cfg-col-title').value   = config.colTitle  || '';
  document.getElementById('cfg-col-region').value  = config.colRegion || '';
  document.getElementById('cfg-col-dept').value    = config.colDept   || '';

  // Listes dynamiques (variables cartouche et filtres)
  renderDynamicList('list-info-cols',   'info',   config.infoCols);
  renderDynamicList('list-filter-cols', 'filter', config.filterCols);

  // Rendre le panneau visible
  document.getElementById('config-panel').classList.add('visible');
}

/* ============================================================
   FERMETURE DU PANNEAU (sans sauvegarder)
============================================================ */
function closeConfigPanel() {
  document.getElementById('config-panel').classList.remove('visible');
}

/* ============================================================
   SAUVEGARDE DE LA CONFIGURATION
   Lit les champs du formulaire, valide, met à jour `config`
   et persiste dans les options GRIST via grist.setOptions()
============================================================ */
async function saveConfig() {
  const newConfig = {
    tableId   : document.getElementById('cfg-table').value.trim(),
    colCoords : document.getElementById('cfg-col-coords').value.trim(),
    colTitle  : document.getElementById('cfg-col-title').value.trim(),
    colRegion : document.getElementById('cfg-col-region').value.trim(),
    colDept   : document.getElementById('cfg-col-dept').value.trim(),
    infoCols  : readDynamicList('list-info-cols'),
    filterCols: readDynamicList('list-filter-cols')
  };

  // Validation minimale : la table est obligatoire
  if (!newConfig.tableId) {
    alert('Le nom de la table est requis.');
    return;
  }

  // Mettre à jour l'objet global partagé entre les modules
  Object.assign(config, newConfig);

  // Persister dans GRIST (sera renvoyé via onOptions au rechargement)
  await grist.setOptions(config);

  closeConfigPanel();

  // Reconstruire la barre de filtres avec la nouvelle configuration
  buildFilterBar();
  showStatus('Configuration sauvegardée. Sélectionnez des filtres puis mettez à jour la carte.');
}

/* ============================================================
   LISTES DYNAMIQUES — RENDU
   Vide le conteneur et reconstruit chaque item à partir
   d'un tableau de valeurs existantes.
   
   @param {string} containerId - ID du div conteneur
   @param {string} type        - 'info' ou 'filter' (placeholder)
   @param {Array}  values      - Valeurs existantes à pré-remplir
============================================================ */
function renderDynamicList(containerId, type, values) {
  const container = document.getElementById(containerId);
  container.innerHTML = ''; // Vider avant de reconstruire

  (values || []).forEach(val => {
    _addDynamicItemWithValue(containerId, type, val);
  });
}

/* ============================================================
   LISTES DYNAMIQUES — AJOUT D'UN ITEM VIDE
   Appelée par les boutons "Ajouter une variable / un filtre"
   
   @param {string} containerId - ID du div conteneur
   @param {string} type        - 'info' ou 'filter'
============================================================ */
function addDynamicItem(containerId, type) {
  _addDynamicItemWithValue(containerId, type, '');
}

/* ============================================================
   LISTES DYNAMIQUES — FONCTION INTERNE DE CRÉATION D'UN ITEM
   Crée un div.dynamic-item avec un <input> et un bouton suppr.
   
   @param {string} containerId - ID du div conteneur
   @param {string} type        - 'info' ou 'filter'
   @param {string} value       - Valeur initiale du champ
============================================================ */
function _addDynamicItemWithValue(containerId, type, value) {
  const container   = document.getElementById(containerId);
  const placeholder = (type === 'info') ? 'ex: adresse' : 'ex: statut';

  // Conteneur de la ligne
  const item = document.createElement('div');
  item.className = 'dynamic-item';

  // Champ texte pour le nom de colonne
  const input       = document.createElement('input');
  input.type        = 'text';
  input.value       = value;
  input.placeholder = placeholder;

  // Bouton de suppression de cet item
  const btnDel     = document.createElement('button');
  btnDel.textContent = '✕';
  btnDel.title       = 'Supprimer';
  btnDel.onclick     = () => item.remove();

  item.appendChild(input);
  item.appendChild(btnDel);
  container.appendChild(item);
}

/* ============================================================
   LISTES DYNAMIQUES — LECTURE DES VALEURS
   Parcourt tous les inputs d'un conteneur de liste dynamique
   et retourne un tableau des valeurs non vides.
   
   @param  {string} containerId - ID du div conteneur
   @return {Array}              - Tableau de noms de colonnes
============================================================ */
function readDynamicList(containerId) {
  return Array.from(
    document.querySelectorAll(`#${containerId} .dynamic-item input`)
  )
    .map(inp => inp.value.trim())
    .filter(Boolean); // Éliminer les chaînes vides
}
