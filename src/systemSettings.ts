export type SystemSettings={staff_timeout_seconds:number;currency:'EUR'|'GBP';allow_booking_for_others:boolean;confirmation_delivery:string;amendment_delivery:string;cancellation_delivery:string;voucher_delivery:string;revision:number};
export const defaultSystemSettings:SystemSettings={staff_timeout_seconds:300,currency:'EUR',allow_booking_for_others:true,confirmation_delivery:'email',amendment_delivery:'email',cancellation_delivery:'email',voucher_delivery:'email',revision:0};
let current={...defaultSystemSettings};
export const getCurrency=()=>current.currency;
export const currencySymbol=()=>current.currency==='GBP'?'£':'€';
export function applySystemSettings(value:Partial<SystemSettings>){current={...defaultSystemSettings,...value};window.dispatchEvent(new window.Event('salon-settings-changed'));}
export const getSystemSettings=()=>current;
