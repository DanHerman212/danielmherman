/* esm.sh - date-fns@4.4.0/closestIndexTo */
import{toDate as r}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function f(i,s){let a=+r(i);if(isNaN(a))return NaN;let t,e;return s.forEach((N,c)=>{let o=r(N);if(isNaN(+o)){t=NaN,e=NaN;return}let n=Math.abs(a-+o);(t==null||n<e)&&(t=c,e=n)}),t}var u=f;export{f as closestIndexTo,u as default};
