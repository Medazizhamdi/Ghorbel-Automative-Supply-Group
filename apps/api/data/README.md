# Données automobiles importées

Ce répertoire contient l’instantané `vehicle-makes-models.json` version 1.0.2 (commit `ee99776`), importé dans PostgreSQL par `prisma/import-vehicle-catalog.ts`.

**Attribution requise :** vehicle-makes-models et Autoevolution, source amont des marques, modèles, générations et motorisations. Projet source : <https://github.com/gor3a/vehicle-makes-models>. Les données sont distribuées sous **Open Database License (ODbL) v1.0** : <https://opendatacommons.org/licenses/odbl/1-0/>.

Les lignes importées portent le statut `CONTRIBUTED`, la source et le lien vers le projet. Elles ne sont pas déclarées vérifiées par Ghorbel. L’export relationnel public est disponible sur `/api/catalog/vehicles/open-data` pour respecter l’obligation de partage de la base adaptée.

Le jeu couvre principalement des voitures particulières et **ne contient pas DAF**. Il ne fournit pas les correspondances de pièces. Pour les camions, bus et la compatibilité réelle des pièces, il faut compléter avec des données fournisseurs ou un catalogue aftermarket licencié.
