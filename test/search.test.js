import assert from 'node:assert/strict';
import test from 'node:test';
import { isUnavailable, scorer } from '../js/search.js';

const v = (title, description = '') => ({ title, description });

test('every word must match somewhere', () => {
  const score = scorer('cast iron');
  assert.equal(score(v('Cast iron pan'), 'Tested'), 30 + 50);
  assert.equal(score(v('Cast aluminum pan'), 'Tested'), 0);
  assert.ok(score(v('Pan care', 'cast iron tips'), 'Tested') > 0);
});

test('ranking: exact title > phrase in title > words in title > channel > description', () => {
  const score = scorer('board games');
  const ranked = [
    score(v('Board games'), 'X'),
    score(v('The best board games of 2026'), 'X'),
    score(v('Games for every board'), 'X'),
    score(v('Top 10 games'), 'Board Game Channel'),
    score(v('Top 10', 'board games we love'), 'X'),
  ];
  assert.deepEqual(
    [...ranked].sort((a, b) => b - a),
    ranked,
  );
  assert.equal(new Set(ranked).size, ranked.length);
});

test('whole words beat partial words', () => {
  const score = scorer('cat');
  assert.ok(score(v('My cat'), 'X') > score(v('Category theory'), 'X'));
});

test('empty query matches everything; regex characters are safe', () => {
  assert.equal(scorer('  ')(v('Anything'), 'X'), 1);
  assert.ok(scorer('c++ (part 1)')(v('Learn C++ (part 1)'), 'X') > 0);
});

test('private and deleted videos are detected', () => {
  assert.ok(isUnavailable({ title: 'Anything', privacy: 'private' }));
  assert.ok(isUnavailable(v('Private video')));
  assert.ok(isUnavailable(v('Deleted video')));
  assert.ok(!isUnavailable({ title: 'My private video tour', privacy: 'public' }));
});
