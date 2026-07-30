/* esm.sh - date-fns@4.4.0/startOfQuarter */
import{toDate as s}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function u(n,r){let t=s(n,r?.in),o=t.getMonth(),e=o-o%3;return t.setMonth(e,1),t.setHours(0,0,0,0),t}var c=u;export{c as default,u as startOfQuarter};
