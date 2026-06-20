# Widget Carte IGN — GRIST Custom Widget

Carte interactive IGN intégrable dans GRIST via l'API Custom Widget.

## Structure des fichiers

```
widget-carte-ign/
├── index.html        # Structure HTML + chargement des ressources
├── css/
│   ├── main.css      # Styles : layout, carte, filtres, cartouche info
│   └── config.css    # Styles : panneau de configuration modal
├── js/
│   ├── config.js     # Objet config global + panneau de configuration
│   ├── filters.js    # Barre de filtres dynamiques et réactifs
│   ├── map.js        # Carte Leaflet, marqueurs, départements, légende
│   └── app.js        # Point d'entrée, GRIST API, événements boutons
└── README.md
```

## Dépendances

| Bibliothèque | Version | Usage |
|---|---|---|
| Leaflet | 1.9.4 | Moteur cartographique |
| GRIST Plugin API | latest | Communication avec GRIST |
| france-geojson | — | Contours départements (CDN GitHub) |
| IGN Géoportail WMTS | — | Fond de carte Plan IGN v2 |

## Configuration du widget

1. Dans GRIST, créer un Custom Widget pointant vers `index.html`
2. Cliquer sur **⚙️ Options** → le panneau de configuration s'ouvre
3. Renseigner :
   - **Table liée** : nom exact de la table GRIST
   - **Colonne coordonnées** : format `lat,lon` (ex: `48.85,2.35`)
   - **Colonne titre** : affiché sur l'épingle et en tête du cartouche
   - **Colonne région / département** : pour les filtres auto et la coloration
   - **Variables cartouche** : colonnes affichées dans le panneau info
   - **Variables filtres** : colonnes supplémentaires dans la barre de filtres

## Flux de données

```
GRIST (onOptions / onRecords)
        │
        ▼
  allRecords (app.js)
        │
        ├──► buildFilterBar()   (filters.js)
        │         │
        │         └──► reactiveFilters()  — mise à jour en cascade
        │
        └──► updateMap()        (map.js)
                  │
                  ├──► applyCurrentFilters()  (filters.js)
                  ├──► drawDepartements()
                  ├──► marqueurs Leaflet
                  └──► updateLegend()
```
