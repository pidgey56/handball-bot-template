# 🤾 Handball Bot Template

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Baileys-25D366?logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Google Sheets](https://img.shields.io/badge/Google%20Sheets-Apps%20Script-34A853?logo=googlesheets&logoColor=white)](https://workspace.google.com/products/sheets/)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-Automated-2088FF?logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Handball Bot** est une solution complète, universelle et **100% gratuite** conçue pour les entraîneurs, dirigeants et capitaines de clubs de handball.

Elle combine un **robot WhatsApp officiel** (sans API payante), un **scraping automatique des matchs FFHB** et une **WebApp mobile interactive** pour composer vos équipes en glisser-déposer ou en mode "Tinder".

---

## ⚡ Fonctionnalités clés

* 🤖 **Sondages WhatsApp hebdomadaires automatiques** : Détection des matchs de vos équipes sur `ffhandball.fr`, calcul automatique des heures de rendez-vous (domicile ou extérieur avec temps de trajet), et publication du sondage à choix multiples dans votre groupe d'équipe.
* 📥 **Déchiffrement et synchronisation des votes** : Lecture des votes chiffrés AES-GCM multi-appareils (Baileys), mise en correspondance automatique avec le répertoire des joueurs via leur numéro de téléphone.
* 🤾 **WebApp mobile de composition d'équipe** :
  * **Mode Classique** : Glisser-déposer (Drag & Drop) des joueurs disponibles entre les équipes.
  * **Mode Tinder** : Swiper à gauche pour l'Équipe 1, à droite pour l'Équipe 2, vers le bas pour le repos.
  * **Gestion des entraînements** : Répartition des présents en groupes de niveau ou sélection d'effectif restreint.
* 📤 **Convocations WhatsApp en 1 clic** : Mise en forme instantanée de la liste des convoqués avec adversaire, lieu et heure de rendez-vous, envoyée directement dans le groupe WhatsApp depuis la WebApp.
* 👤 **Portail Joueur en libre-service** : Code PIN personnel, sélection du poste de jeu préféré, ajout de photo de profil et notes d'entraîneurs.
* 💸 **0 € de frais d'hébergement** : Fonctionne entièrement sur les quotas gratuits de Google Sheets et de GitHub Actions. Aucun serveur ni base de données à administrer.

---

## 🚀 Démarrage Rapide

Pour installer le bot dans votre club en moins de 15 minutes, consultez le guide pas à pas :

👉 **[Consulter le Guide d'Installation Complet (GUIDE_INSTALLATION.md)](GUIDE_INSTALLATION.md)**

### Résumé des 4 étapes d'installation :
1. **Créer votre dépôt** : Cliquez sur **« Use this template »** (visibilité **Privée** requise).
2. **Importer le Google Sheet** : Ouvrez [`Handball_Bot_Template.xlsx`](Handball_Bot_Template.xlsx) dans Google Drive ou collez [`code.gs`](code.gs) dans un nouveau classeur.
3. **Connecter WhatsApp** : Lancez le workflow GitHub Actions en mode `setup` et associez votre téléphone avec le code à 8 chiffres.
4. **Déployer la WebApp** : Déployez l'application web dans Google Apps Script et collez son URL dans votre feuille de configuration.

---

## 📁 Structure du Projet

```text
├── .github/
│   └── workflows/
│       └── whatsapp.yml           # Pipeline GitHub Actions (cron, dispatch, setup)
├── auth_info/                     # Session chiffrée WhatsApp (sauvegardée automatiquement)
├── Handball_Bot_Template.xlsx     # Classeur modèle prêt à l'emploi (formats, styles, formules)
├── code.gs                        # Backend Google Apps Script, scraper FFHB & WebApp coach
├── send-poll.js                   # Moteur WhatsApp Baileys (envoi sondage, déchiffrement votes)
├── package.json                   # Dépendances Node.js (@whiskeysockets/baileys, pino)
├── .env.example                   # Exemple de variables d'environnement pour tests locaux
├── GUIDE_INSTALLATION.md          # Guide pas à pas illustré pour les clubs
└── README.md                      # Présentation du projet
```

---

## ⚙️ Personnalisation pour votre club

Tous les réglages s'effectuent sans coder, directement depuis l'onglet **Configuration** de votre Google Sheet :
- **Nom et blason du club** : Nom officiel et URL du logo pour la WebApp.
- **Équipes gérées** : Nom des équipes (ex: `SG1`, `SG2`, `N2`, `-18M`), mots-clés FFHB et URLs de poules.
- **Créneaux d'entraînement** : Jours, horaires et gymnases personnalisables.
- **Délai de rendez-vous** : Décalage en heures avant le coup d'envoi (ex: 1h pour domicile, 1h30 pour extérieur).
- **Numéros administrateurs** : Numéros de téléphone des entraîneurs ayant accès à l'espace coach.

---

## 🔒 Sécurité et Données Personnelles

* Le projet ne fait appel à **aucun service tiers payant** ni serveur externe non contrôlé.
* Toutes les données d'effectif et de votes restent stockées dans **votre** compte Google Drive et dans **votre** dépôt GitHub privé.
* La session WhatsApp est chiffrée de bout en bout et conservée uniquement dans votre dépôt privé.

---

## 🤝 Contribution & Support

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une *Issue* ou une *Pull Request* pour proposer des améliorations (support de 3+ équipes dans le tableau interactif, export PDF des feuilles de match, etc.).

---

## 📄 Licence

Ce projet est distribué sous licence [MIT](LICENSE). Vous êtes libre de l'utiliser, le modifier et le déployer pour votre club de handball.
