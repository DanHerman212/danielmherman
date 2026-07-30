/* esm.sh - date-fns@4.4.0/addDays */
import{constructFrom as o}from"./date-fns_4.4.0_es2022_constructFrom.mjs.js";import{toDate as a}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function f(e,r,i){let t=a(e,i?.in);return isNaN(r)?o(i?.in||e,NaN):(r&&t.setDate(t.getDate()+r),t)}var s=f;export{f as addDays,s as default};
