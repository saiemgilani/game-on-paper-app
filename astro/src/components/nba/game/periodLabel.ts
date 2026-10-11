/** 1..4 -> "Q1".."Q4", 5 -> "OT", 6 -> "2OT". */
export const periodShort = (q: number) => (q <= 4 ? `Q${q}` : q === 5 ? 'OT' : `${q - 4}OT`);
/** 1 -> "1st Quarter", 5 -> "Overtime", 6 -> "2OT". */
export const periodLong = (q: number) => (q <= 4 ? `${['1st', '2nd', '3rd', '4th'][q - 1]} Quarter` : q === 5 ? 'Overtime' : `${q - 4}OT`);
