# 🤾 Handball Bot Template (v2.2)

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Baileys-25D366?logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Google Sheets](https://img.shields.io/badge/Google%20Sheets-Apps%20Script-34A853?logo=googlesheets&logoColor=white)](https://workspace.google.com/products/sheets/)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-Automated-2088FF?logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![Spakta Scout](https://img.shields.io/badge/Spakta-Stats%20Officielles-FF6B00)](https://spakta.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Handball Bot** est une solution complète, universelle et **100% gratuite** conçue pour les entraîneurs, dirigeants, capitaines et joueurs de clubs de handball.

Elle combine un **robot WhatsApp officiel** (sans API payante), un **scraping automatique des matchs FFHB**, une **intégration des statistiques officielles Spakta** et une **WebApp PWA "Carnet de Coach"** pour composer vos équipes en glisser-déposer ou en mode "Tinder".

---

## 💡 Pourquoi ce projet ? Souveraineté des données & Gratuité totale

Handball Bot est né d'un constat simple dans les clubs amateurs :
1. **Gestion des données interne au club et souveraineté des données** : Les coordonnées des joueurs, des entraîneurs et des parents (numéros de téléphone, présences, indisponibilités, notes privées et photos) sont des informations hautement confidentielles, concernant souvent des licenciés mineurs. Les plateformes commerciales propriétaires (SaaS privés) imposent le stockage de ces données sur des serveurs tiers dont vous ne maîtrisez ni la politique de confidentialité, ni l'usage commercial. Avec Handball Bot, **aucune donnée ne transite par un serveur externe inconnu** : 100% de vos données restent stockées dans **votre compte Google Drive** et dans **votre dépôt GitHub privé**.
2. **Volonté que l'outil soit gratuit et open-source** : Les finances d'un club associatif doivent financer les ballons, les maillots et la formation des jeunes et arbitres, pas des abonnements mensuels récurrents à des applications sportives. L'outil repose à 100% sur les quotas gratuits permanents de Google Sheets et GitHub Actions. Il restera **0 € à vie**, sans publicité et sans abonnement.
3. **Pourquoi le maintenir soi-même (auto-hébergement)** : Maintenir son propre modèle garantit votre indépendance totale. Aucun prestataire externe ne peut décider de fermer son service, de restreindre les fonctionnalités ou d'augmenter ses tarifs au milieu de votre championnat. Vous restez maître absolu de votre outil, et le système de détection des mises à jour en 1 clic vous assure de bénéficier de toutes les évolutions sans effort technique.

---

## ⚡ Fonctionnalités clés

> [!TIP]
> 📖 Pour découvrir toutes les options en détail avec des explications pas à pas pour le terrain, consultez le **[🌟 Guide Complet des Fonctionnalités Coach (FONCTIONNALITES.md)](FONCTIONNALITES.md)**.

* 🤖 **Sondages WhatsApp hebdomadaires automatiques** : Détection des matchs de vos équipes sur `ffhandball.fr`, calcul automatique des heures de rendez-vous (domicile ou extérieur avec temps de trajet), et publication du sondage à choix multiples dans votre groupe d'équipe (support de 1, 2 ou 3 équipes maximum).
* 📥 **Déchiffrement et synchronisation des votes** : Lecture des votes chiffrés AES-GCM multi-appareils (Baileys), mise en correspondance automatique avec le répertoire des joueurs via leur numéro de téléphone. Nettoyage automatique des fichiers de session temporaires (`auth_info/`) sans déconnexion.
* 📊 **Statistiques officielles Spakta Scout (Saison 2026-2027)** :
  * Intégration des performances réelles des joueurs (buteurs et gardiens de but).
  * Affichage automatique du numéro de maillot officiel (`#55`).
  * Métriques détaillées : buts, moyenne/match, % de réussite aux tirs, 7m, 2 min, arrêts totaux et arrêts par match.
  * Historique match par match déroulant (date, adversaire, score, stats individuelles).
  * Consolidation multi-équipes pour les joueurs évoluant sur plusieurs collectifs (ex: `1B & 1C`).
* 💰 **Vie d'Équipe : Caisse Noire & Amendes de vestiaire** :
  * Suivi de la cagnotte en direct avec jauge d'objectif (resto de fin d'année, tournée).
  * Ardoise individuelle consultable par chaque joueur en toute transparence.
  * Barème officiel des infractions et retards.
  * Palmarès des plus gros contributeurs.
  * Rôle dédié « ⭐ Trésorier de la Caisse Noire » paramétrable par le coach.
