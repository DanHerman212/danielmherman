/* esm.sh - date-fns@4.4.0/endOfYesterday */
import{constructFrom as o}from"./date-fns_4.4.0_es2022_constructFrom.mjs.js";import{constructNow as n}from"./date-fns_4.4.0_es2022_constructNow.mjs.js";function u(r){let t=n(r?.in),e=o(r?.in,0);return e.setFullYear(t.getFullYear(),t.getMonth(),t.getDate()-1),e.setHours(23,59,59,999),e}var a=u;export{a as default,u as endOfYesterday};
