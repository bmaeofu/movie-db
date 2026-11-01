import { describe, expect, it } from "vitest";
import { bauePlayUrls, PLAYBACK_ZIELE } from "../src/playback.js";

describe("Playback-URLs", () => {
  it("bietet beide Ziele an", () => {
    expect(PLAYBACK_ZIELE.map((z) => z.name)).toEqual(["desktop", "android"]);
  });

  it("bildet den Pfad je Ziel ab und setzt das Template ein", () => {
    const ziele = bauePlayUrls("/media/FilmeHD3/Es.mkv");
    expect(ziele).toEqual([
      { name: "desktop", url: String.raw`dvbplay://\\192.168.178.75\media\FilmeHD3\Es.mkv` },
      { name: "android", url: "intent://192.168.178.75/media/FilmeHD3/Es.mkv#Intent;scheme=smb;package=org.videolan.vlc;end" },
    ]);
  });

  it("kodiert Leerzeichen", () => {
    const ziele = bauePlayUrls("/media/FilmeHD3/Nobodys Fool.mkv");
    expect(ziele[0].url).toContain("Nobodys%20Fool.mkv");
    expect(ziele[1].url).toContain("Nobodys%20Fool.mkv");
  });

  it("lässt Pfade außerhalb der Abbildung unverändert", () => {
    const ziele = bauePlayUrls("/andere/x.mkv");
    expect(ziele[0].url).toContain("/andere/x.mkv");
    expect(ziele[1].url).toContain("/andere/x.mkv");
  });
});
