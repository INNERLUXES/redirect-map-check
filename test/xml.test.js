import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSitemapXml, decodeXmlText, XML_ESCAPES, MAX_DEPTH } from '../src/index.js';

const urlset = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;

test('a sitemap gives the text of each <loc> inside <url>', () => {
  const doc = readSitemapXml(urlset('<url><loc> https://www.example.com/a </loc><lastmod>x</lastmod></url><url><loc>https://www.example.com/b</loc></url>'));
  assert.equal(doc.kind, 'urlset');
  assert.deepEqual(doc.locs, ['https://www.example.com/a', 'https://www.example.com/b']);
});

test('<loc> elsewhere, such as an image or a hreflang link, is not read', () => {
  const doc = readSitemapXml(urlset(
    '<url><loc>https://www.example.com/a</loc><image:image><image:loc>https://www.example.com/a.jpg</image:loc></image:image>'
    + '<xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/a"/></url>'
  ));
  assert.deepEqual(doc.locs, ['https://www.example.com/a']);
});

test('XML escapes and character references are decoded; unknown ones are refused', () => {
  assert.equal(decodeXmlText('a&amp;b&lt;c&gt;d&quot;e&apos;f'), 'a&b<c>d"e\'f');
  assert.equal(decodeXmlText('caf&#233;&#xE9;'), 'caf\u00E9\u00E9');
  assert.deepEqual(Object.keys(XML_ESCAPES), ['lt', 'gt', 'amp', 'quot', 'apos']);
  assert.throws(() => decodeXmlText('&nbsp;'), /unknown escape &nbsp;/);
  assert.throws(() => decodeXmlText('a & b'), /bare "&"/);
  assert.throws(() => decodeXmlText('&#0;'), /not a valid character/);
  const doc = readSitemapXml(urlset('<url><loc>https://www.example.com/search?q=a&amp;page=2</loc></url>'));
  assert.deepEqual(doc.locs, ['https://www.example.com/search?q=a&page=2']);
});

test('CDATA is read as it stands, and comments are skipped', () => {
  const doc = readSitemapXml(urlset('<!-- <url><loc>/hidden</loc></url> --><url><loc><![CDATA[https://www.example.com/a?x=1&y=<2>]]></loc></url>'));
  assert.deepEqual(doc.locs, ['https://www.example.com/a?x=1&y=<2>']);
});

test('a DOCTYPE or ENTITY declaration is refused, so no entity can expand', () => {
  const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><urlset><url><loc>&lol2;</loc></url></urlset>';
  assert.throws(() => readSitemapXml(bomb), /DOCTYPE or ENTITY declaration/);
  assert.throws(() => readSitemapXml(urlset('<!ENTITY x "y">')), /DOCTYPE or ENTITY/);
  assert.throws(() => readSitemapXml('<!doctype urlset><urlset/>'), /DOCTYPE/);
});

test('a sitemap index gives the <loc> of each <sitemap>', () => {
  const doc = readSitemapXml('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://www.example.com/sitemap-products.xml</loc></sitemap></sitemapindex>');
  assert.equal(doc.kind, 'sitemapindex');
  assert.deepEqual(doc.locs, ['https://www.example.com/sitemap-products.xml']);
});

test('text that is not a well-formed sitemap is refused with the reason', () => {
  assert.throws(() => readSitemapXml('<urlset><url><loc>/a</loc></url>'), /<urlset> is not closed/);
  assert.throws(() => readSitemapXml('<urlset><url><loc>/a</url></urlset>'), /does not close <loc>/);
  assert.throws(() => readSitemapXml('<rss><channel/></rss>'), /not <urlset> or <sitemapindex>/);
  assert.throws(() => readSitemapXml('<urlset/><urlset/>'), /more than one root/);
  assert.throws(() => readSitemapXml(urlset('<url><loc><b>x</b></loc></url>')), /inside <loc>/);
  assert.throws(() => readSitemapXml(urlset('<!-- open')), /comment is not closed/);
  assert.throws(() => readSitemapXml(urlset('<url><loc><![CDATA[x</loc></url>')), /CDATA section is not closed/);
  assert.throws(() => readSitemapXml('just text'), /outside the root/);
  assert.throws(() => readSitemapXml(''), /no root element/);
  assert.throws(() => readSitemapXml(`<urlset>${'<a>'.repeat(MAX_DEPTH + 1)}`), /nested more than 64/);
  assert.throws(() => readSitemapXml(urlset('<url><loc>/a</loc></url><url><loc>/b</loc></url>'), 1), /more than 1 <loc> entries/);
});
