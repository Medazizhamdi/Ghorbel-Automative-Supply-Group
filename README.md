# AutoPièces 360

MVP catalogue automobile : interface React, API REST Express et persistance PostgreSQL via Prisma. Le dépôt ne contient aucun produit/compatibilité inventé. Les marques initiales sont des données de démonstration et ne sont pas proposées comme choix de recherche tant que des modèles vérifiés ne leur sont pas rattachés.

## Fonctionnalités livrées

- Recherche automobile dépendante : marque → modèle → génération/années → motorisation/version/carrosserie/transmission, avec recherche par nom/catégorie et référence OEM/alternative exacte, pagination et filtres conservés dans l’URL partageable.
- Une pièce issue d'une recherche véhicule n'est retournée que si le produit et son association de compatibilité ont le statut `VERIFIED`. Les compatibilités exigent une source et une date de vérification.
- Schéma PostgreSQL normalisé pour marques, modèles, générations, moteurs, produits, références et compatibilités, avec clés étrangères et index.
- Inscription client/connexion intégrées à la page, authentification API avec mots de passe hachés (scrypt), jetons HMAC expirables et limitation des tentatives.
- Inscription publique réservée aux particuliers (nom, téléphone, e-mail). Les comptes fournisseurs/revendeurs sont créés par l'administrateur, qui leur remet leurs identifiants directement.
- Espace partenaire après connexion : soumission et suivi des offres fournisseur. Les coûts d’achat et les références fournisseur sont isolés par compte, hors vues administrateur; les offres restent privées et en attente de validation.
- Initialisation de l'administrateur protégée par `ADMIN_BOOTSTRAP_KEY` et disponible uniquement tant qu'aucun administrateur n'existe.
- Écran administrateur pour créer et gérer les comptes partenaires, prévisualiser un CSV de catalogue, confirmer l'import et consulter son historique.
- Gestion fournisseur des stocks par entrepôt, journal des mouvements, validation des offres et affectation des commandes à leurs sources de stock.
- Tarifs revendeurs avec profils de remise calculés sur l’API; les prix, remises et totaux sont figés sur chaque ligne de commande.
- Commandes clients avec réservation transactionnelle, suivi fournisseur, paiement à la livraison ou virement et validation manuelle du paiement.
- Dépôt par le client connecté ou invité d’un justificatif de virement PDF/JPEG/PNG (5 Mo maximum); signature du fichier vérifiée et historique conservé dans PostgreSQL. Le paiement reste à contrôler, et seul l’admin peut télécharger la preuve.
- Commande sans compte client : code de suivi aléatoire envoyé par email, empreinte seule stockée en base et consultation privée limitée à 30 jours.
- Récapitulatif de commande PDF disponible au client et à l'administration, avec la mention TVA 19 % (Taux normal).
- Factures fournisseurs PDF déposées et suivies par commande, avec accès isolé au fournisseur propriétaire et validation ou refus par l’administration.
- Tableau de bord administrateur relié à PostgreSQL : ventes et panier moyen TTC, encaissements confirmés, tendances par jour, catégories, pièces vendues, ventes par client/revendeur et fournisseur, alertes opérationnelles et stock, filtrables sur 7, 30 ou 90 jours. Les ventes attribuées à un fournisseur sont les TTC des lignes qui lui sont affectées, et ne représentent pas son coût d’achat ni la marge.
- Export CSV administrateur des lignes de vente et de leurs instantanés HT/TVA/TTC, filtré par période et limité à 20 000 lignes par fichier.
- Journal PostgreSQL paginé des opérations sensibles (comptes, prix, offres, mouvements de stock, paiements, annulations, factures fournisseur et imports), consultable uniquement par l’administration.
- Paramètres administrateur des virements bancaires persistés dans PostgreSQL; le client voit le titulaire, la banque, le RIB et les instructions au checkout. Le mode est masqué et refusé par l’API tant qu’il n’est pas activé et complet; les paiements restent vérifiés manuellement.
- Un jeu de coordonnées fictives est disponible pour la démonstration (`RIB-DEMO-000000000000`). Le paiement reste désactivé et l’API refuse tout RIB de démonstration activé.
- Suivi d’expédition par ligne fournisseur : transporteur, référence et URL HTTP(S), visibles au client et à l’administration.
- Annulation avant expédition pour les commandes encore impayées : les quantités réservées sont libérées et journalisées.
- Centre de notifications privé et file email transactionnelle : les événements sont enregistrés avec l’opération métier, dédupliqués et envoyés via SMTP avec reprise progressive.
- API OpenAPI consultable à `/api/docs`; contrôle de disponibilité API/PostgreSQL à `/api/health`.
- Logo et bannière Ghorbel fournis dans `apps/web/public`.

