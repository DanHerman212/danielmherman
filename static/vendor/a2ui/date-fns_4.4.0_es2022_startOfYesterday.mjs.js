/* esm.sh - date-fns@4.4.0/startOfYesterday */
import{constructNow as n}from"./date-fns_4.4.0_es2022_constructNow.mjs.js";function c(o){let t=n(o?.in),r=t.getFullYear(),s=t.getMonth(),a=t.getDate(),e=n(o?.in);return e.setFullYear(r,s,a-1),e.setHours(0,0,0,0),e}var l=c;export{l as default,c as startOfYesterday};
