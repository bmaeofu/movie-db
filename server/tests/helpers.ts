/** Kopfzeilen, die die Hauptanwendung einem Aufruf mitgibt. */
export interface TestIdentity {
  id?: string;
  name?: string;
  email?: string;
  groups?: string[];
}

/** Ein angemeldeter Mensch, wie ihn der Proxy weiterreicht. */
export function asUser(identity: TestIdentity = {}): Record<string, string> {
  return {
    "x-user-id": identity.id ?? "sub-test",
    "x-user-name": identity.name ?? "tester",
    "x-user-email": identity.email ?? "tester@example.org",
    "x-user-groups": (identity.groups ?? ["rc-timercontrol-users"]).join(","),
  };
}

/** Derselbe Mensch, aber in der Administratorgruppe des Anbieters. */
export function asAdmin(identity: TestIdentity = {}): Record<string, string> {
  return asUser({ id: "sub-admin", name: "Anna", groups: ["rc-timercontrol-admins"], ...identity });
}
