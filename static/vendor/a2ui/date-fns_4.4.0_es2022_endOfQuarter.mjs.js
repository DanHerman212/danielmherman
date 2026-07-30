/* esm.sh - date-fns@4.4.0/endOfQuarter */
import{toDate as s}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function u(n,e){let t=s(n,e?.in),o=t.getMonth(),r=o-o%3+3;return t.setMonth(r,0),t.setHours(23,59,59,999),t}var a=u;export{a as default,u as endOfQuarter};
