// import axios from 'axios';
// import logger from './logger.js';
// 
// import crypto from 'node:crypto';
// import path from 'node:path';
// import ejs from 'ejs';

import { MEME_LIST } from "./constants";



// function generateKey(parts, sep = "-") {
//     const valid = parts.filter(p => (p))
//     if (valid.length == 0) {
//         throw new Error("invalid key")
//     }
//     return valid.join(sep)
// }




export function cleanUpParams(payload: any): any {
    let query = {...payload};
    for (let param in query) { 
        if (query[param] === undefined /* In case of undefined assignment */
            || query[param] === null 
            || query[param] === ""
        ) {    
            delete query[param];
        }
    }
    return query;
}

// async function ping(url) {
//     let check = { "status": 404 };
//     try {
//         check = await axios.get(url)
//         return { "status": check.status } 
//     } catch (err) {
//         logger.error(`Error while checking status of ${url}: ${err}`)
//         return { "status": 500 };
//     }
// }

// async function sleep(sec) {
//   return new Promise((resolve) => {
//     setTimeout(resolve, sec * 1000);
//   });
// }

// function generateChecksum(game) {
//     return crypto.createHash('sha256').update(JSON.stringify(game)).digest('hex');
// }


// https://stackoverflow.com/questions/8273047/javascript-function-similar-to-python-range
export function range(start: number, end: number): number[] {
    return Array.from(Array(end + 1).keys()).slice(start);
}

export function roundNumber(value: string | number | null, power10: number, fixed: number): string {
    if (typeof value == "number") {
        value = `${value}`;
    }
    return (Math.round(parseFloat(value || "0") * (Math.pow(10, power10))) / (Math.pow(10, power10))).toFixed(fixed)
}

export function hexToRgb(hex: string): { r: number, g: number, b: number } | null {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

export function getNumberWithOrdinal(n: number): string {
    let s = ["th", "st", "nd", "rd"];
    let v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function toTitleCase(str: string) {
  return str.replace(
    /\w\S*/g,
    text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
  );
}

