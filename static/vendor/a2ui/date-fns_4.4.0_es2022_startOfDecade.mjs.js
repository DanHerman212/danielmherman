/* esm.sh - date-fns@4.4.0/startOfDecade */
import{toDate as n}from"./date-fns_4.4.0_es2022_toDate.mjs.js";function s(e,o){let t=n(e,o?.in),r=t.getFullYear(),a=Math.floor(r/10)*10;return t.setFullYear(a,0,1),t.setHours(0,0,0,0),t}var l=s;export{l as default,s as startOfDecade};
