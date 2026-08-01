<script>
	import { SCHEDULE_AVAILABLE_SEASONS } from '../../utils/constants';
    import { GLOBAL_GROUP_LIST, GLOBAL_SCHEDULE_MAP } from '../../resources/schedule';

	const { season, week, seasontype, group } = $props()
	// svelte-ignore state_referenced_locally
	let selectedSeason = $state({ value: String(season) });
	let selectedSeasonWeeks = $derived({ value: GLOBAL_SCHEDULE_MAP[selectedSeason.value] || [] });
	let selectedGroup = $state({ value: group || 80 });
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

		window.location = baseUrl;
	}
</script>

<form class="form-picker mb-3">
    <div class="row">
        <div class="col-lg-auto mb-3">
            <select class="form-select form-select-lg" onchange={onChangeSeason}>
				<option value="-1" disabled>Choose Season...</option>
				{#each SCHEDULE_AVAILABLE_SEASONS as s}
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
		
        <div class="col-lg-auto mb-3">
            <select class="form-select form-select-lg" onchange={(e) => selectedGroup.value = e.target.value}>
				{#each GLOBAL_GROUP_LIST as g}
					<option value={g.id} selected={selectedGroup.value == g.id}>{g.name}</option>
				{/each}
            </select>
        </div>
        <div class="col-lg-auto mb-3">
            <button type="submit" class="btn btn-lg btn-primary" onclick={onSubmit}>View</button>
        </div>
    </div>
</form>
