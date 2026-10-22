# usage-meter

![usage-meter: Clawd in neon visor next to the usage band](assets/banner.svg)

A Claude Code mod that draws a cyberpunk-style band above the prompt: how much is left of your 5-hour and weekly usage windows (with a cyan-to-magenta gradient bar and the time until each resets), plus the tokens you have spent, accumulated across sessions.

```
▓▒░ USAGE ░▒▓ │ 5H ████████░░░░ 77% resets 1h30m │ WEEK ███████░░░░░ 60% resets 3d4h │ ↑12.3k ↓678 TOK
```

The usage windows appear after the first response of a session, and only on a Claude subscription (Pro/Max).

## Install

At the prompt of a terminal session:

```
/plugin install usage-meter --marketplace PointerLex/claude-usage-meter
```

Answer `y` to add the marketplace, then pick a scope (user scope is first; press Enter).

From a shell:

```
claude plugin install usage-meter --marketplace PointerLex/claude-usage-meter
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `PointerLex/claude-usage-meter`, then Add plugin.
