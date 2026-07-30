/* esm.sh - date-fns@4.4.0/differenceInCalendarMonths */
import{normalizeDates as l}from"./date-fns_4.4.0_es2022__lib_normalizeDates.mjs.js";function i(n,r,o){let[e,t]=l(o?.in,n,r),a=e.getFullYear()-t.getFullYear(),f=e.getMonth()-t.getMonth();return a*12+f}var c=i;export{c as default,i as differenceInCalendarMonths};
