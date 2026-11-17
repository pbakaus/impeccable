<!-- side-tab in a component's style block: a pressed nav item whose radius
     sits on the base rule, and a hairline whose radius does too. The
     square hairline divider passes. -->
<nav>
  <button class="it" aria-pressed="true">Overview</button>
  <button class="it">Settings</button>
  <a class="link is-current" href="/a">Current</a>
  <span class="divider">|</span>
</nav>

<style>
  .it { display: grid; padding: 7px 12px; border: 0; border-radius: 6px; background: none; }
  .it:hover { background: var(--hover); }
  .it[aria-pressed='true'] { background: var(--surface-inset); box-shadow: inset 2px 0 0 var(--text); font-weight: 600; }
  .link { border-radius: 4px; }
  .link.is-current { border-left: 1px solid var(--text); }
  .divider { border-left: 1px solid #d4d4d4; }
</style>
