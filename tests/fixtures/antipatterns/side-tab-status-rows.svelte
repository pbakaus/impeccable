<!--
  A status table in a component. The broken row's first cell carries a 3px
  stripe coloured through a token another sheet declares
  (side-tab-status-rows.tokens.css): it reports as a side tab. The selected
  row's stripe, a neutral divider and a header underline stay silent.
-->
<script>
  export let rows = [];
</script>

<table>
  <tbody>
    {#each rows as r}
      <tr class:is-broken={r.broken} class:is-selected={r.selected}>
        <td>{r.name}</td>
        <td class="divided">{r.status}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  table { width: 720px; border-collapse: collapse; }
  td { height: 40px; padding: 8px 12px; }
  tr.is-broken > td:first-child { box-shadow: inset 3px 0 0 var(--fixture-mark-broken); }
  tr.is-selected > td:first-child { box-shadow: inset 3px 0 0 var(--fixture-mark-broken); }
  td.divided { box-shadow: inset 1px 0 0 var(--fixture-mark-broken); }
  th.is-sorted { box-shadow: inset 0 -3px 0 var(--fixture-mark-broken); }
</style>