* 🚗 **Covoiturage & Déclarations d'absence** :
  * Organisation des trajets pour les matchs extérieurs (conducteurs, places, passagers).
  * Déclaration anticipée des indisponibilités (blessure, travail, congés).
* 🏖️ **Gestion des Vacances Scolaires & Trêves** :
  * Détection automatique des vacances académiques.
  * Bannière d'information et neutralisation intelligente des sondages hors compétition.
* 🤾 **WebApp PWA "Carnet de Coach" (5 onglets)** :
  * **5 Onglets interactifs** : Mon Profil, Matchs, Entraînements, Vie d'Équipe, Coach.
  * **Mode Tinder adaptatif** :
    * **1 équipe** : 👈 Gauche = Repos | 👉 Droite = Sélectionné
    * **2 équipes** : 👈 Gauche = Équipe 1 | 👉 Droite = Équipe 2 | 👇 Bas = Repos
    * **3 équipes** : 👆 Haut = Équipe 1 | 👈 Gauche = Équipe 2 | 👉 Droite = Équipe 3 | 👇 Bas = Repos
  * **Mode Tactique (Tableau & Drag-and-Drop)** : Colonnes d'équipes modulables, compteurs de quotas et renforts.
  * **Terrain tactique interactif 2D** : Demi-terrain réglementaire avec placement des 7 attaquants et gardien.
  * **Gestion des entraînements (1 à 5 séances / semaine)** : 3 formats de séances (séparé, réduit avec quota, effectif complet).
  * **Multi-collectifs** : Changement instantané de catégorie (ex: Séniors Garçons, Séniors Filles, -18M).
  * **Thèmes visuels** : Carnet de Coach (papier millimétré), Mode Clair, Mode Sombre (ardoise vestiaire).
  * **Installation PWA** : Compatible Android & iPhone en plein écran, support hors-ligne (Stale-While-Revalidate).
* 📤 **Convocations WhatsApp en 1 clic** : Mise en forme instantanée de la liste des convoqués avec adversaire, lieu et heure de rendez-vous, envoyée directement dans le groupe WhatsApp depuis la WebApp.
* 🎨 **Identité visuelle & Couleurs du Club** : Import automatique du blason et des couleurs officielles en 1 clic depuis l'URL de votre club sur `monclub.ffhandball.fr`.
* 🔄 **Mises à jour faciles & Détection de version** : Détection automatique des nouvelles versions dans la WebApp et Google Sheets avec synchronisation en 1 clic.
* 🔐 **Protection des données & Chiffrement au repos (RGPD / Mineurs)** : Numéros de téléphone chiffrés directement dans Google Sheets (format `enc:...`). Aucun numéro en clair dans le tableur.
* 💸 **0 € de frais d'hébergement** : Fonctionne entièrement sur les quotas gratuits de Google Sheets et de GitHub Actions.

---

## 🚀 Démarrage Rapide

Pour installer le bot dans votre club en moins de 15 minutes, consultez les guides pas à pas :

