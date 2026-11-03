import { describe, expect, it } from "vitest";
import { klassifiziereRematch, sammleVorschlaege, type RematchEintrag, type RematchTreffer } from "../src/tmdbRematch.js";

function treffer(id: number, titel: string, jahr: number | null, medientyp: "film" | "serie" = "film"): RematchTreffer {
  return { id, titel, jahr, medientyp };
}

function kandidaten(map: Record<number, RematchTreffer[]>) {
  return (eintrag: RematchEintrag): RematchTreffer[] => map[eintrag.tmdb_id] ?? [];
}

describe("TMDB-Neusuche: Klassifizierung", () => {
  it("erkennt denselben Eintrag im anderen Namensraum als medientyp-Vorschlag", () => {
    const b = klassifiziereRematch([{ tmdb_id: 69490, titel: "Der Seewolf", jahr: 1971 }], kandidaten({
      69490: [treffer(69490, "Der Seewolf", 1971, "serie")],
    }));
    expect(b.vorschlaege).toEqual([
      { alt: 69490, neu: 69490, medientyp: "serie", titel: "Der Seewolf", jahr: 1971, art: "medientyp" },
    ]);
  });

  it("erkennt einen anderen Eintrag als id-Vorschlag", () => {
    const b = klassifiziereRematch([{ tmdb_id: 225377, titel: "Unser fremdes Kind", jahr: 1998 }], kandidaten({
      225377: [treffer(155911, "Unser fremdes Kind", 1997)],
    }));
    expect(b.vorschlaege[0]).toMatchObject({ alt: 225377, neu: 155911, art: "id", medientyp: "film" });
  });

  it("toleriert ein Jahr Abweichung, aber nicht zwei", () => {
    const eins = klassifiziereRematch([{ tmdb_id: 1, titel: "Film", jahr: 2000 }], kandidaten({
      1: [treffer(2, "Film", 2001)],
    }));
    expect(eins.vorschlaege).toHaveLength(1);
    const zwei = klassifiziereRematch([{ tmdb_id: 1, titel: "Film", jahr: 2000 }], kandidaten({
      1: [treffer(2, "Film", 2002)],
    }));
    expect(zwei.vorschlaege).toHaveLength(0);
    expect(zwei.nichts).toHaveLength(1);
  });

  it("akzeptiert fehlendes Jahr und ignoriert abweichende Titel", () => {
    const b = klassifiziereRematch(
      [
        { tmdb_id: 10, titel: "Ohne Jahr", jahr: null },
        { tmdb_id: 11, titel: "Anderer Titel", jahr: 1990 },
      ],
      kandidaten({ 10: [treffer(20, "Ohne Jahr", 1975)], 11: [treffer(21, "Ganz anders", 1990)] })
    );
    expect(b.vorschlaege.map((v) => v.alt)).toEqual([10]);
    expect(b.nichts.map((n) => n.tmdb_id)).toEqual([11]);
  });

  it("meldet mehrere plausible Treffer als unklar", () => {
    const b = klassifiziereRematch([{ tmdb_id: 5, titel: "Doppelt", jahr: 2000 }], kandidaten({
      5: [treffer(6, "Doppelt", 2000), treffer(7, "Doppelt", 2001, "serie")],
    }));
    expect(b.unklar).toHaveLength(1);
    expect(b.unklar[0].kandidaten.map((k) => k.id)).toEqual([6, 7]);
    expect(b.vorschlaege).toHaveLength(0);
  });

  it("vergleicht Titel normiert (Umlaute, Satzzeichen)", () => {
    const b = klassifiziereRematch([{ tmdb_id: 8, titel: "Fluss des Lebens: Kwai", jahr: null }], kandidaten({
      8: [treffer(9, "Fluss des Lebens - Kwai", null)],
    }));
    expect(b.vorschlaege).toHaveLength(1);
  });

  it("sucht jeden Titel nur einmal und verkraftet Fehler", async () => {
    const aufrufe: string[] = [];
    const b = await sammleVorschlaege(
      [
        { tmdb_id: 1, titel: "Gleich", jahr: 2000 },
        { tmdb_id: 2, titel: "Gleich", jahr: 2000 },
        { tmdb_id: 3, titel: "Kaputt", jahr: 1990 },
      ],
      async (titel) => {
        aufrufe.push(titel);
        if (titel === "Kaputt") throw new Error("TMDB nicht erreichbar");
        return [treffer(1, "Gleich", 2000)];
      }
    );
    expect(aufrufe).toEqual(["Gleich", "Kaputt"]);
    expect(b.vorschlaege.map((v) => v.alt)).toEqual([1, 2]);
    expect(b.nichts.map((n) => n.tmdb_id)).toEqual([3]);
  });
});
