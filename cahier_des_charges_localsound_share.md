# Cahier des Charges - Prototype (MVP) : "LocalSound Share"

## 1. Objectif du Projet
Créer une application locale permettant à un ordinateur hôte (**Host**) de diffuser en temps réel le son de son système (ou d'une source audio comme YouTube) vers plusieurs ordinateurs clients connectés au même réseau local (Wi-Fi / Ethernet), avec une synchronisation optimale et une latence minimale.

---

## 2. Périmètre du Prototype (MVP)
Pour un premier prototype fonctionnel, le périmètre se concentre sur les fonctionnalités indispensables :
*   **Connexion simple :** L'hôte démarre un serveur local, les clients se connectent via un navigateur web en tapant l'adresse IP locale (ex : `http://192.168.1.15:3000`).
*   **Diffusion en direct :** Tout ce qui est joué sur le PC de l'hôte (ou une piste audio choisie) est transmis aux clients.
*   **Lecture synchrone minimale :** Les clients entendent la musique dans leurs écouteurs ou haut-parleurs.

---

## 3. Spécifications Fonctionnelles (Rôles & Parcours Utilisateur)

### A. Rôle 1 : L'Hôte (Le diffuseur / DJ)
*   **Lancement :** L'utilisateur lance l'application ou le script sur son PC. L'application affiche son adresse IP locale.
*   **Source Audio :**
    *   *Option MVP simple :* L'hôte sélectionne un fichier audio ou l'application capture la sortie audio globale de son PC (Windows WASAPI Loopback).
*   **Contrôle de lecture :** Boutons Play, Pause, Stop (ou pilotage direct depuis la source comme YouTube/Spotify ouvert sur le PC hôte).

### B. Rôle 2 : Les Clients (Les auditeurs)
*   **Connexion :** Ouvrir un navigateur web (Chrome, Firefox, Edge) et saisir l'URL fournie par l'hôte.
*   **Interface Web :** Une page simple affichant :
    *   Le nom/statut de la session ("Connecté à la radio de [Nom de l'hôte]").
    *   Un bouton obligatoire **"Écouter"** (requis par les navigateurs pour autoriser la lecture automatique du son).
    *   Un contrôle de volume individuel (pour ajuster son propre son sans impacter les autres).

---

## 4. Spécifications Techniques (Choix de la Stack)

Pour coder ce prototype rapidement et efficacement, la pile technologique recommandée est la suivante :

*   **Langage / Backend :** **Node.js** (avec Express et `ws` pour les WebSockets) ou **Python** (avec Flask / Socket.IO).
*   **Diffusion Audio :**
    *   Transformation du flux audio en morceaux compressés (format **Opus** ou **AAC / MP3** en streaming HTTP/WebSocket).
    *   Alternative simple : Diffuser via un flux radio léger ou envoyer des segments audio binaires en WebSocket décodés par l'API Web Audio du navigateur.
*   **Frontend Client :** HTML5 / JavaScript pur (Vanilla JS) avec l'élément `<audio>` ou l'API *Web Audio*.

---

## 5. Étapes de Développement du Prototype

1.  **Étape 1 : Le serveur de base (Backend)**
    *   Créer un serveur Node.js ou Python qui écoute sur le réseau local.
    *   Mettre en place une page web basique servie par ce serveur.
2.  **Étape 2 : La capture et l'envoi du son**
    *   Capturer l'audio de la machine hôte.
    *   Diffuser ce flux aux clients connectés via WebSocket ou flux HTTP en continu.
3.  **Étape 3 : La réception et la lecture côté client**
    *   Récupérer le flux audio sur la page web cliente.
    *   Gérer le bouton de démarrage audio (pour contourner les sécurités anti-autoplay des navigateurs).
4.  **Étape 4 : Tests en conditions réelles**
    *   Tester sur deux PC différents connectés au même Wi-Fi pour mesurer la latence et ajuster la mise en cache/buffer.