👉 **[🌟 Guide des Fonctionnalités Coach (FONCTIONNALITES.md)](FONCTIONNALITES.md)** : Présentation visuelle et complète de toutes les fonctionnalités.  
👉 **[📖 Guide d'Installation Pas à Pas (GUIDE_INSTALLATION.md)](GUIDE_INSTALLATION.md)** : Installation initiale en 15 minutes.  
👉 **[🤾 Guide d'Utilisation au Quotidien (GUIDE_UTILISATION.md)](GUIDE_UTILISATION.md)** : Guide de terrain hebdomadaire pour coachs, joueurs et trésoriers.

### Résumé des 5 étapes d'installation :
1. **Créer votre dépôt** : Cliquez sur **« Use this template »** (visibilité **Privée** requise).
2. **Activer les permissions GitHub Actions** : Dans *Settings > Actions > General > Workflow permissions*, cochez **« Read and write permissions »** (indispensable pour sauvegarder la session WhatsApp).
3. **Importer le Google Sheet** : Téléchargez [`Handball_Bot_Template.xlsx`](Handball_Bot_Template.xlsx), glissez-le dans Google Drive, enregistrez-le au format Google Sheets et collez [`code.gs`](code.gs) dans *Extensions > Apps Script*.
4. **Connecter WhatsApp** : Lancez le workflow GitHub Actions en mode `setup` et associez votre téléphone avec le code à 8 chiffres.
5. **Déployer la WebApp** : Déployez l'application web dans Google Apps Script et collez son URL dans votre feuille de configuration.

---

## 📁 Structure du Projet

```text
├── .github/
│   └── workflows/
│       └── whatsapp.yml           # Pipeline GitHub Actions (cron, dispatch, setup)
├── auth_info/                     # Session chiffrée WhatsApp (sauvegardée automatiquement)
├── docs/                          # Frontend WebApp PWA GitHub Pages
│   ├── index.html                 # Interface HTML 5 onglets Carnet de Coach
│   ├── manifest.json              # Configuration PWA & icônes
│   ├── sw.js                      # Service Worker hors-ligne (cache Stale-While-Revalidate)
│   ├── css/
│   │   └── style.css              # Thèmes Carnet de Coach, Clair & Sombre
│   └── js/
│       ├── api.js                 # Client API Google Apps Script & gestion réseau
│       ├── app.js                 # Logique applicative (compo, tinder, caisse noire, vacances)
│       └── spakta-data.json       # Snapshot de secours des statistiques Spakta
├── Handball_Bot_Template.xlsx     # Classeur modèle prêt à l'emploi (formats, styles, formules)
├── code.gs                        # Backend Google Apps Script & scraper officiel FFHB
├── send-poll.js                   # Moteur WhatsApp Baileys (envoi sondage, déchiffrement votes)
├── package.json                   # Dépendances Node.js (@whiskeysockets/baileys, pino)
├── FONCTIONNALITES.md             # Guide visuel complet de toutes les fonctionnalités
├── GUIDE_INSTALLATION.md          # Guide pas à pas illustré pour les clubs (15 min)
├── GUIDE_UTILISATION.md           # Guide d'utilisation au quotidien pour coachs et joueurs
└── README.md                      # Présentation du projet
```

---

## ⚙️ Personnalisation pour votre club

Tous les réglages s'effectuent sans coder, directement depuis l'onglet **Configuration** de votre Google Sheet ou depuis la WebApp :
- **Nom et blason du club** : Nom officiel et URL du logo pour la WebApp (ou import 1 clic FFHB).
- **Couleurs du club et des équipes** : Palette personnalisée (`#HEX`) avec aperçu en temps réel.
- **Équipes gérées** : Nom des équipes (ex: `1B`, `1C`), mots-clés FFHB et URLs de poules.
- **Créneaux d'entraînement (1 à 5 séances / semaine)** : Volume hebdomadaire modulable, jours et horaires configurables.
- **Délai de rendez-vous** : Décalage en heures avant le coup d'envoi (ex: 1h pour domicile, 1h30 pour extérieur).
- **Numéros administrateurs** : Numéros de téléphone des entraîneurs ayant accès à l'espace coach.

---

## 🔒 Sécurité et Données Personnelles

* Le projet ne fait appel à **aucun service tiers payant** ni serveur externe non contrôlé.
* Toutes les données d'effectif et de votes restent stockées dans **votre** compte Google Drive et dans **votre** dépôt GitHub privé.
* La session WhatsApp est chiffrée de bout en bout et conservée uniquement dans votre dépôt privé.
* Chiffrement des numéros de téléphone au repos dans le tableur.

---

## 🤝 Contribution & Support

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une *Issue* ou une *Pull Request* pour proposer des améliorations.

---

## 📄 Licence

Ce projet est distribué sous licence [MIT](LICENSE). Vous êtes libre de l'utiliser, le modifier et le déployer pour votre club de handball.
