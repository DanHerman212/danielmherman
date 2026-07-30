/* esm.sh - date-fns@4.4.0/max */
import{constructFrom as n}from"./date-fns_4.4.0_es2022_constructFrom.mjs.js";import{toDate as c}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function l(f,i){let t,o=i?.in;return f.forEach(r=>{!o&&typeof r=="object"&&(o=n.bind(null,r));let e=c(r,o);(!t||t<e||isNaN(+e))&&(t=e)}),n(o,t||NaN)}var a=l;export{a as default,l as max};
