/* esm.sh - date-fns@4.4.0/getDaysInMonth */
import{constructFrom as s}from"./date-fns_4.4.0_es2022_constructFrom.mjs.js";import{toDate as c}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function u(e,n){let t=c(e,n?.in),r=t.getFullYear(),a=t.getMonth(),o=s(t,0);return o.setFullYear(r,a+1,0),o.setHours(0,0,0,0),o.getDate()}var f=u;export{f as default,u as getDaysInMonth};
