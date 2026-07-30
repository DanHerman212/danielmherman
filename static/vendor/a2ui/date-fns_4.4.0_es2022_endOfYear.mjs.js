/* esm.sh - date-fns@4.4.0/endOfYear */
import{toDate as a}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function n(t,r){let e=a(t,r?.in),o=e.getFullYear();return e.setFullYear(o+1,0,0),e.setHours(23,59,59,999),e}var l=n;export{l as default,n as endOfYear};
