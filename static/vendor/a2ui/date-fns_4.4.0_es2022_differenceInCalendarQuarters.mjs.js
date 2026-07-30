/* esm.sh - date-fns@4.4.0/differenceInCalendarQuarters */
import{normalizeDates as l}from"./date-fns_4.4.0_es2022__lib_normalizeDates.mjs.js";import{getQuarter as t}from"./date-fns_4.4.0_es2022_getQuarter.mjs.js";function u(a,n,o){let[e,r]=l(o?.in,a,n),f=e.getFullYear()-r.getFullYear(),i=t(e)-t(r);return f*4+i}var m=u;export{m as default,u as differenceInCalendarQuarters};
