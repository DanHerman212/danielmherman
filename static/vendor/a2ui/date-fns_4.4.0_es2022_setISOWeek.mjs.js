/* esm.sh - date-fns@4.4.0/setISOWeek */
import{getISOWeek as a}from"./date-fns_4.4.0_es2022_getISOWeek.mjs.js";import{toDate as n}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function i(o,r,e){let t=n(o,e?.in),f=a(t,e)-r;return t.setDate(t.getDate()-f*7),t}var d=i;export{d as default,i as setISOWeek};
