<script>
    const { metric, onChangeValue } = $props()

    function onChangeMetric(e) {
        if (onChangeValue) {
            onChangeValue(m)
        } else {
            window.location = `/charts/trends?sort=${m}`;
        }
    }
</script>
<form class="mb-3 d-flex justify-content-lg-end justify-content-xs-start" id="dropdown-form">
    <div class="row">
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeMetric}>
                <option value="-1" disabled>Choose Metric...</option>
                <option value="EPAplay" selected={(metric == "EPAplay")}>EPA/Play</option>
                <option value="yardsplay" selected={(metric == "yardsplay")}>Yards/Play</option>
                <option value="success" selected={(metric == "success")}>SR%</option>

                <optgroup label="Passing">
                    <option value="dropbacks" selected={(metric == "dropbacks")}>Dropbacks</option>
                    <option value="EPAdropback" selected={(metric == "EPAdropback")}>EPA/DB</option>
                    <option value="yardsdropback" selected={(metric == "yardsdropback")}>Yards/DB</option>
                    <option value="pass_success" selected={(metric == "pass_success")}>Pass SR%</option>
                    <option value="pass_explosive" selected={(metric == "pass_explosive")}>Pass Expl %</option>
                </optgroup>
                <optgroup label="Rushing">
                    <option value="rushes" selected={(metric == "rushes")}>Rush Attempts</option>
                    <option value="EPArush" selected={(metric == "EPArush")}>EPA/Rush</option>
                    <option value="yardsrush" selected={(metric == "yardsrush")}>Yards/Rush</option>
                    <option value="rush_success" selected={(metric == "rush_success")}>Rush SR%</option>
                    <option value="rush_explosive" selected={(metric == "rush_explosive")}>Rush Expl %</option>
                    <option value="opportunity_run" selected={(metric == "opportunity_run")}>Opportunity %</option>
                    <option value="lineyards" selected={(metric == "lineyards")}>Line Yards</option>
                    <option value="play_stuffed" selected={(metric == "play_stuffed")}>Stuffed %</option>
                </optgroup>
                <optgroup label="Other">
                    <option value="havoc" selected={(metric == "havoc")}>Havoc %</option>
                    <option value="explosive" selected={(metric == "explosive")}>Explosive %</option>
                    <option value="nonExplosiveEpaPerPlay" selected={(metric == "nonExplosiveEpaPerPlay")}>Non-Expl EPA/Play</option>
                    <option value="early_down_EPA" selected={(metric == "early_down_EPA")}>Early Downs EPA/Play</option>
                    <option value="early_down_success" selected={(metric == "early_down_success")}>Early Downs SR%</option>
                    <option value="late_down_success" selected={(metric == "late_down_success")}>Late Downs SR%</option>
                    <option value="third_down_distance" selected={(metric == "third_down_distance")}>Avg Distance (3rd)</option>
                    <option value="red_zone_success" selected={(metric == "red_zone_success")}>Red Zone SR%</option>
                    <option value="GEI" selected={(metric == "GEI")}>Game Excitement Index (GEI)</option>
                </optgroup>
            </select>
        </div>
    </div>
</form>