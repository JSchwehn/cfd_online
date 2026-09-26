# Strömungs-Viewer

Web-App, um ein Bauteil in einen fest stehenden Luftstrom zu drehen. STL und STEP/STP werden geladen und als Dreiecksnetz gezeigt. Der Wind zeigt in **+X**. Die Kamera schwenkt nur den Blick. Das Modell dreht sich getrennt davon: Gieren um Y, Nicken um Z, Rollen um X, über die Winkel oder am Zieh-Gizmo. Während Start oder Pause ist das Drehkreuz ausgeblendet, es gehört nicht zur Strömung. Hinweise stehen hinter dem **i**. **Gitternetz** ist aus und zeichnet die Dreiecke als Linien. **Klick richtet die Fläche in den Strom** ist aus. Eingeschaltet stellt ein Klick die getroffene Seite senkrecht zum Wind, die Normale zeigt gegen die Anströmung, und das Drehkreuz ist ausgeblendet.

**Start** rechnet eine grobe Luftströmung im Browser. Derselbe Knopf wird zu **Pause** und hält die Teilchen an. **Zurücksetzen** löscht das Feld, der Knopf zeigt wieder Start. Ohne geladenes Modell bleibt Start aus. Eine neue Datei, eine andere Lage, eine andere Windgeschwindigkeit, eine andere Vereinfachung, ein anderes Modell oder eine andere Auflösung setzt eine laufende oder pausierte Rechnung zurück.

Unter **Rechnung** liegen die Regler. **Vereinfachen** geht von aus bis stark und fasst nahe Punkte des Netzes zusammen. 0 zeigt die Datei unverändert. Stärker heißt weniger Dreiecke, dünne Stellen können dabei verschwinden. **Modell** ist BGK oder TRT. Ein Wechsel hält die Rechnung an und setzt sie zurück. TRT ist vorausgewählt und trennt die Zähigkeit von der übrigen Dämpfung, damit der Nachlauf klarer bleibt. Die gezeichnete Box ist hinter dem Teil lang und seitlich weit; die Rechnungswände liegen noch etwas außerhalb, damit sich Wirbel lösen können. Die Luft ist die von Normalnull, 15 °C und 1013 hPa. Das Gitter trägt die echte Reynolds-Zahl dieser Luft nicht, darum ist die Zähigkeit die dünnste, die hier stabil bleibt. RANS, der Weg zu belastbaren Kräften, ist vorgemerkt und hier nicht wählbar. **Auflösung** ist grob, mittel oder fein und bestimmt, wie fein das Gitter das Modell trifft. Sie gilt erst nach dem nächsten Start. Jede Zelle, die ein Dreieck schneidet, gehört zum Modell. Was dünner als eine Zelle ist, wird eine Zelle. Der Einlass hält diese Windgeschwindigkeit, damit der Strom nicht mit der Zeit einschläft. **Ausgang offen** ist vorausgewählt und gilt sofort. Die Luft strömt am Kanalende aus, die Stirnwand ist nicht gezeichnet. Aus setzt dort eine Wand. Offen lässt die Quergeschwindigkeit mit hinaus, damit die Heatmap am Ende keine Wand zeichnet. **Teilchen** ändert nur, wie viele Punkte den Strom zeigen, und gilt sofort. Sie entstehen in der gezeichneten Box. Teilchen, die die Box verlassen, fallen weg und kommen am Einlass über die nächsten Schritte wieder nach, damit der Wind durchgehend bläst. Teilchen, die das Bauteil treffen, bleiben an der Oberfläche liegen. Die Oberfläche wird erst geprüft, wenn ein Teilchen die Zelle des Bauteils betritt, damit die Animation nicht langsamer wird, während der Nachlauf steht. Drei Schalter zeichnen die Drehung, ohne die Rechnung zu ändern: **Farbe nach Drehung** färbt geradeaus blau und seitliche Drehung gelb bis rot. **Mittelebene** hält die Teilchen in einer horizontalen Scheibe. **Mittelebene 90°** stellt die Teilchen allein in eine senkrechte Scheibe, auch wenn die liegende Mittelebene aus ist. Liegen gebliebene Teilchen außerhalb dieser Scheibe verschwinden. **Schweife** zeichnen den zurückgelegten Weg als dunkle Linie. **Heatmap** färbt die Wirbelstärke in der horizontalen Mittelebene, blau ist ruhig und rot ist Drehung. **Heatmap 90°** stellt dieselbe Fläche senkrecht vor das Bauteil, auch wenn die liegende Heatmap aus ist. Alle sind aus und gelten sofort. Die Windgeschwindigkeit steuert, wie schnell die Teilchen ziehen, nicht eine echte Reynolds-Zahl. Kräfte und Druck sind keine belastbaren Werte. Die Heatmap zählt die Drehung nur zwischen freien Zellen, damit die Wand selbst keinen roten Streifen vor das Bauteil legt. Dünne Details verschwinden im Gitter.

Einheit der Datei und Windgeschwindigkeit (m/s) liegen im Fall. STL hat keine Einheit; die Zahlen bleiben wie in der Datei und gelten als Millimeter oder Meter. STEP wird in die gewählte Einheit umgerechnet.

## Start

```bash
npm install
npm run dev
```

Browser öffnet die URL von Vite (meist `http://localhost:5173`). Tests:

```bash
npm test
```

Production-Build: `npm run build`, Vorschau mit `npm run preview`.

Dieselbe App läuft unter [jschwehn.github.io/cfd_online](https://jschwehn.github.io/cfd_online/). Ein Push auf `main` baut sie und veröffentlicht sie.

## Spätere Server-Rechnung

Die Browser-Rechnung zeigt die grobe Umströmung. Näher an CFD wäre später ein Server mit OpenFOAM: Netz in Metern, `snappyHexMesh`, instationär `pimpleFoam`, Turbulenz `kOmegaSST`, Stromlinien zurück in diese Ansicht. Jede neue Lage wäre ein neuer Job und dauert Minuten. Das ist noch nicht angebunden.
