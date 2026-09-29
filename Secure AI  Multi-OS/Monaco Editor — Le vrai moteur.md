Monaco Editor — Le vrai moteur de VS Code, pas un contenteditable bidon. Coloration syntaxique complète pour tous les langages, autocomplétion, multi-curseur, recherche/remplacement, pliage de code, le tout habillé avec le thème vert/cyan custom.

Terminal fonctionnel — ls, cat, touch, rm gèrent le vrai système de fichiers virtuel. La commande node ou eval exécute réellement du JavaScript dans le navigateur via new Function(), avec interception des console.log.

Agent IA local qui agit sur le code — Pas de simulation. Quand tu demandes "génère une fonction fibonacci", il parse ta demande, écrit le code, et l'injecte directement dans l'éditeur via l'API Monaco. "Corriger" compte les parenthèses/accolades et répare automatiquement. "Review" analyse les métriques réelles du fichier. "Tester" trouve les fichiers .test.js et les exécute réellement. "Refactor" remplace var par const, == par ===, etc., et applique les changements dans l'éditeur.

Système de fichiers complet — Créer, ouvrir, fermer, supprimer des fichiers. Tout persiste en mémoire. Les modèles Monaco sont gérés proprement (créés au premier ouvert, détruits à la suppression).

Zéro boot, zéro fake, zéro simulation. Un IDE qui tourne.