/* esm.sh - date-fns@4.4.0/areIntervalsOverlapping */
import{toDate as r}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function c(i,a,t){let[m,d]=[+r(i.start,t?.in),+r(i.end,t?.in)].sort((e,n)=>e-n),[f,u]=[+r(a.start,t?.in),+r(a.end,t?.in)].sort((e,n)=>e-n);return t?.inclusive?m<=u&&f<=d:m<u&&f<d}var s=c;export{c as areIntervalsOverlapping,s as default};
