/* esm.sh - date-fns@4.4.0/startOfTomorrow */
import{constructFrom as s}from"./date-fns_4.4.0_es2022_constructFrom.mjs.js";import{constructNow as a}from"./date-fns_4.4.0_es2022_constructNow.mjs.js";function u(r){let t=a(r?.in),e=t.getFullYear(),n=t.getMonth(),c=t.getDate(),o=s(r?.in,0);return o.setFullYear(e,n,c+1),o.setHours(0,0,0,0),o}var l=u;export{l as default,u as startOfTomorrow};
