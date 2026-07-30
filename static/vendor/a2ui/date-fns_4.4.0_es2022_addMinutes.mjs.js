/* esm.sh - date-fns@4.4.0/addMinutes */
import{millisecondsInMinute as n}from"./date-fns_4.4.0_es2022_constants.mjs.js";import{toDate as r}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function m(e,i,o){let t=r(e,o?.in);return t.setTime(t.getTime()+i*n),t}var u=m;export{m as addMinutes,u as default};
