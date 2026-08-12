<script>
import { DateTime } from 'luxon';


const { divClass, date, format, prefix } = $props();
const formattedDate = DateTime.fromISO(date).toLocaleString(format);
</script>
{#if prefix}
<p class={divClass}>{`${prefix} - ${formattedDate}`}</p>
{/if}
{#if !prefix}
   <p class={divClass}>{`${formattedDate}`}</p>
{/if}