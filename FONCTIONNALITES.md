# 🤾 Handball Bot — Le Guide Complet des Fonctionnalités Coach

Bienvenue dans le guide des fonctionnalités de **Handball Bot** !  
Ce document a été pensé **spécifiquement pour les entraîneurs, capitaines et dirigeants** pour découvrir et maîtriser toutes les options disponibles, sans aucun jargon technique.

---

## 📑 Sommaire Rapide

1. [📱 Installation sur Smartphone (Application Mobile PWA)](#-1-installation-sur-smartphone-application-mobile-pwa)
2. [🤖 Le Lundi Automatique : Sondages WhatsApp & FFHB](#-2-le-lundi-automatique--sondages-whatsapp--ffhb)
3. [🤾 La Composition des Matchs du Week-end](#-3-la-composition-des-matchs-du-week-end)
   - [Mode Glisser-Déposer & Mode Tinder](#deux-façons-de-composer--tableau-ou-tinder)
   - [Gestion des Joueurs au Repos](#-zone-dédiée-joueurs-au-repos)
   - [Ajout de Renforts & Jokers](#-bouton--renfort--joueurs-qui-descendent-dune-équipe)
   - [Mémoire de Sélection & Compo Précédente](#-mémoire-de-sélection--recharger-la-semaine-précédente)
   - [Aperçu du Terrain Tactique en 2D](#-aperçu-du-terrain-tactique-en-2d)
   - [Diffusion de la Convocation Officielle](#-convocation-whatsapp-prête-en-1-clic)
4. [🏋️ La Gestion des Entraînements](#-4-la-gestion-des-entraînements)
   - [3 Formats de Séances selon le Terrain](#3-formats-de-séances-adaptés)
   - [Configuration des Jours et Horaires](#paramétrage-des-jours-et-horaires)
   - [Option Avec ou Sans Emojis](#option-avec-ou-sans-emojis)
5. [👥 Gestion de l'Effectif & Multi-Équipes](#-5-gestion-de-leffectif--multi-équipes)
   - [Ajouter, Modifier ou Supprimer un Joueur](#ajouter-modifier-ou-supprimer-un-joueur-sans-ouvrir-excel)
   - [Trombinoscope & Notes Tactiques Privées](#trombinoscope-photos-et-notes-confidentielles)
   - [Multi-Collectifs & Multi-Groupes WhatsApp](#-multi-collectifs--gérer-plusieurs-groupes-sur-la-même-page)
6. [🔒 Sécurité, Codes PIN & Chiffrement des Numéros (Ados / RGPD)](#-6-sécurité-codes-pin--chiffrement-des-numéros-ados--rgpd)
7. [🎨 Personnalisation du Club & Couleurs](#-7-personnalisation-du-club--couleurs)
8. [🔄 Mises à Jour en 1 Clic](#-8-mises-à-jour-en-1-clic)

---

## 📱 1. Installation sur Smartphone (Application Mobile PWA)

Handball Bot n'a pas besoin de passer par l'App Store ou Google Play : il s'installe directement depuis votre navigateur sous forme de **Progressive Web App (PWA)**.

* 🚀 **Plein écran instantané** : pas de barre d'adresse de navigateur.
* ⚡ **Ultra rapide** : les données sont mises en cache pour une ouverture en moins d'une seconde.
* 📲 **Véritable icône de club** : le blason de votre club s'affiche fièrement sur l'écran d'accueil de votre téléphone !

### 🍏 Sur iPhone (Safari) :
1. Ouvrez le lien de votre WebApp dans **Safari**.
2. Cliquez sur l'icône **Partager** (le carré avec la flèche vers le haut ⬆️ en bas de l'écran).
3. Faites défiler vers le bas et cliquez sur **« Sur l'écran d'accueil »**.
4. Validez en cliquant sur **Ajouter** en haut à droite.

### 🤖 Sur Android (Chrome) :
1. Ouvrez le lien de votre WebApp dans **Chrome**.
2. Appuyez sur les **trois petits points ⋮** en haut à droite (ou sur la bannière *« Installer l'application »* si elle apparaît).
3. Cliquez sur **« Installer l'application »** ou **« Ajouter à l'écran d'accueil »**.

---

## 🤖 2. Le Lundi Automatique : Sondages WhatsApp & FFHB

Plus besoin de vous souvenir d'écrire un message le dimanche soir :

1. **Scraping automatique FFHB** : Chaque semaine, le bot consulte le calendrier de vos équipes sur le site officiel de la fédération française de handball (`ffhandball.fr`).
2. **Calcul précis des horaires** :
   * Détecte si le match est à **Domicile** ou à l'**Extérieur**.
   * Calcule automatiquement l'heure de rendez-vous selon votre délai configuré (*ex: 1h avant à domicile, 1h30 avant à l'extérieur pour le trajet*).
3. **Publication automatique WhatsApp à 09h00** :
   * Envoie le sondage officiel dans le groupe WhatsApp de l'équipe.
   * Les joueurs cliquent en 2 secondes pour indiquer leurs disponibilités (Matchs SG1, SG2... et entraînements de la semaine).
4. **Synchronisation en direct** :
   * Les votes sont récupérés et synchronisés dans votre tableau de bord sans effort.
   * Si des retardataires votent le jeudi, un bouton **« 📥 Actualiser WhatsApp »** dans l'application met à jour les présences en temps réel.

---

## 🤾 3. La Composition des Matchs du Week-end

Le cœur de Handball Bot : finis les brouillons sur papier ou les prises de tête sur WhatsApp !

### Deux façons de composer : Tableau ou Tinder

| Mode | Comment ça marche ? | Idéal pour... |
| :--- | :--- | :--- |
| **📋 Mode Tableau** | Colonnes d'équipes en glisser-déposer (Drag & Drop). Vous déplacez les cartes des joueurs avec le doigt ou la souris. | Une vue d'ensemble tactique sur tablette ou ordinateur. |
| **🔥 Mode Tinder** | Les joueurs défilent un par un sous forme de cartes tactiles. Vous swipez la carte vers l'équipe voulue ! | Composer son équipe en 45 secondes dans le bus ou sur son canapé. |

#### Les gestes en Mode Tinder selon votre nombre d'équipes :
* **1 seule équipe** : 👈 Gauche = Repos | 👉 Droite = Sélectionné
* **2 équipes** : 👈 Gauche = Équipe 1 | 👉 Droite = Équipe 2 | 👇 Bas = Repos
* **3 équipes** : 👆 Haut = Équipe 1 | 👈 Gauche = Équipe 2 | 👉 Droite = Équipe 3 | 👇 Bas = Repos

---

### 😴 Zone dédiée « Joueurs au Repos »

> **La nouveauté demandée par les coachs** : quand un joueur n'est pas retenu, il ne disparaît plus dans la nature !
* Une colonne / zone dédiée **« Au Repos / Non retenus »** (avec badge rouge) liste tous les joueurs écartés pour le week-end.
* **Récupération instantanée** : si un joueur titulaire se blesse à l'échauffement ou déclare forfait, vous pouvez rebasculer un joueur au repos vers les disponibles ou directement dans l'équipe en un clic.

---

### ➕ Bouton « + Renfort » : Joueurs qui descendent d'une équipe

Besoin d'un joueur qui n'avait pas voté dans le sondage initial, ou d'un joueur qui **descend de l'équipe 1** ou **monte des -18** ?
* Cliquez sur le bouton **« + Renfort »** dans la colonne des joueurs disponibles.
* Choisissez le joueur dans la liste complète du club : il est instantanément injecté dans votre vivier disponible et peut être aligné sur la feuille de match !

---

### 💾 Mémoire de Sélection & Recharger la semaine précédente

* **Sauvegarde de brouillon automatique** : Vous commencez votre sélection le mercredi soir, vous devez vous arrêter ? Cliquez sur **« Sauvegarder Brouillon »**. Lorsque vous rouvrez l'application, une bannière vous propose de reprendre exactement là où vous vous étiez arrêté.
* **↺ Recharger la compo de la semaine précédente** : Pour reconduire l'équipe gagnante du week-end dernier en 1 clic, sans avoir à tout re-sélectionner joueur par joueur !

---

### 📐 Aperçu du Terrain Tactique en 2D

Avant de valider et d'envoyer votre message, visualisez votre **7 majeur** sur un vrai terrain de handball :

* **Vue demi-terrain d'attaque réglementaire** :
  * 🤾 **Ailier Gauche (ALG)** & **Ailier Droit (ALD)**
  * 🎯 **Arrière Gauche (ARG)** & **Arrière Droit (ARD)**
  * 🧠 **Demi-Centre (DC)**
  * 🧱 **Pivot (PVT)**
  * 🧤 **Gardien de But (GB)** positionné dans sa zone des 6 mètres
* **Banc des remplaçants interactif & Glisser-Déposer (Drag & Drop)** :
  * **Glisser-déposer fluide** : Glissez n'importe quel joueur du banc vers un poste du terrain, ou glissez deux joueurs du terrain l'un sur l'autre pour les intervertir.
  * **Permutation tactile en 1 clic sur mobile** : Touchez un joueur (il s'illumine en bleu), puis touchez le poste ou le remplaçant avec lequel vous souhaitez échanger. Aucune popup intrusive, la rotation s'effectue instantanément !
* **Affichage des photos avec secours automatique (Fallback)** : Les photos de profil sont affichées dans les pastilles des joueurs. Si une photo est introuvable ou ne charge pas, l'application bascule automatiquement sur l'initiale du joueur sur fond dégradé pour garantir un rendu visuel toujours soigné.

---

### 📣 Convocation WhatsApp prête en 1 clic

Une fois la composition validée :
1. Cliquez sur **« 👁 Aperçu & Terrain »**.
2. Le message officiel de convocation est automatiquement généré avec :
   * Les blasons et noms des équipes
   * L'adversaire, le gymnase et l'heure du match
   * L'heure exacte de rendez-vous
   * La liste ordonnée des joueurs convoqués
3. Cliquez sur **« 📤 Publier sur WhatsApp »** : le message part immédiatement dans votre groupe officiel !

---

## 🏋️ 4. La Gestion des Entraînements (1 à 5 séances par semaine)

### 🗓 Volume hebdomadaire modulable (1 à 5 séances) :
* **Sélecteur de volume** : Définissez librement le nombre de séances par semaine (de **1 à 5 entraînements**) depuis la fenêtre **« Créneaux & Horaires »**.
* **Onglets dynamiques** : L'interface d'entraînement adapte instantanément ses onglets au nombre de séances configurées.
* **Intégration au sondage WhatsApp** : Les séances cochées **« Actif sondage »** sont automatiquement incluses dans le sondage WhatsApp du lundi matin.

### 3 Formats de séances adaptés :
1. **🔀 Entraînement Séparé** : Deux groupes distincts (ex: *Groupe 1 à 19h30 / Groupe 2 à 21h00*, ou *Équipe 1 vs Équipe 2*).
2. **🎯 Effectif Réduit** : Séance avec quota maximum de joueurs (ex: séance tactique limitée à 18 joueurs avec gestion des réservistes).
3. **👥 Effectif Complet** : Séance ouverte à l'ensemble des joueurs disponibles (avec distinction des joueurs ménagés/adaptés).

### Paramétrage des jours et horaires sans ouvrir Excel :
* Configurez pour chaque séance le jour (Lundi, Mardi, Mercredi, Jeudi, Vendredi, Samedi, Dimanche) et l'horaire précis en quelques clics directement depuis la WebApp.

### Option Avec ou Sans Emojis :
* Vous préférez des convocations sobres sans pictogrammes ? Un interrupteur dans la configuration permet de **désactiver les emojis** sur toute la WebApp et dans les messages WhatsApp générés.

---

## 👥 5. Gestion de l'Effectif & Multi-Équipes

### Ajouter, modifier ou supprimer un joueur sans ouvrir Excel !
* **Ajout en 1 clic** : Nom, prénom, numéro de téléphone, poste favori et équipe d'attribution.
* **Suppression sécurisée** : Retirez un joueur qui a quitté le club en un instant.

### Trombinoscope, photos et notes confidentielles :
* **Prise de selfie ou import photo** : Le coach ou le joueur lui-même peut ajouter sa photo de profil.
* **Notes tactiques secrètes** : Notez les infos importantes (*« Retour de blessure cheville », « Tire les 7m », « Capitaine »*). Ces notes n'apparaissent **que sur l'écran du coach** et ne sont jamais visibles des joueurs.

### 👥 Multi-Collectifs : Gérer plusieurs groupes sur la même page
Vous coachez les **Séniors Garçons (SG1 & SG2)** ET les **-15 Filles (-15F1 & -15F2)** ?
* Le bouton **« Multi-Collectifs »** dans le menu vous permet de basculer d'un collectif à l'autre instantanément.
* Chaque collectif dispose de ses propres équipes, de ses propres joueurs et de ses propres groupes WhatsApp, le tout centralisé sur votre unique WebApp !

---

## 🔒 6. Sécurité, Codes PIN & Chiffrement des Numéros (Ados / RGPD)

> [!IMPORTANT]
> **Protection des coordonnées des mineurs et adolescents**
> Dans beaucoup de clubs, les effectifs contiennent les numéros de téléphone d'adolescents. Il est inacceptable que ces données circulent en clair ou soient hébergées chez des régies publicitaires.

* **Chiffrement au repos dans Google Sheets** : Tous les numéros de téléphone sont chiffrés sous la forme `enc:...`. Même si quelqu'un ouvre votre Google Sheet, les numéros sont illisibles.
* **Gestion exclusive sur la WebApp** : Seuls les coachs connectés avec leur code PIN peuvent consulter et modifier les coordonnées.
* **Code PIN secret individuel** : Chaque joueur et chaque coach possède son code PIN à 4 chiffres personnel.
* **Zéro serveur externe tiers** : Vos données restent 100% dans votre Google Drive et votre GitHub privé.

---

## 🎨 7. Personnalisation du Club & Couleurs

* **⚡ Synchronisation Automatique FFHB en 1 clic** :
  * Fournissez simplement l'URL de la page de votre club sur `monclub.ffhandball.fr` (ex : *https://monclub.ffhandball.fr/clubs/athletic-club-boulogne-billancourt/*).
  * L'application récupère automatiquement le **blason officiel haute définition** du club.
  * Elle extrait intelligemment les **couleurs dominantes et d'accent** du blason (couleur principale, secondaire, teintes des maillots) et applique immédiatement la charte graphique sur toute l'interface !
* **Blason officiel du club** : Téléversez une image ou collez une URL directe, elle est stockée sur votre Google Drive et s'affiche partout sur l'application.
* **Couleurs officielles et maillots personnalisables** :
  * Ajustez la couleur principale du club et la couleur de maillot de chaque équipe avec des sélecteurs de couleurs en direct.
  * Palettes rapides de grands clubs disponibles en un clic (*HBC Nantes, PSG Handball, Montpellier MHB, USAM Nîmes, Chambéry, etc.*).
  * Calcul automatique du contraste pour que le texte reste parfaitement lisible sur tous les téléphones.

---

## 🔄 8. Mises à Jour en 1 Clic

* **Détection automatique des mises à jour** : Si une nouvelle version de Handball Bot sort, un badge discret vous prévient sur l'accueil.
* **Synchronisation en 1 clic** : Cliquez sur le bouton de mise à jour pour rapatrier les dernières améliorations sans aucune manipulation technique.

---

## ❓ Foire Aux Questions des Coachs (FAQ)

### Comment retrouver un joueur que j'ai mis au repos par erreur ?
Dans le **Mode Tableau**, il se trouve dans la colonne rouge **« Au Repos »** en bas ou à droite. Glissez simplement sa carte vers les joueurs disponibles ou vers une équipe. En **Mode Tinder**, les joueurs au repos sont listés sous forme de pastilles cliquables juste au-dessus des cartes : cliquez sur son prénom pour le repêcher !

### Puis-je modifier un horaire de match détecté par la FFHB ?
Oui ! Dans l'écran de prévisualisation avant l'envoi WhatsApp, le texte du message est un champ éditable. Vous pouvez modifier n'importe quelle ligne avant de cliquer sur *« Publier sur WhatsApp »*.

### Que faire si un joueur n'a pas répondu au sondage mais me prévient par SMS ?
Utilisez le bouton **« + Renfort »** dans la WebApp : vous pouvez repêcher n'importe quel joueur du club même s'il n'avait pas voté au sondage.

### Combien coûte l'outil par saison ?
**0 €.** Handball Bot est un projet bénévole, open-source et libre, sans aucun abonnement ni publicité.

