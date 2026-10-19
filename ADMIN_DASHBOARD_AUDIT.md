# Audit initial — dashboard GHORBEL AutoPièces 360

## Phase 1 : dépôt, architecture et données

### Base existante

- Monorepo npm avec `apps/web` (React 19, TypeScript, Vite, React Query) et `apps/api` (Express 5, TypeScript, Prisma 6, PostgreSQL).
- Le schéma contient les comptes, le catalogue pièces et véhicules, les offres fournisseurs, les entrepôts et mouvements de stock, les commandes et leurs instantanés financiers, les événements de paiement, les factures fournisseurs, les notifications et le journal d’audit.
- Les migrations PostgreSQL sont versionnées. La migration `20261016260000_customer_addresses` porte leur nombre à 26.
- Les routes d’administration sont protégées côté serveur par `requireAuth` et `requireAdmin`. Les fournisseurs et acheteurs ont des routes distinctes et des sélections de données restreintes.

### Fonctionnalités admin déjà persistées

- Vue analytique tirée de PostgreSQL : ventes, panier moyen, commandes du jour, encaissements confirmés, stock, catalogue vérifié, marge estimée, virements à contrôler, offres et factures à examiner.
- Gestion de commandes, validation des paiements, téléchargement du récapitulatif PDF et examen de justificatifs.
- Import CSV du catalogue avec prévisualisation, gestion des offres et vérification sourcée des compatibilités.
- Stocks multi-entrepôts avec mouvements journalisés et seuils minimums.
- Fournisseurs/revendeurs, profils tarifaires, paramètres de virement, factures fournisseurs, notifications et audit.

### Écarts et risques à traiter

1. L’interface d’administration était une grande boîte de dialogue avec des ancres. La coque de travail dispose maintenant d’une navigation latérale, d’une zone de contenu scrollable, du profil, des notifications et de la déconnexion.
2. Le modèle de rôles reste limité à `ADMIN`, `SUPPLIER`, `RESELLER` et `CUSTOMER`. Il n’existe pas encore de permissions granulaires par module. Les endpoints admin exigent actuellement le rôle ADMIN.
3. La vue d’ensemble affiche maintenant les ventes du jour tunisien, du mois et de l’année, la comparaison de la période choisie à la période précédente, les commandes par état opérationnel, les clients/fournisseurs actifs, les références vendables et les ruptures/seuils bas calculés à partir du stock. Les filtres supportent actuellement 7, 30 ou 90 jours.
4. Les graphiques utilisent des barres CSS légères; chaque barre de ventes quotidiennes est désormais accessible au clavier et ouvre les commandes de la journée sélectionnée. Les graphiques par catégorie et par classement restent des synthèses sans navigation vers leurs lignes sources. Recharts n’est pas installé.
5. Les commandes admin disposent maintenant d’une recherche par numéro, client, pièce ou référence, de filtres combinables par état, paiement, type de client et date, d’une pagination serveur et d’un export CSV reprenant les mêmes filtres. L’export détaille les lignes, fournisseurs, prix figés, TVA et statuts; il est limité à 10 000 commandes et journalisé. Le catalogue permet maintenant d’archiver et de rétablir une pièce sans supprimer ses commandes historiques; l’édition complète du catalogue et de ses compatibilités reste à construire.
6. Il n’y a pas d’écran consolidé pour les clients particuliers ni de rapports complets/export PDF. Le document de commande est un récapitulatif, pas une facture légale validée.
7. Le taux de vente est actuellement à 19 % conformément à la consigne explicite antérieure du propriétaire. Les factures tunisiennes doivent rester non officielles tant que leur conformité n’a pas été validée.
8. Aucun socle de tests automatisés n’est configuré à ce stade. Ils devront couvrir en priorité les permissions, les paiements, les instantanés de prix et les réservations concurrentes de stock.

## Phases d’implémentation

- **Phase 2 (socle livré)** : coque responsive de l’administration, navigation et accès au compte.
- **Phase 3 (en cours)** : compléter les analyses comparatives et rendre les graphiques interactifs.
- **Phase 4 (en cours)** : filtres, pagination et exports CSV filtrés des commandes livrés; archivage et restauration des pièces livrés. Restent l’édition complète du catalogue et la gestion admin des compatibilités.
- **Phase 5** : écrans clients et fournisseurs, règles B2B et stock.
- **Phase 6** : paiements, documents, rapports et notifications.
- **Phase 7** : permissions granulaires, audit sécurité, accessibilité et tests critiques.

### Ajout : répertoire des utilisateurs

- L’administration dispose maintenant d’une section « Utilisateurs » couvrant clients, fournisseurs, revendeurs et administrateurs, avec recherche, filtres par rôle/statut et pagination serveur.
- Un administrateur peut modifier le nom, l’e-mail, le téléphone, l’entreprise et le statut d’un compte. Le rôle est volontairement affiché et reste protégé contre les changements accidentels.
- La réinitialisation du mot de passe est une action séparée, avec confirmation côté interface et hachage scrypt côté API. Seul le message de réussite est rendu; ni le mot de passe ni son hash ne sont renvoyés ou inscrits dans l’audit.
- Les changements de profil et les réinitialisations sont journalisés dans l’audit administratif.


### Navigation par pages

- Chaque rubrique du dashboard a désormais une route dédiée (/admin/dashboard, /admin/users, /admin/buyers, /admin/partners, /admin/offers, /admin/stock, /admin/pricing, /admin/orders, /admin/invoices, /admin/catalog, /admin/audit, /admin/settings). Le contenu affiché est limité à la page choisie.
- Ajout d’une page Acheteurs qui filtre les comptes clients CUSTOMER; le rôle et le modèle d’inscription restent inchangés, les clients s’inscrivent comme particuliers.


### Modification des pièces par le fournisseur

- Les fournisseurs peuvent modifier leur SKU interne, nom, catégorie, marque, description, photos, coût d’achat et taux de TVA depuis la fiche de leur offre.
- Une baisse de coût est appliquée immédiatement à l’offre; les commandes existantes conservent leur instantané de prix. Une hausse crée un champ de prix en attente et laisse l’ancien prix actif jusqu’à la décision admin.
- Les demandes de hausse sont visibles dans « Offres à valider », comptées dans l’indicateur de tâches à traiter et peuvent être approuvées ou refusées. Le fournisseur reçoit une notification. Les modifications et décisions sont auditées.
- Migration 20261016270000_supplier_offer_price_approval appliquée à PostgreSQL local.


### Upload direct des photos fournisseur

- Les formulaires fournisseur acceptent maintenant l’envoi direct de photos JPEG, PNG ou WebP, avec limite de 5 Mo par fichier et 8 images par pièce; l’ajout d’une URL HTTPS reste disponible en complément.
- L’API vérifie le type MIME et la signature binaire, attribue un nom UUID et sert les fichiers depuis /uploads. Le chemin du stockage se configure avec UPLOADS_DIR; localement, les fichiers restent dans pps/api/uploads/ (exclu de Git).
- Un hébergement avec disque éphémère devra fournir un stockage persistant pour conserver les fichiers après redémarrage.

\n