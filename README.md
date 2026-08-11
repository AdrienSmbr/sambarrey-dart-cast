# SambarreyDart — Receiver Chromecast

Page réceptrice affichée sur la télé pendant une partie de fléchettes.

La tablette (application Android) envoie un instantané de la partie sur le canal
Cast `urn:x-cast:com.sambarrey.dart` ; cette page se contente de l'afficher.
Aucune règle de jeu, aucun état, aucune donnée personnelle ici.

Aucune dépendance en dehors du SDK Cast lui-même : rendu, animations et
particules sont faits maison, le processeur d'un Chromecast étant modeste.

## Démo sans matériel

Ajouter `?demo=1` à l'URL : une partie scriptée se déroule en boucle.
