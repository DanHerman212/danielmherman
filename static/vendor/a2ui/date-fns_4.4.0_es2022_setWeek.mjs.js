/* esm.sh - date-fns@4.4.0/setWeek */
import{getWeek as n}from"./date-fns_4.4.0_es2022_getWeek.mjs.js";import{toDate as r}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function i(f,o,t){let e=r(f,t?.in),a=n(e,t)-o;return e.setDate(e.getDate()-a*7),r(e,t?.in)}var d=i;export{d as default,i as setWeek};
