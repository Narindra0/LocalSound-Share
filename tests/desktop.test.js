'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allowedPage, navigationTarget, videoUrl } = require('../desktop/navigation');
const { panelBounds } = require('../desktop/panel-layout');
test('lecteur intégré : les deux formats restent dans la fenêtre et dégagent le bandeau', () => {
  for (const [width, height] of [[1380, 880], [960, 600], [780, 600], [390, 568]]) {
    for (const expanded of [true, false]) {
      const rect = panelBounds(width, height, expanded);
      assert.ok(rect.x >= 0 && rect.y >= 60);
      assert.ok(rect.x + rect.width <= width && rect.y + rect.height <= height);
      assert.ok(rect.height > 108);
    }
  }
});
test('navigateur desktop : recherche, navigation YouTube et liens vidéo', () => {
  assert.equal(navigationTarget(''), 'https://www.youtube.com/');
  assert.equal(navigationTarget('Daft Punk & jazz'), 'https://www.youtube.com/results?search_query=Daft%20Punk%20%26%20jazz');
  assert.equal(navigationTarget('youtu.be/jNQXAC9IVRw'), 'https://youtu.be/jNQXAC9IVRw');
  assert.equal(videoUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=test'), 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.equal(videoUrl('https://www.youtube.com/results?search_query=jazz'), null);
  assert.ok(allowedPage('https://accounts.google.com/signin'));
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'http://www.youtube.com/', 'https://youtube.com.evil.test/', 'https://youtube.com@evil.test/', 'https://www.youtube.com:3000/', 'https://localhost/', 'https://www.youtube.com./']) {
    assert.equal(allowedPage(url), false, url);
    assert.throws(() => navigationTarget(url), /adresse YouTube/);
  }
});
