import { expect, test } from "@playwright/test";

// Voraussetzung: laufender Container mit gültigem TMDB_API_KEY.
// Bootstrap-Zweig greift nur bei frischer DB (Volume leer);
// bei vorhandener DB meldet sich der Test als Admin an.
test("Smoke: Einrichtung → Suche → Hinzufügen → Bewerten → Abmelden", async ({ page }) => {
  const name = `tester_${Date.now()}`;
  const password = "geheim123";

  await page.goto("/");

  // Abweichung vom Brief: auf den Bootstrap-Button warten statt einmalig isVisible()
  // prüfen – isVisible() kann zu früh false liefern, solange /api/auth/status lädt.
  const einrichtung = page.getByRole("button", { name: "Einrichtung starten" });
  const bootstrap = await einrichtung
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (bootstrap) {
    await page.getByPlaceholder("Name").fill(name);
    await page.getByPlaceholder("Passwort").fill(password);
    await einrichtung.click();
  } else {
    await page.getByPlaceholder("Name").fill("Admin");
    await page.getByPlaceholder("Passwort").fill("geheim123");
    await page.getByRole("button", { name: "Anmelden" }).click();
  }
  await page.waitForURL("/");

  await page.getByRole("button", { name: "+ Film suchen" }).click();
  await page.getByPlaceholder("Titel bei TMDB suchen…").fill("Inception");
  // Abweichung vom Brief: exact: true – ohne matcht „+ Film suchen" (Substring)
  // zusätzlich den Submit-Button → Strict-Mode-Verletzung.
  await page.getByRole("button", { name: "Suchen", exact: true }).click();

  const addButton = page.getByRole("button", { name: "Hinzufügen" }).first();
  await addButton.waitFor();
  await addButton.click();

  // Abweichung vom Brief: Suchmodal explizit schließen – add() lässt es offen,
  // sein Backdrop (fixed, z-index 10) blockiert den Karten-Klick darunter.
  await page.getByRole("button", { name: "Schließen" }).click();

  await page.getByRole("button", { name: "Inception" }).first().click();
  await page.getByRole("button", { name: "5 Sterne" }).click();
  await page.getByRole("button", { name: "Gesehen" }).click();
  await page.getByRole("button", { name: "Schließen" }).click();

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByRole("heading", { name: "Filmdatenbank" })).toBeVisible();
});
