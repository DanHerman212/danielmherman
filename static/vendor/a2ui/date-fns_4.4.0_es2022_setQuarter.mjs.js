/* esm.sh - date-fns@4.4.0/setQuarter */
import{setMonth as f}from"./date-fns_4.4.0_es2022_setMonth.mjs.js";import{toDate as u}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function c(o,r,e){let t=u(o,e?.in),n=Math.trunc(t.getMonth()/3)+1,a=r-n;return f(t,t.getMonth()+a*3)}var d=c;export{d as default,c as setQuarter};
