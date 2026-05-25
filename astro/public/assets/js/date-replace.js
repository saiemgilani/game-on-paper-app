const DateTime = luxon.DateTime;
function formatDateTime(inputDate, format) {
    return DateTime.fromISO(inputDate).toLocaleString(format)
}
var gameContexts = document.getElementsByClassName("game-context");
if (gameContexts.length > 0) {
    console.log(gameContexts)
    for (var i = 0; i < gameContexts.length; i++) {
        let contextElem = gameContexts[i];
        let dateSpan = contextElem.querySelector('.game-date')
        let statusSpan = contextElem.querySelector('.game-status')
        if (statusSpan && (statusSpan.innerText.includes('FINAL') || statusSpan.innerText.startsWith('F'))) {
            dateSpan.innerText = formatDateTime(dateSpan.innerText, DateTime.DATE_SHORT)
        } else if (dateSpan) {
            dateSpan.innerText = formatDateTime(dateSpan.innerText, DateTime.DATETIME_SHORT)
        }
    }
} else {
    console.log("no game dates found")
}