## Développement local

Prérequis : Node.js 20.12+ et Docker Desktop (ou PostgreSQL 16 installé).

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

L'interface est servie sur `http://localhost:5174`, l'API sur `http://localhost:10001` et Swagger sur `http://localhost:10001/api/docs`. Les routes de catalogue restent vides jusqu'à l'import de données automobiles vérifiées; le seed ne crée que quelques noms de marques identifiés comme démonstration.

Pour activer les emails, renseigner `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` et `SMTP_FROM` dans l'environnement de l'API. Le port 587 s'utilise généralement avec `SMTP_SECURE=false` (STARTTLS) et le port 465 avec `SMTP_SECURE=true` (TLS). Utiliser le mot de passe SMTP ou mot de passe d'application fourni par le prestataire. À la création d'une commande, l'adresse e-mail du client reçoit sa confirmation, le détail des articles et totaux, ainsi que la facture PDF générée pour cette commande en pièce jointe ; cette pièce jointe est chargée depuis la facture enregistrée, y compris lors d'une nouvelle tentative d'envoi. Sans SMTP, les emails restent en attente et seront expédiés après configuration puis redémarrage de l'API. Définir aussi une valeur stable et aléatoire pour `GUEST_TOKEN_ENCRYPTION_KEY` afin que les codes invités chiffrés en attente puissent être envoyés après un redémarrage.

## Déploiement

### Render (API + PostgreSQL)

1. Créer un Blueprint Render depuis ce dépôt et appliquer `render.yaml` (Web Service Node + PostgreSQL managé).
2. Le `DATABASE_URL` de la base est lié au service API; la commande `preDeployCommand` applique les migrations. Le disque `/var/data` conserve les photos et factures téléversées entre les redémarrages; ne pas supprimer ou recréer ce disque sans sauvegarder son contenu.
3. Dans le service API, régler `WEB_ORIGIN` sur l'origine exacte du site Vercel, sans chemin (ex. `https://autopieces360.vercel.app`). Pour plusieurs origines, séparer par virgules. Render génère `JWT_SECRET`, `GUEST_TOKEN_ENCRYPTION_KEY` et `ADMIN_BOOTSTRAP_KEY`; gardez la dernière secrète et retirez-la après création de l'administrateur initial.
4. Pour les confirmations de commande par e-mail, ajouter au service Render `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` et `SMTP_FROM` avec les identifiants SMTP. Ces valeurs restent exclusivement côté serveur.
5. Vérifier `https://<api-render>/api/health` et `https://<api-render>/api/docs`.

### Vercel (frontend)

1. Importer le dépôt, conserver la racine du projet, et laisser `vercel.json` configurer l'installation, le build et le routage SPA (`apps/web/dist`).
2. Ajouter `VITE_API_URL=https://<api-render>` dans les variables de build Vercel, puis redéployer.
3. Remplacer `WEB_ORIGIN` côté Render par l'URL Vercel finale, puis redéployer l'API.

Les deux variables d'origine doivent correspondre. Aucun secret ne doit être placé dans une variable `VITE_*`. Pour créer le premier administrateur, appelez une seule fois `POST /api/auth/bootstrap-admin` avec l'en-tête `X-Bootstrap-Key` et un corps JSON contenant `email`, `password`, `firstName` et `lastName`. Puis retirez `ADMIN_BOOTSTRAP_KEY` des variables Render. L'endpoint de connexion est `POST /api/auth/login`; les routes protégées reçoivent `Authorization: Bearer <token>`.

## Données automobiles

