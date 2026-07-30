/* esm.sh - date-fns@4.4.0/isWithinInterval */
import{toDate as e}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function c(i,n,t){let r=+e(i,t?.in),[m,o]=[+e(n.start,t?.in),+e(n.end,t?.in)].sort((a,s)=>a-s);return r>=m&&r<=o}var f=c;export{f as default,c as isWithinInterval};
