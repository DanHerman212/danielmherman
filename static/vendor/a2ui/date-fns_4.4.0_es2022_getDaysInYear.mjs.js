/* esm.sh - date-fns@4.4.0/getDaysInYear */
import{isLeapYear as a}from"./date-fns_4.4.0_es2022_isLeapYear.mjs.js";import{toDate as o}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function i(t,e){let r=o(t,e?.in);return Number.isNaN(+r)?NaN:a(r)?366:365}var m=i;export{m as default,i as getDaysInYear};
