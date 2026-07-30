/* esm.sh - date-fns@4.4.0/previousDay */
import{getDay as f}from"./date-fns_4.4.0_es2022_getDay.mjs.js";import{subDays as u}from"./date-fns_4.4.0_es2022_subDays.mjs.js";function a(t,o,e){let r=f(t,e)-o;return r<=0&&(r+=7),u(t,r,e)}var p=a;export{p as default,a as previousDay};
