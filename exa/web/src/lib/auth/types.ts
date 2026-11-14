/** The signed-in account, as much of it as the interface needs. Shared by the server and the browser. */
export type SessionUser = { id: string; email: string; name: string; role: "user" | "admin" };
