// Synthetic account data shared by the parser and real-Chrome tests.
const ids = ['123-1234567-1234567', '456-1234567-1234567'];
const origin = 'https://www.amazon.com';
function html(body) {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Order fixture</title>' +
    '<style>body{font:16px Arial;margin:32px}td{padding:8px}' +
    '@media print{.no-print{display:none}}</style></head><body>' +
    body +
    '</body></html>'
  );
}
function item(index) {
  return (
    `<div class="a-fixed-left-grid-inner"><a class="a-link-normal" href="/gp/product/B00000000${index}">` +
    `${index ? 'Replacement cable' : 'Proton pack parts'}</a>` +
    '<span class="item-view-qty">2</span><span class="a-color-price">$10.00</span></div>'
  );
}
function listing(index = 0, year = 2026) {
  const id = year === 2024 ? '234-1234567-1234567' : year === 2025 ? '789-1234567-1234567' : ids[index];
  return html(
    `<div id="nav-link-accountList-nav-line-1">Hello, Synthetic Test</div><select name="timeFilter"><option value="year-2026" ${year === 2026 ? 'selected' : ''}>2026</option><option value="year-2025" ${year === 2025 ? 'selected' : ''}>2025</option><option value="year-2024" ${year === 2024 ? 'selected' : ''}>2024</option></select><span class="num-orders">${year !== 2026 ? 1 : 2} orders</span><h1>Your Orders</h1><div class="order-card js-order-card"><div class="order-header">` +
      `<div><div><span>Order placed</span></div><div><span class="value">October 31, ${year}</span></div></div>` +
      '<div><div><span>Total</span></div><div><span class="value">$21.50</span></div></div>' +
      '<div class="recipient"><span class="trigger-text">Synthetic Test</span></div></div>' +
      `<div class="yohtmlc-order-id"><span dir="ltr">${id}</span></div>` +
      `<a href="/your-orders/order-details?orderID=${id}">Order details</a>${item(index)}</div>` +
      (index === 0 && year === 2026
        ? '<ul class="a-pagination"><li class="a-last"><a href="/your-orders/orders?timeFilter=year-2026&amp;startIndex=10&amp;language=en_US">Next</a></li></ul>'
        : ''),
  );
}
function details(id) {
  return html(
    `<h1>Order Details</h1><p>Order ${id}</p><p>Grand Total: $21.50</p>` +
      '<div class="displayAddressFullName">Synthetic Test</div>' +
      '<div class="a-box shipment shipment-is-delivered"><div data-component="shipmentStatus">Delivered October 31</div>' +
      item(ids.indexOf(id)) +
      '</div>' +
      `<a href="/gp/css/summary/print.html?orderID=${id}">View Invoice</a>`,
  );
}
function longListing(index = 0) {
  const template = listing(1);
  const card = template.match(/<div class="order-card[\s\S]*<\/div>(?=<\/body>)/)[0];
  const cards = Array.from({length: 10}, (_, offset) =>
    card.replaceAll(ids[1], `123-1234567-${String(1000000 + index * 10 + offset)}`)).join('');
  return template.replace(card, cards + (index < 4
    ? `<ul class="a-pagination"><li class="a-last"><a href="/your-orders/orders?timeFilter=year-2026&amp;startIndex=${(index + 1) * 10}&amp;language=en_US">Next</a></li></ul>` : ''))
    .replace('2 orders', '50 orders');
}
function invoice(id) {
  return html(
    `<h1>Final Details for Order #${id}</h1><p>Order placed October 31, 2026</p>` +
      '<table><tr><td>Fixture item: Proton pack replacement parts</td><td>$20.00</td></tr></table>' +
      '<p>Shipping and handling: $0.00</p><p>Tax: $1.50</p><p>Grand Total: $21.50</p>' +
      '<p>Sold by Test Seller</p><p>Shipping Address: Synthetic Test, 123 Example Road, Test City</p>' +
      '<p>Payment Method: Card ending in 1234</p><p class="no-print">DO NOT PRINT THIS CONTROL</p>' +
      '<div id="navFooter" style="display:block!important;background:#232f3e;color:white;padding:80px">' +
      'AMAZON BLUE FOOTER MUST NOT PRINT</div><script>window.print()</script>',
  );
}
function transactions(index = 0) {
  return html(
    '<h1>Your payment transactions</h1><div class="transaction-date-container">' +
      (index ? 'October 30, 2026' : 'October 31, 2026') +
      '</div><div>' +
      '<div class="transactions-line-item"><div><span>Visa ****1234</span><span>' +
      (index ? '-$5.00' : '$21.50') +
      '</span></div>' +
      `<div><a href="/your-orders/order-details?orderID=${ids[index]}">Order #${ids[index]}</a></div>` +
      '<div>Amazon</div></div></div>' +
      (index
        ? '<button disabled>Next Page</button>'
        : '<a href="/cpe/yourpayments/transactions?page=2">Next Page</a>'),
  );
}
module.exports = {ids, origin, html, listing, longListing, details, invoice, transactions};
