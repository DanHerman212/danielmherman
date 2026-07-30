/* esm.sh - date-fns@4.4.0/clamp */
import{normalizeDates as n}from"./date-fns_4.4.0_es2022__lib_normalizeDates.mjs.js";import{max as f}from"./date-fns_4.4.0_es2022_max.mjs.js";import{min as d}from"./date-fns_4.4.0_es2022_min.mjs.js";function i(m,t,r){let[e,a,o]=n(r?.in,m,t.start,t.end);return d([f([e,a],r),o],r)}var x=i;export{i as clamp,x as default};
