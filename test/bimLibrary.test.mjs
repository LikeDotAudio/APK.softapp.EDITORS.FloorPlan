// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* 📚 the BIM library, called up here (ROAD-3572): what an element keeps from a pick. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bimFields, bimRefOf, isLibraryShortcut, readLibraryDrop, pickFromLibrary, BIM_MIME } from '../js/bimLibrary.js';

const ITEM = {
  bim: { id: 'keysight/34401a', manufacturer: 'Keysight', model: '34401A', name: 'Keysight 34401A' },
  ref: { part: 'keysight/34401a', url: 'http://apk.local:8160/api/bim/parts/keysight/34401a', rev: '3f1c0a9be27d4410', source: 'live' },
};

test('a pick gives the element its part and its BIM reference', () => {
  assert.deepEqual(bimFields(ITEM), {
    bimId: 'keysight/34401a',
    bimRef: { part: 'keysight/34401a', url: 'http://apk.local:8160/api/bim/parts/keysight/34401a', rev: '3f1c0a9be27d4410' },
  });
  assert.equal(bimRefOf({ bim: { id: 'x' } }), null, 'no ref, no BIM reference');
});

test('Ctrl/⌘+Shift+L is the library shortcut', () => {
  assert.ok(isLibraryShortcut({ ctrlKey: true, shiftKey: true, key: 'L' }));
  assert.ok(isLibraryShortcut({ metaKey: true, shiftKey: true, key: 'l' }));
  assert.ok(!isLibraryShortcut({ ctrlKey: true, key: 'l' }));
});

test('a drop of the library drag source reads back as {bim, ref}', () => {
  const dt = { types: [BIM_MIME], getData: (t) => (t === BIM_MIME ? JSON.stringify(ITEM) : '') };
  assert.deepEqual(readLibraryDrop({ dataTransfer: dt }), ITEM);
  assert.equal(readLibraryDrop({ dataTransfer: { types: [], getData: () => 'nope' } }), null);
});

test('closing the library without a pick is no items, not an error', async () => {
  const was = globalThis.APKLibrary;
  globalThis.APKLibrary = { pick: async () => { const e = new Error('closed'); e.name = 'AbortError'; e.code = 'cancelled'; throw e; } };
  try { assert.deepEqual(await pickFromLibrary(), []); } finally { globalThis.APKLibrary = was; }
});