Le seed est volontairement limité à des marques de démonstration. Il ne prétend pas représenter une base exhaustive, n'ajoute aucun moteur/année de modèle ni compatibilité, et aucun résultat de recherche véhicule n'est montré sur cette base. L'administration permet de prévisualiser puis importer un CSV; avant une mise en vente, importer un catalogue provenant d'une source autorisée, documenter sa provenance et valider les années/motorisations/liaisons produit correspondantes comme `VERIFIED`. Le modèle téléchargeable est CSV; XLSX n'est pas pris en charge.

## Limites et prérequis de mise en production

Le catalogue ne contient pas encore de source automobile sous licence ni de compatibilités exhaustives; il faut importer et vérifier ces données avant de présenter la recherche véhicule comme complète. Le flux de virement enregistre une référence puis attend le contrôle humain; aucun prestataire de paiement ni envoi d'e-mail n'est configuré. La génération de devis et factures fiscaux tunisiens n'est pas activée : les modèles, TVA et mentions doivent être validés selon le statut de l'entreprise par un professionnel en Tunisie avant tout usage officiel. Prévoir aussi la politique de livraison, les sauvegardes PostgreSQL et la rotation des secrets avant production.

Le modèle CSV est disponible dans `apps/web/public/catalog-import-template.csv`. Colonnes obligatoires : `sku`, `name`. Les séparateurs virgule, point-virgule et tabulation sont détectés automatiquement. Un import est limité à 2 Mo et 2 000 lignes; répartissez les catalogues plus grands en plusieurs imports. L’aperçu affiche les 50 premières lignes, tandis que le récapitulatif couvre tout le fichier. Une même pièce peut occuper plusieurs lignes (une référence ou compatibilité par ligne) en gardant les mêmes attributs descriptifs. Pour une compatibilité véhicule, ajouter `make`, `model`, `generation` et `yearFrom`; `yearTo`, `engine`, `engineCode`, `fuel`, `displacementCc`, `powerKw`, `variant`, `bodyStyle`, `transmission` et `drivetrain` précisent le véhicule. La recherche ignore la casse et les espaces de référence, mais conserve la ponctuation. Par nom et catégorie, elle utilise une correspondance insensible à la casse; une recherche de référence reste exacte. Chaque ligne vérifiée doit indiquer la provenance dans `source`; le système n’invente pas de données et conserve les erreurs par ligne dans l’historique des imports.

### Import CSV du référentiel véhicules

Depuis `/admin/catalog`, l’administration peut importer des véhicules sans créer de produits, avec le modèle `apps/web/public/vehicle-catalog-import-template.csv`. Colonnes requises : `make`, `model`, `generation`, `yearFrom`. Les moteurs, versions, années de fin, catégories et sources sont facultatifs. Une ligne marquée `verified=true` doit fournir une source (`source`); une référence peut être ajoutée dans `sourceReference`. Les autres lignes sont enregistrées comme contributives. Les fournisseurs peuvent créer et modifier librement les compatibilités de leurs offres; elles sont exposées dans la recherche dès que l’offre est approuvée et que le compte fournisseur est actif.

La même page `/admin/catalog` inclut une file « Vérifier les données véhicule ». Elle regroupe les générations et leurs moteurs/versions contributifs (500 générations maximum par chargement). L’administrateur doit saisir une source de vérification avant de publier; la source fournie à titre déclaratif par un import ou un partenaire n’est pas préremplie comme preuve. Le refus retire les entrées contributives concernées des sélecteurs sans supprimer leur historique; les marques/modèles partagés ou déjà vérifiés sont préservés. Chaque décision est inscrite dans le journal d’audit. Cette validation du référentiel ne valide pas les compatibilités pièce associées, qui gardent leur propre circuit d’approbation.

La suspension d’un fournisseur l’empêche de se connecter et retire ses offres de la recherche et des nouvelles réservations. La suppression définitive depuis `/admin/users` purge son compte, ses offres, ses stocks, ses factures fournisseur, ses imports, ses photos devenues orphelines et ses compatibilités véhicule contributives inutilisées. Les lignes historiques de commande et leurs totaux figés sont conservés pour le suivi client; leur rattachement fournisseur et le coût fournisseur sont supprimés. Appliquez la migration `20261018170000_supplier_deletion_cascade` avant d’utiliser la suppression.
