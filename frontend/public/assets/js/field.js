
function Field(elementId, fieldColor = "rgb(0, 153, 41)", team1 = {color: "#B3A369", url: "https://a.espncdn.com/i/teamlogos/ncaa/500/59.png"}, team2 = {color: "#80000A", url: "https://a.espncdn.com/i/teamlogos/ncaa/500/60.png"}, baseLineWidth = 10) {	
    this.currentPoint = 0;
    this.currentPlayY = 15;
    this.isDrawn = false;

    this.sourceElement = document.getElementById(elementId)

    this.sourceElement.style.width = "720px";
    this.sourceElement.style.height = "300px";
    this.sourceElement.style.border = `12px white solid`;

    // Set actual size in memory (scaled to account for extra pixel density).
    const dpi = window.devicePixelRatio; // Change to 1 on retina screens to see blurry canvas.
    this.sourceElement.width = 720 * dpi;
    this.sourceElement.height = 300 * dpi;

    this.ctx = this.sourceElement.getContext('2d');
    this.ctx.scale(dpi, dpi);

    this.fieldWidth = 720;
    this.fieldHeight = 300;

    this.playLineWidth = (baseLineWidth / 300) * this.fieldHeight
    this.playYSpacer = ((baseLineWidth / 5) / 300) * this.fieldHeight;

    this.fieldColor = fieldColor;
    this.fieldSegment = this.fieldWidth / 12;
    
    this.draw = function() {
        if (this.isDrawn) {
            return;
        }
        this.ctx.fillStyle = this.fieldColor
        this.ctx.fillRect(0, 0, this.fieldWidth, this.fieldHeight);
        this.fillEndZones();
        this.drawFieldLines();

        this.ctx.save()
        this.ctx.textAlign = "right"
        this.ctx.font = "8px sans-serif";
        this.ctx.fillStyle = '#e8e6e3';
        this.ctx.fillText("From GameOnPaper.com, by Akshay Easwaran (@akeaswaran) and Saiem Gilani (@saiemgilani)", this.fieldWidth - (75 / 8.0) + 5, this.fieldHeight - 15)
        this.ctx.restore();

        this.isDrawn = true;
    }

    this.drawMidfieldLogo = function(url) {
        var ctx = this.ctx;
        let fieldWidth = this.fieldWidth;
        let fieldHeight = this.fieldHeight;

        logo = new Image();
        logo.src = url;
        logo.onload = function() {
            var imgSize = (75 / 300) * fieldHeight;                                 // get the context
            // ctx.save();
            ctx.save()
            ctx.drawImage(logo, (fieldWidth / 2) - (imgSize / 2), (fieldHeight / 2) - (imgSize / 2), imgSize, imgSize);   
            ctx.restore();
        }
    }


    hexToRgb = function(hex) {
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    determineLuminance = function(color) {
        var rgb = hexToRgb(color)
        return ((0.2126*rgb.r) + (0.7152*rgb.g) + (0.0722*rgb.b)) / 255
    }
    
    this.drawFieldLines = function() {   
        this.ctx.strokeStyle = "rgb(255, 255, 255)";
        this.ctx.lineWidth = 2;

        let hashmarkWidth = this.fieldSegment / 10
        let fiveYardHeight = (8 / 300) * this.fieldHeight
        let twoYardHeight = (5 / 300) * this.fieldHeight
        
        // actual field height = 53.3 yards
        // hash width = 40 feet
        let middleHashmarkSeparation = ((40 * 1.875) / 300) * this.fieldHeight

        //create yard lines
        for(var i = 0; i < 11; i++) {
            if (i != 0) {
                // top
                for (var j = 0; j < 5; j++) {
                    this.drawVerticalLine((i * this.fieldSegment) + (j * hashmarkWidth), 0, twoYardHeight);
                }
                this.drawVerticalLine((i * this.fieldSegment) + 5 * hashmarkWidth, 0, fiveYardHeight);
                for (var j = 6; j < 10; j++) {
                    this.drawVerticalLine((i * this.fieldSegment) + (j * hashmarkWidth), 0, twoYardHeight);
                }

                for (var j = 0; j < 10; j++) {
                    this.drawVerticalLine((i * this.fieldSegment) + (j * hashmarkWidth), (this.fieldHeight / 2) - (middleHashmarkSeparation / 2) - (fiveYardHeight / 2), (this.fieldHeight / 2) - (middleHashmarkSeparation / 2) + (fiveYardHeight / 2));
                    this.drawVerticalLine((i * this.fieldSegment) + (j * hashmarkWidth), (this.fieldHeight / 2) + (middleHashmarkSeparation / 2) - (fiveYardHeight / 2), (this.fieldHeight / 2) + (middleHashmarkSeparation / 2) + (fiveYardHeight / 2));
                }

                // bottom
                for (var j = 0; j < 5; j++) {
                    this.drawVerticalLine((i * this.fieldSegment) + (j * hashmarkWidth), (this.fieldHeight - twoYardHeight), this.fieldHeight);
                }
                this.drawVerticalLine((i * this.fieldSegment) + 5 * hashmarkWidth, (this.fieldHeight - fiveYardHeight), this.fieldHeight);
                for (var j = 6; j < 10; j++) {
                    this.drawVerticalLine((i * this.fieldSegment) + (j * hashmarkWidth), (this.fieldHeight - twoYardHeight), this.fieldHeight);
                }
            }

            if (i == 1 || i == 10) {
                this.drawVerticalLine((i * this.fieldSegment) + 5 * hashmarkWidth, (this.fieldHeight / 2) - (fiveYardHeight / 2), (this.fieldHeight / 2) + (fiveYardHeight / 2));
            }

            this.drawVerticalLine(this.fieldSegment + (i * this.fieldSegment));
        }

        let goalpostWidth = (18.5 * 1.875 / 300) * this.fieldHeight
        this.drawLine(0, (this.fieldHeight / 2) - (goalpostWidth / 2), 0, (this.fieldHeight / 2) + (goalpostWidth / 2), lineWidth = 10, color = "yellow");
        this.drawLine(this.fieldWidth, (this.fieldHeight / 2) - (goalpostWidth / 2), this.fieldWidth, (this.fieldHeight / 2) + (goalpostWidth / 2), lineWidth = 10, color = "yellow");
        // this.drawMidfieldLogo(team1.url)
    }
    
    this.drawVerticalLine = function(x, minY = 0, maxY = this.fieldHeight){
        this.ctx.beginPath();
        this.ctx.moveTo(x, minY);
        this.ctx.lineTo(x, maxY);
        this.ctx.stroke();
    }

    this.drawHorizontalLine = function(minX = 0, maxX = this.fieldWidth, y = 0){
        this.ctx.beginPath();
        this.ctx.moveTo(minX, y);
        this.ctx.lineTo(maxX, y);
        this.ctx.stroke();
    }

    this.drawLine = function(minX = 0, minY = 0, maxX = this.fieldWidth, maxY = this.fieldHeight, lineWidth = null, color = null) {
        if (color) {
            this.ctx.strokeStyle = color;
        }

        if (lineWidth) {
            this.ctx.lineWidth = lineWidth;
        }

        this.ctx.beginPath();
        this.ctx.moveTo(minX, minY);
        this.ctx.lineTo(maxX, maxY);
        this.ctx.stroke();
    }
    
    this.fillEndZones = function() {
        this.ctx.fillStyle = team1.color.startsWith("#") ? team1.color : `#${team1.color}`;
        this.ctx.fillRect(0, 0, this.fieldSegment, this.fieldHeight);
        this.ctx.fillStyle = team2.color.startsWith("#") ? team2.color : `#${team2.color}`;
        this.ctx.fillRect(this.fieldWidth - this.fieldSegment, 0, this.fieldSegment, this.fieldHeight);
    }

    this.translateYardsToGoal = function(x) {
        return (((100 - x) / 100) * (this.fieldWidth - (2 * this.fieldSegment))) + this.fieldSegment
    }

    this.markPlay = function(color, startYardline, endYardline, text = null) {
        startX = this.translateYardsToGoal(startYardline)
        endX = this.translateYardsToGoal(endYardline)

        let capLength = (this.fieldSegment / 10) / 2
        this.drawLine(startX, this.currentPlayY, endX - capLength, this.currentPlayY, lineWidth = this.playLineWidth, color = color)

        let capColor = (determineLuminance(color) > 0.5) ? "black" : "white"
        this.drawLine(endX - capLength, this.currentPlayY, endX, this.currentPlayY, lineWidth = this.playLineWidth, color = capColor)

        if (text) {
            let maxX = (startX > endX) ? startX : endX
            this.ctx.fillStyle = "white"
            this.ctx.font = "bold 10px sans-serif"
            this.ctx.fillText(text, maxX + 3, this.currentPlayY + 3);
        }

        this.currentPlayY = this.currentPlayY + this.playLineWidth + this.playYSpacer;
    }

    this.draw();
}