import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, normalizeEncoding, MAX_URL_LENGTH, TRACKING_PARAM } from '../src/index.js';

const key = (u, o) => normalizeUrl(u, o).key;

test('host and scheme are ignored by default and compared with keepHost', () => {
  assert.equal(key('https://www.example.com/women.html'), '/women.html');
  assert.equal(key('http://shop.example.com/women.html'), '/women.html');
  assert.equal(key('//www.example.com/a'), '/a');
  assert.equal(key('https://WWW.Example.com:443/a', { keepHost: true }), 'https://www.example.com/a');
  assert.equal(key('http://www.example.com:80/a', { keepHost: true }), 'http://www.example.com/a');
  assert.equal(key('http://www.example.com:8080/a', { keepHost: true }), 'http://www.example.com:8080/a');
  assert.notEqual(key('http://www.example.com/a', { keepHost: true }), key('https://www.example.com/a', { keepHost: true }));
  assert.equal(key('https://www.example.com', { keepHost: true }), 'https://www.example.com/');
});

test('a path without a leading slash, as in a Magento request_path, gets one', () => {
  assert.equal(key('linen-wrap-dress.html'), '/linen-wrap-dress.html');
  assert.equal(key(''), undefined);
  assert.match(normalizeUrl('   ').error, /empty/);
});

test('a trailing slash is removed by default and kept with strictSlash', () => {
  assert.equal(key('/women/'), '/women');
  assert.equal(key('/women//'), '/women');
  assert.equal(key('/'), '/');
  assert.equal(key('/women/', { strictSlash: true }), '/women/');
  assert.notEqual(key('/women/', { strictSlash: true }), key('/women', { strictSlash: true }));
});

test('paths are case sensitive by default and folded with caseInsensitive', () => {
  assert.notEqual(key('/Women'), key('/women'));
  assert.equal(key('/Women', { caseInsensitive: true }), '/women');
  assert.equal(key('/%C3%89t%C3%A9', { caseInsensitive: true }), key('/%c3%a9t%c3%a9'));
});

test('tracking parameters are dropped, other query parameters are kept in order, fragments removed', () => {
  assert.equal(key('/sale?utm_source=mail&utm_medium=x&gclid=1&fbclid=2'), '/sale');
  assert.equal(key('/sale?page=2&utm_campaign=x&sort=price'), '/sale?page=2&sort=price');
  assert.equal(key('/sale?UTM_Source=x'), '/sale');
  assert.equal(key('/sale#top'), '/sale');
  assert.equal(key('/sale?'), '/sale');
  assert.ok(TRACKING_PARAM.test('utm_content'));
  assert.ok(!TRACKING_PARAM.test('utmost'));
});

test('percent-encoding is normalised', () => {
  assert.equal(normalizeEncoding('/caf%c3%a9'), '/caf%C3%A9');
  assert.equal(normalizeEncoding('/%7Euser/%41bc'), '/~user/Abc');
  assert.equal(normalizeEncoding('/caf\u00E9'), '/caf%C3%A9');
  assert.equal(normalizeEncoding('/a b'), '/a%20b');
  assert.equal(normalizeEncoding('/100%'), '/100%25');
  assert.equal(key('/caf\u00E9'), key('/caf%c3%a9'));
  assert.equal(key('/a%2Fb'), '/a%2Fb');
});

test('addresses that are not web addresses are refused with the reason', () => {
  assert.match(normalizeUrl('mailto:shop@example.com').error, /not a web address/);
  assert.match(normalizeUrl('ftp://example.com/a').error, /not http or https/);
  assert.match(normalizeUrl('https://user:pass@example.com/a').error, /user name or password/);
  assert.match(normalizeUrl('https:///a').error, /no host/);
  assert.match(normalizeUrl(`/${'a'.repeat(MAX_URL_LENGTH)}`).error, /longer than 8192/);
});

test('the forms used to tell real redirects from case, slash and host changes', () => {
  const a = normalizeUrl('/FAQ/');
  const b = normalizeUrl('/faq');
  assert.notEqual(a.exact, b.exact);
  assert.equal(a.loose, b.loose);
  assert.equal(normalizeUrl('/').home, true);
  assert.equal(normalizeUrl('https://www.example.com').home, true);
  assert.equal(normalizeUrl('/?utm_source=x').home, true);
  assert.equal(normalizeUrl('/?page=2').home, false);
  assert.notEqual(normalizeUrl('http://www.example.com/a').full, normalizeUrl('https://www.example.com/a').full);
  assert.equal(normalizeUrl('http://www.example.com/a').exact, normalizeUrl('https://www.example.com/a').exact);
});
