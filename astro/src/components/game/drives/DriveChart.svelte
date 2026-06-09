
<script>
const { id, subtitle, plays, offense, isNeutralSite } = $props();

let fieldColor = "rgb(0, 153, 41)" //"rgba(0, 153, 41, 1.0)" // transparent to avoid issues with team colors
if (!isNeutralSite && homeTeam.id == 68) {
    fieldColor = "#12329A"; // Boise State
} else if (!isNeutralSite && homeTeam.id == 324) {
    fieldColor = "#307077"; // Coastal Carolina
}

// /* Based off https://github.com/criscokid/Canvas-Field */
let currentPoint = 0;
let currentPlayY = 15;
let isDrawn = false;

const sourceElement = document.getElementById(elementId)

sourceElement.style.width = "720px";
sourceElement.style.height = "300px";
sourceElement.style.border = `12px white solid`;

// Set actual size in memory (scaled to account for extra pixel density).
const dpi = window.devicePixelRatio; // Change to 1 on retina screens to see blurry canvas.
sourceElement.width = 720 * dpi;
sourceElement.height = 300 * dpi;

const ctx = sourceElement.getContext('2d');
ctx.scale(dpi, dpi);

const fieldWidth = 720;
const fieldHeight = 300;

const playLineWidth = (baseLineWidth / 300) * fieldHeight
const playYSpacer = ((baseLineWidth / 5) / 300) * fieldHeight;

const fieldSegment = fieldWidth / 12;


function draw() {
    if (isDrawn) {
        return;
    }
    ctx.save()
    ctx.fillStyle = fieldColor
    ctx.fillRect(0, 0, fieldWidth, fieldHeight);
    // drawMidfieldLogo("/assets/img/favicon.svg");
    fillEndZones();
    drawFieldLines();
    ctx.restore()

    drawRoundedRectText("From GameOnPaper.com, by Akshay Easwaran (@akeaswaran) and Saiem Gilani (@saiemgilani)", fieldWidth - (0.5 * fieldWidth) + 5, fieldHeight - 15, "8px sans-serif")

    if (subtitle) {
        drawRoundedRectText(subtitle, 5, (fieldHeight - 15), "8px sans-serif")
    }

    isDrawn = true;
}

function drawRoundedRectText(text, x, y, font = "10px sans-serif", rectColor = "rgba(0,0,0,0.7)", textColor = "white", textAlign = "left", padding = 3) {
    ctx.save()
    ctx.beginPath()
    ctx.font = font;
    let textWidth = ctx.measureText(text).width;
    ctx.fillStyle = rectColor

    let fontHeight = parseInt(font, 10)
    let lineHeight = fontHeight + 2.5

    ctx.roundRect(x - (padding / 2), y - (lineHeight / 2), textWidth + padding, lineHeight, (3.125 / 8) * fontHeight);
    ctx.fill();
    ctx.restore();

    ctx.save()
    ctx.font = font;
    ctx.textAlign = textAlign
    ctx.fillStyle = textColor;
    ctx.fillText(text, x, y + (3 / 8) * fontHeight)
    ctx.restore();
}

function drawMidfieldLogo(url) {
    let fieldWidth = fieldWidth;
    let fieldHeight = fieldHeight;

    logo = new Image();
    logo.src = url;
    logo.onload = function() {
        var imgSize = (50 / 300) * fieldHeight;                                 // get the context
        // ctx.save();
        ctx.save()
        ctx.globalAlpha = 0.5;
        ctx.drawImage(logo, (fieldWidth / 2) - (imgSize / 2), (fieldHeight / 2) - (imgSize / 2), imgSize, imgSize);   
        ctx.restore();
    }
}

function drawFieldLines() {   
    ctx.strokeStyle = "rgb(255, 255, 255)";
    ctx.lineWidth = 2;

    let hashmarkWidth = fieldSegment / 10
    let fiveYardHeight = (8 / 300) * fieldHeight
    let twoYardHeight = (5 / 300) * fieldHeight
    
    // actual field height = 53.3 yards
    // hash width = 40 feet
    let middleHashmarkSeparation = ((40 * 1.875) / 300) * fieldHeight

    //create yard lines
    for(var i = 0; i < 11; i++) {
        if (i != 0) {
            // top
            for (var j = 0; j < 5; j++) {
                drawVerticalLine((i * fieldSegment) + (j * hashmarkWidth), 0, twoYardHeight);
            }
            drawVerticalLine((i * fieldSegment) + 5 * hashmarkWidth, 0, fiveYardHeight);
            for (var j = 6; j < 10; j++) {
                drawVerticalLine((i * fieldSegment) + (j * hashmarkWidth), 0, twoYardHeight);
            }

            for (var j = 0; j < 10; j++) {
                drawVerticalLine((i * fieldSegment) + (j * hashmarkWidth), (fieldHeight / 2) - (middleHashmarkSeparation / 2) - (fiveYardHeight / 2), (fieldHeight / 2) - (middleHashmarkSeparation / 2) + (fiveYardHeight / 2));
                drawVerticalLine((i * fieldSegment) + (j * hashmarkWidth), (fieldHeight / 2) + (middleHashmarkSeparation / 2) - (fiveYardHeight / 2), (fieldHeight / 2) + (middleHashmarkSeparation / 2) + (fiveYardHeight / 2));
            }

            // bottom
            for (var j = 0; j < 5; j++) {
                drawVerticalLine((i * fieldSegment) + (j * hashmarkWidth), (fieldHeight - twoYardHeight), fieldHeight);
            }
            drawVerticalLine((i * fieldSegment) + 5 * hashmarkWidth, (fieldHeight - fiveYardHeight), fieldHeight);
            for (var j = 6; j < 10; j++) {
                drawVerticalLine((i * fieldSegment) + (j * hashmarkWidth), (fieldHeight - twoYardHeight), fieldHeight);
            }
        }

        if (i == 1 || i == 10) {
            drawVerticalLine((i * fieldSegment) + 5 * hashmarkWidth, (fieldHeight / 2) - (fiveYardHeight / 2), (fieldHeight / 2) + (fiveYardHeight / 2));
        }

        if ((i % 5) == 0) {
            drawVerticalLine(fieldSegment + (i * fieldSegment), 0, fieldHeight, lineWidth = 5);
        } else {
            drawVerticalLine(fieldSegment + (i * fieldSegment), 0, fieldHeight, lineWidth = 2);
        }

        
    }

    let goalpostWidth = (18.5 * 1.875 / 300) * fieldHeight
    drawLine(0, (fieldHeight / 2) - (goalpostWidth / 2), 0, (fieldHeight / 2) + (goalpostWidth / 2), lineWidth = 10, color = "yellow");
    drawLine(fieldWidth, (fieldHeight / 2) - (goalpostWidth / 2), fieldWidth, (fieldHeight / 2) + (goalpostWidth / 2), lineWidth = 10, color = "yellow");
    // drawMidfieldLogo(team1.url)
}

