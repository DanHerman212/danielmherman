/* esm.sh - date-fns@4.4.0/constructFrom */
import{constructFromSymbol as n}from"./date-fns_4.4.0_es2022_constants.mjs.js";function t(r,o){return typeof r=="function"?r(o):r&&typeof r=="object"&&n in r?r[n](o):r instanceof Date?new r.constructor(o):new Date(o)}var f=t;export{t as constructFrom,f as default};
