/* esm.sh - date-fns@4.4.0/nextDay */
import{addDays as f}from"./date-fns_4.4.0_es2022_addDays.mjs.js";import{getDay as o}from"./date-fns_4.4.0_es2022_getDay.mjs.js";function m(r,a,e){let t=a-o(r,e);return t<=0&&(t+=7),f(r,t,e)}var l=m;export{l as default,m as nextDay};
