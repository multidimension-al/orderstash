import {amazonUrl, inspectPage, InvoiceJob, PageSnapshot} from '../src/invoices/core';
const origin = 'https://www.amazon.com';
const job:InvoiceJob={orderId:'123-1234567-1234567',date:'2026-10-31',
  detailUrl:origin+'/your-orders/order-details?orderID=123-1234567-1234567',
  invoiceUrl:origin+'/gp/css/summary/print.html?orderID=123-1234567-1234567',status:'pending'};
const page=(overrides:Partial<PageSnapshot>={}):PageSnapshot=>({url:job.invoiceUrl,
  text:`Final Details for Order ${job.orderId}. Item subtotal $20.00. Shipping $0.00. `+
    'Tax $1.50. Grand total $21.50. Paid with card ending in 1234. Sold by Example. Delivery address: Synthetic Test.',
  heading:'Final Details for Order',signIn:false,challenge:false,links:[],...overrides});
test('prints only the recognized invoice for the expected order',()=>{
  expect(inspectPage(page(),job).kind).toBe('invoice');
  expect(inspectPage(page({text:page().text.replace(job.orderId,'456-1234567-1234567')}),job).kind).toBe('waiting');
});
test('navigates from details instead of printing them',()=>{
  expect(inspectPage(page({url:job.detailUrl,links:[{url:job.invoiceUrl,text:'View Invoice'}]}),job))
    .toEqual({kind:'navigate',url:job.invoiceUrl});
  expect(inspectPage(page({url:job.detailUrl,links:[{url:job.invoiceUrl.replace(job.orderId,'456-1234567-1234567'),text:'View Invoice'}]}),job).kind).toBe('waiting');
});
test.each([{signIn:true},{challenge:true},{url:origin+'/ap/signin'},
  {url:'https://www.amazon.ca/gp/css/summary/print.html'}])('stops before printing a blocked or cross-marketplace page %j',overrides=>{
  expect(inspectPage(page(overrides),job).kind).toBe('blocked');
});
test.each(['http://www.amazon.com/','https://www.amazon.com.evil.test/',
  'https://www.amazon.com@evil.test/','https://www.amazon.com:8443/',
  'javascript:alert(1)'])('rejects an unsafe Amazon address %s',url=>{
  expect(()=>amazonUrl(url)).toThrow();
});
