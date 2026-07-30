/* esm.sh - date-fns@4.4.0/setYear */
import{constructFrom as n}from"./date-fns_4.4.0_es2022_constructFrom.mjs.js";import{toDate as a}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function i(t,o,e){let r=a(t,e?.in);return isNaN(+r)?n(e?.in||t,NaN):(r.setFullYear(o),r)}var m=i;export{m as default,i as setYear};
