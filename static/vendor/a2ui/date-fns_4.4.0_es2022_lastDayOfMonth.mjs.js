/* esm.sh - date-fns@4.4.0/lastDayOfMonth */
import{toDate as o}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function a(n,e){let t=o(n,e?.in),r=t.getMonth();return t.setFullYear(t.getFullYear(),r+1,0),t.setHours(0,0,0,0),o(t,e?.in)}var u=a;export{u as default,a as lastDayOfMonth};