function drawVerticalLine(x, minY = 0, maxY = fieldHeight, lineWidth = 2) {
    ctx.save()
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
    ctx.stroke();
    ctx.restore()
}

function drawHorizontalLine(minX = 0, maxX = fieldWidth, y = 0, lineWidth = 2) {
    ctx.save()
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
    ctx.stroke();
    ctx.restore()
}

function drawLine(minX = 0, minY = 0, maxX = fieldWidth, maxY = fieldHeight, lineWidth = null, color = null, shadow = null) {
    if (color) {
        ctx.strokeStyle = color;
    }

    if (lineWidth) {
        ctx.lineWidth = lineWidth;
    }

    if (shadow) {
        ctx.shadowColor = shadow;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1.25;
    }

    ctx.beginPath();
    ctx.moveTo(minX, minY);
    ctx.lineTo(maxX, maxY);
    ctx.stroke();
}

function fillEndZones() {
    ctx.fillStyle = team1.color.startsWith("#") ? team1.color : `#${team1.color}`;
    ctx.fillRect(0, 0, fieldSegment, fieldHeight);
    ctx.fillStyle = team2.color.startsWith("#") ? team2.color : `#${team2.color}`;
    ctx.fillRect(fieldWidth - fieldSegment, 0, fieldSegment, fieldHeight);
}

function translateYardsToGoal(x) {
    return (((100 - x) / 100) * (fieldWidth - (2 * fieldSegment))) + fieldSegment
}

function markPlay(color, startYardline, endYardline, text = null, annotation = null) {
    ctx.save();
    startX = translateYardsToGoal(startYardline)
    endX = translateYardsToGoal(endYardline)

    let capLength = (fieldSegment / 10) / 2
    drawLine(startX, currentPlayY, endX - capLength, currentPlayY, lineWidth = playLineWidth, color = color)

    let capColor = (determineLuminance(color) > 0.5) ? "black" : "white"
    drawLine(endX - capLength, currentPlayY, endX, currentPlayY, lineWidth = playLineWidth, color = capColor)

    if (text) {
        var minX = (startYardline < endYardline) ? endYardline : startYardline
        minX = translateYardsToGoal(minX - 0.5)
        if (minX >= (endX - capLength) && minX <= endX) {
            minX += (capLength + 2)
        }
        drawRoundedRectText(text, minX, currentPlayY, font = "8px sans-serif", rectColor = "#00000000", textColor = "white")
    }

    if (annotation) {
        let maxX = (startX > endX) ? startX : endX
        drawRoundedRectText(annotation, maxX + 3, currentPlayY)
    }

    currentPlayY = currentPlayY + playLineWidth + playYSpacer;
    ctx.restore();
}

draw();


for (var i = 0; i < plays.length; i++) {
    let play = plays[i];
    let annotation = (i == plays.length - 1) ? `'${result}'` : null
    var text = (play['rush'] == true) ? `'R'` : null
    text = (play['pass'] == true) ? `'P'` : text
    let endYardsToEndzone = (play.end.team.id != play.start.team.id) ? 100 - play.end.yardsToEndzone : play.end.yardsToEndzone
    endYardsToEndzone = (play.end.team.id == play.start.team.id & play.end.yardsToEndzone == 99) ? 0 : endYardsToEndzone
    endYardsToEndzone = (play.type.text.includes("Punt") || (play.end.team.id != play.start.team.id & play.end.yardsToEndzone == 99)) ? play.start.yardsToEndzone : endYardsToEndzone;
    if (!['Kickoff', 'Timeout', 'Kickoff Return (Offense)', "Field Goal Good", "Field Goal Missed"].includes(play.type.text)) {
        markPlay(`#${offense.color}`, `${play.start.yardsToEndzone}`, `${endYardsToEndzone}`, `${text}`, `${annotation}`);
    } else if (["Field Goal Good", "Field Goal Missed"].includes(play.type.text)) {
        markPlay(`#${offense.color}`, `${play.start.yardsToEndzone}`, `${play.start.yardsToEndzone}`, `${text}`, `${annotation}`);
    }
}
</script>

<canvas id={`football-field-${id}`}></canvas>