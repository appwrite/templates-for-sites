import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findAmount, findMerchant, hashId, parseAddress, parseReceipt, toNumber } from '../src/parse.js';

test('toNumber reads US, EU and spaced formats', () => {
  assert.equal(toNumber('1,234.56'), 1234.56);
  assert.equal(toNumber('1.234,56'), 1234.56);
  assert.equal(toNumber('1 234,56'), 1234.56);
  assert.equal(toNumber('12,50'), 12.5);
  assert.equal(toNumber('1.234'), 1234);
  assert.equal(toNumber('42'), 42);
});

test('findAmount prefers the total line over subtotal and tax', () => {
  const text = 'Subtotal $40.00\nTax $3.20\nTotal $43.20\nThanks!';
  assert.deepEqual(findAmount(text), { value: 43.2, currency: 'USD' });
});

test('findAmount prefers grand total and reads suffix currencies', () => {
  assert.deepEqual(findAmount('Total 10,00 EUR\nGrand total 12,50 EUR'), { value: 12.5, currency: 'EUR' });
  assert.deepEqual(findAmount('Amount paid: £1,020.00'), { value: 1020, currency: 'GBP' });
  assert.deepEqual(findAmount('Two items: ₹120 and ₹450'), { value: 450, currency: 'INR' });
  assert.equal(findAmount('No money here'), null);
});

test('findMerchant uses the forwarded sender, then the subject', () => {
  const forwarded = '---------- Forwarded message ---------\nFrom: Uber Receipts <noreply@uber.com>\nDate: Mon, 2 Nov 2026';
  assert.equal(findMerchant('Fwd: Your Monday evening trip', forwarded), 'Uber');
  assert.equal(findMerchant('Fwd: Your receipt from Blue Bottle Coffee #1234', ''), 'Blue Bottle Coffee');
  assert.equal(findMerchant('Your Lyft ride receipt', ''), 'Lyft');
  assert.equal(findMerchant('From: billing@notion.so', 'From: billing@notion.so'), 'Notion');
});

test('parseReceipt converts to minor units and falls back to the default currency', () => {
  const parsed = parseReceipt({ subject: 'Fwd: Receipt from Acme Hotel', text: 'Total: 189.40', defaultCurrency: 'EUR', receivedAt: new Date().toISOString() });
  assert.equal(parsed.merchant, 'Acme Hotel');
  assert.equal(parsed.currency, 'EUR');
  assert.equal(parsed.amount, 18940);
  const yen = parseReceipt({ subject: 'Order', text: 'Total ¥1,200', receivedAt: new Date().toISOString() });
  assert.equal(yen.currency, 'JPY');
  assert.equal(yen.amount, 1200);
});

test('parseAddress and hashId', () => {
  assert.deepEqual(parseAddress('"Doe, Jane" <Jane@Example.com>'), { name: 'Doe, Jane', email: 'jane@example.com' });
  assert.match(hashId('e', 'x'), /^e[0-9a-f]{31}$/);
});
