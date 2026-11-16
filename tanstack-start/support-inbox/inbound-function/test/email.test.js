import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanSubject,
  decodeWords,
  extractMessageIds,
  hashId,
  parseAddress,
  plusTag,
  previewOf,
  stripTag,
  subjectRef
} from '../src/email.js';

test('parseAddress handles quoted names, bare addresses and encoded words', () => {
  assert.deepEqual(parseAddress(`Walter O'Brien <Walter@Example.net>`), { name: "Walter O'Brien", email: 'walter@example.net' });
  assert.deepEqual(parseAddress(`"Doe, Jane" <jane@example.com>, other@example.com`), { name: 'Doe, Jane', email: 'jane@example.com' });
  assert.deepEqual(parseAddress('jane@example.com'), { name: '', email: 'jane@example.com' });
  assert.deepEqual(parseAddress('=?UTF-8?B?SMOpbMOobmU=?= <helene@example.fr>'), { name: 'Hélène', email: 'helene@example.fr' });
  assert.deepEqual(parseAddress(''), { name: '', email: '' });
});

test('decodeWords joins adjacent encoded words and decodes Q encoding', () => {
  assert.equal(decodeWords('=?UTF-8?Q?Caf=C3=A9_order?= =?UTF-8?Q?_1042?='), 'Café order 1042');
  assert.equal(decodeWords('Plain subject'), 'Plain subject');
});

test('plus tags and subject tokens resolve conversation refs', () => {
  assert.equal(plusTag('support+482913@inbound-mailroom-desk.appwrite.email'), '482913');
  assert.equal(plusTag('support@inbound-mailroom-desk.appwrite.email'), '');
  assert.equal(plusTag('support+billing@x.appwrite.email'), '');
  assert.equal(stripTag('Support+482913@X.appwrite.email'), 'support@x.appwrite.email');
  assert.equal(subjectRef('Re: Order 1042 did not arrive [#482913]'), '482913');
  assert.equal(cleanSubject('Re: Order 1042 [#482913] '), 'Re: Order 1042');
  assert.equal(cleanSubject('   '), '(no subject)');
});

test('extractMessageIds reads In-Reply-To and References chains', () => {
  assert.deepEqual(extractMessageIds(['<a@x>', '<b@y> <a@x>\r\n <c@z>']), ['<a@x>', '<b@y>', '<c@z>']);
  assert.deepEqual(extractMessageIds([]), []);
});

test('previewOf drops quoted history', () => {
  const text = 'Thanks, that fixed it!\n\nOn Wed, 23 Sep 2026 at 09:14, Support <support@x> wrote:\n> Try again';
  assert.equal(previewOf(text, ''), 'Thanks, that fixed it!');
  assert.equal(previewOf('', '<p>Hello&nbsp;<b>there</b></p><style>p{}</style>'), 'Hello there');
});

test('hashId is deterministic and a valid Appwrite ID', () => {
  const id = hashId('m', '<CAF3x9k2@mail.example.net>');
  assert.equal(id, hashId('m', '<CAF3x9k2@mail.example.net>'));
  assert.match(id, /^m[0-9a-f]{31}$/);
});
