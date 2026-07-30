/* esm.sh - date-fns@4.4.0/endOfMonth */
import{toDate as r}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function u(e,o){let t=r(e,o?.in),n=t.getMonth();return t.setFullYear(t.getFullYear(),n+1,0),t.setHours(23,59,59,999),t}var l=u;export{l as default,u as endOfMonth};
