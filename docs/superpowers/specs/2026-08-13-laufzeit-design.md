# Laufzeit von Filmen und Serien

## Ziel
Die Filmdatenbank speichert und zeigt die Laufzeit jedes Films. Bei Serien wird die Laufzeit der ersten Episode aus den TMDb-Details verwendet.

## Datenmodell
Die Tabelle `movies` erhält die optionale Spalte `laufzeit_minuten INTEGER`. Bestehende Datenbanken werden über die vorhandene `ensureColumn`-Migration erweitert. `NULL` bedeutet, dass TMDb keine verwertbare Laufzeit geliefert hat.

## Datenfluss
Beim Hinzufügen oder Aktualisieren eines Films wird die TMDb-Laufzeit in Minuten übernommen. Bei Serien wird die Laufzeit der ersten Episode verwendet; die API liefert dafür die Episodenlaufzeit aus den TMDb-Details. Vorhandene Laufzeitwerte werden nur durch einen verwertbaren neuen Wert ersetzt.

Ein einmaliger Backfill ergänzt die Laufzeit für bereits vorhandene movie-db-Einträge, ohne Ratings, Watch-Status, Notizen, Listen oder Quellen zu verändern.

## Darstellung
Die Laufzeit wird in der bestehenden deutschen Filmansicht als `N Min.` angezeigt. Wenn keine Laufzeit vorhanden ist, wird kein Platzhalter angezeigt.

## Validierung und Tests
Nur positive ganzzahlige Minutenwerte werden gespeichert. Tests decken die Schema-Migration, Film- und Serienzuordnung sowie die Darstellung und den Umgang mit fehlenden Laufzeiten ab.
