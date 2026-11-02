# agent-plugins

![plugins](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/remsky/agent-plugins/main/.claude-plugin/marketplace.json&query=$.plugins.length&label=plugins&color=blue)

Plugins for Claude Code.

## Install

Updates follow the commit SHA on `main`. Run `claude plugin update usage-band@remsky`.

```
/plugin marketplace add remsky/agent-plugins
```

## Plugins

<details open>
<summary><b>usage-band</b> [<img src="usage-band/.claude-plugin/icon.png" height="20" align="top">]: Claude Code Mod: live usage and cache monitoring band</summary>
<br>

```
/plugin marketplace add remsky/agent-plugins
/plugin install usage-band@remsky
```

Shows a live status of your (startup) + message token counts, time until your next 5-hour reset, a stacked 5hr/weekly limit usages, and an expiry timer on your sessions prompt cache (with a 15 minute grace period to minimize visual clutter).
- Threshold values for the the colour changes can be changed to match your workflow. 
- *If you use an API key, set cache lifetime to 5 minutes on the config screen.*

<p align="center">
  <img src="assets/usage-band.png" height="200" alt="Six states of the usage band, from a fresh session to a cold and rebuilt cache, with labels for tokens, limit usage, 5-hour reset, and prompt cache">
  <img src="assets/usage-band-config.png" height="200" alt="The usage-band options screen, with the token color limits, the cache lifetime, when the cache countdown shows, and the rebuild limit">
</p>

</details>
