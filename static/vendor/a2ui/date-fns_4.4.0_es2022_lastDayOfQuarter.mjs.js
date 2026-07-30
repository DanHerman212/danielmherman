/* esm.sh - date-fns@4.4.0/lastDayOfQuarter */
import{toDate as s}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function a(n,e){let t=s(n,e?.in),o=t.getMonth(),r=o-o%3+3;return t.setMonth(r,0),t.setHours(0,0,0,0),t}var c=a;export{c as default,a as lastDayOfQuarter};
