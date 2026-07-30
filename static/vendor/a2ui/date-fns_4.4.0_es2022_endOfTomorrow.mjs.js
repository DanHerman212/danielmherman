/* esm.sh - date-fns@4.4.0/endOfTomorrow */
import{constructNow as o}from"./date-fns_4.4.0_es2022_constructNow.mjs.js";function u(t){let n=o(t?.in),r=n.getFullYear(),c=n.getMonth(),a=n.getDate(),e=o(t?.in);return e.setFullYear(r,c,a+1),e.setHours(23,59,59,999),t?.in?t.in(e):e}var l=u;export{l as default,u as endOfTomorrow};
