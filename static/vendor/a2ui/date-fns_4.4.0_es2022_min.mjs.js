/* esm.sh - date-fns@4.4.0/min */
import{constructFrom as n}from"./date-fns_4.4.0_es2022_constructFrom.mjs.js";import{toDate as c}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function l(i,f){let t,o=f?.in;return i.forEach(r=>{!o&&typeof r=="object"&&(o=n.bind(null,r));let e=c(r,o);(!t||t>e||isNaN(+e))&&(t=e)}),n(o,t||NaN)}var p=l;export{p as default,l as min};
