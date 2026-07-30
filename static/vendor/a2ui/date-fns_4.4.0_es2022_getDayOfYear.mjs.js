/* esm.sh - date-fns@4.4.0/getDayOfYear */
import{differenceInCalendarDays as f}from"./date-fns_4.4.0_es2022_differenceInCalendarDays.mjs.js";import{startOfYear as a}from"./date-fns_4.4.0_es2022_startOfYear.mjs.js";import{toDate as o}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function n(t,e){let r=o(t,e?.in);return f(r,a(r))+1}var s=n;export{s as default,n as getDayOfYear};
