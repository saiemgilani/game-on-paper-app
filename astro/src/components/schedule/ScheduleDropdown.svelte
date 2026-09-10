<script>
	import { GLOBAL_GROUP_LIST, GLOBAL_SCHEDULE_MAP } from '../../resources/schedule';
	import { LEAGUES, leaguePath } from '../../utils/league';

	// `league` is passed from SchedulePage (SSR knows Astro.locals.league);
	// it defaults to cfb so every existing caller is unchanged.
	const { season, week, seasontype, group, league = 'cfb' } = $props()
	const cfg = LEAGUES[league];
	// cfb weeks come from the static schedule map (bowl/CFP weeks vary by
	// season); the nfl calendar is fixed: 18 regular + 5 postseason rounds.
	const NFL_POST_LABELS = ['Wild Card', 'Divisional', 'Conference Championships', 'Pro Bowl', 'Super Bowl'];
	function weeksFor(s) {
		if (league === 'cfb') return GLOBAL_SCHEDULE_MAP[s] || [];
		const reg = Array.from({ length: cfg.regularSeasonWeeks }, (_, i) => ({ type: 2, value: i + 1, label: `Week ${i + 1}`, detail: 'Regular Season' }));
		const post = NFL_POST_LABELS.slice(0, cfg.postseasonWeeks).map((label, i) => ({ type: 3, value: i + 1, label, detail: 'Postseason' }));
		return reg.concat(post);
	}
	// svelte-ignore state_referenced_locally
	let selectedSeason = $state({ value: String(season) });
	let selectedSeasonWeeks = $derived({ value: weeksFor(selectedSeason.value) });
	let selectedGroup = $state({ value: cfg.defaultGroup === null ? null : (group || cfg.defaultGroup) });
	let selectedWeek = $state({ value: (week && seasontype) ? `${seasontype};${week}`: "-1;-1" });


	function onChangeSeason(e) {
		selectedSeason.value = e.target.value;

		document.getElementById("weekSelect").selectedIndex = 0;
		selectedWeek.value = "-1;-1"
	}

	function onSubmit(e) {
		e.preventDefault();

		var baseUrl = `/year/${selectedSeason.value}`
		if (selectedWeek.value != "-1;-1") {
			const cleanWeekItems = selectedWeek.value.split(';')
			const scheduleType = cleanWeekItems[0]
			const cleanWeek = cleanWeekItems[1]

			baseUrl += `/type/${scheduleType}/week/${cleanWeek}`
		}

		if (selectedGroup.value != null) {
			baseUrl += `?group=${selectedGroup.value}`;
		}

		window.location = leaguePath(league, baseUrl);
	}
</script>

<form class="form-picker mb-3">
    <div class="row">
        <div class="col-lg-auto mb-3">
            <select class="form-select form-select-lg" onchange={onChangeSeason}>
				<option value="-1" disabled>Choose Season...</option>
				{#each cfg.seasons as s}
					<option value={s} selected={(selectedSeason.value == s)}>{s}</option>
				{/each}
            </select>
        </div>
        <div class="col-lg-auto mb-3">
        <select class="form-select form-select-lg" id="weekSelect" onchange={(e) => selectedWeek.value = e.target.value}>
            <option value="-1;-1">Choose Week...</option>
			{#each selectedSeasonWeeks.value as w}
				<option value={`${w.type};${w.value}`} selected={selectedWeek.value == `${w.type};${w.value}`}>{`${w.label} (${w.detail})`}</option>
			{/each}
        </select>
        </div>

		{#if cfg.defaultGroup !== null}
        <div class="col-lg-auto mb-3">
            <select class="form-select form-select-lg" onchange={(e) => selectedGroup.value = e.target.value}>
				{#each GLOBAL_GROUP_LIST as g}
					<option value={g.id} selected={selectedGroup.value == g.id}>{g.name}</option>
				{/each}
            </select>
        </div>
		{/if}
        <div class="col-lg-auto mb-3">
            <button type="submit" class="btn btn-lg btn-primary" onclick={onSubmit}>View</button>
        </div>
    </div>
</form>
