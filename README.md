# Junction 2026

Two separate projects by the same team, built at Junction 2026. They share this repository and nothing else: each has its own folder, its own README and its own workflows.

| Folder | Project | Challenge |
|---|---|---|
| [`valio-aimo/`](valio-aimo/README.md) | **AimoPilot**: the open loading dock for AI buyers. A kitchen's purchasing agent orders from a wholesaler inside the rules its people set; plain code checks every order, and anything beyond the rules needs a person's sign-off on their phone. Live at <https://aimopilot.zeroanomaly.tech>. | Valio Aimo, "Trusted Trade Agents" |
| [`exa/`](exa/README.md) | **Beryl**: an internet butler for the web, the desktop and the phone. It shares no code with AimoPilot. Live at <https://beryl.zeroanomaly.tech>. | Exa, "The Internet Butler" |

Also here:

- [`research/`](research/): background research on the event and the challenges, shared by both projects.
- [`CLAUDE.md`](CLAUDE.md): the rules the coding agents work under, and who owns which folder.
- `.github/workflows/`: `ci`, `crash-gate`, `crash-models` and `demo-suite` belong to AimoPilot and run only when `valio-aimo/` changes; the `beryl-*` workflows belong to Beryl and run only when `exa/` changes.

[MIT](LICENSE).
